import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import i18n, { type AnyLocale } from "@/i18n";
import { UniversalShareSheet } from "./UniversalShareSheet";

const LOCALES: readonly AnyLocale[] = ["ar", "fr", "en", "kab"];

describe("UniversalShareSheet", () => {
  it("renders SSR trigger with >= 44px touch target across all 4 locales without raw keys or em dashes", () => {
    for (const lang of LOCALES) {
      const instance = i18n.cloneInstance({ lng: lang });
      const html = renderToStaticMarkup(
        <I18nextProvider i18n={instance}>
          <UniversalShareSheet
            kind="wilaya"
            id="alger"
            lang={lang}
            placeLabel={lang === "ar" ? "الجزائر" : "Alger"}
            shareUrl={`https://nadhir.app/wilaya/alger?lang=${lang}`}
          />
        </I18nextProvider>,
      );

      expect(html).toContain("min-h-11");
      expect(html).not.toContain("track3.share.");
      expect(html).not.toContain("\u2014");
      expect(html).not.toMatch(/\bSafe\b/);
    }
  });
});
