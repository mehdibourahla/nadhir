import type { Locale } from "@/i18n";
import { intlLocale } from "@/lib/nadhir";

export function absoluteTime(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Algiers",
  }).format(new Date(iso));
}
