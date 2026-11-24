import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Flame, Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";

import { type AnyLocale } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { firePhase } from "@/lib/incident-lifecycle";
import { relativeTime } from "@/lib/nadhir";
import { readSubscription } from "@/lib/push";

type BannerRow = {
  id: string;
  kind: string;
  phase: string;
  severity: string;
  commune_codes: string[];
  cluster_id: string | null;
  official_incident_id?: string | null;
  earthquake_id?: string | null;
  created_at: string;
  cap_alerts: { info: unknown } | null;
  fire_clusters: {
    short_id: string;
    state: string;
    last_detected_at: string;
    resolved_at: string | null;
  } | null;
  onm_vigilance: {
    title: string;
    headline_fr: string | null;
    expires: string | null;
    msg_type?: string | null;
    cancelled_at?: string | null;
    superseded_by?: string | null;
  } | null;
  authority_warnings: { source: string; body: string } | null;
};

const bannersQuery = queryOptions({
  queryKey: ["broadcasts", "banner"],
  queryFn: async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("broadcasts")
      .select(
        "id, kind, phase, severity, commune_codes, cluster_id, official_incident_id, earthquake_id, created_at, cap_alerts(info), fire_clusters(short_id, state, last_detected_at, resolved_at), onm_vigilance(title, headline_fr, expires, msg_type, cancelled_at, superseded_by), authority_warnings(source, body)",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as BannerRow[];
  },
  staleTime: 60_000,
});

function headlineFor(row: BannerRow, locale: AnyLocale): string | null {
  if (row.kind === "authority") return row.authority_warnings?.body ?? null;
  if (row.kind === "onm")
    return row.onm_vigilance?.headline_fr ?? row.onm_vigilance?.title ?? null;
  const info = row.cap_alerts?.info as
    { language: string; headline: string }[] | undefined;
  if (!info?.length) return null;
  return (
    (info.find((i) => i.language.split("-")[0] === locale) ?? info[0])!
      .headline ?? null
  );
}

export function BroadcastBanner() {
  const { t, i18n } = useTranslation();
  const subscription = readSubscription();
  const { data } = useQuery({
    ...bannersQuery,
    enabled: Boolean(subscription?.communes.length),
  });
  if (!subscription?.communes.length || !data?.length) return null;

  const mine = new Set(subscription.communes);
  const seen = new Set<string>();
  const relevant = data.filter((row) => {
    if (!row.commune_codes.some((code) => mine.has(code))) return false;
    const thread =
      row.cluster_id ?? row.official_incident_id ?? row.earthquake_id ?? row.id;
    if (seen.has(thread)) return false;
    seen.add(thread);
    return true;
  });
  const now = Date.now();
  const live = relevant.filter(
    (row) =>
      row.phase !== "end" &&
      row.phase !== "cancel" &&
      (!row.fire_clusters || firePhase(row.fire_clusters, now) === "live") &&
      (!row.onm_vigilance ||
        (!row.onm_vigilance.cancelled_at &&
          !row.onm_vigilance.superseded_by &&
          row.onm_vigilance.msg_type !== "Cancel" &&
          (!row.onm_vigilance.expires ||
            Date.parse(row.onm_vigilance.expires) > now))),
  );
  if (!live.length) return null;

  const locale = i18n.language as AnyLocale;
  return (
    <section className="flex flex-col gap-2">
      {live.slice(0, 3).map((row) => {
        const headline = headlineFor(row, locale);
        if (!headline) return null;
        const fire = row.kind === "fire" && row.fire_clusters?.short_id;
        const emergency = row.severity === "Extreme";
        return (
          <div
            key={row.id}
            className="rounded-xl border p-3"
            style={
              emergency
                ? {
                    backgroundColor: "var(--emergency-surface)",
                    borderColor: "var(--emergency)",
                  }
                : {
                    backgroundColor: "var(--accent-tint)",
                    borderColor: "var(--accent)",
                  }
            }
          >
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {row.kind === "onm" ? (
                <Megaphone aria-hidden className="size-3.5" />
              ) : (
                <Flame aria-hidden className="size-3.5" />
              )}
              {row.kind === "onm"
                ? t("push.bannerOnm")
                : row.kind === "authority"
                  ? (row.authority_warnings?.source ?? t("push.bannerOnm"))
                  : t("push.bannerLive")}
              <span className="ms-auto">
                {relativeTime(row.created_at, locale)}
              </span>
            </p>
            <p className="mt-1 text-sm font-semibold">{headline}</p>
            {fire ? (
              <Link
                to="/fire/$id"
                params={{ id: row.fire_clusters!.short_id }}
                className="mt-1.5 inline-block text-xs font-medium underline underline-offset-2"
              >
                {t("push.bannerOpen")}
              </Link>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
