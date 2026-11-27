import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import i18n, { type AnyLocale } from "@/i18n";
import { EMERGENCY_HAZARDS, type EmergencyHazardKind } from "@/lib/survival";
import { StandingGuidanceCard } from "./StandingGuidanceCard";

function renderCard(
  locale: AnyLocale,
  hazard: EmergencyHazardKind,
  offshoreM5Plus = false,
) {
  const instance = i18n.cloneInstance({ lng: locale });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <StandingGuidanceCard
        hazard={hazard}
        offshoreM5Plus={offshoreM5Plus}
        online={false}
        onSelectHazard={() => {}}
      />
    </I18nextProvider>,
  );
}

describe("StandingGuidanceCard", () => {
  it("renders all 5 >=44px hazard pills and isolated guidance across ar, fr, en and kab with zero em dashes", () => {
    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      for (const hazard of EMERGENCY_HAZARDS) {
        const html = renderCard(locale, hazard, false);
        expect(html, `${locale}/${hazard}`).toContain(
          `data-standing-guidance="${hazard}"`,
        );
        expect(html, `${locale}/${hazard}`).toContain("min-h-11");
        expect(html, `${locale}/${hazard}`).toContain(
          `data-emergency-hazard="${hazard}"`,
        );
        expect(html, `${locale}/${hazard}`).toContain(
          t(`track3.emergency.guidance.${hazard}.title`),
        );
        expect(html, `${locale}/${hazard}`).not.toContain(
          'data-coastal-tsunami="true"',
        );
        expect(html, `${locale}/${hazard}`).not.toContain("\u2014");
      }
    }
  });

  it("shows coastal tsunami guidance ONLY when hazard is earthquake and offshoreM5Plus is true", () => {
    const offshoreHtml = renderCard("en", "earthquake", true);
    expect(offshoreHtml).toContain('data-coastal-tsunami="true"');
    expect(offshoreHtml).toContain("Offshore M5.0+ earthquake recorded");

    const inlandHtml = renderCard("en", "earthquake", false);
    expect(inlandHtml).not.toContain('data-coastal-tsunami="true"');
    expect(inlandHtml).not.toContain("Offshore M5.0+");

    const floodHtml = renderCard("en", "flood", true);
    expect(floodHtml).not.toContain('data-coastal-tsunami="true"');
    expect(floodHtml.toLowerCase()).not.toContain("smoke");
    expect(floodHtml.toLowerCase()).not.toContain("wildfire");
  });
});
