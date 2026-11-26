import { fromArrayBuffer } from "geotiff";

import { haversineKm } from "@/lib/nadhir";

import {
  isTiffMagicBytes,
  parseIsoTimestamp,
  round2,
  validateBbox,
  validateCoordinates,
} from "./imerg";
import { assertNotScientificUpstreamErrorBody } from "./mtg-fci-push";

export const CLMS_SOURCE_KEY = "clms_ndvi_swi" as const;
export const CLMS_ATTRIBUTION =
  "Copernicus Land Monitoring Service (Global NDVI v3 / SWI v4)" as const;

export const ALGERIA_CLMS_BBOX = {
  south: 18.0,
  north: 38.5,
  west: -9.5,
  east: 13.0,
} as const;

export type ClmsProductVersion = "ndvi_v3_300m" | "swi_v4_1km";

export type ClmsCommuneRef = {
  id: string;
  code: string;
  lat: number;
  lon: number;
};

export type ClmsLandIndexRecord = {
  sourceKey: typeof CLMS_SOURCE_KEY;
  productVersion: ClmsProductVersion;
  isCalibratedFuel: false;
  observedAt: string;
  publishedAt: string;
  communeId: string | null;
  communeCode: string;
  wilayaCode: string;
  lat: number;
  lon: number;
  ndviValue: number | null;
  swiValue: number | null;
  qualityState: "valid" | "degraded" | "flagged";
  qaPixelFraction: number | null;
  attribution: string;
};

export type ClmsParseResult = {
  sourceKey: typeof CLMS_SOURCE_KEY;
  productVersion: ClmsProductVersion;
  observedAt: string;
  upstreamPublishedAt: string;
  entriesSeen: number;
  entriesOutsideAlgeria: number;
  entriesSkippedQa: number;
  emptyWindow: boolean;
  records: ClmsLandIndexRecord[];
};

export type ClmsGeoTiffMetadata = {
  productVersion: ClmsProductVersion;
  observedAt: string;
  publishedAt?: string;
  encoding?: "uint8_dn" | "float";
  communes?: readonly ClmsCommuneRef[];
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COMMUNE_DISTANCE_KM = 80;
const PROHIBITED_CLMS_KEYS = [
  "fuel_recovery_curve",
  "recovery_factor",
  "logistic_calibration",
  "calibrated_fuel_load",
] as const;

function isInAlgeriaClmsBbox(lat: number, lon: number): boolean {
  return (
    lat >= ALGERIA_CLMS_BBOX.south &&
    lat <= ALGERIA_CLMS_BBOX.north &&
    lon >= ALGERIA_CLMS_BBOX.west &&
    lon <= ALGERIA_CLMS_BBOX.east
  );
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function parseIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`CLMS schema invalid: missing ${field} date`);
  }
  const trimmed = value.trim().slice(0, 10);
  if (!ISO_DATE_RE.test(trimmed)) {
    throw new Error(
      `CLMS schema invalid: invalid ${field} date "${value.trim()}"`,
    );
  }
  const ms = Date.parse(`${trimmed}T00:00:00Z`);
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, 10) !== trimmed
  ) {
    throw new Error(`CLMS schema invalid: invalid ${field} date "${trimmed}"`);
  }
  return trimmed;
}

function parseProductVersion(value: unknown): ClmsProductVersion {
  if (value === "ndvi_v3_300m" || value === "swi_v4_1km") {
    return value;
  }
  throw new Error(
    `CLMS schema invalid: unsupported product_version "${String(value)}"`,
  );
}

function validateNdvi(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("CLMS schema invalid: ndvi_value must be a finite number");
  }
  if (value < -1.0 || value > 1.0) {
    throw new Error(
      `CLMS schema invalid: ndvi_value out of physical range [-1, 1] (${value})`,
    );
  }
  return round4(value);
}

function validateSwi(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("CLMS schema invalid: swi_value must be a finite number");
  }
  if (value < 0.0 || value > 100.0) {
    throw new Error(
      `CLMS schema invalid: swi_value out of physical range [0, 100] (${value})`,
    );
  }
  return round2(value);
}

function validateQaFraction(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      "CLMS schema invalid: qa_pixel_fraction must be a finite number",
    );
  }
  if (value < 0.0 || value > 1.0) {
    throw new Error(
      `CLMS schema invalid: qa_pixel_fraction out of range [0, 1] (${value})`,
    );
  }
  return round4(value);
}

function assertNoProhibitedClmsFields(record: Record<string, unknown>): void {
  if (record["is_calibrated_fuel"] === true) {
    throw new Error(
      "CLMS schema invalid: NDVI/SWI indices cannot be marked as calibrated fuel",
    );
  }
  for (const key of PROHIBITED_CLMS_KEYS) {
    if (key in record && record[key] !== undefined && record[key] !== null) {
      throw new Error(
        `CLMS schema invalid: prohibited PR #31 field "${key}" rejected`,
      );
    }
  }
}

function nearestCommune(
  lat: number,
  lon: number,
  communes: readonly ClmsCommuneRef[],
): ClmsCommuneRef | null {
  let best: { ref: ClmsCommuneRef; km: number } | null = null;
  for (const c of communes) {
    const km = haversineKm(lat, lon, c.lat, c.lon);
    if (!best || km < best.km) best = { ref: c, km };
  }
  if (!best || best.km > MAX_COMMUNE_DISTANCE_KM) return null;
  return best.ref;
}

export async function parseClmsGeoTiff(
  buffer: ArrayBuffer,
  metadata: ClmsGeoTiffMetadata,
  contentType?: string | null,
): Promise<ClmsParseResult> {
  assertNotScientificUpstreamErrorBody(
    buffer,
    contentType,
    "CLMS",
    "CLMS NDVI/SWI GeoTIFF raster",
  );
  const bytes = new Uint8Array(buffer);
  if (!isTiffMagicBytes(bytes)) {
    throw new Error(
      "CLMS schema invalid: payload is not a valid GeoTIFF binary",
    );
  }

  const productVersion = parseProductVersion(metadata.productVersion);
  const observedAt = parseIsoDate(metadata.observedAt, "observed_at");
  // Capture pre-filter freshness watermark BEFORE spatial/QA filtering
  const upstreamPublishedAt = parseIsoTimestamp(
    metadata.publishedAt ?? `${observedAt}T06:00:00Z`,
    "published_at",
    "CLMS",
  );

  let tiff;
  try {
    tiff = await fromArrayBuffer(buffer);
  } catch (cause) {
    throw new Error(
      `CLMS schema invalid: GeoTIFF decode failed (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }

  let image;
  try {
    image = await tiff.getImage();
  } catch (cause) {
    throw new Error(
      `CLMS schema invalid: GeoTIFF decode failed (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }
  const width = image.getWidth();
  const height = image.getHeight();
  if (width <= 0 || height <= 0) {
    throw new Error("CLMS schema invalid: empty GeoTIFF dimensions");
  }

  let rawBbox: number[];
  try {
    rawBbox = image.getBoundingBox();
  } catch (cause) {
    throw new Error(
      `CLMS schema invalid: missing GeoTIFF georeferencing (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }
  const [west, south, east, north] = validateBbox(rawBbox, "CLMS");
  const gdalNoData = image.getGDALNoData();

  let rasters;
  try {
    rasters = await image.readRasters({ interleave: false });
  } catch (cause) {
    throw new Error(
      `CLMS schema invalid: GeoTIFF decode failed (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }
  const band = rasters[0];
  if (!band || typeof band === "number" || band.length !== width * height) {
    throw new Error("CLMS schema invalid: GeoTIFF raster band length mismatch");
  }

  const encoding =
    metadata.encoding ?? (band instanceof Uint8Array ? "uint8_dn" : "float");
  const communes = metadata.communes ?? [];
  const lonStep = (east - west) / width;
  const latStep = (north - south) / height;

  type Accum = {
    communeId: string | null;
    communeCode: string;
    wilayaCode: string;
    lat: number;
    lon: number;
    sum: number;
    validCount: number;
    totalCount: number;
  };
  const buckets = new Map<string, Accum>();

  let entriesSeen = 0;
  let entriesOutsideAlgeria = 0;
  let entriesSkippedQa = 0;

  for (let row = 0; row < height; row++) {
    const lat = north - (row + 0.5) * latStep;
    for (let col = 0; col < width; col++) {
      const lon = west + (col + 0.5) * lonStep;
      entriesSeen += 1;

      if (!isInAlgeriaClmsBbox(lat, lon)) {
        entriesOutsideAlgeria += 1;
        continue;
      }

      const matched = nearestCommune(lat, lon, communes);
      const communeCode = matched
        ? matched.code
        : `grid:${lat.toFixed(2)}:${lon.toFixed(2)}`;
      const wilayaCode = matched ? matched.code.slice(0, 2) : "00";
      const bucket = buckets.get(communeCode) ?? {
        communeId: matched?.id ?? null,
        communeCode,
        wilayaCode,
        lat: matched ? matched.lat : round2(lat),
        lon: matched ? matched.lon : round2(lon),
        sum: 0,
        validCount: 0,
        totalCount: 0,
      };
      bucket.totalCount += 1;
      buckets.set(communeCode, bucket);

      const raw = Number(band[row * width + col]);
      // GeoTIFF Float32 NaN and GDAL nodata are valid missing-pixel sentinels
      if (
        Number.isNaN(raw) ||
        raw === -9999 ||
        (gdalNoData !== null && raw === gdalNoData)
      ) {
        entriesSkippedQa += 1;
        continue;
      }

      let scaled: number;
      if (productVersion === "ndvi_v3_300m") {
        if (encoding === "uint8_dn") {
          if (raw >= 251) {
            entriesSkippedQa += 1;
            continue;
          }
          scaled = raw * 0.004 - 0.08;
        } else {
          scaled = raw;
        }
        const checked = validateNdvi(scaled);
        if (checked === null) continue;
        bucket.sum += checked;
        bucket.validCount += 1;
      } else {
        if (encoding === "uint8_dn") {
          if (raw >= 241) {
            entriesSkippedQa += 1;
            continue;
          }
          scaled = raw * 0.5;
        } else {
          scaled = raw;
        }
        const checked = validateSwi(scaled);
        if (checked === null) continue;
        bucket.sum += checked;
        bucket.validCount += 1;
      }
    }
  }

  const records: ClmsLandIndexRecord[] = [];
  for (const b of buckets.values()) {
    if (b.validCount === 0) continue;
    const mean = b.sum / b.validCount;
    const qaFraction = round4(b.validCount / b.totalCount);
    records.push({
      sourceKey: CLMS_SOURCE_KEY,
      productVersion,
      isCalibratedFuel: false,
      observedAt,
      publishedAt: upstreamPublishedAt,
      communeId: b.communeId,
      communeCode: b.communeCode,
      wilayaCode: b.wilayaCode,
      lat: b.lat,
      lon: b.lon,
      ndviValue: productVersion === "ndvi_v3_300m" ? round4(mean) : null,
      swiValue: productVersion === "swi_v4_1km" ? round2(mean) : null,
      qualityState: qaFraction < 0.5 ? "degraded" : "valid",
      qaPixelFraction: qaFraction,
      attribution: CLMS_ATTRIBUTION,
    });
  }

  return {
    sourceKey: CLMS_SOURCE_KEY,
    productVersion,
    observedAt,
    upstreamPublishedAt,
    entriesSeen,
    entriesOutsideAlgeria,
    entriesSkippedQa,
    emptyWindow: records.length === 0,
    records,
  };
}

export function parseClmsJson(payload: unknown): ClmsParseResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("CLMS schema invalid: expected JSON object payload");
  }
  const obj = payload as Record<string, unknown>;
  assertNoProhibitedClmsFields(obj);

  const productVersion = parseProductVersion(
    obj["product_version"] ?? obj["productVersion"],
  );
  const observedAt = parseIsoDate(
    obj["observed_at"] ?? obj["valid_date"],
    "observed_at",
  );
  // Capture pre-filter freshness watermark BEFORE spatial/QA filtering
  let upstreamPublishedAt = parseIsoTimestamp(
    obj["published_at"] ?? obj["publishedAt"] ?? `${observedAt}T06:00:00Z`,
    "published_at",
    "CLMS",
  );

  const rawEntries = Array.isArray(obj["communes"])
    ? obj["communes"]
    : Array.isArray(obj["observations"])
      ? obj["observations"]
      : null;
  if (!rawEntries) {
    throw new Error(
      "CLMS schema invalid: missing communes or observations array",
    );
  }

  const byKey = new Map<string, ClmsLandIndexRecord>();
  let entriesSeen = 0;
  let entriesOutsideAlgeria = 0;
  let entriesSkippedQa = 0;

  for (const raw of rawEntries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("CLMS schema invalid: entry must be an object");
    }
    const item = raw as Record<string, unknown>;
    assertNoProhibitedClmsFields(item);

    const itemProduct = item["product_version"]
      ? parseProductVersion(item["product_version"])
      : productVersion;
    const itemObservedAt = item["observed_at"]
      ? parseIsoDate(item["observed_at"], "observed_at")
      : observedAt;
    const itemPublishedAt = parseIsoTimestamp(
      item["published_at"] ?? upstreamPublishedAt,
      "published_at",
      "CLMS",
    );
    if (Date.parse(itemPublishedAt) > Date.parse(upstreamPublishedAt)) {
      upstreamPublishedAt = itemPublishedAt;
    }

    const { lat, lon } = validateCoordinates(item["lat"], item["lon"], "CLMS");
    const communeCodeRaw = item["commune_code"];
    if (typeof communeCodeRaw !== "string" || !communeCodeRaw.trim()) {
      throw new Error("CLMS schema invalid: missing commune_code");
    }
    const communeCode = communeCodeRaw.trim();
    const wilayaCodeRaw = item["wilaya_code"] ?? communeCode.slice(0, 2);
    if (typeof wilayaCodeRaw !== "string" || !wilayaCodeRaw.trim()) {
      throw new Error("CLMS schema invalid: missing wilaya_code");
    }
    const wilayaCode = wilayaCodeRaw.trim();

    if (item["qa_masked"] === true) {
      entriesSeen += 1;
      entriesSkippedQa += 1;
      continue;
    }

    const ndviValue = validateNdvi(item["ndvi_value"]);
    const swiValue = validateSwi(item["swi_value"]);
    if (ndviValue === null && swiValue === null) {
      throw new Error(
        "CLMS schema invalid: entry missing both ndvi_value and swi_value",
      );
    }

    const qaPixelFraction = validateQaFraction(item["qa_pixel_fraction"]);
    const qualityState: "valid" | "degraded" | "flagged" =
      item["quality_state"] === "degraded" ||
      item["quality_state"] === "flagged"
        ? item["quality_state"]
        : "valid";

    entriesSeen += 1;
    if (!isInAlgeriaClmsBbox(lat, lon)) {
      entriesOutsideAlgeria += 1;
      continue;
    }

    const dedupeKey = `${itemProduct}:${itemObservedAt}:${communeCode}`;
    byKey.set(dedupeKey, {
      sourceKey: CLMS_SOURCE_KEY,
      productVersion: itemProduct,
      isCalibratedFuel: false,
      observedAt: itemObservedAt,
      publishedAt: itemPublishedAt,
      communeId: null,
      communeCode,
      wilayaCode,
      lat,
      lon,
      ndviValue,
      swiValue,
      qualityState,
      qaPixelFraction,
      attribution: CLMS_ATTRIBUTION,
    });
  }

  const records = [...byKey.values()];
  return {
    sourceKey: CLMS_SOURCE_KEY,
    productVersion,
    observedAt,
    upstreamPublishedAt,
    entriesSeen,
    entriesOutsideAlgeria,
    entriesSkippedQa,
    emptyWindow: records.length === 0,
    records,
  };
}

export async function parseClmsPayload(
  payload: string | ArrayBuffer | Uint8Array | Record<string, unknown>,
  options: {
    contentType?: string | null;
    geotiffMetadata?: ClmsGeoTiffMetadata;
  } = {},
): Promise<ClmsParseResult> {
  if (typeof payload === "string") {
    assertNotScientificUpstreamErrorBody(
      payload,
      options.contentType,
      "CLMS",
      "CLMS NDVI/SWI payload",
    );
    let decoded: unknown;
    try {
      decoded = JSON.parse(payload);
    } catch {
      throw new Error("CLMS schema invalid: failed to parse JSON payload");
    }
    return parseClmsJson(decoded);
  }

  if (payload instanceof ArrayBuffer || payload instanceof Uint8Array) {
    assertNotScientificUpstreamErrorBody(
      payload,
      options.contentType,
      "CLMS",
      "CLMS NDVI/SWI payload",
    );
    const bytes =
      payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (isTiffMagicBytes(bytes)) {
      if (!options.geotiffMetadata) {
        throw new Error(
          "CLMS schema invalid: GeoTIFF payload requires productVersion and observedAt metadata",
        );
      }
      const ab =
        payload instanceof ArrayBuffer
          ? payload
          : new Uint8Array(payload).slice().buffer;
      return parseClmsGeoTiff(ab, options.geotiffMetadata, options.contentType);
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error(
        "CLMS schema invalid: binary payload is neither GeoTIFF nor JSON",
      );
    }
    return parseClmsJson(decoded);
  }

  return parseClmsJson(payload);
}
