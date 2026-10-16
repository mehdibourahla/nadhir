import { describe, expect, it } from "vitest";

import {
  runTextSourceWith,
  type DocumentInsert,
  type TextSourcePipelineDependencies,
  type TextSourceStore,
} from "@/lib/text-sources/pipeline.server";
import type { LlmMention } from "@/lib/text-sources/extract-llm.server";
import { isFireKind, type OpenIncident } from "@/lib/text-sources/merge";
import type { Situation } from "@/lib/text-sources/dgpc-situation.server";
import type { TelegramPost } from "@/lib/text-sources/telegram-public";
import { LlmUnavailable } from "@/lib/text-sources/llm-unavailable";
import recoveryPosts from "./fixtures/dgpc-recovery-posts.json";

const SKIKDA = "w-skikda";
const OTHER = "w-other";
const AZZABA = "c-azzaba";
const AIN_ZOUIT = "c-ain-zouit";
const FAR = "c-far";

const bulletin = (
  asOfHour: string,
  distribution: string,
  body: string,
  ongoing = 2,
) =>
  `🔴 الحالة العامة لحرائق الغطاء النباتي ليوم 02 سبتمبر 2026 على الساعة ${asOfHour}سا00د
🔴 العدد الإجمالي للحرائق: ${ongoing + 1}
🔴 عدد الحرائق التي تم إخمادها: 1
🔴 عدد الحرائق المتواصلة: ${ongoing}
✅✅ الحرائق المتواصلة موزعة على:
${distribution}
🔴 أهم الحرائق
ولاية #سكيكدة:
${body}
#الحماية_المدنية_الجزائرية`;

const mention = (over: Partial<LlmMention>): LlmMention => ({
  wilaya: "سكيكدة",
  commune: "عزابة",
  place: null,
  kind: "vegetation",
  status: "ongoing",
  count: 1,
  evidence: "حريق ببلدية عزابة، العملية متواصلة...",
  ...over,
});

const llmWith =
  (...mentions: LlmMention[]): TextSourcePipelineDependencies["extractLlm"] =>
  async () => ({ skipped: false, mentions });

function memoryStore() {
  const documents: { id: string; externalId: string }[] = [];
  const mentions: Record<string, unknown>[] = [];
  const incidents = new Map<
    string,
    OpenIncident & { mention_count: number; status: string }
  >();
  const unlisted = new Map<string, string>();
  const stored = new Map<string, DocumentInsert & { id: string }>();
  const advice: Record<string, unknown>[] = [];
  const retry = new Map<string, DocumentInsert & { id: string }>();
  const confirmed: { communeId: string; asOf: string; mentionId: string }[] =
    [];
  let seq = 0;
  const store: TextSourceStore = {
    loadSource: async (key) => ({
      id: "src-dgpc",
      key,
      kind: "telegram_public",
      url: "https://t.me/s/DGPCDZ",
      authority_tier: "national",
      language: "ar",
      wilaya_id: null,
      template: "dgpc_bulletin",
    }),
    knownExternalIds: async () => new Set(documents.map((d) => d.externalId)),
    insertDocuments: async (rows) =>
      rows.map((r) => {
        const id = `doc-${++seq}`;
        documents.push({ id, externalId: r.external_id });
        const full = { id, ...r };
        stored.set(id, full);
        retry.set(id, full);
        return full;
      }),
    loadGazetteer: async () => ({
      wilayas: [
        { id: SKIKDA, name_ar: "سكيكدة" },
        { id: OTHER, name_ar: "باتنة" },
      ],
      communesByWilaya: new Map([
        [
          SKIKDA,
          [
            { id: AZZABA, name_ar: "عزابة", aliases: [] },
            { id: AIN_ZOUIT, name_ar: "عين زويت", aliases: [] },
          ],
        ],
        [OTHER, [{ id: FAR, name_ar: "بلدة بعيدة", aliases: [] }]],
      ]),
    }),
    insertMentions: async (rows) =>
      rows.map((r) => {
        const existing = mentions.find(
          (m) =>
            m["document_id"] === r.document_id &&
            m["commune_id"] === r.commune_id &&
            m["wilaya_id"] === r.wilaya_id &&
            m["kind"] === r.kind &&
            // mirrors write_text_source: non-fire mentions stay apart by place
            (isFireKind(r.kind) || m["place_text"] === r.place_text),
        );
        if (existing)
          return { ...existing, inserted: false } as unknown as typeof r & {
            id: string;
            inserted: boolean;
          };
        const id = `m-${++seq}`;
        mentions.push({ id, ...r });
        return { id, ...r, inserted: true };
      }),
    openIncidents: async () => [...incidents.values()],
    pendingCount: async () => retry.size,
    applyMention: async (mentionId, change) => {
      const m = mentions.find((x) => x["id"] === mentionId)!;
      if (m["incident_id"])
        return { id: m["incident_id"] as string, applied: false };
      if ("incidentId" in change) {
        const { incidentId: id, update } = change;
        const cur = incidents.get(id)!;
        if (update.unlisted_at === null) unlisted.delete(id);
        incidents.set(id, {
          ...cur,
          ...update,
          mention_count: cur.mention_count + 1,
        });
        m["incident_id"] = id;
        return { id, applied: true };
      }
      const row = change.insert;
      const id = `inc-${++seq}`;
      incidents.set(id, {
        ...row,
        id,
        area_id: row.commune_id ?? row.wilaya_id,
        mention_count: 1,
      });
      m["incident_id"] = id;
      return { id, applied: true };
    },
    retryableDocuments: async () => [...retry.values()],
    recordExtractionFailure: async (documentId) => {
      const doc = stored.get(documentId);
      if (doc) retry.set(documentId, doc);
    },
    clearExtractionFailure: async (documentId) => {
      retry.delete(documentId);
    },
    confirmClusters: async (rows) => {
      for (const row of rows) confirmed.push(row);
      return rows.length;
    },
    listedIncidents: async (before) =>
      [...incidents.values()]
        .filter((i) => !unlisted.has(i.id) && i.last_reported_at < before)
        .map((i) => ({ id: i.id, area_id: i.area_id })),
    markUnlisted: async (ids, asOf) => {
      for (const id of ids) unlisted.set(id, asOf);
    },
    insertAdvice: async (row) => {
      advice.push(row);
    },
  };
  return {
    store,
    documents,
    mentions,
    incidents,
    unlisted,
    confirmed,
    retry,
    advice,
  };
}

function deps(
  posts: TelegramPost[],
  store: TextSourceStore,
  llm: TextSourcePipelineDependencies["extractLlm"] = async () => ({
    skipped: true,
    reason: "no_api_key",
  }),
): TextSourcePipelineDependencies {
  return {
    store,
    fetchPosts: async () => posts,
    extractLlm: llm,
    readSituation: async () => ({
      disposition: "other",
      items: [],
      advice: null,
      rejected: 0,
    }),
    now: () => new Date("2026-09-02T23:00:00Z"),
  };
}

const post = (id: string, publishedAt: string, text: string): TelegramPost => ({
  externalId: `DGPCDZ/${id}`,
  publishedAt,
  text,
  url: `https://t.me/DGPCDZ/${id}`,
});

const skikda2 = "⏮️⏮️ ولاية سكيكدة 02";
// the shape of DGPCDZ/7158: ongoing fires, notable communes named, no distribution section
const undistributed = `🔴 الحالة العامة لحرائق الغطاء النباتي، المحاصيل الزراعية، واحات النخيل، وأحزمة التبن ليوم 02 سبتمبر 2026 إلى غاية الساعة 13سا00د
🔴 العدد الإجمالي للحرائق: 07
🔴 عدد الحرائق التي تم إخمادها: 02
🔴 عدد الحرائق المتواصلة: 05
🔴 أهم الحرائق:
🚨 ولاية سكيكدة:
- بلدية عزابة: حريق غابة مهم مع وجود سكنات.
- بلدية عين زويت: حريق غابة في منطقة وعرة.
#الحماية_المدنية_الجزائرية`;
const twoFires =
  "✅⏮️ حريق ببلدية عزابة، العملية متواصلة...\n✅⏮️ حريق ببلدية عين زويت، العملية متواصلة...";

describe("runTextSource", () => {
  it.each(["failure", "missing-key"])(
    "does not unlist existing incidents after %s",
    async (mode) => {
      const f = memoryStore();
      await runTextSourceWith(
        "dgpc_telegram",
        deps(
          [
            post(
              "audit-1",
              "2026-09-02T08:05:00Z",
              bulletin("07", skikda2, twoFires),
            ),
          ],
          f.store,
          llmWith(mention({}), mention({ commune: "عين زويت" })),
        ),
      );
      const result = await runTextSourceWith(
        "dgpc_telegram",
        deps(
          [
            post(
              "audit-2",
              "2026-09-02T12:05:00Z",
              bulletin("13", skikda2, twoFires),
            ),
          ],
          f.store,
          async () => {
            if (mode === "failure") throw new Error("provider unavailable");
            return { skipped: true, reason: "no_api_key" };
          },
        ),
      );
      expect(f.unlisted.size).toBe(0);
      expect(result.error).toBeTruthy();
    },
  );
  it("recovers persisted documents after a pre-extraction interruption", async () => {
    const f = memoryStore(),
      load = f.store.loadGazetteer;
    f.store.loadGazetteer = async () => {
      throw new Error("gazetteer unavailable");
    };
    const p = post(
      "audit-3",
      "2026-09-02T12:05:00Z",
      bulletin("13", skikda2, twoFires),
    );
    const input = {
      ...deps([p], f.store, llmWith(mention({}))),
      fetchPosts: async (_source: unknown, known: Set<string>) =>
        known.has(p.externalId) ? [] : [p],
    };
    await expect(runTextSourceWith("dgpc_telegram", input)).rejects.toThrow(
      "gazetteer unavailable",
    );
    f.store.loadGazetteer = load;
    expect(
      (await runTextSourceWith("dgpc_telegram", input)).mentions,
    ).toBeGreaterThan(0);
  });
  it("turns the model's mentions into resolved mentions and one incident per commune", async () => {
    const { store, mentions, incidents } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("1", "2026-09-02T12:10:00Z", bulletin("13", skikda2, twoFires))],
        store,
        llmWith(mention({}), mention({ commune: "عين زويت" })),
      ),
    );
    expect(result).toMatchObject({
      fetched: 1,
      stored: 1,
      mentions: 2,
      resolved: 2,
      unresolved: 0,
      gated: 0,
      incidentsCreated: 2,
      incidentsUpdated: 0,
      llmSkipped: false,
    });
    expect(incidents.size).toBe(2);
    const azzaba = [...incidents.values()].find(
      (i) => i.commune_id === AZZABA,
    )!;
    expect(azzaba).toMatchObject({
      status: "ongoing",
      precision: "commune",
      authority_tier: "national",
      as_of: "2026-09-02T12:00:00.000Z",
    });
    expect(mentions.every((m) => m["extractor"] === "llm")).toBe(true);
    expect(mentions.every((m) => typeof m["incident_id"] === "string")).toBe(
      true,
    );
  });

  it("attaches a later report to the same incident and updates its status", async () => {
    const { store, incidents } = memoryStore();
    await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "1",
            "2026-09-02T12:10:00Z",
            bulletin("13", "⏮️⏮️ ولاية سكيكدة 01", twoFires, 1),
          ),
        ],
        store,
        llmWith(mention({})),
      ),
    );
    const second = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "2",
            "2026-09-02T19:05:00Z",
            bulletin(
              "20",
              "⏮️⏮️ لا يوجد (00)",
              "✅⏮️ حريق ببلدية عزابة، تم إخماده نهائياً...",
              0,
            ),
          ),
        ],
        store,
        llmWith(mention({ status: "extinguished" })),
      ),
    );
    expect(second).toMatchObject({ incidentsCreated: 0, incidentsUpdated: 1 });
    const only = [...incidents.values()];
    expect(only).toHaveLength(1);
    expect(only[0]).toMatchObject({ status: "extinguished", mention_count: 2 });
  });

  it("keeps a document for retry when the model is skipped for lack of a key", async () => {
    const { store, retry, mentions } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("1", "2026-09-02T12:10:00Z", bulletin("13", skikda2, twoFires))],
        store,
      ),
    );
    expect(result).toMatchObject({
      mentions: 0,
      unresolved: 1,
      llmSkipped: true,
    });
    expect(mentions).toHaveLength(0);
    expect(retry.size).toBe(1);
  });

  it("counts a commune the gazetteer cannot place as unresolved", async () => {
    const { store } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("1", "2026-09-02T12:10:00Z", bulletin("13", skikda2, twoFires))],
        store,
        llmWith(mention({ commune: "قرية مجهولة" })),
      ),
    );
    expect(result).toMatchObject({ mentions: 1, unresolved: 1 });
  });

  it("resolves a commune nationally when the hinted wilaya does not hold it", async () => {
    const { store, incidents } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "1",
            "2026-09-02T12:10:00Z",
            bulletin(
              "13",
              "⏮️⏮️ ولاية باتنة 01",
              "✅⏮️ حريق ببلدية بلدة بعيدة، العملية متواصلة...",
            ),
          ),
        ],
        store,
        llmWith(mention({ commune: "بلدة بعيدة" })),
      ),
    );
    expect(result).toMatchObject({ mentions: 1, incidentsCreated: 1 });
    expect([...incidents.values()][0]).toMatchObject({
      commune_id: FAR,
      wilaya_id: OTHER,
    });
  });

  it("stores but neither extracts nor calls the model for posts that are not land fires", async () => {
    const { store, mentions } = memoryStore();
    let calls = 0;
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "9",
            "2026-09-02T05:00:00Z",
            "#الحرائق_الحضرية_والصناعية\nحريق عدادات كهربائية بولاية #عين_الدفلى",
          ),
        ],
        store,
        async () => {
          calls += 1;
          return { skipped: false, mentions: [] };
        },
      ),
    );
    expect(result).toMatchObject({ stored: 1, mentions: 0, skippedPosts: 1 });
    expect(mentions).toHaveLength(0);
    expect(calls).toBe(0);
  });
});

describe("distribution gate", () => {
  it("uses a verified former wilaya for counting while retaining the current commune parent", async () => {
    const f = memoryStore();
    const original = f.store.loadGazetteer;
    f.store.loadGazetteer = async () => ({
      ...(await original()),
      formerWilayaByCommune: new Map([[FAR, SKIKDA]]),
    });
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "boundary",
            "2026-09-02T12:10:00Z",
            bulletin(
              "13",
              "⏮️⏮️ ولاية سكيكدة 01",
              "حريق ببلدية بلدة بعيدة، العملية متواصلة...",
              1,
            ),
          ),
        ],
        f.store,
        llmWith(mention({ commune: "بلدة بعيدة" })),
      ),
    );
    expect(result).toMatchObject({ mentions: 1, unresolved: 0, gated: 0 });
    expect(f.retry.size).toBe(0);
    expect(f.mentions[0]).toMatchObject({ commune_id: FAR, wilaya_id: OTHER });
    expect(f.mentions[0]).not.toHaveProperty("distribution_wilaya_id");
  });

  it("does not accept an unverified reporting-wilaya mismatch", async () => {
    const f = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "wrong-boundary",
            "2026-09-02T12:10:00Z",
            bulletin(
              "13",
              "⏮️⏮️ ولاية سكيكدة 01",
              "حريق ببلدية بلدة بعيدة، العملية متواصلة...",
              1,
            ),
          ),
        ],
        f.store,
        llmWith(mention({ commune: "بلدة بعيدة" })),
      ),
    );
    expect(result.gated).toBe(1);
    expect(f.retry.size).toBe(1);
    expect(f.confirmed).toHaveLength(0);
  });

  it("drops a commune in a wilaya the bulletin's distribution does not list", async () => {
    const { store, mentions } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("1", "2026-09-02T12:10:00Z", bulletin("13", skikda2, twoFires))],
        store,
        llmWith(
          mention({}),
          mention({ wilaya: "باتنة", commune: "بلدة بعيدة" }),
        ),
      ),
    );
    expect(result).toMatchObject({ mentions: 2, gated: 1 });
    expect(mentions.map((m) => m["commune_id"])).toEqual([AZZABA, null]);
  });

  it("falls back to wilaya precision when the model names more communes than the distribution counts", async () => {
    const { store, mentions, incidents } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "1",
            "2026-09-02T12:10:00Z",
            bulletin("13", "⏮️⏮️ ولاية سكيكدة 01", twoFires),
          ),
        ],
        store,
        llmWith(mention({}), mention({ commune: "عين زويت" })),
      ),
    );
    expect(result).toMatchObject({ mentions: 1, gated: 2 });
    expect(mentions[0]).toMatchObject({
      wilaya_id: SKIKDA,
      commune_id: null,
      precision: "wilaya",
      fire_count: 1,
      status: "ongoing",
      extractor: "template",
      evidence: "⏮️⏮️ ولاية سكيكدة 01",
    });
    expect(incidents.size).toBe(1);
  });

  it("fills the distribution's remainder with a wilaya-level mention", async () => {
    const { store, mentions, incidents } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("1", "2026-09-02T12:10:00Z", bulletin("13", skikda2, twoFires))],
        store,
        llmWith(mention({})),
      ),
    );
    expect(result).toMatchObject({
      mentions: 2,
      gated: 0,
      incidentsCreated: 2,
    });
    expect(mentions.map((m) => [m["commune_id"], m["fire_count"]])).toEqual([
      [AZZABA, 1],
      [null, 1],
    ]);
    expect([...incidents.values()].map((i) => i.precision)).toEqual([
      "commune",
      "wilaya",
    ]);
  });

  it("ignores the model's own commune-less distribution mentions", async () => {
    const { store, mentions } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("1", "2026-09-02T12:10:00Z", bulletin("13", skikda2, twoFires))],
        store,
        llmWith(
          mention({
            commune: null,
            count: 2,
            evidence: "⏮️⏮️ ولاية سكيكدة 02",
          }),
          mention({}),
          mention({ commune: "عين زويت" }),
        ),
      ),
    );
    expect(result).toMatchObject({ mentions: 2, gated: 0 });
    expect(result.error).toBeUndefined();
    expect(mentions.every((m) => m["commune_id"] !== null)).toBe(true);
  });

  it.each([
    [23, 0],
    [5, 1],
  ])(
    "a location-less mention counting %i fires on a quiet bulletin leaves %i unresolved",
    async (count, unresolved) => {
      const { store, mentions, retry } = memoryStore();
      const evidence =
        "🔴 العدد الإجمالي للحرائق: 23\n🔴 عدد الحرائق التي تم إخمادها: 23";
      const located = { wilaya: null, commune: null, place: null };
      const result = await runTextSourceWith(
        "dgpc_telegram",
        deps(
          [
            post(
              "7155",
              "2026-09-28T06:36:56Z",
              "🔴 الحالة العامة لحرائق الغطاء النباتي، المحاصيل الزراعية، واحات نخيل، وأحزمة التبن من 27 سبتمبر إلى 28 سبتمبر 2026 على الساعة 07سا00د\n🔴 العدد الإجمالي للحرائق: 23\n🔴 عدد الحرائق التي تم إخمادها: 23\n🔴 عدد الحرائق المتواصلة: 00\n🔴 أهم الحرائق: لا يوجد.\n#الحماية_المدنية_الجزائرية",
            ),
          ],
          store,
          llmWith(
            mention({ ...located, status: "extinguished", count, evidence }),
            mention({
              ...located,
              kind: "agricultural",
              status: "extinguished",
              count: 23,
              evidence,
            }),
          ),
        ),
      );
      expect(result.unresolved).toBe(unresolved);
      expect(retry.size).toBe(unresolved);
      expect(mentions).toHaveLength(0);
    },
  );

  it("lets an extinguished mention through without a distribution entry", async () => {
    const { store, mentions } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "1",
            "2026-09-02T12:10:00Z",
            bulletin(
              "13",
              "⏮️⏮️ لا يوجد (00)",
              "✅⏮️ حريق ببلدية عزابة، تم إخماده",
            ),
          ),
        ],
        store,
        llmWith(mention({ status: "extinguished" })),
      ),
    );
    expect(result).toMatchObject({ mentions: 1, gated: 0 });
    expect(mentions[0]).toMatchObject({
      commune_id: AZZABA,
      status: "extinguished",
    });
  });

  it("gates every ongoing commune when the bulletin says no fire is ongoing", async () => {
    const { store, mentions } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "1",
            "2026-09-02T12:10:00Z",
            bulletin("13", "⏮️⏮️ لا يوجد (00)", twoFires, 0),
          ),
        ],
        store,
        llmWith(mention({})),
      ),
    );
    expect(result).toMatchObject({ mentions: 0, gated: 1 });
    expect(mentions).toHaveLength(0);
  });

  it("caps ongoing communes by the header total when the distribution is unreadable", async () => {
    const { store } = memoryStore();
    const within = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "1",
            "2026-09-02T12:10:00Z",
            bulletin("13", "⏮️⏮️ موزعة على ولايتين", twoFires, 2),
          ),
        ],
        store,
        llmWith(mention({}), mention({ commune: "عين زويت" })),
      ),
    );
    expect(within).toMatchObject({ mentions: 2, gated: 0 });
    const over = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "2",
            "2026-09-02T14:10:00Z",
            bulletin("15", "⏮️⏮️ موزعة على ولايتين", twoFires, 1),
          ),
        ],
        store,
        llmWith(mention({}), mention({ commune: "عين زويت" })),
      ),
    );
    expect(over).toMatchObject({ mentions: 0, gated: 2 });
  });

  it("distrusts a distribution whose counts exceed the header total", async () => {
    const { store, mentions } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "1",
            "2026-09-02T12:10:00Z",
            bulletin("13", skikda2, twoFires, 1),
          ),
        ],
        store,
        llmWith(mention({})),
      ),
    );
    expect(result).toMatchObject({ mentions: 1, gated: 0 });
    expect(mentions.map((m) => m["commune_id"])).toEqual([AZZABA]);
  });

  it("a monitoring commune consumes its wilaya's count like an ongoing one", async () => {
    const { store, mentions } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "1",
            "2026-09-02T12:10:00Z",
            bulletin("13", "⏮️⏮️ ولاية سكيكدة 01", twoFires, 1),
          ),
        ],
        store,
        llmWith(mention({ status: "monitoring" })),
      ),
    );
    expect(result).toMatchObject({ mentions: 1, gated: 0 });
    expect(mentions[0]).toMatchObject({
      commune_id: AZZABA,
      status: "monitoring",
    });
  });

  it("does not gate a standalone incident post", async () => {
    const { store } = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "11",
            "2026-09-02T14:05:00Z",
            "حريق أحراش ببلدية بلدة بعيدة، ولاية باتنة، العملية متواصلة...",
          ),
        ],
        store,
        llmWith(mention({ wilaya: "باتنة", commune: "بلدة بعيدة" })),
      ),
    );
    expect(result).toMatchObject({
      mentions: 1,
      gated: 0,
      incidentsCreated: 1,
    });
  });
});

describe("runTextSource LLM failures", () => {
  it("isolates a malformed LLM completion to its document", async () => {
    const { store, mentions } = memoryStore();
    let calls = 0;
    const flaky: TextSourcePipelineDependencies["extractLlm"] = async () => {
      calls += 1;
      if (calls === 1)
        throw new Error("llm extraction returned non-JSON content");
      return { skipped: false, mentions: [mention({})] };
    };
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post("20", "2026-09-02T09:00:00Z", bulletin("07", skikda2, twoFires)),
          post("21", "2026-09-02T09:05:00Z", bulletin("07", skikda2, twoFires)),
        ],
        store,
        flaky,
      ),
    );
    expect(result.error).toMatch(/incomplete llm extraction/);
    expect(result).toMatchObject({ llmFailed: 1, unresolved: 2, mentions: 2 });
    expect(mentions).toHaveLength(2);

    const dead = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("22", "2026-09-02T09:10:00Z", bulletin("13", skikda2, twoFires))],
        store,
        async () => {
          throw new Error("openrouter 502");
        },
      ),
    );
    expect(dead.error).toMatch(/incomplete llm extraction: openrouter 502/);
  });
  it("spends no attempt and stops the pass while the model provider is unavailable", async () => {
    const f = memoryStore();
    const recorded: string[] = [];
    f.store.recordExtractionFailure = async (id) => {
      recorded.push(id);
    };
    let calls = 0;
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post("30", "2026-09-02T09:00:00Z", bulletin("07", skikda2, twoFires)),
          post("31", "2026-09-02T09:05:00Z", bulletin("07", skikda2, twoFires)),
        ],
        f.store,
        async () => {
          calls += 1;
          throw new LlmUnavailable("openrouter 402: more credits required");
        },
      ),
    );
    expect(calls).toBe(1);
    expect(recorded).toEqual([]);
    expect(f.retry.size).toBe(2);
    expect(result.error).toMatch(/incomplete llm extraction: openrouter 402/);
  });
});

describe("bulletin coverage", () => {
  it("unlists an incident the next full bulletin does not name, and re-lists it when it returns", async () => {
    const { store, incidents, unlisted } = memoryStore();
    const both = llmWith(mention({}), mention({ commune: "عين زويت" }));

    const first = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("1", "2026-09-02T08:05:00Z", bulletin("07", skikda2, twoFires))],
        store,
        both,
      ),
    );
    expect(first.incidentsCreated).toBe(2);
    expect(first.incidentsUnlisted).toBe(0);

    const second = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "2",
            "2026-09-02T14:05:00Z",
            bulletin(
              "13",
              "⏮️⏮️ ولاية سكيكدة 01",
              "حريق ببلدية عزابة، العملية متواصلة...",
              1,
            ),
          ),
        ],
        store,
        llmWith(mention({})),
      ),
    );
    expect(second.incidentsUnlisted).toBe(1);
    const dropped = [...incidents.values()].find(
      (i) => i.commune_id === AIN_ZOUIT,
    )!;
    expect(unlisted.has(dropped.id)).toBe(true);
    expect(dropped.status).toBe("ongoing");

    const third = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("3", "2026-09-02T18:05:00Z", bulletin("17", skikda2, twoFires))],
        store,
        both,
      ),
    );
    expect(third.incidentsUnlisted).toBe(0);
    expect(unlisted.has(dropped.id)).toBe(false);
  });

  it("a single-incident post unlists nothing", async () => {
    const { store } = memoryStore();
    await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "10",
            "2026-09-02T08:05:00Z",
            bulletin("07", "⏮️⏮️ ولاية سكيكدة 01", twoFires, 1),
          ),
        ],
        store,
        llmWith(mention({})),
      ),
    );
    const run = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "11",
            "2026-09-02T14:05:00Z",
            "حريق أحراش ببلدية عين زويت، ولاية سكيكدة، العملية متواصلة...",
          ),
        ],
        store,
        llmWith(mention({ commune: "عين زويت" })),
      ),
    );
    expect(run.incidentsUnlisted).toBe(0);
  });
});

describe("extraction retry", () => {
  it("re-extracts a document whose completion failed", async () => {
    const { store, mentions, retry } = memoryStore();
    let calls = 0;
    const flaky: TextSourcePipelineDependencies["extractLlm"] = async () => {
      calls += 1;
      if (calls === 1) throw new Error("openrouter 502");
      return {
        skipped: false,
        mentions: [mention({}), mention({ commune: "عين زويت" })],
      };
    };
    const first = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("30", "2026-09-02T08:05:00Z", bulletin("07", skikda2, twoFires))],
        store,
        flaky,
      ),
    );
    expect(first).toMatchObject({ llmFailed: 1, mentions: 0 });
    expect(retry.size).toBe(1);

    const second = await runTextSourceWith(
      "dgpc_telegram",
      deps([], store, flaky),
    );
    expect(second).toMatchObject({ retried: 1, llmFailed: 0, mentions: 2 });
    expect(retry.size).toBe(0);
    expect(mentions.map((m) => m["commune_id"])).toEqual([AZZABA, AIN_ZOUIT]);
  });

  it("keeps the retry marker when inserting the retried mentions fails", async () => {
    const { store, retry } = memoryStore();
    await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("50", "2026-09-02T08:05:00Z", bulletin("07", skikda2, twoFires))],
        store,
        async () => {
          throw new Error("openrouter 502");
        },
      ),
    );
    expect(retry.size).toBe(1);
    const failing: TextSourceStore = {
      ...store,
      insertMentions: async () => {
        throw new Error("insert failed");
      },
    };
    await expect(
      runTextSourceWith(
        "dgpc_telegram",
        deps([], failing, llmWith(mention({}))),
      ),
    ).rejects.toThrow("insert failed");
    expect(retry.size).toBe(1);
  });

  it("does not re-apply an old bulletin's coverage when it is retried", async () => {
    const { store, retry } = memoryStore();
    const failing: TextSourcePipelineDependencies["extractLlm"] = async () => {
      throw new Error("openrouter 502");
    };
    await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("40", "2026-09-02T08:05:00Z", bulletin("07", skikda2, twoFires))],
        store,
        failing,
      ),
    );
    expect(retry.size).toBe(1);
    const again = await runTextSourceWith(
      "dgpc_telegram",
      deps([], store, failing),
    );
    expect(again.incidentsUnlisted).toBe(0);
  });

  it("marks a document for retry when its commune fails gazetteer resolution, and clears it once an alias lets a later pass resolve the same name", async () => {
    const { store, mentions, retry } = memoryStore();
    let calls = 0;
    const improving: TextSourcePipelineDependencies["extractLlm"] =
      async () => {
        calls += 1;
        return {
          skipped: false,
          mentions: [
            mention({ commune: calls === 1 ? "قرية مجهولة" : "عين زويت" }),
          ],
        };
      };
    const first = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "60",
            "2026-09-02T08:05:00Z",
            bulletin("07", "⏮️⏮️ ولاية سكيكدة 01", twoFires, 1),
          ),
        ],
        store,
        improving,
      ),
    );
    expect(first).toMatchObject({ unresolved: 1, llmFailed: 0 });
    expect(retry.size).toBe(1);

    const second = await runTextSourceWith(
      "dgpc_telegram",
      deps([], store, improving),
    );
    expect(second).toMatchObject({ retried: 1, mentions: 1, unresolved: 0 });
    expect(retry.size).toBe(0);
    expect(mentions.some((m) => m["commune_id"] === AIN_ZOUIT)).toBe(true);
  });

  it("does not mark a fully-resolved document for retry", async () => {
    const { store, retry } = memoryStore();
    await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("61", "2026-09-02T08:05:00Z", bulletin("07", skikda2, twoFires))],
        store,
        llmWith(mention({}), mention({ commune: "عين زويت" })),
      ),
    );
    expect(retry.size).toBe(0);
  });
});

describe("durable interpretation completion", () => {
  it.each([
    {
      number: "7069",
      asOf: "2026-09-18T19:00:00.000Z",
      interpreted: [
        mention({
          wilaya: "بسكرة",
          commune: null,
          evidence: "⏮️⏮️ ولاية بسكرة 01 (حريق واحة نخيل)",
        }),
      ],
      expected: [{ wilaya_id: "07", commune_id: null }],
    },
    {
      number: "6998",
      asOf: "2026-09-07T06:00:00.000Z",
      interpreted: [
        mention({
          wilaya: "سطيف",
          commune: "عين الفراج",
          place: "قرية منداس",
          evidence:
            "حريق أشجار مثمرة وأحراش ببلدية عين الفراج بالمكان المسمى قرية منداس",
        }),
      ],
      expected: [{ wilaya_id: "19", commune_id: "1913" }],
    },
    {
      number: "6872",
      asOf: "2026-08-30T06:00:00.000Z",
      interpreted: [
        mention({
          wilaya: "باتنة",
          commune: "عزيل عبد القادر",
          kind: "agricultural",
          evidence: "حريق أحزمة تبن بمشتة العيضات ببلدية عزيل عبد القادر.",
        }),
        mention({
          wilaya: "سطيف",
          commune: "بابور",
          evidence:
            "حريق أدغال و احراش ، بالمكان المسمى واد عافرة و لارباع، ببلدية بابور، في أخر مراحل الإخماد.",
        }),
      ],
      expected: [
        { wilaya_id: "60", commune_id: "0515" },
        { wilaya_id: "19", commune_id: "1916" },
      ],
    },
    {
      number: "7012",
      asOf: "2026-09-10T06:00:00.000Z",
      interpreted: [
        mention({
          wilaya: "البويرة",
          commune: "الصحاريج",
          evidence:
            "حريق غابة ببلدية الصحاريج، عملية معالجة بؤر الحرائق وبقايا الجمر متواصلة...",
        }),
      ],
      expected: [{ wilaya_id: "10", commune_id: "1030" }],
    },
  ])(
    "recovers captured quarantined DGPC/$number while retaining its historical event time",
    async ({ number, asOf, interpreted, expected }) => {
      const captured = recoveryPosts.find(
        (p) => p.external_id === `DGPCDZ/${number}`,
      )!;
      for (const m of interpreted) expect(captured.body).toContain(m.evidence);
      const f = memoryStore();
      // Names, current parents and commune codes verified against the production gazetteer.
      f.store.loadGazetteer = async () => ({
        wilayas: [
          { id: "07", name_ar: "بسكرة" },
          { id: "05", name_ar: "باتنة" },
          { id: "19", name_ar: "سطيف" },
          { id: "10", name_ar: "البويرة" },
          { id: "60", name_ar: "بريكة" },
        ],
        communesByWilaya: new Map([
          ["07", [{ id: "0701", name_ar: "بسكرة", aliases: [] }]],
          [
            "19",
            [
              { id: "1913", name_ar: "عين لقراج", aliases: ["عين الفراج"] },
              { id: "1916", name_ar: "بابور", aliases: [] },
            ],
          ],
          ["10", [{ id: "1030", name_ar: "الصهاريج", aliases: ["الصحاريج"] }]],
          ["60", [{ id: "0515", name_ar: "عزيل عبد القادر", aliases: [] }]],
        ]),
        formerWilayaByCommune: new Map([["0515", "05"]]),
      });
      const result = await runTextSourceWith("dgpc_telegram", {
        ...deps(
          [post(number, captured.published_at, captured.body)],
          f.store,
          llmWith(...interpreted),
        ),
        now: () => new Date("2026-09-21T14:00:00Z"),
      });
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({
        mentions: expected.length,
        unresolved: 0,
        gated: 0,
      });
      expect(f.retry.size).toBe(0);
      expect(f.mentions).toEqual(
        expected.map((location) =>
          expect.objectContaining({ ...location, as_of: asOf }),
        ),
      );
      expect([...f.incidents.values()]).toEqual(
        expected.map(() =>
          expect.objectContaining({ as_of: asOf, last_reported_at: asOf }),
        ),
      );
      expect(f.unlisted.size).toBe(0);
      if (number === "7069") expect(f.confirmed).toHaveLength(0);
      const before = f.incidents.size;
      await runTextSourceWith("dgpc_telegram", {
        ...deps([], f.store, llmWith(...interpreted)),
        now: () => new Date("2026-09-21T14:00:00Z"),
      });
      expect(f.incidents.size).toBe(before);
    },
  );
  it("reports exhausted processing separately from a successful collection", async () => {
    const f = memoryStore();
    f.store.pendingCount = async () => 6;
    f.store.retryableDocuments = async () => [];
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps([], f.store, llmWith()),
    );
    expect(result).toMatchObject({ pending: 6, fetched: 0, retried: 0 });
    expect(result.error).toBeUndefined();
  });
  it("accepts official wilaya-only evidence without inventing communes or declaring absence", async () => {
    const f = memoryStore();
    const captured = recoveryPosts.find(
      (p) => p.external_id === "DGPCDZ/6876",
    )!;
    const original = f.store.loadGazetteer;
    f.store.loadGazetteer = async () => ({
      ...(await original()),
      wilayas: ["سكيكدة", "سطيف", "المدية"].map((name_ar) => ({
        id: name_ar,
        name_ar,
      })),
    });
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post(captured.external_id, captured.published_at, captured.body)],
        f.store,
        llmWith(
          ...["سكيكدة", "سطيف", "المدية"].map((wilaya) =>
            mention({
              wilaya,
              commune: null,
              evidence: `⏮️⏮️ ولاية #${wilaya} 01`,
            }),
          ),
        ),
      ),
    );
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ mentions: 3, unresolved: 0 });
    expect(f.retry.size).toBe(0);
    expect(f.confirmed).toHaveLength(0);
    expect(f.unlisted.size).toBe(0);
    expect(f.mentions.every((m) => m["commune_id"] === null)).toBe(true);
  });
  it.each([
    ["both named communes", [mention({}), mention({ commune: "عين زويت" })], 0],
    ["one named commune", [mention({})], 1],
    [
      "more fires than the header",
      [mention({ count: 6 }), mention({ commune: "عين زويت" })],
      1,
    ],
  ])(
    "retries an undistributed bulletin only when the model misses a named commune (%s)",
    async (_label, mentions, retries) => {
      const f = memoryStore();
      const result = await runTextSourceWith(
        "dgpc_telegram",
        deps(
          [post("undistributed", "2026-09-02T12:10:00Z", undistributed)],
          f.store,
          llmWith(...mentions),
        ),
      );
      expect(f.retry.size).toBe(retries);
      expect(result.mentions).toBe(mentions.length);
      expect(f.unlisted.size).toBe(0);
    },
  );
  it("never unlists from a bulletin that publishes no distribution", async () => {
    const { store, unlisted } = memoryStore();
    await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("1", "2026-09-02T08:05:00Z", bulletin("07", skikda2, twoFires))],
        store,
        llmWith(mention({}), mention({ commune: "عين زويت" })),
      ),
    );
    const oneOngoing = undistributed
      .replace("للحرائق: 07", "للحرائق: 03")
      .replace("المتواصلة: 05", "المتواصلة: 01")
      .replace(/\n- بلدية عين زويت[^\n]*/, "");
    const second = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [post("2", "2026-09-02T14:05:00Z", oneOngoing)],
        store,
        llmWith(mention({})),
      ),
    );
    expect(second.error).toBeUndefined();
    expect(second.incidentsUnlisted).toBe(0);
    expect(unlisted.size).toBe(0);
  });
  it("retains incomplete bulletin interpretation instead of declaring success", async () => {
    const f = memoryStore();
    const result = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "incomplete",
            "2026-09-02T12:10:00Z",
            bulletin("13", skikda2, twoFires),
          ),
        ],
        f.store,
        llmWith(),
      ),
    );
    expect(result.error).toMatch(/incomplete/);
    expect(f.retry.size).toBe(1);
    expect(f.unlisted.size).toBe(0);
  });
  it("bounds a pass to five interpretations while retaining all raw documents", async () => {
    const f = memoryStore();
    let calls = 0;
    const posts = Array.from({ length: 8 }, (_, i) =>
      post(
        String(i),
        "2026-09-02T12:10:00Z",
        bulletin("13", skikda2, twoFires),
      ),
    );
    await runTextSourceWith(
      "dgpc_telegram",
      deps(posts, f.store, async () => {
        calls++;
        return {
          skipped: false,
          mentions: [mention({}), mention({ commune: "عين زويت" })],
        };
      }),
    );
    expect(calls).toBe(5);
    expect(f.documents.length).toBe(8);
    expect(f.retry.size).toBe(3);
  });
  it("replays a committed mention after lost acknowledgement without duplicate incidents", async () => {
    const f = memoryStore();
    const apply = f.store.applyMention;
    f.store.applyMention = async (...args) => {
      await apply(...args);
      throw new Error("response lost");
    };
    const input = post(
      "lost",
      "2026-09-02T12:10:00Z",
      bulletin("13", "⏮️⏮️ ولاية سكيكدة 01", twoFires, 1),
    );
    await expect(
      runTextSourceWith(
        "dgpc_telegram",
        deps([input], f.store, llmWith(mention({}))),
      ),
    ).rejects.toThrow("response lost");
    f.store.applyMention = apply;
    const replay = await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [],
        f.store,
        llmWith(
          mention({
            evidence: "different grounded excerpt from immutable document",
          }),
        ),
      ),
    );
    expect(replay.mentions).toBe(0);
    expect(replay.resolved).toBe(1);
    expect(f.mentions).toHaveLength(1);
    expect([...f.incidents.values()].map((i) => i.mention_count)).toEqual([1]);
    expect(f.retry.size).toBe(0);
  });
});

it("never applies absence from contradictory header totals", async () => {
  const f = memoryStore();
  await runTextSourceWith(
    "dgpc_telegram",
    deps(
      [
        post(
          "start",
          "2026-09-02T10:10:00Z",
          bulletin("11", skikda2, twoFires),
        ),
      ],
      f.store,
      llmWith(mention({}), mention({ commune: "عين زويت" })),
    ),
  );
  const contradictory = bulletin("13", "⏮️⏮️ لا يوجد (00)", "", 0).replace(
    /العدد الإجمالي للحرائق: \d+/,
    "العدد الإجمالي للحرائق: 3",
  );
  const result = await runTextSourceWith(
    "dgpc_telegram",
    deps(
      [post("bad", "2026-09-02T12:10:00Z", contradictory)],
      f.store,
      llmWith(),
    ),
  );
  expect(f.unlisted.size).toBe(0);
  expect(result.error).toMatch(/incomplete/);
});

it.each(["historical", "future"])(
  "does not reconcile absence from newly discovered %s bulletins",
  async (mode) => {
    const f = memoryStore();
    await runTextSourceWith(
      "dgpc_telegram",
      deps(
        [
          post(
            "seed",
            "2026-09-02T10:10:00Z",
            bulletin("11", skikda2, twoFires),
          ),
        ],
        f.store,
        llmWith(mention({}), mention({ commune: "عين زويت" })),
      ),
    );
    const empty = post(
      mode,
      "2026-09-03T12:10:00Z",
      bulletin("13", "⏮️⏮️ لا يوجد (00)", "", 0),
    );
    const input = {
      ...deps([empty], f.store, llmWith()),
      now: () =>
        new Date(
          mode === "historical"
            ? "2026-09-05T12:00:00Z"
            : "2026-09-02T23:00:00Z",
        ),
    };
    await runTextSourceWith("dgpc_telegram", input);
    expect(f.unlisted.size).toBe(0);
  },
);

describe("Protection Civile posts beyond fire", () => {
  const situation = (over: Partial<Situation>): Situation => ({
    disposition: "situation_report",
    items: [],
    advice: null,
    rejected: 0,
    ...over,
  });
  const weatherPost = post(
    "20",
    "2026-09-02T19:00:00Z",
    "🚨🚨 الحالة العامة إثر التقلبات الجوية على الساعة 20سا00د – 02/09/2026\nولاية سكيكدة\nبلدية عزابة: الطريق الوطني رقم 44 مقطوع بسبب ارتفاع منسوب مياه الوادي",
  );

  it("files each cut road and flood as its own official incident, never as a fire", async () => {
    const memory = memoryStore();
    let fireCalls = 0;
    const result = await runTextSourceWith("dgpc_telegram", {
      ...deps([weatherPost], memory.store, async () => {
        fireCalls += 1;
        return { skipped: false, mentions: [] };
      }),
      readSituation: async () =>
        situation({
          items: [
            {
              hazard: "road",
              wilaya: "سكيكدة",
              commune: "عزابة",
              place: "الطريق الوطني رقم 44",
              state: "ongoing",
              evidence: "الطريق الوطني رقم 44 مقطوع",
            },
            {
              hazard: "road",
              wilaya: "سكيكدة",
              commune: "عزابة",
              place: "الطريق الولائي رقم 7",
              state: "ongoing",
              evidence: "الطريق الوطني رقم 44 مقطوع",
            },
            {
              hazard: "flood",
              wilaya: "سكيكدة",
              commune: "عين زويت",
              place: null,
              state: "ongoing",
              evidence: "ارتفاع منسوب مياه الوادي",
            },
          ],
        }),
    });
    expect(fireCalls).toBe(0);
    expect(result.incidentsCreated).toBe(3);
    expect([...memory.incidents.values()].map((i) => i.kind).sort()).toEqual([
      "flood",
      "road",
      "road",
    ]);
    expect(memory.confirmed).toEqual([]);
  });

  it("keeps the authority's advice with the wilayas it names", async () => {
    const memory = memoryStore();
    await runTextSourceWith("dgpc_telegram", {
      ...deps([weatherPost], memory.store),
      readSituation: async () =>
        situation({
          disposition: "weather_relay",
          advice: {
            text: "يُرجى توخي الحيطة والحذر أثناء السياقة",
            wilayas: ["سكيكدة", "ولاية مجهولة"],
            validFrom: "2026-09-03T06:00:00+01:00",
            validTo: "2026-09-03T21:00:00+01:00",
          },
        }),
    });
    expect(memory.advice).toEqual([
      expect.objectContaining({
        advice: "يُرجى توخي الحيطة والحذر أثناء السياقة",
        wilayaIds: [SKIKDA],
        validFrom: "2026-09-03T06:00:00+01:00",
      }),
    ]);
  });

  it("dates undated advice from its post, not from when it was read", async () => {
    const memory = memoryStore();
    await runTextSourceWith("dgpc_telegram", {
      ...deps([weatherPost], memory.store),
      now: () => new Date("2026-09-12T23:00:00Z"),
      readSituation: async () =>
        situation({
          disposition: "weather_relay",
          advice: {
            text: "يُرجى توخي الحيطة والحذر",
            wilayas: ["سكيكدة"],
            validFrom: null,
            validTo: null,
          },
        }),
    });
    const validFrom = memory.advice[0]?.["validFrom"] as string;
    expect(Date.parse(validFrom)).toBeLessThanOrEqual(
      Date.parse("2026-09-02T19:00:00Z"),
    );
  });

  it("publishes nothing from an accident that is over", async () => {
    const memory = memoryStore();
    const result = await runTextSourceWith("dgpc_telegram", {
      ...deps([weatherPost], memory.store),
      readSituation: async () => situation({ disposition: "retrospective" }),
    });
    expect(result).toMatchObject({ mentions: 0, skippedPosts: 1 });
    expect(memory.incidents.size).toBe(0);
    expect(memory.retry.size).toBe(0);
  });

  it("hands a fire the router missed to the fire extractor", async () => {
    const memory = memoryStore();
    const result = await runTextSourceWith("dgpc_telegram", {
      ...deps([weatherPost], memory.store, llmWith(mention({}))),
      readSituation: async () => situation({ disposition: "fire" }),
    });
    expect(result.incidentsCreated).toBe(1);
    expect([...memory.incidents.values()][0]?.kind).toBe("vegetation");
  });

  it("keeps a post for retry when reading it fails", async () => {
    const memory = memoryStore();
    const result = await runTextSourceWith("dgpc_telegram", {
      ...deps([weatherPost], memory.store),
      readSituation: async () => {
        throw new Error("situation reader returned non-JSON content");
      },
    });
    expect(result.llmFailed).toBe(1);
    expect(memory.retry.size).toBe(1);
  });
});
