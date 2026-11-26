import { parseAnyLocaleParam, parseAnyQueryLocale } from "@/i18n/locale-cookie";
import type { AnyLocale } from "@/i18n/locales-list";

import { ADMIN_SECTIONS } from "./admin-access";

const ADMIN_PATHS = new Set(ADMIN_SECTIONS.map((section) => section.path));

export function authDestination(value: unknown): string {
  if (
    typeof value !== "string" ||
    [...value].some(
      (character) =>
        character === "\\" ||
        character.charCodeAt(0) <= 32 ||
        character.charCodeAt(0) === 127,
    )
  )
    return "/zones";
  const path = value.split(/[?#]/, 1)[0] ?? "";
  if (
    path !== "/" &&
    !/^\/(zones|alerts|settings|webhooks|report)\/?$/.test(path) &&
    !ADMIN_PATHS.has(path.replace(/(.)\/$/, "$1"))
  )
    return "/zones";
  return value;
}

export function extractLocaleFromDestination(
  destination: string,
): AnyLocale | undefined {
  const firstHash = destination.indexOf("#");
  const beforeHash =
    firstHash === -1 ? destination : destination.slice(0, firstHash);
  const queryStart = beforeHash.indexOf("?");
  if (queryStart === -1) return undefined;
  return parseAnyQueryLocale(beforeHash.slice(queryStart)) ?? undefined;
}

export function resolveAuthLocale(
  rawLang: unknown,
  returnTo: string,
): AnyLocale | undefined {
  const direct =
    typeof rawLang === "string" ? parseAnyLocaleParam(rawLang) : null;
  return direct ?? extractLocaleFromDestination(returnTo);
}

export function authRedirectSearch(
  locationHref: string,
  locationSearchStr?: string,
): { returnTo: string; lang?: AnyLocale } {
  const returnTo = authDestination(locationHref);
  const lang =
    (locationSearchStr ? parseAnyQueryLocale(locationSearchStr) : null) ??
    extractLocaleFromDestination(returnTo);
  return lang ? { returnTo, lang } : { returnTo };
}
