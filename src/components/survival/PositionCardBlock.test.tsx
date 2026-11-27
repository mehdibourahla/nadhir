import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import i18n, { type AnyLocale } from "@/i18n";
import type { PositionCard } from "@/lib/survival";
import { PositionCardBlock } from "./PositionCardBlock";

function renderBlock(
  locale: AnyLocale,
  card: PositionCard | null,
  opts?: { online?: boolean; positionDenied?: boolean },
) {
  const instance = i18n.cloneInstance({ lng: locale });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <PositionCardBlock
        card={card}
        online={opts?.online ?? false}
        positionDenied={opts?.positionDenied ?? false}
      />
    </I18nextProvider>,
  );
}

describe("PositionCardBlock", () => {
  const sampleCard: PositionCard = {
    commune: "Azazga",
    wilaya: "Tizi Ouzou",
    nearest: { name: "Yakouren", km: 3.4, bearing: 180 },
    coords: "36.7450 N · 4.3712 E",
  };

  it("renders commune, wilaya, nearest settlement, dir=ltr plain lat/lon coordinates and >=44px copy button across all 4 locales", () => {
    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      const html = renderBlock(locale, sampleCard, { online: true });
      expect(html, locale).toContain('data-position-card="true"');
      expect(html, locale).toContain("Azazga, Tizi Ouzou");
      expect(html, locale).toContain("Yakouren");
      expect(html, locale).toContain('dir="ltr"');
      expect(html, locale).toContain("36.7450 N · 4.3712 E");
      expect(html, locale).toContain("min-h-11");
      expect(html, locale).toContain(t("track3.emergency.copyCoords"));
      expect(html, locale).not.toContain("\u2014");
    }
  });

  it("renders honest localized fallbacks without em dashes when GPS is unavailable", () => {
    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      const html = renderBlock(locale, null, {
        online: false,
        positionDenied: true,
      });
      expect(html, locale).toContain(t("survival.positionUnknown"));
      expect(html, locale).not.toContain("\u2014");
    }
  });
});
