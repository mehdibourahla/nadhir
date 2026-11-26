import { haversineKm } from "@/lib/nadhir";

import { EMSC_MIN_MAGNITUDE } from "./emsc";
import { parseIsoTimestamp } from "./imerg";

export const CRAAG_SOURCE_KEY = "craag_earthquakes" as const;
export const CRAAG_DEFAULT_URL =
  "https://www.craag.dz/index.php/derniers-seismes/" as const;
export const CRAAG_ATTRIBUTION =
  "CRAAG (Centre de Recherche en Astronomie, Astrophysique et Geophysique)" as const;

export const CRAAG_MATCH_MAX_TIME_DIFF_SECONDS = 120;
export const CRAAG_MATCH_MAX_DISTANCE_KM = 50;
export const CRAAG_MATCH_MAX_MAGNITUDE_DIFF = 1.0;

// Algeria plus 100 km seismic margin (matches EMSC bounding box)
export const CRAAG_ALGERIA_BBOX = {
  south: 18.0,
  north: 38.5,
  west: -9.7,
  east: 13.0,
} as const;

export type CraagBulletin = {
  bulletinId: string;
  observedAt: string;
  lat: number;
  lon: number;
  depthKm: number | null;
  magnitude: number;
  magnitudeType: string | null;
  place: string;
  sourceUrl: string | null;
  attribution: string;
};

export type CraagParseResult = {
  bulletins: CraagBulletin[];
  allBulletinsCount: number;
  outsideCount: number;
  belowFloorCount: number;
  upstreamPublishedAt: string | null;
  emptyPage: boolean;
};

export type EmscMatchCandidate = {
  id: string;
  occurred_at: string;
  lat: number;
  lon: number;
  magnitude: number;
  network?: string | null;
};

export type CraagMatchResult = {
  earthquakeId: string;
  distanceKm: number;
  timeDiffSeconds: number;
  magnitudeDiff: number;
};

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (ch) => ARABIC_DIGITS[ch] ?? ch)
    .replace(/٬/g, "")
    .replace(/٫/g, ".");
}

const HTML_ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&deg;": "°",
};

function decodeHtmlEntities(input: string): string {
  return input.replace(
    /&(?:nbsp|amp|lt|gt|quot|deg);|&#(\d+);/gi,
    (match, decimalCode?: string) => {
      const named = HTML_ENTITY_MAP[match.toLowerCase()];
      if (named !== undefined) return named;
      if (decimalCode !== undefined) {
        return String.fromCharCode(Number(decimalCode));
      }
      return match;
    },
  );
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

const UPSTREAM_ERROR_HTML_RE =
  /just a moment\.\.\.|cf-browser-verification|captcha|g-recaptcha|service unavailable|503 service|502 bad gateway|504 gateway|temporarily unavailable|under maintenance|site en maintenance|الموقع في صيانة|access denied|403 forbidden|error establishing a database connection/i;

export function isCraagUpstreamErrorHtml(html: string): boolean {
  if (UPSTREAM_ERROR_HTML_RE.test(html)) return true;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    const title = stripTags(titleMatch[1]).toLowerCase();
    if (
      /^(?:403|404|500|502|503|504)\b|error|maintenance|attention required|just a moment/.test(
        title,
      )
    ) {
      return true;
    }
  }
  return false;
}

function resolveUrl(href: string | null, baseUrl: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || /^javascript:/i.test(trimmed)) {
    return null;
  }
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function buildValidatedCraagIso(
  yearStr: string,
  monthStr: string,
  dayStr: string,
  hourStr: string,
  minuteStr: string,
  secondStr: string,
  offset: "+01:00" | "Z",
  raw: string,
): string {
  const iso = `${yearStr}-${monthStr.padStart(2, "0")}-${dayStr.padStart(2, "0")}T${hourStr.padStart(2, "0")}:${minuteStr.padStart(2, "0")}:${secondStr.padStart(2, "0")}${offset}`;
  try {
    return parseIsoTimestamp(iso, "earthquake", "CRAAG");
  } catch {
    throw new Error(
      `CRAAG schema invalid: invalid calendar date in earthquake timestamp "${raw}"`,
    );
  }
}

export function parseCraagTimestamp(
  raw: string,
  defaultOffset: "+01:00" | "Z" = "+01:00",
): string {
  const cleaned = normalizeDigits(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) {
    throw new Error("CRAAG schema invalid: empty earthquake timestamp");
  }

  // ISO 8601 directly
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(cleaned)) {
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(cleaned);
    const iso = hasZone ? cleaned : `${cleaned}${defaultOffset}`;
    return parseIsoTimestamp(iso, "earthquake", "CRAAG");
  }

  const isAlgiers =
    /\b(?:cet|algiers|alg|loc(?:al|ale)?)\b|(?:gmt|utc)\s*\+\s*1\b|التوقيت\s*المحلي|محلي/i.test(
      cleaned,
    );
  const isUtc =
    !isAlgiers &&
    /(?:\b(?:utc|gmt|tu)\b(?!\s*[+-]\d))|توقيت\s*غرينتش|عالمي/i.test(cleaned);
  const offset = isAlgiers ? "+01:00" : isUtc ? "Z" : defaultOffset;

  // DD/MM/YYYY HH:MM(:SS)? or DD-MM-YYYY HH:MM(:SS)?
  const dmy = cleaned.match(
    /(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*(?:à|a|at|-|\s)?\s*(\d{1,2})[:h](\d{2})(?::(\d{2}))?/i,
  );
  if (dmy) {
    return buildValidatedCraagIso(
      dmy[3]!,
      dmy[2]!,
      dmy[1]!,
      dmy[4]!,
      dmy[5]!,
      dmy[6] ?? "00",
      offset,
      raw,
    );
  }

  // YYYY-MM-DD HH:MM(:SS)? or YYYY/MM/DD HH:MM(:SS)?
  const ymd = cleaned.match(
    /(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2})[:h](\d{2})(?::(\d{2}))?/i,
  );
  if (ymd) {
    return buildValidatedCraagIso(
      ymd[1]!,
      ymd[2]!,
      ymd[3]!,
      ymd[4]!,
      ymd[5]!,
      ymd[6] ?? "00",
      offset,
      raw,
    );
  }

  throw new Error(
    `CRAAG schema invalid: unparseable earthquake timestamp "${raw}"`,
  );
}

export function parseCraagCoordinate(
  raw: string | number,
  axis: "lat" | "lon",
): number {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw new Error(`CRAAG schema invalid: non-finite ${axis}`);
    }
    const max = axis === "lat" ? 90 : 180;
    if (raw < -max || raw > max) {
      throw new Error(
        `CRAAG schema invalid: out-of-range ${axis} coordinate ${raw}`,
      );
    }
    return raw;
  }

  const normalized = normalizeDigits(raw).replace(/,/g, ".").trim();
  const match = normalized.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!match?.[1]) {
    throw new Error(
      `CRAAG schema invalid: unparseable ${axis} coordinate "${raw}"`,
    );
  }
  let value = Number(match[1]);
  if (!Number.isFinite(value)) {
    throw new Error(`CRAAG schema invalid: non-finite ${axis} "${raw}"`);
  }
  if (axis === "lat") {
    if (/(?:(?<![A-Za-z])S(?![A-Za-z])|جنوبا|جنوب)/i.test(normalized)) {
      value = -Math.abs(value);
    } else if (/(?:(?<![A-Za-z])N(?![A-Za-z])|شمالا|شمال)/i.test(normalized)) {
      value = Math.abs(value);
    }
    if (value < -90 || value > 90) {
      throw new Error(`CRAAG schema invalid: out-of-range lat ${value}`);
    }
  } else {
    if (/(?:(?<![A-Za-z])[WO](?![A-Za-z])|غربا|غرب)/i.test(normalized)) {
      value = -Math.abs(value);
    } else if (/(?:(?<![A-Za-z])E(?![A-Za-z])|شرقا|شرق)/i.test(normalized)) {
      value = Math.abs(value);
    }
    if (value < -180 || value > 180) {
      throw new Error(`CRAAG schema invalid: out-of-range lon ${value}`);
    }
  }
  return Math.round(value * 10_000) / 10_000;
}

function parseCraagMagnitudeDetailed(raw: string | number): {
  rawMagnitude: number;
  magnitude: number;
  magnitudeType: string | null;
} {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0 || raw > 10) {
      throw new Error(`CRAAG schema invalid: invalid magnitude ${raw}`);
    }
    return {
      rawMagnitude: raw,
      magnitude: Math.round(raw * 10) / 10,
      magnitudeType: null,
    };
  }
  const normalized = normalizeDigits(raw).replace(/,/g, ".").trim();
  const typeMatch = normalized.match(/\b(M[lwdbv]|mb|Ms)\b/i);
  const numMatch = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch?.[1]) {
    throw new Error(`CRAAG schema invalid: unparseable magnitude "${raw}"`);
  }
  const rawMagnitude = Number(numMatch[1]);
  if (!Number.isFinite(rawMagnitude) || rawMagnitude < 0 || rawMagnitude > 10) {
    throw new Error(`CRAAG schema invalid: magnitude out of range "${raw}"`);
  }
  return {
    rawMagnitude,
    magnitude: Math.round(rawMagnitude * 10) / 10,
    magnitudeType: typeMatch?.[1] ?? null,
  };
}

export function parseCraagMagnitude(raw: string | number): {
  magnitude: number;
  magnitudeType: string | null;
} {
  const { magnitude, magnitudeType } = parseCraagMagnitudeDetailed(raw);
  return { magnitude, magnitudeType };
}

function parseDepthKm(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0 || raw > 700) {
      throw new Error(`CRAAG schema invalid: depth_km out of range ${raw}`);
    }
    return Math.round(raw * 10) / 10;
  }
  if (typeof raw === "string") {
    const trimmed = normalizeDigits(raw).replace(/,/g, ".").trim();
    if (!trimmed || /^[-?n/a]+$/i.test(trimmed)) return null;
    const match = trimmed.match(/(\d+(?:\.\d+)?)/);
    if (!match?.[1]) return null;
    const value = Math.round(Number(match[1]) * 10) / 10;
    if (!Number.isFinite(value) || value < 0 || value > 700) {
      throw new Error(`CRAAG schema invalid: depth_km out of range "${raw}"`);
    }
    return value;
  }
  return null;
}

function makeDeterministicBulletinId(
  explicitId: string | null,
  observedAt: string,
  lat: number,
  lon: number,
  magnitude: number,
): string {
  if (explicitId && explicitId.trim()) {
    return explicitId.trim().replace(/[^a-zA-Z0-9._:-]/g, "_");
  }
  const compactTime = observedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${compactTime}_${lat.toFixed(2)}_${lon.toFixed(2)}_m${magnitude.toFixed(1)}`;
}

function isInsideAlgeriaMargin(lat: number, lon: number): boolean {
  return (
    lat >= CRAAG_ALGERIA_BBOX.south &&
    lat <= CRAAG_ALGERIA_BBOX.north &&
    lon >= CRAAG_ALGERIA_BBOX.west &&
    lon <= CRAAG_ALGERIA_BBOX.east
  );
}

function maxObservedAt(bulletins: readonly CraagBulletin[]): string | null {
  let latestMs = Number.NEGATIVE_INFINITY;
  let latestIso: string | null = null;
  for (const b of bulletins) {
    const ms = Date.parse(b.observedAt);
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latestIso = new Date(ms).toISOString();
    }
  }
  return latestIso;
}

type ParsedCraagBulletin = {
  bulletin: CraagBulletin;
  rawMagnitude: number;
};

function finalizeBulletins(
  all: ParsedCraagBulletin[],
  minMagnitude: number,
): CraagParseResult {
  // Pre-filter freshness watermark BEFORE Algeria watch-area and M2+ filtering
  const upstreamPublishedAt = maxObservedAt(all.map((entry) => entry.bulletin));

  const kept: CraagBulletin[] = [];
  let outsideCount = 0;
  let belowFloorCount = 0;
  const seen = new Set<string>();

  for (const { bulletin: b, rawMagnitude } of all) {
    if (!isInsideAlgeriaMargin(b.lat, b.lon)) {
      outsideCount += 1;
      continue;
    }
    if (rawMagnitude < minMagnitude) {
      belowFloorCount += 1;
      continue;
    }
    if (seen.has(b.bulletinId)) continue;
    seen.add(b.bulletinId);
    kept.push(b);
  }

  return {
    bulletins: kept,
    allBulletinsCount: all.length,
    outsideCount,
    belowFloorCount,
    upstreamPublishedAt,
    emptyPage: all.length === 0,
  };
}

function parseJsonBulletins(
  data: unknown,
  baseUrl: string,
  minMagnitude: number,
): CraagParseResult {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? ((data as Record<string, unknown>)["bulletins"] ??
        (data as Record<string, unknown>)["events"] ??
        (data as Record<string, unknown>)["items"])
      : null;

  if (!Array.isArray(list)) {
    throw new Error(
      "CRAAG schema invalid: expected JSON array or { bulletins | events | items }",
    );
  }

  const parsed: ParsedCraagBulletin[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("CRAAG schema invalid: bulletin entry must be an object");
    }
    const item = entry as Record<string, unknown>;
    const rawTime =
      item["observed_at"] ??
      item["observedAt"] ??
      item["time"] ??
      item["datetime"] ??
      (typeof item["date"] === "string" && typeof item["heure"] === "string"
        ? `${item["date"]} ${item["heure"]}`
        : item["date"]);
    if (typeof rawTime !== "string") {
      throw new Error("CRAAG schema invalid: missing bulletin time");
    }
    const observedAt = parseCraagTimestamp(rawTime);
    const rawLat = item["lat"] ?? item["latitude"];
    const rawLon = item["lon"] ?? item["longitude"] ?? item["lng"];
    if (
      (typeof rawLat !== "number" && typeof rawLat !== "string") ||
      (typeof rawLon !== "number" && typeof rawLon !== "string")
    ) {
      throw new Error("CRAAG schema invalid: missing lat/lon coordinates");
    }
    const lat = parseCraagCoordinate(rawLat, "lat");
    const lon = parseCraagCoordinate(rawLon, "lon");

    const rawMag = item["magnitude"] ?? item["mag"];
    if (typeof rawMag !== "number" && typeof rawMag !== "string") {
      throw new Error("CRAAG schema invalid: missing magnitude");
    }
    const {
      rawMagnitude,
      magnitude,
      magnitudeType: parsedType,
    } = parseCraagMagnitudeDetailed(rawMag);
    const magnitudeType =
      typeof item["magnitude_type"] === "string"
        ? item["magnitude_type"]
        : typeof item["magnitudeType"] === "string"
          ? item["magnitudeType"]
          : parsedType;

    const depthKm = parseDepthKm(
      item["depth_km"] ??
        item["depthKm"] ??
        item["depth"] ??
        item["profondeur"],
    );
    const rawPlace =
      item["place"] ??
      item["region"] ??
      item["localisation"] ??
      item["location"];
    const place =
      typeof rawPlace === "string" && rawPlace.trim()
        ? rawPlace.trim()
        : "Algeria";

    const rawUrl = item["source_url"] ?? item["sourceUrl"] ?? item["url"];
    const sourceUrl =
      typeof rawUrl === "string" ? resolveUrl(rawUrl, baseUrl) : null;

    const rawId = item["bulletin_id"] ?? item["bulletinId"] ?? item["id"];
    const explicitId = typeof rawId === "string" ? rawId : null;
    const bulletinId = makeDeterministicBulletinId(
      explicitId,
      observedAt,
      lat,
      lon,
      magnitude,
    );

    parsed.push({
      rawMagnitude,
      bulletin: {
        bulletinId,
        observedAt,
        lat,
        lon,
        depthKm,
        magnitude,
        magnitudeType,
        place,
        sourceUrl,
        attribution: CRAAG_ATTRIBUTION,
      },
    });
  }

  return finalizeBulletins(parsed, minMagnitude);
}

type ColumnMap = {
  date?: number;
  time?: number;
  datetime?: number;
  magnitude?: number;
  lat?: number;
  lon?: number;
  depth?: number;
  place?: number;
  link?: number;
  defaultOffset: "+01:00" | "Z";
};

function detectColumnMap(headers: readonly string[]): ColumnMap | null {
  const map: ColumnMap = { defaultOffset: "+01:00" };
  let matchedCount = 0;

  headers.forEach((rawHeader, idx) => {
    const h = rawHeader.toLowerCase();
    const isAlgiersHeader =
      /(?:gmt|utc)\s*\+\s*1\b|heure\s*locale|التوقيت\s*المحلي/i.test(h);
    if (
      !isAlgiersHeader &&
      /(?:\b(?:utc|gmt|tu)\b(?!\s*[+-]\d))|غرينتش|عالمي/i.test(h)
    ) {
      map.defaultOffset = "Z";
    }
    if (
      /date.*(?:heure|time)|datetime|التاريخ\s*والساعة|تاريخ\s*ووقت/i.test(h)
    ) {
      map.datetime = idx;
      matchedCount += 1;
    } else if (/^(?:date|التاريخ|تاريخ)$/i.test(h) || /date|تاريخ/i.test(h)) {
      map.date = idx;
      matchedCount += 1;
    } else if (/heure|time|الساعة|الوقت|توقيت/i.test(h)) {
      map.time = idx;
      matchedCount += 1;
    } else if (/mag|القدر|الشدة|درجة|قوة/i.test(h)) {
      map.magnitude = idx;
      matchedCount += 1;
    } else if (/lat|خط\s*العرض|عرض/i.test(h)) {
      map.lat = idx;
      matchedCount += 1;
    } else if (/lon|lng|خط\s*الطول|طول/i.test(h)) {
      map.lon = idx;
      matchedCount += 1;
    } else if (/prof|depth|العمق|عمق/i.test(h)) {
      map.depth = idx;
      matchedCount += 1;
    } else if (
      /local|lieu|place|r[ée]gion|wilaya|الموقع|المنطقة|الولاية|المركز/i.test(h)
    ) {
      map.place = idx;
      matchedCount += 1;
    } else if (/bulletin|d[ée]tail|lien|النشرة|رابط/i.test(h)) {
      map.link = idx;
    }
  });

  const hasTime = map.datetime !== undefined || map.date !== undefined;
  const hasGeo = map.lat !== undefined && map.lon !== undefined;
  if (!hasTime || !hasGeo || map.magnitude === undefined || matchedCount < 4) {
    return null;
  }
  return map;
}

function extractHrefFromHtml(cellHtml: string): string | null {
  const match = cellHtml.match(/<a\b[^>]*href=["']([^"']+)["']/i);
  return match?.[1] ? decodeHtmlEntities(match[1]) : null;
}

function parseHtmlTables(
  html: string,
  baseUrl: string,
  minMagnitude: number,
): CraagParseResult {
  const tableMatches = [
    ...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi),
  ];
  if (!tableMatches.length) {
    throw new Error(
      "CRAAG schema invalid: no recognizable seismic bulletin table in HTML",
    );
  }

  let recognizedTable = false;
  const bulletins: ParsedCraagBulletin[] = [];

  for (const tableMatch of tableMatches) {
    const tableHtml = tableMatch[1] ?? "";
    const rowMatches = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (!rowMatches.length) continue;

    let columns: ColumnMap | null = null;
    for (const rowMatch of rowMatches) {
      const rowHtml = rowMatch[1] ?? "";
      const thCells = [
        ...rowHtml.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi),
      ].map((m) => stripTags(m[1] ?? ""));
      if (thCells.length >= 4 && !columns) {
        columns = detectColumnMap(thCells);
        if (columns) recognizedTable = true;
        continue;
      }

      const tdMatches = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
      if (!tdMatches.length) continue;
      const tdHtmls = tdMatches.map((m) => m[1] ?? "");
      const tdTexts = tdHtmls.map((cell) => stripTags(cell));

      if (!columns) {
        const inferred = detectColumnMap(tdTexts);
        if (inferred) {
          columns = inferred;
          recognizedTable = true;
          continue;
        }
        continue;
      }

      // Skip empty/placeholder "no earthquakes" single-cell colspan rows
      if (tdTexts.length < 4) continue;

      const rawTime =
        columns.datetime !== undefined
          ? (tdTexts[columns.datetime] ?? "")
          : [
              columns.date !== undefined ? (tdTexts[columns.date] ?? "") : "",
              columns.time !== undefined ? (tdTexts[columns.time] ?? "") : "",
            ]
              .filter(Boolean)
              .join(" ");

      const observedAt = parseCraagTimestamp(rawTime, columns.defaultOffset);
      const lat = parseCraagCoordinate(tdTexts[columns.lat!] ?? "", "lat");
      const lon = parseCraagCoordinate(tdTexts[columns.lon!] ?? "", "lon");
      const { rawMagnitude, magnitude, magnitudeType } =
        parseCraagMagnitudeDetailed(tdTexts[columns.magnitude!] ?? "");
      const depthKm =
        columns.depth !== undefined
          ? parseDepthKm(tdTexts[columns.depth])
          : null;
      const place =
        (columns.place !== undefined ? tdTexts[columns.place] : "")?.trim() ||
        "Algeria";

      const explicitHref =
        (columns.link !== undefined
          ? extractHrefFromHtml(tdHtmls[columns.link] ?? "")
          : null) ??
        tdHtmls.map(extractHrefFromHtml).find((href) => href !== null) ??
        null;
      const sourceUrl = resolveUrl(explicitHref, baseUrl);

      const idAttrMatch = rowMatch[0].match(
        /data-bulletin-id=["']([^"']+)["']/i,
      );
      const urlIdMatch = sourceUrl?.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      const explicitId = idAttrMatch?.[1] ?? urlIdMatch?.[1] ?? null;
      const bulletinId = makeDeterministicBulletinId(
        explicitId,
        observedAt,
        lat,
        lon,
        magnitude,
      );

      bulletins.push({
        rawMagnitude,
        bulletin: {
          bulletinId,
          observedAt,
          lat,
          lon,
          depthKm,
          magnitude,
          magnitudeType,
          place,
          sourceUrl,
          attribution: CRAAG_ATTRIBUTION,
        },
      });
    }
  }

  if (!recognizedTable) {
    throw new Error(
      "CRAAG schema invalid: HTML table columns do not match CRAAG seismic bulletin schema",
    );
  }

  return finalizeBulletins(bulletins, minMagnitude);
}

export type CraagSummaryRow = {
  explicitId: string | null;
  observedAt: string;
  magnitude: number;
  rawMagnitude: number;
  magnitudeType: string | null;
  place: string;
  sourceUrl: string | null;
};

export function parseCraagMapCoordinates(
  html: string,
): { lat: number; lon: number } | null {
  const patterns = [
    /L\.marker\(\s*\[\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\]/i,
    /\.setView\(\s*\[\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\]/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m?.[1] || !m?.[2]) continue;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    ) {
      return {
        lat: Math.round(lat * 10_000) / 10_000,
        lon: Math.round(lon * 10_000) / 10_000,
      };
    }
  }
  return null;
}

export function parseCraagSummaryTable(
  html: string,
  baseUrl: string = CRAAG_DEFAULT_URL,
): CraagSummaryRow[] | null {
  if (isCraagUpstreamErrorHtml(html)) {
    throw new Error(
      "CRAAG upstream returned maintenance, error, or challenge HTML page (HTTP 200)",
    );
  }
  const tableMatches = [
    ...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi),
  ];
  for (const tableMatch of tableMatches) {
    const tableHtml = tableMatch[1] ?? "";
    const rowMatches = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (!rowMatches.length) continue;

    let dateCol: number | undefined;
    let timeCol: number | undefined;
    let magCol: number | undefined;
    let placeCol: number | undefined;
    let linkCol: number | undefined;
    let defaultOffset: "+01:00" | "Z" = "+01:00";
    let matched = false;
    const rows: CraagSummaryRow[] = [];

    for (const rowMatch of rowMatches) {
      const rowHtml = rowMatch[1] ?? "";
      const thCells = [
        ...rowHtml.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi),
      ].map((m) => stripTags(m[1] ?? ""));
      if (thCells.length >= 4 && !matched) {
        thCells.forEach((rawH, idx) => {
          const h = rawH.toLowerCase();
          if (
            !/(?:utc|gmt|tu)\s*[+-]\s*\d/i.test(h) &&
            /(?:\b(?:utc|gmt|tu)\b)|غرينتش|عالمي/i.test(h)
          ) {
            defaultOffset = "Z";
          }
          if (/date|تاريخ/i.test(h)) dateCol = idx;
          else if (/heure|time|الساعة|الوقت/i.test(h)) timeCol = idx;
          else if (/mag|القدر|الشدة/i.test(h)) magCol = idx;
          else if (/local|lieu|place|r[ée]gion|wilaya|المنطقة|الولاية/i.test(h))
            placeCol = idx;
          else if (/carte|map|bulletin|d[ée]tail|lien|رابط/i.test(h))
            linkCol = idx;
        });
        if (
          dateCol !== undefined &&
          magCol !== undefined &&
          placeCol !== undefined &&
          linkCol !== undefined
        ) {
          matched = true;
        }
        continue;
      }
      if (!matched) continue;

      const tdMatches = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
      if (tdMatches.length < 4) continue;
      const tdHtmls = tdMatches.map((m) => m[1] ?? "");
      const tdTexts = tdHtmls.map((c) => stripTags(c));
      const rawTime = [
        tdTexts[dateCol!] ?? "",
        timeCol !== undefined ? (tdTexts[timeCol] ?? "") : "",
      ]
        .filter(Boolean)
        .join(" ");
      const observedAt = parseCraagTimestamp(rawTime, defaultOffset);
      const { rawMagnitude, magnitude, magnitudeType } =
        parseCraagMagnitudeDetailed(tdTexts[magCol!] ?? "");
      const place = (tdTexts[placeCol!] ?? "").trim() || "Algeria";
      const href =
        extractHrefFromHtml(tdHtmls[linkCol!] ?? "") ??
        tdHtmls.map(extractHrefFromHtml).find((u) => u !== null) ??
        null;
      const sourceUrl = resolveUrl(href, baseUrl);
      const idMatch = sourceUrl?.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      rows.push({
        explicitId: idMatch?.[1] ?? null,
        observedAt,
        magnitude,
        rawMagnitude,
        magnitudeType,
        place,
        sourceUrl,
      });
    }
    if (matched) return rows;
  }
  return null;
}

export function buildCraagParseResultFromResolved(
  rows: readonly {
    summary: CraagSummaryRow;
    lat: number;
    lon: number;
  }[],
  minMagnitude: number = EMSC_MIN_MAGNITUDE,
): CraagParseResult {
  const parsed: ParsedCraagBulletin[] = rows.map(({ summary, lat, lon }) => ({
    rawMagnitude: summary.rawMagnitude,
    bulletin: {
      bulletinId: makeDeterministicBulletinId(
        summary.explicitId,
        summary.observedAt,
        lat,
        lon,
        summary.magnitude,
      ),
      observedAt: summary.observedAt,
      lat,
      lon,
      depthKm: null,
      magnitude: summary.magnitude,
      magnitudeType: summary.magnitudeType,
      place: summary.place,
      sourceUrl: summary.sourceUrl,
      attribution: CRAAG_ATTRIBUTION,
    },
  }));
  return finalizeBulletins(parsed, minMagnitude);
}

export function parseCraagBulletins(
  payload: string | Record<string, unknown> | unknown[],
  options: {
    contentType?: string | null;
    baseUrl?: string;
    minMagnitude?: number;
  } = {},
): CraagParseResult {
  const baseUrl = options.baseUrl ?? CRAAG_DEFAULT_URL;
  const minMagnitude = options.minMagnitude ?? EMSC_MIN_MAGNITUDE;

  if (typeof payload !== "string") {
    return parseJsonBulletins(payload, baseUrl, minMagnitude);
  }

  const trimmed = payload.trim();
  if (!trimmed) {
    throw new Error("CRAAG upstream returned empty response body");
  }

  const ct = (options.contentType ?? "").toLowerCase();
  if (
    ct.includes("application/json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(trimmed);
    } catch {
      throw new Error("CRAAG schema invalid: failed to parse JSON bulletins");
    }
    return parseJsonBulletins(decoded, baseUrl, minMagnitude);
  }

  if (isCraagUpstreamErrorHtml(trimmed)) {
    throw new Error(
      "CRAAG upstream returned maintenance, error, or challenge HTML page (HTTP 200)",
    );
  }

  return parseHtmlTables(trimmed, baseUrl, minMagnitude);
}

export function matchCraagToEmsc(
  bulletin: CraagBulletin,
  candidates: readonly EmscMatchCandidate[],
  tolerances: {
    maxTimeDiffSeconds?: number;
    maxDistanceKm?: number;
    maxMagnitudeDiff?: number;
  } = {},
): CraagMatchResult | null {
  const maxTimeSec =
    tolerances.maxTimeDiffSeconds ?? CRAAG_MATCH_MAX_TIME_DIFF_SECONDS;
  const maxDistKm = tolerances.maxDistanceKm ?? CRAAG_MATCH_MAX_DISTANCE_KM;
  const maxMagDiff =
    tolerances.maxMagnitudeDiff ?? CRAAG_MATCH_MAX_MAGNITUDE_DIFF;

  const bulletinMs = Date.parse(bulletin.observedAt);
  if (!Number.isFinite(bulletinMs)) return null;

  const matches: CraagMatchResult[] = [];

  for (const candidate of candidates) {
    // Never match against standalone CRAAG synthetic rows
    if (candidate.id.startsWith("craag:")) continue;
    const candidateMs = Date.parse(candidate.occurred_at);
    if (!Number.isFinite(candidateMs)) continue;

    const timeDiffSeconds = Math.abs(bulletinMs - candidateMs) / 1000;
    if (timeDiffSeconds > maxTimeSec) continue;

    const distanceKm = haversineKm(
      bulletin.lat,
      bulletin.lon,
      candidate.lat,
      candidate.lon,
    );
    if (distanceKm > maxDistKm) continue;

    const magnitudeDiff =
      Math.round(Math.abs(bulletin.magnitude - candidate.magnitude) * 10) / 10;
    if (magnitudeDiff > maxMagDiff) continue;

    matches.push({
      earthquakeId: candidate.id,
      distanceKm: Math.round(distanceKm * 100) / 100,
      timeDiffSeconds: Math.round(timeDiffSeconds * 10) / 10,
      magnitudeDiff,
    });
  }

  if (!matches.length) return null;

  // Deterministic tiebreak: smallest distance, then smallest time delta, then smallest mag delta, then lexical ID
  matches.sort((a, b) => {
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    if (a.timeDiffSeconds !== b.timeDiffSeconds) {
      return a.timeDiffSeconds - b.timeDiffSeconds;
    }
    if (a.magnitudeDiff !== b.magnitudeDiff) {
      return a.magnitudeDiff - b.magnitudeDiff;
    }
    return a.earthquakeId.localeCompare(b.earthquakeId);
  });

  return matches[0] ?? null;
}
