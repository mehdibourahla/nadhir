import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestUrl } from "@tanstack/react-start/server";

import { NATIVE } from "@/lib/platform";

import {
  LOCALES,
  UNREVIEWED_LOCALES,
  type AnyLocale,
  type Locale,
} from "./locales-list";

export const LOCALE_COOKIE = "nadhir_locale";

const ALL_LOCALES: readonly AnyLocale[] = [...LOCALES, ...UNREVIEWED_LOCALES];

export function parseLocale(value: string | null | undefined): Locale {
  return (LOCALES as readonly string[]).includes(value ?? "")
    ? (value as Locale)
    : "ar";
}

export function parseLocaleParam(
  value: string | null | undefined,
): Locale | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return (LOCALES as readonly string[]).includes(normalized)
    ? (normalized as Locale)
    : null;
}

export function parseAnyLocaleParam(
  value: string | null | undefined,
): AnyLocale | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return (ALL_LOCALES as readonly string[]).includes(normalized)
    ? (normalized as AnyLocale)
    : null;
}

export function parseQueryLocale(
  search: string | URLSearchParams | null | undefined,
): Locale | null {
  if (!search) return null;
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  return parseLocaleParam(params.get("lang"));
}

export function parseAnyQueryLocale(
  search: string | URLSearchParams | null | undefined,
): AnyLocale | null {
  if (!search) return null;
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  return parseAnyLocaleParam(params.get("lang"));
}

function parse(cookieHeader: string | null | undefined): Locale {
  if (!cookieHeader) return "ar";
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  return parseLocale(match?.slice(LOCALE_COOKIE.length + 1));
}

export function resolveRequestLocale(opts: {
  search?: string | URLSearchParams | null | undefined;
  cookieHeader?: string | null | undefined;
  storedLocale?: string | null | undefined;
  isNative?: boolean | undefined;
}): Locale {
  const fromQuery = parseQueryLocale(opts.search);
  if (fromQuery) return fromQuery;
  return opts.isNative
    ? parseLocale(opts.storedLocale)
    : parse(opts.cookieHeader);
}

/**
 * Like `resolveRequestLocale`, but also honors unreviewed locales such as
 * `?lang=kab` when explicitly requested via query string while keeping
 * cookie/storage persistence restricted to reviewed `Locale` values.
 */
export function resolveActiveLocale(opts: {
  search?: string | URLSearchParams | null | undefined;
  cookieHeader?: string | null | undefined;
  storedLocale?: string | null | undefined;
  isNative?: boolean | undefined;
}): AnyLocale {
  const fromQuery = parseAnyQueryLocale(opts.search);
  if (fromQuery) return fromQuery;
  return resolveRequestLocale(opts);
}

/**
 * Resolve the request locale identically on the server and on the client so the
 * SSR markup and the hydrated tree render the same language.
 * Explicit valid `?lang=` takes precedence over the persisted cookie.
 */
export const readLocaleCookie = createIsomorphicFn()
  .server((): Locale => {
    let search: URLSearchParams | null;
    try {
      search = getRequestUrl().searchParams;
    } catch {
      search = null;
    }
    let cookieHeader: string | null | undefined;
    try {
      cookieHeader = getRequestHeader("cookie");
    } catch {
      cookieHeader = null;
    }
    return resolveRequestLocale({ search, cookieHeader });
  })
  .client((): Locale =>
    resolveRequestLocale({
      search: typeof window !== "undefined" ? window.location.search : null,
      cookieHeader: typeof document !== "undefined" ? document.cookie : null,
      storedLocale:
        NATIVE && typeof window !== "undefined"
          ? window.localStorage.getItem("nadhir.locale")
          : null,
      isNative: NATIVE,
    }),
  );

/**
 * Like `readLocaleCookie`, but preserves explicit `?lang=kab` on both SSR and
 * client hydration so `<html lang="kab" dir="ltr">` and page copy agree.
 */
export const readActiveLocale = createIsomorphicFn()
  .server((): AnyLocale => {
    let search: URLSearchParams | null;
    try {
      search = getRequestUrl().searchParams;
    } catch {
      search = null;
    }
    let cookieHeader: string | null | undefined;
    try {
      cookieHeader = getRequestHeader("cookie");
    } catch {
      cookieHeader = null;
    }
    return resolveActiveLocale({ search, cookieHeader });
  })
  .client((): AnyLocale =>
    resolveActiveLocale({
      search: typeof window !== "undefined" ? window.location.search : null,
      cookieHeader: typeof document !== "undefined" ? document.cookie : null,
      storedLocale:
        NATIVE && typeof window !== "undefined"
          ? window.localStorage.getItem("nadhir.locale")
          : null,
      isNative: NATIVE,
    }),
  );

export function writeLocaleCookie(locale: Locale) {
  if (NATIVE) return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}
