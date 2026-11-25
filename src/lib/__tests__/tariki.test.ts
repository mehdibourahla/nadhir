import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {},
}));
vi.mock("@/lib/source-archive.server", () => ({
  archivedFetch: vi.fn(),
  ArchiveFailure: class ArchiveFailure extends Error {},
}));

import {
  comparable,
  copiedFrom,
  forModel,
  readSituation,
  systemPrompt,
  TARIKI_SOURCE,
} from "@/lib/text-sources/dgpc-situation.server";
import {
  extractFacebookPageSlug,
  facebookPageFetch,
  fetchFacebookPagePosts,
  isLoginWallHtml,
} from "@/lib/text-sources/facebook-page";
import { GatewayPending } from "@/lib/llm/gateway.server";
import {
  runTextSourceWith,
  type TextSource,
  type TextSourceStore,
} from "@/lib/text-sources/pipeline.server";
import {
  assertTarikiNonFireKind,
  classifyTarikiPostPreFilter,
  filterTarikiNonFireItems,
  TARIKI_ATTRIBUTION,
  TARIKI_SOURCE_KEY,
  tarikiPostsFromCapturedItems,
  tarikiPostsFromFacebookPage,
} from "@/lib/text-sources/tariki";
import {
  ingestTariki,
  runTarikiSource,
} from "@/lib/text-sources/tariki.server";
import {
  hazardAlerts,
  type HazardContext,
  type HazardZone,
} from "@/lib/zone-hazard-alerts";
import { publicReasonForError } from "@/lib/source-runs";
import {
  retryDispositionForReason,
  type ClaimedSourceJob,
} from "@/lib/source-jobs";

import tarikiPostsFixture from "./fixtures/tariki-posts.json";
import tarikiEmptyWindow from "./fixtures/tariki-empty-window.json";
import tarikiSchemaError from "./fixtures/tariki-schema-error.json";

const tarikiLoginWallHtml = readFileSync(
  new URL("./fixtures/tariki-login-wall.html", import.meta.url),
  "utf8",
);

const TARIKI_TEXT_SOURCE: TextSource = {
  id: "src-tariki-1",
  key: TARIKI_SOURCE_KEY,
  kind: "facebook",
  url: "https://www.facebook.com/tariki.GN",
  label: TARIKI_ATTRIBUTION,
  authority_tier: "national",
  language: "ar",
  wilaya_id: null,
  template: null,
};

function makeTarikiJob(): ClaimedSourceJob {
  return {
    id: "00000000-0000-4000-8000-000000000019",
    contract_key: TARIKI_SOURCE_KEY,
    contract_version: 1,
    trigger_kind: "scheduled",
    execution_target: "worker",
    state: "running",
    scheduled_for: "2026-10-02T06:00:00Z",
    started_at: "2026-10-02T06:00:05Z",
    available_at: "2026-10-02T06:00:00Z",
    data_from: "2026-10-02T05:00:00Z",
    data_through: "2026-10-02T06:00:00Z",
    attempt_count: 1,
    max_attempts: 3,
    retry_base_seconds: 60,
    retry_until: "2026-10-02T06:30:00Z",
    dispatched_at: "2026-10-02T06:00:04Z",
    enqueued_by: ["scheduler"],
    finished_at: null,
    gap_id: null,
    idempotency_key: "tariki_facebook:scheduled:2026-10-02T06:00:00Z",
    last_error_at: null,
    last_public_reason_code: null,
    created_at: "2026-10-02T06:00:00Z",
    updated_at: "2026-10-02T06:00:05Z",
  };
}

function makeFakeStore(overrides: Partial<TextSourceStore> = {}) {
  const failures: { documentId: string; message: string }[] = [];
  const confirmCalls: unknown[] = [];
  const unlistedCalls: unknown[] = [];
  const mentionsCreated: unknown[] = [];
  const incidentsCreated: unknown[] = [];

  const store: TextSourceStore = {
    loadSource: async () => TARIKI_TEXT_SOURCE,
    knownExternalIds: async () => new Set<string>(),
    insertDocuments: async (rows) =>
      rows.map((r, i) => ({ ...r, id: `doc-${i + 1}` })),
    loadGazetteer: async () => ({
      wilayas: [
        { id: "w-tam", name_ar: "تمنراست" },
        { id: "w-tam-alt", name_ar: "تامنغست" },
        { id: "w-illizi", name_ar: "إليزي" },
        { id: "w-bouira", name_ar: "البويرة" },
        { id: "w-constantine", name_ar: "قسنطينة" },
      ],
      communesByWilaya: new Map([
        ["w-illizi", [{ id: "c-illizi", name_ar: "إليزي", aliases: [] }]],
        [
          "w-tam-alt",
          [{ id: "c-in-amguel", name_ar: "عين أمقل", aliases: ["عين امقل"] }],
        ],
      ]),
    }),
    insertMentions: async (rows) => {
      mentionsCreated.push(...rows);
      return rows.map((r, i) => ({
        ...r,
        id: `mention-${i + 1}`,
        inserted: true,
      }));
    },
    openIncidents: async () => [],
    applyMention: async (_mentionId, change) => {
      incidentsCreated.push(change);
      return { id: `inc-${incidentsCreated.length}`, applied: true };
    },
    pendingCount: async () => 0,
    listedIncidents: async () => [],
    retryableDocuments: async () => [],
    recordExtractionFailure: async (documentId, message) => {
      failures.push({ documentId, message });
    },
    clearExtractionFailure: async () => {},
    confirmClusters: async (rows) => {
      confirmCalls.push(...rows);
      return rows.length;
    },
    markUnlisted: async (ids, asOf) => {
      unlistedCalls.push({ ids, asOf });
    },
    insertAdvice: async () => {},
    ...overrides,
  };

  return {
    store,
    failures,
    confirmCalls,
    unlistedCalls,
    mentionsCreated,
    incidentsCreated,
  };
}

describe("F19 - Hardened Gendarmerie Tariki", () => {
  it("normalizes all 6 real captured Tariki posts (including reels) and computes pre-filter freshness watermark", () => {
    const batch = tarikiPostsFromCapturedItems(tarikiPostsFixture);
    expect(batch.totalSeen).toBe(6);
    expect(batch.posts).toHaveLength(6);
    expect(batch.upstreamPublishedAt).toBe("2026-10-02T05:30:01.000Z");
    expect(batch.posts[0]?.url).toBe(
      "https://www.facebook.com/reel/1836289874194642/",
    );

    // Watermark still advances even when all external IDs are already known
    const allKnown = new Set(tarikiPostsFixture.map((p) => p.postId));
    const deduped = tarikiPostsFromCapturedItems(tarikiPostsFixture, allKnown);
    expect(deduped.posts).toHaveLength(0);
    expect(deduped.upstreamPublishedAt).toBe("2026-10-02T05:30:01.000Z");

    // Empty window & malformed payloads
    const empty = tarikiPostsFromCapturedItems(tarikiEmptyWindow);
    expect(empty.posts).toEqual([]);
    expect(empty.upstreamPublishedAt).toBeNull();
    let schemaErr: Error | null = null;
    try {
      tarikiPostsFromCapturedItems(tarikiSchemaError);
    } catch (err) {
      schemaErr = err as Error;
    }
    expect(schemaErr).toBeInstanceOf(Error);
    expect(schemaErr!.message).toMatch(/schema/i);
    expect(publicReasonForError(schemaErr!.message)).toBe("schema_invalid");
    expect(
      retryDispositionForReason(publicReasonForError(schemaErr!.message)),
    ).toBe("permanent");
    expect(publicReasonForError("Tariki schema invalid: missing postId")).toBe(
      "schema_invalid",
    );
    expect(() => tarikiPostsFromCapturedItems(tarikiLoginWallHtml)).toThrow(
      /upstream/i,
    );
  });

  it("classifies the 6 real Tariki fixture posts into 3 actionable road dangers and 3 ignored posts", () => {
    const decisions = tarikiPostsFixture.map((p) => ({
      id: p.postId,
      decision: classifyTarikiPostPreFilter(p.text),
    }));
    expect(decisions).toEqual([
      { id: "1669103155256284", decision: "candidate" }, // Tamanrasset RN01 water rise closure
      { id: "1668330175333582", decision: "candidate" }, // Illizi RN03 collapsed road edge
      { id: "1670057101827556", decision: "candidate" }, // Illizi/Djanet RN03 difficulty water rise
      { id: "1670939638405969", decision: "ignore_open_works" }, // Bouira cable works on open motorway
      { id: "1671831131650153", decision: "ignore_greeting" }, // Morning greeting with tatweel
      { id: "1666711438828789", decision: "ignore_heavy_trucks_only" }, // Constantine CW05 heavy trucks only
    ]);

    // NFD decomposed Arabic alef+hamza (as seen in real Facebook posts) must match open works
    expect(
      classifyTarikiPostPreFilter(
        "[#البويرة] ⚠️ وجود ا\u0654شغال تعبيد الطريق في كلا الإتجاهين بالطريق السيار شرق_غرب.",
      ),
    ).toBe("ignore_open_works");

    // Explicit heavy-trucks-only closure without hazards is filtered out
    expect(
      classifyTarikiPostPreFilter(
        "#قسنطينة غلق الطريق الوطني رقم 05 في وجه شاحنات الوزن الثقيل من أجل أشغال الصيانة.",
      ),
    ).toBe("ignore_heavy_trucks_only");

    // Closure affecting all vehicles including heavy trucks due to subsidence MUST remain candidate
    expect(
      classifyTarikiPostPreFilter(
        "#البليدة غلق الطريق الوطني رقم 01 أمام جميع المركبات بما فيها شاحنات الوزن الثقيل بسبب هبوط الطريق.",
      ),
    ).toBe("candidate");
    expect(
      classifyTarikiPostPreFilter(
        "#المدية غلق الطريق بسبب هبوط الطريق ومنع مرور شاحنات الوزن الثقيل.",
      ),
    ).toBe("candidate");

    // Exceptional convoy escort without road danger is filtered out as open works
    expect(
      classifyTarikiPostPreFilter(
        "🚛 #طريقي: مرافقة قافلة استثنائية لنقل معدات صناعية عبر الطريق الوطني رقم 5 بولاية سطيف.",
      ),
    ).toBe("ignore_open_works");

    // Temporary heavy-trucks-only circulation ban (without closure word or hazard) is filtered out
    expect(
      classifyTarikiPostPreFilter(
        "🚚 #طريقي: منع مؤقت لسير شاحنات الوزن الثقيل فقط عبر الطريق الاجتنابي الجنوبي بالجزائر العاصمة خلال أوقات الذروة.",
      ),
    ).toBe("ignore_heavy_trucks_only");
    expect(
      classifyTarikiPostPreFilter(
        "🚚 #طريقي: منع مؤقت لمرور شاحنات الوزن الثقيل فقط عبر الطريق السيار شرق-غرب خلال أوقات الذروة.",
      ),
    ).toBe("ignore_heavy_trucks_only");

    // Genuine road closures & hazards remain candidate even if convoy/truck wording appears
    expect(
      classifyTarikiPostPreFilter(
        "🌧️🚧 #طريقي: الطريق الوطني رقم 11 مغلق بسبب ارتفاع منسوب المياه ببلدية عين البنيان ولاية الجزائر.",
      ),
    ).toBe("candidate");
    expect(
      classifyTarikiPostPreFilter(
        "❄️⚠️ #طريقي: منع مؤقت لسير شاحنات الوزن الثقيل فقط بسبب تراكم الثلوج والجليد بفج تيروردة.",
      ),
    ).toBe("candidate");
    expect(
      classifyTarikiPostPreFilter(
        "⚠️ #طريقي: منع مؤقت لسير جميع المركبات بما فيها شاحنات الوزن الثقيل فقط عبر الطريق الوطني رقم 1.",
      ),
    ).toBe("candidate");

    // Regression guards: dense fog, snowfall, sandstorms, and non-exceptional convoys MUST stay candidate
    for (const dangerPost of [
      "🌫️⚠️ #طريقي: منع مؤقت لسير شاحنات الوزن الثقيل فقط عبر الطريق السيار شرق-غرب بولاية سطيف بسبب ضباب كثيف يحجب الرؤية.",
      "🌫️⚠️ #طريقي: ضباب كثيف يحجب الرؤية على الطريق السيار شرق-غرب بولاية البويرة أثناء مرافقة قافلة استثنائية، يرجى توخي الحذر.",
      "❄️⚠️ #طريقي: تساقط الثلوج الكثيفة على الطريق الوطني رقم 33 بولاية البويرة يعيق حركة قافلة المركبات، يرجى توخي الحيطة والحذر.",
      "❄️ #طريقي: قافلة الحماية المدنية تتدخل لمساعدة العالقين بسبب تساقط الثلوج على الطريق الوطني رقم 15 بولاية تيزي وزو.",
      "❄️⚠️ #طريقي: تعثر مرور قافلة استثنائية على الطريق الوطني رقم 5 بولاية سطيف بسبب تساقط الثلوج.",
      "🌪️⚠️ #طريقي: منع مؤقت لسير شاحنات الوزن الثقيل فقط عبر الطريق الوطني رقم 1 بولاية الأغواط بسبب زوابع رملية قوية وانعدام الرؤية.",
      "🌧️⚠️ #طريقي: منع مؤقت لمرور شاحنات الوزن الثقيل فقط بسبب أمطار غزيرة على الطريق الوطني رقم 12 بولاية تيزي وزو.",
      "🚑 #طريقي: قافلة إغاثة تتوجه إلى القرى المعزولة بولاية بجاية.",
      "صباح الخير، ضباب كثيف يحجب الرؤية على الطريق السيار شرق-غرب بولاية البويرة.",
      "صباح الخير، تساقط الثلوج على الطريق الوطني رقم 15 بولاية تيزي وزو.",
    ]) {
      expect(
        classifyTarikiPostPreFilter(dangerPost),
        `life-safety Tariki post must stay candidate: ${dangerPost}`,
      ).toBe("candidate");
    }
  });

  it("hardens dgpc-situation with tatweel stripping, #/_/emoji-resilient verbatim quote guard, and Tariki dangers-only prompt", async () => {
    const greetingPost = tarikiPostsFixture[4]!.text;
    expect(forModel(greetingPost)).not.toContain("\u0640");
    expect(forModel(greetingPost)).toContain("طريقي");

    const hashtagWaterPost = tarikiPostsFixture[2]!.text;
    // Model strips hashtags/underscores/emoji when quoting evidence; copiedFrom must still verify verbatim match
    expect(
      copiedFrom(
        "صعوبة في السير بالوطني رقم 03 الرابط بين ولايتي إليزي و جانت",
        hashtagWaterPost,
      ),
    ).toBe(true);
    expect(copiedFrom("إرتفاع منسوب المياه", hashtagWaterPost)).toBe(true);
    expect(copiedFrom("حريق غابة في بجاية", hashtagWaterPost)).toBe(false);
    expect(comparable("⛔️طريق_مغلق #تامنغست")).toBe("طريق مغلق تامنغست");

    // Prompt explicitly describes Tariki dangers-only rules including heavy-trucks-only exclusion
    const prompt = systemPrompt(TARIKI_SOURCE);
    expect(prompt).toContain("Gendarmerie Nationale (Tariki)");
    expect(prompt).toContain("heavy trucks only is not a closure");

    let capturedUserPrompt = "";
    const res = await readSituation(
      tarikiPostsFixture[0]!.text,
      {
        model: "m",
        complete: async (req) => {
          capturedUserPrompt = req.messages[1]!.content;
          return JSON.stringify({
            disposition: "situation_report",
            items: [
              {
                hazard: "road",
                wilaya: "تامنغست",
                commune: "عين امقل",
                place: "الطريق الوطني رقم 01",
                state: "ongoing",
                evidence:
                  "طريق مغلق الطريق الوطني رقم 01 في شطره الرابط بين قرية أراك وعين امقل",
              },
            ],
            advice_text: null,
            advice_wilayas: [],
            valid_from: null,
            valid_to: null,
          });
        },
      },
      TARIKI_SOURCE,
    );
    expect(capturedUserPrompt).not.toContain("\u0640");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.hazard).toBe("road");
  });

  it("hardens facebook-page.ts for HTTP 200 login-wall HTML, /checkpoint redirects, and slug extraction", async () => {
    expect(extractFacebookPageSlug("https://www.facebook.com/tariki.GN")).toBe(
      "tariki.GN",
    );
    expect(extractFacebookPageSlug("tariki.GN")).toBe("tariki.GN");
    expect(isLoginWallHtml(tarikiLoginWallHtml)).toBe(true);
    expect(isLoginWallHtml("<html></html>")).toBe(false);

    // HTTP 200 login wall HTML maps to upstream_unreachable (transient)
    await expect(
      fetchFacebookPagePosts(
        "tariki.GN",
        facebookPageFetch(async () => new Response(tarikiLoginWallHtml)),
      ),
    ).rejects.toThrow("Facebook upstream login wall (HTTP 200)");
    expect(
      publicReasonForError("Facebook upstream login wall (HTTP 200)"),
    ).toBe("upstream_unreachable");

    // /checkpoint redirect treated as login wall
    const checkpointFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "https://www.facebook.com/checkpoint/?next=tariki.GN",
          },
        }),
    );
    await expect(
      fetchFacebookPagePosts("tariki.GN", facebookPageFetch(checkpointFetch)),
    ).rejects.toThrow("Facebook login wall (HTTP 302)");
    expect(checkpointFetch).toHaveBeenCalledTimes(3);

    // Direct facebook-page post mapper preserves pre-filter watermark
    const fbBatch = tarikiPostsFromFacebookPage([
      {
        id: "402215187257085_1669103155256284",
        uri: "tariki.GN",
        created_time: "2026-09-29T23:34:25Z",
        message: tarikiPostsFixture[0]!.text,
        region: "",
        type: [],
      },
    ]);
    expect(fbBatch.upstreamPublishedAt).toBe("2026-09-29T23:34:25.000Z");
    expect(fbBatch.posts[0]?.url).toBe(
      "https://www.facebook.com/tariki.GN/posts/1669103155256284",
    );
  });

  it("routes Tariki unconditionally to readSituation, skips fire dispositions, and NEVER calls extractLlm or confirmClusters", async () => {
    const fake = makeFakeStore();
    const extractLlm = vi.fn(async () => ({ mentions: [] }));

    const run = await runTextSourceWith(TARIKI_SOURCE_KEY, {
      store: fake.store,
      fetchPosts: async () => [
        {
          externalId: "tariki-fire-attempt",
          publishedAt: "2026-10-02T05:00:00Z",
          url: "https://www.facebook.com/tariki.GN/posts/1",
          text: "حريق غابة قرب الطريق",
        },
        {
          externalId: "1669103155256284",
          publishedAt: "2026-09-29T23:34:25Z",
          url: "https://www.facebook.com/reel/1836289874194642/",
          text: tarikiPostsFixture[0]!.text,
        },
      ],
      extractLlm,
      readSituation: async (text) => {
        if (text.includes("حريق")) {
          return {
            disposition: "fire",
            items: [],
            advice: null,
            rejected: 0,
          };
        }
        return {
          disposition: "situation_report",
          items: [
            {
              hazard: "road",
              wilaya: "تامنغست",
              commune: "عين امقل",
              place: "الطريق الوطني رقم 01",
              state: "ongoing",
              evidence: "الطريق الوطني رقم 01",
            },
          ],
          advice: null,
          rejected: 0,
        };
      },
    });

    expect(extractLlm).not.toHaveBeenCalled();
    expect(fake.confirmCalls).toHaveLength(0);
    expect(run.clustersConfirmed).toBe(0);
    expect(run.skippedPosts).toBe(1);
    expect(run.situationItems).toBe(1);
    expect(run.incidentsCreated).toBe(1);
    expect(() => assertTarikiNonFireKind("vegetation")).toThrow(/cannot emit/i);
    expect(
      filterTarikiNonFireItems([
        { hazard: "road" },
        { hazard: "vegetation" },
        { hazard: "flood" },
        { hazard: "urban" },
      ]),
    ).toEqual([{ hazard: "road" }, { hazard: "flood" }]);
  });

  it("propagates GatewayPending cleanly without quarantining documents or unlisting incidents", async () => {
    const fake = makeFakeStore();
    const run = await ingestTariki({
      store: fake.store,
      fetchBatch: async () =>
        tarikiPostsFromCapturedItems([tarikiPostsFixture[0]!]),
      readSituation: async () => {
        throw new GatewayPending("rate_limited", 60);
      },
    });

    expect(run.llmFailed).toBe(1);
    expect(fake.failures).toHaveLength(0);
    expect(fake.unlistedCalls).toHaveLength(0);
    expect(fake.confirmCalls).toHaveLength(0);
  });

  it("exposes SourceRunner-compatible runTarikiSource and dynamic Gendarmerie Nationale (Tariki) watch-zone attribution", async () => {
    const fake = makeFakeStore();
    const jobResult = await runTarikiSource(makeTarikiJob(), {
      store: fake.store,
      fetchBatch: async () => tarikiPostsFromCapturedItems(tarikiPostsFixture),
      readSituation: async () => ({
        disposition: "situation_report",
        items: [
          {
            hazard: "road",
            wilaya: "إليزي",
            commune: "إليزي",
            place: "الطريق الوطني رقم 03",
            state: "ongoing",
            evidence: "صعوبة في السير بالوطني رقم 03",
          },
        ],
        advice: null,
        rejected: 0,
      }),
    });

    expect(jobResult.contractKey).toBe(TARIKI_SOURCE_KEY);
    expect(jobResult.outcome).toBe("succeeded");
    expect(jobResult.upstreamPublishedAt).toBe("2026-10-02T05:30:01.000Z");
    expect(jobResult.qualityChecks?.["clusters_confirmed"]).toBe(0);
    // pipeline processes up to 5 documents per run (3 actionable candidates + 2 ignored in first 5 posts)
    expect(jobResult.qualityChecks?.["pre_filtered_non_dangers"]).toBe(2);

    // Dynamic attribution in zone-hazard-alerts.ts never hardcodes Protection Civile for Tariki
    const zones: HazardZone[] = [
      {
        id: "z-1",
        user_id: "u-1",
        name: "Illizi",
        lat: 26.5,
        lon: 8.48,
        radius_km: 25,
        commune_id: "c-illizi",
        min_danger_level: 1,
        notify_weather: false,
        notify_official: true,
        notify_road: false,
        notify_citizen: false,
        notify_earthquake: false,
      },
    ];
    const ctx: HazardContext = {
      communes: new Map([["c-illizi", { code: "3301", wilayaId: "w-illizi" }]]),
      weather: [],
      official: [
        {
          id: "inc-tariki-1",
          kind: "road",
          commune_id: "c-illizi",
          wilaya_id: "w-illizi",
          place_text: "RN 03",
          last_reported_at: "2026-10-02T05:30:00Z",
          source_key: TARIKI_SOURCE_KEY,
          source_label: TARIKI_ATTRIBUTION,
        },
      ],
      authority: [],
      road: [],
      citizen: [],
      earthquakes: [],
    };
    const { rows } = hazardAlerts(zones, ctx, () => ({
      locale: "fr",
      quiet: false,
      minLevel: 1,
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toContain(TARIKI_ATTRIBUTION);
    expect(rows[0]!.title).not.toContain("Protection civile");
    expect(rows[0]!.payload["provenance_source_key"]).toBe(TARIKI_SOURCE_KEY);
    expect(rows[0]!.payload["provenance_source"]).toBe(TARIKI_ATTRIBUTION);
    expect(rows[0]!.payload["provenance_rule"]).toBe(
      "provenance.rule.roadDanger",
    );

    // Tariki with source_label=null still resolves canonical Gendarmerie Nationale (Tariki) in title, body, and provenance
    const tarikiNullLabelCtx: HazardContext = {
      ...ctx,
      official: [
        {
          id: "inc-tariki-null-label",
          kind: "road",
          commune_id: "c-illizi",
          wilaya_id: "w-illizi",
          place_text: "RN 03",
          last_reported_at: "2026-10-02T05:30:00Z",
          source_key: TARIKI_SOURCE_KEY,
          source_label: null,
        },
        {
          id: "inc-tariki-flood",
          kind: "flood",
          commune_id: "c-illizi",
          wilaya_id: "w-illizi",
          place_text: "Oued Illizi",
          last_reported_at: "2026-10-02T05:35:00Z",
          source_key: TARIKI_SOURCE_KEY,
          source_label: null,
        },
      ],
    };
    const tarikiNullRows = hazardAlerts(zones, tarikiNullLabelCtx, () => ({
      locale: "en",
      quiet: false,
      minLevel: 1,
    })).rows;
    expect(tarikiNullRows).toHaveLength(2);
    expect(tarikiNullRows[0]!.title).toContain(TARIKI_ATTRIBUTION);
    expect(tarikiNullRows[0]!.body).toContain(TARIKI_ATTRIBUTION);
    expect(tarikiNullRows[0]!.title).not.toContain("DGPC");
    expect(tarikiNullRows[0]!.title).not.toContain("Protection Civile");
    expect(tarikiNullRows[0]!.payload["provenance_source"]).toBe(
      TARIKI_ATTRIBUTION,
    );
    expect(tarikiNullRows[0]!.payload["provenance_rule"]).toBe(
      "provenance.rule.roadDanger",
    );
    expect(tarikiNullRows[1]!.payload["provenance_source"]).toBe(
      TARIKI_ATTRIBUTION,
    );
    expect(tarikiNullRows[1]!.payload["provenance_rule"]).toBe(
      "provenance.rule.civilUpdate",
    );

    // Hydrated live DGPC row ({ source_key: "dgpc_telegram", source_label: "Protection Civile (DGPC) Telegram" })
    // preserves localized Arabic & French DGPC copy and canonical "DGPC" provenance
    const hydratedDgpcCtx: HazardContext = {
      ...ctx,
      official: [
        {
          id: "inc-dgpc-live-1",
          kind: "flood",
          commune_id: "c-illizi",
          wilaya_id: "w-illizi",
          place_text: "Oued Aissi",
          last_reported_at: "2026-10-02T05:40:00Z",
          source_key: "dgpc_telegram",
          source_label: "Protection Civile (DGPC) Telegram",
        },
      ],
    };
    const dgpcAr = hazardAlerts(zones, hydratedDgpcCtx, () => ({
      locale: "ar",
      quiet: false,
      minLevel: 1,
    })).rows[0]!;
    expect(dgpcAr.title).toBe("بلاغ الحماية المدنية بخصوص Illizi");
    expect(dgpcAr.body).toContain("بلاغ الحماية المدنية، Oued Aissi:");
    expect(dgpcAr.title).not.toContain("Telegram");
    expect(dgpcAr.payload["provenance_source"]).toBe("DGPC");
    expect(dgpcAr.payload["provenance_rule"]).toBe(
      "provenance.rule.dgpcNonFire",
    );

    const dgpcFr = hazardAlerts(zones, hydratedDgpcCtx, () => ({
      locale: "fr",
      quiet: false,
      minLevel: 1,
    })).rows[0]!;
    expect(dgpcFr.title).toBe(
      "Signalement de la Protection civile pour Illizi",
    );
    expect(dgpcFr.body).toContain(
      "Signalement de la Protection civile, Oued Aissi :",
    );
    expect(dgpcFr.title).not.toContain("Telegram");
    expect(dgpcFr.payload["provenance_source"]).toBe("DGPC");
    expect(dgpcFr.payload["provenance_rule"]).toBe(
      "provenance.rule.dgpcNonFire",
    );
  });
});
