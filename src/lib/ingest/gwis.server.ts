import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
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

import {
  GWIS_LICENCE,
  GWIS_SOURCE_KEY,
  parseGwisPayload,
  type GwisBurnedArea,
} from "./gwis";

type GwisInsert = Database["public"]["Tables"]["gwis_burned_areas"]["Insert"];

export type GwisCommuneRef = {
  id: string;
  code: string;
  lat: number;
  lon: number;
};

export type GwisRun = {
  fetched: number;
  stored: number;
  outside: number;
  emptyWindow: boolean;
  upstreamPublishedAt: string | null;
  dataFrom?: string | null;
  dataThrough?: string | null;
  error?: string;
};

const MAX_COMMUNE_DISTANCE_KM = 60;

function nearestCommune(
  lat: number,
  lon: number,
  communes: readonly GwisCommuneRef[],
): {
  communeId: string | null;
  communeCode: string | null;
  wilayaCode: string | null;
} {
  let best: { ref: GwisCommuneRef; km: number } | null = null;
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
  items: readonly GwisBurnedArea[],
  communes: readonly GwisCommuneRef[],
): GwisInsert[] {
  return items.map((item) => {
    const loc = nearestCommune(item.lat, item.lon, communes);
    return {
      source_key: item.sourceKey,
      event_id: item.eventId,
      product_layer: item.productLayer,
      estimation_basis: item.estimationBasis,
      is_official_confirmation: item.isOfficialConfirmation,
      is_optical_scar: item.isOpticalScar,
      licence: item.licence,
      burn_start_at: item.burnStartAt,
      burn_end_at: item.burnEndAt,
      published_at: item.publishedAt,
      area_ha: item.areaHa,
      lat: item.lat,
      lon: item.lon,
      perimeter_geojson: item.perimeterGeojson as unknown as Json,
      commune_id: loc.communeId,
      wilaya_code: loc.wilayaCode,
      commune_code: loc.communeCode,
      attribution: item.attribution,
    };
  });
}

function readEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

const defaultStore = {
  feedUrl: () => readEnv("GWIS_BURNED_AREAS_URL") ?? null,
  fetch: (url: string, replay: boolean, windowEndIso: string) =>
    archivedFetch(
      GWIS_SOURCE_KEY,
      "gwis_nrt_ba_geojson",
      url,
      { signal: AbortSignal.timeout(30_000) },
      {
        requestParams: {
          layer: "nrt.ba",
          window_end: windowEndIso,
          replay,
        },
      },
    ),
  communes: () =>
    fetchAllPages<GwisCommuneRef>((from, to) =>
      supabaseAdmin
        .from("admin_units")
        .select("id, code, lat, lon")
        .eq("level", "commune")
        .not("lat", "is", null)
        .not("lon", "is", null)
        .order("id")
        .range(from, to),
    ),
  upsert: async (rows: GwisInsert[]) => {
    if (!rows.length) return 0;
    const { error } = await supabaseAdmin
      .from("gwis_burned_areas")
      .upsert(rows, { onConflict: "source_key,event_id,burn_end_at" });
    if (error) {
      throw new Error(`gwis_burned_areas upsert failed: ${error.message}`);
    }
    return rows.length;
  },
};

export type GwisDependencies = Partial<typeof defaultStore>;

export async function ingestGwisBurnedAreas(
  dependencies: GwisDependencies = {},
  now: () => number = Date.now,
  interval?: SourceReplayInterval,
): Promise<GwisRun> {
  const deps = { ...defaultStore, ...dependencies };
  const windowEndIso = interval
    ? new Date(Date.parse(interval.dataThrough)).toISOString()
    : new Date(now()).toISOString();
  const baseUrl = deps.feedUrl();

  if (!baseUrl) {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      emptyWindow: false,
      upstreamPublishedAt: null,
      error: "GWIS feed URL not configured (GWIS_BURNED_AREAS_URL missing)",
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
      emptyWindow: false,
      upstreamPublishedAt: null,
      error: "GWIS feed URL not configured: invalid feed URL",
    };
  }
  if (interval) {
    requestUrl.searchParams.set("from", interval.dataFrom);
    requestUrl.searchParams.set("through", interval.dataThrough);
  }

  let response: Response;
  try {
    response = await deps.fetch(
      requestUrl.toString(),
      Boolean(interval),
      windowEndIso,
    );
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      emptyWindow: false,
      upstreamPublishedAt: null,
      error: `GWIS upstream fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      emptyWindow: false,
      upstreamPublishedAt: null,
      error: `GWIS upstream HTTP ${response.status}`,
    };
  }

  const contentType = response.headers.get("content-type");

  try {
    const buffer = await response.arrayBuffer();
    const parsed = parseGwisPayload(buffer, { contentType });

    const bounded = interval
      ? parsed.burnedAreas.filter((item) => {
          const endMs = Date.parse(`${item.burnEndAt}T23:59:59Z`);
          const startMs = Date.parse(`${item.burnStartAt}T00:00:00Z`);
          return (
            endMs >= Date.parse(interval.dataFrom) &&
            startMs <= Date.parse(interval.dataThrough)
          );
        })
      : parsed.burnedAreas;

    const communes = bounded.length ? await deps.communes() : [];
    const rows = toDbRows(bounded, communes);
    const stored = rows.length ? await deps.upsert(rows) : 0;

    return {
      fetched: parsed.featuresSeen,
      stored,
      outside: parsed.featuresOutsideAlgeria,
      emptyWindow: bounded.length === 0,
      upstreamPublishedAt: parsed.upstreamPublishedAt,
      dataFrom:
        interval?.dataFrom ??
        new Date(
          Date.parse(parsed.upstreamPublishedAt) - 6 * 60 * 60_000,
        ).toISOString(),
      dataThrough: interval?.dataThrough ?? parsed.upstreamPublishedAt,
    };
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      emptyWindow: false,
      upstreamPublishedAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runGwisBurnedAreasSource(
  job: ClaimedSourceJob,
  dependencies: GwisDependencies = {},
  now: () => number = Date.now,
): Promise<SourceJobResult> {
  const interval: SourceReplayInterval | undefined =
    job.trigger_kind === "replay" && job.data_from && job.data_through
      ? { dataFrom: job.data_from, dataThrough: job.data_through }
      : undefined;

  const run = await ingestGwisBurnedAreas(dependencies, now, interval);
  const accepted = run.emptyWindow && !run.error ? 1 : run.stored;
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
        ? (run.dataThrough ?? run.upstreamPublishedAt ?? job.data_through)
        : null,
    recordsSeen: run.fetched,
    recordsInserted: run.stored,
    recordsRejected: run.outside,
    qualityChecks: {
      estimation_basis: "firms_derived_estimate",
      is_official_confirmation: false,
      is_optical_scar: false,
      licence: GWIS_LICENCE,
      empty_window: run.emptyWindow,
    },
    publicReasonCode: reason,
    privateDiagnostic: run.error ?? null,
    retryDisposition:
      health.outcome === "succeeded" || health.outcome === "skipped"
        ? "none"
        : retryDispositionForReason(reason ?? "internal_error"),
  };
}
