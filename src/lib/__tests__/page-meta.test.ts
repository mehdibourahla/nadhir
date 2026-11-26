import { describe, expect, it } from "vitest";

import { bilingualSeoHead } from "@/lib/page-meta";

describe("bilingualSeoHead", () => {
  it("emits canonical, camelCase hrefLang alternates, robots, OG and Twitter metadata", () => {
    const head = bilingualSeoHead({
      title: "Algiers (16) Alerts and Multi-Hazard Outlook · Nadhir",
      description:
        "Official ONM · Météo Algérie warnings and active hazards for Algiers.",
      canonicalUrl: "https://nadhir.app/wilaya/alger?lang=fr",
      arUrl: "https://nadhir.app/wilaya/alger?lang=ar",
      frUrl: "https://nadhir.app/wilaya/alger?lang=fr",
      defaultUrl: "https://nadhir.app/wilaya/alger",
      locale: "fr",
      ogImageUrl:
        "https://nadhir.app/api/public/share/wilaya/alger.whatsapp.webp?lang=fr",
      ogImageAlt: "Multi-hazard alert summary for Wilaya of Alger, Algeria",
    });

    expect(head.links).toEqual([
      { rel: "canonical", href: "https://nadhir.app/wilaya/alger?lang=fr" },
      {
        rel: "alternate",
        hrefLang: "ar-DZ",
        href: "https://nadhir.app/wilaya/alger?lang=ar",
      },
      {
        rel: "alternate",
        hrefLang: "fr-DZ",
        href: "https://nadhir.app/wilaya/alger?lang=fr",
      },
      {
        rel: "alternate",
        hrefLang: "x-default",
        href: "https://nadhir.app/wilaya/alger",
      },
    ]);

    expect(head.meta).toContainEqual({
      name: "robots",
      content: "index, follow",
    });
    expect(head.meta).toContainEqual({
      property: "og:locale",
      content: "fr_DZ",
    });
    expect(head.meta).toContainEqual({
      property: "og:image",
      content:
        "https://nadhir.app/api/public/share/wilaya/alger.whatsapp.webp?lang=fr",
    });
    expect(head.meta).toContainEqual({
      property: "og:image:width",
      content: "1200",
    });
    expect(head.meta).toContainEqual({
      property: "og:image:height",
      content: "630",
    });
    expect(head.meta).toContainEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });

    const serialized = JSON.stringify(head);
    expect(serialized).not.toContain("\u2014");
    expect(serialized.toLowerCase()).not.toMatch(/\bsafe\b/);
  });

  it("maps Arabic and Kabyle locales cleanly and omits og:image when absent", () => {
    const arHead = bilingualSeoHead({
      title: "توقعات متعددة الأخطار · نذير",
      description: "نشريات ONM الرسمية.",
      canonicalUrl: "https://nadhir.app/forecast",
      arUrl: "https://nadhir.app/forecast?lang=ar",
      frUrl: "https://nadhir.app/forecast?lang=fr",
      defaultUrl: "https://nadhir.app/forecast",
      locale: "ar",
    });
    expect(arHead.meta).toContainEqual({
      property: "og:locale",
      content: "ar_DZ",
    });
    expect(arHead.meta.some((m) => m["property"] === "og:image")).toBe(false);

    const kabHead = bilingualSeoHead({
      title: "Tawilayt n Tizi Wezzu",
      description: "Ilɣa n ONM.",
      canonicalUrl: "https://nadhir.app/wilaya/tizi-ouzou?lang=kab",
      arUrl: "https://nadhir.app/wilaya/tizi-ouzou?lang=ar",
      frUrl: "https://nadhir.app/wilaya/tizi-ouzou?lang=fr",
      defaultUrl: "https://nadhir.app/wilaya/tizi-ouzou",
      locale: "kab",
    });
    expect(kabHead.meta).toContainEqual({
      property: "og:locale",
      content: "kab_DZ",
    });
  });
});
