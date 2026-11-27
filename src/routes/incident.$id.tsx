import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { OfficialIncidentDetail } from "@/components/nadhir/OfficialIncidentDetail";
import { isLocale, readLocaleCookie } from "@/i18n";
import type { Locale } from "@/i18n/locales-list";
import { supabase } from "@/integrations/supabase/client";
import { fetchOfficialIncident } from "@/lib/nadhir";
import { shareTranslator } from "@/lib/share-translator";
import {
  SITE_URL,
  incidentCardModel,
  isShareable,
  shareImagePath,
} from "@/lib/share-card";

export const Route = createFileRoute("/incident/$id")({
  validateSearch: (search: Record<string, unknown>) => ({
    lang:
      typeof search["lang"] === "string" && isLocale(search["lang"])
        ? search["lang"]
        : undefined,
  }),
  loader: async ({ params }) => {
    const incident = await fetchOfficialIncident(supabase, params.id);
    if (!incident || !isShareable(incident)) throw notFound();
    return incident;
  },
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const lang: Locale = match.search.lang ?? readLocaleCookie();
    const t = shareTranslator(lang);
    const card = incidentCardModel(loaderData, t, lang);
    const title = t("shareCard.metaTitle", {
      hazard: card.hazard,
      place: card.place,
    });
    const description = `${card.eyebrow} · ${card.source} · ${card.status} · ${card.time}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        {
          property: "og:image",
          content: `${SITE_URL}${shareImagePath(loaderData.id, "og", lang, loaderData.updated_at)}`,
        },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: Page,
});

function Page() {
  const incident = Route.useLoaderData();
  const { t, i18n: instance } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <OfficialIncidentDetail
        incident={incident}
        locale={instance.language as Locale}
        now={Date.now()}
      />
      <Link
        to="/"
        search={{ event: `official:${incident.id}` }}
        className="text-sm font-medium text-primary underline"
      >
        {t("shareCard.seeOnMap")}
      </Link>
    </div>
  );
}
