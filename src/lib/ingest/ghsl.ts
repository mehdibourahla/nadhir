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

export const GHSL_SOURCE_KEY = "ghsl_population" as const;
export const GHSL_ATTRIBUTION =
  "European Commission JRC GHSL GHS-POP R2023A (modeled residents)" as const;
export const GHSL_EXPOSURE_LABEL = "modeled_residents" as const;

export const ALGERIA_GHSL_BBOX = {
  south: 18.0,
  north: 38.5,
  west: -9.5,
  east: 13.0,
} as const;

export const GHSL_BANNED_LABELS = [
  "people_present",
  "people_threatened",
  "present_population",
  "threatened_population",
  "people currently present",
  "people threatened",
  "evacuees",
  "casualties",
] as const;

const BANNED_LABEL_SET = new Set<string>(GHSL_BANNED_LABELS);
const VALID_EPOCHS = new Set([2020, 2025, 2030]);
const VALID_RESOLUTIONS = new Set([100, 1000]);
const VALID_CRS = new Set(["EPSG:4326", "ESRI:54009"]);
const GHSL_TIFF_NODATA = new Set([-200, -9999, -999]);
const MAX_COMMUNE_DISTANCE_KM = 80;

export type GhslEpochYear = 2020 | 2025 | 2030;
export type GhslResolutionM = 100 | 1000;
export type GhslCrsCode = "EPSG:4326" | "ESRI:54009";

export type GhslCommuneRef = {
  id: string;
  code: string;
  lat: number;
  lon: number;
};

export type GhslExposureRecord = {
  sourceKey: typeof GHSL_SOURCE_KEY;
  epochYear: GhslEpochYear;
  datasetRelease: string;
  crsCode: GhslCrsCode;
  resolutionM: GhslResolutionM;
  exposureLabel: "modeled_residents";
  communeId: string | null;
  communeCode: string;
  wilayaCode: string;
  lat: number;
  lon: number;
  modeledResidents: number;
  sourceCellSum: number;
  sourceCellCount: number;
  conservationDelta: number;
  publishedAt: string;
  attribution: string;
};

export type GhslParseResult = {
  sourceKey: typeof GHSL_SOURCE_KEY;
  epochYear: GhslEpochYear;
  datasetRelease: string;
  crsCode: GhslCrsCode;
  resolutionM: GhslResolutionM;
  publishedAt: string;
  cellsSeen: number;
  cellsOutsideAlgeria: number;
  cellsNodata: number;
  totalSourceResidents: number;
  totalAggregatedResidents: number;
  tileConservationDelta: number;
  emptyTile: boolean;
  records: GhslExposureRecord[];
};

export type GhslGeoTiffMetadata = {
  epochYear: GhslEpochYear;
  resolutionM: GhslResolutionM;
  crsCode?: GhslCrsCode;
  datasetRelease?: string;
  publishedAt: string;
  communes?: readonly GhslCommuneRef[];
};

function isInAlgeriaGhslBbox(lat: number, lon: number): boolean {
  return (
    lat >= ALGERIA_GHSL_BBOX.south &&
    lat <= ALGERIA_GHSL_BBOX.north &&
    lon >= ALGERIA_GHSL_BBOX.west &&
    lon <= ALGERIA_GHSL_BBOX.east
  );
}

function assertHonestExposureLabel(
  label: unknown,
  isLiveOccupancy?: unknown,
): void {
  if (isLiveOccupancy === true) {
    throw new Error(
      "GHSL schema invalid: modeled residents are not live occupancy or people currently present",
    );
  }
  if (label === undefined || label === null) return;
  if (typeof label !== "string") {
    throw new Error(
      "GHSL schema invalid: exposure_label must be modeled_residents",
    );
  }
  const normalized = label.trim().toLowerCase();
  if (BANNED_LABEL_SET.has(normalized) || normalized !== GHSL_EXPOSURE_LABEL) {
    throw new Error(
      `GHSL schema invalid: exposure_label "${label.trim()}" rejected; must be modeled_residents`,
    );
  }
}

function validateEpoch(value: unknown): GhslEpochYear {
  if (typeof value !== "number" || !VALID_EPOCHS.has(value)) {
    throw new Error(
      `GHSL schema invalid: unsupported epoch_year "${String(value)}"`,
    );
  }
  return value as GhslEpochYear;
}

function validateResolution(value: unknown): GhslResolutionM {
  if (typeof value !== "number" || !VALID_RESOLUTIONS.has(value)) {
    throw new Error(
      `GHSL schema invalid: unsupported resolution_m "${String(value)}"`,
    );
  }
  return value as GhslResolutionM;
}

function validateCrs(value: unknown): GhslCrsCode {
  if (typeof value !== "string" || !VALID_CRS.has(value)) {
    throw new Error(
      `GHSL schema invalid: unsupported crs_code "${String(value)}"`,
    );
  }
  return value as GhslCrsCode;
}

function assertConservation(
  modeled: number,
  sourceSum: number,
  context: string,
): number {
  const delta = round2(modeled - sourceSum);
  const tolerance = Math.max(1.0, sourceSum * 0.005);
  if (Math.abs(delta) > tolerance) {
    throw new Error(
      `GHSL schema invalid: population conservation check failed for ${context} (delta=${delta}, tolerance=${round2(tolerance)})`,
    );
  }
  return delta;
}

function nearestCommune(
  lat: number,
  lon: number,
  communes: readonly GhslCommuneRef[],
): GhslCommuneRef | null {
  let best: { ref: GhslCommuneRef; km: number } | null = null;
  for (const c of communes) {
    const km = haversineKm(lat, lon, c.lat, c.lon);
    if (!best || km < best.km) best = { ref: c, km };
  }
  if (!best || best.km > MAX_COMMUNE_DISTANCE_KM) return null;
  return best.ref;
}

export async function parseGhslGeoTiff(
  buffer: ArrayBuffer,
  metadata: GhslGeoTiffMetadata,
  contentType?: string | null,
): Promise<GhslParseResult> {
  assertNotScientificUpstreamErrorBody(
    buffer,
    contentType,
    "GHSL",
    "GHSL population GeoTIFF tile",
  );
  const bytes = new Uint8Array(buffer);
  if (!isTiffMagicBytes(bytes)) {
    throw new Error(
      "GHSL schema invalid: payload is not a valid GeoTIFF binary",
    );
  }

  const epochYear = validateEpoch(metadata.epochYear);
  const resolutionM = validateResolution(metadata.resolutionM);
  const crsCode = validateCrs(metadata.crsCode ?? "EPSG:4326");
  const datasetRelease = metadata.datasetRelease ?? "GHS-POP-R2023A";
  // Pre-filter watermark captured BEFORE spatial filtering
  const publishedAt = parseIsoTimestamp(
    metadata.publishedAt,
    "published_at",
    "GHSL",
  );

  let tiff;
  try {
    tiff = await fromArrayBuffer(buffer);
  } catch (cause) {
    throw new Error(
      `GHSL schema invalid: GeoTIFF decode failed (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }

  let image;
  try {
    image = await tiff.getImage();
  } catch (cause) {
    throw new Error(
      `GHSL schema invalid: GeoTIFF decode failed (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }
  const width = image.getWidth();
  const height = image.getHeight();
  if (width <= 0 || height <= 0) {
    throw new Error("GHSL schema invalid: empty GeoTIFF dimensions");
  }

  let rawBbox: number[];
  try {
    rawBbox = image.getBoundingBox();
  } catch (cause) {
    throw new Error(
      `GHSL schema invalid: missing GeoTIFF georeferencing (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }
  const [west, south, east, north] = validateBbox(rawBbox, "GHSL");
  const gdalNoData = image.getGDALNoData();

  let rasters;
  try {
    rasters = await image.readRasters({ interleave: false });
  } catch (cause) {
    throw new Error(
      `GHSL schema invalid: GeoTIFF decode failed (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }
  const band = rasters[0];
  if (!band || typeof band === "number" || band.length !== width * height) {
    throw new Error("GHSL schema invalid: GeoTIFF raster band length mismatch");
  }

  const communes = metadata.communes ?? [];
  const lonStep = (east - west) / width;
  const latStep = (north - south) / height;

  type Bucket = {
    communeId: string | null;
    communeCode: string;
    wilayaCode: string;
    lat: number;
    lon: number;
    cellSum: number;
    cellCount: number;
  };
  const buckets = new Map<string, Bucket>();

  let cellsSeen = 0;
  let cellsOutsideAlgeria = 0;
  let cellsNodata = 0;
  let totalSourceResidents = 0;

  for (let row = 0; row < height; row++) {
    const lat = north - (row + 0.5) * latStep;
    for (let col = 0; col < width; col++) {
      const lon = west + (col + 0.5) * lonStep;
      cellsSeen += 1;

      const raw = Number(band[row * width + col]);
      if (
        Number.isNaN(raw) ||
        GHSL_TIFF_NODATA.has(raw) ||
        (gdalNoData !== null && raw === gdalNoData)
      ) {
        cellsNodata += 1;
        continue;
      }
      if (!Number.isFinite(raw) || raw < 0) {
        throw new Error(
          `GHSL schema invalid: negative or non-finite population cell (${raw})`,
        );
      }

      if (!isInAlgeriaGhslBbox(lat, lon)) {
        cellsOutsideAlgeria += 1;
        continue;
      }

      totalSourceResidents += raw;
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
        cellSum: 0,
        cellCount: 0,
      };
      bucket.cellSum += raw;
      bucket.cellCount += 1;
      buckets.set(communeCode, bucket);
    }
  }

  const records: GhslExposureRecord[] = [];
  let totalAggregatedResidents = 0;
  for (const b of buckets.values()) {
    const cellSum = round2(b.cellSum);
    const modeledResidents = cellSum;
    const conservationDelta = assertConservation(
      modeledResidents,
      cellSum,
      `commune ${b.communeCode}`,
    );
    totalAggregatedResidents += modeledResidents;
    records.push({
      sourceKey: GHSL_SOURCE_KEY,
      epochYear,
      datasetRelease,
      crsCode,
      resolutionM,
      exposureLabel: GHSL_EXPOSURE_LABEL,
      communeId: b.communeId,
      communeCode: b.communeCode,
      wilayaCode: b.wilayaCode,
      lat: b.lat,
      lon: b.lon,
      modeledResidents,
      sourceCellSum: cellSum,
      sourceCellCount: b.cellCount,
      conservationDelta,
      publishedAt,
      attribution: GHSL_ATTRIBUTION,
    });
  }

  const roundedSourceTotal = round2(totalSourceResidents);
  const roundedAggTotal = round2(totalAggregatedResidents);
  const tileConservationDelta = assertConservation(
    roundedAggTotal,
    roundedSourceTotal,
    "GHSL GeoTIFF tile",
  );

  return {
    sourceKey: GHSL_SOURCE_KEY,
    epochYear,
    datasetRelease,
    crsCode,
    resolutionM,
    publishedAt,
    cellsSeen,
    cellsOutsideAlgeria,
    cellsNodata,
    totalSourceResidents: roundedSourceTotal,
    totalAggregatedResidents: roundedAggTotal,
    tileConservationDelta,
    emptyTile: records.length === 0,
    records,
  };
}

export function parseGhslJson(
  payload: unknown,
  options: { communes?: readonly GhslCommuneRef[] | undefined } = {},
): GhslParseResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("GHSL schema invalid: expected JSON object payload");
  }
  const obj = payload as Record<string, unknown>;
  assertHonestExposureLabel(obj["exposure_label"], obj["is_live_occupancy"]);

  const epochYear = validateEpoch(obj["epoch_year"]);
  const resolutionM = validateResolution(obj["resolution_m"]);
  const crsCode = validateCrs(obj["crs_code"] ?? "EPSG:4326");
  const datasetRelease =
    typeof obj["dataset_release"] === "string" && obj["dataset_release"].trim()
      ? obj["dataset_release"].trim()
      : "GHS-POP-R2023A";

  // Pre-filter watermark captured BEFORE spatial filtering
  const publishedAt = parseIsoTimestamp(
    obj["published_at"] ?? obj["publishedAt"],
    "published_at",
    "GHSL",
  );

  if (Array.isArray(obj["cells"])) {
    const communes = options.communes ?? [];
    type Bucket = {
      communeId: string | null;
      communeCode: string;
      wilayaCode: string;
      lat: number;
      lon: number;
      cellSum: number;
      cellCount: number;
    };
    const buckets = new Map<string, Bucket>();
    let cellsSeen = 0;
    let cellsOutsideAlgeria = 0;
    let totalSourceResidents = 0;

    for (const raw of obj["cells"] as unknown[]) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("GHSL schema invalid: cell entry must be an object");
      }
      const cell = raw as Record<string, unknown>;
      assertHonestExposureLabel(
        cell["exposure_label"],
        cell["is_live_occupancy"],
      );
      const { lat, lon } = validateCoordinates(
        cell["lat"],
        cell["lon"],
        "GHSL",
      );
      const pop = cell["residents"] ?? cell["population"];
      if (typeof pop !== "number" || !Number.isFinite(pop) || pop < 0) {
        throw new Error(
          `GHSL schema invalid: cell population must be a finite non-negative number (${String(pop)})`,
        );
      }
      cellsSeen += 1;
      if (!isInAlgeriaGhslBbox(lat, lon)) {
        cellsOutsideAlgeria += 1;
        continue;
      }

      totalSourceResidents += pop;
      const explicitCode =
        typeof cell["commune_code"] === "string" && cell["commune_code"].trim()
          ? cell["commune_code"].trim()
          : null;
      const matched = explicitCode
        ? (communes.find((c) => c.code === explicitCode) ?? null)
        : nearestCommune(lat, lon, communes);
      const communeCode =
        explicitCode ??
        matched?.code ??
        `grid:${lat.toFixed(2)}:${lon.toFixed(2)}`;
      const wilayaCode =
        typeof cell["wilaya_code"] === "string" && cell["wilaya_code"].trim()
          ? cell["wilaya_code"].trim()
          : explicitCode
            ? explicitCode.slice(0, 2)
            : matched
              ? matched.code.slice(0, 2)
              : "00";

      const bucket = buckets.get(communeCode) ?? {
        communeId: matched?.id ?? null,
        communeCode,
        wilayaCode,
        lat: matched?.lat ?? lat,
        lon: matched?.lon ?? lon,
        cellSum: 0,
        cellCount: 0,
      };
      bucket.cellSum += pop;
      bucket.cellCount += 1;
      buckets.set(communeCode, bucket);
    }

    const records: GhslExposureRecord[] = [];
    let totalAggregated = 0;
    for (const b of buckets.values()) {
      const cellSum = round2(b.cellSum);
      const modeled = cellSum;
      const delta = assertConservation(
        modeled,
        cellSum,
        `commune ${b.communeCode}`,
      );
      totalAggregated += modeled;
      records.push({
        sourceKey: GHSL_SOURCE_KEY,
        epochYear,
        datasetRelease,
        crsCode,
        resolutionM,
        exposureLabel: GHSL_EXPOSURE_LABEL,
        communeId: b.communeId,
        communeCode: b.communeCode,
        wilayaCode: b.wilayaCode,
        lat: b.lat,
        lon: b.lon,
        modeledResidents: modeled,
        sourceCellSum: cellSum,
        sourceCellCount: b.cellCount,
        conservationDelta: delta,
        publishedAt,
        attribution: GHSL_ATTRIBUTION,
      });
    }

    const declaredTileTotal =
      typeof obj["tile_total_residents"] === "number"
        ? obj["tile_total_residents"]
        : totalSourceResidents;
    if (!Number.isFinite(declaredTileTotal) || declaredTileTotal < 0) {
      throw new Error(
        "GHSL schema invalid: tile_total_residents must be a finite non-negative number",
      );
    }
    const tileDelta = assertConservation(
      round2(totalAggregated),
      round2(declaredTileTotal),
      "GHSL tile cells",
    );

    return {
      sourceKey: GHSL_SOURCE_KEY,
      epochYear,
      datasetRelease,
      crsCode,
      resolutionM,
      publishedAt,
      cellsSeen,
      cellsOutsideAlgeria,
      cellsNodata: 0,
      totalSourceResidents: round2(declaredTileTotal),
      totalAggregatedResidents: round2(totalAggregated),
      tileConservationDelta: tileDelta,
      emptyTile: records.length === 0,
      records,
    };
  }

  if (!Array.isArray(obj["communes"])) {
    throw new Error("GHSL schema invalid: missing cells or communes array");
  }

  const byKey = new Map<string, GhslExposureRecord>();
  let cellsSeen = 0;
  let cellsOutsideAlgeria = 0;

  for (const raw of obj["communes"] as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("GHSL schema invalid: commune entry must be an object");
    }
    const item = raw as Record<string, unknown>;
    assertHonestExposureLabel(
      item["exposure_label"],
      item["is_live_occupancy"],
    );

    const { lat, lon } = validateCoordinates(item["lat"], item["lon"], "GHSL");
    const communeCodeRaw = item["commune_code"];
    if (typeof communeCodeRaw !== "string" || !communeCodeRaw.trim()) {
      throw new Error("GHSL schema invalid: missing commune_code");
    }
    const communeCode = communeCodeRaw.trim();
    const wilayaCode =
      typeof item["wilaya_code"] === "string" && item["wilaya_code"].trim()
        ? item["wilaya_code"].trim()
        : communeCode.slice(0, 2);

    const modeled = item["modeled_residents"];
    const sourceSum = item["source_cell_sum"];
    const cellCount = item["source_cell_count"];
    if (
      typeof modeled !== "number" ||
      !Number.isFinite(modeled) ||
      modeled < 0
    ) {
      throw new Error(
        "GHSL schema invalid: modeled_residents must be a finite non-negative number",
      );
    }
    if (
      typeof sourceSum !== "number" ||
      !Number.isFinite(sourceSum) ||
      sourceSum < 0
    ) {
      throw new Error(
        "GHSL schema invalid: source_cell_sum must be a finite non-negative number",
      );
    }
    if (
      typeof cellCount !== "number" ||
      !Number.isInteger(cellCount) ||
      cellCount < 0
    ) {
      throw new Error(
        "GHSL schema invalid: source_cell_count must be a non-negative integer",
      );
    }

    const delta = assertConservation(
      modeled,
      sourceSum,
      `commune ${communeCode}`,
    );

    cellsSeen += cellCount;
    if (!isInAlgeriaGhslBbox(lat, lon)) {
      cellsOutsideAlgeria += cellCount;
      continue;
    }

    if (byKey.has(communeCode)) {
      throw new Error(
        `GHSL schema invalid: duplicate commune_code "${communeCode}"`,
      );
    }

    byKey.set(communeCode, {
      sourceKey: GHSL_SOURCE_KEY,
      epochYear,
      datasetRelease,
      crsCode,
      resolutionM,
      exposureLabel: GHSL_EXPOSURE_LABEL,
      communeId: null,
      communeCode,
      wilayaCode,
      lat,
      lon,
      modeledResidents: round2(modeled),
      sourceCellSum: round2(sourceSum),
      sourceCellCount: cellCount,
      conservationDelta: delta,
      publishedAt,
      attribution: GHSL_ATTRIBUTION,
    });
  }

  const records = [...byKey.values()];
  const totalSourceResidents = records.reduce(
    (sum, rec) => sum + rec.sourceCellSum,
    0,
  );
  const totalAggregatedResidents = records.reduce(
    (sum, rec) => sum + rec.modeledResidents,
    0,
  );

  const declaredTileTotal =
    typeof obj["tile_total_residents"] === "number"
      ? obj["tile_total_residents"]
      : totalSourceResidents;
  if (!Number.isFinite(declaredTileTotal) || declaredTileTotal < 0) {
    throw new Error(
      "GHSL schema invalid: tile_total_residents must be a finite non-negative number",
    );
  }
  const tileDelta = assertConservation(
    round2(totalAggregatedResidents),
    round2(declaredTileTotal),
    "GHSL tile communes",
  );

  return {
    sourceKey: GHSL_SOURCE_KEY,
    epochYear,
    datasetRelease,
    crsCode,
    resolutionM,
    publishedAt,
    cellsSeen,
    cellsOutsideAlgeria,
    cellsNodata: 0,
    totalSourceResidents: round2(declaredTileTotal),
    totalAggregatedResidents: round2(totalAggregatedResidents),
    tileConservationDelta: tileDelta,
    emptyTile: records.length === 0,
    records,
  };
}

export async function parseGhslPayload(
  payload: string | ArrayBuffer | Uint8Array | Record<string, unknown>,
  options: {
    contentType?: string | null;
    geotiffMetadata?: GhslGeoTiffMetadata;
    communes?: readonly GhslCommuneRef[];
  } = {},
): Promise<GhslParseResult> {
  if (typeof payload === "string") {
    assertNotScientificUpstreamErrorBody(
      payload,
      options.contentType,
      "GHSL",
      "GHSL population payload",
    );
    let decoded: unknown;
    try {
      decoded = JSON.parse(payload);
    } catch {
      throw new Error("GHSL schema invalid: failed to parse JSON payload");
    }
    return parseGhslJson(decoded, { communes: options.communes });
  }

  if (payload instanceof ArrayBuffer || payload instanceof Uint8Array) {
    assertNotScientificUpstreamErrorBody(
      payload,
      options.contentType,
      "GHSL",
      "GHSL population payload",
    );
    const bytes =
      payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (isTiffMagicBytes(bytes)) {
      if (!options.geotiffMetadata) {
        throw new Error(
          "GHSL schema invalid: GeoTIFF payload requires epochYear, resolutionM, and publishedAt metadata",
        );
      }
      const ab =
        payload instanceof ArrayBuffer
          ? payload
          : new Uint8Array(payload).slice().buffer;
      return parseGhslGeoTiff(ab, options.geotiffMetadata, options.contentType);
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error(
        "GHSL schema invalid: binary payload is neither GeoTIFF nor JSON",
      );
    }
    return parseGhslJson(decoded, { communes: options.communes });
  }

  return parseGhslJson(payload, { communes: options.communes });
}
