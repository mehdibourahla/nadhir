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

import {
  MTG_LIGHTNING_SOURCE_KEY,
  parseMtgLightningPayload,
  type LightningObservation,
} from "./mtg-lightning";

type LightningInsert =
  Database["public"]["Tables"]["lightning_observations"]["Insert"];

export type LightningCommuneRef = {
  id: string;
  code: string;
  lat: number;
  lon: number;
};

export type MtgLightningRun = {
  fetched: number;
  stored: number;
  outside: number;
  quietSlot: boolean;
  upstreamPublishedAt: string | null;
  dataFrom?: string | null;
  dataThrough?: string | null;
  error?: string;
};

const MAX_COMMUNE_DISTANCE_KM = 60;

function nearestCommune(
  lat: number,
  lon: number,
  communes: readonly LightningCommuneRef[],
): {
  communeId: string | null;
  communeCode: string | null;
  wilayaCode: string | null;
} {
  let best: { ref: LightningCommuneRef; km: number } | null = null;
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
  observations: readonly LightningObservation[],
  communes: readonly LightningCommuneRef[],
): LightningInsert[] {
  return observations.map((obs) => {
    const loc = nearestCommune(obs.lat, obs.lon, communes);
    return {
      source_key: obs.sourceKey,
      observation_kind: obs.observationKind,
      is_wildfire: obs.isWildfire,
      product_type: obs.productType,
      flash_id: obs.flashId,
      observed_at: obs.observedAt,
      published_at: obs.publishedAt,
      lat: obs.lat,
      lon: obs.lon,
      commune_id: loc.communeId,
      wilaya_code: loc.wilayaCode,
      commune_code: loc.communeCode,
      radiance_uj_m2: obs.radianceUjM2,
      duration_ms: obs.durationMs,
      group_count: obs.groupCount,
      quality_state: obs.qualityState,
      attribution: obs.attribution,
    };
  });
}

function readEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

function resolveSlotIso(
  nowMs: number,
  interval?: SourceReplayInterval,
): string {
  const targetMs = interval ? Date.parse(interval.dataThrough) : nowMs;
  const safeMs = Number.isFinite(targetMs) ? targetMs : nowMs;
  const floored = Math.floor(safeMs / (5 * 60_000)) * (5 * 60_000);
  return new Date(floored).toISOString();
}

const defaultStore = {
  feedUrl: () => readEnv("MTG_LIGHTNING_URL") ?? null,
  pushToken: () => readEnv("EUMETSAT_PUSH_TOKEN") ?? null,
  fetch: (
    url: string,
    slotIso: string,
    token: string | null,
    replay: boolean,
  ) =>
    archivedFetch(
      MTG_LIGHTNING_SOURCE_KEY,
      "mtg_li_l2_feed",
      url,
      {
        signal: AbortSignal.timeout(25_000),
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      },
      {
        requestParams: {
          slot: slotIso,
          replay,
        },
      },
    ),
  communes: () =>
    fetchAllPages<LightningCommuneRef>((from, to) =>
      supabaseAdmin
        .from("admin_units")
        .select("id, code, lat, lon")
        .eq("level", "commune")
        .not("lat", "is", null)
        .not("lon", "is", null)
        .order("id")
        .range(from, to),
    ),
  upsert: async (rows: LightningInsert[]) => {
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from("lightning_observations")
        .upsert(batch, { onConflict: "source_key,observed_at,flash_id" });
      if (error) {
        throw new Error(
          `lightning_observations upsert failed: ${error.message}`,
        );
      }
    }
    return rows.length;
  },
};

export type MtgLightningDependencies = Partial<typeof defaultStore>;

export async function ingestMtgLightning(
  dependencies: MtgLightningDependencies = {},
  now: () => number = Date.now,
  interval?: SourceReplayInterval,
): Promise<MtgLightningRun> {
  const deps = { ...defaultStore, ...dependencies };
  const slotIso = resolveSlotIso(now(), interval);
  const baseUrl = deps.feedUrl();

  if (!baseUrl) {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      quietSlot: false,
      upstreamPublishedAt: null,
      error: "MTG Lightning URL not configured (MTG_LIGHTNING_URL missing)",
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
      quietSlot: false,
      upstreamPublishedAt: null,
      error: "MTG Lightning URL not configured: invalid feed URL",
    };
  }
  if (interval) {
    requestUrl.searchParams.set("from", interval.dataFrom);
    requestUrl.searchParams.set("through", interval.dataThrough);
  }
  requestUrl.searchParams.set("slot", slotIso);

  let response: Response;
  try {
    response = await deps.fetch(
      requestUrl.toString(),
      slotIso,
      deps.pushToken(),
      Boolean(interval),
    );
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      quietSlot: false,
      upstreamPublishedAt: null,
      error: `MTG Lightning upstream fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      quietSlot: false,
      upstreamPublishedAt: null,
      error: `MTG Lightning upstream HTTP ${response.status}`,
    };
  }

  const contentType = response.headers.get("content-type");

  try {
    const buffer = await response.arrayBuffer();
    const parsed = parseMtgLightningPayload(buffer, { contentType });

    const bounded = interval
      ? parsed.observations.filter((obs) => {
          const ms = Date.parse(obs.observedAt);
          return (
            ms >= Date.parse(interval.dataFrom) &&
            ms <= Date.parse(interval.dataThrough)
          );
        })
      : parsed.observations;

    const communes = bounded.length ? await deps.communes() : [];
    const rows = toDbRows(bounded, communes);
    const stored = rows.length ? await deps.upsert(rows) : 0;

    return {
      fetched: parsed.flashesSeen,
      stored,
      outside: parsed.flashesOutsideAlgeria,
      quietSlot: bounded.length === 0,
      upstreamPublishedAt: parsed.upstreamPublishedAt,
      dataFrom:
        interval?.dataFrom ??
        new Date(
          Date.parse(parsed.upstreamPublishedAt) - 5 * 60_000,
        ).toISOString(),
      dataThrough: interval?.dataThrough ?? parsed.upstreamPublishedAt,
    };
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      quietSlot: false,
      upstreamPublishedAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runMtgLightningSource(
  job: ClaimedSourceJob,
  dependencies: MtgLightningDependencies = {},
  now: () => number = Date.now,
): Promise<SourceJobResult> {
  const interval: SourceReplayInterval | undefined =
    job.trigger_kind === "replay" && job.data_from && job.data_through
      ? { dataFrom: job.data_from, dataThrough: job.data_through }
      : undefined;

  const run = await ingestMtgLightning(dependencies, now, interval);
  const accepted = run.quietSlot && !run.error ? 1 : run.stored;
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
      observation_kind: "lightning_observation",
      is_wildfire: false,
      quiet_slot: run.quietSlot,
    },
    publicReasonCode: reason,
    privateDiagnostic: run.error ?? null,
    retryDisposition:
      health.outcome === "succeeded" || health.outcome === "skipped"
        ? "none"
        : retryDispositionForReason(reason ?? "internal_error"),
  };
}
