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

function normalizeArabicForMatch(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\u0640/g, "")
    .replace(/[\u0654\u0655]/g, "")
    .replace(/[#_]/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/\s+/g, " ")
    .trim();
}

const DANGER_SIGNAL_RE =
  /طريق مغلق|مقطوع|صعوبة في السير|ارتفاع منسوب المياه|فيضان|سيول|هبوط|انهيار|تصدع|ثلوج|جليد|تساقط الصخور|انجراف|انزلاق|مغمور بالمياه|ضباب|انعدام الرؤية|زوابع رملية|امطار غزيرة/;

const HEAVY_TRUCKS_ONLY_RE =
  /في وجه شاحنات الوزن الثقيل|في وجه مركبات الوزن الثقيل|بالنسبة لشاحنات الوزن الثقيل|بالنسبة لمركبات الوزن الثقيل|شاحنات الوزن الثقيل فقط|الوزن الثقيل فقط|المركبات ذات الوزن الثقيل فقط/;
const ALL_VEHICLES_RE =
  /جميع المركبات|كافة المركبات|كل المركبات|جميع اصناف المركبات|كافة اصناف المركبات|بما فيها شاحنات الوزن الثقيل|بما في ذلك شاحنات الوزن الثقيل/;
const HEAVY_TRUCKS_HAZARD_GUARD_RE =
  /ارتفاع منسوب المياه|فيضان|سيول|مغمور بالمياه|هبوط|انهيار|تصدع|انجراف|انزلاق|تشقق|ثلوج|جليد|صخور|ضباب|انعدام الرؤية|زوابع رملية|امطار غزيرة/;
const CLOSURE_RE = /غلق|مغلق|تحويل حركة المرور/;
const HEAVY_TRUCKS_RESTRICTION_RE =
  /غلق|مغلق|تحويل حركة المرور|منع(?:\s+مؤقت)?\s+ل?(?:سير|مرور)/;
const OPEN_WORKS_RE =
  /وجود اشغال|اشغال|موكب|حمولة استثنائية|قافلة\s+استثنائية|مرافقة\s+قافلة|تمرير اسلاك/;
const GREETING_RE = /تحية صباحية|صباح الخير|مساء الخير|جمعة مباركة|عيد مبارك/;

export function isTarikiHeavyTrucksOnlyClosure(text: string): boolean {
  const norm = normalizeArabicForMatch(text);
  if (
    !HEAVY_TRUCKS_ONLY_RE.test(norm) ||
    !HEAVY_TRUCKS_RESTRICTION_RE.test(norm)
  ) {
    return false;
  }
  // Never suppress closures affecting all vehicles or caused by structural/weather hazards
  if (ALL_VEHICLES_RE.test(norm) || HEAVY_TRUCKS_HAZARD_GUARD_RE.test(norm)) {
    return false;
  }
  return true;
}

export function isTarikiOpenRoadWorks(text: string): boolean {
  const norm = normalizeArabicForMatch(text);
  if (!OPEN_WORKS_RE.test(norm)) return false;
  if (DANGER_SIGNAL_RE.test(norm) || CLOSURE_RE.test(norm)) return false;
  return true;
}

export function isTarikiGreetingOnly(text: string): boolean {
  const norm = normalizeArabicForMatch(text);
  if (!GREETING_RE.test(norm)) return false;
  if (DANGER_SIGNAL_RE.test(norm) || CLOSURE_RE.test(norm)) return false;
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
