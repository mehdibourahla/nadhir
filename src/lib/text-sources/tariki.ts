import type { ItaFeedPost } from "./ita-feed";
import { isFireKind, type IncidentKind } from "./merge";
import type { TelegramPost } from "./telegram-public";
import { extractFacebookPageSlug, isLoginWallHtml } from "./facebook-page";

export const TARIKI_SOURCE_KEY = "tariki_facebook" as const;
export const TARIKI_PAGE_SLUG = "tariki.GN" as const;
export const TARIKI_PAGE_URL = "https://www.facebook.com/tariki.GN" as const;
export const TARIKI_ATTRIBUTION = "Gendarmerie Nationale (Tariki)" as const;

export const TARIKI_ALLOWED_HAZARDS = [
  "road",
  "flood",
  "structure",
  "storm",
  "other",
] as const;

export type TarikiHazardKind = (typeof TARIKI_ALLOWED_HAZARDS)[number];

export type TarikiNormalizedBatch = {
  posts: TelegramPost[];
  totalSeen: number;
  upstreamPublishedAt: string | null;
};

export type TarikiPreFilterDecision =
  | "candidate"
  | "ignore_greeting"
  | "ignore_open_works"
  | "ignore_heavy_trucks_only";

function maxIsoTimestamp(values: readonly string[]): string | null {
  let bestMs = Number.NEGATIVE_INFINITY;
  let bestIso: string | null = null;
  for (const value of values) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      bestIso = new Date(ms).toISOString();
    }
  }
  return bestIso;
}

function normalizeIso(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Tariki schema invalid: missing ${field}`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`Tariki schema invalid: invalid ${field} "${value}"`);
  }
  return new Date(ms).toISOString();
}

function buildTarikiPostUrl(
  externalId: string,
  pageSlug: string,
  explicitUrl?: string | null,
): string {
  if (explicitUrl && /^https?:\/\//i.test(explicitUrl.trim())) {
    return explicitUrl.trim();
  }
  const rawPostId = externalId.includes("_")
    ? (externalId.split("_").pop() ?? externalId)
    : externalId;
  return `https://www.facebook.com/${pageSlug}/posts/${rawPostId}`;
}

export function tarikiPostsFromFacebookPage(
  posts: readonly ItaFeedPost[],
  pageOrUrl: string = TARIKI_PAGE_SLUG,
  knownExternalIds?: ReadonlySet<string>,
): TarikiNormalizedBatch {
  const slug = extractFacebookPageSlug(pageOrUrl);
  // Pre-filter freshness watermark BEFORE filtering blank messages or already-known IDs
  const upstreamPublishedAt = maxIsoTimestamp(
    posts.map((post) => post.created_time),
  );

  const normalized: TelegramPost[] = [];
  for (const post of posts) {
    const publishedAt = normalizeIso(post.created_time, "created_time");
    if (knownExternalIds?.has(post.id)) continue;
    const text = post.message.trim();
    if (!text) continue;
    normalized.push({
      externalId: post.id,
      publishedAt,
      text,
      url: buildTarikiPostUrl(post.id, slug),
    });
  }

  return {
    posts: normalized,
    totalSeen: posts.length,
    upstreamPublishedAt,
  };
}

export function tarikiPostsFromCapturedItems(
  raw: unknown,
  knownExternalIds?: ReadonlySet<string>,
): TarikiNormalizedBatch {
  if (typeof raw === "string") {
    if (isLoginWallHtml(raw) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(raw)) {
      throw new Error(
        "Tariki upstream returned HTML login wall or error page instead of posts JSON",
      );
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new Error("Tariki schema invalid: failed to parse captured JSON");
    }
    return tarikiPostsFromCapturedItems(decoded, knownExternalIds);
  }

  if (!Array.isArray(raw)) {
    throw new Error("Tariki schema invalid: expected an array of posts");
  }

  const timestamps: string[] = [];
  const parsedItems: {
    externalId: string;
    publishedAt: string;
    text: string;
    url: string;
  }[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Tariki schema invalid: post item must be an object");
    }
    const item = entry as Record<string, unknown>;
    const rawId = item["postId"] ?? item["post_id"] ?? item["id"];
    if (typeof rawId !== "string" || !rawId.trim()) {
      throw new Error("Tariki schema invalid: missing postId");
    }
    const publishedAt = normalizeIso(
      item["time"] ?? item["publishedAt"] ?? item["created_time"],
      "time",
    );
    timestamps.push(publishedAt);

    const pageName =
      typeof item["pageName"] === "string" && item["pageName"].trim()
        ? item["pageName"].trim()
        : typeof item["facebookUrl"] === "string" && item["facebookUrl"].trim()
          ? extractFacebookPageSlug(item["facebookUrl"])
          : TARIKI_PAGE_SLUG;

    const rawUrl = typeof item["url"] === "string" ? item["url"] : null;
    const rawText =
      typeof item["text"] === "string"
        ? item["text"]
        : typeof item["message"] === "string"
          ? item["message"]
          : "";

    const externalId = rawId.trim();
    if (knownExternalIds?.has(externalId)) continue;
    const text = rawText.trim();
    if (!text) continue;

    parsedItems.push({
      externalId,
      publishedAt,
      text,
      url: buildTarikiPostUrl(externalId, pageName, rawUrl),
    });
  }

  // Pre-filter freshness watermark across ALL captured items before dedupe/blank filtering
  const upstreamPublishedAt = maxIsoTimestamp(timestamps);

  return {
    posts: parsedItems,
    totalSeen: raw.length,
    upstreamPublishedAt,
  };
}

export function normalizeArabicForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    .replace(/[\u061C\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ةۀھ]/g, "ه")
    .replace(/[ىی]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/[àâäÀÂÄ]/g, "a")
    .replace(/[éèêëÉÈÊË]/g, "e")
    .replace(/[îïÎÏ]/g, "i")
    .replace(/[ôöÔÖ]/g, "o")
    .replace(/[ùûüÙÛÜ]/g, "u")
    .replace(/[çÇ]/g, "c")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Single canonical source of truth for Tariki road/weather/geological/accident danger signals.
// ALL patterns MUST use ONLY canonical normalized characters (no أإآٱةىؤئ or diacritics).
export const TARIKI_DANGER_PATTERNS: readonly RegExp[] = [
  // 1. Hydrological: floods, flash floods, water-level rise, submerged roads, flowing wadis, water pooling
  /فيضان|طوفان|سيول|منسوب (?:ال)?(?:مياه|واد|وادي|اوديه|وديان)|مغمور[ها]? ب(?:ال)?مياه|غمر(?:ت|ته|تها)? (?:ال)?مياه|(?:تجمع|تراكم|تدفق) (?:(?:كبير|معتبر|كثيف) )?(?:ال|لل)?مياه|جريان (?:ال)?(?:واد|وادي|اوديه|وديان)|برك (?:ماييه|(?:ال)?مياه)|(?:^| )(?:[وفبلك]?ال|[وفب])?سيلا? (?:جارف|مايي|عرم)/,
  // 2. Heavy rain, storms, violent winds, hail, severe weather disturbances, fallen trees/poles
  /(?:ال|لل)?امطارا? (?:جد )?(?:ال)?(?:غزير|رعدي|طوفاني|قوي|معتبر|كثيف|متواصل)ه?|(?:تساقط|تهاطل|هطول|غزاره|شده|كثافه|تواصل|استمرار|بسبب|اثر|نتيجه) (?:(?:كثيف|غزير|قوي|مستمر) )?(?:ال|لل)?امطار|(?:ال)?مطرا? (?:ال)?(?:غزير|رعدي|طوفاني|قوي)|زخات (?:مطريه|من (?:ال)?امطار)|عاصف|عواصف|اعصار|رياحا? (?:جد )?(?:ال)?(?:قوي|عاتي|شديد|عاصف|رملي)ه?|(?:قوه|شده|هبوب|هبات) (?:ال)?رياح|(?:تساقط|حبات) (?:ال)?برد|تقلبات (?:ال)?جويه|سقوط (?:ال)?(?:اشجار|اعمده)/,
  // 3. Winter: snow, ice, frost/black-ice (word-bounded جليد excludes commune 4407 جليدة/Djelida)
  /ثلوج|ثلجي|(?:^| )(?:[وفبلك]?ال|لل|[وفبلك])?ثلجا?(?: |$)|(?:^| )(?:[وفبلك]?ال|لل|[وفبلك])?جليد(?:ي[ه]?|ا)?(?: |$)|صقيع|تجلد/,
  // 4. Visibility, fog, mist, sandstorms, blowing sand/dust
  /ضباب|شبوره|زوبعه|زوابع|(?:تطاير|زحف|تراكم) (?:ال)?(?:رمال|غبار)|كثبان رمليه|غبارا? كثيف|(?:انعدام|تدن|تدني|نقص|ضعف|حجب|يحجب|تحجب|تراجع|قله|صعوبه) (?:(?:تام|كلي|شبه كلي|شديد|كبير|حاد) )?(?:في )?(?:ال|لل)?رويه|(?:ال)?رويه (?:شبه )?(?:منعدم|ضعيف|متدني|محدود)ه/,
  // 5. Geological, structural & road-surface hazards
  /هبوط|انهيار|تصدع|تشقق|انجراف|انزلاق|تزحلق|(?:طريق|ارضيه) زلقه|صخور|صخره|صخري|اوحال|(?:^| )(?:[وفبلك]?ال|لل|[وفبلك])?وحل(?:ي[ه]?|ا)?(?: |$)|انفجار|تسرب (?:ماده )?(?:ال)?(?:غاز|وقود|مازوت|بنزين|زيت|زيوت)/,
  // 6. Live traffic accidents, collisions, pileups, vehicle overturns (singular crash, not plural prevention advice)
  /حادث (?:مرور|سير|اصطدام|انقلاب|دهس)|اصطدام|تصادم|انقلاب (?:ال)?(?:شاحن|مركب|حافل|سيار|مقطور|صهريج)/,
  // 7. Fire & road-impairing smoke (road-hazard pre-filter only; fire kinds stay excluded downstream)
  /(?:^| )(?:[وفبلك]?ال|لل|[وفبلك])?حريق(?: |$)|حرايق|اندلاع (?:ال)?نيران|نشوب (?:ال)?حريق|دخانا? (?:كثيف|يحجب)|(?:تصاعد|سحب) (?:ال)?دخان/,
  // 8. Impassable / cut road, severe circulation difficulty, total closure, emergency relief / stranded motorists
  /مقطوع|انقطاع (?:ال)?(?:طريق|سير|مرور|حركه المرور)|صعوبه (?:(?:كبيره|بالغه|شديده) )?(?:في )?(?:ال)?(?:سير|حركه المرور|مرور|تنقل)|غلقا? (?:كلي|تام)|مغلق[ها]? كليا|اغاثه|معزول|عالقين|محصورين/,
  // 9. French-mixed physical hazard terminology (normalized ASCII accents)
  /\b(?:inondations?|eboulements?|verglas|brouillard|tempetes? de sable|chutes? de pierres|glissements? de terrain)\b/i,
];

export function hasTarikiDangerSignal(normalizedText: string): boolean {
  return TARIKI_DANGER_PATTERNS.some((pattern) => pattern.test(normalizedText));
}

const HEAVY_TRUCKS_ONLY_RE =
  /في وجه (?:شاحنات|مركبات) الوزن الثقيل|بالنسبه ل ?(?:شاحنات|مركبات) الوزن الثقيل|(?:(?:شاحنات|المركبات ذات) )?الوزن الثقيل فقط/;
const ALL_VEHICLES_RE =
  /(?:جميع|كافه|كل) (?:اصناف )?المركبات|بما (?:فيها|في ذلك) شاحنات الوزن الثقيل/;
const CLOSURE_RE =
  /غلق|مغلق|اغلاق|تحويل حركه المرور|\broute (?:coupee|fermee)\b/i;
const HEAVY_TRUCKS_RESTRICTION_RE =
  /غلق|مغلق|اغلاق|تحويل حركه المرور|منع(?: موقتا?)? ل?(?:سير|مرور)/;
const OPEN_WORKS_RE =
  /(?:^| )(?:[وفبلك]?ال|[وفب])?اشغالا?(?: |$)|(?:^| )(?:[وفبلك]?ال|[وفب])?موكبا?(?: |$)|(?:ال)?حموله (?:ال)?استثناييه|(?:ال)?قافله (?:ال)?استثناييه|مرافقه (?:ال)?قافله(?! (?:اغاثه|الحمايه المدنيه|طبيه|اسعاف))|تمرير (?:ال)?اسلاك/;
const GREETING_RE = /تحيه صباحيه|صباح الخير|مساء الخير|جمعه مباركه|عيد مبارك/;

export function isTarikiHeavyTrucksOnlyClosure(text: string): boolean {
  const norm = normalizeArabicForMatch(text);
  if (
    !HEAVY_TRUCKS_ONLY_RE.test(norm) ||
    !HEAVY_TRUCKS_RESTRICTION_RE.test(norm)
  ) {
    return false;
  }
  // Never suppress closures affecting all vehicles or caused by any road/weather/structural hazard
  if (ALL_VEHICLES_RE.test(norm) || hasTarikiDangerSignal(norm)) {
    return false;
  }
  return true;
}

export function isTarikiOpenRoadWorks(text: string): boolean {
  const norm = normalizeArabicForMatch(text);
  if (!OPEN_WORKS_RE.test(norm)) return false;
  if (hasTarikiDangerSignal(norm) || CLOSURE_RE.test(norm)) return false;
  return true;
}

export function isTarikiGreetingOnly(text: string): boolean {
  const norm = normalizeArabicForMatch(text);
  if (!GREETING_RE.test(norm)) return false;
  if (hasTarikiDangerSignal(norm) || CLOSURE_RE.test(norm)) return false;
  return true;
}

export function classifyTarikiPostPreFilter(
  text: string,
): TarikiPreFilterDecision {
  if (isTarikiGreetingOnly(text)) return "ignore_greeting";
  if (isTarikiHeavyTrucksOnlyClosure(text)) return "ignore_heavy_trucks_only";
  if (isTarikiOpenRoadWorks(text)) return "ignore_open_works";
  return "candidate";
}

export function isTarikiDangerPost(text: string): boolean {
  return classifyTarikiPostPreFilter(text) === "candidate";
}

export function isTarikiFireKind(kind: IncidentKind | string): boolean {
  return isFireKind(kind as IncidentKind);
}

export function assertTarikiNonFireKind(kind: IncidentKind | string): void {
  if (isTarikiFireKind(kind)) {
    throw new Error(
      `Tariki source cannot emit or confirm fire incident kind "${kind}"`,
    );
  }
}

export function filterTarikiNonFireItems<T extends { hazard: string }>(
  items: readonly T[],
): T[] {
  return items.filter(
    (item) =>
      !isTarikiFireKind(item.hazard) &&
      (TARIKI_ALLOWED_HAZARDS as readonly string[]).includes(item.hazard),
  );
}
