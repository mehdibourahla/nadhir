import { isInWatchArea } from "./geo";
import {
  isTiffMagicBytes,
  parseIsoTimestamp,
  validateCoordinates,
} from "./imerg";

export const MTG_FCI_PUSH_SOURCE_KEY = "mtg_fci_push" as const;
export const MTG_FCI_PUSH_FALLBACK_CONTRACT = "fci" as const;
export const MTG_FCI_PUSH_ATTRIBUTION =
  "EUMETSAT MTG FCI L2P FRP (push)" as const;

export const MTG_FCI_PUSH_WATCH_BBOX = {
  south: 18.9,
  north: 37.6,
  west: -8.7,
  east: 12.0,
} as const;

const MAX_FRP_MW = 50_000;

const HTML_OR_XML_PREFIX =
  /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<\?xml\b|<(?:[a-z0-9_-]+:)?(?:serviceexceptionreport|exceptionreport|error)\b)/i;

const PLAIN_ERROR_TEXT =
  /^\s*(?:error\b|service unavailable|bad gateway|gateway timeout|access denied|unauthorized|forbidden|maintenance|temporarily unavailable|too many requests|50[0234]\b|40[134]\b)/i;

const PROHIBITED_PR31_KEYS = [
  "spread_bearing_deg",
  "rotated_bearing",
  "terrain_rotated_bearing",
  "burn_circle_m",
  "burn_radius_m",
  "fuel_recovery_curve",
  "recovery_factor",
  "logistic_calibration",
  "calibrated_probability",
] as const;

export type MtgFciPushDetectionRow = {
  source: "fci";
  sensor: "FCI";
  detected_at: string;
  lat: number;
  lon: number;
  confidence_raw: number;
  frp_mw: number | null;
  daynight: "D" | "N" | null;
  natural_key: string;
  intake_channel: "push";
  push_product_id: string;
  push_received_at: string;
};

export type MtgFciPushDeliveryAudit = {
  productId: string;
  slotTime: string;
  publishedAt: string;
  receivedAt: string;
  latencySeconds: number;
  pixelsSeen: number;
  pixelsStored: number;
  pixelsFiltered: number;
  fallbackContractKey: "fci";
  qualityState: "valid" | "degraded" | "flagged";
  attribution: string;
};

export type MtgFciPushParseResult = {
  sourceKey: typeof MTG_FCI_PUSH_SOURCE_KEY;
  productId: string;
  slotTime: string;
  upstreamPublishedAt: string;
  receivedAt: string;
  latencySeconds: number;
  qualityState: "valid" | "degraded" | "flagged";
  pixelsSeen: number;
  pixelsOutsideWatchBox: number;
  pixelsFilteredWatchArea: number;
  emptySlot: boolean;
  rows: MtgFciPushDetectionRow[];
};

const UPSTREAM_ERROR_SAMPLE_BYTES = 4096;

const PRODUCT_ID_METADATA_KEYS = [
  "product_id",
  "productId",
  "collection_id",
  "collectionId",
] as const;

const PRODUCT_LEVEL_METADATA_KEYS = ["product_level", "productLevel"] as const;

function isInMtgFciPushWatchBbox(lat: number, lon: number): boolean {
  return (
    lat >= MTG_FCI_PUSH_WATCH_BBOX.south &&
    lat <= MTG_FCI_PUSH_WATCH_BBOX.north &&
    lon >= MTG_FCI_PUSH_WATCH_BBOX.west &&
    lon <= MTG_FCI_PUSH_WATCH_BBOX.east
  );
}

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

export function assertNotScientificUpstreamErrorBody(
  body: string | ArrayBuffer | Uint8Array,
  contentType: string | null | undefined,
  sourceName: string,
  dataKind: string,
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
      `${sourceName} upstream returned error content-type (${ct.split(";")[0]?.trim() || "text"})`,
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
      `${sourceName} upstream returned HTML/XML error page instead of ${dataKind}`,
    );
  }
  if (PLAIN_ERROR_TEXT.test(sample)) {
    throw new Error(
      `${sourceName} upstream returned plain-text error response instead of ${dataKind}`,
    );
  }
}

function assertNoProhibitedPr31Fields(
  record: Record<string, unknown>,
  sourceName: string,
): void {
  for (const key of PROHIBITED_PR31_KEYS) {
    if (key in record && record[key] !== undefined && record[key] !== null) {
      throw new Error(
        `${sourceName} schema invalid: prohibited PR #31 field "${key}" rejected`,
      );
    }
  }
}

function assertNoProhibitedMtgFciMetadata(
  record: Record<string, unknown>,
): void {
  const source = record["source"];
  if (
    typeof source === "string" &&
    source.trim().toLowerCase() === "eumetsat_fci"
  ) {
    throw new Error(
      "MTG FCI push schema invalid: unsupported source eumetsat_fci is prohibited",
    );
  }

  for (const key of PRODUCT_LEVEL_METADATA_KEYS) {
    const level = record[key];
    if (typeof level === "string" && /l1c/i.test(level.trim())) {
      throw new Error(
        "MTG FCI push schema invalid: L1c radiance product is prohibited; L2P FRP required",
      );
    }
  }

  for (const key of PRODUCT_ID_METADATA_KEYS) {
    const val = record[key];
    if (
      typeof val === "string" &&
      (/0665/i.test(val.trim()) || /l1c/i.test(val.trim()))
    ) {
      throw new Error(
        "MTG FCI push schema invalid: L1c product EO:EUM:DAT:0665 is prohibited; use L2P FRP (EO:EUM:DAT:0662)",
      );
    }
  }
}

export function validateMtgFciPushProductId(
  productId: unknown,
  productLevel?: unknown,
  declaredSource?: unknown,
): string {
  if (
    typeof declaredSource === "string" &&
    declaredSource.trim().toLowerCase() === "eumetsat_fci"
  ) {
    throw new Error(
      "MTG FCI push schema invalid: unsupported source eumetsat_fci is prohibited",
    );
  }

  if (typeof productLevel === "string" && /l1c/i.test(productLevel.trim())) {
    throw new Error(
      "MTG FCI push schema invalid: L1c radiance product is prohibited; L2P FRP required",
    );
  }

  if (typeof productId !== "string" || !productId.trim()) {
    throw new Error("MTG FCI push schema invalid: missing product_id");
  }

  const trimmed = productId.trim();
  if (
    /0665/i.test(trimmed) ||
    /\bl1c\b/i.test(trimmed) ||
    /_l1c/i.test(trimmed) ||
    /-l1c/i.test(trimmed)
  ) {
    throw new Error(
      "MTG FCI push schema invalid: L1c product EO:EUM:DAT:0665 is prohibited; use L2P FRP (EO:EUM:DAT:0662)",
    );
  }

  const looksLikeL2Frp =
    /EO:EUM:DAT:0662/i.test(trimmed) ||
    /FCI[-_ ]?L2P?[-_ ]?FRP/i.test(trimmed) ||
    /L2P[-_ ]?FRP/i.test(trimmed);
  if (!looksLikeL2Frp) {
    throw new Error(
      `MTG FCI push schema invalid: unrecognized L2P FRP product_id "${trimmed}"`,
    );
  }

  return trimmed;
}

function normalizeSlotString(value: string): string {
  return parseIsoTimestamp(value, "slot", "MTG FCI push").replace(
    /\.\d{3}Z$/,
    "Z",
  );
}

function parsePixelEntry(
  raw: unknown,
  defaultSlot: string,
  productId: string,
  receivedAt: string,
): {
  lat: number;
  lon: number;
  slot: string;
  detectedAt: string;
  confidenceRaw: number;
  frpMw: number | null;
  daynight: "D" | "N" | null;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "MTG FCI push schema invalid: pixel or feature entry must be an object",
    );
  }
  const entry = raw as Record<string, unknown>;
  assertNoProhibitedPr31Fields(entry, "MTG FCI push");
  assertNoProhibitedMtgFciMetadata(entry);

  let props: Record<string, unknown> = entry;
  let latVal: unknown = entry["lat"];
  let lonVal: unknown = entry["lon"];

  if (entry["type"] === "Feature" || "geometry" in entry) {
    const geom = entry["geometry"] as Record<string, unknown> | undefined;
    if (
      !geom ||
      geom["type"] !== "Point" ||
      !Array.isArray(geom["coordinates"])
    ) {
      throw new Error(
        "MTG FCI push schema invalid: feature geometry must be a GeoJSON Point",
      );
    }
    const coords = geom["coordinates"] as unknown[];
    if (coords.length < 2) {
      throw new Error(
        "MTG FCI push schema invalid: feature Point coordinates incomplete",
      );
    }
    lonVal = coords[0];
    latVal = coords[1];
    if (
      entry["properties"] &&
      typeof entry["properties"] === "object" &&
      !Array.isArray(entry["properties"])
    ) {
      props = entry["properties"] as Record<string, unknown>;
      assertNoProhibitedPr31Fields(props, "MTG FCI push");
      assertNoProhibitedMtgFciMetadata(props);
    }
  }

  const { lat, lon } = validateCoordinates(latVal, lonVal, "MTG FCI push");

  const rawSlot = props["time"] ?? props["slot_time"] ?? defaultSlot;
  if (typeof rawSlot !== "string" || !rawSlot.trim()) {
    throw new Error("MTG FCI push schema invalid: missing pixel slot time");
  }
  const slot = normalizeSlotString(rawSlot);

  const rawDatetime = props["Datetime"] ?? props["detected_at"];
  let detectedAt: string;
  if (typeof rawDatetime === "string" && rawDatetime.trim()) {
    const candidate =
      rawDatetime.trim().endsWith("Z") || rawDatetime.includes("+")
        ? rawDatetime.trim().replace(" ", "T")
        : `${rawDatetime.trim().replace(" ", "T")}Z`;
    detectedAt = parseIsoTimestamp(candidate, "detected_at", "MTG FCI push");
  } else {
    detectedAt = parseIsoTimestamp(slot, "detected_at", "MTG FCI push");
  }

  const rawConf = props["Confidence"] ?? props["confidence"];
  let confidenceRaw = 0.5;
  if (rawConf !== undefined && rawConf !== null) {
    if (typeof rawConf !== "number" || !Number.isFinite(rawConf)) {
      throw new Error(
        "MTG FCI push schema invalid: confidence must be a finite number",
      );
    }
    if (rawConf < 0 || rawConf > 100) {
      throw new Error(
        `MTG FCI push schema invalid: confidence out of range (${rawConf})`,
      );
    }
    confidenceRaw = Math.max(0, Math.min(1, rawConf / 100));
  }

  const rawFrp = props["FRP"] ?? props["frp_mw"];
  let frpMw: number | null = null;
  if (rawFrp !== undefined && rawFrp !== null) {
    if (typeof rawFrp !== "number" || !Number.isFinite(rawFrp)) {
      throw new Error(
        "MTG FCI push schema invalid: FRP must be a finite number",
      );
    }
    if (rawFrp < 0 || rawFrp > MAX_FRP_MW) {
      throw new Error(
        `MTG FCI push schema invalid: FRP out of physical bounds (${rawFrp} MW)`,
      );
    }
    frpMw = rawFrp;
  }

  const rawSza = props["SZA"] ?? props["sza"];
  let daynight: "D" | "N" | null = null;
  if (rawSza !== undefined && rawSza !== null) {
    if (typeof rawSza !== "number" || !Number.isFinite(rawSza)) {
      throw new Error(
        "MTG FCI push schema invalid: SZA must be a finite number",
      );
    }
    daynight = rawSza < 90 ? "D" : "N";
  } else if (props["daynight"] === "D" || props["daynight"] === "N") {
    daynight = props["daynight"];
  }

  // Ensure productId and receivedAt are kept consistent
  void productId;
  void receivedAt;

  return { lat, lon, slot, detectedAt, confidenceRaw, frpMw, daynight };
}

export function buildCanonicalFciNaturalKey(
  lat: number,
  lon: number,
  slot: string,
): string {
  return `fci:FCI:${lat.toFixed(5)}:${lon.toFixed(5)}:${slot}`;
}

export function parseMtgFciPushJson(
  payload: unknown,
  options: { receivedAt?: string | undefined } = {},
): MtgFciPushParseResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(
      "MTG FCI push schema invalid: expected JSON object payload",
    );
  }
  const obj = payload as Record<string, unknown>;
  assertNoProhibitedPr31Fields(obj, "MTG FCI push");
  assertNoProhibitedMtgFciMetadata(obj);

  const productId = validateMtgFciPushProductId(
    obj["product_id"] ??
      obj["productId"] ??
      obj["collection_id"] ??
      obj["collectionId"],
    obj["product_level"] ?? obj["productLevel"],
    obj["source"],
  );

  // Capture pre-filter freshness watermark BEFORE any watch-box / watch-area filtering
  const slotTime = normalizeSlotString(
    parseIsoTimestamp(
      obj["slot_time"] ?? obj["sensing_slot"] ?? obj["slotTime"],
      "slot_time",
      "MTG FCI push",
    ),
  );
  let upstreamPublishedAt = parseIsoTimestamp(
    obj["published_at"] ?? obj["publishedAt"] ?? slotTime,
    "published_at",
    "MTG FCI push",
  );
  const receivedAt = parseIsoTimestamp(
    obj["received_at"] ??
      obj["receivedAt"] ??
      options.receivedAt ??
      upstreamPublishedAt,
    "received_at",
    "MTG FCI push",
  );

  const rawItems = Array.isArray(obj["features"])
    ? obj["features"]
    : Array.isArray(obj["pixels"])
      ? obj["pixels"]
      : null;
  if (!rawItems) {
    throw new Error(
      "MTG FCI push schema invalid: missing features or pixels array",
    );
  }

  const qualityState: "valid" | "degraded" | "flagged" =
    obj["quality_state"] === "degraded" || obj["quality_state"] === "flagged"
      ? obj["quality_state"]
      : "valid";

  const byKey = new Map<string, MtgFciPushDetectionRow>();
  let pixelsSeen = 0;
  let pixelsOutsideWatchBox = 0;
  let pixelsFilteredWatchArea = 0;
  let swappedCandidates = 0;

  for (const item of rawItems) {
    const parsed = parsePixelEntry(item, slotTime, productId, receivedAt);
    pixelsSeen += 1;

    // Advance pre-filter watermark before spatial filtering
    const itemIso = parseIsoTimestamp(parsed.slot, "slot", "MTG FCI push");
    if (Date.parse(itemIso) > Date.parse(upstreamPublishedAt)) {
      upstreamPublishedAt = itemIso;
    }

    if (!isInMtgFciPushWatchBbox(parsed.lat, parsed.lon)) {
      pixelsOutsideWatchBox += 1;
      if (isInMtgFciPushWatchBbox(parsed.lon, parsed.lat)) {
        swappedCandidates += 1;
      }
      continue;
    }

    if (!isInWatchArea(parsed.lat, parsed.lon)) {
      pixelsFilteredWatchArea += 1;
      continue;
    }

    const naturalKey = buildCanonicalFciNaturalKey(
      parsed.lat,
      parsed.lon,
      parsed.slot,
    );

    byKey.set(naturalKey, {
      source: "fci",
      sensor: "FCI",
      detected_at: parsed.detectedAt,
      lat: parsed.lat,
      lon: parsed.lon,
      confidence_raw: parsed.confidenceRaw,
      frp_mw: parsed.frpMw,
      daynight: parsed.daynight,
      natural_key: naturalKey,
      intake_channel: "push",
      push_product_id: productId,
      push_received_at: receivedAt,
    });
  }

  const rows = [...byKey.values()];
  if (
    pixelsSeen > 0 &&
    rows.length === 0 &&
    pixelsFilteredWatchArea === 0 &&
    swappedCandidates === pixelsSeen
  ) {
    throw new Error(
      "MTG FCI push schema invalid: every feature fell outside Algeria watch box (axis order changed)",
    );
  }

  const latencySeconds = Math.max(
    0,
    Math.round((Date.parse(receivedAt) - Date.parse(slotTime)) / 1000),
  );

  return {
    sourceKey: MTG_FCI_PUSH_SOURCE_KEY,
    productId,
    slotTime,
    upstreamPublishedAt,
    receivedAt,
    latencySeconds,
    qualityState,
    pixelsSeen,
    pixelsOutsideWatchBox,
    pixelsFilteredWatchArea,
    emptySlot: rows.length === 0,
    rows,
  };
}

export function parseMtgFciPushPayload(
  payload: string | ArrayBuffer | Uint8Array | Record<string, unknown>,
  options: { contentType?: string | null; receivedAt?: string } = {},
): MtgFciPushParseResult {
  if (typeof payload === "string") {
    assertNotScientificUpstreamErrorBody(
      payload,
      options.contentType,
      "MTG FCI push",
      "L2P FRP push feed",
    );
    let decoded: unknown;
    try {
      decoded = JSON.parse(payload);
    } catch {
      throw new Error(
        "MTG FCI push schema invalid: failed to parse JSON payload",
      );
    }
    return parseMtgFciPushJson(decoded, { receivedAt: options.receivedAt });
  }

  if (payload instanceof ArrayBuffer || payload instanceof Uint8Array) {
    assertNotScientificUpstreamErrorBody(
      payload,
      options.contentType,
      "MTG FCI push",
      "L2P FRP push feed",
    );
    const bytes =
      payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error(
        "MTG FCI push schema invalid: binary payload is not valid JSON",
      );
    }
    return parseMtgFciPushJson(decoded, { receivedAt: options.receivedAt });
  }

  return parseMtgFciPushJson(payload, { receivedAt: options.receivedAt });
}

export function parseEumetsatFciCapXml(
  xml: string,
  options: { productId: string; receivedAt?: string },
): MtgFciPushParseResult {
  const trimmed = xml.trim();
  if (
    !trimmed.includes("<alert") ||
    !trimmed.includes("urn:oasis:names:tc:emergency:cap:")
  ) {
    throw new Error(
      "MTG FCI push schema invalid: expected EUMETSAT CAP XML fire detection alert",
    );
  }
  const receivedAt = parseIsoTimestamp(
    options.receivedAt ?? new Date().toISOString(),
    "received_at",
    "MTG FCI push",
  );
  const sentMatch = trimmed.match(/<sent>([^<]+)<\/sent>/i);
  const effectiveMatch = trimmed.match(/<effective>([^<]+)<\/effective>/i);
  const slotTime = parseIsoTimestamp(
    effectiveMatch?.[1] ?? sentMatch?.[1],
    "slot_time",
    "MTG FCI push",
  );
  const upstreamPublishedAt = parseIsoTimestamp(
    sentMatch?.[1] ?? slotTime,
    "published_at",
    "MTG FCI push",
  );

  const byKey = new Map<string, MtgFciPushDetectionRow>();
  let pixelsSeen = 0;
  let pixelsOutsideWatchBox = 0;
  let pixelsFilteredWatchArea = 0;

  for (const infoMatch of trimmed.matchAll(
    /<info\b[^>]*>([\s\S]*?)<\/info>/gi,
  )) {
    const infoBlock = infoMatch[1] ?? "";
    const certainty = (
      infoBlock.match(/<certainty>([^<]+)<\/certainty>/i)?.[1] ?? ""
    )
      .trim()
      .toLowerCase();
    const confidenceRaw =
      certainty === "observed" ? 0.95 : certainty === "likely" ? 0.85 : 0.6;
    const infoEff = infoBlock.match(/<effective>([^<]+)<\/effective>/i)?.[1];
    const detectedAt = infoEff
      ? parseIsoTimestamp(infoEff, "detected_at", "MTG FCI push")
      : slotTime;

    for (const circleMatch of infoBlock.matchAll(
      /<circle>([^<]+)<\/circle>/gi,
    )) {
      const pair = (circleMatch[1] ?? "").trim().split(/\s+/)[0] ?? "";
      const [latStr, lonStr] = pair.split(",");
      const lat = Number(latStr);
      const lon = Number(lonStr);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        continue;
      }
      pixelsSeen += 1;
      if (!isInMtgFciPushWatchBbox(lat, lon)) {
        pixelsOutsideWatchBox += 1;
        continue;
      }
      if (!isInWatchArea(lat, lon)) {
        pixelsFilteredWatchArea += 1;
        continue;
      }
      const naturalKey = buildCanonicalFciNaturalKey(lat, lon, detectedAt);
      const existing = byKey.get(naturalKey);
      if (!existing || confidenceRaw > existing.confidence_raw) {
        byKey.set(naturalKey, {
          source: "fci",
          sensor: "FCI",
          detected_at: detectedAt,
          lat: Math.round(lat * 100_000) / 100_000,
          lon: Math.round(lon * 100_000) / 100_000,
          confidence_raw: confidenceRaw,
          frp_mw: null,
          daynight: null,
          natural_key: naturalKey,
          intake_channel: "push",
          push_product_id: options.productId,
          push_received_at: receivedAt,
        });
      }
    }
  }

  const rows = [...byKey.values()];
  const latencySeconds = Math.max(
    0,
    Math.round((Date.parse(receivedAt) - Date.parse(slotTime)) / 1000),
  );

  return {
    sourceKey: MTG_FCI_PUSH_SOURCE_KEY,
    productId: options.productId,
    slotTime,
    upstreamPublishedAt,
    receivedAt,
    latencySeconds,
    qualityState: "valid",
    pixelsSeen,
    pixelsOutsideWatchBox,
    pixelsFilteredWatchArea,
    emptySlot: rows.length === 0,
    rows,
  };
}
