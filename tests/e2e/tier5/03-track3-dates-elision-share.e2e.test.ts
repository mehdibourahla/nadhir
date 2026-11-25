import { describe, expect, it } from "vitest";

import { importRepoModule } from "../lib/env.ts";
import { fetchText } from "../lib/http.ts";
import {
  assertValidShareCardImage,
  SHARE_CARD_MAX_BYTES,
} from "../lib/image.ts";
import {
  findBannedSafeLabels,
  findEmDashesInText,
  stripHtmlForTextScan,
} from "../lib/playwright.ts";

describe("Tier 5 — Track 3 Dates, Unicode Elision, Share Cards & Arabic BiDi Hardening", () => {
  describe("T5-09: NaN / invalid date non-throwing guards", () => {
    it("returns safe empty fallback without throwing RangeError on invalid timestamps", async () => {
      const nadhirMod = await importRepoModule<{
        algiersTime: (iso: string) => string;
        relativeTime: (iso: string, locale: string, now?: number) => string;
      }>("src/lib/nadhir.ts");
      const shareMod = await importRepoModule<{
        algiersDateTime: (iso: string, locale: string) => string;
      }>("src/lib/share-card.ts");

      for (const bad of [
        "",
        "   ",
        "not-a-date",
        "2026-99-99",
        null as unknown as string,
        undefined as unknown as string,
      ]) {
        expect(() => nadhirMod.algiersTime(bad)).not.toThrow();
        expect(nadhirMod.algiersTime(bad)).toBe("");
        expect(() => nadhirMod.relativeTime(bad, "fr")).not.toThrow();
        expect(nadhirMod.relativeTime(bad, "fr")).toBe("");
        expect(() => shareMod.algiersDateTime(bad, "ar")).not.toThrow();
        expect(shareMod.algiersDateTime(bad, "ar")).toBe("");
      }

      // Valid timestamp still formats cleanly in Africa/Algiers
      expect(nadhirMod.algiersTime("2026-11-25T12:00:00Z")).toContain("13:00");
      expect(shareMod.algiersDateTime("2026-11-25T12:00:00Z", "fr")).toContain(
        "13:00",
      );
    });
  });

  describe("T5-10: Unicode lookbehind in applyFrenchElision", () => {
    it("preserves accented words ending in -de while eliding all vowel-initial Algerian wilayas", async () => {
      const mod = await importRepoModule<{
        applyFrenchElision: (text: string) => string;
        WILAYA_REGISTRY: readonly { code: string; nameFr: string }[];
      }>("src/lib/wilaya-slugs.ts");

      expect(mod.applyFrenchElision("procéde Alger")).toBe("procéde Alger");
      expect(mod.applyFrenchElision("côtéde Alger")).toBe("côtéde Alger");
      expect(mod.applyFrenchElision("méde Oran")).toBe("méde Oran");
      expect(mod.applyFrenchElision("2de Alger")).toBe("2de Alger");

      expect(mod.applyFrenchElision("Wilaya de Alger")).toBe("Wilaya d'Alger");
      expect(mod.applyFrenchElision("Wilaya de El Abiodh Sidi Cheikh")).toBe(
        "Wilaya d'El Abiodh Sidi Cheikh",
      );
      expect(mod.applyFrenchElision("Wilaya de Oran")).toBe("Wilaya d'Oran");

      expect(mod.WILAYA_REGISTRY).toHaveLength(69);
      const vowelInitial = /^[AEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜŒÆ]/i;
      for (const w of mod.WILAYA_REGISTRY) {
        const result = mod.applyFrenchElision(`Wilaya de ${w.nameFr}`);
        if (vowelInitial.test(w.nameFr)) {
          expect(result, w.nameFr).toBe(`Wilaya d'${w.nameFr}`);
        } else {
          expect(result, w.nameFr).toBe(`Wilaya de ${w.nameFr}`);
        }
      }
    });
  });

  describe("Universal Share Cards worst-case <= 37,888 bytes & XSS escaping", () => {
    it("renders worst-case longest wilaya + verbose Extreme ONM cards <= 37,888 bytes across all 4 locales x WhatsApp & Facebook", async () => {
      const renderMod = await importRepoModule<{
        renderUniversalShareCard: (
          model: unknown,
          opts: {
            format: "whatsapp" | "facebook";
            codec: "webp";
            maxBytes?: number;
          },
        ) => Promise<Uint8Array | null>;
      }>("src/lib/share-render.server.ts");
      const shareMod = await importRepoModule<{
        onmCardModel: (
          warning: Record<string, unknown>,
          wilayaLabel: string | null,
          t: (key: string, vars?: Record<string, string>) => string,
          lang: "ar" | "fr" | "en" | "kab",
        ) => unknown;
      }>("src/lib/share-card.ts");
      const translatorMod = await importRepoModule<{
        shareTranslator: (
          lang: "ar" | "fr" | "en" | "kab",
        ) => (key: string, vars?: Record<string, string>) => string;
      }>("src/lib/share-translator.ts");

      const locales = ["ar", "fr", "en", "kab"] as const;
      const formats = ["whatsapp", "facebook"] as const;

      for (const lang of locales) {
        const t = translatorMod.shareTranslator(lang);
        const model = shareMod.onmCardModel(
          {
            id: "onm-t5-worst",
            cap_id: "urn:oid:2.49.0.1.12.0.20261125.069",
            title:
              "نشرية جوية خاصة من المستوى الثالث أمطار رعدية غزيرة ورياح قوية جداً على ولاية الأبيض سيدي الشيخ والمناطق المجاورة",
            event: "Rain",
            severity: "Extreme",
            urgency: "Immediate",
            certainty: "Observed",
            onset: "2026-11-25T12:00:00Z",
            expires: "2026-11-26T00:00:00Z",
            sent: "2026-11-25T11:30:00Z",
            area_desc: "EL ABIODH SIDI CHEIKH",
            cap_url: "https://ametvigilance.meteo.dz/CAPs/worst.xml",
            wilaya_id: "69",
            headline_fr:
              "Bulletin Météorologique Spécial Niveau 3 Rouge : Pluies torrentielles exceptionnelles et rafales violentes sur El Abiodh Sidi Cheikh",
            superseded_at: null,
            msg_type: "Alert",
            cap_references: null,
            superseded_by: null,
            cancelled_at: null,
          },
          "El Abiodh Sidi Cheikh",
          t,
          lang,
        );

        for (const format of formats) {
          const bytes = await renderMod.renderUniversalShareCard(model, {
            format,
            codec: "webp",
            maxBytes: SHARE_CARD_MAX_BYTES,
          });
          expect(bytes, `${lang}/${format}`).toBeInstanceOf(Uint8Array);
          const info = await assertValidShareCardImage(
            bytes!,
            SHARE_CARD_MAX_BYTES,
          );
          expect(bytes!.byteLength, `${lang}/${format}`).toBeLessThanOrEqual(
            SHARE_CARD_MAX_BYTES,
          );
          expect(info.width, `${lang}/${format}`).toBeGreaterThan(100);
          expect(info.height, `${lang}/${format}`).toBeGreaterThan(100);
        }
      }
    });

    it("escapes XSS payloads and validates accentHex CSS breakout attempts in share card HTML", async () => {
      const htmlMod = await importRepoModule<{
        renderUniversalShareCardHtml: (
          model: Record<string, unknown>,
          format: "whatsapp" | "facebook",
        ) => string;
      }>("src/lib/share-card-html.ts");

      const html = htmlMod.renderUniversalShareCardHtml(
        {
          kind: "onm",
          lang: "fr",
          rtl: false,
          icon: "onm",
          accentHex: "#ff0000; background:url(javascript:alert(1))",
          badgeBgHex: "#1e293b",
          badgeFgHex: "#ffffff",
          eyebrow: "ONM · Météo Algérie",
          eyebrowLtr: false,
          badge: "<script>alert(1)</script>",
          badgeLtr: false,
          title: '<img src=x onerror="alert(2)">',
          subtitle: "El Abiodh Sidi Cheikh",
          metaLine: "25 nov. 2026 13:00",
          coordsLtr: null,
          disclaimer: null,
          timestamp: "25 nov. 2026 13:00",
          footer: "nadhir.app",
        },
        "facebook",
      );

      expect(html).not.toContain("<script>");
      expect(html).not.toContain('onerror="alert(2)"');
      expect(html).not.toContain("javascript:alert");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    });
  });

  describe("T5-12b: /forecast Arabic BiDi isolation of Law 26-06", () => {
    it("wraps statutory code 26-06 in <bdi dir='ltr'> on live SSR /forecast?lang=ar with zero em dashes or banned labels", async () => {
      const res = await fetchText("/forecast?lang=ar");
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<bdi\b[^>]*dir=["']ltr["'][^>]*>26-06<\/bdi>/i);
      const visible = stripHtmlForTextScan(res.text);
      expect(findBannedSafeLabels(visible)).toEqual([]);
      expect(findEmDashesInText(visible).count).toBe(0);
    });
  });
});
