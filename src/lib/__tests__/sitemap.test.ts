import { describe, expect, it } from "vitest";

import { buildSitemapXml, escapeXml } from "@/lib/sitemap";
import { SITE_URL, allWilayaSlugs } from "@/lib/wilaya-slugs";

describe("sitemap XML builder", () => {
  it("escapes XML entities cleanly", () => {
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe(
      "a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;",
    );
  });

  it("generates well-formed XML indexing core pages and all 69 wilayas with bilingual hreflang", () => {
    const xml = buildSitemapXml();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);

    const urlMatches = xml.match(/<url>/g) ?? [];
    const closeMatches = xml.match(/<\/url>/g) ?? [];
    expect(urlMatches.length).toBe(closeMatches.length);
    // 5 core static routes + 69 wilayas = 74 entries
    expect(urlMatches.length).toBe(74);

    for (const path of ["/", "/forecast", "/history", "/status", "/about"]) {
      expect(xml).toContain(`<loc>${SITE_URL}${path}</loc>`);
    }

    for (const slug of allWilayaSlugs()) {
      const base = `${SITE_URL}/wilaya/${slug}`;
      expect(xml).toContain(`<loc>${base}</loc>`);
      expect(xml).toContain(`hreflang="ar-DZ" href="${base}?lang=ar"`);
      expect(xml).toContain(`hreflang="fr-DZ" href="${base}?lang=fr"`);
      expect(xml).toContain(`hreflang="x-default" href="${base}"`);
    }
  });
});
