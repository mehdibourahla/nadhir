import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { algiersTime } from "@/lib/nadhir";
import { applyFrenchElision } from "@/lib/wilaya-slugs";
import { AlertProvenance } from "@/ui/alert-provenance";
import { OemBatteryGuide, UserPushTest } from "@/ui/push-diagnostics";

const ROOT = process.cwd();

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

describe("M6.4 UI/Craft visual polish & RTL/BiDi guarantees", () => {
  it("formats algiersTime() strictly in 24-hour Africa/Algiers time with zero AM/PM", () => {
    const evening = algiersTime("2026-11-25T18:35:00Z");
    expect(evening).toContain("25/11");
    expect(evening).toContain("19:35");
    expect(evening).not.toMatch(/\b(?:AM|PM)\b/i);

    const midnight = algiersTime("2026-11-25T23:15:00Z");
    expect(midnight).toContain("26/11");
    expect(midnight).toContain("00:15");
    expect(midnight).not.toContain("24:15");
    expect(midnight).not.toMatch(/\b(?:AM|PM)\b/i);

    const morning = algiersTime("2026-11-25T07:05:00Z");
    expect(morning).toContain("25/11");
    expect(morning).toContain("08:05");
    expect(morning).not.toMatch(/\b(?:AM|PM)\b/i);
  });

  it("renders AlertProvenance with focusable disclosure button and min-h-11 touch target across locales", () => {
    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const instance = i18n.cloneInstance({ lng: locale });
      const html = renderToStaticMarkup(
        <I18nextProvider i18n={instance}>
          <AlertProvenance
            area="Alger"
            source="onm_vigilance"
            observedAt="2026-11-25T18:35:00Z"
          />
        </I18nextProvider>,
      );
      expect(html, locale).toContain('aria-expanded="false"');
      expect(html, locale).toContain("min-h-11");
      expect(html, locale).not.toContain("\u2014");
    }
  });

  it("renders UserPushTest and OemBatteryGuide with accessible 44px controls and all 5 Android OEMs", () => {
    const instanceFr = i18n.cloneInstance({ lng: "fr" });
    const pushHtml = renderToStaticMarkup(
      <I18nextProvider i18n={instanceFr}>
        <UserPushTest mode="authenticated" />
      </I18nextProvider>,
    );
    expect(pushHtml).toContain("min-h-11");
    expect(pushHtml).not.toContain("\u2014");

    const guideHtml = renderToStaticMarkup(
      <I18nextProvider i18n={instanceFr}>
        <OemBatteryGuide />
      </I18nextProvider>,
    );
    expect(guideHtml).toContain("flex-col");
    expect(guideHtml).toContain("min-h-11");
    for (const oem of ["Xiaomi", "Samsung", "Huawei", "Oppo", "Tecno"]) {
      expect(guideHtml).toContain(oem);
    }
  });

  it("applies French elision cleanly for vowel-initial wilayas", () => {
    expect(applyFrenchElision("Wilaya de Alger")).toBe("Wilaya d'Alger");
    expect(applyFrenchElision("Wilaya de Oran")).toBe("Wilaya d'Oran");
    expect(applyFrenchElision("Wilaya de Tindouf")).toBe("Wilaya de Tindouf");
  });

  it("handles French alerts.unread singular/plural cleanly and preserves 4-locale parity", () => {
    const tFr = i18n.getFixedT("fr");
    expect(tFr("alerts.unread", { count: 1 })).toBe("1 non lue");
    expect(tFr("alerts.unread", { count: 3 })).toBe("3 non lues");

    const tAr = i18n.getFixedT("ar");
    expect(tAr("alerts.unread", { count: 1 })).toBe("1 غير مقروءة");
    expect(tAr("alerts.unread", { count: 3 })).toBe("3 غير مقروءة");
  });

  it("enforces layout/RTL/BiDi structural guards across Atlas home, survival, rail, map, alerts, and wilaya views", () => {
    const home = readSource("src/routes/index.tsx");
    expect(home).toContain("AtlasHazardMap");
    expect(home).toContain("Basemap mode");
    expect(home).toContain("AlgiersClock");
    expect(home).toContain("satelliteRainfallQuery");
    expect(home).toContain("lightningObservationsQuery");
    expect(home).toContain("gwisBurnedAreasQuery");

    const survival = readSource("src/routes/survival/route.tsx");
    expect(survival).toContain("flex-wrap");

    const shell = readSource("src/ui/app-shell.tsx");
    expect(shell).toContain("start-0");
    expect(shell).toContain("w-[68px]");

    const styles = readSource("src/styles.css");
    expect(styles).toContain("direction: ltr !important;");

    const wilaya = readSource("src/routes/wilaya.$slug.tsx");
    expect(wilaya).toContain("SafeBdi");

    const alerts = readSource("src/routes/_authenticated/alerts.tsx");
    expect(alerts).toContain("AlertProvenance");
    expect(alerts).toContain('SafeBdi dir="auto"');
  });
});
