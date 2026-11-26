import {
  SITE_URL,
  WILAYA_REGISTRY,
  wilayaCanonicalUrl,
} from "@/lib/wilaya-slugs";

interface StaticSitemapEntry {
  path: string;
  changefreq: "hourly" | "daily" | "weekly" | "monthly";
  priority: string;
}

const STATIC_ENTRIES: readonly StaticSitemapEntry[] = [
  { path: "/", changefreq: "hourly", priority: "1.0" },
  { path: "/forecast", changefreq: "hourly", priority: "0.9" },
  { path: "/history", changefreq: "daily", priority: "0.6" },
  { path: "/status", changefreq: "hourly", priority: "0.6" },
  { path: "/about", changefreq: "monthly", priority: "0.5" },
];

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderUrlEntry(opts: {
  loc: string;
  arHref: string;
  frHref: string;
  defaultHref: string;
  changefreq: string;
  priority: string;
}): string {
  return [
    "  <url>",
    `    <loc>${escapeXml(opts.loc)}</loc>`,
    `    <xhtml:link rel="alternate" hreflang="ar-DZ" href="${escapeXml(opts.arHref)}" />`,
    `    <xhtml:link rel="alternate" hreflang="fr-DZ" href="${escapeXml(opts.frHref)}" />`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(opts.defaultHref)}" />`,
    `    <changefreq>${escapeXml(opts.changefreq)}</changefreq>`,
    `    <priority>${escapeXml(opts.priority)}</priority>`,
    "  </url>",
  ].join("\n");
}

/**
 * Pure XML sitemap builder indexing core public pages (/ , /forecast, /history,
 * /status, /about) and all 69 Loi 26-06 bilingual /wilaya/$slug landing pages
 * with ar-DZ, fr-DZ, and x-default hreflang alternates.
 */
export function buildSitemapXml(): string {
  const staticUrls = STATIC_ENTRIES.map((entry) => {
    const base = `${SITE_URL}${entry.path}`;
    return renderUrlEntry({
      loc: base,
      arHref: `${base}?lang=ar`,
      frHref: `${base}?lang=fr`,
      defaultHref: base,
      changefreq: entry.changefreq,
      priority: entry.priority,
    });
  });

  const wilayaUrls = WILAYA_REGISTRY.map((entry) =>
    renderUrlEntry({
      loc: wilayaCanonicalUrl(entry.slug),
      arHref: wilayaCanonicalUrl(entry.slug, "ar"),
      frHref: wilayaCanonicalUrl(entry.slug, "fr"),
      defaultHref: wilayaCanonicalUrl(entry.slug),
      changefreq: "hourly",
      priority: "0.8",
    }),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...staticUrls,
    ...wilayaUrls,
    "</urlset>",
    "",
  ].join("\n");
}
