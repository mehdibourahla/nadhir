import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import i18n, { type AnyLocale } from "@/i18n";
import {
  buildAlertProvenance,
  type AlertProvenanceData,
} from "@/lib/alert-provenance";

import { AlertProvenance } from "./AlertProvenance";

const FIXED_NOW = Date.parse("2026-11-24T13:00:00Z");
const OBSERVED_ISO = "2026-11-24T12:45:00Z";

function renderInLocale(
  locale: AnyLocale,
  provenance: AlertProvenanceData,
  props?: { compact?: boolean; defaultExpanded?: boolean },
) {
  const instance = i18n.cloneInstance({ lng: locale });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <AlertProvenance
        provenance={provenance}
        now={FIXED_NOW}
        compact={props?.compact}
        defaultExpanded={props?.defaultExpanded}
      />
    </I18nextProvider>,
  );
}

describe("AlertProvenance component (SSR)", () => {
  const onmProvenance = buildAlertProvenance({
    triggerKind: "wilaya_warning",
    areaLabel: "Tizi Ouzou",
    sourceKey: "onm",
    sourceAttribution: "ONM · Météo Algérie",
    ruleLabelKey: "provenance.rule.onmExtreme",
    observedAt: OBSERVED_ISO,
    authorityStatus: "official",
  });

  it("renders collapsed by default with R-03 touch target, R-32 focusability and summary metadata", () => {
    const html = renderInLocale("en", onmProvenance);

    expect(html).toContain("Why am I seeing this?");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("ONM · Météo Algérie");
    expect(html).toContain("Wilaya-level bulletin");
    expect(html).toContain(`dateTime="${OBSERVED_ISO}"`);
    expect(html).not.toContain("<dl");
  });

  it("omits the summary metadata line in compact mode", () => {
    const html = renderInLocale("en", onmProvenance, { compact: true });

    expect(html).toContain("Why am I seeing this?");
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("ONM · Météo Algérie");
  });

  it("renders full structured provenance details when expanded, including watch_zone radius", () => {
    const watchZone = buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: "Azazga",
      radiusKm: 20,
      sourceKey: "dgpc_telegram",
      sourceAttribution: "DGPC",
      ruleLabelKey: "provenance.rule.dgpcFire",
      observedAt: OBSERVED_ISO,
      authorityStatus: "official",
    });

    const html = renderInLocale("en", watchZone, { defaultExpanded: true });

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("<dl");
    expect(html).toContain("Your watch zone");
    expect(html).toContain("Azazga");
    expect(html).toContain("within 20 km");
    expect(html).toContain("Official Civil Protection fire incident");
    expect(html).toContain("DGPC");
    expect(html).toContain("Official authority");
    expect(html).toContain(`dateTime="${OBSERVED_ISO}"`);
  });

  it("renders honest localized Not recorded fallbacks when areaLabel is null or observedAt is invalid", () => {
    const degraded = buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: null,
      sourceKey: "emsc",
      sourceAttribution: "EMSC",
      ruleLabelKey: "provenance.rule.m4Quake",
      observedAt: "not-a-valid-date",
      authorityStatus: "observed",
    });

    const htmlEn = renderInLocale("en", degraded, { defaultExpanded: true });
    expect(htmlEn).toContain("Not recorded");
    expect(htmlEn).not.toContain("<time");
    expect(htmlEn).not.toContain("\u2014");

    const htmlAr = renderInLocale("ar", degraded, { defaultExpanded: true });
    expect(htmlAr).toContain("غير مسجل");
    expect(htmlAr).not.toContain("\u2014");
  });

  it("satisfies antislop R-02/R-03/R-06/R-25/R-32 and ADR-0002 invariants across ar, fr, en and kab", () => {
    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const html = renderInLocale(locale, onmProvenance, {
        defaultExpanded: true,
      });
      expect(html, `${locale}: no em dashes`).not.toContain("\u2014");
      expect(html, `${locale}: no text-faint`).not.toContain("text-faint");
      expect(html, `${locale}: no uppercase tracking-widest`).not.toContain(
        "tracking-widest",
      );
      expect(html, `${locale}: verbatim ONM attribution`).toContain(
        "ONM · Météo Algérie",
      );
      expect(html, `${locale}: 44px touch target`).toContain("min-h-11");
      expect(html, `${locale}: keyboard focusable`).toContain('tabindex="0"');
      expect(html, `${locale}: dir=auto on authority text`).toContain(
        'dir="auto"',
      );
      expect(html.toLowerCase(), `${locale}: no 'safe' status`).not.toMatch(
        />\s*safe\s*</,
      );
    }
  });
});
