import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import i18n, { type AnyLocale } from "@/i18n";
import {
  OEM_BATTERY_FAMILIES,
  OEM_STEP_KEYS,
  type OemBatteryFamily,
} from "@/lib/oem-battery";
import { OemBatteryGuide } from "./OemBatteryGuide";

function renderInLocale(
  locale: AnyLocale,
  props?: {
    defaultOpen?: boolean;
    defaultOem?: OemBatteryFamily;
    compact?: boolean;
  },
) {
  const instance = i18n.cloneInstance({ lng: locale });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <OemBatteryGuide {...props} />
    </I18nextProvider>,
  );
}

const LOCALES: readonly AnyLocale[] = ["ar", "fr", "en", "kab"];

describe("OemBatteryGuide component (SSR)", () => {
  it("renders collapsed by default with focusable >=44px toggle button and aria-expanded=false", () => {
    const html = renderInLocale("ar");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("min-h-11");
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("\u2014");
  });

  it("renders all 5 OEM families with 4 steps each across ar, fr, en and kab, plus honest Huawei HMS caveat", () => {
    expect(OEM_BATTERY_FAMILIES).toEqual([
      "xiaomi",
      "samsung",
      "huawei",
      "oppo",
      "tecno",
    ]);

    for (const locale of LOCALES) {
      const t = i18n.getFixedT(locale);
      for (const family of OEM_BATTERY_FAMILIES) {
        const html = renderInLocale(locale, {
          defaultOpen: true,
          defaultOem: family,
        });

        expect(html, `${locale}:${family}`).toContain('aria-expanded="true"');
        expect(html, `${locale}:${family}`).toContain('role="tablist"');
        expect(html, `${locale}:${family}`).toContain('role="tabpanel"');
        expect(html, `${locale}:${family}`).toContain("text-start");
        expect(html, `${locale}:${family}`).not.toContain("\u2014");
        expect(html, `${locale}:${family}`).not.toContain("text-faint");
        expect(html, `${locale}:${family}`).not.toContain("tracking-widest");
        expect(html, `${locale}:${family}`).not.toContain("animate-pulse");

        // All 5 tabs present with >=44px touch targets
        const tabButtons = html.match(/<button\b[^>]*role="tab"[^>]*>/g) ?? [];
        expect(tabButtons, `${locale}:${family}`).toHaveLength(5);
        for (const tab of tabButtons) {
          expect(tab, `${locale}:${family}`).toContain('type="button"');
          expect(tab, `${locale}:${family}`).toContain("min-h-11");
          expect(tab, `${locale}:${family}`).toContain("min-w-11");
        }

        // All 4 steps rendered non-empty
        for (const stepKey of OEM_STEP_KEYS) {
          const stepText = t(`oemBattery.oems.${family}.steps.${stepKey}`);
          expect(
            stepText.trim().length,
            `${locale}:${family}:${stepKey}`,
          ).toBeGreaterThan(10);
          // HTML-escape apostrophes and > to match React SSR output
          const escaped = stepText
            .replace(/&/g, "&amp;")
            .replace(/>/g, "&gt;")
            .replace(/'/g, "&#x27;");
          expect(html, `${locale}:${family}:${stepKey}`).toContain(escaped);
        }

        // Huawei HMS honest caveat appears on Huawei tab only
        const hmsEscaped = t("oemBattery.hmsCaveat")
          .replace(/&/g, "&amp;")
          .replace(/'/g, "&#x27;");
        if (family === "huawei") {
          expect(html, `${locale}:huawei-hms`).toContain(hmsEscaped);
        } else {
          expect(html, `${locale}:${family}-no-hms`).not.toContain(hmsEscaped);
        }
      }
    }
  });

  it("ensures every aria-controls attribute references a mounted DOM element id in both collapsed and expanded states", () => {
    const assertValidAriaControls = (html: string, label: string) => {
      const mountedIds = new Set(
        Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]!),
      );
      const controls = Array.from(
        html.matchAll(/\baria-controls="([^"]+)"/g),
        (match) => match[1]!,
      );
      for (const targetId of controls) {
        expect(mountedIds.has(targetId), `${label}:${targetId}`).toBe(true);
      }
      return controls;
    };

    const collapsed = renderInLocale("fr", { defaultOpen: false });
    expect(assertValidAriaControls(collapsed, "collapsed")).toEqual([]);

    for (const family of OEM_BATTERY_FAMILIES) {
      const expanded = renderInLocale("ar", {
        defaultOpen: true,
        defaultOem: family,
      });
      const controls = assertValidAriaControls(expanded, `open:${family}`);
      // Toggle button -> panelId, active tab -> activePanelId (inactive tabs omit aria-controls)
      expect(controls, `open:${family}`).toHaveLength(2);
      const tabButtons =
        expanded.match(/<button\b[^>]*role="tab"[^>]*>/g) ?? [];
      const tabsWithControls = tabButtons.filter((tab) =>
        tab.includes("aria-controls="),
      );
      expect(tabsWithControls, `open:${family}`).toHaveLength(1);
      expect(tabsWithControls[0], `open:${family}`).toContain(
        'aria-selected="true"',
      );
    }
  });
});
