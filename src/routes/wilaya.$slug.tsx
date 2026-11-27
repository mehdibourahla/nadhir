import { createFileRoute, notFound } from "@tanstack/react-router";

import {
  WilayaNotFound,
  WilayaRoutePage,
} from "@/components/forecast/WilayaPageView";
import { headTranslator, readActiveLocale, type AnyLocale } from "@/i18n";
import { parseAnyLocaleParam } from "@/i18n/locale-cookie";
import { bilingualSeoHead } from "@/lib/page-meta";
import { fetchWilayaSnapshot } from "@/lib/wilaya-data";
import {
  SITE_URL,
  applyFrenchElision,
  wilayaBySlug,
  wilayaCanonicalUrl,
  wilayaName,
  wilayaShareImageUrl,
} from "@/lib/wilaya-slugs";

type WilayaSearch = {
  lang?: AnyLocale | undefined;
};

export const Route = createFileRoute("/wilaya/$slug")({
  validateSearch: (search: Record<string, unknown>): WilayaSearch => {
    const raw = search["lang"];
    const lang = typeof raw === "string" ? parseAnyLocaleParam(raw) : null;
    return lang ? { lang } : {};
  },
  loader: async ({ params }) => {
    const wilaya = wilayaBySlug(params.slug);
    if (!wilaya) throw notFound();
    return fetchWilayaSnapshot(wilaya);
  },
  head: ({ loaderData, match }) => {
    if (!loaderData) {
      return { meta: [{ name: "robots", content: "noindex" }] };
    }
    const explicitLang = match.search.lang;
    const lang: AnyLocale = explicitLang ?? readActiveLocale();
    const t = headTranslator(lang);
    const localizedName = wilayaName(loaderData.wilaya, lang);
    const slug = loaderData.wilaya.slug;
    const rawTitle = t("track3.wilaya.metaTitle", {
      wilaya: localizedName,
      code: loaderData.wilaya.code,
    });
    const rawDescription = t("track3.wilaya.metaDescription", {
      wilaya: localizedName,
      code: loaderData.wilaya.code,
    });
    const rawOgImageAlt = t("track3.wilaya.ogImageAlt", {
      wilaya: localizedName,
    });
    const title = lang === "fr" ? applyFrenchElision(rawTitle) : rawTitle;
    const description =
      lang === "fr" ? applyFrenchElision(rawDescription) : rawDescription;
    const ogImageAlt =
      lang === "fr" ? applyFrenchElision(rawOgImageAlt) : rawOgImageAlt;
    return bilingualSeoHead({
      title,
      description,
      canonicalUrl: explicitLang
        ? wilayaCanonicalUrl(slug, explicitLang)
        : wilayaCanonicalUrl(slug),
      arUrl: wilayaCanonicalUrl(slug, "ar"),
      frUrl: wilayaCanonicalUrl(slug, "fr"),
      defaultUrl: wilayaCanonicalUrl(slug),
      locale: lang,
      ogImageUrl: `${SITE_URL}${wilayaShareImageUrl(slug, lang, "whatsapp")}`,
      ogImageAlt,
      robots: "index, follow",
    });
  },
  component: WilayaRoutePage,
  notFoundComponent: WilayaNotFound,
});
