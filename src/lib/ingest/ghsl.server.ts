import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllPages } from "@/lib/paginate";
import { ArchiveFailure, archivedFetch } from "@/lib/source-archive.server";
import {
  retryDispositionForReason,
  type ClaimedSourceJob,
  type SourceJobResult,
} from "@/lib/source-jobs";
import { publicReasonForError, sourceRunOutcome } from "@/lib/source-runs";

import {
  GHSL_EXPOSURE_LABEL,
  GHSL_SOURCE_KEY,
  parseGhslPayload,
  type GhslCommuneRef,
  type GhslEpochYear,
  type GhslExposureRecord,
  type GhslResolutionM,
} from "./ghsl";
import { isTiffMagicBytes } from "./imerg";
import { assertNotScientificUpstreamErrorBody } from "./mtg-fci-push";

type GhslInsert = Database["public"]["Tables"]["ghsl_exposure"]["Insert"];

export type GhslRun = {
  fetched: number;
  stored: number;
  outside: number;
  nodata: number;
  emptyTile: boolean;
  epochYear: GhslEpochYear | null;
  totalSourceResidents: number;
  totalAggregatedResidents: number;
  tileConservationDelta: number;
  publishedAt: string | null;
  error?: string;
};

function readEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

function toDbRows(
  records: readonly GhslExposureRecord[],
  communeByCode: ReadonlyMap<string, GhslCommuneRef>,
): GhslInsert[] {
  return records.map((rec) => {
    const matched = communeByCode.get(rec.communeCode);
    return {
      source_key: rec.sourceKey,
      epoch_year: rec.epochYear,
      dataset_release: rec.datasetRelease,
      crs_code: rec.crsCode,
      resolution_m: rec.resolutionM,
      exposure_label: rec.exposureLabel,
      commune_id: rec.communeId ?? matched?.id ?? null,
      commune_code: rec.communeCode,
      wilaya_code: rec.wilayaCode,
      lat: rec.lat,
      lon: rec.lon,
      modeled_residents: rec.modeledResidents,
      source_cell_sum: rec.sourceCellSum,
      source_cell_count: rec.sourceCellCount,
      conservation_delta: rec.conservationDelta,
      published_at: rec.publishedAt,
      attribution: rec.attribution,
    };
  });
}

const defaultStore = {
  feedUrl: () => readEnv("GHSL_POPULATION_URL") ?? null,
  fetch: (url: string) =>
    archivedFetch(
      GHSL_SOURCE_KEY,
      "ghsl_pop_r2023a_tile",
      url,
      { signal: AbortSignal.timeout(45_000) },
      {
        requestParams: {
          dataset: "GHS-POP-R2023A",
        },
      },
    ),
  communes: () =>
    fetchAllPages<GhslCommuneRef>((from, to) =>
      supabaseAdmin
        .from("admin_units")
        .select("id, code, lat, lon")
        .eq("level", "commune")
        .not("lat", "is", null)
        .not("lon", "is", null)
        .order("id")
        .range(from, to),
    ),
  upsert: async (rows: GhslInsert[]) => {
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from("ghsl_exposure")
        .upsert(batch, {
          onConflict: "source_key,epoch_year,resolution_m,commune_code",
        });
      if (error) {
        throw new Error(`ghsl_exposure upsert failed: ${error.message}`);
      }
    }
    return rows.length;
  },
};

export type GhslDependencies = Partial<typeof defaultStore>;

export async function ingestGhslPopulation(
  dependencies: GhslDependencies = {},
  now: () => number = Date.now,
): Promise<GhslRun> {
  const deps = { ...defaultStore, ...dependencies };
  const baseUrl = deps.feedUrl();

  if (!baseUrl) {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      nodata: 0,
      emptyTile: false,
      epochYear: null,
      totalSourceResidents: 0,
      totalAggregatedResidents: 0,
      tileConservationDelta: 0,
      publishedAt: null,
      error: "GHSL population URL not configured (GHSL_POPULATION_URL missing)",
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
      nodata: 0,
      emptyTile: false,
      epochYear: null,
      totalSourceResidents: 0,
      totalAggregatedResidents: 0,
      tileConservationDelta: 0,
      publishedAt: null,
      error: "GHSL population URL not configured: invalid feed URL",
    };
  }

  let response: Response;
  try {
    response = await deps.fetch(requestUrl.toString());
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      nodata: 0,
      emptyTile: false,
      epochYear: null,
      totalSourceResidents: 0,
      totalAggregatedResidents: 0,
      tileConservationDelta: 0,
      publishedAt: null,
      error: `GHSL upstream fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      nodata: 0,
      emptyTile: false,
      epochYear: null,
      totalSourceResidents: 0,
      totalAggregatedResidents: 0,
      tileConservationDelta: 0,
      publishedAt: null,
      error: `GHSL upstream HTTP ${response.status}`,
    };
  }

  const contentType = response.headers.get("content-type");
  const headerEpoch = Number(response.headers.get("x-ghsl-epoch") ?? 2025);
  const epochYear: GhslEpochYear =
    headerEpoch === 2020 || headerEpoch === 2030 ? headerEpoch : 2025;
  const headerRes = Number(response.headers.get("x-ghsl-resolution") ?? 100);
  const resolutionM: GhslResolutionM = headerRes === 1000 ? 1000 : 100;
  const headerPublished =
    response.headers.get("x-published-at") ??
    response.headers.get("last-modified") ??
    new Date(now()).toISOString();

  try {
    const buffer = await response.arrayBuffer();
    assertNotScientificUpstreamErrorBody(
      buffer,
      contentType,
      "GHSL",
      "GHSL population payload",
    );
    const isTiff = isTiffMagicBytes(new Uint8Array(buffer));
    let communes: GhslCommuneRef[] = [];
    if (isTiff) {
      communes = await deps.communes();
    } else {
      const preview = new TextDecoder("utf-8", { fatal: false }).decode(
        new Uint8Array(buffer),
      );
      if (preview.includes('"cells"')) {
        communes = await deps.communes();
      }
    }
    const parsed = await parseGhslPayload(buffer, {
      contentType,
      communes,
      geotiffMetadata: {
        epochYear,
        resolutionM,
        publishedAt: headerPublished,
        communes,
      },
    });

    if (!communes.length && parsed.records.length) {
      communes = await deps.communes();
    }
    const communeByCode = new Map(communes.map((c) => [c.code, c]));
    const rows = toDbRows(parsed.records, communeByCode);
    const stored = rows.length ? await deps.upsert(rows) : 0;

    return {
      fetched: parsed.cellsSeen,
      stored,
      outside: parsed.cellsOutsideAlgeria,
      nodata: parsed.cellsNodata,
      emptyTile: parsed.emptyTile,
      epochYear: parsed.epochYear,
      totalSourceResidents: parsed.totalSourceResidents,
      totalAggregatedResidents: parsed.totalAggregatedResidents,
      tileConservationDelta: parsed.tileConservationDelta,
      publishedAt: parsed.publishedAt,
    };
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      nodata: 0,
      emptyTile: false,
      epochYear: null,
      totalSourceResidents: 0,
      totalAggregatedResidents: 0,
      tileConservationDelta: 0,
      publishedAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runGhslPopulationSource(
  job: ClaimedSourceJob,
  dependencies: GhslDependencies = {},
  now: () => number = Date.now,
): Promise<SourceJobResult> {
  const run = await ingestGhslPopulation(dependencies, now);
  const accepted = run.emptyTile && !run.error ? 1 : run.stored;
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
    publishedAt: run.publishedAt,
    upstreamPublishedAt: run.publishedAt,
    dataFrom: health.outcome === "succeeded" ? job.data_from : null,
    dataThrough: health.outcome === "succeeded" ? job.data_through : null,
    recordsSeen: run.fetched,
    recordsInserted: run.stored,
    recordsRejected: run.outside + run.nodata,
    qualityChecks: {
      exposure_label: GHSL_EXPOSURE_LABEL,
      population_conserving: true,
      epoch_year: run.epochYear,
      tile_conservation_delta: run.tileConservationDelta,
      empty_tile: run.emptyTile,
    },
    publicReasonCode: reason,
    privateDiagnostic: run.error ?? null,
    retryDisposition:
      health.outcome === "succeeded" || health.outcome === "skipped"
        ? "none"
        : retryDispositionForReason(reason ?? "internal_error"),
  };
}
