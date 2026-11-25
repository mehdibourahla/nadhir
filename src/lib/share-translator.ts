import i18n from "@/i18n";
import type { AnyLocale } from "@/i18n/locales-list";
import type { Translate } from "@/lib/share-card";

export function shareTranslator(lang: AnyLocale): Translate {
  const fixed = i18n.getFixedT(lang);
  return (key, vars) => fixed(key, vars ?? {});
}
