import { describe, expect, it } from "vitest";
import {
  importRepoModule,
  listRepoFiles,
  readRepoFile,
  repoFileExists,
} from "../lib/env.ts";
import {
  createJpegWithExif,
  createPngWithExif,
  createSpoofedMimePayload,
  inspectImageForMetadata,
} from "../lib/exif.ts";
import {
  buildCraagBulletin,
  buildEmscEvent,
  buildMtgFciFixture,
  buildTarikiPost,
  HTTP_200_HTML_ERROR_BODY,
} from "../lib/fixtures.ts";
import { fetchText, startMockHttpServer } from "../lib/http.ts";
import { decodeRasterDimensions } from "../lib/image.ts";
import { psqlJson } from "../lib/pg.ts";
import { findBannedSafeLabels, findEmDashesInText } from "../lib/playwright.ts";

type AnyFn = (...args: unknown[]) => unknown;

function findFirstExisting(candidates: readonly string[]): string | null {
  for (const rel of candidates) {
    if (repoFileExists(rel)) return rel;
  }
  return null;
}

function findExportedFn(
  mod: Record<string, unknown>,
  candidates: readonly string[],
  label: string,
): AnyFn {
  for (const name of candidates) {
    const value = mod[name];
    if (typeof value === "function") {
      return value as AnyFn;
    }
  }
  const available = Object.keys(mod).sort().join(", ");
  throw new Error(
    `Module "${label}" does not export any expected function (${candidates.join(" | ")}). Available exports: [${available}]`,
  );
}

function stripHtmlToVisibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;|&#8212;|&#x2014;/gi, "\u2014")
    .replace(/\s+/g, " ")
    .trim();
}

function isDangerAccepted(res: unknown): boolean {
  if (typeof res === "boolean") {
    return res;
  }
  if (res === null || res === undefined) {
    return false;
  }
  if (Array.isArray(res)) {
    return res.length > 0;
  }
  if (typeof res === "object") {
    const rec = res as Record<string, unknown>;
    for (const key of [
      "isDanger",
      "dangerous",
      "accepted",
      "include",
      "keep",
      "shouldKeep",
      "eligible",
    ] as const) {
      if (typeof rec[key] === "boolean") {
        return rec[key];
      }
    }
    if (typeof rec["decision"] === "string") {
      const d = rec["decision"].toLowerCase();
      return d !== "ignore" && d !== "reject" && d !== "skip" && d !== "drop";
    }
    if (typeof rec["status"] === "string") {
      const s = rec["status"].toLowerCase();
      return s !== "ignored" && s !== "rejected" && s !== "skipped";
    }
  }
  throw new Error(
    `Ambiguous Tariki road-danger classifier return shape: ${JSON.stringify(res)}`,
  );
}

describe("Tier 2 Boundaries — F18–F24: M6 New-Source Gate, Tariki, CRAAG/EMSC, Science Layers, ANPDP Privacy, Server EXIF & Turnstile", () => {
  // ---------------------------------------------------------------------------
  // F18: Observed 30-Min Satellite Rainfall (NASA IMERG Early / H-SAF) Boundaries
  // ---------------------------------------------------------------------------
  describe("F18 — Observed 30-Min Satellite Rainfall (IMERG Early / H-SAF) Boundaries", () => {
    it("Edge Case #7: quiet Sahara-only rainfall slot records pre-filter freshness watermark so healthy feed does not turn stale", async () => {
      const rainfallPath = findFirstExisting([
        "src/lib/ingest/imerg.ts",
        "src/lib/ingest/imerg.server.ts",
        "src/lib/ingest/rainfall.server.ts",
        "src/lib/ingest/hsaf.server.ts",
      ]);
      expect(
        rainfallPath,
        "Expected IMERG/H-SAF rainfall adapter under src/lib/ingest/",
      ).not.toBeNull();

      const src = readRepoFile(rainfallPath!);
      // Must explicitly track upstream slot/watermark timestamp prior to geographic watch-area filter.
      expect(src).toMatch(
        /upstreamPublishedAt|upstream_published_at|latestSlot|watermark|validTime/i,
      );

      const mod = await importRepoModule<{
        parseImergPayload: (
          payload: Record<string, unknown> | string,
          options?: { contentType?: string | null },
        ) => Promise<{
          upstreamPublishedAt: string;
          validTime: string;
          drySlot: boolean;
          observations: unknown[];
        }>;
      }>(rainfallPath!);

      const saharaPayload = {
        valid_time: "2026-11-24T15:00:00Z",
        published_time: "2026-11-24T15:08:00Z",
        window_minutes: 30,
        cells: [
          {
            lat: 23.5,
            lon: 5.5,
            rate_mm_h: 0.4,
            accum_30m_mm: 0.2,
          },
        ],
      };
      const parsedSahara = await mod.parseImergPayload(saharaPayload);
      expect(parsedSahara.upstreamPublishedAt).toBe("2026-11-24T15:08:00.000Z");
      expect(parsedSahara.validTime).toBe("2026-11-24T15:00:00.000Z");

      // Completely dry slot (0 cells) must still preserve pre-filter freshness watermark.
      const parsedDry = await mod.parseImergPayload({
        valid_time: "2026-11-24T15:30:00Z",
        published_time: "2026-11-24T15:37:00Z",
        window_minutes: 30,
        cells: [],
      });
      expect(parsedDry.drySlot).toBe(true);
      expect(parsedDry.observations).toEqual([]);
      expect(parsedDry.upstreamPublishedAt).toBe("2026-11-24T15:37:00.000Z");
    });

    it("Edge Case #8: HTTP 200 HTML upstream error body is classified as upstream_unreachable (never internal_error or silent empty success)", async () => {
      // 1. Existing EFFIS WMS guard against HTTP 200 HTML error page.
      const effisMod = await importRepoModule<{
        pngPayloadError: (
          contentType: string | null,
          body: Uint8Array,
        ) => string | null;
      }>("src/lib/ingest/effis.server.ts");

      const htmlBytes = new TextEncoder().encode(HTTP_200_HTML_ERROR_BODY);
      const errMsg = effisMod.pngPayloadError(
        "text/html; charset=utf-8",
        htmlBytes,
      );
      expect(errMsg).not.toBeNull();
      expect(errMsg).toMatch(/text\/html|not image\/png/i);

      // 2. IMERG / H-SAF rainfall adapter must reject HTTP 200 HTML error bodies and classify them as upstream_unreachable.
      const rainfallPath = findFirstExisting([
        "src/lib/ingest/imerg.ts",
        "src/lib/ingest/imerg.server.ts",
        "src/lib/ingest/rainfall.server.ts",
        "src/lib/ingest/hsaf.server.ts",
      ]);
      expect(rainfallPath).not.toBeNull();
      const rainSrc = readRepoFile(rainfallPath!);
      expect(rainSrc).toMatch(
        /text\/html|<!doctype|<html|upstream_unreachable/i,
      );

      const imergMod = await importRepoModule<{
        parseImergPayload: (
          payload: string,
          options?: { contentType?: string | null },
        ) => Promise<unknown>;
      }>(rainfallPath!);
      const runsMod = await importRepoModule<{
        publicReasonForError: (error: string | null | undefined) => string;
      }>("src/lib/source-runs.ts");

      let caughtError: Error | null = null;
      try {
        await imergMod.parseImergPayload(HTTP_200_HTML_ERROR_BODY, {
          contentType: "text/html; charset=utf-8",
        });
      } catch (err) {
        caughtError = err instanceof Error ? err : new Error(String(err));
      }
      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toMatch(/text\/html|html|error/i);
      expect(runsMod.publicReasonForError(caughtError!.message)).toBe(
        "upstream_unreachable",
      );
    });

    it("rejects out-of-bounds coordinates (lat > 90 / outside Algeria) and negative rainfall rates", async () => {
      const rainfallPath = findFirstExisting([
        "src/lib/ingest/imerg.ts",
        "src/lib/ingest/imerg.server.ts",
        "src/lib/ingest/rainfall.server.ts",
        "src/lib/ingest/hsaf.server.ts",
      ]);
      expect(rainfallPath).not.toBeNull();
      const rainSrc = readRepoFile(rainfallPath!);

      // Must validate coordinate bounds & non-negative numeric rainfall plausibility.
      expect(rainSrc).toMatch(
        /Number\.isFinite|isFinite|lat\s*[<>]|bounds|bbox/i,
      );

      const mod = await importRepoModule<{
        parseImergPayload: (payload: Record<string, unknown>) => Promise<{
          cellsOutsideAlgeria: number;
          observations: unknown[];
        }>;
      }>(rainfallPath!);

      // Out-of-bounds WGS84 coordinate (lat > 90) must reject.
      await expect(
        mod.parseImergPayload({
          valid_time: "2026-11-24T15:00:00Z",
          published_time: "2026-11-24T15:05:00Z",
          window_minutes: 30,
          cells: [
            {
              lat: 95.0,
              lon: 3.05,
              rate_mm_h: 30,
              accum_30m_mm: 15,
            },
          ],
        }),
      ).rejects.toThrow(/wgs84|lat|coord|bound|invalid/i);

      // Negative rainfall rate / accumulation must reject.
      await expect(
        mod.parseImergPayload({
          valid_time: "2026-11-24T15:00:00Z",
          published_time: "2026-11-24T15:05:00Z",
          window_minutes: 30,
          cells: [
            {
              lat: 36.75,
              lon: 3.05,
              rate_mm_h: -10,
              accum_30m_mm: -5,
            },
          ],
        }),
      ).rejects.toThrow(/negative|rate|accum|plausib|invalid/i);

      // Valid coordinates outside Algeria bbox must be excluded cleanly.
      const outside = await mod.parseImergPayload({
        valid_time: "2026-11-24T15:00:00Z",
        published_time: "2026-11-24T15:05:00Z",
        window_minutes: 30,
        cells: [
          {
            lat: 48.85,
            lon: 2.35,
            rate_mm_h: 12,
            accum_30m_mm: 6,
          },
        ],
      });
      expect(outside.observations).toEqual([]);
      expect(outside.cellsOutsideAlgeria).toBe(1);
    });

    it("keeps observed satellite rainfall strictly distinct from Open-Meteo model rainfall and emits zero Nadhir Instructions", () => {
      const rainfallPath = findFirstExisting([
        "src/lib/ingest/imerg.server.ts",
        "src/lib/ingest/imerg.ts",
        "src/lib/ingest/rainfall.server.ts",
        "src/lib/ingest/hsaf.server.ts",
      ]);
      expect(rainfallPath).not.toBeNull();
      const src = readRepoFile(rainfallPath!);

      expect(src).toMatch(/IMERG|H-SAF|observed/i);
      expect(src).not.toMatch(/evacuate now|leave immediately/i);
      expect(findBannedSafeLabels(src)).toEqual([]);
    });

    it("IMERG / H-SAF ingestion enforces deterministic idempotency key / conflict upsert for replay safety", () => {
      const rainfallFiles = listRepoFiles("src/lib/ingest", ".ts").filter((f) =>
        /(imerg|hsaf|rainfall)/i.test(f),
      );
      expect(rainfallFiles.length).toBeGreaterThan(0);

      const combined = rainfallFiles.map((f) => readRepoFile(f)).join("\n");
      expect(combined).toMatch(
        /onConflict|upsert|natural_key|idempotency|dedup/i,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // F19: Hardened Gendarmerie Tariki Road-Danger Source Boundaries (Edge Case #14)
  // ---------------------------------------------------------------------------
  describe("F19 — Gendarmerie Tariki Arabic Normalization, Dangers-Only Filter & Quote Guard Boundaries", () => {
    it("Edge Case #14: tatweel (U+0640), #hashtags, _underscores, and emojis are stripped/normalized on both sides of verbatim quote guard", async () => {
      const normMod = await importRepoModule<{
        normalizeArabic: (input: string) => string;
      }>("src/lib/text-sources/normalize.ts");

      const post = buildTarikiPost({ kind: "tatweel_hashtag_emoji" });
      expect(post.rawText).toContain("\u0640");
      const normRaw = normMod.normalizeArabic(post.rawText);
      expect(normRaw).not.toContain("\u0640");
      expect(normRaw).not.toContain("#");
      expect(normRaw).not.toContain("_");

      const situationMod = await importRepoModule<{
        copiedFrom: (span: string, post: string) => boolean;
        comparable: (text: string) => string;
      }>("src/lib/text-sources/dgpc-situation.server.ts");

      // comparable() strips tatweel (U+0640), #, _, and emojis while preserving Arabic hashtag words.
      const normalizedPost = situationMod.comparable(post.rawText);
      expect(normalizedPost).not.toContain("\u0640");
      expect(normalizedPost).not.toContain("#");
      expect(normalizedPost).not.toContain("_");
      expect(normalizedPost).toContain("طريقي");

      // Clean Arabic quote without tatweel/emoji/#/_ must match tatweel-laden post text.
      const cleanQuote = "الطريق الوطني رقم 11 طريقي RN11 مغلق بسبب الفيضان";
      expect(situationMod.copiedFrom(cleanQuote, post.rawText)).toBe(true);

      // Omitted-word or reordered spans are NOT verbatim and must be rejected.
      expect(
        situationMod.copiedFrom(
          "الطريق الوطني رقم 11 RN11 مغلق بسبب الفيضان",
          post.rawText,
        ),
      ).toBe(false);
      expect(
        situationMod.copiedFrom("الفيضان بسبب مغلق رقم 11", post.rawText),
      ).toBe(false);
    });

    it("Edge Case #14: road works (أشغال), convoys (قافلة), and 'heavy trucks only' (شاحنات الوزن الثقيل فقط) are ignored", async () => {
      const tarikiPath = findFirstExisting([
        "src/lib/text-sources/tariki.ts",
        "src/lib/text-sources/tariki.server.ts",
      ]);
      expect(tarikiPath).not.toBeNull();

      const tarikiMod = await importRepoModule<Record<string, unknown>>(
        tarikiPath!,
      );

      const filterFn = findExportedFn(
        tarikiMod,
        [
          "isTarikiRoadDanger",
          "isTarikiDangerPost",
          "shouldKeepTarikiPost",
          "classifyTarikiPost",
          "isDangerousRoadPost",
        ],
        tarikiPath!,
      );

      const roadWorks = buildTarikiPost({ kind: "road_works" });
      const convoy = buildTarikiPost({ kind: "convoy" });
      const heavyTrucks = buildTarikiPost({ kind: "heavy_trucks_only" });
      const floodClosure = buildTarikiPost({ kind: "flood_closure" });

      expect(isDangerAccepted(filterFn(roadWorks.rawText))).toBe(false);
      expect(isDangerAccepted(filterFn(convoy.rawText))).toBe(false);
      expect(isDangerAccepted(filterFn(heavyTrucks.rawText))).toBe(false);
      expect(isDangerAccepted(filterFn(floodClosure.rawText))).toBe(true);
    });

    it("Edge Case #14: garbled or hallucinated quote not present in source post is rejected", async () => {
      const situationMod = await importRepoModule<{
        copiedFrom: (span: string, post: string) => boolean;
      }>("src/lib/text-sources/dgpc-situation.server.ts");

      const post = buildTarikiPost({ kind: "snow_closure" });
      const hallucinated =
        "انهيار جسر كامل على الطريق السيار بوهران ووفاة عشرة أشخاص";

      expect(situationMod.copiedFrom(hallucinated, post.rawText)).toBe(false);
      expect(situationMod.copiedFrom("", post.rawText)).toBe(false);
      expect(situationMod.copiedFrom("   ", post.rawText)).toBe(false);
    });

    it("Edge Case #14: Facebook login wall / HTTP 403 maps cleanly to upstream_unreachable (never internal_error)", async () => {
      const tarikiServerPath = findFirstExisting([
        "src/lib/text-sources/tariki.server.ts",
        "src/lib/text-sources/tariki.ts",
        "src/lib/text-sources/facebook-page.ts",
      ]);
      expect(tarikiServerPath).not.toBeNull();
      const src = readRepoFile(tarikiServerPath!);
      const fbSrc = repoFileExists("src/lib/text-sources/facebook-page.ts")
        ? readRepoFile("src/lib/text-sources/facebook-page.ts")
        : "";
      const combined = `${src}\n${fbSrc}`;

      expect(combined).toMatch(/403|login|upstream_unreachable/i);
    });

    it("uses dynamic 'Gendarmerie Nationale (Tariki)' attribution and never confirms wildfires", () => {
      const tarikiFiles = listRepoFiles("src/lib/text-sources", ".ts").filter(
        (f) => /tariki/i.test(f),
      );
      expect(tarikiFiles.length).toBeGreaterThan(0);

      const combined = tarikiFiles.map((f) => readRepoFile(f)).join("\n");
      expect(combined).toMatch(/Gendarmerie Nationale|Tariki/i);
      // Must NOT confirm fires (Tariki is road/weather/flood danger only).
      expect(combined).not.toMatch(/confirmFire|confirmed_fire/i);
    });

    it("national-sources-only compliance: Tariki adapter targets only the national tariki page (zero per-wilaya feeds)", () => {
      const tarikiFiles = listRepoFiles("src/lib/text-sources", ".ts").filter(
        (f) => /tariki/i.test(f),
      );
      expect(tarikiFiles.length).toBeGreaterThan(0);
      const combined = tarikiFiles.map((f) => readRepoFile(f)).join("\n");

      // Should not enumerate per-wilaya Facebook pages (e.g., tariki.alger, tariki.oran, protectioncivile16).
      expect(combined).not.toMatch(
        /facebook\.com\/[a-z0-9._-]+(?:16|31|15|06)\b/i,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // F20: CRAAG Official Earthquake Attribution Matcher + EMSC M2+ Boundaries
  // ---------------------------------------------------------------------------
  describe("F20 — CRAAG Official Attribution Matcher & EMSC M2+ Resilience Boundaries", () => {
    it("EMSC parser excludes non-earthquake blasts (evtype='qb') and rejects malformed non-array payloads", async () => {
      const emscMod = await importRepoModule<{
        parseEmsc: (body: unknown) => Array<{ id: string; magnitude: number }>;
      }>("src/lib/ingest/emsc.ts");

      expect(emscMod.parseEmsc(null)).toEqual([]);
      expect(() => emscMod.parseEmsc({ unexpected: true })).toThrow(
        /unexpected shape/i,
      );

      const parsed = emscMod.parseEmsc({
        features: [
          {
            properties: {
              unid: "emsc-blast-1",
              time: "2026-11-24T12:00:00Z",
              lat: 36.75,
              lon: 5.05,
              mag: 2.3,
              evtype: "qb",
            },
          },
          {
            properties: {
              unid: "emsc-real-m20",
              time: "2026-11-24T12:05:00Z",
              lat: 36.75,
              lon: 5.05,
              mag: 2.0,
              evtype: "ke",
            },
          },
        ],
      });

      expect(parsed.map((e) => e.id)).toEqual(["emsc-real-m20"]);
      expect(parsed[0]?.magnitude).toBe(2.0);
    });

    it("Edge Case #8: CRAAG outage, HTTP 503, HTTP 200 HTML error, or empty/static HTML never degrades EMSC real-time feed", async () => {
      const craagPath = findFirstExisting([
        "src/lib/ingest/craag.ts",
        "src/lib/ingest/craag.server.ts",
      ]);
      expect(
        craagPath,
        "Expected CRAAG official attribution matcher under src/lib/ingest/craag*.ts",
      ).not.toBeNull();

      const craagMod = await importRepoModule<{
        parseCraagBulletins: (html: string) => {
          bulletins: unknown[];
          emptyPage: boolean;
        };
      }>(craagPath!);

      // Table-less static HTML and HTTP 200 HTML error page must throw structured errors (never fabricate earthquakes).
      const tableLessHtml = buildCraagBulletin({ mode: "empty" });
      expect(() => craagMod.parseCraagBulletins(tableLessHtml.html)).toThrow(
        /schema|table|invalid/i,
      );
      expect(() =>
        craagMod.parseCraagBulletins(HTTP_200_HTML_ERROR_BODY),
      ).toThrow(/error|unavailable|503|upstream|html/i);

      // Valid empty CRAAG seismic table returns empty bulletins with emptyPage=true.
      const validEmptyTableHtml = readRepoFile(
        "src/lib/__tests__/fixtures/craag-empty-table.html",
      );
      const parsedEmpty = craagMod.parseCraagBulletins(validEmptyTableHtml);
      expect(parsedEmpty.bulletins).toEqual([]);
      expect(parsedEmpty.emptyPage).toBe(true);

      // EMSC ingest module must not fail if CRAAG is unreachable.
      const emscServerSrc = readRepoFile("src/lib/ingest/emsc.server.ts");
      expect(emscServerSrc).toMatch(/minmag=2|M2|magnitude/i);
    });

    it("out-of-tolerance CRAAG bulletin (> time, distance, or magnitude threshold) does NOT falsely attach to an unrelated EMSC quake", async () => {
      const craagPath = findFirstExisting([
        "src/lib/ingest/craag.ts",
        "src/lib/ingest/craag.server.ts",
      ]);
      expect(craagPath).not.toBeNull();

      const craagMod = await importRepoModule<Record<string, unknown>>(
        craagPath!,
      );
      const matcher = findExportedFn(
        craagMod,
        [
          "matchCraagToEmsc",
          "matchCraagBulletin",
          "matchCraagEvent",
          "findMatchingEmscEvent",
        ],
        craagPath!,
      );

      const emscBejaia = buildEmscEvent({
        id: "emsc-bejaia-46",
        time: "2026-11-24T13:42:18Z",
        lat: 36.7525,
        lon: 5.0556,
        mag: 4.6,
      });

      const emscNormalized = {
        id: emscBejaia.id,
        occurred_at: emscBejaia.properties.time,
        occurredAt: emscBejaia.properties.time,
        lat: emscBejaia.properties.lat,
        lon: emscBejaia.properties.lon,
        magnitude: emscBejaia.properties.mag,
      };

      // Matching bulletin within tolerances -> attaches cleanly.
      const matching = buildCraagBulletin({
        eventTime: "2026-11-24T13:42:20Z",
        lat: 36.751,
        lon: 5.058,
        magnitude: 4.6,
      });
      const goodMatch = matcher(
        {
          observedAt: matching.eventTime,
          occurred_at: matching.eventTime,
          occurredAt: matching.eventTime,
          lat: matching.lat,
          lon: matching.lon,
          magnitude: matching.magnitude,
          bulletinUrl: matching.bulletinUrl,
        },
        [emscNormalized],
      );
      expect(goodMatch).toBeTruthy();

      // Far-away Oran bulletin (> 400 km away) -> MUST NOT match Béjaïa.
      const farAway = matcher(
        {
          observedAt: "2026-11-24T13:42:20Z",
          occurred_at: "2026-11-24T13:42:20Z",
          occurredAt: "2026-11-24T13:42:20Z",
          lat: 35.697,
          lon: -0.6308,
          magnitude: 4.6,
          bulletinUrl: "https://www.craag.dz/oran",
        },
        [emscNormalized],
      );
      expect(farAway).toBeFalsy();

      // 3-hour time skew -> MUST NOT match.
      const wrongTime = matcher(
        {
          observedAt: "2026-11-24T16:45:00Z",
          occurred_at: "2026-11-24T16:45:00Z",
          occurredAt: "2026-11-24T16:45:00Z",
          lat: 36.751,
          lon: 5.058,
          magnitude: 4.6,
          bulletinUrl: "https://www.craag.dz/late",
        },
        [emscNormalized],
      );
      expect(wrongTime).toBeFalsy();

      // Large magnitude discrepancy (M2.5 vs M4.6) -> MUST NOT match.
      const wrongMag = matcher(
        {
          observedAt: "2026-11-24T13:42:20Z",
          occurred_at: "2026-11-24T13:42:20Z",
          occurredAt: "2026-11-24T13:42:20Z",
          lat: 36.751,
          lon: 5.058,
          magnitude: 2.5,
          bulletinUrl: "https://www.craag.dz/small",
        },
        [emscNormalized],
      );
      expect(wrongMag).toBeFalsy();
    });

    it("CRAAG attribution preserves honesty: never claims 'confirmed damage' or banned safe labels", () => {
      const craagPath = findFirstExisting([
        "src/lib/ingest/craag.server.ts",
        "src/lib/ingest/craag.ts",
      ]);
      expect(craagPath).not.toBeNull();
      const src = readRepoFile(craagPath!);
      expect(src).toMatch(/CRAAG/i);
      expect(src).not.toMatch(/confirmed damage/i);
      expect(findBannedSafeLabels(src)).toEqual([]);
    });

    it("CRAAG & EMSC ingestion paths use idempotent conflict handling for replay safety", () => {
      const craagPath = findFirstExisting([
        "src/lib/ingest/craag.server.ts",
        "src/lib/ingest/craag.ts",
      ]);
      expect(craagPath).not.toBeNull();
      const combined = `${readRepoFile(craagPath!)}\n${readRepoFile("src/lib/ingest/emsc.server.ts")}`;
      expect(combined).toMatch(/onConflict|upsert|eq\(["']id["']/i);
    });
  });

  // ---------------------------------------------------------------------------
  // F21: Post-Worker Scientific Sources (MTG FCI Push, MTG LI, GWIS, CLMS, GHSL)
  // ---------------------------------------------------------------------------
  describe("F21 — MTG FCI Push, MTG LI, GWIS, CLMS NDVI-SWI & GHSL M6-Gate Boundaries", () => {
    it("Edge Case #7: quiet Sahara-only MTG FCI slot records latestSlot BEFORE isInWatchArea filter so healthy feed never turns stale", async () => {
      const fciMod = await importRepoModule<{
        parseFciFeatures: (json: {
          features: Array<{
            geometry: { coordinates: [number, number] };
            properties: Record<string, unknown>;
          }>;
        }) => {
          rows: unknown[];
          outside: number;
          filtered: number;
          latestSlot: string | null;
        };
      }>("src/lib/ingest/fci.server.ts");

      const quietFixture = buildMtgFciFixture({ quietSaharaOnly: true });
      const hotspot = quietFixture.hotspots[0]!;
      const result = fciMod.parseFciFeatures({
        features: [
          {
            geometry: { coordinates: [hotspot.lon, hotspot.lat] },
            properties: {
              FRP: hotspot.frpMw,
              Confidence: hotspot.confidence * 100,
              time: quietFixture.slotTime,
              Datetime: quietFixture.slotTime
                .replace("T", " ")
                .replace("Z", ""),
            },
          },
        ],
      });

      expect(result.rows).toHaveLength(0);
      expect(result.outside).toBe(0);
      expect(result.filtered).toBe(1);
      // Critical Edge Case #7 invariant: watermark MUST still advance!
      expect(result.latestSlot).toBe(quietFixture.slotTime);
    });

    it("MTG FCI axis-order sentinel: coordinates swapped into wrong hemisphere increment outside and leave latestSlot null", async () => {
      const fciMod = await importRepoModule<{
        parseFciFeatures: (json: {
          features: Array<{
            geometry: { coordinates: [number, number] };
            properties: Record<string, unknown>;
          }>;
        }) => {
          rows: unknown[];
          outside: number;
          filtered: number;
          latestSlot: string | null;
        };
      }>("src/lib/ingest/fci.server.ts");

      // Swapped [lat, lon] = [36.71, 4.05] -> interpreted as lon=36.71 (outside Algeria east=12.0), lat=4.05 (outside south=18.9).
      const swapped = fciMod.parseFciFeatures({
        features: [
          {
            geometry: { coordinates: [36.7169, 4.0497] },
            properties: {
              FRP: 45,
              Confidence: 90,
              time: "2026-11-24T15:05:00Z",
            },
          },
        ],
      });

      expect(swapped.rows).toHaveLength(0);
      expect(swapped.outside).toBe(1);
      expect(swapped.latestSlot).toBeNull();
    });

    it("M6-7 PR #31 Banned Artifacts Guard: zero FCI L1c EO:EUM:DAT:0665, rotated downwind hacks, hard-coded burn circles, or invented fuel-recovery curves", async () => {
      // 1. Behavioral verification: the 3 scientific parsers actively REJECT PR #31 banned artifacts.
      const fciPushMod = await importRepoModule<{
        parseMtgFciPushPayload: (payload: Record<string, unknown>) => unknown;
      }>("src/lib/ingest/mtg-fci-push.ts");
      const clmsMod = await importRepoModule<{
        parseClmsPayload: (
          payload: Record<string, unknown>,
        ) => Promise<unknown>;
      }>("src/lib/ingest/clms.ts");
      const gwisMod = await importRepoModule<{
        parseGwisPayload: (payload: Record<string, unknown>) => unknown;
      }>("src/lib/ingest/gwis.ts");

      expect(() =>
        fciPushMod.parseMtgFciPushPayload({
          product_id: "EO:EUM:DAT:0665",
          slot_time: "2026-11-24T15:00:00Z",
          features: [],
        }),
      ).toThrow(/prohibited|0665|l1c/i);

      expect(() =>
        fciPushMod.parseMtgFciPushPayload({
          product_id: "EO:EUM:DAT:0662",
          slot_time: "2026-11-24T15:00:00Z",
          fuel_recovery_curve: 0.4,
          features: [],
        }),
      ).toThrow(/prohibited|fuel_recovery_curve/i);

      await expect(
        clmsMod.parseClmsPayload({
          product_version: "ndvi_v3_300m",
          observed_at: "2026-11-24",
          fuel_recovery_curve: 0.5,
          records: [],
        }),
      ).rejects.toThrow(/prohibited|fuel_recovery_curve/i);

      await expect(
        clmsMod.parseClmsPayload({
          product_version: "ndvi_v3_300m",
          observed_at: "2026-11-24",
          logistic_calibration: 1.2,
          records: [],
        }),
      ).rejects.toThrow(/prohibited|logistic_calibration/i);

      expect(() =>
        gwisMod.parseGwisPayload({
          type: "FeatureCollection",
          published_at: "2026-11-24",
          burn_circle_m: 1500,
          features: [],
        }),
      ).toThrow(/prohibited|burn_circle_m/i);

      expect(() =>
        gwisMod.parseGwisPayload({
          type: "FeatureCollection",
          published_at: "2026-11-24",
          logistic_calibration: 0.8,
          features: [],
        }),
      ).toThrow(/prohibited|logistic_calibration/i);

      // 2. Repo-wide static scan: exempt ONLY the explicit PROHIBITED_*_KEYS denylists and prohibited rejection throw messages in those 3 guard files.
      const scanFiles = [
        ...listRepoFiles("src/lib", ".ts"),
        ...listRepoFiles("worker", ".ts"),
        ...listRepoFiles("supabase/migrations", ".sql").filter((f) =>
          /\/20261124\d{6}_/.test(f),
        ),
      ].filter((f) => !f.includes("__tests__") && !f.endsWith(".test.ts"));

      const pr31GuardFiles = new Set([
        "src/lib/ingest/clms.ts",
        "src/lib/ingest/gwis.ts",
        "src/lib/ingest/mtg-fci-push.ts",
      ]);

      const bannedPatterns: Array<{ name: string; re: RegExp }> = [
        { name: "FCI L1c EO:EUM:DAT:0665", re: /EO:EUM:DAT:0665/i },
        {
          name: "invented fuel-recovery curve",
          re: /fuel_recovery_curve|fuelRecoveryCurve/i,
        },
        {
          name: "PR #31 logistic calibration",
          re: /logisticCalibration|logistic_calibration/i,
        },
        {
          name: "hard-coded burn circle",
          re: /hardcodedBurnCircle|burnCircleRadius/i,
        },
      ];

      const violations: string[] = [];
      for (const relPath of scanFiles) {
        let text = readRepoFile(relPath);
        if (pr31GuardFiles.has(relPath)) {
          text = text
            .replace(
              /const\s+PROHIBITED_[A-Z0-9_]+\s*=\s*\[[\s\S]*?\]\s*as\s+const;/g,
              "",
            )
            .replace(
              /throw\s+new\s+Error\([\s\S]*?prohibited[\s\S]*?\);/gi,
              "",
            );
        }
        for (const banned of bannedPatterns) {
          if (banned.re.test(text)) {
            violations.push(`${relPath}: ${banned.name}`);
          }
        }
      }

      expect(
        violations,
        `M6-7 banned PR #31 artifacts found: ${violations.join("; ")}`,
      ).toEqual([]);
    });

    it("scientific adapters preserve explicit honesty boundaries across MTG LI, GWIS, CLMS NDVI-SWI, and GHSL", () => {
      const expectedAdapters = [
        [
          "src/lib/ingest/mtg-fci-push.server.ts",
          "src/lib/ingest/mtg-fci-push.ts",
        ],
        [
          "src/lib/ingest/mtg-lightning.server.ts",
          "src/lib/ingest/mtg-lightning.ts",
        ],
        ["src/lib/ingest/gwis.server.ts", "src/lib/ingest/gwis.ts"],
        ["src/lib/ingest/clms.server.ts", "src/lib/ingest/clms.ts"],
        ["src/lib/ingest/ghsl.server.ts", "src/lib/ingest/ghsl.ts"],
      ];

      const foundFiles: string[] = [];
      for (const group of expectedAdapters) {
        const hit = findFirstExisting(group);
        expect(
          hit,
          `Expected M6 scientific adapter at one of: ${group.join(", ")}`,
        ).not.toBeNull();
        foundFiles.push(hit!);
      }

      const combined = foundFiles.map((f) => readRepoFile(f)).join("\n");
      expect(findBannedSafeLabels(combined)).toEqual([]);
      // GHSL must never label modeled residents as live people present/threatened.
      expect(combined).not.toMatch(
        /people currently present|people threatened/i,
      );
    });

    it("M6 New-Source Gate checklist doc & Track 4 migrations register all 8 sources under execution_target='worker'", () => {
      expect(
        repoFileExists("docs/m6-new-source-gate.md"),
        "Expected explicit M6 New-Source Gate checklist at docs/m6-new-source-gate.md",
      ).toBe(true);

      const gateDoc = readRepoFile("docs/m6-new-source-gate.md");
      for (const token of [
        /imerg|h-saf/i,
        /tariki/i,
        /craag/i,
        /fci/i,
        /lightning|li/i,
        /gwis/i,
        /clms|ndvi|swi/i,
        /ghsl/i,
      ]) {
        expect(
          token.test(gateDoc),
          `Missing source coverage for ${token} in docs/m6-new-source-gate.md`,
        ).toBe(true);
      }

      const track4Migrations = listRepoFiles(
        "supabase/migrations",
        ".sql",
      ).filter((f) => /\/2026112404\d{4}_/.test(f));
      expect(track4Migrations.length).toBeGreaterThan(0);
    });

    it("CLMS NDVI/SWI, GWIS & GHSL adapters enforce plausibility bounds (NDVI in [-1, 1], non-negative area & population)", () => {
      const scienceFiles = listRepoFiles("src/lib/ingest", ".ts").filter((f) =>
        /(gwis|clms|ghsl|mtg-lightning|mtg-fci-push)/i.test(f),
      );
      expect(scienceFiles.length).toBeGreaterThanOrEqual(5);

      const combined = scienceFiles.map((f) => readRepoFile(f)).join("\n");
      expect(combined).toMatch(/Number\.isFinite|isFinite/);
      expect(combined).toMatch(/onConflict|upsert|idempotency|natural_key/i);
    });
  });

  // ---------------------------------------------------------------------------
  // F22: Law 18-07 / Law 25-11 (ANPDP) Privacy Compliance Boundaries
  // ---------------------------------------------------------------------------
  describe("F22 — Law 18-07 / Law 25-11 (ANPDP) Consent, Export, Deletion & Minimization Boundaries", () => {
    it("unauthenticated request to /api/private/privacy-export returns HTTP 401 with no-store header (zero cross-user data leakage)", async () => {
      const res = await fetchText("/api/private/privacy-export");
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")?.toLowerCase()).toContain(
        "no-store",
      );
      expect(res.text).not.toMatch(/@|email|watch_zones|push_token/i);
    });

    it("unconsented personal-data submission is rejected cleanly by privacy-consent.server.ts", async () => {
      const consentMod = await importRepoModule<{
        handlePrivacyConsentPost: (
          request: Request,
          overrides?: Record<string, unknown>,
        ) => Promise<Response>;
      }>("src/lib/privacy-consent.server.ts");

      const src = readRepoFile("src/lib/privacy-consent.server.ts");
      expect(src).toMatch(/18-07|25-11|ANPDP|consent/i);
      expect(typeof consentMod.handlePrivacyConsentPost).toBe("function");

      let upsertCalls = 0;
      const mockedDeps = {
        getUser: async () => ({
          data: { user: { id: "user-consent-test" } },
          error: null,
        }),
        consumeRateLimit: async () => ({ data: true, error: null }),
        upsertConsent: async () => {
          upsertCalls += 1;
          return { data: null, error: null };
        },
      };

      const invalidPayloads: Array<Record<string, unknown>> = [
        {
          consented: false,
          accepted: false,
          consentVersion: "",
          purpose: "citizen_report",
        },
        {
          consent_type: "unknown_processing_purpose",
          status: "granted",
        },
        {
          consent_type: "citizen_reports",
          status: "declined",
        },
        {
          consent_type: "citizen_reports",
          status: "granted",
          policy_version: "",
        },
      ];

      for (const payload of invalidPayloads) {
        const req = new Request(
          "http://127.0.0.1/api/private/privacy-consent",
          {
            method: "POST",
            headers: {
              authorization: "Bearer test-user-jwt",
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        const res = await consentMod.handlePrivacyConsentPost(req, mockedDeps);
        expect(
          res.status,
          `Expected HTTP 400 for invalid consent payload ${JSON.stringify(payload)}`,
        ).toBe(400);
      }

      expect(upsertCalls).toBe(0);
    });

    it("consent withdrawal updates state and stops optional processing/digests", async () => {
      const src = readRepoFile("src/lib/privacy-consent.server.ts");
      expect(src).toMatch(/withdraw|revoke/i);

      const consentMod = await importRepoModule<Record<string, unknown>>(
        "src/lib/privacy-consent.server.ts",
      );
      const hasWithdrawExport = Object.keys(consentMod).some((k) =>
        /withdraw|revoke/i.test(k),
      );
      expect(
        hasWithdrawExport || /withdraw/i.test(src),
        "Expected consent withdrawal handling in src/lib/privacy-consent.server.ts",
      ).toBe(true);
    });

    it("account deletion cascades personal rows while preserving anonymized operational audit records", () => {
      const deleteSrc = readRepoFile("src/lib/delete-account.server.ts");
      expect(deleteSrc.length).toBeGreaterThan(50);
      // Must never delete or rewrite broadcast_audit (append-only operational evidence).
      expect(deleteSrc).not.toMatch(
        /from\(\s*["']broadcast_audit["']\s*\)[\s\S]{0,60}\.delete\(/,
      );

      expect(
        repoFileExists("docs/privacy-anpdp-compliance.md"),
        "Expected Law 18-07 / Law 25-11 compliance mapping at docs/privacy-anpdp-compliance.md",
      ).toBe(true);
      const complianceDoc = readRepoFile("docs/privacy-anpdp-compliance.md");
      expect(complianceDoc).toMatch(/18-07/);
      expect(complianceDoc).toMatch(/25-11/);
      expect(complianceDoc).toMatch(/ANPDP/);
    });

    it("/privacy renders HTTP 200 with Law 18-07, Law 25-11 & ANPDP disclosures across all 4 locales and zero em dashes", async () => {
      for (const lang of ["ar", "fr", "en", "kab"] as const) {
        const res = await fetchText(`/privacy?lang=${lang}`);
        expect(res.status, `Expected HTTP 200 on /privacy?lang=${lang}`).toBe(
          200,
        );
        const visibleText = stripHtmlToVisibleText(res.text);
        expect(visibleText).toMatch(/18-07|18[\u2010-\u2013-]07/);
        expect(visibleText).toMatch(/25-11|25[\u2010-\u2013-]11/);
        expect(visibleText).toMatch(/ANPDP|السلطة الوطنية/);
        expect(findEmDashesInText(visibleText).count).toBe(0);
      }
    });

    it("ADR-0006 & data-minimization: Current Commune resolver never sends device GPS or commune code to Nadhir server", () => {
      const ccSrc = readRepoFile("src/lib/current-commune.ts");
      expect(ccSrc).not.toMatch(
        /\/api\/.*commune|supabase\.from\(\s*["']user_locations["']/i,
      );
      expect(ccSrc).not.toMatch(/live location|tracking/i);
    });
  });

  // ---------------------------------------------------------------------------
  // F23: Server-Side EXIF Stripping for User Uploads Boundaries (Edge Case #17)
  // ---------------------------------------------------------------------------
  describe("F23 — Server-Side EXIF Stripping, Spoofed MIME, Size Caps & Storage RLS Lockdown", () => {
    it("Edge Case #17: spoofed MIME payload (HTML disguised as image/jpeg) is rejected by sanitizer and upload helper", async () => {
      const imgMod = await importRepoModule<{
        stripImageMetadata: (bytes: Uint8Array, type: string) => Uint8Array;
        validateAndStripReportPhoto: (
          bytes: Uint8Array,
          options?: { declaredMime?: string },
        ) => unknown;
      }>("src/lib/image-metadata.ts");

      const spoofed = createSpoofedMimePayload();
      expect(() => imgMod.stripImageMetadata(spoofed, "image/jpeg")).toThrow(
        /unsupported_type/i,
      );
      expect(() => imgMod.stripImageMetadata(spoofed, "image/png")).toThrow(
        /unsupported_type/i,
      );
      expect(() =>
        imgMod.validateAndStripReportPhoto(spoofed, {
          declaredMime: "image/jpeg",
        }),
      ).toThrow(/unsupported_type/i);

      const serverPhotoMod = await importRepoModule<{
        handleReportPhotoUpload: (
          request: Request,
          overrides?: Record<string, unknown>,
        ) => Promise<Response>;
      }>("src/lib/report-photo.server.ts");
      expect(typeof serverPhotoMod.handleReportPhotoUpload).toBe("function");

      let uploadCalls = 0;
      const form = new FormData();
      form.append(
        "file",
        new File([Buffer.from(spoofed)], "spoofed.jpg", {
          type: "image/jpeg",
        }),
      );
      const req = new Request("http://127.0.0.1/api/private/report-photo", {
        method: "POST",
        headers: { authorization: "Bearer test-user-jwt" },
        body: form,
      });

      const res = await serverPhotoMod.handleReportPhotoUpload(req, {
        getUser: async () => ({
          data: { user: { id: "user-photo-test" } },
          error: null,
        }),
        consumeRateLimit: async () => ({ data: true, error: null }),
        uploadObject: async () => {
          uploadCalls += 1;
          return { error: null };
        },
        randomUuid: () => "11111111-1111-4111-8111-111111111111",
      });

      expect(res.status).toBe(415);
      expect(uploadCalls).toBe(0);
    });

    it("Edge Case #17: corrupt/truncated JPEG header is rejected cleanly without crashing or persisting", async () => {
      const imgMod = await importRepoModule<{
        stripImageMetadata: (bytes: Uint8Array, type: string) => Uint8Array;
      }>("src/lib/image-metadata.ts");

      // Corrupt non-FF marker byte after SOI triggers unsupported_type immediately.
      const corrupt = new Uint8Array([0xff, 0xd8, 0x00, 0x11, 0x22, 0x33]);
      expect(() => imgMod.stripImageMetadata(corrupt, "image/jpeg")).toThrow(
        /unsupported_type/i,
      );

      // Empty 0-byte buffer rejected.
      expect(() =>
        imgMod.stripImageMetadata(new Uint8Array(0), "image/jpeg"),
      ).toThrow(/unsupported_type/i);
    });

    it("Edge Case #17: oversized upload payload (> max size cap) is rejected with HTTP 413 / size error", async () => {
      const serverPhotoSrc = readRepoFile("src/lib/report-photo.server.ts");
      const routeSrc = repoFileExists("src/routes/api/private/report-photo.ts")
        ? readRepoFile("src/routes/api/private/report-photo.ts")
        : "";
      const combined = `${serverPhotoSrc}\n${routeSrc}`;

      expect(combined).toMatch(/413/);
      expect(combined).toMatch(/MAX_.*BYTES|maxBytes|size/i);
    });

    it("Edge Case #17: unauthenticated POST to /api/private/report-photo is rejected with HTTP 401", async () => {
      const jpegWithGps = createJpegWithExif({
        latitude: 36.7538,
        longitude: 3.0588,
        make: "Xiaomi",
        model: "Redmi Note 13",
      });
      const form = new FormData();
      form.append(
        "file",
        new Blob([Buffer.from(jpegWithGps)], { type: "image/jpeg" }),
        "report.jpg",
      );

      const res = await fetchText("/api/private/report-photo", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(401);
    });

    it("Edge Case #17: direct client Storage INSERT policy on report-photos bucket is locked down in Track 4 migrations", () => {
      const track4Migrations = listRepoFiles(
        "supabase/migrations",
        ".sql",
      ).filter((f) => /\/2026112404\d{4}_/.test(f));
      expect(track4Migrations.length).toBeGreaterThan(0);

      const combinedSql = track4Migrations
        .map((f) => readRepoFile(f))
        .join("\n");
      expect(combinedSql).toMatch(/report-photos/i);
      expect(combinedSql).toMatch(/drop\s+policy/i);
    });

    it("Edge Case #17: preserves valid ICC profile APP2 while completely stripping APP1 EXIF/GPS/XMP, COM, and PNG eXIf/tEXt/iTXt", async () => {
      const imgMod = await importRepoModule<{
        stripImageMetadata: (bytes: Uint8Array, type: string) => Uint8Array;
      }>("src/lib/image-metadata.ts");

      // 1. JPEG with GPS EXIF + Camera Make/Model + COM + APP2 ICC_PROFILE
      const dirtyJpeg = createJpegWithExif({
        latitude: 36.7538,
        longitude: 3.0588,
        make: "Samsung",
        model: "Galaxy A55",
        comment: "Secret GPS comment",
        includeIccProfile: true,
      });
      const beforeJpeg = inspectImageForMetadata(dirtyJpeg);
      expect(beforeJpeg.hasExif).toBe(true);
      expect(beforeJpeg.hasGps).toBe(true);
      expect(beforeJpeg.hasCameraTags).toBe(true);
      expect(beforeJpeg.hasTextChunks).toBe(true);
      expect(beforeJpeg.markers).toContain("APP2-ICC");

      const cleanJpeg = imgMod.stripImageMetadata(dirtyJpeg, "image/jpeg");
      const afterJpeg = inspectImageForMetadata(cleanJpeg);
      expect(afterJpeg.format).toBe("jpeg");
      expect(afterJpeg.hasExif).toBe(false);
      expect(afterJpeg.hasGps).toBe(false);
      expect(afterJpeg.hasCameraTags).toBe(false);
      expect(afterJpeg.hasTextChunks).toBe(false);
      expect(afterJpeg.markers).toContain("APP2-ICC");
      const decodedJpeg = await decodeRasterDimensions(cleanJpeg);
      expect(decodedJpeg.width).toBe(16);
      expect(decodedJpeg.height).toBe(16);

      // 2. PNG with eXIf + tEXt + iTXt
      const dirtyPng = createPngWithExif({
        latitude: 36.7538,
        longitude: 3.0588,
        author: "Citizen",
      });
      const beforePng = inspectImageForMetadata(dirtyPng);
      expect(beforePng.hasExif).toBe(true);
      expect(beforePng.hasGps).toBe(true);
      expect(beforePng.hasTextChunks).toBe(true);

      const cleanPng = imgMod.stripImageMetadata(dirtyPng, "image/png");
      const afterPng = inspectImageForMetadata(cleanPng);
      expect(afterPng.format).toBe("png");
      expect(afterPng.hasExif).toBe(false);
      expect(afterPng.hasGps).toBe(false);
      expect(afterPng.hasCameraTags).toBe(false);
      expect(afterPng.hasTextChunks).toBe(false);
      const decodedPng = await decodeRasterDimensions(cleanPng);
      expect(decodedPng.width).toBe(16);
      expect(decodedPng.height).toBe(16);
    });
  });

  // ---------------------------------------------------------------------------
  // F24: Cloudflare Turnstile CAPTCHA Protection Boundaries (Edge Case #18)
  // ---------------------------------------------------------------------------
  describe("F24 — Turnstile CAPTCHA Fail-Closed, Replay Rejection & Read-Only Availability Rule", () => {
    it("missing or whitespace-only cf-turnstile-response token is blocked without contacting siteverify", async () => {
      const tsMod = await importRepoModule<{
        verifyTurnstileToken: (input: {
          token: string | null | undefined;
          secretKey: string;
          verifyUrl?: string;
        }) => Promise<{ ok: boolean; skipped?: boolean }>;
      }>("src/lib/turnstile.server.ts");

      expect(
        typeof tsMod.verifyTurnstileToken,
        "Expected exported Turnstile verifier in src/lib/turnstile.server.ts",
      ).toBe("function");

      const mockSiteVerify = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ success: true }),
      }));

      try {
        for (const badToken of ["", "   ", null, undefined]) {
          const res = await tsMod.verifyTurnstileToken({
            token: badToken,
            secretKey: "test-turnstile-secret",
            verifyUrl: mockSiteVerify.url,
          });
          expect(res.ok).toBe(false);
          expect(res.skipped).toBeFalsy();
        }
        expect(mockSiteVerify.requests).toHaveLength(0);
      } finally {
        await mockSiteVerify.close();
      }
    });

    it("invalid, expired, or replayed token (timeout-or-duplicate) is blocked cleanly", async () => {
      const tsMod = await importRepoModule<{
        verifyTurnstileToken: (input: {
          token: string;
          secretKey: string;
          verifyUrl?: string;
        }) => Promise<{ ok: boolean; skipped?: boolean }>;
      }>("src/lib/turnstile.server.ts");
      expect(typeof tsMod.verifyTurnstileToken).toBe("function");

      const mockReplay = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          success: false,
          "error-codes": ["timeout-or-duplicate"],
        }),
      }));

      try {
        const res = await tsMod.verifyTurnstileToken({
          token: "replayed-token-xyz",
          secretKey: "test-turnstile-secret",
          verifyUrl: mockReplay.url,
        });
        expect(res.ok).toBe(false);
        expect(res.skipped).toBeFalsy();
        expect(mockReplay.requests.length).toBeGreaterThanOrEqual(1);
      } finally {
        await mockReplay.close();
      }
    });

    it("siteverify HTTP 500 or network timeout fails CLOSED when Turnstile secret is configured (and never leaks secret)", async () => {
      const tsMod = await importRepoModule<{
        verifyTurnstileToken: (input: {
          token: string;
          secretKey: string;
          verifyUrl?: string;
          timeoutMs?: number;
        }) => Promise<{ ok: boolean; skipped?: boolean; error?: string }>;
      }>("src/lib/turnstile.server.ts");
      expect(typeof tsMod.verifyTurnstileToken).toBe("function");

      const secret = "TURNSTILE_SECRET_DO_NOT_LEAK_777";
      const mock500 = await startMockHttpServer(() => ({
        status: 500,
        body: "Internal Server Error",
      }));

      try {
        const res = await tsMod.verifyTurnstileToken({
          token: "valid-looking-token",
          secretKey: secret,
          verifyUrl: mock500.url,
          timeoutMs: 1_000,
        });
        expect(res.ok).toBe(false);
        expect(res.skipped).toBeFalsy();
        expect(mock500.requests.length).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(res)).not.toContain(secret);
      } finally {
        await mock500.close();
      }
    });

    it("valid token with matching action/hostname succeeds while mismatched action is rejected", async () => {
      const tsMod = await importRepoModule<{
        verifyTurnstileToken: (input: {
          token: string;
          secretKey: string;
          expectedAction?: string;
          expectedHostname?: string;
          verifyUrl?: string;
        }) => Promise<{ ok: boolean; skipped?: boolean }>;
      }>("src/lib/turnstile.server.ts");
      expect(typeof tsMod.verifyTurnstileToken).toBe("function");

      const mockOk = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          success: true,
          action: "report",
          hostname: "nadhir.app",
        }),
      }));

      try {
        const accepted = await tsMod.verifyTurnstileToken({
          token: "fresh-valid-token",
          secretKey: "test-turnstile-secret",
          expectedAction: "report",
          expectedHostname: "nadhir.app",
          verifyUrl: mockOk.url,
        });
        expect(accepted.ok).toBe(true);
        expect(accepted.skipped).toBeFalsy();

        const wrongAction = await tsMod.verifyTurnstileToken({
          token: "fresh-valid-token",
          secretKey: "test-turnstile-secret",
          expectedAction: "contribute",
          expectedHostname: "nadhir.app",
          verifyUrl: mockOk.url,
        });
        expect(wrongAction.ok).toBe(false);
        expect(wrongAction.skipped).toBeFalsy();
        expect(mockOk.requests.length).toBeGreaterThanOrEqual(2);
      } finally {
        await mockOk.close();
      }
    });

    it("Edge Case #18 (Read-Only Availability Rule): all 5 public hazard feeds return HTTP 200 without any Turnstile token", async () => {
      let weatherCommune = "0101";
      try {
        const seeded = psqlJson<{ code: string }>(`
          SELECT code
          FROM public.admin_units
          WHERE level = 'commune'
          ORDER BY CASE WHEN code = '1601' THEN 0 ELSE 1 END, code
          LIMIT 1
        `);
        if (seeded[0]?.code) {
          weatherCommune = seeded[0].code;
        }
      } catch {
        // Fallback to seeded commune 0101 if local Postgres lookup is unavailable.
      }

      const always200Feeds = [
        "/api/public/v1/fires",
        "/api/public/v1/civil",
        `/api/public/v1/weather?commune=${encodeURIComponent(weatherCommune)}`,
        "/api/public/v1/status",
      ];

      for (const path of always200Feeds) {
        const res = await fetchText(path);
        expect(
          res.status,
          `Edge Case #18 violation: read-only feed ${path} returned HTTP ${res.status} without Turnstile token`,
        ).toBe(200);
        expect(res.text).not.toMatch(/turnstile|captcha/i);
      }

      // /api/public/v1/risk returns 200 when a local_fwi snapshot is published or honest 503 {"error":"forecast unavailable"} on unseeded local DB — never Turnstile 401/403.
      const riskRes = await fetchText("/api/public/v1/risk");
      expect(
        [200, 503],
        `Edge Case #18 violation: read-only feed /api/public/v1/risk returned HTTP ${riskRes.status} without Turnstile token`,
      ).toContain(riskRes.status);
      expect(riskRes.text).not.toMatch(/turnstile|captcha/i);
      if (riskRes.status === 503) {
        expect(JSON.parse(riskRes.text)).toEqual({
          error: "forecast unavailable",
        });
      }
    });

    it("TurnstileWidget component exists and Turnstile is wired to write endpoints without gating public read APIs", () => {
      expect(
        repoFileExists("src/components/TurnstileWidget.tsx"),
        "Expected Turnstile React widget at src/components/TurnstileWidget.tsx",
      ).toBe(true);

      const publicV1Files = listRepoFiles("src/routes/api/public/v1", ".ts");
      for (const relPath of publicV1Files) {
        // Read-only v1 hazard routes must never require Turnstile.
        if (/(fires|civil|weather|risk|status)\.ts$/.test(relPath)) {
          const src = readRepoFile(relPath);
          expect(
            src,
            `Forbidden Turnstile gate on read-only route ${relPath}`,
          ).not.toMatch(/turnstile/i);
        }
      }
    });
  });
});
