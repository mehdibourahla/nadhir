import { parseIsoTimestamp } from "./imerg";
import { assertNotScientificUpstreamErrorBody } from "./mtg-fci-push";

export const GWIS_SOURCE_KEY = "gwis_burned_areas" as const;
export const GWIS_ATTRIBUTION =
  "Copernicus EMS GWIS / JRC (FIRMS-derived burned area estimate, CC BY 4.0)" as const;
export const GWIS_LICENCE = "CC BY 4.0" as const;

export const ALGERIA_GWIS_BBOX = {
  south: 18.0,
  north: 38.5,
  west: -9.5,
  east: 13.0,
} as const;

export type GwisProductLayer = "nrt.ba" | "globfire" | "mcd64a1";

const VALID_LAYERS = new Set<GwisProductLayer>([
  "nrt.ba",
  "globfire",
  "mcd64a1",
]);

const PROHIBITED_GWIS_KEYS = [
  "fuel_recovery_curve",
  "recovery_factor",
  "logistic_calibration",
  "calibrated_probability",
  "burn_circle_m",
  "burn_radius_m",
  "spread_bearing_deg",
  "rotated_bearing",
] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type GwisPolygonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type GwisBurnedArea = {
  sourceKey: typeof GWIS_SOURCE_KEY;
  eventId: string;
  productLayer: GwisProductLayer;
  estimationBasis: "firms_derived_estimate";
  isOfficialConfirmation: false;
  isOpticalScar: false;
  licence: "CC BY 4.0";
  burnStartAt: string;
  burnEndAt: string;
  publishedAt: string;
  areaHa: number;
  lat: number;
  lon: number;
  perimeterGeojson: GwisPolygonGeometry;
  attribution: string;
};

export type GwisParseResult = {
  sourceKey: typeof GWIS_SOURCE_KEY;
  upstreamPublishedAt: string;
  featuresSeen: number;
  featuresInAlgeria: number;
  featuresOutsideAlgeria: number;
  emptyWindow: boolean;
  burnedAreas: GwisBurnedArea[];
};

function isInAlgeriaGwisBbox(lat: number, lon: number): boolean {
  return (
    lat >= ALGERIA_GWIS_BBOX.south &&
    lat <= ALGERIA_GWIS_BBOX.north &&
    lon >= ALGERIA_GWIS_BBOX.west &&
    lon <= ALGERIA_GWIS_BBOX.east
  );
}

function assertCcBy4Licence(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw !== "string") {
    throw new Error("GWIS licence incompatible: expected CC BY 4.0");
  }
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (normalized !== "CC BY 4.0" && normalized !== "CC-BY-4.0") {
    throw new Error("GWIS licence incompatible: expected CC BY 4.0");
  }
}

function assertNoProhibitedFields(record: Record<string, unknown>): void {
  for (const key of PROHIBITED_GWIS_KEYS) {
    if (key in record && record[key] !== undefined && record[key] !== null) {
      throw new Error(
        `GWIS schema invalid: prohibited PR #31 field "${key}" rejected`,
      );
    }
  }
}

function parseIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`GWIS schema invalid: missing ${field} date`);
  }
  const trimmed = value.trim().slice(0, 10);
  if (!ISO_DATE_RE.test(trimmed)) {
    throw new Error(
      `GWIS schema invalid: invalid ${field} date "${value.trim()}"`,
    );
  }
  const ms = Date.parse(`${trimmed}T00:00:00Z`);
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, 10) !== trimmed
  ) {
    throw new Error(
      `GWIS schema invalid: invalid ${field} calendar date "${trimmed}"`,
    );
  }
  return trimmed;
}

function validateRing(ring: unknown): number[][] {
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new Error(
      "GWIS schema invalid: polygon ring must contain at least 4 positions",
    );
  }
  const out: number[][] = [];
  for (const pos of ring) {
    if (!Array.isArray(pos) || pos.length < 2) {
      throw new Error("GWIS schema invalid: invalid polygon coordinate tuple");
    }
    const lon = pos[0];
    const lat = pos[1];
    if (
      typeof lon !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lon) ||
      !Number.isFinite(lat)
    ) {
      throw new Error(
        "GWIS schema invalid: non-finite polygon ring coordinates",
      );
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error(
        "GWIS schema invalid: polygon ring coordinates out of WGS84 bounds (axis order invalid)",
      );
    }
    out.push([lon, lat]);
  }
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new Error("GWIS schema invalid: polygon ring is not closed");
  }
  return out;
}

function validateAndComputeCentroid(geom: unknown): {
  geometry: GwisPolygonGeometry;
  lat: number;
  lon: number;
} {
  if (!geom || typeof geom !== "object" || Array.isArray(geom)) {
    throw new Error("GWIS schema invalid: missing feature geometry");
  }
  const g = geom as Record<string, unknown>;
  const type = g["type"];
  if (type !== "Polygon" && type !== "MultiPolygon") {
    throw new Error(
      `GWIS schema invalid: geometry type "${String(type)}" rejected; only Polygon or MultiPolygon perimeters are allowed`,
    );
  }

  let latSum = 0;
  let lonSum = 0;
  let count = 0;

  if (type === "Polygon") {
    if (!Array.isArray(g["coordinates"]) || g["coordinates"].length === 0) {
      throw new Error("GWIS schema invalid: empty Polygon coordinates");
    }
    const rings = (g["coordinates"] as unknown[]).map((r) => validateRing(r));
    const exterior = rings[0]!;
    for (let i = 0; i < exterior.length - 1; i++) {
      lonSum += exterior[i]![0]!;
      latSum += exterior[i]![1]!;
      count += 1;
    }
    return {
      geometry: { type: "Polygon", coordinates: rings },
      lat: Math.round((latSum / count) * 100_000) / 100_000,
      lon: Math.round((lonSum / count) * 100_000) / 100_000,
    };
  }

  if (!Array.isArray(g["coordinates"]) || g["coordinates"].length === 0) {
    throw new Error("GWIS schema invalid: empty MultiPolygon coordinates");
  }
  const polygons = (g["coordinates"] as unknown[]).map((poly) => {
    if (!Array.isArray(poly) || poly.length === 0) {
      throw new Error("GWIS schema invalid: empty MultiPolygon member");
    }
    const rings = (poly as unknown[]).map((r) => validateRing(r));
    const exterior = rings[0]!;
    for (let i = 0; i < exterior.length - 1; i++) {
      lonSum += exterior[i]![0]!;
      latSum += exterior[i]![1]!;
      count += 1;
    }
    return rings;
  });

  return {
    geometry: { type: "MultiPolygon", coordinates: polygons },
    lat: Math.round((latSum / count) * 100_000) / 100_000,
    lon: Math.round((lonSum / count) * 100_000) / 100_000,
  };
}

function normalizeEffisRestToFeatureCollection(
  obj: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!Array.isArray(obj["results"]) || typeof obj["count"] !== "number") {
    return null;
  }
  const results = obj["results"] as unknown[];
  let latestUpdate: string | null = null;
  const features: Record<string, unknown>[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const startRaw =
      typeof rec["firedate"] === "string" ? rec["firedate"] : null;
    const endRaw =
      typeof rec["lastfiredate"] === "string"
        ? rec["lastfiredate"]
        : typeof rec["lastupdate"] === "string"
          ? rec["lastupdate"]
          : startRaw;
    const pubRaw =
      typeof rec["lastupdate"] === "string" ? rec["lastupdate"] : endRaw;
    if (
      pubRaw &&
      (!latestUpdate || Date.parse(pubRaw) > Date.parse(latestUpdate))
    ) {
      latestUpdate = pubRaw;
    }
    const shape = rec["shape"];
    if (!shape || typeof shape !== "object" || Array.isArray(shape)) continue;
    const areaVal = Number(rec["area_ha"]);
    if (!Number.isFinite(areaVal) || areaVal <= 0) continue;
    const startDate = startRaw ? startRaw.slice(0, 10) : null;
    const endDate = endRaw ? endRaw.slice(0, 10) : startDate;
    const clampedEnd =
      startDate && endDate && endDate < startDate ? startDate : endDate;
    features.push({
      type: "Feature",
      id: rec["id"],
      geometry: shape,
      properties: {
        id: rec["id"],
        product_layer: "nrt.ba",
        initialdate: startDate,
        finaldate: clampedEnd,
        area_ha: areaVal,
        published_at: pubRaw
          ? new Date(Date.parse(pubRaw)).toISOString()
          : undefined,
        licence: GWIS_LICENCE,
      },
    });
  }
  return {
    type: "FeatureCollection",
    licence: GWIS_LICENCE,
    product_layer: "nrt.ba",
    published_at: latestUpdate
      ? new Date(Date.parse(latestUpdate)).toISOString()
      : new Date().toISOString(),
    features,
  };
}

export function parseGwisGeoJson(payload: unknown): GwisParseResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("GWIS schema invalid: expected GeoJSON FeatureCollection");
  }
  const rawObj = payload as Record<string, unknown>;
  const obj = normalizeEffisRestToFeatureCollection(rawObj) ?? rawObj;
  assertCcBy4Licence(obj["licence"] ?? obj["license"]);
  assertNoProhibitedFields(obj);

  if (obj["type"] !== "FeatureCollection" || !Array.isArray(obj["features"])) {
    throw new Error(
      "GWIS schema invalid: expected FeatureCollection with features array",
    );
  }

  if (obj["is_official_confirmation"] === true) {
    throw new Error(
      "GWIS schema invalid: burned area estimate is not official confirmation",
    );
  }
  if (obj["is_optical_scar"] === true) {
    throw new Error(
      "GWIS schema invalid: GWIS NRT perimeter is not an optical burn scar",
    );
  }
  if (
    typeof obj["estimation_basis"] === "string" &&
    obj["estimation_basis"] !== "firms_derived_estimate"
  ) {
    throw new Error(
      `GWIS schema invalid: estimation_basis must be firms_derived_estimate, got "${obj["estimation_basis"]}"`,
    );
  }

  // Capture pre-filter freshness watermark BEFORE Algeria bbox filtering
  let upstreamPublishedAt = parseIsoTimestamp(
    obj["published_at"] ?? obj["timeStamp"] ?? obj["publishedAt"],
    "published_at",
    "GWIS",
  );

  const defaultLayer = obj["product_layer"] ?? "nrt.ba";
  const byKey = new Map<string, GwisBurnedArea>();
  let featuresSeen = 0;
  let featuresInAlgeria = 0;
  let featuresOutsideAlgeria = 0;
  let swappedCandidates = 0;

  for (const rawFeature of obj["features"] as unknown[]) {
    if (
      !rawFeature ||
      typeof rawFeature !== "object" ||
      Array.isArray(rawFeature)
    ) {
      throw new Error("GWIS schema invalid: feature entry must be an object");
    }
    const feature = rawFeature as Record<string, unknown>;
    if (feature["type"] !== "Feature") {
      throw new Error("GWIS schema invalid: entry must have type Feature");
    }
    const props =
      feature["properties"] &&
      typeof feature["properties"] === "object" &&
      !Array.isArray(feature["properties"])
        ? (feature["properties"] as Record<string, unknown>)
        : {};

    assertCcBy4Licence(props["licence"] ?? props["license"]);
    assertNoProhibitedFields(props);

    if (props["is_official_confirmation"] === true) {
      throw new Error(
        "GWIS schema invalid: GWIS burned area estimate cannot claim official confirmation",
      );
    }
    if (props["is_optical_scar"] === true) {
      throw new Error(
        "GWIS schema invalid: GWIS burned area estimate cannot claim optical burn scar",
      );
    }
    if (
      typeof props["estimation_basis"] === "string" &&
      props["estimation_basis"] !== "firms_derived_estimate"
    ) {
      throw new Error(
        `GWIS schema invalid: estimation_basis must be firms_derived_estimate, got "${props["estimation_basis"]}"`,
      );
    }

    const { geometry, lat, lon } = validateAndComputeCentroid(
      feature["geometry"],
    );

    const eventIdRaw = props["event_id"] ?? props["id"] ?? feature["id"];
    if (
      (typeof eventIdRaw !== "string" && typeof eventIdRaw !== "number") ||
      !String(eventIdRaw).trim()
    ) {
      throw new Error("GWIS schema invalid: missing event_id");
    }
    const eventId = String(eventIdRaw).trim();

    const layerRaw = props["product_layer"] ?? defaultLayer;
    if (
      typeof layerRaw !== "string" ||
      !VALID_LAYERS.has(layerRaw as GwisProductLayer)
    ) {
      throw new Error(
        `GWIS schema invalid: unsupported product_layer "${String(layerRaw)}"`,
      );
    }
    const productLayer = layerRaw as GwisProductLayer;

    const burnStartAt = parseIsoDate(
      props["burn_start_at"] ?? props["initialdate"],
      "burn_start_at",
    );
    const burnEndAt = parseIsoDate(
      props["burn_end_at"] ?? props["finaldate"],
      "burn_end_at",
    );
    if (burnEndAt < burnStartAt) {
      throw new Error(
        `GWIS schema invalid: burn_end_at (${burnEndAt}) precedes burn_start_at (${burnStartAt})`,
      );
    }

    const publishedAt = parseIsoTimestamp(
      props["published_at"] ?? upstreamPublishedAt,
      "published_at",
      "GWIS",
    );
    if (Date.parse(publishedAt) > Date.parse(upstreamPublishedAt)) {
      upstreamPublishedAt = publishedAt;
    }

    const areaRaw = props["area_ha"] ?? props["area_hectares"];
    if (typeof areaRaw !== "number" || !Number.isFinite(areaRaw)) {
      throw new Error("GWIS schema invalid: area_ha must be a finite number");
    }
    if (areaRaw <= 0 || areaRaw > 1_000_000) {
      throw new Error(
        `GWIS schema invalid: area_ha out of valid bounds (${areaRaw})`,
      );
    }

    featuresSeen += 1;
    if (!isInAlgeriaGwisBbox(lat, lon)) {
      featuresOutsideAlgeria += 1;
      if (isInAlgeriaGwisBbox(lon, lat)) {
        swappedCandidates += 1;
      }
      continue;
    }
    featuresInAlgeria += 1;

    const dedupeKey = `${eventId}:${burnEndAt}`;
    byKey.set(dedupeKey, {
      sourceKey: GWIS_SOURCE_KEY,
      eventId,
      productLayer,
      estimationBasis: "firms_derived_estimate",
      isOfficialConfirmation: false,
      isOpticalScar: false,
      licence: GWIS_LICENCE,
      burnStartAt,
      burnEndAt,
      publishedAt,
      areaHa: Math.round(areaRaw * 100) / 100,
      lat,
      lon,
      perimeterGeojson: geometry,
      attribution: GWIS_ATTRIBUTION,
    });
  }

  if (
    featuresSeen > 0 &&
    featuresInAlgeria === 0 &&
    swappedCandidates === featuresSeen
  ) {
    throw new Error(
      "GWIS schema invalid: polygon coordinates appear swapped (axis order invalid)",
    );
  }

  const burnedAreas = [...byKey.values()];
  return {
    sourceKey: GWIS_SOURCE_KEY,
    upstreamPublishedAt,
    featuresSeen,
    featuresInAlgeria,
    featuresOutsideAlgeria,
    emptyWindow: burnedAreas.length === 0,
    burnedAreas,
  };
}

export function parseGwisPayload(
  payload: string | ArrayBuffer | Uint8Array | Record<string, unknown>,
  options: { contentType?: string | null } = {},
): GwisParseResult {
  if (typeof payload === "string") {
    assertNotScientificUpstreamErrorBody(
      payload,
      options.contentType,
      "GWIS",
      "GWIS burned areas GeoJSON",
    );
    let decoded: unknown;
    try {
      decoded = JSON.parse(payload);
    } catch {
      throw new Error("GWIS schema invalid: failed to parse GeoJSON payload");
    }
    return parseGwisGeoJson(decoded);
  }

  if (payload instanceof ArrayBuffer || payload instanceof Uint8Array) {
    assertNotScientificUpstreamErrorBody(
      payload,
      options.contentType,
      "GWIS",
      "GWIS burned areas GeoJSON",
    );
    const bytes =
      payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error(
        "GWIS schema invalid: binary payload is not valid GeoJSON",
      );
    }
    return parseGwisGeoJson(decoded);
  }

  return parseGwisGeoJson(payload);
}
