import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { haversineKm } from "@/lib/nadhir";
import { fetchAllPages } from "@/lib/paginate";
import { ArchiveFailure, archivedFetch } from "@/lib/source-archive.server";
import {
  retryDispositionForReason,
  type ClaimedSourceJob,
  type SourceJobResult,
  type SourceReplayInterval,
} from "@/lib/source-jobs";
import { publicReasonForError, sourceRunOutcome } from "@/lib/source-runs";

import { HSAF_SOURCE_KEY, parseHsafPayload, type HsafValueUnit } from "./hsaf";
import type { RainfallObservation } from "./imerg";
import type { RainfallCommuneRef } from "./imerg.server";

type RainfallInsert =
  Database["public"]["Tables"]["rainfall_observations"]["Insert"];

export type HsafRun = {
  fetched: number;
  stored: number;
  outside: number;
  dry: number;
  nodata: number;
  drySlot: boolean;
  validTime: string | null;
  upstreamPublishedAt: string | null;
  dataFrom?: string | null;
  dataThrough?: string | null;
  error?: string;
};

const MAX_COMMUNE_DISTANCE_KM = 60;

function nearestCommune(
  lat: number,
  lon: number,
  communes: readonly RainfallCommuneRef[],
): {
  communeId: string | null;
  communeCode: string | null;
  wilayaCode: string | null;
} {
  let best: { ref: RainfallCommuneRef; km: number } | null = null;
  for (const c of communes) {
    const km = haversineKm(lat, lon, c.lat, c.lon);
    if (!best || km < best.km) best = { ref: c, km };
  }
  if (!best || best.km > MAX_COMMUNE_DISTANCE_KM) {
    return { communeId: null, communeCode: null, wilayaCode: null };
  }
  const code = best.ref.code;
  const wilayaCode = code.length >= 2 ? code.slice(0, 2) : null;
  return { communeId: best.ref.id, communeCode: code, wilayaCode };
}

function toDbRows(
  observations: readonly RainfallObservation[],
  communes: readonly RainfallCommuneRef[],
): RainfallInsert[] {
  return observations.map((obs) => {
    const loc = nearestCommune(obs.lat, obs.lon, communes);
    return {
      source_key: obs.sourceKey,
      observation_kind: obs.observationKind,
      is_model: obs.isModel,
      valid_time: obs.validTime,
      published_time: obs.publishedTime,
      window_minutes: obs.windowMinutes,
      grid_cell_key: obs.gridCellKey,
      lat: obs.lat,
      lon: obs.lon,
      commune_id: loc.communeId,
      wilaya_code: loc.wilayaCode,
      commune_code: loc.communeCode,
      rate_mm_h: obs.rateMmH,
      accum_mm_30m: obs.accumMm30m,
      snapshot_id: obs.snapshotId,
      quality_state: obs.qualityState,
      attribution: obs.attribution,
    };
  });
}

function resolveSlotIso(
  nowMs: number,
  interval?: SourceReplayInterval,
): string {
  const targetMs = interval ? Date.parse(interval.dataThrough) : nowMs;
  const safeMs = Number.isFinite(targetMs) ? targetMs : nowMs;
  const floored = Math.floor(safeMs / (30 * 60_000)) * (30 * 60_000);
  return new Date(floored).toISOString();
}

function readEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

const defaultStore = {
  feedUrl: () => readEnv("HSAF_FEED_URL") ?? null,
  fetch: (url: string, slotIso: string) =>
    archivedFetch(
      HSAF_SOURCE_KEY,
      "hsaf_30m_grid",
      url,
      { signal: AbortSignal.timeout(30_000) },
      {
        requestParams: {
          slot: slotIso,
          window_minutes: 30,
        },
      },
    ),
  communes: () =>
    fetchAllPages<RainfallCommuneRef>((from, to) =>
      supabaseAdmin
        .from("admin_units")
        .select("id, code, lat, lon")
        .eq("level", "commune")
        .not("lat", "is", null)
        .not("lon", "is", null)
        .order("id")
        .range(from, to),
    ),
  upsert: async (rows: RainfallInsert[]) => {
    if (!rows.length) return 0;
    const { error } = await supabaseAdmin
      .from("rainfall_observations")
      .upsert(rows, { onConflict: "source_key,valid_time,grid_cell_key" });
    if (error) {
      throw new Error(`rainfall_observations upsert failed: ${error.message}`);
    }
    return rows.length;
  },
};

export type HsafDependencies = Partial<typeof defaultStore>;

export async function ingestHsaf(
  dependencies: HsafDependencies = {},
  now: () => number = Date.now,
  interval?: SourceReplayInterval,
): Promise<HsafRun> {
  const deps = { ...defaultStore, ...dependencies };
  const slotIso = resolveSlotIso(now(), interval);
  const baseUrl = deps.feedUrl();

  if (!baseUrl) {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      dry: 0,
      nodata: 0,
      drySlot: false,
      validTime: null,
      upstreamPublishedAt: null,
      error: "H-SAF feed URL not configured (HSAF_FEED_URL missing)",
    };
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(baseUrl);
  } catch {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      dry: 0,
      nodata: 0,
      drySlot: false,
      validTime: null,
      upstreamPublishedAt: null,
      error: "H-SAF feed URL not configured: invalid feed URL",
    };
  }
  if (interval) {
    requestUrl.searchParams.set("from", interval.dataFrom);
    requestUrl.searchParams.set("through", interval.dataThrough);
  }
  requestUrl.searchParams.set("slot", slotIso);

  let response: Response;
  try {
    response = await deps.fetch(requestUrl.toString(), slotIso);
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      dry: 0,
      nodata: 0,
      drySlot: false,
      validTime: null,
      upstreamPublishedAt: null,
      error: `H-SAF upstream fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      dry: 0,
      nodata: 0,
      drySlot: false,
      validTime: null,
      upstreamPublishedAt: null,
      error: `H-SAF upstream HTTP ${response.status}`,
    };
  }

  const contentType = response.headers.get("content-type");
  const headerValidTime = response.headers.get("x-valid-time") ?? slotIso;
  const headerPublishedTime =
    response.headers.get("x-published-time") ??
    response.headers.get("last-modified") ??
    headerValidTime;
  const headerSnapshotId = response.headers.get("x-snapshot-id");
  const headerUnit = response.headers.get("x-precip-unit");
  const valueUnit: HsafValueUnit | undefined =
    headerUnit === "mm_30m" || headerUnit === "mm/30m"
      ? "mm_30m"
      : headerUnit === "mm_h" || headerUnit === "mm/h"
        ? "mm_h"
        : undefined;

  try {
    const buffer = await response.arrayBuffer();
    const parsed = await parseHsafPayload(buffer, {
      contentType,
      geotiffMetadata: {
        validTime: headerValidTime,
        publishedTime: headerPublishedTime,
        snapshotId: headerSnapshotId,
        valueUnit,
      },
    });

    const communes = parsed.observations.length ? await deps.communes() : [];
    const rows = toDbRows(parsed.observations, communes);
    const stored = rows.length ? await deps.upsert(rows) : 0;

    return {
      fetched: parsed.cellsSeen,
      stored,
      outside: parsed.cellsOutsideAlgeria,
      dry: parsed.cellsDry,
      nodata: parsed.cellsNodata,
      drySlot: parsed.drySlot,
      validTime: parsed.validTime,
      upstreamPublishedAt: parsed.upstreamPublishedAt,
      dataFrom:
        interval?.dataFrom ??
        new Date(Date.parse(parsed.validTime) - 30 * 60_000).toISOString(),
      dataThrough: interval?.dataThrough ?? parsed.validTime,
    };
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      dry: 0,
      nodata: 0,
      drySlot: false,
      validTime: null,
      upstreamPublishedAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runHsafSource(
  job: ClaimedSourceJob,
  dependencies: HsafDependencies = {},
  now: () => number = Date.now,
): Promise<SourceJobResult> {
  const interval: SourceReplayInterval | undefined =
    job.trigger_kind === "replay" && job.data_from && job.data_through
      ? { dataFrom: job.data_from, dataThrough: job.data_through }
      : undefined;

  const run = await ingestHsaf(dependencies, now, interval);
  const accepted = run.drySlot ? 1 : run.stored;
  const health = sourceRunOutcome({ accepted, error: run.error });
  const reason = run.error
    ? publicReasonForError(run.error)
    : health.outcome === "skipped"
      ? "disabled"
      : null;

  return {
    contractKey: job.contract_key,
    trigger: job.trigger_kind,
    scheduledFor: job.scheduled_for,
    startedAt: job.started_at,
    ...health,
    upstreamPublishedAt: run.upstreamPublishedAt,
    dataFrom:
      health.outcome === "succeeded" ? (run.dataFrom ?? job.data_from) : null,
    dataThrough:
      health.outcome === "succeeded"
        ? (run.dataThrough ?? run.validTime ?? job.data_through)
        : null,
    recordsSeen: run.fetched,
    recordsInserted: run.stored,
    recordsRejected: run.outside + run.nodata,
    qualityChecks: {
      observation_kind: "satellite_observed",
      is_model: false,
      dry_slot: run.drySlot,
      dry_cells: run.dry,
      nodata_cells: run.nodata,
    },
    publicReasonCode: reason,
    privateDiagnostic: run.error ?? null,
    retryDisposition:
      health.outcome === "succeeded" || health.outcome === "skipped"
        ? "none"
        : retryDispositionForReason(reason ?? "internal_error"),
  };
}
