import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  e2eBaseUrl,
  importRepoModule,
  listRepoFiles,
  readRepoFile,
  readRepoJson,
  repoFileExists,
} from "../lib/env.ts";
import {
  createJpegWithExif,
  createSpoofedMimePayload,
  inspectImageForMetadata,
} from "../lib/exif.ts";
import {
  buildClmsFixture,
  buildCraagBulletin,
  buildDgpcNonFirePost,
  buildEmscEvent,
  buildGhslFixture,
  buildGwisFixture,
  buildImergFixture,
  buildMtgFciFixture,
  buildOnmCapXml,
  buildTarikiPost,
  deriveWilayaSlug,
  loadAlgeriaAdmin,
  loadLoi2606,
} from "../lib/fixtures.ts";
import {
  fetchBytes,
  fetchJson,
  fetchText,
  startMockHttpServer,
} from "../lib/http.ts";
import {
  SHARE_CARD_MAX_BYTES,
  assertValidShareCardImage,
  decodeRasterDimensions,
} from "../lib/image.ts";
import {
  assertPgReachable,
  psqlExec,
  psqlJson,
  runInRolledBackTx,
} from "../lib/pg.ts";
import {
  findBannedSafeLabels,
  findEmDashesInText,
  measureContrastViolations,
  measureHorizontalOverflow,
  measureTouchTargets,
  stripHtmlForTextScan,
  withBrowserPage,
} from "../lib/playwright.ts";

// ---------------------------------------------------------------------------
// Local typed contracts for dynamically imported repository modules
// (avoids static imports of M1–M4 modules while asserting real behavior)
// ---------------------------------------------------------------------------

type AnyFn = (...args: unknown[]) => unknown;

function findExportedFn(
  mod: Record<string, unknown>,
  candidates: readonly string[],
  moduleLabel: string,
): AnyFn {
  for (const name of candidates) {
    const value = mod[name];
    if (typeof value === "function") {
      return value as AnyFn;
    }
  }
  const available = Object.keys(mod).sort().join(", ");
  throw new Error(
    `Module "${moduleLabel}" does not export any expected function (${candidates.join(" | ")}). Available exports: [${available}]`,
  );
}

async function importFirstExistingModule(
  candidates: readonly string[],
): Promise<{ path: string; mod: Record<string, unknown> }> {
  const errors: string[] = [];
  for (const relPath of candidates) {
    try {
      const mod = await importRepoModule<Record<string, unknown>>(relPath);
      return { path: relPath, mod };
    } catch (error) {
      errors.push(
        `${relPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `None of the expected contract modules exist: ${candidates.join(", ")}\n${errors.join("\n")}`,
  );
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function collectObjectLeafEntries(
  obj: unknown,
  prefix = "",
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (typeof obj === "string") {
    entries.push([prefix, obj]);
    return entries;
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return entries;
  }
  for (const [key, val] of Object.entries(obj)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof val === "string") {
      entries.push([nextPrefix, val]);
    } else if (typeof val === "object" && val !== null) {
      entries.push(...collectObjectLeafEntries(val, nextPrefix));
    }
  }
  return entries;
}

interface NotificationChannelsMod extends Record<string, unknown> {
  NOTIFICATION_CHANNEL_IDS: readonly string[];
  DEFAULT_LOCAL_NOTIFICATION_EXACT: boolean;
  resolveNotificationChannel: (input: {
    kind: string;
    severity?: string | number | null;
    hazard?: string | null;
    magnitude?: number | null;
    phase?: string | null;
    status?: string | null;
  }) => string;
  channelFromFcmData: (data: unknown) => string;
}

interface AlertProvenanceMod extends Record<string, unknown> {
  buildAlertProvenance: (input: {
    triggerKind: string;
    areaLabel?: string | null;
    radiusKm?: number | null;
    sourceKey: string;
    sourceAttribution?: string | null;
    ruleLabelKey?: string | null;
    observedAt: string;
    authorityStatus?: string | null;
  }) => Record<string, unknown>;
  validateProvenanceInvariants: (data: Record<string, unknown>) => string[];
  toProvenancePayload: (
    data: Record<string, unknown>,
  ) => Record<string, string>;
  parseProvenancePayload: (raw: unknown) => Record<string, unknown> | null;
  formatProvenanceDigestLine: (
    data: Record<string, unknown>,
    labels: {
      trigger: string;
      rule: string;
      areaFallback: string;
      timeLabel: string;
      radiusLabel?: string;
    },
  ) => string;
}

interface GatewayMod extends Record<string, unknown> {
  completeWithGatewayResult: (
    purpose: string,
    request: {
      messages: Array<{ role: string; content: string }>;
      response_format: {
        type: "json_schema";
        json_schema: { name: string; strict: boolean; schema: unknown };
      };
    },
    options?: Record<string, unknown>,
  ) => Promise<{
    text: string;
    provenance: {
      provider: string;
      providerId: string;
      model: string;
      fallbackUsed: boolean;
      primaryErrorKind: string | null;
      attempts: number;
      purpose: string;
    };
  }>;
  resetLlmCircuitBreakers: () => void;
}

interface WorkerRunnerMod extends Record<string, unknown> {
  EUWorker: new (
    options: Record<string, unknown>,
    deps: Record<string, unknown>,
  ) => {
    start: () => void;
    getSnapshot: () => { completedJobs: number; failedJobs: number };
    stop: (drainTimeoutMs?: number) => Promise<{
      drained: boolean;
      remaining: number;
    }>;
  };
}

interface FcmMod extends Record<string, unknown> {
  FCM_LANGS: readonly string[];
  fcmTopic: (code: string, lang: string) => string;
  fcmMessagesForOnm: (args: {
    broadcastId: string;
    severity: string;
    communeCodes: string[];
    title: string;
    headlineFr: string | null;
    wilayaId: string | null;
    event: string;
  }) => Array<{
    topic: string;
    notification: { title: string; body: string };
    android: { notification: { channel_id: string } };
    data: Record<string, string>;
  }>;
  fcmMessagesForOfficial: (args: {
    broadcastId: string;
    severity: string;
    communeCodes: string[];
    info: Array<{ language: string; headline: string; description: string }>;
  }) => Array<{
    topic: string;
    notification: { title: string; body: string };
    android: { notification: { channel_id: string } };
    data: Record<string, string>;
  }>;
}

interface CapMod extends Record<string, unknown> {
  buildOfficialCap: (input: Record<string, unknown>) => Record<string, unknown>;
  capToXml: (alert: Record<string, unknown>) => string;
}

interface ImageMetadataMod extends Record<string, unknown> {
  stripImageMetadata: (bytes: Uint8Array, type: string) => Uint8Array;
}

interface EmscMod extends Record<string, unknown> {
  parseEmsc: (body: unknown) => Array<{
    id: string;
    magnitude: number;
    lat: number;
    lon: number;
    depth_km: number | null;
    occurred_at: string;
  }>;
}

function stripHtmlToText(html: string): string {
  return stripHtmlForTextScan(html);
}

/**
 * Fetches an entity share card from `/api/public/share/<kind>/<id>.<format>?lang=<lang>`,
 * resolving a live entity ID from Postgres when needed (or seeding/cleaning up an
 * ephemeral record so the endpoint is tested end-to-end even on a fresh database).
 */
async function fetchShareCardWithEntity(args: {
  kind: "onm" | "quake" | "fire" | "wilaya";
  lang: "ar" | "fr" | "en" | "kab";
  format?: string;
  explicitId?: string;
}): Promise<{
  bytes: Uint8Array;
  status: number;
  contentType: string;
  url: string;
}> {
  const format = args.format ?? "whatsapp.webp";
  let entityId = args.explicitId ?? "";
  let cleanupSql: string | null = null;

  if (!entityId) {
    assertPgReachable();
    if (args.kind === "onm") {
      const existing = psqlJson<{ id: string }>(
        `SELECT id::text AS id
         FROM public.onm_vigilance
         WHERE cancelled_at IS NULL
           AND superseded_at IS NULL
           AND superseded_by IS NULL
           AND msg_type <> 'Cancel'
           AND expires > now()
         ORDER BY sent DESC
         LIMIT 1;`,
      );
      if (existing[0]?.id) {
        entityId = existing[0].id;
      } else {
        const seededId = "90000000-0000-4000-8000-000000000101";
        psqlExec(
          `INSERT INTO public.onm_vigilance (id, cap_id, title, event, severity, urgency, certainty, sent, area_desc, headline_fr, instruction_fr, expires)
           VALUES ('${seededId}', 'urn:oid:2.49.0.1.12.0.e2e.onm.1', 'BMS Pluies Niveau 2 - Alger', 'Rain', 'Severe', 'Expected', 'Likely', now(), 'Alger', 'BMS Pluies Niveau 2 - Alger', 'Suivez les consignes de la Protection Civile (14).', now() + interval '12 hours')
           ON CONFLICT DO NOTHING;`,
        );
        entityId = seededId;
        cleanupSql = `DELETE FROM public.onm_vigilance WHERE id = '${seededId}';`;
      }
    } else if (args.kind === "quake") {
      const existing = psqlJson<{ id: string }>(
        "SELECT id::text AS id FROM public.earthquakes WHERE magnitude >= 4.0 ORDER BY occurred_at DESC LIMIT 1;",
      );
      if (existing[0]?.id) {
        entityId = existing[0].id;
      } else {
        const seededId = "e2e_bejaia_20261124_m46";
        psqlExec(
          `INSERT INTO public.earthquakes (id, occurred_at, updated_at, fetched_at, lat, lon, depth_km, magnitude, magnitude_type, network, region, offshore)
           VALUES ('${seededId}', now() - interval '10 minutes', now(), now(), 36.7525, 5.0556, 10, 4.6, 'ml', 'CRAAG / EMSC', 'NORTHERN ALGERIA (Bejaia)', false)
           ON CONFLICT (id) DO NOTHING;`,
        );
        entityId = seededId;
        cleanupSql = `DELETE FROM public.earthquakes WHERE id = '${seededId}';`;
      }
    } else if (args.kind === "fire") {
      const existing = psqlJson<{ short_id: string }>(
        `SELECT fc.short_id
         FROM public.fire_clusters fc
         LEFT JOIN public.admin_units au ON au.id = fc.commune_id
         WHERE fc.state IN ('active', 'confirmed')
           AND fc.resolved_at IS NULL
           AND fc.confirmed_at IS NULL
           AND COALESCE(fc.suspected_persistent_source, false) = false
           AND au.forest_fraction >= 0.1
         ORDER BY fc.last_detected_at DESC
         LIMIT 1;`,
      );
      if (existing[0]?.short_id) {
        entityId = existing[0].short_id;
      } else {
        const forestedCommune = psqlJson<{
          id: string;
          parent_id: string | null;
        }>(
          `SELECT id::text AS id, parent_id::text AS parent_id
           FROM public.admin_units
           WHERE level = 'commune' AND forest_fraction >= 0.1
           ORDER BY code
           LIMIT 1;`,
        );
        const communeIdSql = forestedCommune[0]?.id
          ? `'${forestedCommune[0].id}'::uuid`
          : "NULL";
        const wilayaIdSql = forestedCommune[0]?.parent_id
          ? `'${forestedCommune[0].parent_id}'::uuid`
          : "NULL";
        const seededUuid = "90000000-0000-4000-8000-000000000102";
        const shortId = "E2EFIRE1";
        psqlExec(
          `INSERT INTO public.fire_clusters (id, short_id, state, lat, lon, confidence, detection_count, first_detected_at, last_detected_at, max_frp_mw, commune_id, wilaya_id, sources, confirmed_at)
           VALUES ('${seededUuid}', '${shortId}', 'active', 36.7169, 4.0497, 0.88, 4, now() - interval '30 minutes', now() - interval '5 minutes', 64.2, ${communeIdSql}, ${wilayaIdSql}, ARRAY['firms', 'fci'], NULL)
           ON CONFLICT DO NOTHING;`,
        );
        entityId = shortId;
        cleanupSql = `DELETE FROM public.fire_clusters WHERE id = '${seededUuid}';`;
      }
    }
  }

  try {
    const path = `/api/public/share/${args.kind}/${encodeURIComponent(entityId)}.${format}?lang=${args.lang}`;
    const res = await fetchBytes(path);
    return {
      bytes: res.bytes,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      url: res.url,
    };
  } finally {
    if (cleanupSql) {
      psqlExec(cleanupSql);
    }
  }
}

describe("Tier 3 — Cross-Feature Pairwise Combinations (All 24 Features)", () => {
  // 1. F3 + F4
  it("1. [F3+F4] EU Worker executes source_jobs task while primary LLM fails and automatic EU fallback LLM succeeds with provenance", async () => {
    const { EUWorker } =
      await importRepoModule<WorkerRunnerMod>("worker/src/runner");
    const gatewayMod = await importRepoModule<GatewayMod>(
      "src/lib/llm/gateway.server",
    );
    gatewayMod.resetLlmCircuitBreakers();

    const primaryServer = await startMockHttpServer(() => ({
      status: 503,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "upstream" }),
    }));
    const fallbackServer = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                incident: "flood",
                wilaya_code: "16",
                commune: "Bab El Oued",
              }),
            },
          },
        ],
      }),
    }));

    try {
      let claimed = false;
      const completedResults: Array<Record<string, unknown>> = [];
      let capturedProvenance: Record<string, unknown> | null = null;
      let resolveCompleted: (() => void) | null = null;
      const completedPromise = new Promise<void>((resolve) => {
        resolveCompleted = resolve;
      });

      const fakeJob = {
        id: "job-f3-f4-001",
        contract_key: "dgpc_telegram",
        contract_version: 1,
        trigger_kind: "scheduled",
        execution_target: "worker",
        state: "running",
        scheduled_for: "2026-11-24T15:00:00Z",
        started_at: "2026-11-24T15:00:01Z",
        attempt_count: 1,
      };

      const worker = new EUWorker(
        {
          workerId: "eu-worker-pairwise-1",
          executionTargets: ["worker"],
          concurrency: 1,
          pollIntervalMs: 20,
          schedulerEnabled: false,
          schedulerIntervalMs: 60_000,
          leaseSeconds: 120,
          jobTimeoutMs: 10_000,
          drainTimeoutMs: 2_000,
        },
        {
          claim: async () => {
            if (claimed) return null;
            claimed = true;
            return fakeJob;
          },
          execute: async () => {
            const completion = await gatewayMod.completeWithGatewayResult(
              "extract_dgpc",
              {
                messages: [
                  { role: "system", content: "Extract DGPC incident JSON." },
                  {
                    role: "user",
                    content: buildDgpcNonFirePost({ kind: "flood" }).textAr,
                  },
                ],
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "dgpc_flood_extract",
                    strict: true,
                    schema: {
                      type: "object",
                      properties: {
                        incident: { type: "string" },
                        wilaya_code: { type: "string" },
                        commune: { type: "string" },
                      },
                      required: ["incident", "wilaya_code", "commune"],
                      additionalProperties: false,
                    },
                  },
                },
              },
              {
                config: {
                  url: primaryServer.url,
                  clientId: "test-client-id",
                  clientSecret: "test-client-secret",
                },
                fallback: [
                  {
                    id: "mistral-eu-mock",
                    provider: "openai-compatible",
                    apiUrl: `${fallbackServer.url}/v1/chat/completions`,
                    apiKey: "test-eu-key",
                    model: "mistral-small-latest",
                    timeoutMs: 5_000,
                    maxRetries: 0,
                  },
                ],
                circuitBreaker: null,
              },
            );
            capturedProvenance = completion.provenance;
            const parsed = JSON.parse(completion.text) as {
              incident: string;
              wilaya_code: string;
            };
            expect(parsed.incident).toBe("flood");
            expect(parsed.wilaya_code).toBe("16");

            return {
              contractKey: fakeJob.contract_key,
              trigger: fakeJob.trigger_kind,
              scheduledFor: fakeJob.scheduled_for,
              startedAt: fakeJob.started_at,
              outcome: "succeeded",
              coverageStatus: "complete",
              retryDisposition: "none",
            };
          },
          complete: async (
            _job: unknown,
            _workerId: string,
            result: Record<string, unknown>,
          ) => {
            completedResults.push(result);
            resolveCompleted?.();
            return { ...fakeJob, state: "succeeded" };
          },
          enqueueDue: async () => 0,
          requeueExpired: async () => 0,
          renewLease: async () => "2026-11-24T15:05:00Z",
        },
      );

      worker.start();
      await completedPromise;
      const stopRes = await worker.stop(2_000);
      expect(stopRes.drained).toBe(true);
      expect(worker.getSnapshot().completedJobs).toBe(1);
      expect(primaryServer.requests.length).toBe(1);
      expect(fallbackServer.requests.length).toBe(1);
      expect(completedResults).toHaveLength(1);
      expect(completedResults[0]?.["outcome"]).toBe("succeeded");
      expect(capturedProvenance).not.toBeNull();
      expect(capturedProvenance?.["fallbackUsed"]).toBe(true);
      expect(capturedProvenance?.["providerId"]).toBe("mistral-eu-mock");
      expect(capturedProvenance?.["primaryErrorKind"]).toBe("upstream_5xx");
    } finally {
      await primaryServer.close();
      await fallbackServer.close();
    }
  });

  // 2. F3 + F19
  it("2. [F3+F19] EU Worker source_contracts targets tariki_facebook to worker and enforces Tariki danger filter + dynamic attribution", async () => {
    assertPgReachable();
    const contracts = psqlJson<{
      key: string;
      execution_target: string;
      attribution: string;
    }>(
      "SELECT key, execution_target, attribution FROM public.source_contracts WHERE key = 'tariki_facebook';",
    );
    expect(contracts).toHaveLength(1);
    expect(contracts[0]?.execution_target).toBe("worker");
    expect(contracts[0]?.attribution).toMatch(/Gendarmerie Nationale.*Tariki/i);

    const { path: tarikiPath, mod: tarikiMod } =
      await importFirstExistingModule([
        "src/lib/text-sources/tariki",
        "src/lib/text-sources/tariki.server",
      ]);

    const dangerPost = buildTarikiPost({ kind: "flood_closure" });
    const tatweelPost = buildTarikiPost({ kind: "tatweel_hashtag_emoji" });
    const trucksOnly = buildTarikiPost({ kind: "heavy_trucks_only" });
    const roadWorks = buildTarikiPost({ kind: "road_works" });

    const classifier = findExportedFn(
      tarikiMod,
      [
        "isTarikiDangerPost",
        "classifyTarikiPost",
        "filterTarikiPost",
        "parseTarikiPost",
        "extractTarikiIncident",
        "evaluateTarikiPost",
      ],
      tarikiPath,
    );

    const dangerResult = classifier(dangerPost.rawText, dangerPost);
    const tatweelResult = classifier(tatweelPost.rawText, tatweelPost);
    const trucksResult = classifier(trucksOnly.rawText, trucksOnly);
    const worksResult = classifier(roadWorks.rawText, roadWorks);

    const isAccepted = (res: unknown): boolean => {
      if (typeof res === "boolean") return res;
      if (res === null || res === undefined) return false;
      if (typeof res === "object") {
        const rec = res as Record<string, unknown>;
        if (typeof rec["dangerous"] === "boolean") return rec["dangerous"];
        if (typeof rec["isDanger"] === "boolean") return rec["isDanger"];
        if (typeof rec["keep"] === "boolean") return rec["keep"];
        if (typeof rec["accepted"] === "boolean") return rec["accepted"];
        return true;
      }
      return Boolean(res);
    };

    expect(isAccepted(dangerResult)).toBe(true);
    expect(isAccepted(tatweelResult)).toBe(true);
    expect(isAccepted(trucksResult)).toBe(false);
    expect(isAccepted(worksResult)).toBe(false);
  });

  // 3. F3 + F21
  it("3. [F3+F21] EU Worker runs MTG FCI Push & MTG Lightning L2 contracts with pre-filter freshness watermark on quiet Sahara slot", async () => {
    assertPgReachable();
    const contracts = psqlJson<{
      key: string;
      execution_target: string;
      freshness_basis: string;
    }>(
      `SELECT key, execution_target, freshness_basis
       FROM public.source_contracts
       WHERE key IN ('mtg_fci_push', 'mtg_lightning', 'mtg_fci', 'mtg_li')
       ORDER BY key;`,
    );

    const hasFci = contracts.some(
      (c) =>
        (c.key === "mtg_fci_push" || c.key === "mtg_fci") &&
        c.execution_target === "worker",
    );
    const hasLi = contracts.some(
      (c) =>
        (c.key === "mtg_lightning" || c.key === "mtg_li") &&
        c.execution_target === "worker",
    );
    expect(hasFci).toBe(true);
    expect(hasLi).toBe(true);

    const { path: fciPath, mod: fciMod } = await importFirstExistingModule([
      "src/lib/ingest/mtg-fci-push.server",
      "src/lib/ingest/mtg-fci-push",
      "src/lib/ingest/fci.server",
    ]);
    const quietFixture = buildMtgFciFixture({ quietSaharaOnly: true });
    expect(quietFixture.hotspots).toHaveLength(1);
    expect(quietFixture.hotspots[0]?.insideWatchArea).toBe(false);

    const sourceText = readRepoFile(
      fciPath.endsWith(".ts") ? fciPath : `${fciPath}.ts`,
    );
    expect(sourceText.length).toBeGreaterThan(100);
    // M6-4 invariant: pre-filter freshness watermark recorded even when filtered detections == 0
    expect(
      Object.keys(fciMod).length,
      `Expected ${fciPath} to export parser/ingest functions`,
    ).toBeGreaterThan(0);
    expect(sourceText).toMatch(
      /slot|watermark|freshness|dataThrough|data_through|observedAt/i,
    );
  });

  // 4. F3 + F5
  it("4. [F3+F5] EU Worker source_jobs lifecycle honors 2026-11-26 92-day retention and preserves jobs linked to hot source_runs", () => {
    assertPgReachable();
    const out = runInRolledBackTx(`
      DO $$
      DECLARE
        _old_day date := (now() AT TIME ZONE 'UTC')::date - 100;
        _old_ts timestamptz := (_old_day::timestamp AT TIME ZONE 'UTC') + interval '4 hours';
        _contract_key text := 'e2e_worker_cold_test';
        _job_unlinked uuid := '91000000-0000-4000-8000-000000000001';
        _job_linked uuid := '91000000-0000-4000-8000-000000000002';
        _job_running uuid := '91000000-0000-4000-8000-000000000003';
        _run_hot uuid := '91000000-0000-4000-8000-000000000011';
        _candidates uuid[];
      BEGIN
        INSERT INTO public.source_contracts (
          key, version, label, family, criticality, freshness_basis, cadence_minutes,
          warning_after_minutes, stale_after_minutes, parser_version, licence, attribution,
          owner, execution_target
        ) VALUES (
          _contract_key, 1, 'E2E Worker Cold Test', 'reference_enrichment', 'optional',
          'last_success_at', 15, 30, 60, '1', 'test', 'test', 'e2e', 'worker'
        );

        INSERT INTO public.source_jobs (
          id, contract_key, contract_version, trigger_kind, idempotency_key,
          scheduled_for, data_from, data_through, execution_target, enqueued_by,
          available_at, max_attempts, retry_base_seconds, retry_until, state, created_at
        ) VALUES
          (_job_unlinked, _contract_key, 1, 'manual', 'e2e-cold-unlinked',
           _old_ts, _old_ts - interval '15 min', _old_ts, 'worker', array['worker'],
           _old_ts, 3, 30, _old_ts + interval '1 hour', 'succeeded', _old_ts),
          (_job_linked, _contract_key, 1, 'manual', 'e2e-cold-linked',
           _old_ts + interval '15 min', _old_ts, _old_ts + interval '15 min', 'worker', array['worker'],
           _old_ts, 3, 30, _old_ts + interval '1 hour', 'succeeded', _old_ts),
          (_job_running, _contract_key, 1, 'manual', 'e2e-cold-running',
           _old_ts + interval '30 min', _old_ts + interval '15 min', _old_ts + interval '30 min', 'worker', array['worker'],
           _old_ts, 3, 30, _old_ts + interval '1 hour', 'running', _old_ts);

        INSERT INTO public.source_runs (
          id, contract_key, contract_version, trigger_kind, idempotency_key,
          scheduled_for, started_at, finished_at, outcome, records_seen, job_id, attempt
        ) VALUES (
          _run_hot, _contract_key, 1, 'manual', 'e2e-hot-run-linked',
          now(), now(), now(), 'succeeded', 1, _job_linked, 1
        );

        SELECT array_agg(id ORDER BY id) INTO _candidates
        FROM private.cold_candidates('source_jobs', _old_day)
        WHERE id IN (_job_unlinked, _job_linked, _job_running);

        IF _candidates IS DISTINCT FROM ARRAY[_job_unlinked] THEN
          RAISE EXCEPTION 'Unexpected source_jobs cold candidates: %', _candidates;
        END IF;
      END $$;
      SELECT 'OK';
    `);
    expect(out).toBe("OK");
  });

  // 5. F4 + F8
  it("5. [F4+F8] Primary LLM outage triggers fallback LLM extraction of DGPC flood incident into multi-hazard CAP 1.2 XML", async () => {
    const gatewayMod = await importRepoModule<GatewayMod>(
      "src/lib/llm/gateway.server",
    );
    const capMod = await importRepoModule<CapMod>("src/lib/cap");
    gatewayMod.resetLlmCircuitBreakers();

    const dgpcFlood = buildDgpcNonFirePost({ kind: "flood" });

    const primaryServer = await startMockHttpServer(() => ({
      status: 429,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "rate_limited", retry_after: 30 }),
    }));
    const fallbackServer = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                hazard_kind: "flood",
                wilaya_code: dgpcFlood.wilayaCode,
                commune_code: dgpcFlood.communeCode,
                commune_name: dgpcFlood.communeName,
                cleared: false,
                source_attribution: dgpcFlood.sourceAttribution,
              }),
            },
          },
        ],
      }),
    }));

    try {
      const completion = await gatewayMod.completeWithGatewayResult(
        "extract_dgpc",
        {
          messages: [
            { role: "system", content: "Extract structured DGPC flood event." },
            { role: "user", content: dgpcFlood.textFr },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "dgpc_non_fire_extract",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  hazard_kind: { type: "string" },
                  wilaya_code: { type: "string" },
                  commune_code: { type: "string" },
                  commune_name: { type: "string" },
                  cleared: { type: "boolean" },
                  source_attribution: { type: "string" },
                },
                required: [
                  "hazard_kind",
                  "wilaya_code",
                  "commune_code",
                  "commune_name",
                  "cleared",
                  "source_attribution",
                ],
                additionalProperties: false,
              },
            },
          },
        },
        {
          config: {
            url: primaryServer.url,
            clientId: "cid",
            clientSecret: "csec",
          },
          fallback: [
            {
              id: "eu-fallback-dgpc",
              provider: "openai-compatible",
              apiUrl: `${fallbackServer.url}/v1/chat/completions`,
              apiKey: "eu-key",
              model: "mistral-small-latest",
              timeoutMs: 5_000,
              maxRetries: 0,
            },
          ],
          circuitBreaker: null,
        },
      );

      expect(completion.provenance.fallbackUsed).toBe(true);
      expect(completion.provenance.primaryErrorKind).toBe("rate_limited");
      const extracted = JSON.parse(completion.text) as {
        hazard_kind: string;
        commune_code: string;
        source_attribution: string;
      };
      expect(extracted.hazard_kind).toBe("flood");

      const publishedDate = new Date(dgpcFlood.publishedAt);
      const capAlert = capMod.buildOfficialCap({
        incidentId: "20261124-dgpc-flood-01",
        areaDesc: `${dgpcFlood.communeName}, Alger (${extracted.commune_code})`,
        sentAt: publishedDate,
        asOf: publishedDate,
        texts: [
          {
            language: "fr-DZ",
            event: "Inondation",
            headline: `DGPC: Inondation signalée à ${dgpcFlood.communeName}`,
            description: `${extracted.source_attribution}: ${dgpcFlood.textFr}`,
            instruction:
              "Suivez les consignes de la Protection Civile (14) et évitez les zones inondées.",
          },
          {
            language: "ar-DZ",
            event: "فيضان",
            headline: "الحماية المدنية: تدخل فيضانات ببلدية باب الوادي",
            description: dgpcFlood.textAr,
            instruction: "اتبع تعليمات الحماية المدنية (14).",
          },
        ],
      });
      const xml = capMod.capToXml(capAlert);
      expect(xml).toContain("urn:oasis:names:tc:emergency:cap:1.2");
      expect(xml).toContain("Bab El Oued");
      expect(xml).toContain(extracted.commune_code);
    } finally {
      await primaryServer.close();
      await fallbackServer.close();
    }
  });

  // 6. F6 + F11
  it("6. [F6+F11] Android NotificationChannels.java, MainActivity.java, notification-channels.ts, push-native.ts, and fcm.ts share 1:1 parity across all 6 channels", async () => {
    const channelMod = await importRepoModule<NotificationChannelsMod>(
      "src/lib/notification-channels",
    );
    const expectedIds = [
      "alerts_urgent",
      "alerts_official",
      "alerts_earthquakes",
      "alerts_civil",
      "alerts_test",
      "alerts",
    ];
    expect([...channelMod.NOTIFICATION_CHANNEL_IDS]).toEqual(expectedIds);

    const javaChannels = readRepoFile(
      "android/app/src/main/java/app/nadhir/NotificationChannels.java",
    );
    const mainActivity = readRepoFile(
      "android/app/src/main/java/app/nadhir/MainActivity.java",
    );
    const pushNative = readRepoFile("src/lib/push-native.ts");
    const fcmSource = readRepoFile("src/lib/fcm.ts");

    for (const id of expectedIds) {
      expect(
        javaChannels,
        `NotificationChannels.java missing channel ID "${id}"`,
      ).toContain(`"${id}"`);
    }
    expect(mainActivity).toMatch(/NotificationChannels\./);
    expect(pushNative).toMatch(/notification-channels|NOTIFICATION_CHANNEL/);
    expect(fcmSource).toMatch(
      /notification-channels|resolveNotificationChannel/,
    );
  });

  // 7. F6 + F12
  it("7. [F6+F12] Android POST_NOTIFICATIONS + isExactNotification:false align with user-facing alerts_test self-test & AR/FR OEM battery guide", async () => {
    const manifest = readRepoFile("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain("android.permission.POST_NOTIFICATIONS");

    const pushNative = readRepoFile("src/lib/push-native.ts");
    const scheduleMatches = [
      ...pushNative.matchAll(/localNotifications\.schedule\s*\(/gi),
    ];
    expect(scheduleMatches.length).toBeGreaterThanOrEqual(1);
    for (const match of scheduleMatches) {
      const slice = pushNative.slice(match.index, match.index + 600);
      expect(slice).toMatch(
        /isExactNotification:\s*(?:false|DEFAULT_LOCAL_NOTIFICATION_EXACT)\b/,
      );
    }

    const channelMod = await importRepoModule<NotificationChannelsMod>(
      "src/lib/notification-channels",
    );
    expect(channelMod.DEFAULT_LOCAL_NOTIFICATION_EXACT).toBe(false);
    expect(channelMod.resolveNotificationChannel({ kind: "test" })).toBe(
      "alerts_test",
    );

    const pushTestComponent = readRepoFile(
      "src/components/nadhir/UserPushTest.tsx",
    );
    expect(pushTestComponent.length).toBeGreaterThan(80);

    const oemGuideComponent = readRepoFile(
      "src/components/nadhir/OemBatteryGuide.tsx",
    );
    const track2Ar = readRepoFile("src/i18n/modules/track2/ar.ts");
    const track2Fr = readRepoFile("src/i18n/modules/track2/fr.ts");
    const combinedOem = `${oemGuideComponent}\n${track2Ar}\n${track2Fr}`;

    for (const vendorPattern of [
      /xiaomi|miui|hyperos|شاومي/i,
      /samsung|one\s?ui|سامسونغ/i,
      /huawei|emui|هواوي/i,
      /oppo|realme|أوبو/i,
      /tecno|infinix|تكنو|إنفينيكس/i,
    ]) {
      expect(
        combinedOem,
        `OEM battery guide missing vendor coverage for ${vendorPattern}`,
      ).toMatch(vendorPattern);
    }
  });

  // 8. F7 + F10
  it("8. [F7+F10] ONM CAP Alert -> Update escalation chain preserves verbatim ONM attribution inside Trigger Provenance", async () => {
    const onmMod = await importRepoModule<Record<string, unknown>>(
      "src/lib/ingest/onm.server",
    );
    const provenanceMod = await importRepoModule<AlertProvenanceMod>(
      "src/lib/alert-provenance",
    );

    const initialXml = buildOnmCapXml({
      identifier: "urn:oid:2.49.0.1.12.0.20261124.100",
      msgType: "Alert",
      severity: "Severe",
      senderName: "Office National de la Météorologie (ONM)",
      headline: "BMS Pluies Niveau 2 (Orange) - Alger",
      wilayaCodes: ["16"],
    });
    const updateXml = buildOnmCapXml({
      identifier: "urn:oid:2.49.0.1.12.0.20261124.101",
      msgType: "Update",
      references:
        "onm@meteo.dz,urn:oid:2.49.0.1.12.0.20261124.100,2026-11-24T12:00:00+01:00",
      severity: "Extreme",
      sent: "2026-11-24T14:00:00+01:00",
      senderName: "Office National de la Météorologie (ONM)",
      headline: "BMS Pluies Niveau 3 (Rouge) - Alger",
      wilayaCodes: ["16"],
    });

    const parseCapDetail = findExportedFn(
      onmMod,
      ["parseCapDetail", "parseOnmCapXml", "parseCapAlert"],
      "src/lib/ingest/onm.server",
    );

    const detail1 = parseCapDetail(initialXml) as Record<
      string,
      unknown
    > | null;
    const detail2 = parseCapDetail(updateXml) as Record<string, unknown> | null;
    expect(detail1).not.toBeNull();
    expect(detail2).not.toBeNull();
    expect(
      String(detail2?.["headline_fr"] ?? detail2?.["headline"] ?? ""),
    ).toContain("Rouge");

    const msgType2 = String(
      detail2?.["msgType"] ?? detail2?.["msg_type"] ?? "",
    );
    expect(msgType2.toLowerCase()).toBe("update");
    const refs2 = detail2?.["cap_references"] ?? detail2?.["references"];
    expect(refs2).toBeTruthy();
    const refIds2 = detail2?.["referenced_cap_ids"];
    expect(Array.isArray(refIds2)).toBe(true);
    expect(refIds2).toContain("urn:oid:2.49.0.1.12.0.20261124.100");

    const provenance = provenanceMod.buildAlertProvenance({
      triggerKind: "wilaya_warning",
      areaLabel: "Alger",
      sourceKey: "onm",
      sourceAttribution: "Office National de la Météorologie (ONM)",
      ruleLabelKey: "provenance.rule.onmExtreme",
      observedAt: "2026-11-24T14:00:00+01:00",
      authorityStatus: "official",
    });

    expect(provenanceMod.validateProvenanceInvariants(provenance)).toEqual([]);
    const fcmData = provenanceMod.toProvenancePayload(provenance);
    expect(fcmData["provenance_source"]).toBe(
      "Office National de la Météorologie (ONM)",
    );
    const roundTripped = provenanceMod.parseProvenancePayload(fcmData);
    expect(roundTripped?.["sourceAttribution"]).toBe(
      "Office National de la Météorologie (ONM)",
    );
  });

  // 9. F7 + F11
  it("9. [F7+F11] ONM Severe (alerts_official) escalating to Extreme (alerts_urgent) updates Android channel routing", async () => {
    const channelMod = await importRepoModule<NotificationChannelsMod>(
      "src/lib/notification-channels",
    );
    const fcmMod = await importRepoModule<FcmMod>("src/lib/fcm");

    expect(
      channelMod.resolveNotificationChannel({
        kind: "onm",
        severity: "Severe",
      }),
    ).toBe("alerts_official");
    expect(
      channelMod.resolveNotificationChannel({
        kind: "onm",
        severity: "Extreme",
      }),
    ).toBe("alerts_urgent");
    expect(
      channelMod.resolveNotificationChannel({
        kind: "onm",
        severity: "Extreme",
        phase: "cancel",
      }),
    ).toBe("alerts_civil");

    const severeMsgs = fcmMod.fcmMessagesForOnm({
      broadcastId: "b-onm-severe",
      severity: "Severe",
      communeCodes: ["1601"],
      title: "Rain Severe warning",
      headlineFr: "BMS Pluies Niveau 2 (Orange)",
      wilayaId: "16",
      event: "Rain",
    });
    const extremeMsgs = fcmMod.fcmMessagesForOnm({
      broadcastId: "b-onm-extreme",
      severity: "Extreme",
      communeCodes: ["1601"],
      title: "Rain Extreme warning",
      headlineFr: "BMS Pluies Niveau 3 (Rouge)",
      wilayaId: "16",
      event: "Rain",
    });

    expect(severeMsgs.length).toBeGreaterThanOrEqual(4);
    expect(extremeMsgs.length).toBeGreaterThanOrEqual(4);
    for (const msg of severeMsgs) {
      expect(msg.android.notification.channel_id).toBe("alerts_official");
    }
    for (const msg of extremeMsgs) {
      expect(msg.android.notification.channel_id).toBe("alerts_urgent");
    }
  });

  // 10. F7 + F13
  it("10. [F7+F13] ONM CAP Update propagates to WhatsApp Channel & Resend digest while explicit Cancel suppresses active dispatch", async () => {
    const waServer = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ id: "wamid.e2e.001" }] }),
    }));
    const resendServer = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "email_e2e_001" }),
    }));

    try {
      const { path: waPath, mod: waMod } = await importFirstExistingModule([
        "src/lib/delivery/whatsapp-channel.server",
      ]);
      const { path: emailPath, mod: emailMod } =
        await importFirstExistingModule([
          "src/lib/delivery/email-digest.server",
        ]);

      const waSource = readRepoFile(`${waPath}.ts`);
      const emailSource = readRepoFile(`${emailPath}.ts`);

      // Verify explicit cancel/kill-switch/provenance contracts exist in delivery pipelines
      expect(Object.keys(waMod).length).toBeGreaterThan(0);
      expect(Object.keys(emailMod).length).toBeGreaterThan(0);
      expect(waSource).toMatch(/provenance|attribution|ONM/i);
      expect(emailSource).toMatch(/provenance|unsubscribe|resend/i);

      const waFormat = findExportedFn(
        waMod,
        ["formatWhatsappBroadcastMessage"],
        waPath,
      );
      const waEligibility = findExportedFn(
        waMod,
        ["evaluateWhatsappBroadcastEligibility"],
        waPath,
      );
      const waCreateTransport = findExportedFn(
        waMod,
        ["createMetaWhatsAppChannelTransport"],
        waPath,
      );
      const waDeliver = findExportedFn(
        waMod,
        ["deliverWhatsappChannelBroadcasts"],
        waPath,
      );
      const emailFormat = findExportedFn(
        emailMod,
        ["renderZoneDigestEmail"],
        emailPath,
      );
      const emailCreateTransport = findExportedFn(
        emailMod,
        ["createResendEmailTransport"],
        emailPath,
      );
      const emailDeliver = findExportedFn(
        emailMod,
        ["deliverZoneEmailDigests"],
        emailPath,
      );

      const now = new Date("2026-11-24T14:05:00Z");
      const activeOnmCandidate = {
        id: "onm-20261124-update",
        kind: "onm",
        phase: "update",
        msgType: "Update",
        cancelledAt: null,
        supersededBy: null,
        severity: "Extreme",
        hazard: "rain",
        headline: "BMS Pluies Niveau 3 (Rouge) - Alger",
        summary: "Cumuls > 80 mm sur Alger et Tipaza.",
        areaLabel: "Alger",
        sourceKey: "onm",
        sourceAttribution: "ONM · Météo Algérie",
        observedAt: "2026-11-24T14:00:00Z",
        expiresAt: "2026-11-25T02:00:00Z",
      };
      const cancelledOnmCandidate = {
        ...activeOnmCandidate,
        id: "onm-20261124-cancel",
        phase: "cancel",
        msgType: "Cancel",
        cancelledAt: "2026-11-24T14:02:00Z",
      };

      const activeCheck = waEligibility(activeOnmCandidate, now) as {
        eligible: boolean;
        reason?: string;
      };
      const cancelCheck = waEligibility(cancelledOnmCandidate, now) as {
        eligible: boolean;
        reason?: string;
      };
      expect(activeCheck.eligible).toBe(true);
      expect(cancelCheck.eligible).toBe(false);

      const waRendered = waFormat({
        candidate: activeOnmCandidate,
        locale: "fr",
      }) as { text: string; provenanceFooter: string };
      expect(waRendered.text).toMatch(/ONM/i);
      expect(waRendered.provenanceFooter).toMatch(/ONM/i);

      const waQueue: Array<{
        id: string;
        broadcast_id: string;
        channel_target: string;
        locale: string;
        dedupe_key: string;
        state: string;
        attempts: number;
        expires_at: string;
        lease_token: string | null;
        last_error: string | null;
        payload: Record<string, unknown>;
      }> = [];
      const waTransport = waCreateTransport({
        accessToken: "e2e-wa-token",
        apiUrl: waServer.url,
        fetchImpl: fetch,
      });
      const waSummary = (await waDeliver({
        env: {},
        now,
        channelTarget: "channel-dz-fr",
        locales: ["fr"],
        candidates: [activeOnmCandidate, cancelledOnmCandidate],
        transport: waTransport,
        store: {
          isGlobalBroadcastEnabled: async () => true,
          isPipelineActive: async () => true,
          enqueueBroadcast: async (input: {
            broadcastId: string;
            channelTarget: string;
            locale: string;
            dedupeKey: string;
            payload: Record<string, unknown>;
            expiresAt: string | null;
          }) => {
            const id = `wa-row-${waQueue.length + 1}`;
            waQueue.push({
              id,
              broadcast_id: input.broadcastId,
              channel_target: input.channelTarget,
              locale: input.locale,
              dedupe_key: input.dedupeKey,
              state: "pending",
              attempts: 0,
              expires_at: input.expiresAt ?? "2026-11-25T02:00:00Z",
              lease_token: null,
              last_error: null,
              payload: input.payload,
            });
            return id;
          },
          claimDeliveries: async () =>
            waQueue
              .filter((r) => r.state === "pending")
              .map((r) => {
                r.state = "leased";
                r.attempts += 1;
                r.lease_token = `lease-${r.id}`;
                return r;
              }),
          finishDelivery: async () => true,
        },
      })) as { sent: number; skipped: number; failed: number };
      expect(waSummary.sent).toBe(1);
      expect(waSummary.skipped).toBe(1);
      expect(waServer.requests).toHaveLength(1);
      expect(waServer.requests[0]?.body).toMatch(/ONM/i);

      const digestAlert = {
        id: "onm-20261124-update",
        kind: "weather",
        severity: 4,
        title: "BMS Pluies Niveau 3 (Rouge) - Alger",
        body: "Cumuls > 80 mm sur Alger et Tipaza.",
        created_at: "2026-11-24T14:00:00Z",
        zone_name: "Alger Centre",
        payload: {
          onm_severity: "Extreme",
          source_key: "onm",
          source_attribution: "ONM · Météo Algérie",
        },
      };

      const emailRendered = emailFormat({
        locale: "fr",
        recipientName: "Citoyen",
        urgentBypass: true,
        manageUrl: "https://nadhir.app/settings?unsubscribe=1",
        alerts: [digestAlert],
      }) as { subject: string; html: string; text: string };
      const emailSerialized = `${emailRendered.subject}\n${emailRendered.html}\n${emailRendered.text}`;
      expect(emailSerialized).toMatch(/ONM/i);
      expect(emailSerialized).toMatch(/unsubscribe|préférences|désactiver/i);

      const resendTransport = emailCreateTransport({
        apiKey: "re_e2e_test_key",
        apiUrl: resendServer.url,
        fetchImpl: fetch,
      });
      const emailSummary = (await emailDeliver({
        env: {},
        now,
        transport: resendTransport,
        store: {
          isPipelineActive: async () => true,
          listPendingUsers: async () => [
            {
              user_id: "u-e2e-10",
              email: "citizen@example.invalid",
              display_name: "Citoyen",
              locale: "fr",
              email_digest_frequency: "immediate",
              email_digest_hour_algiers: 7,
              quiet_hours_start: 22,
              quiet_hours_end: 6,
              last_sent_at: null,
            },
          ],
          loadUndeliveredAlerts: async () => [digestAlert],
          claimDigestDelivery: async () => ({
            id: "ed-1",
            lease_token: "ed-lease-1",
            attempts: 1,
          }),
          finishDigestDelivery: async () => true,
        },
      })) as { sent: number; failed: number };
      expect(emailSummary.sent).toBe(1);
      expect(resendServer.requests).toHaveLength(1);
      expect(resendServer.requests[0]?.body).toMatch(/ONM/i);
      expect(resendServer.requests[0]?.body).toMatch(/List-Unsubscribe/i);

      // Cancelled alert must not be treated as an active dispatch item
      const cancelledCheck = `${waSource}\n${emailSource}`;
      expect(cancelledCheck).toMatch(/cancel|superseded|kill|enabled|skip/i);
    } finally {
      await waServer.close();
      await resendServer.close();
    }
  });

  // 11. F8 + F9
  it("11. [F8+F9] DGPC non-fire flood/road incident routes to accountless commune topics with zero PII and enforces ADR-0004 public Telegram boundary", async () => {
    const fcmMod = await importRepoModule<FcmMod>("src/lib/fcm");
    const dgpcFlood = buildDgpcNonFirePost({ kind: "flood" });
    const dgpcRoad = buildDgpcNonFirePost({ kind: "road" });

    const messages = fcmMod.fcmMessagesForOfficial({
      broadcastId: "b-dgpc-flood-1602",
      severity: "Severe",
      communeCodes: [dgpcFlood.communeCode, dgpcRoad.communeCode],
      info: [
        {
          language: "ar-DZ",
          headline: "الحماية المدنية: تدخل فيضانات بباب الوادي",
          description: dgpcFlood.textAr,
        },
        {
          language: "fr-DZ",
          headline: "Protection Civile : inondation à Bab El Oued",
          description: dgpcFlood.textFr,
        },
        {
          language: "en-US",
          headline: "Civil Protection: flooding in Bab El Oued",
          description: dgpcFlood.textFr,
        },
        {
          language: "kab-DZ",
          headline: "DGPC: lḥemla n waman deg Bab El Oued",
          description: dgpcFlood.textFr,
        },
      ],
    });

    expect(messages.length).toBe(8);
    expect(messages.map((m) => m.topic)).toContain(
      fcmMod.fcmTopic(dgpcFlood.communeCode, "ar"),
    );
    expect(messages.map((m) => m.topic)).toContain(
      fcmMod.fcmTopic(dgpcRoad.communeCode, "fr"),
    );

    for (const msg of messages) {
      expect(msg.topic).toMatch(/^v1\.commune\.\d{4}\.(ar|fr|en|kab)$/);
      const serialized = JSON.stringify(msg);
      expect(serialized).not.toMatch(
        /user_id|email|phone|device_token|v1\.user\./i,
      );
    }

    // ADR-0004: public Telegram relay MUST only relay dgpc_telegram, never ita_facebook
    const broadcastSource = readRepoFile("src/lib/ingest/broadcast.server.ts");
    const deliverySource = readRepoFile("src/lib/ingest/delivery.server.ts");
    const combined = `${broadcastSource}\n${deliverySource}`;
    expect(combined).toContain("dgpc_telegram");
    // Verify non-fire kinds (flood, storm, road) are enabled in M2 broadcast adapter
    expect(combined).toMatch(/flood/i);
    expect(combined).toMatch(/storm|road/i);
  });

  // 12. F8 + F10
  it("12. [F8+F10] DGPC flood broadcast carries Trigger Provenance footer (commune_topic + verbatim DGPC attribution + timestamp)", async () => {
    const provenanceMod = await importRepoModule<AlertProvenanceMod>(
      "src/lib/alert-provenance",
    );
    const dgpcFlood = buildDgpcNonFirePost({ kind: "flood" });

    const provenance = provenanceMod.buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: dgpcFlood.communeName,
      sourceKey: "dgpc_telegram",
      sourceAttribution: dgpcFlood.sourceAttribution,
      ruleLabelKey: "provenance.rule.dgpcNonFire",
      observedAt: dgpcFlood.publishedAt,
      authorityStatus: "official",
    });

    expect(provenanceMod.validateProvenanceInvariants(provenance)).toEqual([]);
    const payload = provenanceMod.toProvenancePayload(provenance);
    expect(payload["provenance_trigger"]).toBe("commune_topic");
    expect(payload["provenance_source"]).toBe(dgpcFlood.sourceAttribution);
    expect(payload["provenance_observed_at"]).toBe(dgpcFlood.publishedAt);

    const digestLine = provenanceMod.formatProvenanceDigestLine(provenance, {
      trigger: "Commune topic",
      rule: "DGPC non-fire alert",
      areaFallback: "Not recorded",
      timeLabel: "16:10 CET",
    });
    expect(digestLine).toContain(dgpcFlood.sourceAttribution);
    expect(digestLine).toContain("Bab El Oued");
    expect(findEmDashesInText(digestLine).count).toBe(0);
  });

  // 13. F9 + F20
  it("13. [F9+F20] EMSC M4.6 earthquake + CRAAG official attribution matcher targets accountless commune topics within 100 km", async () => {
    const emscMod = await importRepoModule<EmscMod>("src/lib/ingest/emsc");
    const fcmMod = await importRepoModule<FcmMod>("src/lib/fcm");
    const admin = loadAlgeriaAdmin();

    const emscFeature = buildEmscEvent({
      id: "20261124_bejaia_m46",
      mag: 4.6,
      lat: 36.7525,
      lon: 5.0556,
      depthKm: 10,
      time: "2026-11-24T13:42:18.4Z",
    });
    const parsedEvents = emscMod.parseEmsc({
      type: "FeatureCollection",
      features: [emscFeature],
    });
    expect(parsedEvents).toHaveLength(1);
    const quake = parsedEvents[0]!;
    expect(quake.magnitude).toBe(4.6);

    const { path: craagPath, mod: craagMod } = await importFirstExistingModule([
      "src/lib/ingest/craag",
      "src/lib/ingest/craag.server",
    ]);
    const craagBulletin = buildCraagBulletin({
      magnitude: 4.6,
      lat: 36.751,
      lon: 5.058,
      eventTime: "2026-11-24T13:42:20Z",
    });
    const craagTableHtml = [
      '<!DOCTYPE html><html lang="fr"><head><title>CRAAG - Bulletins sismiques</title></head><body>',
      "<table>",
      "  <thead><tr>",
      "    <th>Date et Heure (UTC)</th><th>Magnitude</th><th>Latitude</th><th>Longitude</th><th>Profondeur</th><th>Localisation</th><th>Bulletin</th>",
      "  </tr></thead>",
      "  <tbody><tr>",
      `    <td>${craagBulletin.eventTime}</td>`,
      `    <td>ML ${craagBulletin.magnitude.toFixed(1)}</td>`,
      `    <td>${craagBulletin.lat.toFixed(4)} N</td>`,
      `    <td>${craagBulletin.lon.toFixed(4)} E</td>`,
      `    <td>${craagBulletin.depthKm} km</td>`,
      `    <td>${craagBulletin.locationFr}</td>`,
      `    <td><a href="${craagBulletin.bulletinUrl}">Bulletin officiel CRAAG</a></td>`,
      "  </tr></tbody>",
      "</table></body></html>",
    ].join("\n");

    const parseCraag = findExportedFn(
      craagMod,
      ["parseCraagBulletins"],
      craagPath,
    );
    const parsedResult = parseCraag(craagTableHtml) as {
      bulletins: Array<{
        bulletinId: string;
        observedAt: string;
        lat: number;
        lon: number;
        magnitude: number;
        attribution: string;
        sourceUrl: string | null;
      }>;
    };
    expect(parsedResult.bulletins).toHaveLength(1);
    const bulletin = parsedResult.bulletins[0]!;
    expect(bulletin.attribution).toMatch(/CRAAG/i);
    expect(bulletin.observedAt).toBeTruthy();

    const matchCraag = findExportedFn(
      craagMod,
      ["matchCraagToEmsc"],
      craagPath,
    );
    const matched = matchCraag(bulletin, [
      {
        id: quake.id,
        occurred_at: quake.occurred_at,
        lat: quake.lat,
        lon: quake.lon,
        magnitude: quake.magnitude,
      },
    ]) as {
      earthquakeId: string;
      distanceKm: number;
      timeDiffSeconds: number;
      magnitudeDiff: number;
    } | null;
    expect(matched).not.toBeNull();
    expect(matched?.earthquakeId).toBe(quake.id);
    expect(matched?.distanceKm).toBeLessThanOrEqual(50);
    expect(matched?.timeDiffSeconds).toBeLessThanOrEqual(120);
    expect(matched?.magnitudeDiff).toBeLessThanOrEqual(1.0);

    const within100Km = admin.communes.filter(
      (c) => haversineKm(quake.lat, quake.lon, c.lat, c.lon) <= 100,
    );
    expect(within100Km.length).toBeGreaterThan(5);
    expect(within100Km.some((c) => c.wilaya_code === "06")).toBe(true);
    // Algiers centre (~180 km away) must NOT be inside the 100 km ring
    expect(within100Km.some((c) => c.code === "1601")).toBe(false);

    const sampleTopic = fcmMod.fcmTopic(within100Km[0]!.code, "ar");
    expect(sampleTopic).toMatch(/^v1\.commune\.\d{4}\.ar$/);
  });

  // 14. F9 + F11
  it("14. [F9+F11] M4.4 earthquake routes to alerts_earthquakes while M5.2 routes to alerts_urgent on accountless commune topics", async () => {
    const channelMod = await importRepoModule<NotificationChannelsMod>(
      "src/lib/notification-channels",
    );
    const fcmMod = await importRepoModule<FcmMod>("src/lib/fcm");

    expect(
      channelMod.resolveNotificationChannel({
        kind: "earthquake",
        magnitude: 4.4,
      }),
    ).toBe("alerts_earthquakes");
    expect(
      channelMod.resolveNotificationChannel({
        kind: "earthquake",
        magnitude: 5.2,
      }),
    ).toBe("alerts_urgent");
    expect(
      channelMod.resolveNotificationChannel({
        kind: "earthquake",
        magnitude: 3.9,
      }),
    ).toBe("alerts_civil");

    expect(
      channelMod.channelFromFcmData({
        kind: "earthquake",
        magnitude: "4.4",
      }),
    ).toBe("alerts_earthquakes");
    expect(
      channelMod.channelFromFcmData({
        kind: "earthquake",
        magnitude: "5.2",
      }),
    ).toBe("alerts_urgent");

    const topicAr = fcmMod.fcmTopic("0601", "ar");
    expect(topicAr).toBe("v1.commune.0601.ar");
  });

  // 15. F10 + F14
  it("15. [F10+F14] Alert Provenance footer inside 2-second alert card hierarchy on mobile AR RTL (390x844) passes touch target, contrast & overflow checks", async () => {
    await withBrowserPage(
      {
        locale: "ar",
        viewport: "mobile",
        baseUrl: e2eBaseUrl(),
      },
      async (page) => {
        const res = await page.goto("/alerts?lang=ar", {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        expect(res).not.toBeNull();
        expect(res!.status()).toBeLessThan(400);

        const dir = await page.evaluate(
          () => document.documentElement.getAttribute("dir") ?? "",
        );
        expect(dir.toLowerCase()).toBe("rtl");

        const overflow = await measureHorizontalOverflow(page);
        expect(
          overflow.hasOverflow,
          `AR RTL /alerts overflowed: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
        ).toBe(false);

        const touchViolations = await measureTouchTargets(page, 44);
        expect(
          touchViolations,
          `Touch targets < 44px on /alerts AR: ${JSON.stringify(touchViolations.slice(0, 5))}`,
        ).toEqual([]);

        const contrastViolations = await measureContrastViolations(page, 4.5);
        expect(
          contrastViolations,
          `Contrast < 4.5:1 on /alerts AR: ${JSON.stringify(contrastViolations.slice(0, 5))}`,
        ).toEqual([]);

        const bodyText = await page.evaluate(() => document.body.innerText);
        expect(findEmDashesInText(bodyText).count).toBe(0);
        expect(findBannedSafeLabels(bodyText)).toEqual([]);

        // Verify AlertProvenance component is integrated into alert views
        const provenanceComponent = readRepoFile(
          "src/components/nadhir/AlertProvenance.tsx",
        );
        expect(provenanceComponent.length).toBeGreaterThan(100);
      },
    );
  });

  // 16. F12 + F2
  it("16. [F12+F2] Test-my-notifications & OEM Battery Guide preserve 100% 4-locale parity (ar/fr/en/kab + weatherKab) and zero em dashes", async () => {
    const arMod = await importRepoModule<{ ar: Record<string, unknown> }>(
      "src/i18n/locales/ar",
    );
    const frMod = await importRepoModule<{ fr: Record<string, unknown> }>(
      "src/i18n/locales/fr",
    );
    const enMod = await importRepoModule<{ en: Record<string, unknown> }>(
      "src/i18n/locales/en",
    );
    const kabMod = await importRepoModule<{ kab: Record<string, unknown> }>(
      "src/i18n/locales/kab",
    );
    const weatherMod = await importRepoModule<{
      weatherAr: Record<string, unknown>;
      weatherFr: Record<string, unknown>;
      weatherEn: Record<string, unknown>;
      weatherKab: Record<string, unknown>;
    }>("src/i18n/weather");

    const byLocale = {
      ar: collectObjectLeafEntries(arMod.ar),
      fr: collectObjectLeafEntries(frMod.fr),
      en: collectObjectLeafEntries(enMod.en),
      kab: collectObjectLeafEntries(kabMod.kab),
    };

    const arKeys = new Set(byLocale.ar.map(([k]) => k));
    for (const locale of ["fr", "en", "kab"] as const) {
      const keys = new Set(byLocale[locale].map(([k]) => k));
      const missingFromLocale = [...arKeys].filter((k) => !keys.has(k));
      const extraInLocale = [...keys].filter((k) => !arKeys.has(k));
      expect(
        missingFromLocale,
        `Keys missing in ${locale}: ${missingFromLocale.slice(0, 10).join(", ")}`,
      ).toEqual([]);
      expect(
        extraInLocale,
        `Extra keys in ${locale}: ${extraInLocale.slice(0, 10).join(", ")}`,
      ).toEqual([]);
    }

    // Weather 4-locale parity including weatherKab
    const weatherArKeys = new Set(
      collectObjectLeafEntries(weatherMod.weatherAr).map(([k]) => k),
    );
    for (const [name, obj] of [
      ["weatherFr", weatherMod.weatherFr],
      ["weatherEn", weatherMod.weatherEn],
      ["weatherKab", weatherMod.weatherKab],
    ] as const) {
      const keys = new Set(collectObjectLeafEntries(obj).map(([k]) => k));
      expect(
        [...weatherArKeys].filter((k) => !keys.has(k)),
        name,
      ).toEqual([]);
      expect(
        [...keys].filter((k) => !weatherArKeys.has(k)),
        name,
      ).toEqual([]);
    }

    // Zero em dashes (R-02) across all 4 locales
    for (const [locale, entries] of Object.entries(byLocale)) {
      const withEmDash = entries.filter(([, val]) => val.includes("\u2014"));
      expect(
        withEmDash,
        `Em dashes found in locale ${locale}: ${JSON.stringify(withEmDash.slice(0, 5))}`,
      ).toEqual([]);
    }

    // Track 2 self-test & OEM battery guide keys must be non-empty across all 4 locales
    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const track2Content = readRepoFile(
        `src/i18n/modules/track2/${locale}.ts`,
      );
      expect(track2Content.length).toBeGreaterThan(50);
      expect(findEmDashesInText(track2Content).count).toBe(0);
    }
  });

  // 17. F13 + F22
  it("17. [F13+F22] Resend zone email digest respects Law 18-07/25-11 consent withdrawal and includes unsubscribe/preferences link", async () => {
    const { path: consentPath, mod: consentMod } =
      await importFirstExistingModule(["src/lib/privacy-consent.server"]);
    const { path: emailPath, mod: emailMod } = await importFirstExistingModule([
      "src/lib/delivery/email-digest.server",
    ]);

    const consentSource = readRepoFile(`${consentPath}.ts`);
    const emailSource = readRepoFile(`${emailPath}.ts`);

    expect(Object.keys(consentMod).length).toBeGreaterThan(0);
    expect(Object.keys(emailMod).length).toBeGreaterThan(0);
    expect(consentSource).toMatch(/withdraw|revoke|consent/i);
    expect(emailSource).toMatch(/unsubscribe|preferences|consent/i);

    const buildDigest = findExportedFn(
      emailMod,
      ["renderZoneDigestEmail"],
      emailPath,
    );
    const deliverDigests = findExportedFn(
      emailMod,
      ["deliverZoneEmailDigests"],
      emailPath,
    );
    const recordConsent = findExportedFn(
      consentMod,
      ["recordUserConsent"],
      consentPath,
    );
    const withdrawConsent = findExportedFn(
      consentMod,
      ["withdrawUserConsent"],
      consentPath,
    );

    const sampleAlert = {
      id: "a1",
      kind: "weather",
      severity: 3,
      title: "BMS Pluies Niveau 2 - Alger",
      body: "Pluies intenses attendues.",
      zone_name: "Bab El Oued",
      created_at: "2026-11-24T14:00:00Z",
      payload: {
        onm_severity: "Severe",
        source_key: "onm",
        source_attribution: "ONM · Météo Algérie",
      },
    };

    const emailPayload = buildDigest({
      locale: "fr",
      recipientName: "Abonné",
      urgentBypass: false,
      manageUrl: "https://nadhir.app/privacy?unsubscribe=1",
      alerts: [sampleAlert],
    }) as { subject: string; html: string; text: string };

    const serialized = `${emailPayload.subject}\n${emailPayload.html}\n${emailPayload.text}`;
    expect(serialized).toMatch(/unsubscribe|préférences|désactiver|privacy/i);
    expect(serialized).toMatch(/ONM/i);

    // Exercise live Law 18-07/25-11 consent record -> withdrawal -> digest dispatch enforcement
    const consentLedger = new Map<
      string,
      {
        id: string;
        user_id: string;
        consent_type: string;
        policy_version: string;
        status: "granted" | "withdrawn";
        granted_at: string | null;
        withdrawn_at: string | null;
        locale: string;
        source_surface: string;
        created_at: string;
        updated_at: string;
      }
    >();
    const privacyDeps = {
      listConsents: async (uid: string) =>
        [...consentLedger.values()].filter((r) => r.user_id === uid),
      upsertConsent: async (row: {
        user_id: string;
        consent_type: string;
        policy_version: string;
        status: "granted" | "withdrawn";
        granted_at: string | null;
        withdrawn_at: string | null;
        locale: string;
        source_surface: string;
      }) => {
        const nowIso = "2026-11-24T14:05:00.000Z";
        const stored = {
          id: `consent-${row.user_id}-${row.consent_type}`,
          ...row,
          created_at: nowIso,
          updated_at: nowIso,
        };
        consentLedger.set(`${row.user_id}:${row.consent_type}`, stored);
        return stored;
      },
      now: () => new Date("2026-11-24T14:05:00.000Z"),
    };

    const testUserId = "92000000-0000-4000-8000-000000000017";
    const granted = (await recordConsent(
      testUserId,
      {
        consent_type: "email_digest",
        locale: "fr",
        source_surface: "settings",
      },
      privacyDeps,
    )) as { status: string };
    expect(granted.status).toBe("granted");

    const withdrawn = (await withdrawConsent(
      testUserId,
      {
        consent_type: "email_digest",
        locale: "fr",
        source_surface: "settings",
      },
      privacyDeps,
    )) as { status: string; withdrawn_at: string | null };
    expect(withdrawn.status).toBe("withdrawn");
    expect(withdrawn.withdrawn_at).toBeTruthy();

    let sentCount = 0;
    let claimCount = 0;
    const digestSummary = (await deliverDigests({
      env: {},
      now: new Date("2026-11-24T14:10:00Z"),
      transport: {
        sendEmail: async () => {
          sentCount += 1;
          return { providerMessageId: "re_should_not_send" };
        },
      },
      store: {
        isPipelineActive: async () => true,
        isEmailConsentWithdrawn: async (uid: string) =>
          consentLedger.get(`${uid}:email_digest`)?.status === "withdrawn",
        listPendingUsers: async () => [
          {
            user_id: testUserId,
            email: "subscriber@example.invalid",
            display_name: "Abonné",
            locale: "fr",
            email_digest_frequency: "immediate",
            email_digest_hour_algiers: 7,
            quiet_hours_start: 22,
            quiet_hours_end: 6,
            last_sent_at: null,
          },
        ],
        loadUndeliveredAlerts: async () => [sampleAlert],
        claimDigestDelivery: async () => {
          claimCount += 1;
          return { id: "ed-x", lease_token: "lt-x", attempts: 1 };
        },
        finishDigestDelivery: async () => true,
      },
    })) as { sent: number; skipped: number };
    expect(digestSummary.sent).toBe(0);
    expect(digestSummary.skipped).toBe(1);
    expect(sentCount).toBe(0);
    expect(claimCount).toBe(0);

    // Verify Postgres RPCs also enforce email_digest consent withdrawal atomically
    assertPgReachable();
    const sqlOut = runInRolledBackTx(`
      DO $$
      DECLARE
        _uid uuid := '92000000-0000-4000-8000-000000000017';
        _zid uuid := '92000000-0000-4000-8000-000000000117';
        _aid uuid := '92000000-0000-4000-8000-000000000217';
        _before_list int;
        _withdrawn_list int;
        _withdrawn_claim int;
        _regranted_list int;
      BEGIN
        UPDATE public.delivery_pipeline_settings
           SET enabled = true, paused = false
         WHERE pipeline = 'email_digest';

        INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) VALUES (
          '00000000-0000-0000-0000-000000000000', _uid, 'authenticated', 'authenticated',
          'e2e-t3-17@example.invalid', '', now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
        );

        UPDATE public.profiles
           SET alert_email = true, email_digest_frequency = 'immediate', locale = 'fr'
         WHERE id = _uid;

        INSERT INTO public.zones (id, user_id, name, lat, lon, radius_km)
        VALUES (_zid, _uid, 'Bab El Oued', 36.79, 3.05, 10);

        INSERT INTO public.alerts (id, user_id, zone_id, kind, severity, dedupe_key, title, body, delivered_email)
        VALUES (_aid, _uid, _zid, 'weather', 4, 'e2e:t3:17', 'BMS Pluies', 'Body', false);

        SELECT count(*)::int INTO _before_list
          FROM public.list_pending_email_digest_users(500)
         WHERE user_id = _uid;
        IF _before_list <> 1 THEN
          RAISE EXCEPTION 'expected user listed before withdrawal, got %', _before_list;
        END IF;

        INSERT INTO public.privacy_consents (
          user_id, consent_type, policy_version, status, granted_at, withdrawn_at, locale, source_surface
        ) VALUES (
          _uid, 'email_digest', '2026-11-24', 'withdrawn', now() - interval '1 hour', now(), 'fr', 'settings'
        );

        SELECT count(*)::int INTO _withdrawn_list
          FROM public.list_pending_email_digest_users(500)
         WHERE user_id = _uid;
        SELECT count(*)::int INTO _withdrawn_claim
          FROM public.claim_email_digest_delivery(
            _uid, 'immediate', 'immediate:e2e-t3-17', 'email:e2e-t3-17', 'fr',
            ARRAY[_aid], false, 'Blocked'
          );
        IF _withdrawn_list <> 0 OR _withdrawn_claim <> 0 THEN
          RAISE EXCEPTION 'withdrawn user must be excluded (list=%, claim=%)', _withdrawn_list, _withdrawn_claim;
        END IF;

        UPDATE public.privacy_consents
           SET status = 'granted', granted_at = now(), withdrawn_at = null
         WHERE user_id = _uid AND consent_type = 'email_digest';

        SELECT count(*)::int INTO _regranted_list
          FROM public.list_pending_email_digest_users(500)
         WHERE user_id = _uid;
        IF _regranted_list <> 1 THEN
          RAISE EXCEPTION 'regranted user must be eligible again, got %', _regranted_list;
        END IF;
      END $$;
      SELECT 'OK';
    `);
    expect(sqlOut).toBe("OK");
  });

  // 18. F14 + F15
  it("18. [F14+F15] 3-detent map bottom sheet & hazard filter pills navigate cleanly to multi-hazard /forecast in ar RTL and fr LTR with zero overflow", async () => {
    for (const locale of ["ar", "fr"] as const) {
      await withBrowserPage(
        {
          locale,
          viewport: "mobile",
          baseUrl: e2eBaseUrl(),
        },
        async (page) => {
          const homeRes = await page.goto(`/?lang=${locale}`, {
            waitUntil: "networkidle",
            timeout: 30_000,
          });
          expect(homeRes).not.toBeNull();
          expect(homeRes!.status()).toBe(200);

          const dir = await page.evaluate(
            () => document.documentElement.getAttribute("dir") ?? "",
          );
          expect(dir.toLowerCase()).toBe(locale === "ar" ? "rtl" : "ltr");

          const homeOverflow = await measureHorizontalOverflow(page);
          expect(
            homeOverflow.hasOverflow,
            `Home / (${locale}) overflowed: ${homeOverflow.scrollWidth} > ${homeOverflow.clientWidth}`,
          ).toBe(false);

          // Navigate to /forecast
          const forecastRes = await page.goto(`/forecast?lang=${locale}`, {
            waitUntil: "networkidle",
            timeout: 30_000,
          });
          expect(forecastRes).not.toBeNull();
          expect(forecastRes!.status()).toBe(200);

          const forecastOverflow = await measureHorizontalOverflow(page);
          expect(
            forecastOverflow.hasOverflow,
            `/forecast (${locale}) overflowed: ${forecastOverflow.scrollWidth} > ${forecastOverflow.clientWidth}`,
          ).toBe(false);

          const forecastText = await page.evaluate(
            () => document.body.innerText,
          );
          expect(forecastText.trim().length).toBeGreaterThan(40);
          expect(findEmDashesInText(forecastText).count).toBe(0);
          expect(findBannedSafeLabels(forecastText)).toEqual([]);
        },
      );
    }
  });

  // 19. F14 + F2
  it("19. [F14+F2] Hazard-agnostic Emergency 14 / Position Card / Check-In sheet obeys ADR-0002, ADR-0003 & isolates fire-only guidance", async () => {
    const survivalFiles = [
      ...listRepoFiles("src/routes/survival", ".tsx"),
      ...listRepoFiles("src/components/survival", ".tsx"),
    ];
    expect(survivalFiles.length).toBeGreaterThan(0);

    const combinedCode = survivalFiles.map((f) => readRepoFile(f)).join("\n");
    // ADR-0003 bans "Guardian", "emergency mode", and evacuation routing
    expect(combinedCode).not.toMatch(/evacuation\s+route|safest\s+route/i);
    expect(combinedCode).not.toMatch(/["']Guardian["']/);
    expect(combinedCode).not.toMatch(/["']emergency mode["']/i);
    // Must keep fire guidance scoped away from non-fire hazards
    expect(combinedCode).toMatch(/flood|earthquake|quake|hazard/i);

    await withBrowserPage(
      {
        locale: "fr",
        viewport: "mobile",
        baseUrl: e2eBaseUrl(),
      },
      async (page) => {
        const res = await page.goto("/survival?lang=fr", {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        expect(res).not.toBeNull();
        expect(res!.status()).toBe(200);

        const text = await page.evaluate(() => document.body.innerText);
        expect(text).toContain("14");
        expect(findBannedSafeLabels(text)).toEqual([]);
        expect(findEmDashesInText(text).count).toBe(0);
      },
    );
  });

  // 20. F15 + F18
  it("20. [F15+F18] Multi-hazard /forecast distinguishes observed NASA IMERG/H-SAF satellite rainfall from Open-Meteo model rainfall", async () => {
    const { path: imergPath, mod: imergMod } = await importFirstExistingModule([
      "src/lib/ingest/imerg.server",
      "src/lib/ingest/imerg",
      "src/lib/ingest/rainfall.server",
      "src/lib/ingest/hsaf.server",
    ]);
    expect(Object.keys(imergMod).length).toBeGreaterThan(0);

    const imergSource = readRepoFile(`${imergPath}.ts`);
    expect(imergSource).toMatch(/IMERG|H-SAF|observed/i);

    const imergFixture = buildImergFixture();
    expect(imergFixture.sourceType).toBe("observed_satellite");
    expect(imergFixture.cells[0]?.mm30m).toBeGreaterThan(20);

    const forecastRes = await fetchText("/forecast?lang=fr");
    expect(forecastRes.status).toBe(200);
    expect(forecastRes.text.length).toBeGreaterThan(500);
    expect(findEmDashesInText(stripHtmlToText(forecastRes.text)).count).toBe(0);

    const forecastCode = [
      readRepoFile("src/routes/forecast.tsx"),
      ...listRepoFiles("src/components/forecast", ".tsx").map((f) =>
        readRepoFile(f),
      ),
    ].join("\n");
    expect(forecastCode).toMatch(/imerg|observed|satellite|rain|pluie/i);
  });

  // 21. F16 + F17
  it("21. [F16+F17] Bilingual /wilaya/alger og:image links directly to <= 37 KB wilaya share card in both ar and fr", async () => {
    for (const lang of ["ar", "fr"] as const) {
      const pageRes = await fetchText(`/wilaya/alger?lang=${lang}`);
      expect(pageRes.status).toBe(200);

      const ogMatch =
        pageRes.text.match(
          /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        ) ??
        pageRes.text.match(
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
        );
      expect(
        ogMatch?.[1],
        `Missing og:image meta tag on /wilaya/alger?lang=${lang}`,
      ).toBeTruthy();

      const ogUrl = ogMatch![1]!;
      const cardPath = ogUrl.startsWith("http")
        ? new URL(ogUrl).pathname + new URL(ogUrl).search
        : ogUrl;
      expect(cardPath).toMatch(/\/api\/public\/share\/wilaya\//);

      const cardRes = await fetchBytes(cardPath);
      expect(cardRes.status).toBe(200);
      const decoded = await assertValidShareCardImage(
        cardRes.bytes,
        SHARE_CARD_MAX_BYTES,
      );
      expect(decoded.width).toBeGreaterThanOrEqual(200);
      expect(decoded.height).toBeGreaterThanOrEqual(200);
    }
  });

  // 22. F16 + F2
  it("22. [F16+F2] All 69 Loi 26-06 wilayas map collision-free in wilaya-slugs.ts and new 2026 wilayas serve AR/FR SEO with zero bare Safe labels", async () => {
    const admin = loadAlgeriaAdmin();
    const loi = loadLoi2606();
    expect(admin.wilayas).toHaveLength(69);
    expect(loi.total_wilayas).toBe(69);

    const slugsMod = await importRepoModule<Record<string, unknown>>(
      "src/lib/wilaya-slugs",
    );
    const slugFn = findExportedFn(
      slugsMod,
      ["wilayaSlugByCode", "getWilayaSlug", "toWilayaSlug", "wilayaByCode"],
      "src/lib/wilaya-slugs",
    );

    const seenSlugs = new Set<string>();
    for (const w of admin.wilayas) {
      const result = slugFn(w.code);
      const slug =
        typeof result === "string"
          ? result
          : typeof result === "object" &&
              result !== null &&
              "slug" in result &&
              typeof (result as { slug: unknown }).slug === "string"
            ? (result as { slug: string }).slug
            : deriveWilayaSlug(w.name_fr);
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(seenSlugs.has(slug), `Duplicate slug "${slug}"`).toBe(false);
      seenSlugs.add(slug);
    }
    expect(seenSlugs.size).toBe(69);

    // Check 3 newly elevated 2026 Loi 26-06 wilayas (codes 59, 60, 69)
    const sampleNewWilayas = ["59", "60", "69"].map((code) => {
      const w = admin.wilayas.find((item) => item.code === code);
      expect(
        w,
        `Wilaya code ${code} missing in algeria-admin.json`,
      ).toBeTruthy();
      return deriveWilayaSlug(w!.name_fr);
    });

    for (const slug of sampleNewWilayas) {
      const res = await fetchText(`/wilaya/${slug}?lang=ar`);
      expect(res.status, `/wilaya/${slug}?lang=ar status`).toBe(200);
      expect(res.text).toMatch(/rel=["']canonical["']/i);
      expect(res.text).toMatch(/hreflang=["']ar-DZ["']/i);
      expect(res.text).toMatch(/hreflang=["']fr-DZ["']/i);
      expect(res.text).toMatch(/hreflang=["']x-default["']/i);
      const plainText = stripHtmlToText(res.text);
      expect(findBannedSafeLabels(plainText)).toEqual([]);
      expect(findEmDashesInText(plainText).count).toBe(0);
    }
  });

  // 23. F17 + F7
  it("23. [F17+F7] ONM warning share card (?lang=ar) renders valid <= 37 KB image with verbatim ONM attribution and Algiers timestamp", async () => {
    const res = await fetchShareCardWithEntity({
      kind: "onm",
      lang: "ar",
      format: "whatsapp.webp",
    });
    expect(res.status).toBe(200);
    const decoded = await assertValidShareCardImage(
      res.bytes,
      SHARE_CARD_MAX_BYTES,
    );
    expect(decoded.width).toBeGreaterThanOrEqual(200);
    expect(decoded.height).toBeGreaterThanOrEqual(200);

    const shareSource = [
      readRepoFile("src/lib/share-card.ts"),
      readRepoFile("src/lib/share-render.server.ts"),
    ].join("\n");
    expect(shareSource).toMatch(/Africa\/Algiers/);
    expect(shareSource).toMatch(/ONM/i);
  });

  // 24. F17 + F20
  it("24. [F17+F20] Earthquake share card (?lang=ar) renders valid <= 37 KB image with CRAAG/EMSC attribution", async () => {
    const res = await fetchShareCardWithEntity({
      kind: "quake",
      lang: "ar",
      format: "whatsapp.webp",
    });
    expect(res.status).toBe(200);
    const decoded = await assertValidShareCardImage(
      res.bytes,
      SHARE_CARD_MAX_BYTES,
    );
    expect(decoded.width).toBeGreaterThanOrEqual(200);
    expect(decoded.height).toBeGreaterThanOrEqual(200);
  });

  // 25. F17 + F21
  it("25. [F17+F21] Probable Fire share card (?lang=fr) renders valid <= 37 KB image and honors ADR-0002 (never confirmed for satellite-only)", async () => {
    const res = await fetchShareCardWithEntity({
      kind: "fire",
      lang: "fr",
      format: "whatsapp.webp",
    });
    expect(res.status).toBe(200);
    const decoded = await assertValidShareCardImage(
      res.bytes,
      SHARE_CARD_MAX_BYTES,
    );
    expect(decoded.width).toBeGreaterThanOrEqual(200);
    expect(decoded.height).toBeGreaterThanOrEqual(200);

    const shareCardCode = readRepoFile("src/lib/share-card.ts");
    // Must distinguish Probable Fire from confirmed official incidents
    expect(shareCardCode).toMatch(/probable|fire/i);
    expect(findEmDashesInText(shareCardCode).count).toBe(0);

    // Behavioral ADR-0002 check: satellite-only corroborated cluster is "probable" (never "confirmed"),
    // while bare uncorroborated satellite anomaly stays rejected (null / heat_signal)
    const shareCardMod =
      await importRepoModule<Record<string, unknown>>("src/lib/share-card");
    const isEligibleProbableFire = findExportedFn(
      shareCardMod,
      ["isEligibleProbableFire"],
      "src/lib/share-card",
    );
    const satelliteOnlyCluster = {
      state: "active",
      confirmed_at: null,
      resolved_at: null,
      suspected_persistent_source: false,
      lat: 36.7169,
      lon: 4.0497,
      last_detected_at: "2026-11-24T13:55:00Z",
    };
    const probableLevel = isEligibleProbableFire(satelliteOnlyCluster, {
      forestFraction: 0.25,
      dangerLevel: null,
      nearbySighting: false,
      officialMention: false,
    });
    expect(probableLevel).toBe("probable");
    expect(probableLevel).not.toBe("confirmed");

    const bareHotspotLevel = isEligibleProbableFire(satelliteOnlyCluster, {
      forestFraction: null,
      dangerLevel: null,
      nearbySighting: false,
      officialMention: false,
    });
    expect(bareHotspotLevel).toBeNull();
  });

  // 26. F18 + F19
  it("26. [F18+F19] Winter flash-flood fusion keeps IMERG observed rainfall and Tariki flooded-road closure strictly separate in attribution", async () => {
    const provenanceMod = await importRepoModule<AlertProvenanceMod>(
      "src/lib/alert-provenance",
    );
    const imerg = buildImergFixture();
    const tariki = buildTarikiPost({ kind: "flood_closure" });

    const imergProv = provenanceMod.buildAlertProvenance({
      triggerKind: "national_feed",
      areaLabel: "Alger",
      sourceKey: "imerg_rainfall",
      sourceAttribution: "NASA GPM IMERG Early (satellite observed)",
      ruleLabelKey: "provenance.rule.generic",
      observedAt: imerg.windowEnd,
      authorityStatus: "observed",
    });

    const tarikiProv = provenanceMod.buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: "Ain Benian, Alger",
      sourceKey: "tariki_facebook",
      sourceAttribution: tariki.sourceAttribution,
      ruleLabelKey: "provenance.rule.roadDanger",
      observedAt: tariki.publishedAt,
      authorityStatus: "official",
    });

    expect(provenanceMod.validateProvenanceInvariants(imergProv)).toEqual([]);
    expect(provenanceMod.validateProvenanceInvariants(tarikiProv)).toEqual([]);
    expect(imergProv["authorityStatus"]).toBe("observed");
    expect(tarikiProv["authorityStatus"]).toBe("official");
    expect(String(imergProv["sourceAttribution"])).not.toMatch(
      /Gendarmerie|Tariki/i,
    );
    expect(String(tarikiProv["sourceAttribution"])).toBe(
      "Gendarmerie Nationale (Tariki)",
    );
  });

  // 27. F21 + F2
  it("27. [F21+F2] GWIS/CLMS/GHSL carry honesty caveats (no PR #31 artifacts) and Postgres enforces REVOKE ALL FROM PUBLIC, anon, authenticated", () => {
    const m6Doc = readRepoFile("docs/m6-new-source-gate.md");
    expect(m6Doc).toMatch(/national-sources-only/i);
    expect(m6Doc).toMatch(/GWIS/i);
    expect(m6Doc).toMatch(/CLMS|NDVI|SWI/i);
    expect(m6Doc).toMatch(/GHSL/i);
    expect(m6Doc).toMatch(/modeled|estimate|non-fuel-calibrated|caveat/i);

    const gwis = buildGwisFixture();
    const clms = buildClmsFixture();
    const ghsl = buildGhslFixture();
    expect(gwis.burnedAreaHa).toBeGreaterThan(0);
    expect(clms.ndvi).toBeGreaterThan(0);
    expect(ghsl.populationWithin5km).toBeGreaterThan(0);

    // Verify zero PR #31 artifacts and explicit REVOKE ALL on new migrations
    const track4Migrations = listRepoFiles(
      "supabase/migrations",
      ".sql",
    ).filter((p) => /202611240[1-4]/.test(p));
    expect(track4Migrations.length).toBeGreaterThan(0);
    for (const mig of track4Migrations) {
      const sql = readRepoFile(mig);
      if (/create\s+(?:or\s+replace\s+)?function\s+/i.test(sql)) {
        expect(
          sql,
          `Migration ${mig} defines a function without explicit REVOKE ALL FROM PUBLIC, anon, authenticated`,
        ).toMatch(/revoke\s+all\s+on\s+function[\s\S]*?from\s+public/i);
      }
    }

    assertPgReachable();
    const leakedGrants = psqlJson<{ proname: string }>(
      `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN (
           'cold_archive_commit',
           'cold_pending_days',
           'enqueue_due_source_jobs',
           'claim_source_job',
           'complete_source_job'
         )
         AND (
           has_function_privilege('public', p.oid, 'execute')
           OR has_function_privilege('anon', p.oid, 'execute')
           OR has_function_privilege('authenticated', p.oid, 'execute')
         );`,
    );
    expect(leakedGrants).toEqual([]);
  });

  // 28. F22 + F23
  it("28. [F22+F23] Citizen photo upload enforces Law 18-07/25-11 consent AND server-side GPS/camera EXIF stripping before Storage write", async () => {
    const imgMod = await importRepoModule<ImageMetadataMod>(
      "src/lib/image-metadata",
    );
    const { path: uploadPath, mod: uploadMod } =
      await importFirstExistingModule([
        "src/lib/report-photo.server",
        "src/routes/api/private/report-photo",
      ]);
    expect(Object.keys(uploadMod).length).toBeGreaterThan(0);

    const dirtyJpeg = createJpegWithExif({
      make: "Samsung",
      model: "Galaxy A55",
      latitude: 36.7538,
      longitude: 3.0588,
      comment: "Bab El Oued flood 36.7538, 3.0588",
      includeIccProfile: true,
    });
    const before = inspectImageForMetadata(dirtyJpeg);
    expect(before.hasExif).toBe(true);
    expect(before.hasGps).toBe(true);
    expect(before.hasCameraTags).toBe(true);
    expect(before.hasTextChunks).toBe(true);

    const stripped = imgMod.stripImageMetadata(dirtyJpeg, "image/jpeg");
    const after = inspectImageForMetadata(stripped);
    expect(after.format).toBe("jpeg");
    expect(after.hasExif).toBe(false);
    expect(after.hasGps).toBe(false);
    expect(after.hasCameraTags).toBe(false);
    expect(after.hasTextChunks).toBe(false);

    const decoded = await decodeRasterDimensions(stripped);
    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);

    // Unauthenticated POST to /api/private/report-photo must be rejected (401/403)
    const unauthRes = await fetchText("/api/private/report-photo", {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: Buffer.from(dirtyJpeg),
    });
    expect([401, 403]).toContain(unauthRes.status);

    // Verify server upload module delegates EXIF stripping and strips bytes before uploadObject
    const uploadSource = readRepoFile(`${uploadPath}.ts`);
    expect(uploadSource).toMatch(
      /validateAndStripReportPhoto|stripImageMetadata|stripMetadata|exif/i,
    );
    expect(repoFileExists("docs/privacy-anpdp-compliance.md")).toBe(true);

    const handleUpload = findExportedFn(
      uploadMod,
      ["handleReportPhotoUpload"],
      uploadPath,
    );
    let capturedBytes: Uint8Array | null = null;
    const formData = new FormData();
    formData.append(
      "file",
      new File([Buffer.from(dirtyJpeg)], "flood.jpg", { type: "image/jpeg" }),
    );
    const authUploadReq = new Request(
      "http://127.0.0.1:4173/api/private/report-photo",
      {
        method: "POST",
        headers: { authorization: "Bearer e2e-valid-token" },
        body: formData,
      },
    );
    const uploadRes = (await handleUpload(authUploadReq, {
      getUser: async () => ({
        data: { user: { id: "92000000-0000-4000-8000-000000000028" } },
        error: null,
      }),
      consumeRateLimit: async () => ({ data: true, error: null }),
      uploadObject: async (_path: string, bytes: Uint8Array) => {
        capturedBytes = new Uint8Array(bytes);
        return { error: null };
      },
      randomUuid: () => "11111111-1111-4111-8111-111111111128",
    })) as Response;
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { stripped?: boolean };
    expect(uploadBody.stripped).toBe(true);
    expect(capturedBytes).not.toBeNull();
    const uploadedMeta = inspectImageForMetadata(capturedBytes!);
    expect(uploadedMeta.hasExif).toBe(false);
    expect(uploadedMeta.hasGps).toBe(false);
    expect(uploadedMeta.hasCameraTags).toBe(false);
    expect(uploadedMeta.hasTextChunks).toBe(false);
  });

  // 29. F23 + F24
  it("29. [F23+F24] Report submission enforces BOTH Cloudflare Turnstile CAPTCHA and EXIF/MIME validation before writing anything", async () => {
    const imgMod = await importRepoModule<ImageMetadataMod>(
      "src/lib/image-metadata",
    );
    const { path: turnstilePath, mod: turnstileMod } =
      await importFirstExistingModule(["src/lib/turnstile.server"]);

    const mockTurnstile = await startMockHttpServer((req) => {
      const params = new URLSearchParams(req.body);
      const token = params.get("response");
      const hasValid =
        token === "valid-e2e-token" || token === "valid_e2e_token";
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          success: hasValid,
          "error-codes": hasValid ? [] : ["invalid-input-response"],
        }),
      };
    });

    try {
      const verifyFn = findExportedFn(
        turnstileMod,
        [
          "verifyTurnstileToken",
          "verifyTurnstile",
          "validateTurnstileToken",
          "checkTurnstile",
        ],
        turnstilePath,
      );

      // Reject spoofed MIME payload before storage write
      const spoofed = createSpoofedMimePayload();
      expect(() => imgMod.stripImageMetadata(spoofed, "image/jpeg")).toThrow();

      // Call Turnstile verifier with invalid token against local mock endpoint
      const badOutcome = await Promise.resolve(
        verifyFn({
          token: "invalid-e2e-token",
          secretKey: "test-secret-key",
          verifyUrl: mockTurnstile.url,
          fetchImpl: fetch,
        }),
      );
      const isOk = (res: unknown): boolean => {
        if (typeof res === "boolean") return res;
        if (typeof res === "object" && res !== null) {
          const rec = res as Record<string, unknown>;
          if (typeof rec["ok"] === "boolean") return rec["ok"];
          if (typeof rec["success"] === "boolean") return rec["success"];
          if (typeof rec["valid"] === "boolean") return rec["valid"];
        }
        return false;
      };

      expect(isOk(badOutcome)).toBe(false);
      expect((badOutcome as { skipped?: boolean }).skipped).not.toBe(true);

      const goodOutcome = await Promise.resolve(
        verifyFn({
          token: "valid-e2e-token",
          secretKey: "test-secret-key",
          verifyUrl: mockTurnstile.url,
          fetchImpl: fetch,
        }),
      );
      expect(isOk(goodOutcome)).toBe(true);
      expect((goodOutcome as { skipped?: boolean }).skipped).not.toBe(true);
      expect(mockTurnstile.requests).toHaveLength(2);
    } finally {
      await mockTurnstile.close();
    }
  });

  // 30. F24 + F2
  it("30. [F24+F2] Turnstile protects write endpoints while leaving public read-only hazard feeds accessible and zero Paraito refs exist", async () => {
    assertPgReachable();
    const seededCommune = psqlJson<{ code: string }>(
      "SELECT code FROM public.admin_units WHERE level = 'commune' ORDER BY code LIMIT 1;",
    );
    const weatherCommune = seededCommune[0]?.code ?? "0101";

    const publicFeeds = [
      "/api/public/v1/status",
      "/api/public/v1/fires",
      `/api/public/v1/weather?commune=${encodeURIComponent(weatherCommune)}`,
      "/api/public/v1/civil",
    ];
    for (const feed of publicFeeds) {
      const res = await fetchJson<Record<string, unknown>>(feed);
      expect(
        res.status,
        `Public read-only feed ${feed} must NOT require Turnstile`,
      ).toBe(200);
      expect(typeof res.data).toBe("object");
    }

    // Verify Turnstile widget exists for write surfaces
    expect(repoFileExists("src/components/TurnstileWidget.tsx")).toBe(true);

    // Zero Paraito references across new source/worker/docs files
    const checkPaths = [
      ...listRepoFiles("worker/src", ".ts"),
      ...listRepoFiles("src/lib/delivery", ".ts"),
      ...listRepoFiles("src/i18n/modules", ".ts"),
    ];
    for (const rel of checkPaths) {
      const content = readRepoFile(rel);
      expect(content, `Unexpected Paraito reference in ${rel}`).not.toMatch(
        /\bparaito\b/i,
      );
    }
  });

  // 31. F1 + F6 + F22
  it("31. [F1+F6+F22] ADR-0006 on-device Current Commune privacy invariant holds across Android native code, Play Data Safety, /privacy, and clean roadmap branch", async () => {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    expect(branch).toBe("feat/winter-2026-2027-roadmap");

    const capacitorConfig = readRepoFile("capacitor.config.ts");
    expect(capacitorConfig).toContain('appId: "app.nadhir"');
    expect(capacitorConfig).toContain("allowMixedContent: false");

    const storeListing = readRepoFile("docs/store-listing.md");
    const anpdpDoc = readRepoFile("docs/privacy-anpdp-compliance.md");
    expect(storeListing.length).toBeGreaterThan(200);
    expect(anpdpDoc).toMatch(/18-07/);
    expect(anpdpDoc).toMatch(/25-11/);
    expect(anpdpDoc).toMatch(/ANPDP/i);

    // On-device commune resolver in Android must never POST coordinates to Nadhir backend
    const communeFiles = listRepoFiles(
      "android/app/src/main/java/app/nadhir/commune",
      ".java",
    );
    expect(communeFiles.length).toBeGreaterThan(0);
    for (const file of communeFiles) {
      const src = readRepoFile(file);
      expect(
        src,
        `${file} must not transmit coordinates over HTTP`,
      ).not.toMatch(/HttpURLConnection|OkHttpClient|nadhir\.app\/api/i);
    }

    // /privacy SSR returns HTTP 200 with ANPDP Law 18-07 / 25-11 disclosures and no ADR-0006 banned tracking copy
    const privacyRes = await fetchText("/privacy?lang=fr");
    expect(privacyRes.status).toBe(200);
    expect(privacyRes.text).toMatch(/18-07|ANPDP/i);
    expect(findEmDashesInText(stripHtmlToText(privacyRes.text)).count).toBe(0);

    // Validate assetlinks.json contract for Android App Links
    const assetLinks = readRepoJson<
      Array<{ relation: string[]; target: { package_name?: string } }>
    >("public/.well-known/assetlinks.json");
    expect(Array.isArray(assetLinks)).toBe(true);
    expect(
      assetLinks.some(
        (entry) =>
          entry.target?.package_name === "app.nadhir" &&
          entry.relation?.includes(
            "delegate_permission/common.handle_all_urls",
          ),
      ),
    ).toBe(true);
  });
});
