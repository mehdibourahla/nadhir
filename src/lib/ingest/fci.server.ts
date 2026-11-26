import { archivedFetch, ArchiveFailure } from "@/lib/source-archive.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SourceReplayInterval } from "@/lib/source-jobs";

import { isInWatchArea } from "./geo";

/* MTG FCI active-fire detections via EUMETSAT's public WFS: the same product the
 * Data Store serves as netCDF, pre-decoded to GeoJSON points, anonymous, ~25 min
 * behind real time at 10-minute cadence. The layer serves a long archive, so the
 * request must be time-filtered server-side or it pages months of history.
 * CQL BBOX is LAT-FIRST here; a lon-first box returns plausible fires in the
 * wrong hemisphere, hence the parse-side watch-box guard. */
const WFS_URL = "https://view.eumetsat.int/geoserver/wfs";

export type WfsFireLayer = {
  source: "fci" | "s3";
  layers: string[];
  sensor: (satellite: string | undefined) => string;
  windowMin: number;
  slotMin: number;
};

export const MTG_FCI: WfsFireLayer = {
  source: "fci",
  layers: ["mtg_fd:frp"],
  sensor: () => "FCI",
  windowMin: 40,
  slotMin: 10,
};

// Polar orbiter: two overpasses a day per satellite, NRT delivery under 3 h.
export const S3_SLSTR: WfsFireLayer = {
  source: "s3",
  layers: [
    "copernicus:sentinel3a_slstr_level2_frp",
    "copernicus:sentinel3b_slstr_level2_frp",
  ],
  sensor: (satellite) => `SLSTR-${satellite ?? "S3"}`,
  windowMin: 360,
  slotMin: 60,
};
/* Server-side prefilter and axis-order sentinel only. It spans the whole country
 * on purpose, so a lon-first response lands outside it and trips the guard below;
 * isInWatchArea is what decides a detection is on burnable ground. */
const WATCH = { south: 18.9, west: -8.7, north: 37.6, east: 12.0 };

export type FciFeatureCollection = {
  features: {
    geometry: { coordinates: [number, number] };
    properties: {
      FRP?: number;
      Confidence?: number;
      SZA?: number;
      Satellite?: string;
      Datetime?: string;
      time?: string;
    };
  }[];
};

export type FciRow = {
  source: "fci" | "s3";
  sensor: string;
  detected_at: string;
  lat: number;
  lon: number;
  confidence_raw: number;
  frp_mw: number | null;
  daynight: string | null;
  natural_key: string;
};

const ISO_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/i;

function parseStrictIsoTimestamp(value: string): number {
  const m = ISO_TIMESTAMP_RE.exec(value);
  if (!m) return Number.NaN;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return Number.NaN;
  }
  if (m[10] !== undefined && m[11] !== undefined) {
    const tzHour = Number(m[10]);
    const tzMinute = Number(m[11]);
    if (tzHour > 23 || tzMinute > 59) return Number.NaN;
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return Number.NaN;
  }
  const ms = Date.parse(value.replace(" ", "T"));
  return Number.isFinite(ms) ? ms : Number.NaN;
}

export function parseFciFeatures(json: FciFeatureCollection) {
  return parseWfsFireFeatures(json, MTG_FCI);
}

export function parseWfsFireFeatures(
  json: FciFeatureCollection,
  layer: WfsFireLayer,
): {
  rows: FciRow[];
  outside: number;
  filtered: number;
  latestSlot: string | null;
} {
  const rows: FciRow[] = [];
  let outside = 0;
  let filtered = 0;
  let latestSlot: string | null = null;
  let latestSlotMs = Number.NEGATIVE_INFINITY;
  if (!json || typeof json !== "object" || !Array.isArray(json.features)) {
    return { rows, outside, filtered, latestSlot };
  }
  for (const f of json.features) {
    if (!f || typeof f !== "object") continue;
    const coords = f.geometry?.coordinates;
    const [lon, lat] = Array.isArray(coords) ? coords : [NaN, NaN];
    const slot =
      typeof f.properties?.time === "string" ? f.properties.time : "";
    const slotMs = parseStrictIsoTimestamp(slot);
    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180 ||
      !Number.isFinite(slotMs)
    )
      continue;
    if (
      lat < WATCH.south ||
      lat > WATCH.north ||
      lon < WATCH.west ||
      lon > WATCH.east
    ) {
      outside += 1;
      continue;
    }
    // upstream freshness, so it must not depend on anything being alight inside
    // the watch area — a quiet night would otherwise read as a stalled feed
    if (latestSlot === null || slotMs > latestSlotMs) {
      latestSlot = slot;
      latestSlotMs = slotMs;
    }
    if (!isInWatchArea(lat, lon)) {
      filtered += 1;
      continue;
    }
    const rawDatetime = f.properties?.Datetime;
    const pixelMs =
      typeof rawDatetime === "string"
        ? parseStrictIsoTimestamp(
            /(?:Z|[+-]\d{2}:\d{2})$/i.test(rawDatetime)
              ? rawDatetime
              : `${rawDatetime}Z`,
          )
        : Number.NaN;
    const detectedMs = Number.isFinite(pixelMs) ? pixelMs : slotMs;
    const conf = f.properties.Confidence;
    const frp = f.properties.FRP;
    const sza = f.properties.SZA;
    const sensor = layer.sensor(f.properties.Satellite);
    rows.push({
      source: layer.source,
      sensor,
      detected_at: new Date(detectedMs).toISOString(),
      lat,
      lon,
      confidence_raw:
        typeof conf === "number" && Number.isFinite(conf)
          ? Math.max(0, Math.min(1, conf / 100))
          : 0.5,
      frp_mw: typeof frp === "number" && Number.isFinite(frp) ? frp : null,
      daynight:
        typeof sza === "number" && Number.isFinite(sza)
          ? sza < 90
            ? "D"
            : "N"
          : null,
      natural_key: `${layer.source}:${sensor}:${lat.toFixed(5)}:${lon.toFixed(5)}:${slot}`,
    });
  }
  return { rows, outside, filtered, latestSlot };
}

export type FciRun = {
  fetched: number;
  inserted: number;
  outside: number;
  filtered: number;
  latestSlot: string | null;
  ageMinutes: number | null;
  dataFrom?: string;
  dataThrough?: string;
  error?: string;
};

function wfsTime(value: string): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function ingestFci(interval?: SourceReplayInterval): Promise<FciRun> {
  return ingestWfsFire(MTG_FCI, interval);
}

export function ingestS3(interval?: SourceReplayInterval): Promise<FciRun> {
  return ingestWfsFire(S3_SLSTR, interval);
}

async function fetchLayer(
  url: URL,
  layer: string,
  source: string,
): Promise<FciFeatureCollection> {
  url.searchParams.set("typeNames", layer);
  const res = await archivedFetch(source, "wfs_features", url, undefined, {
    requestParams: {
      product: layer,
      filter: url.searchParams.get("cql_filter"),
    },
  });
  if (!res.ok) throw new Error(`${layer} WFS ${res.status}`);
  return (await res.json()) as FciFeatureCollection;
}

async function ingestWfsFire(
  layer: WfsFireLayer,
  interval?: SourceReplayInterval,
): Promise<FciRun> {
  const since = interval
    ? wfsTime(
        new Date(
          Date.parse(interval.dataFrom) - layer.slotMin * 60_000,
        ).toISOString(),
      ).slice(0, -1)
    : new Date(Date.now() - layer.windowMin * 60_000)
        .toISOString()
        .slice(0, 19);
  const timeFilter = interval
    ? `time >= '${since}Z' AND time <= '${wfsTime(interval.dataThrough)}'`
    : `time >= '${since}Z'`;
  const url = new URL(WFS_URL);
  url.search = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    outputFormat: "application/json",
    cql_filter: `${timeFilter} AND BBOX(geom, ${WATCH.south}, ${WATCH.west}, ${WATCH.north}, ${WATCH.east})`,
  }).toString();

  const empty: FciRun = {
    fetched: 0,
    inserted: 0,
    outside: 0,
    filtered: 0,
    latestSlot: null,
    ageMinutes: null,
  };
  let json: FciFeatureCollection;
  try {
    const pages = await Promise.all(
      layer.layers.map((name) =>
        fetchLayer(
          new URL(url),
          name,
          layer.source === "s3" ? "s3_slstr" : "fci",
        ),
      ),
    );
    json = { features: pages.flatMap((page) => page.features ?? []) };
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      ...empty,
      error: error instanceof Error ? error.message : "WFS fetch failed",
    };
  }

  const bounded = interval
    ? {
        ...json,
        features: json.features.filter((feature) => {
          const pixelMs = Date.parse(
            `${feature.properties.Datetime ?? ""}Z`.replace(" ", "T"),
          );
          const detectedMs = Number.isFinite(pixelMs)
            ? pixelMs
            : Date.parse(feature.properties.time ?? "");
          return (
            detectedMs >= Date.parse(interval.dataFrom) &&
            detectedMs <= Date.parse(interval.dataThrough)
          );
        }),
      }
    : json;
  const { rows, outside, filtered, latestSlot } = parseWfsFireFeatures(
    bounded,
    layer,
  );
  if (!rows.length && !filtered && outside > 0)
    return {
      ...empty,
      fetched: json.features?.length ?? 0,
      outside,
      error: `every ${layer.source} feature fell outside the watch box — axis order changed`,
    };

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error, count } = await supabaseAdmin
      .from("detections")
      .upsert(batch, {
        onConflict: "natural_key",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (error)
      return {
        ...empty,
        fetched: rows.length,
        outside,
        error: `detections upsert failed: ${error.message}`,
      };
    inserted += count ?? 0;
  }

  return {
    fetched: rows.length + outside + filtered,
    inserted,
    outside,
    filtered,
    latestSlot,
    ageMinutes: latestSlot
      ? Math.round((Date.now() - Date.parse(latestSlot)) / 60_000)
      : null,
    ...(interval === undefined
      ? {}
      : { dataFrom: interval.dataFrom, dataThrough: interval.dataThrough }),
  };
}
