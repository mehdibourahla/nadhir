import type { Geometry, Position } from "geojson";

import { parseAnyLocaleParam } from "@/i18n/locale-cookie";
import { LOCALES, type AnyLocale, type Locale } from "@/i18n/locales-list";
import type { Earthquake } from "@/lib/earthquakes";
import {
  fireLevel,
  type FireContext,
  type FireLevel,
} from "@/lib/fire-confidence";
import { classifyOnmEvent } from "@/lib/forecast-outlook";
import {
  HAZARD_NAME,
  fireStage,
  intlLocale,
  unitName,
  type FireCluster,
  type OfficialIncident,
  type OnmVigilance,
} from "@/lib/nadhir";
import { isFireKind } from "@/lib/text-sources/merge";
import type { WilayaSnapshot } from "@/lib/wilaya-data";
import { wilayaName } from "@/lib/wilaya-slugs";
import { ONM_SEVERITY } from "@/lib/zone-hazards";

export const SITE_URL = "https://nadhir.app";

export const SHARE_FORMATS = {
  story: { width: 1080, height: 1920, type: "png" },
  post: { width: 1080, height: 1350, type: "png" },
  sticker: { width: 960, height: 600, type: "png" },
  og: { width: 1200, height: 630, type: "jpeg" },
} as const;
export type ShareFormat = keyof typeof SHARE_FORMATS;

export const isShareFormat = (value: string): value is ShareFormat =>
  Object.hasOwn(SHARE_FORMATS, value);

export const SHARE_KINDS = [
  "incident",
  "onm",
  "fire",
  "quake",
  "wilaya",
] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export const isShareKind = (value: string): value is ShareKind =>
  (SHARE_KINDS as readonly string[]).includes(value);

export type ShareImageCodec = "webp" | "jpeg" | "png";

export const UNIVERSAL_SHARE_FORMATS = {
  whatsapp: {
    width: 800,
    height: 418,
    defaultCodec: "webp" as ShareImageCodec,
    omitBackground: false,
  },
  facebook: {
    width: 1200,
    height: 630,
    defaultCodec: "webp" as ShareImageCodec,
    omitBackground: false,
  },
  og: {
    width: 1200,
    height: 630,
    defaultCodec: "jpeg" as ShareImageCodec,
    omitBackground: false,
  },
  post: {
    width: 1080,
    height: 1080,
    defaultCodec: "png" as ShareImageCodec,
    omitBackground: false,
  },
  story: {
    width: 1080,
    height: 1920,
    defaultCodec: "png" as ShareImageCodec,
    omitBackground: false,
  },
  sticker: {
    width: 512,
    height: 512,
    defaultCodec: "png" as ShareImageCodec,
    omitBackground: true,
  },
} as const;
export type UniversalShareFormat = keyof typeof UNIVERSAL_SHARE_FORMATS;

export const isUniversalShareFormat = (
  value: string,
): value is UniversalShareFormat =>
  Object.hasOwn(UNIVERSAL_SHARE_FORMATS, value);

/** Hard 37 KB ceiling for WhatsApp / Facebook share cards (37 * 1024 bytes). */
export const MAX_SHARE_CARD_BYTES = 37_888;

export const UNIVERSAL_CARD_REVISION = 2;

export const shareLocale = (value: string | null | undefined): Locale =>
  (LOCALES as readonly string[]).includes(value ?? "")
    ? (value as Locale)
    : "ar";

/**
 * Full 4-locale resolver (`ar`, `fr`, `en`, `kab`) for universal share cards.
 * Preserves legacy `shareLocale("kab") === "ar"` untouched.
 */
export const shareCardLocale = (value: string | null | undefined): AnyLocale =>
  parseAnyLocaleParam(value) ?? "ar";

export function codecContentType(
  codec: ShareImageCodec,
): "image/webp" | "image/jpeg" | "image/png" {
  if (codec === "webp") return "image/webp";
  if (codec === "jpeg") return "image/jpeg";
  return "image/png";
}

export const OFFICIAL_AUTHORITY_TIERS = new Set([
  "national",
  "wilaya",
  "forestry",
]);

export function effectiveFireConfirmedAt(
  confirmedAt: string | null | undefined,
  confirmedMentionTier?: string | null,
): string | null {
  if (typeof confirmedAt !== "string") return null;
  const trimmed = confirmedAt.trim();
  if (
    trimmed.length === 0 ||
    !/^\d{4}-\d{2}-\d{2}/.test(trimmed) ||
    !Number.isFinite(Date.parse(trimmed))
  ) {
    return null;
  }
  if (
    confirmedMentionTier != null &&
    !OFFICIAL_AUTHORITY_TIERS.has(confirmedMentionTier)
  ) {
    return null;
  }
  return trimmed;
}

export const isShareable = (
  incident: Pick<OfficialIncident, "authority_tier">,
) => incident.authority_tier !== "media";

export function isEligibleOfficialIncident(
  incident: Pick<OfficialIncident, "authority_tier" | "as_of"> | null,
): boolean {
  if (!incident) return false;
  if (!OFFICIAL_AUTHORITY_TIERS.has(incident.authority_tier)) return false;
  return Number.isFinite(Date.parse(incident.as_of));
}

export type Translate = (key: string, vars?: Record<string, string>) => string;

export type CardText = {
  fire: boolean;
  eyebrow: string;
  source: string;
  hazard: string;
  status: string;
  place: string;
  region: string;
  placeText: string | null;
  time: string;
};

export function algiersDateTime(iso: string, locale: AnyLocale) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: "Africa/Algiers",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function incidentCardModel(
  incident: OfficialIncident,
  t: Translate,
  locale: AnyLocale,
): CardText {
  const fire = isFireKind(incident.kind);
  const commune = incident.precision === "wilaya" ? null : incident.commune;
  return {
    fire,
    eyebrow: t("official.eyebrow"),
    source:
      incident.latest_mention?.source?.label ?? t("official.sourceFallback"),
    hazard: fire
      ? t("civilMap.fire")
      : t(`reports.hazardName.${HAZARD_NAME[incident.kind] ?? "other"}`),
    status: t(`official.statuses.${incident.status}`),
    place: unitName(commune ?? incident.wilaya, locale),
    region: commune
      ? t("official.inWilaya", { wilaya: unitName(incident.wilaya, locale) })
      : t("official.wilayaLevel"),
    placeText: incident.place_text,
    time: t("shareCard.asOf", {
      time: algiersDateTime(incident.as_of, locale),
    }),
  };
}

// bump when the card layout or wording changes: cached images are immutable
export const CARD_REVISION = 1;

export const cardVersion = (updatedAt: string) =>
  `${CARD_REVISION}.${Date.parse(updatedAt)}`;

export const universalCardVersion = (timestampIso: string) => {
  const parsed = Date.parse(timestampIso);
  return `${UNIVERSAL_CARD_REVISION}.${Number.isFinite(parsed) ? parsed : 0}`;
};

export const shareImagePath = (
  id: string,
  format: ShareFormat,
  lang: Locale,
  updatedAt: string,
) =>
  `/api/public/share/incident/${id}/${format}?lang=${lang}&v=${cardVersion(updatedAt)}`;

export const universalShareImagePath = (
  kind: ShareKind,
  id: string,
  format: UniversalShareFormat,
  lang: AnyLocale,
  codec?: ShareImageCodec,
) => {
  const resolvedCodec = codec ?? UNIVERSAL_SHARE_FORMATS[format].defaultCodec;
  const ext = resolvedCodec === "jpeg" ? "jpg" : resolvedCodec;
  return `/api/public/share/${kind}/${encodeURIComponent(id)}.${format}.${ext}?lang=${lang}`;
};

export const shareCardPath = (id: string, format: ShareFormat, lang: Locale) =>
  `/share-card/incident/${id}?format=${format}&lang=${lang}`;

export const incidentUrl = (id: string, lang: AnyLocale) =>
  `${SITE_URL}/incident/${id}?lang=${lang}`;

export const linkTargets = (url: string) => ({
  whatsapp: `https://wa.me/?text=${encodeURIComponent(url)}`,
  facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
});

/* ---------- Strict Universal Share Path Parser ---------- */

export interface ParsedUniversalShareRequest {
  kind: ShareKind;
  id: string;
  format: UniversalShareFormat;
  codec: ShareImageCodec;
  lang: AnyLocale;
  v: string | null;
}

export type ParseUniversalShareResult =
  | { ok: true; target: ParsedUniversalShareRequest }
  | { ok: false; status: 400 | 404; error: string };

const SHARE_PREFIX = "/api/public/share/";
const RAW_FORBIDDEN_RE = /%2e|%2f|%5c|%00|\\|\/\//i;
const DECODED_ID_FORBIDDEN_RE = /[/\\]/;
const MAX_ENTITY_ID_LEN = 200;

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function parseCodecExtension(ext: string): ShareImageCodec | null {
  if (ext === "webp") return "webp";
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  if (ext === "png") return "png";
  return null;
}

function decodeAndValidateId(rawId: string): string | null {
  if (!rawId) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawId);
  } catch {
    return null;
  }
  if (
    !decoded ||
    decoded.length > MAX_ENTITY_ID_LEN ||
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("..") ||
    DECODED_ID_FORBIDDEN_RE.test(decoded) ||
    hasControlChar(decoded)
  ) {
    return null;
  }
  return decoded;
}

/**
 * Extracts the raw pathname from a URL string BEFORE `new URL()` dot-segment
 * normalization, so `/a/../b` traversal attempts are caught verbatim.
 */
export function extractRawPathname(requestUrl: string): string {
  const withoutOrigin = requestUrl.replace(
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*/,
    "",
  );
  const cutIdx = withoutOrigin.search(/[?#]/);
  return cutIdx >= 0 ? withoutOrigin.slice(0, cutIdx) : withoutOrigin;
}

/**
 * Strictly parses `/api/public/share/$kind/$id.$format[.$ext]` and
 * `/api/public/share/$kind/$id/$format[.$ext]` from the raw request pathname
 * BEFORE percent-decoding to block traversal/null-byte smuggling cleanly.
 */
export function parseUniversalSharePath(
  rawPathname: string,
  searchParams: URLSearchParams,
): ParseUniversalShareResult {
  if (!rawPathname.startsWith(SHARE_PREFIX)) {
    return { ok: false, status: 404, error: "not found" };
  }
  const suffix = rawPathname.slice(SHARE_PREFIX.length);
  if (!suffix || RAW_FORBIDDEN_RE.test(suffix) || hasControlChar(suffix)) {
    return { ok: false, status: 404, error: "not found" };
  }
  const segments = suffix.split("/");
  if (segments.length !== 2 && segments.length !== 3) {
    return { ok: false, status: 404, error: "not found" };
  }
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") {
      return { ok: false, status: 404, error: "not found" };
    }
  }

  const kindRaw = segments[0]!;
  if (!isShareKind(kindRaw)) {
    return { ok: false, status: 404, error: "unknown share kind" };
  }

  const lang = shareCardLocale(searchParams.get("lang"));
  const v = searchParams.get("v");

  if (segments.length === 3) {
    const id = decodeAndValidateId(segments[1]!);
    if (!id) {
      return { ok: false, status: 404, error: "invalid entity id" };
    }
    const formatSpec = segments[2]!;
    const parts = formatSpec.split(".");
    if (parts.length === 1) {
      const format = parts[0]!;
      if (!isUniversalShareFormat(format)) {
        return { ok: false, status: 400, error: "unknown format" };
      }
      return {
        ok: true,
        target: {
          kind: kindRaw,
          id,
          format,
          codec: UNIVERSAL_SHARE_FORMATS[format].defaultCodec,
          lang,
          v,
        },
      };
    }
    if (parts.length === 2) {
      const [format, ext] = parts;
      const codec = parseCodecExtension(ext!);
      if (!isUniversalShareFormat(format!) || !codec) {
        return { ok: false, status: 400, error: "unknown format or extension" };
      }
      return {
        ok: true,
        target: { kind: kindRaw, id, format, codec, lang, v },
      };
    }
    return { ok: false, status: 400, error: "unknown format" };
  }

  // 2-segment form: `$kind/$id.$format[.$ext]` using right-to-left parsing so
  // dotted ONM CAP OIDs (e.g. `2.49.0.1.12.0.20261125.whatsapp.webp`) resolve cleanly.
  const combined = segments[1]!;
  const lastDot = combined.lastIndexOf(".");
  if (lastDot < 0) {
    return { ok: false, status: 400, error: "missing format" };
  }
  const head = combined.slice(0, lastDot);
  const tail = combined.slice(lastDot + 1);
  const tailCodec = parseCodecExtension(tail);

  if (tailCodec) {
    const secondLastDot = head.lastIndexOf(".");
    if (secondLastDot < 0) {
      return { ok: false, status: 400, error: "missing format" };
    }
    const rawId = head.slice(0, secondLastDot);
    const format = head.slice(secondLastDot + 1);
    if (!rawId) {
      return { ok: false, status: 404, error: "missing entity id" };
    }
    if (!isUniversalShareFormat(format)) {
      return { ok: false, status: 400, error: "unknown format" };
    }
    const id = decodeAndValidateId(rawId);
    if (!id) {
      return { ok: false, status: 404, error: "invalid entity id" };
    }
    return {
      ok: true,
      target: { kind: kindRaw, id, format, codec: tailCodec, lang, v },
    };
  }

  if (isUniversalShareFormat(tail)) {
    if (!head) {
      return { ok: false, status: 404, error: "missing entity id" };
    }
    const id = decodeAndValidateId(head);
    if (!id) {
      return { ok: false, status: 404, error: "invalid entity id" };
    }
    return {
      ok: true,
      target: {
        kind: kindRaw,
        id,
        format: tail,
        codec: UNIVERSAL_SHARE_FORMATS[tail].defaultCodec,
        lang,
        v,
      },
    };
  }

  return { ok: false, status: 400, error: "unknown format or extension" };
}

/* ---------- Universal 5-Entity Card Model & ADR-0002 Eligibility ---------- */

export type ShareCardIconKind =
  "onm" | "fire" | "quake" | "wilaya" | "incident";

export interface UniversalShareCardModel {
  kind: ShareKind;
  id: string;
  lang: AnyLocale;
  rtl: boolean;
  version: string;
  icon: ShareCardIconKind;
  accentHex: string;
  badgeBgHex: string;
  badgeFgHex: string;
  eyebrow: string;
  eyebrowLtr?: boolean;
  badge: string;
  badgeLtr?: boolean;
  title: string;
  subtitle: string;
  coordsLtr?: string;
  metaLine: string;
  timestamp: string;
  footer: string;
  disclaimer?: string;
}

export function formatPlainCoords(lat: number, lon: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lonDir = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lon).toFixed(4)}°${lonDir}`;
}

/**
 * Strips any em dash (U+2014) from upstream dynamic text so rendered cards obey
 * R-02 strictly even if an external bulletin title contains one.
 */
function sanitizeCardText(value: string): string {
  return value
    .replace(/\u2014/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

const TIFINAGH_RE = /[\u2D30-\u2D7F]/;

function displayWilayaLabel(
  entry: WilayaSnapshot["wilaya"],
  lang: AnyLocale,
): string {
  const primary = wilayaName(entry, lang);
  if (lang === "kab" && TIFINAGH_RE.test(primary)) {
    return `${primary} (${entry.nameFr})`;
  }
  return primary;
}

const ONM_PALETTE: Record<
  number,
  { accent: string; badgeBg: string; badgeFg: string }
> = {
  4: { accent: "#f87171", badgeBg: "#b91c1c", badgeFg: "#ffffff" },
  3: { accent: "#fb923c", badgeBg: "#f16a00", badgeFg: "#0b0d10" },
  2: { accent: "#facc15", badgeBg: "#facc15", badgeFg: "#0b0d10" },
  1: { accent: "#38bdf8", badgeBg: "#38bdf8", badgeFg: "#0b0d10" },
};

const WEATHER_EVENTS_IN_WEATHER_NS = new Set([
  "rain",
  "storm",
  "sand",
  "wind",
  "heat",
  "other",
]);

function localizedOnmEventLabel(
  warning: Pick<OnmVigilance, "event" | "title" | "headline_fr">,
  t: Translate,
): string {
  const category = classifyOnmEvent(
    warning.event,
    warning.title,
    warning.headline_fr,
  );
  if (WEATHER_EVENTS_IN_WEATHER_NS.has(category)) {
    return t(`weather:outlook.event.${category}`);
  }
  return t(`track3.forecast.onmEvent.${category}`);
}

export function isEligibleOnmWarning(
  warning: Pick<
    OnmVigilance,
    | "superseded_at"
    | "cancelled_at"
    | "superseded_by"
    | "msg_type"
    | "expires"
    | "sent"
  > | null,
  nowMs: number = Date.now(),
): boolean {
  if (!warning) return false;
  if (
    warning.superseded_at !== null ||
    warning.cancelled_at !== null ||
    warning.superseded_by !== null
  ) {
    return false;
  }
  if (warning.msg_type && warning.msg_type.trim().toLowerCase() === "cancel") {
    return false;
  }
  if (!warning.expires || !warning.sent) return false;
  const expiresMs = Date.parse(warning.expires);
  const sentMs = Date.parse(warning.sent);
  if (!Number.isFinite(expiresMs) || !Number.isFinite(sentMs)) return false;
  return expiresMs > nowMs;
}

export function onmCardModel(
  warning: OnmVigilance,
  wilayaLabel: string | null,
  t: Translate,
  lang: AnyLocale,
): UniversalShareCardModel {
  const level = Math.min(4, Math.max(1, ONM_SEVERITY[warning.severity] ?? 1));
  const palette = ONM_PALETTE[level] ?? ONM_PALETTE[2]!;
  const levelLabel = t(`weather:outlook.onmLevel.${level}`);
  const badge = t("track3.share.onmLevelBadge", {
    level: String(level),
    label: levelLabel,
  });

  const eventLabel = localizedOnmEventLabel(warning, t);
  const rawHeadline =
    lang === "fr" && warning.headline_fr?.trim()
      ? warning.headline_fr.trim()
      : lang === "ar" && warning.title?.trim()
        ? warning.title.trim()
        : warning.headline_fr?.trim() || warning.title?.trim() || eventLabel;

  const area = sanitizeCardText(warning.area_desc || "");
  const cleanWilaya = wilayaLabel ? sanitizeCardText(wilayaLabel) : "";
  const subtitle =
    cleanWilaya && area
      ? area.toLowerCase().includes(cleanWilaya.toLowerCase())
        ? area
        : `${cleanWilaya} · ${area}`
      : cleanWilaya || area || eventLabel;

  return {
    kind: "onm",
    id: warning.id,
    lang,
    rtl: lang === "ar",
    version: universalCardVersion(warning.sent),
    icon: "onm",
    accentHex: palette.accent,
    badgeBgHex: palette.badgeBg,
    badgeFgHex: palette.badgeFg,
    eyebrow: t("track3.share.onmEyebrow"),
    eyebrowLtr: true,
    badge: sanitizeCardText(badge),
    title: sanitizeCardText(rawHeadline),
    subtitle: sanitizeCardText(subtitle),
    metaLine: warning.expires
      ? sanitizeCardText(
          t("track3.share.onmValidUntil", {
            time: algiersDateTime(warning.expires, lang),
          }),
        )
      : "",
    timestamp: sanitizeCardText(
      t("track3.share.updatedAlgiers", {
        time: algiersDateTime(warning.sent, lang),
      }),
    ),
    footer: "nadhir.app",
  };
}

export type EligibleFireClusterInput = Pick<
  FireCluster,
  | "id"
  | "short_id"
  | "state"
  | "first_detected_at"
  | "last_detected_at"
  | "lat"
  | "lon"
  | "detection_count"
  | "sources"
  | "confirmed_at"
  | "resolved_at"
> & {
  suspected_persistent_source?: boolean | null;
  updated_at?: string | null;
};

/**
 * ADR-0002 strict fire share-card eligibility:
 * - Rejects false_positive, extinguished, resolved_at !== null, non-finite coords/time.
 * - Rejects suspected_persistent_source unless verified by a non-media official authority.
 * - Rejects Candidate (`state === "unconfirmed"` without non-media confirmation) and `heat_signal`.
 * - Media/ITA mentions NEVER grant `confirmed`.
 */
export function isEligibleProbableFire(
  cluster: EligibleFireClusterInput | null,
  ctx: FireContext,
  confirmedMentionTier?: string | null,
): Extract<FireLevel, "probable" | "confirmed"> | null {
  if (!cluster) return null;
  if (
    cluster.state === "false_positive" ||
    cluster.state === "extinguished" ||
    cluster.resolved_at !== null
  ) {
    return null;
  }
  if (
    !Number.isFinite(cluster.lat) ||
    !Number.isFinite(cluster.lon) ||
    !Number.isFinite(Date.parse(cluster.last_detected_at))
  ) {
    return null;
  }

  const effectiveConfirmedAt = effectiveFireConfirmedAt(
    cluster.confirmed_at,
    confirmedMentionTier,
  );

  if (cluster.suspected_persistent_source === true && !effectiveConfirmedAt) {
    return null;
  }

  const stage = fireStage({
    state: cluster.state,
    confirmed_at: effectiveConfirmedAt,
  });
  if (stage === "candidate") return null;

  const level = fireLevel(stage, ctx);
  if (level === "heat_signal") return null;
  return level;
}

const SATELLITE_SOURCE_LABELS: Record<string, string> = {
  firms: "NASA FIRMS",
  fci: "EUMETSAT MTG FCI",
  s3: "Copernicus Sentinel-3",
};

export function fireSourceAttribution(
  sources: readonly string[],
  level: Extract<FireLevel, "probable" | "confirmed">,
  confirmedSourceLabel?: string | null,
): string {
  const mapped: string[] = [];
  if (level === "confirmed") {
    const cleanAuthority = confirmedSourceLabel
      ? sanitizeCardText(confirmedSourceLabel)
      : "";
    mapped.push(cleanAuthority || "DGPC");
  }
  for (const src of sources) {
    const label = SATELLITE_SOURCE_LABELS[src.trim().toLowerCase()];
    if (label && !mapped.includes(label)) {
      mapped.push(label);
    }
  }
  if (mapped.length === 0 || (level === "confirmed" && mapped.length === 1)) {
    mapped.push("NASA FIRMS");
  }
  return mapped.join(" · ");
}

export function fireCardModel(
  cluster: EligibleFireClusterInput,
  level: Extract<FireLevel, "probable" | "confirmed">,
  placeLabel: string | null,
  t: Translate,
  lang: AnyLocale,
  confirmedSourceLabel?: string | null,
): UniversalShareCardModel {
  const confirmed = level === "confirmed";
  const detections = Math.max(
    1,
    Number.isFinite(cluster.detection_count)
      ? Math.round(cluster.detection_count)
      : 1,
  );
  const cleanPlace = placeLabel ? sanitizeCardText(placeLabel) : "";
  const title = cleanPlace || sanitizeCardText(t("track3.share.fireTitle"));
  const subtitle = cleanPlace
    ? sanitizeCardText(t("track3.share.fireTitle"))
    : "";
  const eyebrow = fireSourceAttribution(
    cluster.sources,
    level,
    confirmedSourceLabel,
  );

  return {
    kind: "fire",
    id: cluster.short_id || cluster.id,
    lang,
    rtl: lang === "ar",
    version: universalCardVersion(
      cluster.updated_at || cluster.last_detected_at,
    ),
    icon: "fire",
    accentHex: confirmed ? "#f87171" : "#fb923c",
    badgeBgHex: confirmed ? "#b91c1c" : "#f16a00",
    badgeFgHex: confirmed ? "#ffffff" : "#0b0d10",
    eyebrow,
    eyebrowLtr: !/[\u0600-\u06FF]/.test(eyebrow),
    badge: sanitizeCardText(
      confirmed
        ? t("track3.share.confirmedFireBadge")
        : t("track3.share.probableFireBadge"),
    ),
    title,
    subtitle,
    coordsLtr: formatPlainCoords(cluster.lat, cluster.lon),
    metaLine: sanitizeCardText(
      t("track3.share.fireDetections", { count: String(detections) }),
    ),
    timestamp: sanitizeCardText(
      t("track3.share.updatedAlgiers", {
        time: algiersDateTime(cluster.last_detected_at, lang),
      }),
    ),
    disclaimer: sanitizeCardText(
      confirmed
        ? t("track3.share.confirmedFireNote")
        : t("track3.share.probableFireNote"),
    ),
    footer: "nadhir.app",
  };
}

export function isEligibleEarthquake(
  quake: Pick<Earthquake, "magnitude" | "lat" | "lon" | "occurred_at"> | null,
): boolean {
  if (!quake) return false;
  const mag = Number(quake.magnitude);
  return (
    Number.isFinite(mag) &&
    mag > 0 &&
    Number.isFinite(quake.lat) &&
    Number.isFinite(quake.lon) &&
    Number.isFinite(Date.parse(quake.occurred_at))
  );
}

export function quakeCardModel(
  quake: Earthquake & { updated_at?: string | null },
  placeLabel: string | null,
  t: Translate,
  lang: AnyLocale,
): UniversalShareCardModel {
  const mag = Number(quake.magnitude);
  const high = mag >= 5;
  const medium = mag >= 4;
  const attribution = sanitizeCardText(quake.network?.trim() || "EMSC");
  const cleanPlace = placeLabel
    ? sanitizeCardText(placeLabel)
    : sanitizeCardText(quake.region || "");
  const metaParts: string[] = [];
  if (quake.depth_km !== null && Number.isFinite(Number(quake.depth_km))) {
    metaParts.push(
      t("track3.share.quakeDepth", {
        km: String(Math.round(Number(quake.depth_km))),
      }),
    );
  }
  if (quake.offshore) {
    metaParts.push(t("track3.share.quakeOffshore"));
  }

  return {
    kind: "quake",
    id: quake.id,
    lang,
    rtl: lang === "ar",
    version: universalCardVersion(quake.updated_at || quake.occurred_at),
    icon: "quake",
    accentHex: high ? "#f87171" : medium ? "#fb923c" : "#facc15",
    badgeBgHex: high ? "#b91c1c" : medium ? "#f16a00" : "#facc15",
    badgeFgHex: high ? "#ffffff" : "#0b0d10",
    eyebrow: attribution,
    eyebrowLtr: true,
    badge: `M${mag.toFixed(1)}`,
    badgeLtr: true,
    title: cleanPlace || sanitizeCardText(t("track3.share.quakeTitle")),
    subtitle: cleanPlace ? sanitizeCardText(t("track3.share.quakeTitle")) : "",
    coordsLtr: formatPlainCoords(quake.lat, quake.lon),
    metaLine: sanitizeCardText(metaParts.join(" · ")),
    timestamp: sanitizeCardText(
      t("track3.share.updatedAlgiers", {
        time: algiersDateTime(quake.occurred_at, lang),
      }),
    ),
    footer: "nadhir.app",
  };
}

export function wilayaCardModel(
  snapshot: WilayaSnapshot,
  t: Translate,
  lang: AnyLocale,
): UniversalShareCardModel {
  const localizedWilaya = displayWilayaLabel(snapshot.wilaya, lang);
  const title = sanitizeCardText(
    t("track3.share.wilayaHeading", { wilaya: localizedWilaya }),
  );
  const officialIncidents = snapshot.officialIncidents.filter(
    (incident) => incident.authority_tier !== "media",
  );
  const activeCount =
    snapshot.onmWarnings.length +
    officialIncidents.length +
    snapshot.probableFires.length +
    snapshot.earthquakes.length;

  const coordsLtr = formatPlainCoords(snapshot.wilaya.lat, snapshot.wilaya.lon);
  const timestamp = sanitizeCardText(
    t("track3.share.updatedAlgiers", {
      time: algiersDateTime(snapshot.fetchedAt, lang),
    }),
  );

  if (activeCount > 0) {
    const topOnm = [...snapshot.onmWarnings].sort(
      (a, b) =>
        (ONM_SEVERITY[b.severity] ?? 1) - (ONM_SEVERITY[a.severity] ?? 1),
    )[0];

    if (topOnm) {
      const level = Math.min(
        4,
        Math.max(1, ONM_SEVERITY[topOnm.severity] ?? 2),
      );
      const palette = ONM_PALETTE[level] ?? ONM_PALETTE[2]!;
      const levelLabel = t(`weather:outlook.onmLevel.${level}`);
      const headline =
        lang === "fr" && topOnm.headline_fr?.trim()
          ? topOnm.headline_fr.trim()
          : lang === "ar" && topOnm.title?.trim()
            ? topOnm.title.trim()
            : topOnm.headline_fr?.trim() ||
              topOnm.title?.trim() ||
              localizedOnmEventLabel(topOnm, t);

      return {
        kind: "wilaya",
        id: snapshot.wilaya.slug,
        lang,
        rtl: lang === "ar",
        version: universalCardVersion(snapshot.fetchedAt),
        icon: "onm",
        accentHex: palette.accent,
        badgeBgHex: palette.badgeBg,
        badgeFgHex: palette.badgeFg,
        eyebrow: t("track3.share.onmEyebrow"),
        eyebrowLtr: true,
        badge: sanitizeCardText(
          t("track3.share.onmLevelBadge", {
            level: String(level),
            label: levelLabel,
          }),
        ),
        title,
        subtitle: sanitizeCardText(headline),
        coordsLtr,
        metaLine: sanitizeCardText(
          t("track3.share.wilayaActiveSummary", { count: String(activeCount) }),
        ),
        timestamp,
        footer: "nadhir.app",
      };
    }

    const firstIncident = officialIncidents[0];
    const firstFire = snapshot.probableFires[0];
    const firstQuake = snapshot.earthquakes[0];
    let topSummary = t("track3.share.wilayaActiveSummary", {
      count: String(activeCount),
    });
    let accentHex = "#fb923c";
    let badgeBgHex = "#f16a00";
    let badgeFgHex = "#0b0d10";
    let icon: ShareCardIconKind = "wilaya";

    if (firstIncident) {
      const fire = isFireKind(firstIncident.kind);
      topSummary = fire
        ? t("civilMap.fire")
        : t(`reports.hazardName.${HAZARD_NAME[firstIncident.kind] ?? "other"}`);
      icon = "incident";
      accentHex = "#f87171";
      badgeBgHex = "#b91c1c";
      badgeFgHex = "#ffffff";
    } else if (firstFire) {
      topSummary =
        firstFire.level === "confirmed"
          ? t("track3.share.confirmedFireBadge")
          : t("track3.share.probableFireBadge");
      icon = "fire";
    } else if (firstQuake) {
      topSummary = `${t("track3.share.quakeTitle")} M${Number(firstQuake.magnitude).toFixed(1)}`;
      icon = "quake";
    }

    return {
      kind: "wilaya",
      id: snapshot.wilaya.slug,
      lang,
      rtl: lang === "ar",
      version: universalCardVersion(snapshot.fetchedAt),
      icon,
      accentHex,
      badgeBgHex,
      badgeFgHex,
      eyebrow: sanitizeCardText(
        t("track3.share.wilayaEyebrow", { code: snapshot.wilaya.code }),
      ),
      badge: sanitizeCardText(t("track3.share.wilayaActiveBadge")),
      title,
      subtitle: sanitizeCardText(topSummary),
      coordsLtr,
      metaLine: sanitizeCardText(
        t("track3.share.wilayaActiveSummary", { count: String(activeCount) }),
      ),
      timestamp,
      footer: "nadhir.app",
    };
  }

  const unavailable = snapshot.dataStatus === "unavailable";
  return {
    kind: "wilaya",
    id: snapshot.wilaya.slug,
    lang,
    rtl: lang === "ar",
    version: universalCardVersion(snapshot.fetchedAt),
    icon: "wilaya",
    accentHex: "#57cbb0",
    badgeBgHex: "#1e293b",
    badgeFgHex: "#e2e8f0",
    eyebrow: sanitizeCardText(
      t("track3.share.wilayaEyebrow", { code: snapshot.wilaya.code }),
    ),
    badge: sanitizeCardText(
      unavailable
        ? t("track3.share.wilayaFeedUnavailableBadge")
        : t("track3.share.wilayaNoListedBadge"),
    ),
    title,
    subtitle: sanitizeCardText(
      unavailable
        ? t("track3.share.wilayaFeedUnavailable")
        : t("track3.share.wilayaNoListedAlerts"),
    ),
    coordsLtr,
    metaLine: sanitizeCardText(
      t("track3.wilaya.communesStat", {
        count: String(snapshot.wilaya.communeCount),
      }),
    ),
    timestamp,
    disclaimer: sanitizeCardText(t("track3.share.wilayaHonestCaveat")),
    footer: "nadhir.app",
  };
}

export function universalIncidentCardModel(
  incident: OfficialIncident,
  t: Translate,
  lang: AnyLocale,
): UniversalShareCardModel {
  const card = incidentCardModel(incident, t, lang);
  const accentHex = card.fire ? "#fb923c" : "#38bdf8";
  const badgeBgHex = card.fire ? "#b91c1c" : "#1d4ed8";
  const subtitleParts = [card.region];
  if (card.placeText) subtitleParts.push(card.placeText);

  const unit =
    incident.precision === "wilaya"
      ? incident.wilaya
      : (incident.commune ?? incident.wilaya);
  const coordsLtr =
    unit && Number.isFinite(unit.lat) && Number.isFinite(unit.lon)
      ? formatPlainCoords(unit.lat, unit.lon)
      : undefined;

  return {
    kind: "incident",
    id: incident.id,
    lang,
    rtl: lang === "ar",
    version: universalCardVersion(incident.updated_at || incident.as_of),
    icon: card.fire ? "fire" : "incident",
    accentHex,
    badgeBgHex,
    badgeFgHex: "#ffffff",
    eyebrow: sanitizeCardText(`${card.eyebrow} · ${card.source}`),
    badge: sanitizeCardText(card.status),
    title: sanitizeCardText(`${card.hazard} · ${card.place}`),
    subtitle: sanitizeCardText(subtitleParts.join(" · ")),
    ...(coordsLtr ? { coordsLtr } : {}),
    metaLine: "",
    timestamp: sanitizeCardText(card.time),
    footer: "nadhir.app",
  };
}

const rings = (geometry: Geometry): Position[][] =>
  geometry.type === "Polygon"
    ? geometry.coordinates
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates.flat()
      : [];

export function outlinePaths(
  shapes: Geometry[],
  width: number,
  height: number,
  pad: number,
): string[] {
  const points = shapes.flatMap(rings).flat();
  if (!points.length) return [];
  let [minLon, maxLon, minLat, maxLat] = [
    Infinity,
    -Infinity,
    Infinity,
    -Infinity,
  ];
  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon!);
    maxLon = Math.max(maxLon, lon!);
    minLat = Math.min(minLat, lat!);
    maxLat = Math.max(maxLat, lat!);
  }
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * kx, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const xy = ([lon, lat]: Position) =>
    `${((lon! - minLon) * kx * scale + offX).toFixed(1)} ${((maxLat - lat!) * scale + offY).toFixed(1)}`;
  return shapes.map((shape) =>
    rings(shape)
      .map((ring) => `M${ring.map(xy).join("L")}Z`)
      .join(""),
  );
}
