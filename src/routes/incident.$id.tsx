import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink, Share2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { isLocale, readLocaleCookie } from "@/i18n";
import type { Locale } from "@/i18n/locales-list";
import { supabase } from "@/integrations/supabase/client";
import {
  algiersTime,
  coordLabel,
  fetchOfficialIncident,
  relativeTime,
} from "@/lib/nadhir";
import {
  SITE_URL,
  incidentCardModel,
  incidentUrl,
  isShareable,
  linkTargets,
  shareImagePath,
} from "@/lib/share-card";
import { shareTranslator } from "@/lib/share-translator";
import { AtlasPageFooter } from "@/ui/app-shell";
import { cleanCopy } from "@/ui/format";
import { MiniHazardMap } from "@/ui/hazard-map";
import {
  AtlasBadge,
  AtlasButton,
  AtlasMasthead,
  AtlasPanel,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/incident/$id")({
  validateSearch: (search: Record<string, unknown>): { lang?: Locale } => {
    const raw = search["lang"];
    return typeof raw === "string" && isLocale(raw) ? { lang: raw } : {};
  },
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
  component: IncidentDetailPage,
});

function IncidentDetailPage() {
  const incident = Route.useLoaderData();
  const { t, i18n } = useTranslation();
  const lang = (isLocale(i18n.language) ? i18n.language : "ar") as Locale;
  const card = incidentCardModel(incident, shareTranslator(lang), lang);
  const anchor = incident.commune ?? incident.wilaya;
  const url = incidentUrl(incident.id, lang);
  const shareLinks = linkTargets(url);

  async function copyLink() {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  }

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-5 pb-12">
      <div className="mb-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-secondary hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5 atlas-dir-icon" />
          {t("common.back")}
        </Link>
      </div>

      <AtlasMasthead
        edition={
          <>
            <ShieldCheck className="h-3.5 w-3.5 text-signal" />
            <span>{cleanCopy(card.source)}</span>
            <span>·</span>
            <span>{cleanCopy(card.status)}</span>
          </>
        }
        title={`${cleanCopy(card.hazard)} · ${cleanCopy(card.place)}`}
        subtitle={cleanCopy(card.region)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AtlasButton
              variant="secondary"
              size="sm"
              onClick={() => void copyLink()}
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </AtlasButton>
            <a href={shareLinks.whatsapp} target="_blank" rel="noreferrer">
              <AtlasButton variant="primary" size="sm">
                WhatsApp
              </AtlasButton>
            </a>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-5">
          {Number.isFinite(anchor.lat) && Number.isFinite(anchor.lon) && (
            <MiniHazardMap
              lat={anchor.lat}
              lon={anchor.lon}
              zoom={10}
              className="h-80"
            />
          )}

          <AtlasPanel className="space-y-3">
            <h2 className="font-display text-lg font-semibold text-ink">
              {cleanCopy(card.eyebrow)}
            </h2>
            <p className="text-sm text-ink-secondary leading-relaxed">
              {cleanCopy(incident.evidence)}
            </p>
            {incident.latest_mention?.document?.url && (
              <a
                href={incident.latest_mention.document.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-signal hover:underline"
              >
                {cleanCopy(card.source)}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </AtlasPanel>
        </div>

        <aside className="lg:col-span-5 space-y-4">
          <AtlasPanel className="space-y-4">
            <div className="flex items-center justify-between">
              <AtlasBadge tone={card.fire ? "extreme" : "high"} dot>
                {cleanCopy(card.status)}
              </AtlasBadge>
              <SafeBdi className="font-mono text-xs text-ink-muted">
                {coordLabel(anchor.lat, anchor.lon)}
              </SafeBdi>
            </div>
            <dl className="divide-y divide-hairline text-sm">
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-secondary">First reported</dt>
                <dd className="font-mono text-ink tabular-nums">
                  <SafeBdi>{algiersTime(incident.first_reported_at)}</SafeBdi>
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-secondary">Latest bulletin</dt>
                <dd className="font-mono text-ink tabular-nums">
                  <SafeBdi>{algiersTime(incident.last_reported_at)}</SafeBdi>
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-secondary">Updated</dt>
                <dd className="text-ink">
                  {relativeTime(incident.updated_at, lang)}
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-secondary">Mentions</dt>
                <dd className="font-mono text-ink tabular-nums">
                  <SafeBdi>{incident.mention_count}</SafeBdi>
                </dd>
              </div>
            </dl>
          </AtlasPanel>
        </aside>
      </div>

      <AtlasPageFooter />
    </div>
  );
}
