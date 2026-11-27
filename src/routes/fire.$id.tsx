import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Compass, Flame, ShieldCheck, Wind } from "lucide-react";

import type { AnyLocale } from "@/i18n";
import {
  algiersTime,
  bearingLabel,
  clusterDetailQuery,
  coordLabel,
  fireStage,
  relativeTime,
} from "@/lib/nadhir";
import { pageMeta } from "@/lib/page-meta";
import { AtlasPageFooter } from "@/ui/app-shell";
import { cleanCopy } from "@/ui/format";
import { MiniHazardMap } from "@/ui/hazard-map";
import {
  AtlasBadge,
  AtlasMasthead,
  AtlasPanel,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/fire/$id")({
  head: ({ params }) => ({
    meta: pageMeta("fire.metaTitle", "fire.metaDescription", {
      id: params.id,
    }),
  }),
  loader: async ({ context, params }) => {
    const detail = await context.queryClient.ensureQueryData(
      clusterDetailQuery(params.id),
    );
    if (!detail) throw notFound();
    return detail;
  },
  component: FireDetailPage,
});

function FireDetailPage() {
  const { id } = Route.useParams();
  const detailQ = useQuery(clusterDetailQuery(id));
  const detail = detailQ.data;
  const { t, i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;
  if (!detail) return null;
  const { cluster, detections, events, confirmation } = detail;
  const stage = fireStage(cluster);

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
            <Flame className="h-3.5 w-3.5 text-hazard-extreme" />
            <SafeBdi>{cluster.short_id}</SafeBdi>
            <span>·</span>
            <SafeBdi>{coordLabel(cluster.lat, cluster.lon)}</SafeBdi>
          </>
        }
        title={
          stage === "confirmed"
            ? locale === "ar"
              ? "حريق مؤكد رسميًا"
              : locale === "fr"
                ? "Incendie confirmé"
                : "Confirmed wildfire"
            : locale === "ar"
              ? "رصد حراري بالأقمار الصناعية"
              : locale === "fr"
                ? "Foyer détecté par satellite"
                : "Satellite fire cluster"
        }
        subtitle={`${cluster.sources.join(" · ").toUpperCase()} · ${relativeTime(cluster.last_detected_at, locale)}`}
        metrics={[
          {
            label: "Detections",
            value: <SafeBdi>{cluster.detection_count}</SafeBdi>,
            tone: "extreme",
          },
          {
            label: "Peak FRP",
            value: (
              <SafeBdi>
                {cluster.max_frp_mw !== null
                  ? `${Math.round(cluster.max_frp_mw)} MW`
                  : "-"}
              </SafeBdi>
            ),
            tone: "high",
          },
          {
            label: "Wind",
            value: (
              <SafeBdi>
                {cluster.wind_speed_kmh !== null
                  ? `${Math.round(cluster.wind_speed_kmh)} km/h`
                  : "-"}
              </SafeBdi>
            ),
            detail:
              cluster.wind_dir_deg !== null
                ? cleanCopy(bearingLabel(cluster.wind_dir_deg))
                : undefined,
          },
          {
            label: "Estimated area",
            value: (
              <SafeBdi>
                {cluster.est_area_ha !== null
                  ? `${Math.round(cluster.est_area_ha)} ha`
                  : "-"}
              </SafeBdi>
            ),
          },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-5">
          <div data-map-fire={stage.toUpperCase()}>
            <MiniHazardMap
              lat={cluster.lat}
              lon={cluster.lon}
              zoom={11}
              className="h-80"
            />
          </div>

          {confirmation && (
            <AtlasPanel className="space-y-2 border-signal/35">
              <div className="flex items-center gap-2 text-xs font-mono text-signal">
                <ShieldCheck className="h-4 w-4" />
                <span>{cleanCopy(confirmation.source?.label) || "DGPC"}</span>
                <span>·</span>
                <SafeBdi>{algiersTime(confirmation.as_of)}</SafeBdi>
              </div>
              <p className="text-sm text-ink leading-relaxed">
                {cleanCopy(confirmation.evidence)}
              </p>
            </AtlasPanel>
          )}

          <AtlasPanel className="space-y-3">
            <h2 className="font-display text-lg font-semibold text-ink">
              Satellite passes ({detections.length})
            </h2>
            <div className="divide-y divide-hairline max-h-72 overflow-y-auto">
              {detections.slice(0, 25).map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <AtlasBadge tone="neutral">
                      <SafeBdi>{d.sensor}</SafeBdi>
                    </AtlasBadge>
                    <SafeBdi className="font-mono text-ink-secondary">
                      {d.frp_mw !== null ? `${d.frp_mw.toFixed(1)} MW` : "-"}
                    </SafeBdi>
                  </div>
                  <SafeBdi className="font-mono text-ink-muted tabular-nums">
                    {algiersTime(d.detected_at)}
                  </SafeBdi>
                </div>
              ))}
            </div>
          </AtlasPanel>
        </div>

        <aside className="lg:col-span-5 space-y-4">
          <AtlasPanel className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-mono font-semibold text-ink-secondary">
              <Wind className="h-3.5 w-3.5 text-signal" />
              Atmosphere & Spread
            </h3>
            <dl className="divide-y divide-hairline text-sm">
              <div className="flex justify-between py-2">
                <dt className="text-ink-secondary">Stage</dt>
                <dd>
                  <AtlasBadge
                    tone={stage === "confirmed" ? "extreme" : "high"}
                    dot
                  >
                    {stage} · {cluster.state}
                  </AtlasBadge>
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-ink-secondary">Spread bearing</dt>
                <dd className="inline-flex items-center gap-1 font-mono text-ink">
                  <Compass className="h-3.5 w-3.5 text-signal" />
                  <SafeBdi>
                    {cluster.spread_bearing_deg !== null
                      ? cleanCopy(bearingLabel(cluster.spread_bearing_deg))
                      : "-"}
                  </SafeBdi>
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-ink-secondary">First detected</dt>
                <dd className="font-mono text-ink tabular-nums">
                  <SafeBdi>{algiersTime(cluster.first_detected_at)}</SafeBdi>
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-ink-secondary">Last detected</dt>
                <dd className="font-mono text-ink tabular-nums">
                  <SafeBdi>{algiersTime(cluster.last_detected_at)}</SafeBdi>
                </dd>
              </div>
            </dl>
          </AtlasPanel>

          {events.length > 0 && (
            <AtlasPanel className="space-y-3">
              <h3 className="text-xs font-mono font-semibold text-ink-secondary">
                Lifecycle ({events.length})
              </h3>
              <div className="space-y-2">
                {events.slice(-8).map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-ink">{ev.event}</span>
                    <SafeBdi className="font-mono text-ink-muted">
                      {algiersTime(ev.at)}
                    </SafeBdi>
                  </div>
                ))}
              </div>
            </AtlasPanel>
          )}
        </aside>
      </div>

      <AtlasPageFooter />
    </div>
  );
}
