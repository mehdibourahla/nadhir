import { fromArrayBuffer } from "geotiff";

export const IMERG_SOURCE_KEY = "imerg_rainfall" as const;
export const IMERG_ATTRIBUTION =
  "NASA GPM IMERG Early (satellite observed rainfall)" as const;
export const IMERG_SCALE_FACTOR = 0.1;
export const RAINFALL_WINDOW_MINUTES = 30 as const;
export const RAINFALL_MAX_RATE_MM_H = 500;
export const RAINFALL_MAX_ACCUM_30M = 250;
export const RAINFALL_MIN_STORE_RATE_MM_H = 0.1;

// Full Algeria bounding box (including Saharan and steppe wilayas, never northern-only fire watch box)
export const ALGERIA_RAINFALL_BBOX = {
  south: 18.9,
  north: 37.6,
  west: -8.7,
  east: 12.0,
} as const;

export type RainfallSourceKey = "imerg_rainfall" | "hsaf_rainfall";

export type RainfallObservation = {
  sourceKey: RainfallSourceKey;
  observationKind: "satellite_observed";
  isModel: false;
  validTime: string;
  publishedTime: string;
  windowMinutes: 30;
  gridCellKey: string;
  lat: number;
  lon: number;
  rateMmH: number;
  accumMm30m: number;
  snapshotId: string | null;
  qualityState: "valid" | "degraded" | "flagged";
  attribution: string;
};

export type RainfallParseResult = {
  sourceKey: RainfallSourceKey;
  validTime: string;
  upstreamPublishedAt: string;
  snapshotId: string | null;
  cellsSeen: number;
  cellsInAlgeria: number;
  cellsOutsideAlgeria: number;
  cellsDry: number;
  cellsNodata: number;
  drySlot: boolean;
  observations: RainfallObservation[];
};

export type RainfallGeoTiffMetadata = {
  validTime: string;
  publishedTime?: string;
  snapshotId?: string | null;
  scaleFactor?: number;
  nodataValues?: readonly number[];
  minStoreRateMmH?: number;
};

const IMERG_NODATA = new Set([29999, 9999, -9999, 65535, -999]);

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isInAlgeriaRainfallBbox(lat: number, lon: number): boolean {
  return (
    lat >= ALGERIA_RAINFALL_BBOX.south &&
    lat <= ALGERIA_RAINFALL_BBOX.north &&
    lon >= ALGERIA_RAINFALL_BBOX.west &&
    lon <= ALGERIA_RAINFALL_BBOX.east
  );
}

export function gridCellKey(
  prefix: "imerg" | "hsaf",
  lat: number,
  lon: number,
): string {
  return `${prefix}:${lat.toFixed(2)}:${lon.toFixed(2)}`;
}

const STRICT_ISO_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:([Zz])|([+-])(\d{2}):?(\d{2}))$/;

const UPSTREAM_ERROR_SAMPLE_BYTES = 4096;

export function parseIsoTimestamp(
  value: unknown,
  label: string,
  sourceName: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${sourceName} schema invalid: missing ${label} timestamp`);
  }
  const trimmed = value.trim();
  const match = STRICT_ISO_TIMESTAMP_RE.exec(trimmed);
  if (!match) {
    throw new Error(
      `${sourceName} schema invalid: invalid ${label} timestamp "${value}"`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] !== undefined ? Number(match[6]) : 0;
  const msPart =
    match[7] !== undefined ? Number(match[7].slice(0, 3).padEnd(3, "0")) : 0;

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error(
      `${sourceName} schema invalid: invalid ${label} timestamp "${value}"`,
    );
  }

  let offsetMs = 0;
  if (match[9] !== undefined) {
    const tzHour = Number(match[10]);
    const tzMinute = Number(match[11]);
    if (tzHour > 23 || tzMinute > 59) {
      throw new Error(
        `${sourceName} schema invalid: invalid ${label} timestamp "${value}"`,
      );
    }
    const sign = match[9] === "-" ? -1 : 1;
    offsetMs = sign * ((tzHour * 60 + tzMinute) * 60_000);
  }

  // Verify real calendar date without JS Date rollover (rejects Feb 30, Apr 31, etc.)
  const utcCheck = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, msPart),
  );
  if (
    utcCheck.getUTCFullYear() !== year ||
    utcCheck.getUTCMonth() !== month - 1 ||
    utcCheck.getUTCDate() !== day ||
    utcCheck.getUTCHours() !== hour ||
    utcCheck.getUTCMinutes() !== minute ||
    utcCheck.getUTCSeconds() !== second
  ) {
    throw new Error(
      `${sourceName} schema invalid: impossible calendar date in ${label} timestamp "${value}"`,
    );
  }

  const epochMs = utcCheck.getTime() - offsetMs;
  if (!Number.isFinite(epochMs)) {
    throw new Error(
      `${sourceName} schema invalid: invalid ${label} timestamp "${value}"`,
    );
  }
  return new Date(epochMs).toISOString();
}

export function isTiffMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];
  // Classic TIFF little/big endian (42) or BigTIFF (43)
  const le =
    b0 === 0x49 && b1 === 0x49 && (b2 === 0x2a || b2 === 0x2b) && b3 === 0x00;
  const be =
    b0 === 0x4d && b1 === 0x4d && b2 === 0x00 && (b3 === 0x2a || b3 === 0x2b);
  return le || be;
}

const HTML_OR_XML_PREFIX =
  /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<\?xml\b|<serviceexceptionreport\b|<exceptionreport\b|<error\b)/i;

const PLAIN_ERROR_TEXT =
  /^\s*(?:error\b|service unavailable|bad gateway|gateway timeout|access denied|unauthorized|forbidden|maintenance|temporarily unavailable|too many requests|50[0234]\b|40[134]\b)/i;

function inspectLeadingHtmlComments(sample: string): {
  stripped: string;
  unclosedComment: boolean;
} {
  let text = sample.trimStart();
  while (text.startsWith("<!--")) {
    const end = text.indexOf("-->", 4);
    if (end === -1) {
      return { stripped: text, unclosedComment: true };
    }
    text = text.slice(end + 3).trimStart();
  }
  return { stripped: text, unclosedComment: false };
}

export function assertNotUpstreamErrorBody(
  body: string | ArrayBuffer | Uint8Array,
  contentType: string | null | undefined,
  sourceName: string,
): void {
  const ct = (contentType ?? "").toLowerCase();
  if (
    ct.includes("text/html") ||
    ct.includes("application/xhtml+xml") ||
    ct.includes("text/plain") ||
    ct.includes("application/xml") ||
    ct.includes("text/xml") ||
    ct.includes("se_xml") ||
    ct.includes("+xml")
  ) {
    throw new Error(
      `${sourceName} upstream returned non-data error content-type (${ct.split(";")[0]?.trim() || "text"})`,
    );
  }

  let sample: string;
  if (typeof body === "string") {
    sample = body.slice(0, UPSTREAM_ERROR_SAMPLE_BYTES);
  } else {
    const view =
      body instanceof Uint8Array
        ? body.subarray(0, UPSTREAM_ERROR_SAMPLE_BYTES)
        : new Uint8Array(
            body,
            0,
            Math.min(body.byteLength, UPSTREAM_ERROR_SAMPLE_BYTES),
          );
    if (isTiffMagicBytes(view)) return;
    sample = new TextDecoder("utf-8", { fatal: false }).decode(view);
  }

  const { stripped, unclosedComment } = inspectLeadingHtmlComments(sample);
  if (unclosedComment || HTML_OR_XML_PREFIX.test(stripped)) {
    throw new Error(
      `${sourceName} upstream returned HTML/XML error page instead of rainfall data`,
    );
  }
  if (PLAIN_ERROR_TEXT.test(sample) || PLAIN_ERROR_TEXT.test(stripped)) {
    throw new Error(
      `${sourceName} upstream returned plain-text error response instead of rainfall data`,
    );
  }
}

export function validateCoordinates(
  lat: unknown,
  lon: unknown,
  sourceName: string,
): { lat: number; lon: number } {
  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    throw new Error(
      `${sourceName} schema invalid: non-finite lat/lon coordinates`,
    );
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error(
      `${sourceName} schema invalid: out-of-range coordinates (lat=${lat}, lon=${lon})`,
    );
  }
  return { lat, lon };
}

export function validateRateAndAccum(
  rateMmH: number,
  accumMm30m: number,
  sourceName: string,
): { rateMmH: number; accumMm30m: number } {
  if (!Number.isFinite(rateMmH) || !Number.isFinite(accumMm30m)) {
    throw new Error(
      `${sourceName} schema invalid: NaN or non-finite rainfall value`,
    );
  }
  if (rateMmH < 0 || accumMm30m < 0) {
    throw new Error(
      `${sourceName} schema invalid: negative rainfall value (rate=${rateMmH}, accum=${accumMm30m})`,
    );
  }
  if (rateMmH > RAINFALL_MAX_RATE_MM_H || accumMm30m > RAINFALL_MAX_ACCUM_30M) {
    throw new Error(
      `${sourceName} schema invalid: unphysical rainfall spike (rate=${rateMmH} mm/h, accum=${accumMm30m} mm/30m)`,
    );
  }
  return { rateMmH: round2(rateMmH), accumMm30m: round2(accumMm30m) };
}

export function validateBbox(
  bbox: readonly number[],
  sourceName: string,
): [number, number, number, number] {
  if (
    bbox.length !== 4 ||
    !bbox.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    throw new Error(
      `${sourceName} schema invalid: invalid GeoTIFF bounding box`,
    );
  }
  const [west, south, east, north] = bbox as [number, number, number, number];
  if (south < -90 || north > 90 || west < -180 || east > 180) {
    throw new Error(
      `${sourceName} schema invalid: bounding box outside WGS84 bounds`,
    );
  }
  if (south >= north || west >= east) {
    throw new Error(
      `${sourceName} schema invalid: inverted or swapped bounding box axis order`,
    );
  }
  return [west, south, east, north];
}

function isNodata(
  value: number,
  extras: ReadonlySet<number>,
  gdalNoData: number | null,
  allowNaN = true,
): boolean {
  if (Number.isNaN(value)) return allowNaN;
  if (extras.has(value)) return true;
  if (gdalNoData !== null && value === gdalNoData) return true;
  return false;
}

export async function parseImergGeoTiff(
  buffer: ArrayBuffer,
  metadata: RainfallGeoTiffMetadata,
  contentType?: string | null,
): Promise<RainfallParseResult> {
  assertNotUpstreamErrorBody(buffer, contentType, "IMERG");
  const bytes = new Uint8Array(buffer);
  if (!isTiffMagicBytes(bytes)) {
    throw new Error(
      "IMERG schema invalid: payload is not a valid GeoTIFF binary",
    );
  }

  // Extract pre-filter freshness watermark BEFORE any spatial or wet-threshold filter
  const validTime = parseIsoTimestamp(
    metadata.validTime,
    "valid_time",
    "IMERG",
  );
  const upstreamPublishedAt = parseIsoTimestamp(
    metadata.publishedTime ?? validTime,
    "published_time",
    "IMERG",
  );
  const scaleFactor = metadata.scaleFactor ?? IMERG_SCALE_FACTOR;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new Error("IMERG schema invalid: scale_factor must be positive");
  }
  const minStoreRate = metadata.minStoreRateMmH ?? RAINFALL_MIN_STORE_RATE_MM_H;
  const nodataSet = new Set<number>([
    ...IMERG_NODATA,
    ...(metadata.nodataValues ?? []),
  ]);

  let tiff;
  try {
    tiff = await fromArrayBuffer(buffer);
  } catch (cause) {
    throw new Error(
      `IMERG schema invalid: GeoTIFF decode failed (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }

  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  if (width <= 0 || height <= 0) {
    throw new Error("IMERG schema invalid: empty GeoTIFF dimensions");
  }

  let rawBbox: number[];
  try {
    rawBbox = image.getBoundingBox();
  } catch (cause) {
    throw new Error(
      `IMERG schema invalid: missing GeoTIFF georeferencing (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }
  const [west, south, east, north] = validateBbox(rawBbox, "IMERG");
  const gdalNoData = image.getGDALNoData();

  const rasters = await image.readRasters({ interleave: false });
  const band = rasters[0];
  if (!band || typeof band === "number" || band.length !== width * height) {
    throw new Error(
      "IMERG schema invalid: GeoTIFF raster band length mismatch",
    );
  }

  const lonStep = (east - west) / width;
  const latStep = (north - south) / height;
  const byCell = new Map<string, RainfallObservation>();

  let cellsSeen = 0;
  let cellsInAlgeria = 0;
  let cellsOutsideAlgeria = 0;
  let cellsDry = 0;
  let cellsNodata = 0;

  for (let row = 0; row < height; row++) {
    const lat = north - (row + 0.5) * latStep;
    for (let col = 0; col < width; col++) {
      const lon = west + (col + 0.5) * lonStep;
      cellsSeen += 1;

      const rawValue = Number(band[row * width + col]);
      if (isNodata(rawValue, nodataSet, gdalNoData)) {
        cellsNodata += 1;
        continue;
      }

      const rawRate = rawValue * scaleFactor;
      const { rateMmH, accumMm30m } = validateRateAndAccum(
        rawRate,
        rawRate * 0.5,
        "IMERG",
      );

      if (!isInAlgeriaRainfallBbox(lat, lon)) {
        cellsOutsideAlgeria += 1;
        continue;
      }
      cellsInAlgeria += 1;

      if (rateMmH < minStoreRate) {
        cellsDry += 1;
        continue;
      }

      const key = gridCellKey("imerg", lat, lon);
      byCell.set(key, {
        sourceKey: IMERG_SOURCE_KEY,
        observationKind: "satellite_observed",
        isModel: false,
        validTime,
        publishedTime: upstreamPublishedAt,
        windowMinutes: RAINFALL_WINDOW_MINUTES,
        gridCellKey: key,
        lat: round2(lat),
        lon: round2(lon),
        rateMmH,
        accumMm30m,
        snapshotId: metadata.snapshotId ?? null,
        qualityState: "valid",
        attribution: IMERG_ATTRIBUTION,
      });
    }
  }

  const observations = [...byCell.values()];
  return {
    sourceKey: IMERG_SOURCE_KEY,
    validTime,
    upstreamPublishedAt,
    snapshotId: metadata.snapshotId ?? null,
    cellsSeen,
    cellsInAlgeria,
    cellsOutsideAlgeria,
    cellsDry,
    cellsNodata,
    drySlot: observations.length === 0,
    observations,
  };
}

type RawImergCell = Record<string, unknown>;

export function parseImergJson(
  payload: unknown,
  options: { minStoreRateMmH?: number | undefined } = {},
): RainfallParseResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("IMERG schema invalid: expected JSON object payload");
  }
  const obj = payload as Record<string, unknown>;
  if (
    obj["is_model"] === true ||
    (typeof obj["observation_kind"] === "string" &&
      obj["observation_kind"] !== "satellite_observed")
  ) {
    throw new Error(
      "IMERG schema invalid: satellite observed rainfall cannot carry model flag",
    );
  }

  // Extract pre-filter freshness watermark BEFORE filtering cells to Algeria or non-zero rain
  const validTime = parseIsoTimestamp(
    obj["valid_time"] ?? obj["validTime"],
    "valid_time",
    "IMERG",
  );
  const upstreamPublishedAt = parseIsoTimestamp(
    obj["published_time"] ?? obj["publishedTime"] ?? validTime,
    "published_time",
    "IMERG",
  );

  const windowMinutes = obj["window_minutes"] ?? obj["windowMinutes"] ?? 30;
  if (windowMinutes !== 30) {
    throw new Error(
      `IMERG schema invalid: expected 30-minute window, got ${String(windowMinutes)}`,
    );
  }

  const scaleFactor =
    typeof obj["scale_factor"] === "number"
      ? obj["scale_factor"]
      : IMERG_SCALE_FACTOR;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new Error("IMERG schema invalid: scale_factor must be positive");
  }

  const rawCells = obj["cells"];
  if (!Array.isArray(rawCells)) {
    throw new Error("IMERG schema invalid: missing cells array");
  }

  const snapshotId =
    typeof obj["snapshot_id"] === "string"
      ? obj["snapshot_id"]
      : typeof obj["snapshotId"] === "string"
        ? obj["snapshotId"]
        : null;
  const minStoreRate = options.minStoreRateMmH ?? RAINFALL_MIN_STORE_RATE_MM_H;
  const byCell = new Map<string, RainfallObservation>();

  let cellsSeen = 0;
  let cellsInAlgeria = 0;
  let cellsOutsideAlgeria = 0;
  let cellsDry = 0;
  let cellsNodata = 0;

  for (const entry of rawCells) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("IMERG schema invalid: cell entry must be an object");
    }
    const cell = entry as RawImergCell;
    cellsSeen += 1;

    const { lat, lon } = validateCoordinates(cell["lat"], cell["lon"], "IMERG");

    let rawRate: number;
    if (
      "scaled_rate" in cell &&
      cell["scaled_rate"] !== null &&
      cell["scaled_rate"] !== undefined
    ) {
      if (typeof cell["scaled_rate"] !== "number") {
        throw new Error("IMERG schema invalid: scaled_rate must be a number");
      }
      if (isNodata(cell["scaled_rate"], IMERG_NODATA, null, false)) {
        cellsNodata += 1;
        continue;
      }
      rawRate = cell["scaled_rate"] * scaleFactor;
    } else if (
      "rate_mm_h" in cell &&
      cell["rate_mm_h"] !== null &&
      cell["rate_mm_h"] !== undefined
    ) {
      if (typeof cell["rate_mm_h"] !== "number") {
        throw new Error("IMERG schema invalid: rate_mm_h must be a number");
      }
      if (isNodata(cell["rate_mm_h"], IMERG_NODATA, null, false)) {
        cellsNodata += 1;
        continue;
      }
      rawRate = cell["rate_mm_h"];
    } else {
      throw new Error(
        "IMERG schema invalid: cell missing scaled_rate or rate_mm_h",
      );
    }

    const expectedAccum = rawRate * 0.5;
    let rawAccum = expectedAccum;
    if (
      "accum_mm_30m" in cell &&
      cell["accum_mm_30m"] !== null &&
      cell["accum_mm_30m"] !== undefined
    ) {
      if (
        typeof cell["accum_mm_30m"] !== "number" ||
        !Number.isFinite(cell["accum_mm_30m"])
      ) {
        throw new Error(
          "IMERG schema invalid: accum_mm_30m must be a finite number",
        );
      }
      if (Math.abs(cell["accum_mm_30m"] - expectedAccum) > 0.25) {
        throw new Error(
          "IMERG schema invalid: inconsistent rate_mm_h and accum_mm_30m values",
        );
      }
      rawAccum = cell["accum_mm_30m"];
    }

    const { rateMmH, accumMm30m } = validateRateAndAccum(
      rawRate,
      rawAccum,
      "IMERG",
    );

    if (!isInAlgeriaRainfallBbox(lat, lon)) {
      cellsOutsideAlgeria += 1;
      continue;
    }
    cellsInAlgeria += 1;

    if (rateMmH < minStoreRate) {
      cellsDry += 1;
      continue;
    }

    const quality =
      cell["quality_state"] === "degraded" ||
      cell["quality_state"] === "flagged"
        ? cell["quality_state"]
        : "valid";
    const key =
      typeof cell["grid_cell_key"] === "string" && cell["grid_cell_key"].trim()
        ? cell["grid_cell_key"].trim()
        : gridCellKey("imerg", lat, lon);

    byCell.set(key, {
      sourceKey: IMERG_SOURCE_KEY,
      observationKind: "satellite_observed",
      isModel: false,
      validTime,
      publishedTime: upstreamPublishedAt,
      windowMinutes: RAINFALL_WINDOW_MINUTES,
      gridCellKey: key,
      lat: round2(lat),
      lon: round2(lon),
      rateMmH,
      accumMm30m,
      snapshotId,
      qualityState: quality,
      attribution: IMERG_ATTRIBUTION,
    });
  }

  const observations = [...byCell.values()];
  return {
    sourceKey: IMERG_SOURCE_KEY,
    validTime,
    upstreamPublishedAt,
    snapshotId,
    cellsSeen,
    cellsInAlgeria,
    cellsOutsideAlgeria,
    cellsDry,
    cellsNodata,
    drySlot: observations.length === 0,
    observations,
  };
}

export async function parseImergPayload(
  payload: string | ArrayBuffer | Uint8Array | Record<string, unknown>,
  options: {
    contentType?: string | null;
    geotiffMetadata?: RainfallGeoTiffMetadata;
    minStoreRateMmH?: number;
  } = {},
): Promise<RainfallParseResult> {
  if (typeof payload === "string") {
    assertNotUpstreamErrorBody(payload, options.contentType, "IMERG");
    let decoded: unknown;
    try {
      decoded = JSON.parse(payload);
    } catch {
      throw new Error("IMERG schema invalid: failed to parse JSON payload");
    }
    return parseImergJson(decoded, {
      minStoreRateMmH: options.minStoreRateMmH,
    });
  }

  if (payload instanceof ArrayBuffer || payload instanceof Uint8Array) {
    assertNotUpstreamErrorBody(payload, options.contentType, "IMERG");
    const bytes =
      payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (isTiffMagicBytes(bytes)) {
      if (!options.geotiffMetadata) {
        throw new Error(
          "IMERG schema invalid: GeoTIFF payload requires validTime slot metadata",
        );
      }
      const ab: ArrayBuffer =
        payload instanceof ArrayBuffer
          ? payload
          : new Uint8Array(payload).slice().buffer;
      return parseImergGeoTiff(
        ab,
        options.geotiffMetadata,
        options.contentType,
      );
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error(
        "IMERG schema invalid: binary payload is neither GeoTIFF nor JSON",
      );
    }
    return parseImergJson(decoded, {
      minStoreRateMmH: options.minStoreRateMmH,
    });
  }

  return parseImergJson(payload, { minStoreRateMmH: options.minStoreRateMmH });
}
