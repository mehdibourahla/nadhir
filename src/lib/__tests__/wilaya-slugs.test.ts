import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SITE_URL,
  WILAYA_REGISTRY,
  allWilayaSlugs,
  isValidWilayaSlug,
  slugifyWilayaName,
  wilayaByCode,
  wilayaBySlug,
  wilayaCanonicalUrl,
  wilayaName,
  wilayaShareImageUrl,
} from "@/lib/wilaya-slugs";

interface RawGeoAdmin {
  wilayas: {
    code: string;
    name_ar: string;
    name_fr: string;
    name_en: string;
    name_kab: string | null;
    lat: number;
    lon: number;
  }[];
  communes: { wilaya_code: string }[];
}

const RAW_GEO: RawGeoAdmin = JSON.parse(
  readFileSync(join(process.cwd(), "data/geo/algeria-admin.json"), "utf8"),
);

describe("wilaya-slugs (69 Loi 26-06 registry)", () => {
  it("matches data/geo/algeria-admin.json 1:1 across all 69 wilayas", () => {
    expect(WILAYA_REGISTRY).toHaveLength(69);
    expect(RAW_GEO.wilayas).toHaveLength(69);

    const communeCounts = new Map<string, number>();
    for (const commune of RAW_GEO.communes) {
      communeCounts.set(
        commune.wilaya_code,
        (communeCounts.get(commune.wilaya_code) ?? 0) + 1,
      );
    }

    const expectedCodes = Array.from({ length: 69 }, (_, idx) =>
      String(idx + 1).padStart(2, "0"),
    );
    expect(WILAYA_REGISTRY.map((w) => w.code)).toEqual(expectedCodes);

    for (const raw of RAW_GEO.wilayas) {
      const entry = wilayaByCode(raw.code);
      expect(entry, `missing code ${raw.code}`).toBeDefined();
      expect(entry!.slug).toBe(slugifyWilayaName(raw.name_fr));
      expect(entry!.nameAr).toBe(raw.name_ar);
      expect(entry!.nameFr).toBe(raw.name_fr);
      expect(entry!.nameEn).toBe(raw.name_en);
      expect(entry!.nameKab).toBe(raw.name_kab ?? raw.name_fr);
      expect(entry!.nameKab.trim().length).toBeGreaterThan(0);
      expect(entry!.lat).toBe(raw.lat);
      expect(entry!.lon).toBe(raw.lon);
      expect(entry!.communeCount).toBe(communeCounts.get(raw.code) ?? 0);
    }
  });

  it("produces 69 unique collision-free lowercase ASCII kebab-case slugs", () => {
    const slugs = allWilayaSlugs();
    expect(slugs).toHaveLength(69);
    expect(new Set(slugs).size).toBe(69);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(isValidWilayaSlug(slug)).toBe(true);
      expect(wilayaBySlug(slug)?.slug).toBe(slug);
    }
  });

  it("includes expected canonical slugs for key and new 2026 Loi 26-06 wilayas", () => {
    expect(wilayaByCode("16")?.slug).toBe("alger");
    expect(wilayaByCode("01")?.slug).toBe("adrar");
    expect(wilayaByCode("15")?.slug).toBe("tizi-ouzou");
    expect(wilayaByCode("28")?.slug).toBe("msila");
    expect(wilayaByCode("57")?.slug).toBe("el-mghair");
    expect(wilayaByCode("49")?.slug).toBe("timimoune");
    expect(wilayaByCode("59")?.slug).toBe("aflou");
    expect(wilayaByCode("65")?.slug).toBe("ain-oussara");
    expect(wilayaByCode("68")?.slug).toBe("bou-saada");
    expect(wilayaByCode("69")?.slug).toBe("el-abiodh-sidi-cheikh");
  });

  it("strictly rejects uppercase, whitespace, traversal, and unknown slugs", () => {
    const invalid = [
      "",
      " ",
      "Alger",
      "ALGER",
      "alger ",
      " alger",
      "../alger",
      "alger/sub",
      "alger?lang=ar",
      "does-not-exist-99",
      "m-sila",
      "el_oued",
      "69",
    ];
    for (const slug of invalid) {
      expect(isValidWilayaSlug(slug)).toBe(false);
      expect(wilayaBySlug(slug)).toBeUndefined();
    }
  });

  it("returns localized wilaya names across all 4 locales", () => {
    const alger = wilayaBySlug("alger")!;
    expect(wilayaName(alger, "ar")).toBe("الجزائر");
    expect(wilayaName(alger, "fr")).toBe("Alger");
    expect(wilayaName(alger, "en")).toBe("Algiers");
    expect(wilayaName(alger, "kab")).toBe("Dzayer");

    // 2026 wilaya with null name_kab falls back cleanly to nameFr
    const bouSaada = wilayaBySlug("bou-saada")!;
    expect(wilayaName(bouSaada, "kab")).toBe("Bou Saâda");
  });

  it("builds canonical and share-image URLs per SCOPE.md §2 contract", () => {
    expect(wilayaCanonicalUrl("alger")).toBe(`${SITE_URL}/wilaya/alger`);
    expect(wilayaCanonicalUrl("alger", "ar")).toBe(
      `${SITE_URL}/wilaya/alger?lang=ar`,
    );
    expect(wilayaCanonicalUrl("alger", "fr")).toBe(
      `${SITE_URL}/wilaya/alger?lang=fr`,
    );
    expect(wilayaShareImageUrl("alger", "ar")).toBe(
      "/api/public/share/wilaya/alger.whatsapp.webp?lang=ar",
    );
    expect(wilayaShareImageUrl("tizi-ouzou", "kab", "facebook")).toBe(
      "/api/public/share/wilaya/tizi-ouzou.facebook.webp?lang=kab",
    );
    expect(wilayaShareImageUrl("bou-saada", "fr", "og")).toBe(
      "/api/public/share/wilaya/bou-saada.og.webp?lang=fr",
    );
  });
});
