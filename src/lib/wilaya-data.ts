import { supabase } from "@/integrations/supabase/client";
import {
  STATION_FRESH_HOURS,
  type AirportWeather,
} from "@/lib/airport-weather";
import {
  QUAKE_NEARBY_RADIUS_KM,
  QUAKE_WINDOW_HOURS,
  type Earthquake,
} from "@/lib/earthquakes";
import {
  fireLevel,
  singleCandidateLinks,
  type FireLevel,
} from "@/lib/fire-confidence";
import { officialPhase } from "@/lib/incident-lifecycle";
import {
  fireStage,
  haversineKm,
  publishedRiskSnapshot,
  type AdminUnit,
  type FireCluster,
  type OfficialIncident,
  type OnmVigilance,
  type RiskForecast,
} from "@/lib/nadhir";
import type { WilayaSlugEntry } from "@/lib/wilaya-slugs";

const ADMIN_UNIT_FIELDS =
  "id, level, code, name_ar, name_fr, name_en, name_kab, parent_id, lat, lon, forest_fraction, population";

const ONM_FIELDS =
  "id, cap_id, title, event, severity, urgency, certainty, onset, expires, sent, area_desc, cap_url, wilaya_id, headline_fr, superseded_at, msg_type, cap_references, superseded_by, cancelled_at";

const OFFICIAL_INCIDENT_FIELDS =
  "id, wilaya_id, commune_id, kind, status, precision, authority_tier, place_text, first_reported_at, last_reported_at, as_of, updated_at, unlisted_at, mention_count, evidence, commune:admin_units!official_incidents_commune_id_fkey(name_ar, name_fr, name_en, name_kab, lat, lon), wilaya:admin_units!official_incidents_wilaya_id_fkey(name_ar, name_fr, name_en, name_kab, lat, lon), latest_mention:incident_mentions!official_incidents_latest_mention_fkey(document:source_documents(url, published_at), source:text_sources(label))";

const FIRE_CLUSTER_FIELDS =
  "id, short_id, state, first_detected_at, last_detected_at, lat, lon, detection_count, sources, max_frp_mw, confidence, est_area_ha, fci_growth, wind_speed_kmh, wind_dir_deg, spread_bearing_deg, wind_gust_kmh, vpd_kpa, soil_moisture_m3m3, commune_id, wilaya_id, nearest_settlement_id, nearest_settlement_km, confirmed_at, resolved_at, confirmed_mention_id";

const EARTHQUAKE_FIELDS =
  "id, occurred_at, lat, lon, depth_km, magnitude, magnitude_type, region, network, commune_id, offshore";

const AIRPORT_WEATHER_FIELDS =
  "station, name, lat, lon, observed_at, temp_c, wind_kt, gust_kt, visibility_m, weather, raw";

const RISK_FORECAST_FIELDS =
  "id,commune_id,forecast_date,horizon_days,source,fwi,fwi_percentile,danger_level,fuel_limited,snapshot_id";

const WINDOW_72H_MS = 72 * 3_600_000;
const DEFAULT_TIMEOUT_MS = 3500;
const STATION_WILAYA_RADIUS_KM = 100;

export interface WilayaProbableFire {
  id: string;
  shortId: string;
  level: Extract<FireLevel, "confirmed" | "probable">;
  state: FireCluster["state"];
  lat: number;
  lon: number;
  communeId: string | null;
  detectionCount: number;
  sources: string[];
  firstDetectedAt: string;
  lastDetectedAt: string;
  confirmedAt: string | null;
}

export interface WilayaEarthquake extends Earthquake {
  distanceKm: number;
  attribution: string;
}

export interface WilayaFireDangerSummary {
  dangerLevel: number;
  fwi: number;
  percentile: number | null;
  communeId: string | null;
  forecastDate: string;
  fuelLimitedCount: number;
  totalCount: number;
  allFuelLimited: boolean;
}

export interface WilayaAirportStation extends AirportWeather {
  distanceKm: number;
}

export interface WilayaSnapshot {
  wilaya: WilayaSlugEntry;
  dataStatus: "ok" | "partial" | "unavailable";
  fetchedAt: string;
  communes: AdminUnit[];
  onmWarnings: OnmVigilance[];
  officialIncidents: OfficialIncident[];
  probableFires: WilayaProbableFire[];
  heatSignalCount: number;
  earthquakes: WilayaEarthquake[];
  fireDanger: WilayaFireDangerSummary | null;
  airportWeather: WilayaAirportStation[];
}

export function isSupabaseConfigured(): boolean {
  const viteUrl =
    typeof import.meta !== "undefined" && import.meta.env
      ? import.meta.env["VITE_SUPABASE_URL"]
      : undefined;
  const viteKey =
    typeof import.meta !== "undefined" && import.meta.env
      ? import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]
      : undefined;
  const procUrl =
    typeof process !== "undefined" && process.env
      ? process.env["SUPABASE_URL"]
      : undefined;
  const procKey =
    typeof process !== "undefined" && process.env
      ? process.env["SUPABASE_PUBLISHABLE_KEY"]
      : undefined;

  const url = String(viteUrl || procUrl || "").trim();
  const key = String(viteKey || procKey || "").trim();
  return url.length > 0 && key.length > 0;
}

export function filterActiveOnmWarnings(
  warnings: readonly OnmVigilance[],
  nowMs: number = Date.now(),
): OnmVigilance[] {
  const seen = new Map<string, OnmVigilance>();
  for (const w of warnings) {
    if (
      w.superseded_at ||
      w.cancelled_at ||
      w.superseded_by ||
      w.msg_type === "Cancel"
    ) {
      continue;
    }
    if (!w.expires) continue;
    const expiresMs = Date.parse(w.expires);
    if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) continue;
    const key = `${w.event}|${w.severity}|${w.onset ?? ""}|${w.expires}`;
    if (!seen.has(key)) seen.set(key, w);
  }
  return [...seen.values()];
}

export function filterActiveOfficialIncidents(
  incidents: readonly OfficialIncident[],
  nowMs: number = Date.now(),
): OfficialIncident[] {
  return incidents.filter((incident) => {
    const phase = officialPhase(incident, nowMs);
    return phase !== "ended" && phase !== "archived";
  });
}

/**
 * ADR-0002 fire classification for wilaya pages:
 * - Only `confirmed` and `probable` clusters are listed as Active Probable Fires.
 * - Uncorroborated `heat_signal` clusters are NEVER included in `probableFires`;
 *   only their count is returned for an explicit caveat footnote.
 */
export function classifyWilayaFires(
  clusters: readonly FireCluster[],
  communesById: ReadonlyMap<string, AdminUnit>,
  riskByCommuneId: ReadonlyMap<string, RiskForecast>,
  officialIncidents: readonly OfficialIncident[],
): { probableFires: WilayaProbableFire[]; heatSignalCount: number } {
  const linked = singleCandidateLinks(officialIncidents, clusters);
  const probableFires: WilayaProbableFire[] = [];
  let heatSignalCount = 0;

  for (const cluster of clusters) {
    if (
      cluster.state === "false_positive" ||
      (cluster.state === "extinguished" && cluster.resolved_at !== null)
    ) {
      continue;
    }
    const commune = cluster.commune_id
      ? communesById.get(cluster.commune_id)
      : undefined;
    const risk = cluster.commune_id
      ? riskByCommuneId.get(cluster.commune_id)
      : undefined;
    const level = fireLevel(fireStage(cluster), {
      forestFraction: commune?.forest_fraction ?? null,
      dangerLevel:
        risk && !risk.fuel_limited && Number.isFinite(risk.danger_level)
          ? risk.danger_level
          : null,
      nearbySighting: false,
      officialMention: linked.has(cluster.id),
    });

    if (level === "confirmed" || level === "probable") {
      probableFires.push({
        id: cluster.id,
        shortId: cluster.short_id,
        level,
        state: cluster.state,
        lat: cluster.lat,
        lon: cluster.lon,
        communeId: cluster.commune_id,
        detectionCount: cluster.detection_count,
        sources: cluster.sources,
        firstDetectedAt: cluster.first_detected_at,
        lastDetectedAt: cluster.last_detected_at,
        confirmedAt: cluster.confirmed_at,
      });
    } else {
      heatSignalCount += 1;
    }
  }

  return { probableFires, heatSignalCount };
}

export function filterWilayaEarthquakes(
  earthquakes: readonly Earthquake[],
  wilaya: Pick<WilayaSlugEntry, "lat" | "lon">,
  communeIds: ReadonlySet<string>,
  maxRadiusKm: number = QUAKE_NEARBY_RADIUS_KM,
): WilayaEarthquake[] {
  const matched: WilayaEarthquake[] = [];
  for (const q of earthquakes) {
    if (
      !Number.isFinite(q.lat) ||
      !Number.isFinite(q.lon) ||
      !Number.isFinite(q.magnitude)
    ) {
      continue;
    }
    const distance = haversineKm(wilaya.lat, wilaya.lon, q.lat, q.lon);
    const inCommune = q.commune_id !== null && communeIds.has(q.commune_id);
    if (!inCommune && distance > maxRadiusKm) continue;
    matched.push({
      ...q,
      distanceKm: Math.round(distance),
      attribution: q.network?.trim() || "EMSC",
    });
  }
  return matched.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

export function summarizeWilayaFireDanger(
  forecasts: readonly RiskForecast[],
): WilayaFireDangerSummary | null {
  const valid = forecasts.filter(
    (r) =>
      r.horizon_days === 0 &&
      Number.isFinite(r.danger_level) &&
      Number.isFinite(r.fwi),
  );
  if (valid.length === 0) return null;

  let fuelLimitedCount = 0;
  let worst: RiskForecast | null = null;
  for (const row of valid) {
    if (row.fuel_limited) {
      fuelLimitedCount += 1;
      continue;
    }
    if (
      !worst ||
      row.danger_level > worst.danger_level ||
      (row.danger_level === worst.danger_level && row.fwi > worst.fwi)
    ) {
      worst = row;
    }
  }

  if (!worst) {
    const first = valid[0]!;
    return {
      dangerLevel: 1,
      fwi: 0,
      percentile: null,
      communeId: null,
      forecastDate: first.forecast_date,
      fuelLimitedCount,
      totalCount: valid.length,
      allFuelLimited: true,
    };
  }

  return {
    dangerLevel: worst.danger_level,
    fwi: worst.fwi,
    percentile:
      worst.fwi_percentile !== null && Number.isFinite(worst.fwi_percentile)
        ? worst.fwi_percentile
        : null,
    communeId: worst.commune_id,
    forecastDate: worst.forecast_date,
    fuelLimitedCount,
    totalCount: valid.length,
    allFuelLimited: false,
  };
}

export function selectNearbyAirportWeather(
  stations: readonly AirportWeather[],
  point: { lat: number; lon: number },
  nowMs: number = Date.now(),
  maxDistanceKm: number = STATION_WILAYA_RADIUS_KM,
  limit = 2,
): WilayaAirportStation[] {
  const maxAgeMs = STATION_FRESH_HOURS * 3_600_000;
  const fresh: WilayaAirportStation[] = [];
  for (const s of stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const observedMs = Date.parse(s.observed_at);
    if (!Number.isFinite(observedMs) || nowMs - observedMs > maxAgeMs) continue;
    const km = haversineKm(point.lat, point.lon, s.lat, s.lon);
    if (km > maxDistanceKm) continue;
    fresh.push({ ...s, distanceKm: Math.round(km) });
  }
  return fresh
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, Math.max(1, limit));
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms`));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function emptySnapshot(
  wilaya: WilayaSlugEntry,
  fetchedAt: string,
): WilayaSnapshot {
  return {
    wilaya,
    dataStatus: "unavailable",
    fetchedAt,
    communes: [],
    onmWarnings: [],
    officialIncidents: [],
    probableFires: [],
    heatSignalCount: 0,
    earthquakes: [],
    fireDanger: null,
    airportWeather: [],
  };
}

/**
 * Isomorphic, offline-resilient per-wilaya snapshot loader for `/wilaya/$slug`.
 * NEVER throws: returns `dataStatus: "unavailable"` when Supabase is unconfigured
 * or unreachable so all 69 canonical wilaya pages always return HTTP 200.
 */
export async function fetchWilayaSnapshot(
  wilaya: WilayaSlugEntry,
  options?: { timeoutMs?: number; nowMs?: number },
): Promise<WilayaSnapshot> {
  const nowMs = options?.nowMs ?? Date.now();
  const fetchedAt = new Date(nowMs).toISOString();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!isSupabaseConfigured()) {
    return emptySnapshot(wilaya, fetchedAt);
  }

  try {
    const wilayaResult = await withTimeout(
      supabase
        .from("admin_units")
        .select(ADMIN_UNIT_FIELDS)
        .eq("level", "wilaya")
        .eq("code", wilaya.code)
        .maybeSingle(),
      timeoutMs,
    );

    if (wilayaResult.error || !wilayaResult.data) {
      return emptySnapshot(wilaya, fetchedAt);
    }

    const wilayaRow = wilayaResult.data as AdminUnit;
    const nowIso = new Date(nowMs).toISOString();
    const since72h = new Date(nowMs - WINDOW_72H_MS).toISOString();
    const quakeSince = new Date(
      nowMs - QUAKE_WINDOW_HOURS * 3_600_000,
    ).toISOString();

    const [
      communesRes,
      onmRes,
      incidentsRes,
      firesRes,
      quakesRes,
      stationsRes,
      checkpointRes,
    ] = await Promise.allSettled([
      withTimeout(
        supabase
          .from("admin_units")
          .select(ADMIN_UNIT_FIELDS)
          .eq("level", "commune")
          .eq("parent_id", wilayaRow.id)
          .order("code")
          .limit(200),
        timeoutMs,
      ),
      withTimeout(
        supabase
          .from("onm_vigilance")
          .select(ONM_FIELDS)
          .eq("wilaya_id", wilayaRow.id)
          .gt("expires", nowIso)
          .is("superseded_at", null)
          .is("cancelled_at", null)
          .is("superseded_by", null)
          .neq("msg_type", "Cancel")
          .order("sent", { ascending: false })
          .limit(50),
        timeoutMs,
      ),
      withTimeout(
        supabase
          .from("official_incidents")
          .select(OFFICIAL_INCIDENT_FIELDS)
          .eq("wilaya_id", wilayaRow.id)
          .gte("last_reported_at", since72h)
          .order("last_reported_at", { ascending: false })
          .limit(50),
        timeoutMs,
      ),
      withTimeout(
        supabase
          .from("fire_clusters")
          .select(FIRE_CLUSTER_FIELDS)
          .eq("wilaya_id", wilayaRow.id)
          .neq("state", "false_positive")
          .gte("last_detected_at", since72h)
          .order("last_detected_at", { ascending: false })
          .limit(100),
        timeoutMs,
      ),
      withTimeout(
        supabase
          .from("earthquakes")
          .select(EARTHQUAKE_FIELDS)
          .gt("occurred_at", quakeSince)
          .order("occurred_at", { ascending: false })
          .limit(200),
        timeoutMs,
      ),
      withTimeout(
        supabase
          .from("airport_weather")
          .select(AIRPORT_WEATHER_FIELDS)
          .order("station")
          .limit(100),
        timeoutMs,
      ),
      withTimeout(
        supabase
          .from("risk_publication_checkpoint")
          .select("coverage_status, snapshot_id, base_date, published_at")
          .eq("key", "local_fwi")
          .maybeSingle(),
        timeoutMs,
      ),
    ]);

    let failedCount = 0;

    const extract = <T>(
      settled: PromiseSettledResult<{ data: unknown; error: unknown }>,
      fallback: T,
    ): T => {
      if (settled.status !== "fulfilled" || settled.value.error) {
        failedCount += 1;
        return fallback;
      }
      return (settled.value.data ?? fallback) as T;
    };

    const communes = extract<AdminUnit[]>(communesRes, []);
    const rawOnm = extract<OnmVigilance[]>(onmRes, []);
    const rawIncidents = extract<OfficialIncident[]>(incidentsRes, []);
    const rawFires = extract<FireCluster[]>(firesRes, []);
    const rawQuakes = extract<Earthquake[]>(quakesRes, []).map((q) => ({
      ...q,
      magnitude: Number(q.magnitude),
    }));
    const rawStations = extract<AirportWeather[]>(stationsRes, []).map((s) => ({
      ...s,
      temp_c: s.temp_c === null ? null : Number(s.temp_c),
    }));

    const checkpoint =
      checkpointRes.status === "fulfilled" && !checkpointRes.value.error
        ? checkpointRes.value.data
        : null;
    if (checkpointRes.status !== "fulfilled" || checkpointRes.value.error) {
      failedCount += 1;
    }

    let riskRows: RiskForecast[] = [];
    const publication = publishedRiskSnapshot(checkpoint);
    const communeIds = communes.map((c) => c.id);
    if (publication && communeIds.length > 0) {
      try {
        const riskRes = await withTimeout(
          supabase
            .rpc("current_risk_forecasts")
            .select(RISK_FORECAST_FIELDS)
            .eq("source", "local_fwi")
            .eq("snapshot_id", publication.snapshotId)
            .eq("horizon_days", 0)
            .eq("forecast_date", publication.base)
            .in("commune_id", communeIds),
          timeoutMs,
        );
        if (riskRes.error) {
          failedCount += 1;
        } else {
          riskRows = (riskRes.data ?? []) as RiskForecast[];
        }
      } catch {
        failedCount += 1;
      }
    }

    const communesById = new Map(communes.map((c) => [c.id, c]));
    const communeIdSet = new Set(communeIds);
    const riskByCommuneId = new Map(riskRows.map((r) => [r.commune_id, r]));

    const onmWarnings = filterActiveOnmWarnings(rawOnm, nowMs);
    const officialIncidents = filterActiveOfficialIncidents(
      rawIncidents,
      nowMs,
    );
    const { probableFires, heatSignalCount } = classifyWilayaFires(
      rawFires,
      communesById,
      riskByCommuneId,
      officialIncidents,
    );
    const earthquakes = filterWilayaEarthquakes(
      rawQuakes,
      wilaya,
      communeIdSet,
    );
    const fireDanger = summarizeWilayaFireDanger(riskRows);
    const airportWeather = selectNearbyAirportWeather(
      rawStations,
      wilaya,
      nowMs,
    );

    return {
      wilaya,
      dataStatus: failedCount === 0 ? "ok" : "partial",
      fetchedAt,
      communes,
      onmWarnings,
      officialIncidents,
      probableFires,
      heatSignalCount,
      earthquakes,
      fireDanger,
      airportWeather,
    };
  } catch {
    return emptySnapshot(wilaya, fetchedAt);
  }
}
