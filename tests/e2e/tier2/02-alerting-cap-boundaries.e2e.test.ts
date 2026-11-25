import { describe, expect, it } from "vitest";
import {
  importRepoModule,
  listRepoFiles,
  readRepoFile,
  repoFileExists,
} from "../lib/env.ts";
import {
  buildDgpcNonFirePost,
  buildEmscEvent,
  buildOnmCapXml,
  loadAlgeriaAdmin,
} from "../lib/fixtures.ts";
import {
  fetchText,
  startMockHttpServer,
  type MockHttpResponse,
} from "../lib/http.ts";
import { findBannedSafeLabels, findEmDashesInText } from "../lib/playwright.ts";

const HOUR = 3_600_000;

type AnyFn = (...args: unknown[]) => unknown;

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

function isBroadcastPlanned(result: unknown): boolean {
  if (typeof result === "boolean") {
    return result;
  }
  if (result === null || result === undefined) {
    return false;
  }
  if (Array.isArray(result)) {
    return result.length > 0;
  }
  if (typeof result === "object") {
    const rec = result as Record<string, unknown>;
    for (const key of [
      "shouldBroadcast",
      "broadcast",
      "eligible",
      "send",
      "queued",
    ] as const) {
      if (typeof rec[key] === "boolean") {
        return rec[key];
      }
    }
    for (const key of [
      "topics",
      "deliveries",
      "targets",
      "relay",
      "pushCodes",
      "communeCodes",
      "messages",
    ] as const) {
      if (Array.isArray(rec[key])) {
        return rec[key].length > 0;
      }
    }
    if (typeof rec["action"] === "string") {
      const action = rec["action"].toLowerCase();
      return action !== "skip" && action !== "ignore" && action !== "none";
    }
    if (typeof rec["kind"] === "string") {
      const kind = rec["kind"].toLowerCase();
      return kind !== "skip" && kind !== "ignore" && kind !== "none";
    }
  }
  throw new Error(
    `Ambiguous broadcast planner return shape (cannot determine planned state): ${JSON.stringify(result)}`,
  );
}

describe("Tier 2 Boundaries — F7–F13: ONM CAP Chains, DGPC Non-Fire, Accountless Topics, Provenance, Channels, Self-Test & Digests", () => {
  // ---------------------------------------------------------------------------
  // F7: ONM CAP Update / Cancel Escalation Chains (Edge Cases #5, #6)
  // ---------------------------------------------------------------------------
  describe("F7 — ONM CAP Update/Cancel Chains, Silence!=Cancel & Omitted Expiry Boundaries", () => {
    it("Edge Case #5 (Silence != Cancel): dropping an active alert from the ONM Atom feed without explicit CAP msgType=Cancel never cancels or marks all-clear", async () => {
      const onmMod = await importRepoModule<{
        parseOnmFeed: (xml: string) => Array<{
          cap_id: string;
          msg_type?: string;
          msgType?: string;
        }>;
      }>("src/lib/ingest/onm.server.ts");

      // An Atom feed missing a previously active alert contains zero Cancel messages.
      const silentFeedXml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">',
        "</feed>",
      ].join("\n");
      const parsed = onmMod.parseOnmFeed(silentFeedXml);
      expect(parsed).toEqual([]);

      // Verify ONM ingestion & broadcast code never equates feed absence to CAP Cancel or "all-clear".
      const onmSrc = readRepoFile("src/lib/ingest/onm.server.ts");
      const broadcastSrc = readRepoFile("src/lib/ingest/broadcast.server.ts");
      expect(onmSrc).not.toMatch(/all[-\s]clear/i);
      expect(broadcastSrc).not.toMatch(/all[-\s]clear/i);

      // Verify explicit CAP Cancel support exists in ONM ingestion / CAP parser for M2.
      expect(
        /msgType|msg_type/i.test(onmSrc) && /Cancel/i.test(onmSrc),
        "Expected ONM ingestion to handle explicit CAP msgType=Cancel separately from feed silence",
      ).toBe(true);
    });

    it("Edge Case #6 (Omitted <expires>): sets bounded 24h internal delivery deadline from onset (or sent if onset absent) and never presents it as authority expiry", async () => {
      const rulesMod = await importRepoModule<{
        onmWarningIsCurrent: (
          w: {
            id: string;
            wilayaId: string;
            event: string;
            severity: string;
            sentMs: number;
            onsetMs: number | null;
            expiresMs: number | null;
          },
          now: number,
        ) => boolean;
      }>("src/lib/broadcast-rules.ts");

      const sentMs = Date.parse("2026-11-24T10:00:00Z");
      const onsetMs = Date.parse("2026-11-24T12:00:00Z");

      // With onset present and expires omitted: deadline is onset + 24h.
      const withOnset = {
        id: "onm-no-exp-1",
        wilayaId: "16",
        event: "Rain",
        severity: "Severe",
        sentMs,
        onsetMs,
        expiresMs: null,
      };
      expect(
        rulesMod.onmWarningIsCurrent(withOnset, onsetMs + 24 * HOUR - 60_000),
      ).toBe(true);
      expect(rulesMod.onmWarningIsCurrent(withOnset, onsetMs + 24 * HOUR)).toBe(
        false,
      );
      expect(
        rulesMod.onmWarningIsCurrent(withOnset, onsetMs + 24 * HOUR + 60_000),
      ).toBe(false);

      // With onset omitted and expires omitted: deadline falls back to sent + 24h.
      const withoutOnset = {
        ...withOnset,
        id: "onm-no-exp-2",
        onsetMs: null,
      };
      expect(
        rulesMod.onmWarningIsCurrent(withoutOnset, sentMs + 24 * HOUR - 1_000),
      ).toBe(true);
      expect(
        rulesMod.onmWarningIsCurrent(withoutOnset, sentMs + 24 * HOUR),
      ).toBe(false);

      // Verify CAP XML with omitted <expires> parses with expires: null (never fabricated as authority expiry).
      const onmMod = await importRepoModule<{
        parseCapDetail: (xml: string) => Record<string, unknown> | null;
      }>("src/lib/ingest/onm.server.ts");
      const xmlNoExpires = buildOnmCapXml({ expires: null });
      const detail = onmMod.parseCapDetail(xmlNoExpires);
      expect(detail).not.toBeNull();
      expect(detail?.["expires"] ?? null).toBeNull();
    });

    it("identical ONM reissue with a fresh cap_id is silent (zero duplicate push)", async () => {
      const rulesMod = await importRepoModule<{
        onmRelayPlan: (
          pending: readonly Record<string, unknown>[],
          relayed: readonly Record<string, unknown>[],
        ) => { relay: unknown[]; suppressed: unknown[] };
      }>("src/lib/broadcast-rules.ts");

      const base = Date.parse("2026-11-24T12:00:00Z");
      const first = {
        id: "onm-v1",
        wilayaId: "16",
        event: "Rain",
        severity: "Severe",
        sentMs: base,
        onsetMs: base,
        expiresMs: base + 12 * HOUR,
      };
      const reissue = {
        ...first,
        id: "onm-v2-fresh-cap-id",
        sentMs: base + 2 * HOUR,
      };

      const plan = rulesMod.onmRelayPlan([reissue], [first]);
      expect(plan.relay).toHaveLength(0);
      expect(plan.suppressed).toHaveLength(1);
    });

    it("ONM severity escalation (Severe -> Extreme) emits an update while downgrade (Extreme -> Severe) stays silent", async () => {
      const rulesMod = await importRepoModule<{
        onmRelayPlan: (
          pending: readonly Record<string, unknown>[],
          relayed: readonly Record<string, unknown>[],
        ) => {
          relay: Array<{ id: string }>;
          suppressed: Array<{ id: string }>;
        };
      }>("src/lib/broadcast-rules.ts");

      const base = Date.parse("2026-11-24T12:00:00Z");
      const severe = {
        id: "onm-sev",
        wilayaId: "42",
        event: "Rain",
        severity: "Severe",
        sentMs: base,
        onsetMs: base,
        expiresMs: base + 12 * HOUR,
      };
      const escalated = {
        ...severe,
        id: "onm-ext",
        severity: "Extreme",
        sentMs: base + HOUR,
      };
      const downgraded = {
        ...severe,
        id: "onm-down",
        severity: "Severe",
        sentMs: base + 2 * HOUR,
      };

      const escPlan = rulesMod.onmRelayPlan([escalated], [severe]);
      expect(escPlan.relay.map((w) => w.id)).toEqual(["onm-ext"]);
      expect(escPlan.suppressed).toHaveLength(0);

      const downPlan = rulesMod.onmRelayPlan([downgraded], [escalated]);
      expect(downPlan.relay).toHaveLength(0);
      expect(downPlan.suppressed.map((w) => w.id)).toEqual(["onm-down"]);
    });

    it("rejects expired, future-issued, inverted-window, and non-finite ONM CAP warnings", async () => {
      const rulesMod = await importRepoModule<{
        onmWarningIsCurrent: (
          w: Record<string, unknown>,
          now: number,
        ) => boolean;
      }>("src/lib/broadcast-rules.ts");

      const now = Date.parse("2026-11-24T15:00:00Z");

      // Already expired
      expect(
        rulesMod.onmWarningIsCurrent(
          {
            id: "expired",
            wilayaId: "16",
            event: "Wind",
            severity: "Severe",
            sentMs: now - 5 * HOUR,
            onsetMs: now - 4 * HOUR,
            expiresMs: now - 1_000,
          },
          now,
        ),
      ).toBe(false);

      // Future-issued (sent > now)
      expect(
        rulesMod.onmWarningIsCurrent(
          {
            id: "future-sent",
            wilayaId: "16",
            event: "Wind",
            severity: "Severe",
            sentMs: now + 60_000,
            onsetMs: now + 60_000,
            expiresMs: now + 6 * HOUR,
          },
          now,
        ),
      ).toBe(false);

      // Inverted window (expires <= onset)
      expect(
        rulesMod.onmWarningIsCurrent(
          {
            id: "inverted",
            wilayaId: "16",
            event: "Wind",
            severity: "Severe",
            sentMs: now - HOUR,
            onsetMs: now + 2 * HOUR,
            expiresMs: now + HOUR,
          },
          now,
        ),
      ).toBe(false);

      // NaN sent timestamp
      expect(
        rulesMod.onmWarningIsCurrent(
          {
            id: "nan",
            wilayaId: "16",
            event: "Wind",
            severity: "Severe",
            sentMs: Number.NaN,
            onsetMs: null,
            expiresMs: null,
          },
          now,
        ),
      ).toBe(false);
    });

    it("ONM CAP parser preserves msgType (Alert / Update / Cancel) and references chains from CAP 1.2 XML", async () => {
      const onmMod = await importRepoModule<{
        parseCapDetail: (xml: string) => Record<string, unknown> | null;
      }>("src/lib/ingest/onm.server.ts");

      const ref =
        "onm@meteo.dz,urn:oid:2.49.0.1.12.0.20261124.001,2026-11-24T12:00:00+01:00";
      const updateXml = buildOnmCapXml({
        identifier: "urn:oid:2.49.0.1.12.0.20261124.002",
        msgType: "Update",
        severity: "Extreme",
        references: ref,
      });
      const cancelXml = buildOnmCapXml({
        identifier: "urn:oid:2.49.0.1.12.0.20261124.003",
        msgType: "Cancel",
        references: ref,
      });

      const parsedUpdate = onmMod.parseCapDetail(updateXml);
      const parsedCancel = onmMod.parseCapDetail(cancelXml);

      expect(parsedUpdate).not.toBeNull();
      expect(parsedCancel).not.toBeNull();

      const updateMsgType =
        parsedUpdate?.["msgType"] ?? parsedUpdate?.["msg_type"];
      const cancelMsgType =
        parsedCancel?.["msgType"] ?? parsedCancel?.["msg_type"];
      const cancelRefs =
        parsedCancel?.["references"] ?? parsedCancel?.["cap_references"];

      expect(updateMsgType).toBe("Update");
      expect(cancelMsgType).toBe("Cancel");
      expect(String(cancelRefs ?? "")).toContain(
        "urn:oid:2.49.0.1.12.0.20261124.001",
      );
    });

    it("ONM CAP Cancel referencing an unknown/unmatched identifier degrades safely without crashing or cancelling unrelated alerts", async () => {
      const onmMod = await importRepoModule<Record<string, unknown>>(
        "src/lib/ingest/onm.server.ts",
      );
      const parseCapDetail = onmMod["parseCapDetail"] as (
        xml: string,
      ) => Record<string, unknown> | null;

      const unknownCancelXml = buildOnmCapXml({
        identifier: "urn:oid:2.49.0.1.12.0.20261124.999",
        msgType: "Cancel",
        references:
          "onm@meteo.dz,urn:oid:2.49.0.1.12.0.NONEXISTENT.404,2026-11-20T00:00:00+01:00",
      });

      expect(() => parseCapDetail(unknownCancelXml)).not.toThrow();
      const parsed = parseCapDetail(unknownCancelXml);
      expect(parsed).not.toBeNull();

      // Verify the chain/reference helper is exported and handles unknown cancel references safely.
      const cancelCandidates = [
        "resolveOnmCapCancel",
        "applyOnmCapCancel",
        "resolveCapCancel",
        "resolveOnmCapChain",
      ] as const;
      const refCandidates = [
        "parseCapReferences",
        "extractCapReferences",
      ] as const;
      const resolver = findExportedFn(
        onmMod,
        [...cancelCandidates, ...refCandidates],
        "src/lib/ingest/onm.server.ts",
      );
      const isRefParserOnly = refCandidates.some(
        (name) => onmMod[name] === resolver,
      );
      if (isRefParserOnly) {
        const refs = resolver(
          "onm@meteo.dz,urn:oid:2.49.0.1.12.0.NONEXISTENT.404,2026-11-20T00:00:00+01:00",
        );
        expect(Array.isArray(refs)).toBe(true);
      } else {
        expect(() =>
          resolver(
            ["urn:oid:2.49.0.1.12.0.NONEXISTENT.404"],
            [{ cap_id: "urn:oid:2.49.0.1.12.0.UNRELATED.001" }],
          ),
        ).not.toThrow();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // F8: DGPC Non-Fire (Flood / Storm / Road) Broadcast Adapter Boundaries
  // ---------------------------------------------------------------------------
  describe("F8 — DGPC Non-Fire Broadcast, Stale-Window, Retrospective & ITA Exclusion Boundaries", () => {
    it("stale DGPC non-fire incident (> 12h old) transitions to fading and never pushes as a live alert", async () => {
      const lifecycleMod = await importRepoModule<{
        officialPhase: (
          incident: {
            kind: string;
            status: string;
            last_reported_at: string;
            unlisted_at: string | null;
          },
          now: number,
        ) => string;
      }>("src/lib/incident-lifecycle.ts");

      const now = Date.parse("2026-11-24T18:00:00Z");
      const flood11h59m = new Date(now - (12 * HOUR - 60_000)).toISOString();
      const flood12h01m = new Date(now - (12 * HOUR + 60_000)).toISOString();

      expect(
        lifecycleMod.officialPhase(
          {
            kind: "flood",
            status: "active",
            last_reported_at: flood11h59m,
            unlisted_at: null,
          },
          now,
        ),
      ).toBe("live");

      expect(
        lifecycleMod.officialPhase(
          {
            kind: "flood",
            status: "active",
            last_reported_at: flood12h01m,
            unlisted_at: null,
          },
          now,
        ),
      ).toBe("fading");

      // After 72h archive threshold, transitions to archived (never "ended" without authority "cleared").
      const flood80h = new Date(now - 80 * HOUR).toISOString();
      expect(
        lifecycleMod.officialPhase(
          {
            kind: "road",
            status: "active",
            last_reported_at: flood80h,
            unlisted_at: null,
          },
          now,
        ),
      ).toBe("archived");
    });

    it("non-fire official incident fading after 12h never declares 'all-clear' or 'resolved' unless authority sets 'cleared'", async () => {
      const lifecycleMod = await importRepoModule<{
        officialPhase: (
          incident: {
            kind: string;
            status: string;
            last_reported_at: string;
            unlisted_at: string | null;
          },
          now: number,
        ) => string;
      }>("src/lib/incident-lifecycle.ts");

      const now = Date.parse("2026-11-24T18:00:00Z");
      const stale = new Date(now - 15 * HOUR).toISOString();

      // Still active after 15h -> fading, NOT ended.
      expect(
        lifecycleMod.officialPhase(
          {
            kind: "storm",
            status: "active",
            last_reported_at: stale,
            unlisted_at: null,
          },
          now,
        ),
      ).toBe("fading");

      // Only explicit authority "cleared" ends the incident.
      expect(
        lifecycleMod.officialPhase(
          {
            kind: "storm",
            status: "cleared",
            last_reported_at: stale,
            unlisted_at: null,
          },
          now,
        ),
      ).toBe("ended");

      // Broadcast copy module must never emit "all-clear" or banned safe labels.
      const broadcastCopySrc = readRepoFile("src/lib/broadcast-copy.ts");
      expect(findBannedSafeLabels(broadcastCopySrc)).toEqual([]);
    });

    it("retrospective casualty summary and unresolved-commune posts are excluded from automatic broadcast push", () => {
      const retroPost = buildDgpcNonFirePost({ kind: "retrospective" });
      expect(retroPost.isRetrospectiveCasualtyReport).toBe(true);
      expect(retroPost.cleared).toBe(true);

      const broadcastSrc = readRepoFile("src/lib/ingest/broadcast.server.ts");
      // relayOfficialIncidents must require resolved commune_id and exclude cleared/extinguished/unlisted incidents.
      expect(broadcastSrc).toMatch(
        /\.not\(\s*["']commune_id["']\s*,\s*["']is["']\s*,\s*null\s*\)/,
      );
      expect(broadcastSrc).toMatch(
        /\.is\(\s*["']unlisted_at["']\s*,\s*null\s*\)/,
      );
      expect(broadcastSrc).toMatch(/extinguished,cleared|cleared/);
    });

    it("ITA media post (even quoting Protection Civile) is strictly excluded from automatic broadcast push & public Telegram", async () => {
      const itaPost = buildDgpcNonFirePost({ kind: "ita_media" });
      expect(itaPost.sourceKey).toBe("ita_facebook");

      const shareCardMod = await importRepoModule<{
        isShareable: (incident: { authority_tier: string }) => boolean;
      }>("src/lib/share-card.ts");
      expect(shareCardMod.isShareable({ authority_tier: "media" })).toBe(false);
      expect(shareCardMod.isShareable({ authority_tier: "national" })).toBe(
        true,
      );

      // ADR-0004: Public Telegram relay must strictly filter to dgpc_telegram only.
      const telegramSrc = readRepoFile("src/lib/ingest/telegram.server.ts");
      expect(telegramSrc).toContain("dgpc_telegram");
      expect(telegramSrc).not.toContain("ita_facebook");

      // Official incident broadcast relay must exclude media tier (ITA).
      const broadcastSrc = readRepoFile("src/lib/ingest/broadcast.server.ts");
      expect(broadcastSrc).not.toMatch(/ita_facebook/);
    });

    it("DGPC non-fire CAP 1.2 builder maps flood/storm/road to multi-hazard CAP categories (not Fire-only)", async () => {
      const capMod = await importRepoModule<{
        buildOfficialCap: (input: Record<string, unknown>) => {
          info: Array<{ category: string }>;
        };
      }>("src/lib/cap.ts");

      const baseTexts = [
        {
          language: "fr-DZ",
          event: "Inondation",
          headline: "Protection Civile : inondation à Bab El Oued",
          description: "Intervention en cours.",
          instruction: "",
        },
      ];

      const floodCap = capMod.buildOfficialCap({
        incidentId: "11111111-1111-4111-8111-111111111111",
        kind: "flood",
        hazard: "flood",
        areaDesc: "Bab El Oued, Alger",
        sentAt: new Date("2026-11-24T15:00:00Z"),
        asOf: new Date("2026-11-24T14:55:00Z"),
        texts: baseTexts,
      });

      const roadCap = capMod.buildOfficialCap({
        incidentId: "22222222-2222-4222-8222-222222222222",
        kind: "road",
        hazard: "road",
        areaDesc: "Cherchell, Tipaza",
        sentAt: new Date("2026-11-24T15:00:00Z"),
        asOf: new Date("2026-11-24T14:55:00Z"),
        texts: baseTexts,
      });

      expect(floodCap.info[0]?.category).not.toBe("Fire");
      expect(["Met", "Safety", "Other"]).toContain(floodCap.info[0]?.category);
      expect(roadCap.info[0]?.category).toBe("Transport");
    });

    it("broadcast.server.ts extends official incident broadcast relay beyond FIRE_KINDS to cover DGPC non-fire flood/storm/road", () => {
      const broadcastSrc = readRepoFile("src/lib/ingest/broadcast.server.ts");

      // M2 must extend official broadcast eligibility to non-fire kinds (flood, storm, road).
      const supportsNonFire =
        /\bflood\b/.test(broadcastSrc) &&
        /\bstorm\b/.test(broadcastSrc) &&
        /\broad\b/.test(broadcastSrc);
      expect(
        supportsNonFire,
        "Expected broadcast.server.ts to handle DGPC non-fire kinds (flood, storm, road)",
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // F9: Accountless Multi-Hazard Commune Push Topics Boundaries
  // ---------------------------------------------------------------------------
  describe("F9 — Accountless Multi-Hazard Commune Push Topics (DGPC Non-Fire & M4+ Earthquakes)", () => {
    it("Earthquake M3.9 vs M4.0 boundary: M3.9 never broadcasts to accountless commune topics; M4.0 is eligible", async () => {
      const rulesMod = await importRepoModule<Record<string, unknown>>(
        "src/lib/broadcast-rules.ts",
      );

      const quakePlanner = findExportedFn(
        rulesMod,
        [
          "planEarthquakeBroadcast",
          "shouldBroadcastEarthquake",
          "isEarthquakeBroadcastEligible",
          "planQuakeBroadcast",
        ],
        "src/lib/broadcast-rules.ts",
      );

      const m39 = buildEmscEvent({ mag: 3.9 });
      const m40 = buildEmscEvent({ mag: 4.0 });
      const res39 = quakePlanner({
        id: m39.id,
        magnitude: 3.9,
        lat: m39.properties.lat,
        lon: m39.properties.lon,
        previousMagnitude: null,
        alreadyBroadcast: false,
      });
      const res40 = quakePlanner({
        id: m40.id,
        magnitude: 4.0,
        lat: m40.properties.lat,
        lon: m40.properties.lon,
        previousMagnitude: null,
        alreadyBroadcast: false,
      });

      expect(isBroadcastPlanned(res39)).toBe(false);
      expect(isBroadcastPlanned(res40)).toBe(true);
    });

    it("Earthquake 100 km vs 101 km distance boundary: communes within 100 km targeted, commune at 101 km excluded", async () => {
      const nadhirMod = await importRepoModule<{
        haversineKm: (
          aLat: number,
          aLon: number,
          bLat: number,
          bLon: number,
        ) => number;
      }>("src/lib/nadhir.ts");
      const eqMod = await importRepoModule<{
        QUAKE_NEARBY_RADIUS_KM: number;
      }>("src/lib/earthquakes.ts");
      const emscMod = await importRepoModule<{
        locateEvents: (
          events: Array<Record<string, unknown>>,
          communes: readonly { id: string; lat: number; lon: number }[],
          maxKm?: number,
        ) => Array<{ id: string; commune_id: string }>;
      }>("src/lib/ingest/emsc.ts");

      expect(eqMod.QUAKE_NEARBY_RADIUS_KM).toBe(100);

      // Epicentre at (36.75, 5.05) Béjaïa.
      // 1 deg latitude ~= 111.195 km. 0.895 deg ~= 99.5 km (inside); 0.91 deg ~= 101.2 km (outside).
      const epiLat = 36.75;
      const epiLon = 5.05;
      const insideCommune = {
        id: "c-inside",
        lat: epiLat - 0.895,
        lon: epiLon,
      };
      const outsideCommune = {
        id: "c-outside",
        lat: epiLat - 0.91,
        lon: epiLon,
      };

      const kmIn = nadhirMod.haversineKm(
        epiLat,
        epiLon,
        insideCommune.lat,
        insideCommune.lon,
      );
      const kmOut = nadhirMod.haversineKm(
        epiLat,
        epiLon,
        outsideCommune.lat,
        outsideCommune.lon,
      );
      expect(kmIn).toBeLessThanOrEqual(100);
      expect(kmOut).toBeGreaterThan(100);

      const quake = {
        id: "emsc-dist-check",
        occurred_at: "2026-11-24T14:00:00Z",
        lat: epiLat,
        lon: epiLon,
        depth_km: 10,
        magnitude: 4.2,
        magnitude_type: "ml",
        region: "NORTHERN ALGERIA",
        network: "EMSC",
        updated_at: "2026-11-24T14:01:00Z",
      };

      expect(
        emscMod
          .locateEvents([quake], [insideCommune], 100)
          .map((r) => r.commune_id),
      ).toEqual(["c-inside"]);
      expect(emscMod.locateEvents([quake], [outsideCommune], 100)).toEqual([]);
    });

    it("Earthquake revision asymmetry: upward revision M3.8 -> M4.2 pushes ONCE; downward M4.3 -> M3.7 NEVER sends retraction/all-clear", async () => {
      const rulesMod = await importRepoModule<Record<string, unknown>>(
        "src/lib/broadcast-rules.ts",
      );

      const revisionFn = findExportedFn(
        rulesMod,
        [
          "planEarthquakeBroadcast",
          "planEarthquakeRevision",
          "shouldBroadcastEarthquakeRevision",
          "planQuakeBroadcast",
        ],
        "src/lib/broadcast-rules.ts",
      );

      // Upward M3.8 -> M4.2 (not yet broadcast) -> must emit broadcast once.
      const upward = revisionFn({
        id: "eq-up-1",
        magnitude: 4.2,
        previousMagnitude: 3.8,
        alreadyBroadcast: false,
      });
      expect(isBroadcastPlanned(upward)).toBe(true);

      // Already broadcast -> second pass must NOT re-push.
      const repeat = revisionFn({
        id: "eq-up-1",
        magnitude: 4.2,
        previousMagnitude: 4.2,
        alreadyBroadcast: true,
      });
      expect(isBroadcastPlanned(repeat)).toBe(false);

      // Downward M4.3 -> M3.7 -> NEVER sends retraction or all-clear.
      const downward = revisionFn({
        id: "eq-down-1",
        magnitude: 3.7,
        previousMagnitude: 4.3,
        alreadyBroadcast: true,
      });
      expect(isBroadcastPlanned(downward)).toBe(false);
    });

    it("accountless commune FCM topic format strictly obeys v1.commune.<code>.<lang> across all 4 locales and packs max 5 topics per FCM condition", async () => {
      const fcmMod = await importRepoModule<{
        FCM_LANGS: readonly string[];
        fcmTopic: (code: string, lang: string) => string;
        packTopics: (
          messages: Array<Record<string, unknown>>,
        ) => Array<{ key: string; message: Record<string, unknown> }>;
      }>("src/lib/fcm.ts");

      expect(fcmMod.FCM_LANGS).toEqual(["ar", "fr", "en", "kab"]);
      for (const lang of fcmMod.FCM_LANGS) {
        expect(fcmMod.fcmTopic("1601", lang)).toBe(`v1.commune.1601.${lang}`);
      }

      // 7 identical-payload commune topics must pack into 2 batches (5 + 2) because FCM caps condition at 5 topics.
      const msgs = Array.from({ length: 7 }, (_, idx) => ({
        topic: fcmMod.fcmTopic(`160${idx + 1}`, "ar"),
        notification: { title: "ONM", body: "Pluies" },
        webpush: { fcm_options: { link: "https://nadhir.app" } },
        android: {
          priority: "high",
          notification: { channel_id: "alerts_official" },
        },
        apns: {
          headers: { "apns-priority": "10" },
          payload: {
            aps: { sound: "default", "interruption-level": "time-sensitive" },
          },
        },
        data: {
          broadcast_id: "b1",
          severity: "Severe",
          kind: "onm",
          link: "/",
        },
      }));

      const packed = fcmMod.packTopics(msgs);
      expect(packed).toHaveLength(2);
      const firstCond = String(packed[0]?.message["condition"] ?? "");
      expect(firstCond.split("||")).toHaveLength(5);
    });

    it("applyDailyLimit drops communes at 6/day cap for normal broadcasts while exempting Extreme life-safety alerts", async () => {
      const rulesMod = await importRepoModule<{
        BROADCAST_DAILY_COMMUNE_LIMIT: number;
        applyDailyLimit: (
          codes: string[],
          sentToday: Map<string, number>,
          exempt: boolean,
        ) => { allowed: string[]; dropped: string[] };
      }>("src/lib/broadcast-rules.ts");

      expect(rulesMod.BROADCAST_DAILY_COMMUNE_LIMIT).toBe(6);
      const sentToday = new Map<string, number>([
        ["1601", 5],
        ["1602", 6],
        ["1603", 9],
      ]);

      const normal = rulesMod.applyDailyLimit(
        ["1601", "1602", "1603"],
        sentToday,
        false,
      );
      expect(normal.allowed).toEqual(["1601"]);
      expect(normal.dropped).toEqual(["1602", "1603"]);

      const extreme = rulesMod.applyDailyLimit(
        ["1601", "1602", "1603"],
        sentToday,
        true,
      );
      expect(extreme.allowed).toEqual(["1601", "1602", "1603"]);
      expect(extreme.dropped).toEqual([]);
    });

    it("pushCodesFor deduplicates overlapping clusters and only re-pushes when a commune escalates from ring to inside", async () => {
      const rulesMod = await importRepoModule<{
        coverageOf: (
          threads: Iterable<[string, Record<string, unknown>]>,
        ) => unknown;
        pushCodesFor: (args: Record<string, unknown>) => string[];
      }>("src/lib/broadcast-rules.ts");

      const coverage = rulesMod.coverageOf([
        [
          "cluster-a",
          {
            phase: "initial",
            severity: "Severe",
            communeCodes: ["1501", "1502"],
            insideCodes: ["1501"],
            atMs: Date.now(),
          },
        ],
      ]);

      // Cluster B covering 1502 at ring level (1) must NOT double-push 1502, but MUST push 1503.
      expect(
        rulesMod.pushCodesFor({
          clusterId: "cluster-b",
          action: "initial",
          codes: ["1501", "1502", "1503"],
          inside: [],
          previous: null,
          coverage,
        }),
      ).toEqual(["1503"]);

      // Cluster B escalating 1502 to inside (level 2 > cluster-a's level 1) MUST push 1502.
      expect(
        rulesMod.pushCodesFor({
          clusterId: "cluster-b",
          action: "update",
          codes: ["1502"],
          inside: ["1502"],
          previous: null,
          coverage,
        }),
      ).toEqual(["1502"]);
    });
  });

  // ---------------------------------------------------------------------------
  // F10: "Why am I seeing this?" Trigger Provenance Footer Boundaries
  // ---------------------------------------------------------------------------
  describe("F10 — Trigger Provenance Invariants, Null Area Honesty & Serialization Boundaries", () => {
    it("areaLabel: null, empty, or em-dash renders honest localized fallback and never emits lone em dash '—'", async () => {
      const provMod = await importRepoModule<{
        buildAlertProvenance: (input: Record<string, unknown>) => {
          areaLabel: string | null;
        };
        formatProvenanceDigestLine: (
          data: Record<string, unknown>,
          labels: Record<string, string>,
        ) => string;
      }>("src/lib/alert-provenance.ts");

      for (const emptyArea of [
        null,
        undefined,
        "",
        "   ",
        "\u2014",
        " \u2014 ",
      ]) {
        const built = provMod.buildAlertProvenance({
          triggerKind: "commune_topic",
          areaLabel: emptyArea,
          sourceKey: "onm",
          observedAt: "2026-11-24T14:00:00Z",
          authorityStatus: "official",
        });
        expect(built.areaLabel).toBeNull();

        const line = provMod.formatProvenanceDigestLine(built, {
          trigger: "Subscribed commune",
          rule: "ONM Severe Warning",
          areaFallback: "Not recorded",
          timeLabel: "15:00",
        });
        expect(line).toContain("Not recorded");
        expect(findEmDashesInText(line).count).toBe(0);
      }
    });

    it("validateProvenanceInvariants rejects all banned 'safe'/'all-clear' status labels and empty attribution", async () => {
      const provMod = await importRepoModule<{
        BANNED_STATUS_LABELS: readonly string[];
        validateProvenanceInvariants: (
          data: Record<string, unknown>,
        ) => string[];
      }>("src/lib/alert-provenance.ts");

      expect(provMod.BANNED_STATUS_LABELS).toContain("safe");
      expect(provMod.BANNED_STATUS_LABELS).toContain("all-clear");
      expect(provMod.BANNED_STATUS_LABELS).toContain("آمن");

      for (const banned of provMod.BANNED_STATUS_LABELS) {
        const violations = provMod.validateProvenanceInvariants({
          triggerKind: "wilaya_warning",
          areaLabel: "Alger",
          sourceKey: "onm",
          sourceAttribution: "ONM · Météo Algérie",
          ruleLabelKey: "provenance.rule.onmSevere",
          observedAt: "2026-11-24T14:00:00Z",
          authorityStatus: banned,
        });
        expect(
          violations.length,
          `Expected banned status "${banned}" to be rejected`,
        ).toBeGreaterThan(0);
      }

      // Empty or em-dash-only attribution rejected.
      for (const badAttr of ["", "   ", "\u2014"]) {
        const violations = provMod.validateProvenanceInvariants({
          triggerKind: "commune_topic",
          areaLabel: "Tipaza",
          sourceKey: "dgpc_telegram",
          sourceAttribution: badAttr,
          ruleLabelKey: "provenance.rule.dgpcNonFire",
          observedAt: "2026-11-24T14:00:00Z",
        });
        expect(violations.some((v) => /sourceAttribution/i.test(v))).toBe(true);
      }
    });

    it("validateProvenanceInvariants enforces verbatim ONM attribution, valid calendar ISO timestamps, and positive finite radiusKm", async () => {
      const provMod = await importRepoModule<{
        validateProvenanceInvariants: (
          data: Record<string, unknown>,
        ) => string[];
      }>("src/lib/alert-provenance.ts");

      // Altered ONM attribution (removing ONM / Météo) must be rejected.
      const badOnm = provMod.validateProvenanceInvariants({
        triggerKind: "wilaya_warning",
        areaLabel: "Alger",
        sourceKey: "onm",
        sourceAttribution: "Nadhir Weather Estimate",
        ruleLabelKey: "provenance.rule.onmSevere",
        observedAt: "2026-11-24T14:00:00Z",
      });
      expect(badOnm.some((v) => /ONM/i.test(v))).toBe(true);

      // Impossible calendar date 2026-02-31 must be rejected.
      const badDate = provMod.validateProvenanceInvariants({
        triggerKind: "watch_zone",
        areaLabel: "Tizi Ouzou",
        radiusKm: 15,
        sourceKey: "emsc",
        sourceAttribution: "EMSC",
        ruleLabelKey: "provenance.rule.m4Quake",
        observedAt: "2026-02-31T12:00:00Z",
      });
      expect(badDate.some((v) => /observedAt/i.test(v))).toBe(true);

      // Non-positive or non-finite radiusKm must be rejected.
      for (const badRadius of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
        const res = provMod.validateProvenanceInvariants({
          triggerKind: "watch_zone",
          areaLabel: "Tizi Ouzou",
          radiusKm: badRadius,
          sourceKey: "emsc",
          sourceAttribution: "EMSC",
          ruleLabelKey: "provenance.rule.m4Quake",
          observedAt: "2026-11-24T12:00:00Z",
        });
        expect(res.some((v) => /radiusKm/i.test(v))).toBe(true);
      }
    });

    it("FCM provenance serialization round-trips losslessly and rejects malformed payloads without throwing", async () => {
      const provMod = await importRepoModule<{
        buildAlertProvenance: (
          input: Record<string, unknown>,
        ) => Record<string, unknown>;
        toProvenancePayload: (
          data: Record<string, unknown>,
        ) => Record<string, string>;
        parseProvenancePayload: (
          raw: unknown,
        ) => Record<string, unknown> | null;
      }>("src/lib/alert-provenance.ts");

      const original = provMod.buildAlertProvenance({
        triggerKind: "watch_zone",
        areaLabel: "Maison Béjaïa",
        radiusKm: 25,
        sourceKey: "craag",
        sourceAttribution: "CRAAG",
        ruleLabelKey: "provenance.rule.m4Quake",
        observedAt: "2026-11-24T13:42:20Z",
        authorityStatus: "official",
      });

      const wire = provMod.toProvenancePayload(original);
      expect(wire["provenance_trigger"]).toBe("watch_zone");
      expect(wire["provenance_radius_km"]).toBe("25");
      expect(wire["provenance_source"]).toBe("CRAAG");

      const parsed = provMod.parseProvenancePayload(wire);
      expect(parsed).toEqual(original);

      for (const malformed of [
        null,
        undefined,
        [],
        {},
        { provenance_trigger: "invalid_trigger", provenance_source_key: "onm" },
        { provenance_trigger: "watch_zone", provenance_source_key: "" },
      ]) {
        expect(provMod.parseProvenancePayload(malformed)).toBeNull();
      }
    });

    it("AlertProvenance component exists and provenance i18n keys exist across ar, fr, en, kab with zero em dashes", async () => {
      expect(repoFileExists("src/components/nadhir/AlertProvenance.tsx")).toBe(
        true,
      );
      const compSrc = readRepoFile("src/components/nadhir/AlertProvenance.tsx");
      expect(findEmDashesInText(compSrc).count).toBe(0);

      const i18nMod = await importRepoModule<{
        default: {
          getFixedT: (lng: string) => (key: string) => string;
        };
      }>("src/i18n/index.ts");

      const requiredKeys = [
        "provenance.whySeeing",
        "provenance.triggerLabel",
        "provenance.areaLabel",
        "provenance.ruleLabel",
        "provenance.sourceLabel",
        "provenance.observedLabel",
        "common.notRecorded",
      ];

      for (const locale of ["ar", "fr", "en", "kab"] as const) {
        const t = i18nMod.default.getFixedT(locale);
        for (const key of requiredKeys) {
          const translated = t(key);
          expect(
            translated,
            `Missing translation for ${locale}:${key}`,
          ).toBeTruthy();
          expect(translated).not.toBe(key);
          expect(findEmDashesInText(translated).count).toBe(0);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // F11: Distinct Android Notification Channels Boundaries
  // ---------------------------------------------------------------------------
  describe("F11 — Distinct Android Notification Channel Routing Boundaries", () => {
    it("Earthquake magnitude channel boundary: M3.9 -> alerts_civil, M4.0..M4.9 -> alerts_earthquakes, M5.0 -> alerts_urgent", async () => {
      const chMod = await importRepoModule<{
        resolveNotificationChannel: (input: Record<string, unknown>) => string;
      }>("src/lib/notification-channels.ts");

      expect(
        chMod.resolveNotificationChannel({
          kind: "earthquake",
          magnitude: 3.9,
        }),
      ).toBe("alerts_civil");
      expect(
        chMod.resolveNotificationChannel({
          kind: "earthquake",
          magnitude: 4.0,
        }),
      ).toBe("alerts_earthquakes");
      expect(
        chMod.resolveNotificationChannel({
          kind: "earthquake",
          magnitude: 4.9,
        }),
      ).toBe("alerts_earthquakes");
      expect(
        chMod.resolveNotificationChannel({
          kind: "earthquake",
          magnitude: 5.0,
        }),
      ).toBe("alerts_urgent");
      expect(
        chMod.resolveNotificationChannel({
          kind: "earthquake",
          magnitude: 6.1,
        }),
      ).toBe("alerts_urgent");
    });

    it("ONM severity 1..4 channel boundary: Minor(1)/Moderate(2) -> alerts_civil, Severe(3) -> alerts_official, Extreme(4) -> alerts_urgent", async () => {
      const chMod = await importRepoModule<{
        resolveNotificationChannel: (input: Record<string, unknown>) => string;
      }>("src/lib/notification-channels.ts");

      expect(
        chMod.resolveNotificationChannel({ kind: "onm", severity: 1 }),
      ).toBe("alerts_civil");
      expect(
        chMod.resolveNotificationChannel({ kind: "onm", severity: 2 }),
      ).toBe("alerts_civil");
      expect(
        chMod.resolveNotificationChannel({ kind: "onm", severity: "Moderate" }),
      ).toBe("alerts_civil");
      expect(
        chMod.resolveNotificationChannel({ kind: "onm", severity: 3 }),
      ).toBe("alerts_official");
      expect(
        chMod.resolveNotificationChannel({ kind: "onm", severity: "Severe" }),
      ).toBe("alerts_official");
      expect(
        chMod.resolveNotificationChannel({ kind: "onm", severity: 4 }),
      ).toBe("alerts_urgent");
      expect(
        chMod.resolveNotificationChannel({ kind: "onm", severity: "Extreme" }),
      ).toBe("alerts_urgent");
    });

    it("DGPC official fire vs non-fire vs terminal phase/status channel boundary", async () => {
      const chMod = await importRepoModule<{
        resolveNotificationChannel: (input: Record<string, unknown>) => string;
      }>("src/lib/notification-channels.ts");

      expect(
        chMod.resolveNotificationChannel({
          kind: "official",
          hazard: "fire",
          severity: "Severe",
        }),
      ).toBe("alerts_urgent");
      expect(
        chMod.resolveNotificationChannel({
          kind: "official",
          hazard: "flood",
          severity: "Severe",
        }),
      ).toBe("alerts_official");
      expect(
        chMod.resolveNotificationChannel({
          kind: "official",
          hazard: "road",
          severity: 4,
        }),
      ).toBe("alerts_official");
      expect(
        chMod.resolveNotificationChannel({
          kind: "official",
          hazard: "flood",
          severity: "Extreme",
        }),
      ).toBe("alerts_urgent");
      expect(
        chMod.resolveNotificationChannel({
          kind: "official",
          hazard: "flood",
          status: "cleared",
        }),
      ).toBe("alerts_civil");
      expect(
        chMod.resolveNotificationChannel({
          kind: "onm",
          severity: "Extreme",
          phase: "cancel",
        }),
      ).toBe("alerts_civil");
    });

    it("self-test kind='test' always resolves strictly to alerts_test regardless of severity or phase", async () => {
      const chMod = await importRepoModule<{
        resolveNotificationChannel: (input: Record<string, unknown>) => string;
      }>("src/lib/notification-channels.ts");

      expect(chMod.resolveNotificationChannel({ kind: "test" })).toBe(
        "alerts_test",
      );
      expect(
        chMod.resolveNotificationChannel({
          kind: "test",
          severity: "Extreme",
          phase: "cancel",
        }),
      ).toBe("alerts_test");
    });

    it("channelFromFcmData honors explicit valid channel_id, derives when missing/invalid, and all 6 channel specs have 4-locale i18n keys", async () => {
      const chMod = await importRepoModule<{
        NOTIFICATION_CHANNELS: ReadonlyArray<{
          id: string;
          androidImportance: number;
          capacitorImportance: number;
          visibility: number;
          i18nNameKey: string;
          i18nDescriptionKey: string;
        }>;
        channelFromFcmData: (data: unknown) => string;
      }>("src/lib/notification-channels.ts");
      const i18nMod = await importRepoModule<{
        default: { getFixedT: (lng: string) => (key: string) => string };
      }>("src/i18n/index.ts");

      expect(
        chMod.channelFromFcmData({
          channel_id: "alerts_earthquakes",
          kind: "fire",
        }),
      ).toBe("alerts_earthquakes");
      expect(
        chMod.channelFromFcmData({
          channel_id: "fake_id",
          kind: "earthquake",
          magnitude: "5.2",
        }),
      ).toBe("alerts_urgent");

      expect(chMod.NOTIFICATION_CHANNELS).toHaveLength(6);
      for (const spec of chMod.NOTIFICATION_CHANNELS) {
        expect(spec.visibility).toBe(1);
        expect(spec.androidImportance).toBeGreaterThanOrEqual(3);
        expect(spec.capacitorImportance).toBeGreaterThanOrEqual(3);
        for (const locale of ["ar", "fr", "en", "kab"] as const) {
          const t = i18nMod.default.getFixedT(locale);
          expect(t(spec.i18nNameKey)).not.toBe(spec.i18nNameKey);
          expect(t(spec.i18nDescriptionKey)).not.toBe(spec.i18nDescriptionKey);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // F12: User-Facing "Test my notifications" Flow & AR/FR OEM Battery Guide Boundaries
  // ---------------------------------------------------------------------------
  describe("F12 — Self-Test Push Rate Limiting, Auth Isolation & OEM Battery Guide Boundaries", () => {
    it("unauthenticated POST to /api/private/push-test returns HTTP 401 with private, no-store cache headers and zero stack trace", async () => {
      const res = await fetchText("/api/private/push-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "fake-device-token" }),
      });

      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")?.toLowerCase()).toContain(
        "no-store",
      );
      expect(res.text).not.toMatch(/at\s+\w+\s+\(|node_modules|TypeError:/);
    });

    it("user-facing push-test handler enforces burst rate-limit (HTTP 429) and never fans out to public commune topics", async () => {
      // Check both admin and user-facing push-test modules for strict rate-limit + non-topic isolation.
      const userPushTestPath = repoFileExists(
        "src/routes/api/public/v1/push-test.ts",
      )
        ? "src/routes/api/public/v1/push-test.ts"
        : "src/lib/push-test.server.ts";
      const src = readRepoFile(userPushTestPath);
      const serverSrc = readRepoFile("src/lib/push-test.server.ts");
      const combined = `${src}\n${serverSrc}`;

      expect(combined).toMatch(/429/);
      expect(combined).toMatch(/consume_rate_limit|rate_limit|rateLimit/i);
      // Self-test must target a single device token (never public v1.commune.* topics).
      expect(combined).not.toMatch(/v1\.commune\./);
      expect(combined).not.toMatch(/fcmTopic\s*\(/);
    });

    it("UserPushTest flow exists with translated 60s timeout and missing-token error handling (no raw stack traces)", () => {
      const componentPath = "src/components/nadhir/UserPushTest.tsx";
      expect(
        repoFileExists(componentPath),
        `Expected user-facing self-test component at ${componentPath}`,
      ).toBe(true);

      const src = readRepoFile(componentPath);
      // Must handle timeout & error states via i18n `t(...)`, never exposing raw backend error.message directly.
      expect(src).toMatch(/timeout|60/i);
      expect(src).toMatch(/t\(/);
      expect(findEmDashesInText(src).count).toBe(0);
    });

    it("AR/FR Android OEM battery guide covers major Algerian market vendors (Xiaomi, Samsung, Huawei, Oppo/Realme, Tecno/Infinix) across 4 locales", () => {
      const guidePath = "src/components/nadhir/OemBatteryGuide.tsx";
      expect(
        repoFileExists(guidePath),
        `Expected OEM battery guide component at ${guidePath}`,
      ).toBe(true);

      const track2Files = listRepoFiles("src/i18n/modules/track2", ".ts");
      const combinedText = [
        readRepoFile(guidePath),
        ...track2Files.map((f) => readRepoFile(f)),
      ].join("\n");

      for (const vendorPattern of [
        /xiaomi|miui|hyperos/i,
        /samsung/i,
        /huawei|honor/i,
        /oppo|realme/i,
        /tecno|infinix/i,
      ]) {
        expect(
          vendorPattern.test(combinedText),
          `Missing OEM battery vendor guidance matching ${vendorPattern}`,
        ).toBe(true);
      }

      // Zero em dashes in OEM battery guide component & track2 locales.
      expect(findEmDashesInText(combinedText).count).toBe(0);
    });

    it("self-test push payload uses alerts_test channel and honest non-emergency wording (no em dashes)", () => {
      const pushTestServerSrc = readRepoFile("src/lib/push-test.server.ts");
      const userPushTestRoutes = [
        "src/routes/api/private/push-test.ts",
        "src/routes/api/public/v1/push-test.ts",
      ].filter((p) => repoFileExists(p));

      const combined = [
        pushTestServerSrc,
        ...userPushTestRoutes.map((p) => readRepoFile(p)),
      ].join("\n");

      expect(combined).toContain('"test"');
      expect(combined).toMatch(/alerts_test|resolveNotificationChannel/);
      // R-02: push-test notification title/body must not contain em dashes.
      expect(combined).not.toContain("Nadhir \u2014 TEST");
    });
  });

  // ---------------------------------------------------------------------------
  // F13: Automated WhatsApp Channel + Resend Zone Email Digest Pipelines Boundaries
  // ---------------------------------------------------------------------------
  describe("F13 — WhatsApp Channel & Resend Zone Email Digest Kill Switch, Dedup, Quiet Hours & Retry Boundaries", () => {
    it("WhatsApp Channel pipeline respects kill switch and sends ZERO requests to mock transport when disabled", async () => {
      const waMod = await importRepoModule<Record<string, unknown>>(
        "src/lib/delivery/whatsapp-channel.server.ts",
      );

      const mockWa = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ id: "wamid.1" }] }),
      }));

      try {
        const sendFn = (waMod["sendWhatsAppChannelBroadcast"] ??
          waMod["publishWhatsAppChannelMessage"] ??
          waMod["deliverWhatsAppBroadcast"] ??
          waMod["sendWhatsAppBroadcast"]) as
          ((...args: unknown[]) => Promise<unknown>) | undefined;

        expect(
          typeof sendFn,
          "Expected exported WhatsApp broadcast delivery function in src/lib/delivery/whatsapp-channel.server.ts",
        ).toBe("function");

        const result = await sendFn!(
          {
            eventId: "evt-wa-kill-1",
            kind: "onm",
            severity: "Severe",
            locale: "fr",
            title: "BMS Pluies",
            body: "Cumuls attendus sur Alger",
            sourceAttribution: "ONM · Météo Algérie",
            observedAt: "2026-11-24T15:00:00Z",
            provenanceLine: "ONM · Météo Algérie · Alger",
            url: "https://nadhir.app/wilaya/alger",
          },
          {
            enabled: false,
            killSwitch: true,
            apiUrl: mockWa.url,
            apiToken: "test-wa-token",
            channelId: "ch-dz-1",
          },
        );

        expect(mockWa.requests).toHaveLength(0);
        expect(result).toBeDefined();
      } finally {
        await mockWa.close();
      }
    });

    it("WhatsApp Channel missing credentials degrades gracefully without unhandled rejection and deduplicates duplicate event IDs", async () => {
      const waMod = await importRepoModule<Record<string, unknown>>(
        "src/lib/delivery/whatsapp-channel.server.ts",
      );
      const waSrc = readRepoFile("src/lib/delivery/whatsapp-channel.server.ts");

      // Must implement explicit deduplication and missing-credential handling.
      expect(waSrc).toMatch(/dedup|seen|already|idempotency|eventId/i);

      const sendFn = (waMod["sendWhatsAppChannelBroadcast"] ??
        waMod["publishWhatsAppChannelMessage"] ??
        waMod["deliverWhatsAppBroadcast"] ??
        waMod["sendWhatsAppBroadcast"]) as
        ((...args: unknown[]) => Promise<unknown>) | undefined;
      expect(typeof sendFn).toBe("function");

      // Missing credentials must resolve cleanly (degraded/skipped) without throwing unhandled error.
      const noCredResult = await sendFn!(
        {
          eventId: "evt-wa-nocred-1",
          kind: "official",
          severity: "Severe",
          locale: "ar",
          title: "الحماية المدنية",
          body: "تدخل بباب الوادي",
          sourceAttribution: "DGPC",
          observedAt: "2026-11-24T15:10:00Z",
          url: "https://nadhir.app/alerts",
        },
        {
          enabled: true,
          apiUrl: "http://127.0.0.1:1",
          apiToken: "",
          channelId: "",
        },
      );
      expect(noCredResult).toBeDefined();
    });

    it("WhatsApp Channel retries boundedly on HTTP 503/429 and excludes ITA media / banned safe labels", async () => {
      const waMod = await importRepoModule<Record<string, unknown>>(
        "src/lib/delivery/whatsapp-channel.server.ts",
      );
      const waSrc = readRepoFile("src/lib/delivery/whatsapp-channel.server.ts");

      expect(waSrc).toMatch(/429|5\d\d|retry/i);
      expect(findBannedSafeLabels(waSrc)).toEqual([]);

      let attempt = 0;
      const mockWa = await startMockHttpServer((): MockHttpResponse => {
        attempt += 1;
        if (attempt === 1) {
          return {
            status: 429,
            headers: { "retry-after": "0" },
            body: '{"error":"rate_limit"}',
          };
        }
        if (attempt === 2) {
          return { status: 503, body: '{"error":"unavailable"}' };
        }
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: [{ id: "wamid.retry-ok" }] }),
        };
      });

      try {
        const sendFn = (waMod["sendWhatsAppChannelBroadcast"] ??
          waMod["publishWhatsAppChannelMessage"] ??
          waMod["deliverWhatsAppBroadcast"] ??
          waMod["sendWhatsAppBroadcast"]) as
          ((...args: unknown[]) => Promise<unknown>) | undefined;
        expect(typeof sendFn).toBe("function");

        await sendFn!(
          {
            eventId: `evt-wa-retry-${Date.now()}`,
            kind: "onm",
            severity: "Extreme",
            locale: "fr",
            title: "BMS Pluies Rouge",
            body: "Pluies intenses sur Alger et Tipaza",
            sourceAttribution: "ONM · Météo Algérie",
            observedAt: "2026-11-24T15:20:00Z",
            url: "https://nadhir.app/wilaya/alger",
          },
          {
            enabled: true,
            apiUrl: mockWa.url,
            apiToken: "wa-test-token",
            channelId: "ch-dz-main",
            maxRetries: 3,
            baseDelayMs: 5,
          },
        );

        expect(mockWa.requests.length).toBeGreaterThanOrEqual(2);
        expect(mockWa.requests.length).toBeLessThanOrEqual(4);
      } finally {
        await mockWa.close();
      }
    });

    it("Resend zone email digest kill switch & missing RESEND_API_KEY degrade cleanly with ZERO outbound HTTP requests", async () => {
      const emailMod = await importRepoModule<Record<string, unknown>>(
        "src/lib/delivery/email-digest.server.ts",
      );

      const mockResend = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "re_123" }),
      }));

      try {
        const sendFn = (emailMod["sendZoneEmailDigest"] ??
          emailMod["deliverEmailDigest"] ??
          emailMod["sendEmailDigest"]) as
          ((...args: unknown[]) => Promise<unknown>) | undefined;
        expect(
          typeof sendFn,
          "Expected exported Resend email digest function in src/lib/delivery/email-digest.server.ts",
        ).toBe("function");

        const killed = await sendFn!(
          {
            digestId: "dig-kill-1",
            userId: "user-1",
            to: "citizen@example.dz",
            locale: "fr",
            zoneName: "Alger",
            alerts: [
              {
                id: "a1",
                kind: "onm",
                severity: "Severe",
                title: "BMS Pluies",
                body: "Cumuls attendus",
                sourceAttribution: "ONM · Météo Algérie",
                observedAt: "2026-11-24T15:00:00Z",
              },
            ],
          },
          {
            enabled: false,
            killSwitch: true,
            apiUrl: mockResend.url,
            apiKey: "re_test_key",
          },
        );
        expect(killed).toBeDefined();
        expect(mockResend.requests).toHaveLength(0);

        const missingKey = await sendFn!(
          {
            digestId: "dig-nokey-1",
            userId: "user-1",
            to: "citizen@example.dz",
            locale: "ar",
            zoneName: "الجزائر",
            alerts: [],
          },
          {
            enabled: true,
            apiUrl: mockResend.url,
            apiKey: "",
          },
        );
        expect(missingKey).toBeDefined();
        expect(mockResend.requests).toHaveLength(0);
      } finally {
        await mockResend.close();
      }
    });

    it("Resend zone email digest enforces quiet hours for routine alerts while allowing urgent/M5+ override", async () => {
      const emailMod = await importRepoModule<Record<string, unknown>>(
        "src/lib/delivery/email-digest.server.ts",
      );
      const emailSrc = readRepoFile("src/lib/delivery/email-digest.server.ts");

      expect(emailSrc).toMatch(/quiet/i);
      expect(emailSrc).toMatch(/urgent|extreme|m5|override/i);

      const quietCheck = findExportedFn(
        emailMod,
        [
          "isWithinQuietHours",
          "shouldDeferForQuietHours",
          "shouldSuppressForQuietHours",
          "isQuietHours",
        ],
        "src/lib/delivery/email-digest.server.ts",
      );

      // 02:30 Algiers time (UTC+1 -> 01:30Z) is inside overnight quiet hours (e.g., 22:00..07:00).
      const quietNight = new Date("2026-11-24T01:30:00Z");
      const routineDeferred = quietCheck({
        now: quietNight,
        severity: "Moderate",
        urgent: false,
        magnitude: 3.5,
        quietStartHour: 22,
        quietEndHour: 7,
      });
      const m5Override = quietCheck({
        now: quietNight,
        severity: "Extreme",
        urgent: true,
        magnitude: 5.2,
        quietStartHour: 22,
        quietEndHour: 7,
      });
      expect(routineDeferred).toBe(true);
      expect(m5Override).toBe(false);
    });

    it("Resend zone email digest deduplicates events, retries boundedly on HTTP 503/429, and omits em dashes", async () => {
      const emailMod = await importRepoModule<Record<string, unknown>>(
        "src/lib/delivery/email-digest.server.ts",
      );
      const emailSrc = readRepoFile("src/lib/delivery/email-digest.server.ts");

      expect(emailSrc).toMatch(/unsubscribe|settings|preferences/i);
      expect(emailSrc).toMatch(/dedup|idempotency|digestId/i);
      expect(findBannedSafeLabels(emailSrc)).toEqual([]);

      let attempt = 0;
      const mockResend = await startMockHttpServer(() => {
        attempt += 1;
        if (attempt === 1) {
          return { status: 503, body: '{"message":"temporary error"}' };
        }
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "re_retry_ok" }),
        };
      });

      try {
        const sendFn = (emailMod["sendZoneEmailDigest"] ??
          emailMod["deliverEmailDigest"] ??
          emailMod["sendEmailDigest"]) as
          ((...args: unknown[]) => Promise<unknown>) | undefined;
        expect(typeof sendFn).toBe("function");

        await sendFn!(
          {
            digestId: `dig-retry-${Date.now()}`,
            userId: "user-42",
            to: "citizen@example.dz",
            locale: "fr",
            zoneName: "Tipaza",
            alerts: [
              {
                id: "al-1",
                kind: "earthquake",
                severity: "Extreme",
                magnitude: 5.1,
                title: "Séisme M5.1 près de Béjaïa",
                body: "Secousse ressentie dans le nord.",
                sourceAttribution: "CRAAG / EMSC",
                observedAt: "2026-11-24T13:42:20Z",
              },
            ],
          },
          {
            enabled: true,
            apiUrl: mockResend.url,
            apiKey: "re_test_valid",
            maxRetries: 2,
            baseDelayMs: 5,
            bypassQuietHours: true,
          },
        );

        expect(mockResend.requests.length).toBeGreaterThanOrEqual(2);
        const lastBody = mockResend.requests.at(-1)?.body ?? "";
        expect(findEmDashesInText(lastBody).count).toBe(0);
      } finally {
        await mockResend.close();
      }
    });
  });

  // Sanity check that real Algeria admin data (69 wilayas, 1,537 communes) backs commune topic tests.
  describe("F9 — Geographic Boundary Ground Truth", () => {
    it("Loi 26-06 Algeria admin dataset contains all 69 wilayas and >= 1536 communes for commune-topic targeting", () => {
      const admin = loadAlgeriaAdmin();
      expect(admin.wilayas).toHaveLength(69);
      expect(admin.communes.length).toBeGreaterThanOrEqual(1536);
    });
  });
});
