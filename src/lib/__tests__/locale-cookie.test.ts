import { describe, expect, it } from "vitest";

import {
  LOCALE_COOKIE,
  parseAnyQueryLocale,
  parseLocale,
  parseQueryLocale,
  resolveRequestLocale,
} from "@/i18n/locale-cookie";

describe("locale-cookie", () => {
  it("keeps parseLocale defaulting unknown and unreviewed locales to ar", () => {
    expect(parseLocale("ar")).toBe("ar");
    expect(parseLocale("fr")).toBe("fr");
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("kab")).toBe("ar");
    expect(parseLocale("de")).toBe("ar");
    expect(parseLocale(null)).toBe("ar");
  });

  it("parses explicit ?lang= query parameters case-insensitively", () => {
    expect(parseQueryLocale("?lang=fr")).toBe("fr");
    expect(parseQueryLocale("?foo=1&lang=EN")).toBe("en");
    expect(parseQueryLocale(new URLSearchParams("lang=ar"))).toBe("ar");
    expect(parseQueryLocale("?lang=kab")).toBeNull();
    expect(parseQueryLocale("?lang=invalid")).toBeNull();
    expect(parseQueryLocale("")).toBeNull();
  });

  it("parses all four locales including kab via parseAnyQueryLocale", () => {
    expect(parseAnyQueryLocale("?lang=ar")).toBe("ar");
    expect(parseAnyQueryLocale("?lang=fr")).toBe("fr");
    expect(parseAnyQueryLocale("?lang=en")).toBe("en");
    expect(parseAnyQueryLocale("?lang=kab")).toBe("kab");
    expect(parseAnyQueryLocale("?lang=es")).toBeNull();
  });

  it("prefers explicit ?lang= ahead of cookie and stored native preference", () => {
    expect(
      resolveRequestLocale({
        search: "?lang=fr",
        cookieHeader: `${LOCALE_COOKIE}=ar`,
      }),
    ).toBe("fr");
    expect(
      resolveRequestLocale({
        search: "?lang=ar",
        cookieHeader: `${LOCALE_COOKIE}=fr`,
      }),
    ).toBe("ar");
    expect(
      resolveRequestLocale({
        search: "?lang=en",
        storedLocale: "fr",
        isNative: true,
      }),
    ).toBe("en");
  });

  it("falls back to cookie or stored preference when ?lang= is missing or invalid", () => {
    expect(
      resolveRequestLocale({
        search: "?lang=xx",
        cookieHeader: `foo=bar; ${LOCALE_COOKIE}=fr`,
      }),
    ).toBe("fr");
    expect(
      resolveRequestLocale({
        search: "",
        cookieHeader: null,
      }),
    ).toBe("ar");
    expect(
      resolveRequestLocale({
        search: "",
        storedLocale: "en",
        isNative: true,
      }),
    ).toBe("en");
  });
});
