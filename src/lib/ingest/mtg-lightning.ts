import { parseIsoTimestamp, validateCoordinates } from "./imerg";
import { assertNotScientificUpstreamErrorBody } from "./mtg-fci-push";

export const MTG_LIGHTNING_SOURCE_KEY = "mtg_lightning" as const;
export const MTG_LIGHTNING_ATTRIBUTION =
  "EUMETSAT MTG Lightning Imager L2 (lightning observation)" as const;

export const ALGERIA_LIGHTNING_BBOX = {
  south: 18.0,
  north: 38.5,
  west: -9.5,
  east: 13.0,
} as const;

export type MtgLightningProductType = "L2-LFL" | "L2-LGR" | "L2-AF";

const VALID_PRODUCT_TYPES = new Set<MtgLightningProductType>([
  "L2-LFL",
  "L2-LGR",
  "L2-AF",
]);

export type LightningObservation = {
  sourceKey: typeof MTG_LIGHTNING_SOURCE_KEY;
  observationKind: "lightning_observation";
  isWildfire: false;
  productType: MtgLightningProductType;
  flashId: string;
  observedAt: string;
  publishedAt: string;
  lat: number;
  lon: number;
  radianceUjM2: number | null;
  durationMs: number | null;
  groupCount: number | null;
  qualityState: "valid" | "degraded" | "flagged";
  attribution: string;
};

export type MtgLightningParseResult = {
  sourceKey: typeof MTG_LIGHTNING_SOURCE_KEY;
  upstreamPublishedAt: string;
  flashesSeen: number;
  flashesInAlgeria: number;
  flashesOutsideAlgeria: number;
  quietSlot: boolean;
  observations: LightningObservation[];
};

export function isInAlgeriaLightningBbox(lat: number, lon: number): boolean {
  return (
    lat >= ALGERIA_LIGHTNING_BBOX.south &&
    lat <= ALGERIA_LIGHTNING_BBOX.north &&
    lon >= ALGERIA_LIGHTNING_BBOX.west &&
    lon <= ALGERIA_LIGHTNING_BBOX.east
  );
}

function parseNonNegativeNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `MTG Lightning schema invalid: ${field} must be a finite number`,
    );
  }
  if (value < 0) {
    throw new Error(
      `MTG Lightning schema invalid: ${field} cannot be negative (${value})`,
    );
  }
  return value;
}

function parseQualityState(value: unknown): "valid" | "degraded" | "flagged" {
  if (value === undefined || value === null) return "valid";
  if (value === "valid" || value === "degraded" || value === "flagged") {
    return value;
  }
  throw new Error(
    `MTG Lightning schema invalid: invalid quality_state "${String(value)}"`,
  );
}

export function parseMtgLightningJson(
  payload: unknown,
): MtgLightningParseResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(
      "MTG Lightning schema invalid: expected JSON object payload",
    );
  }
  const obj = payload as Record<string, unknown>;

  if (obj["is_wildfire"] === true || obj["is_observed_wildfire"] === true) {
    throw new Error(
      "MTG Lightning schema invalid: lightning observation is not an observed wildfire",
    );
  }
  if (
    typeof obj["observation_kind"] === "string" &&
    obj["observation_kind"] !== "lightning_observation"
  ) {
    throw new Error(
      `MTG Lightning schema invalid: observation_kind must be lightning_observation, got "${obj["observation_kind"]}"`,
    );
  }

  // Capture pre-filter freshness watermark BEFORE Algeria bbox filtering
  let upstreamPublishedAt = parseIsoTimestamp(
    obj["published_at"] ??
      obj["publishedAt"] ??
      obj["sensing_time"] ??
      obj["observed_at"],
    "published_at",
    "MTG Lightning",
  );

  const defaultProductType = obj["product_type"] ?? obj["productType"];
  const rawItems = Array.isArray(obj["features"])
    ? obj["features"]
    : Array.isArray(obj["flashes"])
      ? obj["flashes"]
      : Array.isArray(obj["observations"])
        ? obj["observations"]
        : null;
  if (!rawItems) {
    throw new Error(
      "MTG Lightning schema invalid: missing features, flashes, or observations array",
    );
  }

  const byKey = new Map<string, LightningObservation>();
  let flashesSeen = 0;
  let flashesInAlgeria = 0;
  let flashesOutsideAlgeria = 0;

  for (const item of rawItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(
        "MTG Lightning schema invalid: flash entry must be an object",
      );
    }
    const entry = item as Record<string, unknown>;
    let props: Record<string, unknown> = entry;
    let latVal: unknown = entry["lat"];
    let lonVal: unknown = entry["lon"];

    if (entry["type"] === "Feature" || "geometry" in entry) {
      const geom = entry["geometry"] as Record<string, unknown> | undefined;
      if (
        !geom ||
        geom["type"] !== "Point" ||
        !Array.isArray(geom["coordinates"]) ||
        geom["coordinates"].length < 2
      ) {
        throw new Error(
          "MTG Lightning schema invalid: feature geometry must be a GeoJSON Point",
        );
      }
      lonVal = geom["coordinates"][0];
      latVal = geom["coordinates"][1];
      if (
        entry["properties"] &&
        typeof entry["properties"] === "object" &&
        !Array.isArray(entry["properties"])
      ) {
        props = entry["properties"] as Record<string, unknown>;
      }
    }

    if (
      props["is_wildfire"] === true ||
      props["is_observed_wildfire"] === true
    ) {
      throw new Error(
        "MTG Lightning schema invalid: lightning observation cannot be marked is_wildfire",
      );
    }
    if (
      typeof props["observation_kind"] === "string" &&
      props["observation_kind"] !== "lightning_observation"
    ) {
      throw new Error(
        `MTG Lightning schema invalid: observation_kind must be lightning_observation, got "${props["observation_kind"]}"`,
      );
    }

    const productTypeRaw = props["product_type"] ?? defaultProductType;
    if (
      typeof productTypeRaw !== "string" ||
      !VALID_PRODUCT_TYPES.has(productTypeRaw as MtgLightningProductType)
    ) {
      throw new Error(
        `MTG Lightning schema invalid: unsupported product_type "${String(productTypeRaw)}"`,
      );
    }
    const productType = productTypeRaw as MtgLightningProductType;

    const flashIdRaw = props["flash_id"] ?? props["id"];
    if (typeof flashIdRaw !== "string" || !flashIdRaw.trim()) {
      throw new Error("MTG Lightning schema invalid: missing flash_id");
    }
    const flashId = flashIdRaw.trim();

    const observedAt = parseIsoTimestamp(
      props["observed_at"] ?? props["sensing_time"],
      "observed_at",
      "MTG Lightning",
    );
    const publishedAt = parseIsoTimestamp(
      props["published_at"] ?? upstreamPublishedAt,
      "published_at",
      "MTG Lightning",
    );

    if (Date.parse(publishedAt) > Date.parse(upstreamPublishedAt)) {
      upstreamPublishedAt = publishedAt;
    }

    const { lat, lon } = validateCoordinates(latVal, lonVal, "MTG Lightning");
    const radianceUjM2 = parseNonNegativeNumber(
      props["radiance_uj_m2"] ?? props["radiance"],
      "radiance_uj_m2",
    );
    const durationRaw = parseNonNegativeNumber(
      props["duration_ms"] ?? props["duration"],
      "duration_ms",
    );
    const groupCountRaw = parseNonNegativeNumber(
      props["group_count"],
      "group_count",
    );
    const qualityState = parseQualityState(
      props["quality_state"] ?? props["quality_flag"],
    );

    flashesSeen += 1;
    if (!isInAlgeriaLightningBbox(lat, lon)) {
      flashesOutsideAlgeria += 1;
      continue;
    }
    flashesInAlgeria += 1;

    const dedupeKey = `${observedAt}:${flashId}`;
    byKey.set(dedupeKey, {
      sourceKey: MTG_LIGHTNING_SOURCE_KEY,
      observationKind: "lightning_observation",
      isWildfire: false,
      productType,
      flashId,
      observedAt,
      publishedAt,
      lat,
      lon,
      radianceUjM2,
      durationMs: durationRaw !== null ? Math.round(durationRaw) : null,
      groupCount: groupCountRaw !== null ? Math.round(groupCountRaw) : null,
      qualityState,
      attribution: MTG_LIGHTNING_ATTRIBUTION,
    });
  }

  const observations = [...byKey.values()];
  return {
    sourceKey: MTG_LIGHTNING_SOURCE_KEY,
    upstreamPublishedAt,
    flashesSeen,
    flashesInAlgeria,
    flashesOutsideAlgeria,
    quietSlot: observations.length === 0,
    observations,
  };
}

export function parseMtgLightningPayload(
  payload: string | ArrayBuffer | Uint8Array | Record<string, unknown>,
  options: { contentType?: string | null } = {},
): MtgLightningParseResult {
  if (typeof payload === "string") {
    assertNotScientificUpstreamErrorBody(
      payload,
      options.contentType,
      "MTG Lightning",
      "MTG LI L2 lightning feed",
    );
    let decoded: unknown;
    try {
      decoded = JSON.parse(payload);
    } catch {
      throw new Error(
        "MTG Lightning schema invalid: failed to parse JSON payload",
      );
    }
    return parseMtgLightningJson(decoded);
  }

  if (payload instanceof ArrayBuffer || payload instanceof Uint8Array) {
    assertNotScientificUpstreamErrorBody(
      payload,
      options.contentType,
      "MTG Lightning",
      "MTG LI L2 lightning feed",
    );
    const bytes =
      payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error(
        "MTG Lightning schema invalid: binary payload is not valid JSON",
      );
    }
    return parseMtgLightningJson(decoded);
  }

  return parseMtgLightningJson(payload);
}
