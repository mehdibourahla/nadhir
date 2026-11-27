import type { AnyLocale } from "@/i18n";
import { intlLocale } from "@/lib/nadhir";

/** Strips upstream em dashes so rendered UI copy stays consistent. */
export function cleanCopy(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\u2014/g, " - ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function formatNumber(
  value: number,
  locale: AnyLocale,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(intlLocale(locale), {
    numberingSystem: "latn",
    ...options,
  }).format(value);
}

export function formatShortDay(
  isoDate: string,
  locale: AnyLocale,
): {
  weekday: string;
  dayNum: string;
} {
  const date = new Date(`${isoDate}T12:00:00+01:00`);
  if (Number.isNaN(date.getTime())) return { weekday: isoDate, dayNum: "" };
  const loc = intlLocale(locale);
  const weekday = new Intl.DateTimeFormat(loc, {
    timeZone: "Africa/Algiers",
    weekday: "short",
  }).format(date);
  const dayNum = new Intl.DateTimeFormat(loc, {
    timeZone: "Africa/Algiers",
    day: "numeric",
    month: "short",
    numberingSystem: "latn",
  }).format(date);
  return { weekday, dayNum };
}

export function formatAlgiersClock(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Algiers",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

export function formatAgeMinutes(
  minutes: number | null,
  locale: AnyLocale,
): string {
  if (minutes === null || !Number.isFinite(minutes)) return "-";
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) {
    return locale === "ar" ? `${rounded} د` : `${rounded}m`;
  }
  const hours = Math.floor(rounded / 60);
  if (hours < 48) {
    return locale === "ar" ? `${hours} س` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return locale === "ar" ? `${days} ي` : `${days}d`;
}
