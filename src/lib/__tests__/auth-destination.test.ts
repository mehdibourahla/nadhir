import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS } from "../admin-access";
import {
  authDestination,
  authRedirectSearch,
  extractLocaleFromDestination,
  resolveAuthLocale,
} from "../auth-destination";

describe("authentication destination", () => {
  it.each([
    "/alerts",
    "/settings",
    "/admin/reports",
    "/report?kind=road_blocked#details",
    "/?event=report:0c000000-0000-4000-8000-000000000001",
  ])("preserves %s", (path) => {
    expect(authDestination(path)).toBe(path);
  });
  it("preserves every admin section, so a new page is never blank after sign-in", () => {
    for (const section of ADMIN_SECTIONS)
      expect(authDestination(section.path)).toBe(section.path);
  });
  it.each([
    undefined,
    ["/alerts"],
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/auth?returnTo=/alerts",
    "/api/private/account",
    "/admin/../auth",
    "/%61uth",
    "/alerts\n",
    "/admin//evil",
  ])("rejects unsafe or unsupported destination %s", (path) => {
    expect(authDestination(path)).toBe("/zones");
  });

  describe("cold _authenticated redirect locale preservation", () => {
    it.each(["ar", "fr", "en", "kab"] as const)(
      "preserves valid ?lang=%s from location search on redirect",
      (lang) => {
        expect(
          authRedirectSearch(`/alerts?lang=${lang}`, `?lang=${lang}`),
        ).toEqual({
          returnTo: `/alerts?lang=${lang}`,
          lang,
        });
      },
    );

    it("falls back to parsing valid ?lang= from returnTo when searchStr is omitted", () => {
      expect(authRedirectSearch("/settings?lang=fr#privacy")).toEqual({
        returnTo: "/settings?lang=fr#privacy",
        lang: "fr",
      });
      expect(extractLocaleFromDestination("/alerts?lang=kab#top")).toBe("kab");
    });

    it("omits lang when query param is missing or invalid", () => {
      expect(authRedirectSearch("/alerts", "")).toEqual({
        returnTo: "/alerts",
      });
      expect(authRedirectSearch("/alerts?lang=de", "?lang=de")).toEqual({
        returnTo: "/alerts?lang=de",
      });
    });

    it("resolves explicit auth lang first, then falls back to returnTo lang", () => {
      expect(resolveAuthLocale("en", "/alerts?lang=fr")).toBe("en");
      expect(resolveAuthLocale(undefined, "/alerts?lang=fr")).toBe("fr");
      expect(resolveAuthLocale("invalid", "/settings?lang=kab")).toBe("kab");
      expect(resolveAuthLocale("invalid", "/settings")).toBeUndefined();
    });
  });
});
