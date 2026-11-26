import { fromArrayBuffer } from "geotiff";

import {
  assertNotUpstreamErrorBody,
  gridCellKey,
  isInAlgeriaRainfallBbox,
  isTiffMagicBytes,
  parseIsoTimestamp,
  RAINFALL_MIN_STORE_RATE_MM_H,
  RAINFALL_WINDOW_MINUTES,
  round2,
  validateBbox,
  validateCoordinates,
  validateRateAndAccum,
  type RainfallGeoTiffMetadata,
  type RainfallObservation,
  type RainfallParseResult,
} from "./imerg";

export const HSAF_SOURCE_KEY = "hsaf_rainfall" as const;
export const HSAF_ATTRIBUTION =
  "EUMETSAT H-SAF (satellite observed rainfall)" as const;

// Official EUMETSAT H-SAF H60B discrete legend bands (mm/hr), read from msg_fes:h60b GetLegendGraphic
const HSAF_H60B_PALETTE: readonly {
  rgb: readonly [number, number, number];
  rateMmH: number;
}[] = [
  { rgb: [227, 244, 192], rateMmH: 0.5 },
  { rgb: [198, 232, 179], rateMmH: 1.5 },
  { rgb: [162, 218, 183], rateMmH: 2.5 },
  { rgb: [126, 204, 186], rateMmH: 4.0 },
  { rgb: [96, 194, 191], rateMmH: 6.0 },
  { rgb: [65, 183, 196], rateMmH: 8.5 },
  { rgb: [47, 164, 194], rateMmH: 12.5 },
  { rgb: [29, 145, 191], rateMmH: 17.5 },
  { rgb: [32, 120, 180], rateMmH: 25.0 },
  { rgb: [34, 94, 168], rateMmH: 40.0 },
  { rgb: [12, 44, 133], rateMmH: 55.0 },
];

export async function parseHsafWmsGeoTiff(
  buffer: ArrayBuffer,
  options: {
    validTime: string;
    publishedTime?: string;
    contentType?: string | null;
  },
): Promise<RainfallParseResult> {
  assertNotUpstreamErrorBody(buffer, options.contentType, "H-SAF");
  if (!isTiffMagicBytes(new Uint8Array(buffer))) {
    throw new Error("H-SAF schema invalid: expected WMS GeoTIFF binary");
  }
  const validTime = parseIsoTimestamp(options.validTime, "valid_time", "H-SAF");
  const upstreamPublishedAt = parseIsoTimestamp(
    options.publishedTime ?? validTime,
    "published_time",
    "H-SAF",
  );
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [west, south, east, north] = validateBbox(
    image.getBoundingBox(),
    "H-SAF",
  );
  const rasters = await image.readRasters({ interleave: false });
  const rBand = rasters[0];
  const gBand = rasters[1];
  const bBand = rasters[2];
  const aBand = rasters[3];
  if (
    !rBand ||
    !gBand ||
    !bBand ||
    !aBand ||
    typeof rBand === "number" ||
    typeof gBand === "number" ||
    typeof bBand === "number" ||
    typeof aBand === "number" ||
    aBand.length !== width * height
  ) {
    throw new Error("H-SAF schema invalid: expected 4-band RGBA GeoTIFF");
  }

  const lonStep = (east - west) / width;
  const latStep = (north - south) / height;
  const byCell = new Map<string, RainfallObservation>();
  let cellsSeen = 0;
  let cellsInAlgeria = 0;
  let cellsOutsideAlgeria = 0;
  let cellsDry = 0;

  for (let row = 0; row < height; row++) {
    const lat = Math.round((north - (row + 0.5) * latStep) * 1000) / 1000;
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      const lon = Math.round((west + (col + 0.5) * lonStep) * 1000) / 1000;
      cellsSeen += 1;
      if (!isInAlgeriaRainfallBbox(lat, lon)) {
        cellsOutsideAlgeria += 1;
        continue;
      }
      cellsInAlgeria += 1;
      if (Number(aBand[idx]) <= 127) {
        cellsDry += 1;
        continue;
      }
      const r = Number(rBand[idx]);
      const g = Number(gBand[idx]);
      const b = Number(bBand[idx]);
      let bestRate = HSAF_H60B_PALETTE[0]!.rateMmH;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const entry of HSAF_H60B_PALETTE) {
        const d =
          (r - entry.rgb[0]) ** 2 +
          (g - entry.rgb[1]) ** 2 +
          (b - entry.rgb[2]) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestRate = entry.rateMmH;
        }
      }
      const { rateMmH, accumMm30m } = validateRateAndAccum(
        bestRate,
        round2(bestRate * 0.5),
        "H-SAF",
      );
      const key = gridCellKey("hsaf", lat, lon);
      byCell.set(key, {
        sourceKey: HSAF_SOURCE_KEY,
        observationKind: "satellite_observed",
        isModel: false,
        validTime,
        publishedTime: upstreamPublishedAt,
        windowMinutes: RAINFALL_WINDOW_MINUTES,
        gridCellKey: key,
        lat,
        lon,
        rateMmH,
        accumMm30m,
        snapshotId: `h60b:${validTime}`,
        qualityState: "valid",
        attribution: HSAF_ATTRIBUTION,
      });
    }
  }

  const observations = [...byCell.values()];
  return {
    sourceKey: HSAF_SOURCE_KEY,
    validTime,
    upstreamPublishedAt,
    snapshotId: `h60b:${validTime}`,
    cellsSeen,
    cellsInAlgeria,
    cellsOutsideAlgeria,
    cellsDry,
    cellsNodata: 0,
    drySlot: observations.length === 0,
    observations,
  };
}

const HSAF_NODATA = new Set([-9999, 9999, 29999, 65535, -999, -9999.0]);

export type HsafValueUnit = "mm_h" | "mm_30m";

export type HsafGeoTiffMetadata = RainfallGeoTiffMetadata & {
  valueUnit?: HsafValueUnit | undefined;
};

function isHsafNodata(
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

function normalizeHsafUnit(raw: unknown): HsafValueUnit {
  if (raw === undefined || raw === null || raw === "mm/h" || raw === "mm_h") {
    return "mm_h";
  }
  if (raw === "mm/30m" || raw === "mm_30m" || raw === "mm/30min") {
    return "mm_30m";
  }
  throw new Error(
    `H-SAF schema invalid: unsupported precipitation unit "${String(raw)}"`,
  );
}

export async function parseHsafGeoTiff(
  buffer: ArrayBuffer,
  metadata: HsafGeoTiffMetadata,
  contentType?: string | null,
): Promise<RainfallParseResult> {
  assertNotUpstreamErrorBody(buffer, contentType, "H-SAF");
  const bytes = new Uint8Array(buffer);
  if (!isTiffMagicBytes(bytes)) {
    throw new Error(
      "H-SAF schema invalid: payload is not a valid GeoTIFF binary",
    );
  }

  // Pre-filter freshness watermark extracted BEFORE spatial or wet-threshold filtering
  const validTime = parseIsoTimestamp(
    metadata.validTime,
    "valid_time",
    "H-SAF",
  );
  const upstreamPublishedAt = parseIsoTimestamp(
    metadata.publishedTime ?? validTime,
    "published_time",
    "H-SAF",
  );
  const scaleFactor = metadata.scaleFactor ?? 1;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new Error("H-SAF schema invalid: scale_factor must be positive");
  }
  const unit = normalizeHsafUnit(metadata.valueUnit);
  const minStoreRate = metadata.minStoreRateMmH ?? RAINFALL_MIN_STORE_RATE_MM_H;
  const nodataSet = new Set<number>([
    ...HSAF_NODATA,
    ...(metadata.nodataValues ?? []),
  ]);

  let tiff;
  try {
    tiff = await fromArrayBuffer(buffer);
  } catch (cause) {
    throw new Error(
      `H-SAF schema invalid: GeoTIFF decode failed (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }

  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  if (width <= 0 || height <= 0) {
    throw new Error("H-SAF schema invalid: empty GeoTIFF dimensions");
  }

  let rawBbox: number[];
  try {
    rawBbox = image.getBoundingBox();
  } catch (cause) {
    throw new Error(
      `H-SAF schema invalid: missing GeoTIFF georeferencing (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }
  const [west, south, east, north] = validateBbox(rawBbox, "H-SAF");
  const gdalNoData = image.getGDALNoData();

  const rasters = await image.readRasters({ interleave: false });
  const band = rasters[0];
  if (!band || typeof band === "number" || band.length !== width * height) {
    throw new Error(
      "H-SAF schema invalid: GeoTIFF raster band length mismatch",
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
      if (isHsafNodata(rawValue, nodataSet, gdalNoData)) {
        cellsNodata += 1;
        continue;
      }

      const scaled = rawValue * scaleFactor;
      const rawRate = unit === "mm_30m" ? scaled * 2 : scaled;
      const rawAccum = unit === "mm_30m" ? scaled : scaled * 0.5;
      const { rateMmH, accumMm30m } = validateRateAndAccum(
        rawRate,
        rawAccum,
        "H-SAF",
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

      const key = gridCellKey("hsaf", lat, lon);
      byCell.set(key, {
        sourceKey: HSAF_SOURCE_KEY,
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
        attribution: HSAF_ATTRIBUTION,
      });
    }
  }

  const observations = [...byCell.values()];
  return {
    sourceKey: HSAF_SOURCE_KEY,
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

export function parseHsafJson(
  payload: unknown,
  options: { minStoreRateMmH?: number | undefined } = {},
): RainfallParseResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("H-SAF schema invalid: expected JSON object payload");
  }
  const obj = payload as Record<string, unknown>;
  if (
    obj["is_model"] === true ||
    (typeof obj["observation_kind"] === "string" &&
      obj["observation_kind"] !== "satellite_observed")
  ) {
    throw new Error(
      "H-SAF schema invalid: satellite observed rainfall cannot carry model flag",
    );
  }

  // Extract pre-filter freshness watermark BEFORE filtering cells to Algeria or non-zero rain
  const validTime = parseIsoTimestamp(
    obj["valid_time"] ?? obj["validTime"],
    "valid_time",
    "H-SAF",
  );
  const upstreamPublishedAt = parseIsoTimestamp(
    obj["published_time"] ?? obj["publishedTime"] ?? validTime,
    "published_time",
    "H-SAF",
  );

  const windowMinutes = obj["window_minutes"] ?? obj["windowMinutes"] ?? 30;
  if (windowMinutes !== 30) {
    throw new Error(
      `H-SAF schema invalid: expected 30-minute window, got ${String(windowMinutes)}`,
    );
  }

  const defaultUnit = normalizeHsafUnit(obj["unit"]);
  const rawCells = obj["cells"];
  if (!Array.isArray(rawCells)) {
    throw new Error("H-SAF schema invalid: missing cells array");
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
      throw new Error("H-SAF schema invalid: cell entry must be an object");
    }
    const cell = entry as Record<string, unknown>;
    cellsSeen += 1;

    const { lat, lon } = validateCoordinates(cell["lat"], cell["lon"], "H-SAF");

    let rawRate: number;
    let rawAccum: number;

    const hasRate =
      "rate_mm_h" in cell &&
      cell["rate_mm_h"] !== null &&
      cell["rate_mm_h"] !== undefined;
    const hasAccum =
      "accum_mm_30m" in cell &&
      cell["accum_mm_30m"] !== null &&
      cell["accum_mm_30m"] !== undefined;
    const hasValue =
      "value" in cell && cell["value"] !== null && cell["value"] !== undefined;

    if (hasRate) {
      if (typeof cell["rate_mm_h"] !== "number") {
        throw new Error("H-SAF schema invalid: rate_mm_h must be a number");
      }
      if (isHsafNodata(cell["rate_mm_h"], HSAF_NODATA, null, false)) {
        cellsNodata += 1;
        continue;
      }
      rawRate = cell["rate_mm_h"];
      rawAccum = rawRate * 0.5;
      if (hasAccum) {
        if (
          typeof cell["accum_mm_30m"] !== "number" ||
          !Number.isFinite(cell["accum_mm_30m"])
        ) {
          throw new Error(
            "H-SAF schema invalid: accum_mm_30m must be a finite number",
          );
        }
        if (Math.abs(cell["accum_mm_30m"] - rawAccum) > 0.25) {
          throw new Error(
            "H-SAF schema invalid: inconsistent rate_mm_h and accum_mm_30m values",
          );
        }
        rawAccum = cell["accum_mm_30m"];
      }
    } else if (hasAccum) {
      if (typeof cell["accum_mm_30m"] !== "number") {
        throw new Error("H-SAF schema invalid: accum_mm_30m must be a number");
      }
      if (isHsafNodata(cell["accum_mm_30m"], HSAF_NODATA, null, false)) {
        cellsNodata += 1;
        continue;
      }
      rawAccum = cell["accum_mm_30m"];
      rawRate = rawAccum * 2;
    } else if (hasValue) {
      if (typeof cell["value"] !== "number") {
        throw new Error("H-SAF schema invalid: value must be a number");
      }
      if (isHsafNodata(cell["value"], HSAF_NODATA, null, false)) {
        cellsNodata += 1;
        continue;
      }
      const cellUnit = cell["unit"]
        ? normalizeHsafUnit(cell["unit"])
        : defaultUnit;
      if (cellUnit === "mm_30m") {
        rawAccum = cell["value"];
        rawRate = rawAccum * 2;
      } else {
        rawRate = cell["value"];
        rawAccum = rawRate * 0.5;
      }
    } else {
      throw new Error(
        "H-SAF schema invalid: cell missing rate_mm_h, accum_mm_30m, or value",
      );
    }

    const { rateMmH, accumMm30m } = validateRateAndAccum(
      rawRate,
      rawAccum,
      "H-SAF",
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
        : gridCellKey("hsaf", lat, lon);

    byCell.set(key, {
      sourceKey: HSAF_SOURCE_KEY,
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
      attribution: HSAF_ATTRIBUTION,
    });
  }

  const observations = [...byCell.values()];
  return {
    sourceKey: HSAF_SOURCE_KEY,
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

export async function parseHsafPayload(
  payload: string | ArrayBuffer | Uint8Array | Record<string, unknown>,
  options: {
    contentType?: string | null;
    geotiffMetadata?: HsafGeoTiffMetadata;
    minStoreRateMmH?: number;
  } = {},
): Promise<RainfallParseResult> {
  if (typeof payload === "string") {
    assertNotUpstreamErrorBody(payload, options.contentType, "H-SAF");
    let decoded: unknown;
    try {
      decoded = JSON.parse(payload);
    } catch {
      throw new Error("H-SAF schema invalid: failed to parse JSON payload");
    }
    return parseHsafJson(decoded, { minStoreRateMmH: options.minStoreRateMmH });
  }

  if (payload instanceof ArrayBuffer || payload instanceof Uint8Array) {
    assertNotUpstreamErrorBody(payload, options.contentType, "H-SAF");
    const bytes =
      payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (isTiffMagicBytes(bytes)) {
      if (!options.geotiffMetadata) {
        throw new Error(
          "H-SAF schema invalid: GeoTIFF payload requires validTime slot metadata",
        );
      }
      const ab: ArrayBuffer =
        payload instanceof ArrayBuffer
          ? payload
          : new Uint8Array(payload).slice().buffer;
      return parseHsafGeoTiff(ab, options.geotiffMetadata, options.contentType);
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error(
        "H-SAF schema invalid: binary payload is neither GeoTIFF nor JSON",
      );
    }
    return parseHsafJson(decoded, { minStoreRateMmH: options.minStoreRateMmH });
  }

  return parseHsafJson(payload, { minStoreRateMmH: options.minStoreRateMmH });
}
