import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
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
  CLMS_SOURCE_KEY,
  parseClmsPayload,
  type ClmsCommuneRef,
  type ClmsLandIndexRecord,
  type ClmsProductVersion,
} from "./clms";
import { isTiffMagicBytes } from "./imerg";

type ClmsInsert = Database["public"]["Tables"]["clms_land_indices"]["Insert"];

export type ClmsRun = {
  fetched: number;
  stored: number;
  outside: number;
  skippedQa: number;
  emptyWindow: boolean;
  productVersion: ClmsProductVersion | null;
  observedAt: string | null;
  upstreamPublishedAt: string | null;
  dataFrom?: string | null;
  dataThrough?: string | null;
  error?: string;
};

function readEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

function toDbRows(
  records: readonly ClmsLandIndexRecord[],
  communeByCode: ReadonlyMap<string, ClmsCommuneRef>,
): ClmsInsert[] {
  return records.map((rec) => {
    const matched = communeByCode.get(rec.communeCode);
    return {
      source_key: rec.sourceKey,
      product_version: rec.productVersion,
      is_calibrated_fuel: rec.isCalibratedFuel,
      observed_at: rec.observedAt,
      published_at: rec.publishedAt,
      commune_id: rec.communeId ?? matched?.id ?? null,
      commune_code: rec.communeCode,
      wilaya_code: rec.wilayaCode,
      lat: rec.lat,
      lon: rec.lon,
      ndvi_value: rec.ndviValue,
      swi_value: rec.swiValue,
      quality_state: rec.qualityState,
      qa_pixel_fraction: rec.qaPixelFraction,
      attribution: rec.attribution,
    };
  });
}

const defaultStore = {
  feedUrl: () => readEnv("CLMS_INDICES_URL") ?? null,
  accessToken: () => readEnv("CDSE_ACCESS_TOKEN") ?? null,
  fetch: (
    url: string,
    token: string | null,
    replay: boolean,
    dateIso: string,
  ) =>
    archivedFetch(
      CLMS_SOURCE_KEY,
      "clms_ndvi_swi_feed",
      url,
      {
        signal: AbortSignal.timeout(45_000),
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      },
      {
        requestParams: {
          date: dateIso,
          replay,
        },
      },
    ),
  communes: () =>
    fetchAllPages<ClmsCommuneRef>((from, to) =>
      supabaseAdmin
        .from("admin_units")
        .select("id, code, lat, lon")
        .eq("level", "commune")
        .not("lat", "is", null)
        .not("lon", "is", null)
        .order("id")
        .range(from, to),
    ),
  upsert: async (rows: ClmsInsert[]) => {
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from("clms_land_indices")
        .upsert(batch, {
          onConflict: "source_key,product_version,observed_at,commune_code",
        });
      if (error) {
        throw new Error(`clms_land_indices upsert failed: ${error.message}`);
      }
    }
    return rows.length;
  },
};

export type ClmsDependencies = Partial<typeof defaultStore>;

export async function ingestClmsLandIndices(
  dependencies: ClmsDependencies = {},
  now: () => number = Date.now,
  interval?: SourceReplayInterval,
): Promise<ClmsRun> {
  const deps = { ...defaultStore, ...dependencies };
  const dateIso = (
    interval ? new Date(Date.parse(interval.dataThrough)) : new Date(now())
  )
    .toISOString()
    .slice(0, 10);
  const baseUrl = deps.feedUrl();

  if (!baseUrl) {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      skippedQa: 0,
      emptyWindow: false,
      productVersion: null,
      observedAt: null,
      upstreamPublishedAt: null,
      error: "CLMS feed URL not configured (CLMS_INDICES_URL missing)",
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
      skippedQa: 0,
      emptyWindow: false,
      productVersion: null,
      observedAt: null,
      upstreamPublishedAt: null,
      error: "CLMS feed URL not configured: invalid feed URL",
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
      deps.accessToken(),
      Boolean(interval),
      dateIso,
    );
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      skippedQa: 0,
      emptyWindow: false,
      productVersion: null,
      observedAt: null,
      upstreamPublishedAt: null,
      error: `CLMS upstream fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      skippedQa: 0,
      emptyWindow: false,
      productVersion: null,
      observedAt: null,
      upstreamPublishedAt: null,
      error: `CLMS upstream HTTP ${response.status}`,
    };
  }

  const contentType = response.headers.get("content-type");
  const headerProduct =
    response.headers.get("x-clms-product") === "swi_v4_1km"
      ? "swi_v4_1km"
      : "ndvi_v3_300m";
  const headerObserved = response.headers.get("x-observed-at") ?? dateIso;
  const headerPublished =
    response.headers.get("x-published-at") ??
    response.headers.get("last-modified") ??
    `${headerObserved.slice(0, 10)}T06:00:00Z`;

  try {
    const buffer = await response.arrayBuffer();
    const isTiff = isTiffMagicBytes(new Uint8Array(buffer));
    const preCommunes = isTiff ? await deps.communes() : [];
    const parsed = await parseClmsPayload(buffer, {
      contentType,
      geotiffMetadata: {
        productVersion: headerProduct,
        observedAt: headerObserved,
        publishedAt: headerPublished,
        communes: preCommunes,
      },
    });

    const bounded = interval
      ? parsed.records.filter((rec) => {
          const recMs = Date.parse(`${rec.observedAt}T12:00:00Z`);
          return (
            recMs >= Date.parse(interval.dataFrom) &&
            recMs <= Date.parse(interval.dataThrough)
          );
        })
      : parsed.records;

    const communes = isTiff
      ? preCommunes
      : bounded.length
        ? await deps.communes()
        : [];
    const communeByCode = new Map(communes.map((c) => [c.code, c]));
    const rows = toDbRows(bounded, communeByCode);
    const stored = rows.length ? await deps.upsert(rows) : 0;

    return {
      fetched: parsed.entriesSeen,
      stored,
      outside: parsed.entriesOutsideAlgeria,
      skippedQa: parsed.entriesSkippedQa,
      emptyWindow: bounded.length === 0,
      productVersion: parsed.productVersion,
      observedAt: parsed.observedAt,
      upstreamPublishedAt: parsed.upstreamPublishedAt,
      dataFrom: interval?.dataFrom ?? `${parsed.observedAt}T00:00:00.000Z`,
      dataThrough: interval?.dataThrough ?? parsed.upstreamPublishedAt,
    };
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      skippedQa: 0,
      emptyWindow: false,
      productVersion: null,
      observedAt: null,
      upstreamPublishedAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runClmsNdviSwiSource(
  job: ClaimedSourceJob,
  dependencies: ClmsDependencies = {},
  now: () => number = Date.now,
): Promise<SourceJobResult> {
  const interval: SourceReplayInterval | undefined =
    job.trigger_kind === "replay" && job.data_from && job.data_through
      ? { dataFrom: job.data_from, dataThrough: job.data_through }
      : undefined;

  const run = await ingestClmsLandIndices(dependencies, now, interval);
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
    recordsRejected: run.outside + run.skippedQa,
    qualityChecks: {
      is_calibrated_fuel: false,
      product_version: run.productVersion,
      qa_skipped: run.skippedQa,
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
