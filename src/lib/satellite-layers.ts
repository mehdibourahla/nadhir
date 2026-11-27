import { queryOptions } from "@tanstack/react-query";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";

import { supabase } from "@/integrations/supabase/client";

export type SatelliteRainfallCell = {
  source_key: string;
  valid_time: string;
  lat: number;
  lon: number;
  rate_mm_h: number;
  accum_mm_30m: number;
  wilaya_code: string | null;
};

export type LightningObservation = {
  source_key: string;
  observed_at: string;
  lat: number;
  lon: number;
  product_type: string;
  wilaya_code: string | null;
};

export type GwisBurnedArea = {
  event_id: string;
  burn_start_at: string;
  burn_end_at: string;
  area_ha: number;
  lat: number;
  lon: number;
  wilaya_code: string | null;
  estimation_basis: string;
  is_optical_scar: boolean;
  perimeter_geojson: Polygon | MultiPolygon;
};

export const EMPTY_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function isBurnPolygon(value: unknown): value is Polygon | MultiPolygon {
  if (!value || typeof value !== "object") return false;
  const g = value as { type?: unknown; coordinates?: unknown };
  return (
    (g.type === "Polygon" || g.type === "MultiPolygon") &&
    Array.isArray(g.coordinates)
  );
}

/** Keeps only the freshest valid_time snapshot per source_key so radar cells never stack across timestamps. */
export function latestRainfallSnapshotBySource(
  rows: SatelliteRainfallCell[],
): SatelliteRainfallCell[] {
  const latestBySource = new Map<string, string>();
  for (const row of rows) {
    const prev = latestBySource.get(row.source_key);
    if (!prev || row.valid_time > prev) {
      latestBySource.set(row.source_key, row.valid_time);
    }
  }
  return rows.filter(
    (row) => latestBySource.get(row.source_key) === row.valid_time,
  );
}

export const satelliteRainfallQuery = queryOptions({
  queryKey: ["nadhir", "satellite-rainfall"],
  queryFn: async (): Promise<SatelliteRainfallCell[]> => {
    const since = new Date(Date.now() - 3 * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("rainfall_observations")
      .select(
        "source_key, valid_time, lat, lon, rate_mm_h, accum_mm_30m, wilaya_code",
      )
      .gte("valid_time", since)
      .gt("rate_mm_h", 0.05)
      .order("valid_time", { ascending: false })
      .limit(1500);
    if (error) throw new Error(error.message);
    return latestRainfallSnapshotBySource(
      (data ?? []) as SatelliteRainfallCell[],
    );
  },
  staleTime: 2 * 60_000,
  refetchInterval: 3 * 60_000,
});

export const lightningObservationsQuery = queryOptions({
  queryKey: ["nadhir", "lightning-observations"],
  queryFn: async (): Promise<LightningObservation[]> => {
    const since = new Date(Date.now() - 2 * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("lightning_observations")
      .select("source_key, observed_at, lat, lon, product_type, wilaya_code")
      .gte("observed_at", since)
      .order("observed_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []) as LightningObservation[];
  },
  staleTime: 60_000,
  refetchInterval: 2 * 60_000,
});

export const gwisBurnedAreasQuery = queryOptions({
  queryKey: ["nadhir", "gwis-burned-areas"],
  queryFn: async (): Promise<GwisBurnedArea[]> => {
    const since = new Date(Date.now() - 90 * 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const { data, error } = await supabase
      .from("gwis_burned_areas")
      .select(
        "event_id, burn_start_at, burn_end_at, area_ha, lat, lon, wilaya_code, estimation_basis, is_optical_scar, perimeter_geojson",
      )
      .gte("burn_end_at", since)
      .order("burn_end_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<
      Omit<GwisBurnedArea, "perimeter_geojson"> & {
        perimeter_geojson: unknown;
      }
    >;
    return rows.filter((r): r is GwisBurnedArea =>
      isBurnPolygon(r.perimeter_geojson),
    );
  },
  staleTime: 10 * 60_000,
});

export function buildSatelliteRainfallGeoJSON(
  cells: SatelliteRainfallCell[],
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: cells
      .filter(
        (c) =>
          Number.isFinite(c.lat) &&
          Number.isFinite(c.lon) &&
          Number.isFinite(c.rate_mm_h) &&
          c.rate_mm_h > 0,
      )
      .map((c, idx) => ({
        type: "Feature",
        id: idx,
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
        properties: {
          source_key: c.source_key,
          valid_time: c.valid_time,
          rate_mm_h: c.rate_mm_h,
          accum_mm_30m: c.accum_mm_30m,
          wilaya_code: c.wilaya_code ?? "",
        },
      })),
  };
}

export function buildLightningGeoJSON(
  bolts: LightningObservation[],
  nowMs = Date.now(),
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: bolts
      .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lon))
      .map((b, idx) => {
        const ageMin = Math.max(
          0,
          Math.round((nowMs - Date.parse(b.observed_at)) / 60_000),
        );
        return {
          type: "Feature",
          id: idx,
          geometry: { type: "Point", coordinates: [b.lon, b.lat] },
          properties: {
            source_key: b.source_key,
            observed_at: b.observed_at,
            product_type: b.product_type,
            age_minutes: Number.isFinite(ageMin) ? ageMin : 60,
          },
        };
      }),
  };
}

export function buildGwisBurnedGeoJSON(
  areas: GwisBurnedArea[],
  selectedEventId?: string,
): FeatureCollection<Polygon | MultiPolygon> {
  const features: Feature<Polygon | MultiPolygon>[] = areas.map((a) => ({
    type: "Feature",
    id: a.event_id,
    geometry: a.perimeter_geojson,
    properties: {
      gwisEventId: a.event_id,
      area_ha: a.area_ha,
      burn_start_at: a.burn_start_at,
      burn_end_at: a.burn_end_at,
      wilaya_code: a.wilaya_code ?? "",
      selected: a.event_id === selectedEventId,
    },
  }));
  return { type: "FeatureCollection", features };
}

export function buildGwisCentroidGeoJSON(
  areas: GwisBurnedArea[],
  selectedEventId?: string,
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: areas
      .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
      .map((a) => ({
        type: "Feature",
        id: a.event_id,
        geometry: { type: "Point", coordinates: [a.lon, a.lat] },
        properties: {
          gwisEventId: a.event_id,
          area_ha: a.area_ha,
          selected: a.event_id === selectedEventId,
        },
      })),
  };
}
