import { headTranslator, type AnyLocale } from "@/i18n";

export function pageMeta(
  titleKey: string,
  descriptionKey: string,
  params?: Record<string, string>,
) {
  const t = headTranslator();
  const title = t(titleKey, params ?? {});
  const description = t(descriptionKey);
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
}

export function titledMeta(
  pageTitleKey: string,
  descriptionKey?: string,
  params?: Record<string, string>,
) {
  const t = headTranslator();
  const title = t("meta.titleTemplate", {
    page: t(pageTitleKey, params ?? {}),
  });
  const meta: Record<string, string>[] = [
    { title },
    { property: "og:title", content: title },
  ];
  if (!descriptionKey) return meta;
  const description = t(descriptionKey);
  return [
    ...meta,
    { name: "description", content: description },
    { property: "og:description", content: description },
  ];
}

const OG_LOCALE_BY_LANG: Record<AnyLocale, string> = {
  ar: "ar_DZ",
  fr: "fr_DZ",
  en: "en_US",
  kab: "kab_DZ",
};

export interface BilingualSeoHeadInput {
  title: string;
  description: string;
  canonicalUrl: string;
  arUrl: string;
  frUrl: string;
  defaultUrl: string;
  locale: AnyLocale;
  ogImageUrl?: string | undefined;
  ogImageAlt?: string | undefined;
  robots?: string | undefined;
}

export function bilingualSeoHead(input: BilingualSeoHeadInput) {
  const robots = input.robots ?? "index, follow";
  const meta: Record<string, string>[] = [
    { title: input.title },
    { name: "description", content: input.description },
    { name: "robots", content: robots },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: input.canonicalUrl },
    { property: "og:locale", content: OG_LOCALE_BY_LANG[input.locale] },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
  ];

  if (input.ogImageUrl) {
    meta.push(
      { property: "og:image", content: input.ogImageUrl },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: input.ogImageUrl },
    );
    if (input.ogImageAlt) {
      meta.push({ property: "og:image:alt", content: input.ogImageAlt });
    }
  }

  const links = [
    { rel: "canonical", href: input.canonicalUrl },
    { rel: "alternate", hrefLang: "ar-DZ", href: input.arUrl },
    { rel: "alternate", hrefLang: "fr-DZ", href: input.frUrl },
    { rel: "alternate", hrefLang: "x-default", href: input.defaultUrl },
  ];

  return { meta, links };
}
