import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import i18n, { type AnyLocale } from "@/i18n";
import {
  buildAlertProvenance,
  parseProvenancePayload,
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

  it("defensively sanitizes direct hostile AlertProvenanceData across all 4 locales", () => {
    const hostile: AlertProvenanceData = {
      triggerKind:
        "unknown_trigger" as unknown as AlertProvenanceData["triggerKind"],
      areaLabel: "\u2014",
      radiusKm: Number.NaN,
      sourceKey: "emsc",
      sourceAttribution: "\u2014",
      ruleLabelKey: "provenance.rule",
      observedAt: "2026-02-31T00:00:00Z",
      authorityStatus:
        "safe" as unknown as AlertProvenanceData["authorityStatus"],
    };

    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      const html = renderInLocale(locale, hostile, { defaultExpanded: true });

      expect(html, `${locale}: no object-key error`).not.toContain(
        "returned an object",
      );
      expect(html, `${locale}: falls back to generic rule`).toContain(
        t("provenance.rule.generic"),
      );
      expect(html, `${locale}: falls back to national_feed trigger`).toContain(
        t("provenance.trigger.national_feed"),
      );
      expect(html, `${locale}: omits banned authority status`).not.toContain(
        "provenance.authority.safe",
      );
      expect(html, `${locale}: omits NaN radius`).not.toContain("NaN");
      expect(html, `${locale}: renders Not recorded`).toContain(
        t("common.notRecorded"),
      );
      expect(html, `${locale}: rejects invalid calendar date`).not.toContain(
        "<time",
      );
      expect(html, `${locale}: zero em dashes`).not.toContain("\u2014");
    }

    const genericRuleEn = i18n.getFixedT("en")("provenance.rule.generic");

    for (const badRadius of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const watchWithBadRadius: AlertProvenanceData = {
        triggerKind: "watch_zone",
        areaLabel: "Alger \u2014 Centre",
        radiusKm: badRadius,
        sourceKey: "dgpc_telegram",
        sourceAttribution: "DGPC",
        ruleLabelKey: "provenance",
        observedAt: "1",
      };
      const html = renderInLocale("en", watchWithBadRadius, {
        defaultExpanded: true,
      });
      expect(html, `radius=${String(badRadius)}`).not.toContain("within");
      expect(html, `radius=${String(badRadius)}`).toContain("Alger · Centre");
      expect(html, `radius=${String(badRadius)}`).not.toContain("\u2014");
      expect(html, `radius=${String(badRadius)}`).not.toContain("<time");
      expect(html, `radius=${String(badRadius)}`).toContain(genericRuleEn);
    }

    const nonStringSource: AlertProvenanceData = {
      triggerKind: "national_feed",
      areaLabel: "   ",
      radiusKm: null,
      sourceKey: "emsc",
      sourceAttribution: Object.prototype as unknown as string,
      ruleLabelKey: "   ",
      observedAt: OBSERVED_ISO,
    };
    const nonStringHtml = renderInLocale("en", nonStringSource, {
      defaultExpanded: true,
    });
    expect(nonStringHtml).toContain("Not recorded");
    expect(nonStringHtml).toContain(genericRuleEn);

    const protoParsed = parseProvenancePayload({
      provenance_trigger: "national_feed",
      provenance_source_key: "__proto__",
      provenance_observed_at: OBSERVED_ISO,
    });
    expect(protoParsed).not.toBeNull();
    const protoHtml = renderInLocale("en", protoParsed!, {
      defaultExpanded: true,
    });
    expect(protoHtml).toContain("__proto__");
  });

  it("normalizes regional i18n language tags (kab-DZ, ar-DZ, fr-FR, en-US) cleanly", () => {
    for (const lng of ["kab-DZ", "ar-DZ", "fr-FR", "en-US"]) {
      const instance = i18n.cloneInstance({ lng });
      const html = renderToStaticMarkup(
        <I18nextProvider i18n={instance}>
          <AlertProvenance
            provenance={onmProvenance}
            now={FIXED_NOW}
            defaultExpanded
          />
        </I18nextProvider>,
      );
      expect(html, `lng=${lng}`).toContain(`dateTime="${OBSERVED_ISO}"`);
      expect(html, `lng=${lng}`).not.toContain("\u2014");
    }
  });

  it("renders whitespace-padded valid ISO observedAt without throwing and emits trimmed dateTime", () => {
    const trimmedIso = "2026-11-24T12:00:00Z";
    for (const paddedIso of [`  ${trimmedIso}  `, `\n${trimmedIso}\t`]) {
      const paddedProvenance: AlertProvenanceData = {
        triggerKind: "wilaya_warning",
        areaLabel: "Alger",
        radiusKm: null,
        sourceKey: "onm",
        sourceAttribution: "ONM · Météo Algérie",
        ruleLabelKey: "provenance.rule.onmSevere",
        observedAt: paddedIso,
        authorityStatus: "official",
      };

      const collapsedHtml = renderInLocale("en", paddedProvenance);
      expect(collapsedHtml).toContain(`dateTime="${trimmedIso}"`);
      expect(collapsedHtml).not.toContain("\u2014");

      const expandedHtml = renderInLocale("en", paddedProvenance, {
        defaultExpanded: true,
      });
      expect(expandedHtml).toContain(`dateTime="${trimmedIso}"`);
      expect(expandedHtml).not.toContain(`dateTime="${paddedIso}"`);
      expect(expandedHtml).not.toContain("\u2014");
    }
  });

  it("rejects ruleLabelKey templates with uninterpolated {{...}} tokens and falls back to generic rule", () => {
    const templateRuleProvenance: AlertProvenanceData = {
      triggerKind: "watch_zone",
      areaLabel: "Azazga",
      radiusKm: 20,
      sourceKey: "dgpc_telegram",
      sourceAttribution: "DGPC",
      ruleLabelKey: "provenance.radiusKm",
      observedAt: OBSERVED_ISO,
      authorityStatus: "official",
    };

    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      const html = renderInLocale(locale, templateRuleProvenance, {
        defaultExpanded: true,
      });
      expect(html, `${locale}: no uninterpolated {{km}}`).not.toContain(
        "{{km}}",
      );
      expect(html, `${locale}: no raw template braces`).not.toContain("{{");
      expect(html, `${locale}: falls back to generic rule`).toContain(
        t("provenance.rule.generic"),
      );
    }
  });

  it("handles pathological repeated opening braces in linear time (M0 INFO-1 guard)", () => {
    const pathological = "{{".repeat(5000);
    const prov: AlertProvenanceData = {
      triggerKind: "national_feed",
      areaLabel: "Alger",
      sourceKey: "emsc",
      sourceAttribution: "EMSC",
      ruleLabelKey: pathological,
      observedAt: OBSERVED_ISO,
      authorityStatus: "observed",
    };
    const start = performance.now();
    const html = renderInLocale("en", prov, { defaultExpanded: true });
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(200);
    expect(html).toContain("EMSC");
    expect(html).not.toContain("\u2014");
  });
});
