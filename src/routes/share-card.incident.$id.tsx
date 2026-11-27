import { createFileRoute, notFound } from "@tanstack/react-router";

import { IncidentCard } from "@/components/share/IncidentCard";
import { supabase } from "@/integrations/supabase/client";
import { fetchOfficialIncident } from "@/lib/nadhir";
import {
  isShareFormat,
  isShareable,
  shareLocale,
  type ShareFormat,
} from "@/lib/share-card";

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
  component: Page,
});

function Page() {
  const incident = Route.useLoaderData();
  const { format, lang } = Route.useSearch();
  return <IncidentCard incident={incident} format={format} lang={lang} />;
}
