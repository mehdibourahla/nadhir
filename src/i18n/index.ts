import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { adminEn } from "./admin/en";
import { adminAr } from "./admin/ar";
import { adminKab } from "./admin/kab";
import { overlay } from "./overlay";
import { adminFr } from "./admin/fr";
import { ar } from "./locales/ar";
import { en } from "./locales/en";
import { fr } from "./locales/fr";
import { kab } from "./locales/kab";
import { weatherAr, weatherEn, weatherFr, weatherKab } from "./weather";

export {
  LOCALES,
  RTL_LOCALES,
  type Locale,
  type AnyLocale,
} from "./locales-list";
import {
  LOCALES,
  RTL_LOCALES,
  type Locale,
  type AnyLocale,
} from "./locales-list";
import {
  LOCALE_COOKIE,
  readLocaleCookie,
  writeLocaleCookie,
} from "./locale-cookie";

export { readLocaleCookie };

export const LOCALE_LABELS: Record<AnyLocale, string> = {
  ar: "العربية",
  fr: "Français",
  en: "English",
  kab: "Taqbaylit",
};

// full labels overflow a 390px header, so narrow screens show codes instead
export const LOCALE_SHORT_LABELS: Record<AnyLocale, string> = {
  ar: "AR",
  fr: "FR",
  en: "EN",
  kab: "KAB",
};

const STORAGE_KEY = "nadhir.locale";

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      ar: { translation: ar, admin: adminAr, weather: weatherAr },
      fr: { translation: fr, admin: adminFr, weather: weatherFr },
      en: { translation: en, admin: adminEn, weather: weatherEn },
      kab: {
        translation: kab,
        admin: overlay(adminFr, adminKab),
        weather: weatherKab,
      },
    },
    lng: "ar",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

function detectLocale(): Locale {
  if (typeof window === "undefined") return "ar";
  return readLocaleCookie();
}

export function applyLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
  window.localStorage.setItem(STORAGE_KEY, locale);
  writeLocaleCookie(locale);
}

/** Keeps <html lang/dir> in sync with the locale resolved from the cookie. */
export function syncClientLocale() {
  if (typeof window === "undefined") return;
  applyLocale(detectLocale());
}

/**
 * On the server the module-level i18n is shared by every in-flight request, and
 * changeLanguage is async — so one request could render in another's language.
 * Server renders get their own instance; the browser keeps the singleton so
 * applyLocale still switches the live tree.
 */
export function localeInstance(locale: Locale) {
  if (typeof window === "undefined") {
    return i18n.cloneInstance({ lng: locale });
  }
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
  return i18n;
}

/**
 * Route `head` runs outside React, so it cannot use hooks. getFixedT binds a
 * translator to one language without mutating the instance shared by in-flight
 * server requests.
 */
export function headTranslator() {
  return i18n.getFixedT(readLocaleCookie());
}

/** Runs on both server and client before render so SSR and hydration agree. */
export function initLocale(): Locale {
  const locale = readLocaleCookie();
  if (typeof window !== "undefined" && i18n.language !== locale) {
    void i18n.changeLanguage(locale);
  }
  return locale;
}

export default i18n;
