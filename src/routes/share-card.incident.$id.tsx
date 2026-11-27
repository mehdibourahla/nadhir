import { createFileRoute, notFound } from "@tanstack/react-router";
import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fetchOfficialIncident } from "@/lib/nadhir";
import {
  isShareFormat,
  isShareable,
  shareLocale,
  type ShareFormat,
} from "@/lib/share-card";
import { AtlasIncidentShareCard } from "@/ui/share-card";

export const Route = createFileRoute("/share-card/incident/$id")({
  validateSearch: (search: Record<string, unknown>) => ({
    format: (typeof search["format"] === "string" &&
    isShareFormat(search["format"])
      ? search["format"]
      : "story") as ShareFormat,
    lang: shareLocale(
      typeof search["lang"] === "string" ? search["lang"] : null,
    ),
  }),
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  loader: async ({ params }) => {
    const incident = await fetchOfficialIncident(supabase, params.id);
    if (!incident || !isShareable(incident)) throw notFound();
    return incident;
  },
  component: ShareCardIncidentPage,
});

function ShareCardIncidentPage() {
  const incident = Route.useLoaderData();
  const { format, lang } = Route.useSearch();
  const t = i18n.getFixedT(lang);
  return (
    <div className="min-h-screen bg-[#070D17] flex items-center justify-center p-0">
      <AtlasIncidentShareCard
        incident={incident}
        format={format}
        lang={lang}
        t={(key, vars) => (vars ? t(key, vars) : t(key))}
      />
    </div>
  );
}
