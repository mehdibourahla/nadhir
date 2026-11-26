import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { haversineKm } from "@/lib/nadhir";
import { fetchAllPages } from "@/lib/paginate";
import { ArchiveFailure, archivedFetch } from "@/lib/source-archive.server";
import {
  retryDispositionForReason,
  type ClaimedSourceJob,
  type SourceJobResult,
} from "@/lib/source-jobs";
import { publicReasonForError, sourceRunOutcome } from "@/lib/source-runs";

import {
  buildCraagParseResultFromResolved,
  CRAAG_ATTRIBUTION,
  CRAAG_DEFAULT_URL,
  CRAAG_SOURCE_KEY,
  matchCraagToEmsc,
  parseCraagBulletins,
  parseCraagMapCoordinates,
  parseCraagSummaryTable,
  type CraagBulletin,
  type CraagParseResult,
  type EmscMatchCandidate,
} from "./craag";

export type CraagAttributionApplyInput = {
  bulletin: CraagBulletin;
  matchedEarthquakeId: string | null;
  communeId: string | null;
  offshore: boolean;
};

export type CraagRun = {
  fetched: number;
  matched: number;
  standalone: number;
  outside: number;
  belowFloor: number;
  emptyPage: boolean;
  upstreamPublishedAt: string | null;
  error?: string;
};

const NEAR_ALGERIA_KM = 100;
const CANDIDATE_LOOKBACK_DAYS = 14;

function readEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

function locateBulletinCommune(
  bulletin: CraagBulletin,
  communes: readonly { id: string; lat: number; lon: number }[],
): { communeId: string; offshore: boolean } | null {
  let nearest: { id: string; km: number } | null = null;
  for (const c of communes) {
    const km = haversineKm(bulletin.lat, bulletin.lon, c.lat, c.lon);
    if (!nearest || km < nearest.km) nearest = { id: c.id, km };
  }
  if (!nearest || nearest.km > NEAR_ALGERIA_KM) return null;
  return {
    communeId: nearest.id,
    offshore: /\b(?:MER|SEA|COAST|MEDITERRAN|البحر|ساحل)\b/i.test(
      bulletin.place,
    ),
  };
}

const defaultStore = {
  feedUrl: () => readEnv("CRAAG_FEED_URL") ?? CRAAG_DEFAULT_URL,
  fetch: (url: string) =>
    archivedFetch(
      CRAAG_SOURCE_KEY,
      "official_bulletins",
      url,
      {
        signal: AbortSignal.timeout(20_000),
        headers: { "User-Agent": "Nadhir/1.1 (+https://nadhir.app)" },
      },
      { requestParams: { format: "html_or_json" } },
    ),
  fetchMap: (url: string) =>
    archivedFetch(
      CRAAG_SOURCE_KEY,
      "bulletin_map",
      url,
      {
        signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": "Nadhir/1.1 (+https://nadhir.app)" },
      },
      { requestParams: { page: "map" } },
    ),
  recentEmscEvents: async (sinceIso: string): Promise<EmscMatchCandidate[]> => {
    const { data, error } = await supabaseAdmin
      .from("earthquakes")
      .select("id, occurred_at, lat, lon, magnitude, network")
      .gte("occurred_at", sinceIso)
      .not("id", "like", "craag:%")
      .order("occurred_at", { ascending: false })
      .limit(1000);
    if (error) {
      throw new Error(`earthquakes lookup failed: ${error.message}`);
    }
    return (data ?? []).map((row) => ({
      ...row,
      magnitude: Number(row.magnitude),
    }));
  },
  communes: () =>
    fetchAllPages<{ id: string; lat: number; lon: number }>((from, to) =>
      supabaseAdmin
        .from("admin_units")
        .select("id, lat, lon")
        .eq("level", "commune")
        .not("lat", "is", null)
        .not("lon", "is", null)
        .order("id")
        .range(from, to),
    ),
  applyAttribution: async (
    input: CraagAttributionApplyInput,
  ): Promise<{ mode: "matched" | "standalone"; earthquakeId: string }> => {
    const { bulletin, matchedEarthquakeId, communeId, offshore } = input;
    const { data, error } = await supabaseAdmin.rpc(
      "apply_craag_earthquake_attribution",
      {
        _bulletin_id: bulletin.bulletinId,
        _matched_earthquake_id: matchedEarthquakeId,
        _observed_at: bulletin.observedAt,
        _lat: bulletin.lat,
        _lon: bulletin.lon,
        _depth_km: bulletin.depthKm,
        _magnitude: bulletin.magnitude,
        _magnitude_type: bulletin.magnitudeType,
        _place: bulletin.place,
        _source_url: bulletin.sourceUrl,
        _attribution: bulletin.attribution || CRAAG_ATTRIBUTION,
        _commune_id: communeId,
        _offshore: offshore,
      },
    );
    if (error) {
      throw new Error(`CRAAG attribution apply failed: ${error.message}`);
    }
    const payload = (data ?? {}) as { mode?: string; earthquake_id?: string };
    return {
      mode: payload.mode === "standalone" ? "standalone" : "matched",
      earthquakeId:
        payload.earthquake_id ??
        matchedEarthquakeId ??
        `craag:${bulletin.bulletinId}`,
    };
  },
};

export type CraagDependencies = Partial<typeof defaultStore>;

export async function ingestCraag(
  dependencies: CraagDependencies = {},
  now: () => number = Date.now,
): Promise<CraagRun> {
  const deps = { ...defaultStore, ...dependencies };
  const url = deps.feedUrl();

  let response: Response;
  try {
    response = await deps.fetch(url);
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      matched: 0,
      standalone: 0,
      outside: 0,
      belowFloor: 0,
      emptyPage: false,
      upstreamPublishedAt: null,
      error: `CRAAG upstream fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    return {
      fetched: 0,
      matched: 0,
      standalone: 0,
      outside: 0,
      belowFloor: 0,
      emptyPage: false,
      upstreamPublishedAt: null,
      error: `CRAAG upstream HTTP ${response.status}`,
    };
  }

  try {
    const body = await response.text();
    let parsed: CraagParseResult;
    try {
      parsed = parseCraagBulletins(body, {
        contentType: response.headers.get("content-type"),
        baseUrl: url,
      });
    } catch (primaryError) {
      const summaryRows = parseCraagSummaryTable(body, url);
      if (!summaryRows) throw primaryError;
      const recentCutoffMs = now() - 60 * 86_400_000;
      const candidateRows = summaryRows
        .filter((r) => Date.parse(r.observedAt) >= recentCutoffMs)
        .slice(0, 10);
      const resolved: {
        summary: (typeof summaryRows)[number];
        lat: number;
        lon: number;
      }[] = [];
      let mapFetchFailures = 0;
      for (const row of candidateRows) {
        if (!row.sourceUrl) continue;
        try {
          const mapRes = await deps.fetchMap(row.sourceUrl);
          if (!mapRes.ok) {
            mapFetchFailures += 1;
            continue;
          }
          const coords = parseCraagMapCoordinates(await mapRes.text());
          if (coords) {
            resolved.push({ summary: row, lat: coords.lat, lon: coords.lon });
          } else {
            mapFetchFailures += 1;
          }
        } catch (mapErr) {
          if (mapErr instanceof ArchiveFailure) throw mapErr;
          mapFetchFailures += 1;
        }
      }
      if (
        candidateRows.length > 0 &&
        resolved.length === 0 &&
        mapFetchFailures > 0
      ) {
        throw new Error(
          `CRAAG map coordinate resolution failed for all ${mapFetchFailures} eligible summary rows`,
          { cause: primaryError },
        );
      }
      parsed = buildCraagParseResultFromResolved(resolved);
      if (parsed.bulletins.length === 0 && summaryRows.length > 0) {
        parsed.emptyPage = resolved.length === 0;
        let maxIso = parsed.upstreamPublishedAt;
        for (const r of summaryRows) {
          if (!maxIso || Date.parse(r.observedAt) > Date.parse(maxIso)) {
            maxIso = r.observedAt;
          }
        }
        parsed.upstreamPublishedAt = maxIso;
      }
    }

    if (!parsed.bulletins.length) {
      return {
        fetched: parsed.allBulletinsCount,
        matched: 0,
        standalone: 0,
        outside: parsed.outsideCount,
        belowFloor: parsed.belowFloorCount,
        emptyPage: parsed.emptyPage,
        upstreamPublishedAt: parsed.upstreamPublishedAt,
      };
    }

    const oldestBulletinMs = Math.min(
      ...parsed.bulletins.map((b) => Date.parse(b.observedAt)),
    );
    const lookbackStart = Math.min(
      now() - CANDIDATE_LOOKBACK_DAYS * 86_400_000,
      oldestBulletinMs - 600_000,
    );
    const [emscCandidates, communes] = await Promise.all([
      deps.recentEmscEvents(new Date(lookbackStart).toISOString()),
      deps.communes(),
    ]);

    let matched = 0;
    let standalone = 0;
    let extraOutside = 0;

    for (const bulletin of parsed.bulletins) {
      const hit = matchCraagToEmsc(bulletin, emscCandidates);
      if (hit) {
        const applied = await deps.applyAttribution({
          bulletin,
          matchedEarthquakeId: hit.earthquakeId,
          communeId: null,
          offshore: false,
        });
        if (applied.mode === "matched") matched += 1;
        else standalone += 1;
        continue;
      }

      const located = locateBulletinCommune(bulletin, communes);
      if (!located) {
        extraOutside += 1;
        continue;
      }
      const applied = await deps.applyAttribution({
        bulletin,
        matchedEarthquakeId: null,
        communeId: located.communeId,
        offshore: located.offshore,
      });
      if (applied.mode === "matched") matched += 1;
      else standalone += 1;
    }

    return {
      fetched: parsed.allBulletinsCount,
      matched,
      standalone,
      outside: parsed.outsideCount + extraOutside,
      belowFloor: parsed.belowFloorCount,
      emptyPage: false,
      upstreamPublishedAt: parsed.upstreamPublishedAt,
    };
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      matched: 0,
      standalone: 0,
      outside: 0,
      belowFloor: 0,
      emptyPage: false,
      upstreamPublishedAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runCraagSource(
  job: ClaimedSourceJob,
  dependencies: CraagDependencies = {},
  now: () => number = Date.now,
): Promise<SourceJobResult> {
  const run = await ingestCraag(dependencies, now);
  const accepted = run.matched + run.standalone + (run.emptyPage ? 1 : 0);
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
    dataFrom: health.outcome === "succeeded" ? job.data_from : null,
    dataThrough: health.outcome === "succeeded" ? job.data_through : null,
    recordsSeen: run.fetched,
    recordsInserted: run.standalone,
    recordsUpdated: run.matched,
    recordsRejected: run.outside + run.belowFloor,
    qualityChecks: {
      matched_emsc_events: run.matched,
      standalone_craag_events: run.standalone,
      empty_or_static_page: run.emptyPage,
      below_m2_floor: run.belowFloor,
    },
    publicReasonCode: reason,
    privateDiagnostic: run.error ?? null,
    retryDisposition:
      health.outcome === "succeeded" || health.outcome === "skipped"
        ? "none"
        : retryDispositionForReason(reason ?? "internal_error"),
  };
}
