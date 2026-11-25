import { haversineKm } from "@/lib/nadhir";

export const EMSC_MIN_MAGNITUDE = 2;

export type EmscEvent = {
  id: string;
  occurred_at: string;
  lat: number;
  lon: number;
  depth_km: number | null;
  magnitude: number;
  magnitude_type: string | null;
  region: string | null;
  network: string | null;
  updated_at: string;
};

// known and suspected earthquakes; blasts and unknown events are not earthquakes
const EARTHQUAKE_TYPES = new Set(["ke", "se"]);

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export type ParseEmscOptions = {
  minMagnitude?: number;
};

export function parseEmsc(
  body: unknown,
  options: ParseEmscOptions = {},
): EmscEvent[] {
  // FDSN answers 204 with no body when nothing matched
  if (body === null || body === undefined) return [];
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features))
    throw new Error("EMSC returned an unexpected shape");
  const minMag = options.minMagnitude;
  return features.flatMap((feature) => {
    const p = (feature as { properties?: Record<string, unknown> }).properties;
    if (
      !p ||
      typeof p["unid"] !== "string" ||
      typeof p["time"] !== "string" ||
      !finite(p["lat"]) ||
      !finite(p["lon"]) ||
      !finite(p["mag"]) ||
      !EARTHQUAKE_TYPES.has(String(p["evtype"] ?? "ke"))
    )
      return [];
    if (minMag !== undefined && p["mag"] < minMag) return [];
    const magnitude = Math.round(p["mag"] * 10) / 10;
    return [
      {
        id: p["unid"],
        occurred_at: p["time"],
        lat: p["lat"],
        lon: p["lon"],
        depth_km: finite(p["depth"]) ? p["depth"] : null,
        magnitude,
        magnitude_type: typeof p["magtype"] === "string" ? p["magtype"] : null,
        region:
          typeof p["flynn_region"] === "string" ? p["flynn_region"] : null,
        network: typeof p["auth"] === "string" ? p["auth"] : null,
        updated_at:
          typeof p["lastupdate"] === "string" ? p["lastupdate"] : p["time"],
      },
    ];
  });
}

// Pre-filter freshness watermark across all fetched EMSC events BEFORE Algeria location filtering
export function extractEmscWatermark(
  events: readonly EmscEvent[],
): string | null {
  let latestMs = Number.NEGATIVE_INFINITY;
  let latestIso: string | null = null;
  for (const event of events) {
    for (const candidate of [event.updated_at, event.occurred_at]) {
      const ms = Date.parse(candidate);
      if (Number.isFinite(ms) && ms > latestMs) {
        latestMs = ms;
        latestIso = new Date(ms).toISOString();
      }
    }
  }
  return latestIso;
}

const NEAR_ALGERIA_KM = 100;

export function locateEvents(
  events: EmscEvent[],
  communes: readonly { id: string; lat: number; lon: number }[],
  maxKm = NEAR_ALGERIA_KM,
  options: { minMagnitude?: number } = {},
): (EmscEvent & { commune_id: string; offshore: boolean })[] {
  const minMag = options.minMagnitude;
  return events.flatMap((event) => {
    if (minMag !== undefined && event.magnitude < minMag) return [];
    let nearest: { id: string; km: number } | null = null;
    for (const c of communes) {
      const km = haversineKm(event.lat, event.lon, c.lat, c.lon);
      if (!nearest || km < nearest.km) nearest = { id: c.id, km };
    }
    if (!nearest || nearest.km > maxKm) return [];
    return [
      {
        ...event,
        commune_id: nearest.id,
        offshore: /\bSEA\b|COAST/.test(event.region ?? ""),
      },
    ];
  });
}
