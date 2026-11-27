import { useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bell, CheckCheck, MapPin, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { AnyLocale } from "@/i18n";
import { zonesQuery } from "@/lib/account";
import { groupAlerts, groupPhase } from "@/lib/alert-groups";
import {
  alertFiresQuery,
  alertsQuery,
  deleteAlerts,
  markAllAlertsRead,
  markAlertsRead,
  runAlertCheck,
} from "@/lib/alerts";
import { relativeTime } from "@/lib/nadhir";
import { titledMeta } from "@/lib/page-meta";
import { pageRows } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { AtlasPageFooter } from "@/ui/app-shell";
import { cleanCopy } from "@/ui/format";
import {
  AtlasBadge,
  AtlasButton,
  AtlasEmpty,
  AtlasError,
  AtlasLoading,
  AtlasMasthead,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({
    meta: [
      ...titledMeta("alerts.title", "alerts.subtitle"),
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AlertsPage,
});

function alertKindLabel(kind: string, locale: AnyLocale): string {
  const map: Record<string, { ar: string; fr: string; en: string }> = {
    fire: { ar: "حريق", fr: "Incendie", en: "Fire" },
    risk: { ar: "خطر حرائق", fr: "Risque feu", en: "Fire danger" },
    weather: { ar: "أرصاد جوية", fr: "Météo ONM", en: "Weather" },
    official: { ar: "بلاغ رسمي", fr: "Officiel", en: "Official" },
    road: { ar: "طرقات", fr: "Routes", en: "Roads" },
    citizen: { ar: "بلاغ مواطن", fr: "Signalement", en: "Citizen report" },
    earthquake: { ar: "زلزال", fr: "Séisme", en: "Earthquake" },
  };
  const entry = map[kind];
  if (!entry) return kind;
  return locale === "ar" ? entry.ar : locale === "fr" ? entry.fr : entry.en;
}

function alertPhaseLabel(phase: string, locale: AnyLocale): string {
  if (phase === "live") {
    return locale === "ar" ? "جاري" : locale === "fr" ? "En cours" : "Live";
  }
  return locale === "ar" ? "منتهي" : locale === "fr" ? "Terminé" : "Ended";
}

function AlertsPage() {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;
  const qc = useQueryClient();

  const alertsQ = useInfiniteQuery(alertsQuery);
  const zonesQ = useQuery(zonesQuery);

  const flatAlerts = useMemo(() => pageRows(alertsQ.data), [alertsQ.data]);
  const fireIds = useMemo(
    () =>
      flatAlerts
        .map((a) => a.cluster_id)
        .filter((id): id is string => Boolean(id)),
    [flatAlerts],
  );
  const firesQ = useQuery(alertFiresQuery(fireIds));

  const groups = useMemo(() => groupAlerts(flatAlerts), [flatAlerts]);

  const markAllMut = useMutation({
    mutationFn: markAllAlertsRead,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["alerts"] });
      toast.success(
        locale === "ar"
          ? "تم تعليم كل التنبيهات كمقروءة"
          : locale === "fr"
            ? "Toutes les alertes marquées lues"
            : "All alerts marked read",
      );
    },
  });

  const checkMut = useMutation({
    mutationFn: runAlertCheck,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["alerts"] });
      toast.success(
        locale === "ar"
          ? "تم فحص المناطق"
          : locale === "fr"
            ? "Zones vérifiées"
            : "Checked zones",
      );
    },
    onError: () => toast.error(t("common.error")),
  });

  const deleteMut = useMutation({
    mutationFn: deleteAlerts,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const readMut = useMutation({
    mutationFn: ({ ids, read }: { ids: string[]; read: boolean }) =>
      markAlertsRead(ids, read),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const now = Date.now();
  const zoneCount = (zonesQ.data ?? []).length;

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <Bell className="h-3.5 w-3.5 text-signal" />
            <span>
              {locale === "ar"
                ? "صندوق التنبيهات"
                : locale === "fr"
                  ? "BOÎTE D'ALERTES"
                  : "ALERT INBOX"}
            </span>
            <span>·</span>
            <SafeBdi>
              {locale === "ar"
                ? `${zoneCount} مناطق`
                : locale === "fr"
                  ? `${zoneCount} zone${zoneCount === 1 ? "" : "s"}`
                  : `${zoneCount} zone${zoneCount === 1 ? "" : "s"}`}
            </SafeBdi>
          </>
        }
        title={
          locale === "ar"
            ? "تنبيهاتي"
            : locale === "fr"
              ? "Mes alertes"
              : "My alerts"
        }
        subtitle={
          locale === "ar"
            ? "التنبيهات الواردة للمناطق التي تتابعها."
            : locale === "fr"
              ? "Alertes reçues pour vos zones suivies."
              : "Live alerts triggered for your monitored zones."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AtlasButton
              variant="secondary"
              size="sm"
              onClick={() => checkMut.mutate()}
              disabled={checkMut.isPending}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {locale === "ar"
                ? "فحص الآن"
                : locale === "fr"
                  ? "Vérifier"
                  : "Check now"}
            </AtlasButton>
            <AtlasButton
              variant="secondary"
              size="sm"
              onClick={() => markAllMut.mutate()}
              disabled={markAllMut.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {locale === "ar"
                ? "تعليم الكل كمقروء"
                : locale === "fr"
                  ? "Tout marquer lu"
                  : "Mark all read"}
            </AtlasButton>
            <Link to="/zones">
              <AtlasButton variant="primary" size="sm">
                <MapPin className="h-3.5 w-3.5" />
                {locale === "ar"
                  ? "المناطق"
                  : locale === "fr"
                    ? "Zones"
                    : "Zones"}
              </AtlasButton>
            </Link>
          </div>
        }
      />

      {alertsQ.isLoading ? (
        <AtlasLoading />
      ) : alertsQ.isError ? (
        <AtlasError
          title={t("common.error")}
          onRetry={() => void alertsQ.refetch()}
        />
      ) : groups.length === 0 ? (
        <AtlasEmpty
          title={
            locale === "ar"
              ? "لا توجد تنبيهات بعد"
              : locale === "fr"
                ? "Aucune alerte pour le moment"
                : "No alerts yet"
          }
          body={
            locale === "ar"
              ? "أضف منطقة متابعة لتصلك تنبيهات الأرصاد الجوية والحرائق والزلازل."
              : locale === "fr"
                ? "Ajoutez une zone suivie pour recevoir les vigilances ONM, feux et séismes."
                : "Add a monitored zone to receive ONM weather, fire, and seismic alerts."
          }
          action={
            <Link to="/zones">
              <AtlasButton variant="primary" size="sm">
                {locale === "ar"
                  ? "إعداد المناطق"
                  : locale === "fr"
                    ? "Configurer mes zones"
                    : "Configure zones"}
              </AtlasButton>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {groups.map((g) => {
            const phase = groupPhase(g, firesQ.data ?? new Map(), now);
            const ids = g.messages.map((m) => m.id);
            const isLive = phase === "live";
            return (
              <li
                key={g.key}
                className="flex items-stretch overflow-hidden rounded-xl border border-hairline bg-surface"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "w-1 shrink-0",
                    isLive ? "bg-hazard-extreme" : "bg-hairline-strong",
                  )}
                />
                <div className="flex flex-1 flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 min-w-0">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <AtlasBadge tone={isLive ? "extreme" : "neutral"} dot>
                        {alertKindLabel(g.latest.kind, locale)} ·{" "}
                        {alertPhaseLabel(phase, locale)}
                      </AtlasBadge>
                      {g.unread > 0 && (
                        <AtlasBadge tone="signal">
                          <SafeBdi>
                            {locale === "ar"
                              ? `${g.unread} جديد`
                              : locale === "fr"
                                ? `${g.unread} nouveau${g.unread > 1 ? "x" : ""}`
                                : `${g.unread} new`}
                          </SafeBdi>
                        </AtlasBadge>
                      )}
                      <SafeBdi className="font-mono text-xs text-ink-muted">
                        {relativeTime(g.latest.created_at, locale)}
                      </SafeBdi>
                    </div>
                    <div className="text-sm font-semibold text-ink">
                      {cleanCopy(g.latest.title)}
                    </div>
                    <p className="text-xs text-ink-secondary leading-relaxed">
                      {cleanCopy(g.latest.body)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {g.unread > 0 && (
                      <AtlasButton
                        variant="ghost"
                        size="sm"
                        onClick={() => readMut.mutate({ ids, read: true })}
                      >
                        {locale === "ar"
                          ? "مقروء"
                          : locale === "fr"
                            ? "Lu"
                            : "Read"}
                      </AtlasButton>
                    )}
                    <AtlasButton
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.delete")}
                      onClick={() => deleteMut.mutate(ids)}
                    >
                      <Trash2 className="h-4 w-4 text-ink-muted hover:text-hazard-extreme" />
                    </AtlasButton>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {alertsQ.hasNextPage && (
        <div className="flex justify-center pt-5">
          <AtlasButton
            variant="secondary"
            onClick={() => void alertsQ.fetchNextPage()}
            disabled={alertsQ.isFetchingNextPage}
          >
            {t("common.loadMore")}
          </AtlasButton>
        </div>
      )}

      <AtlasPageFooter />
    </div>
  );
}
