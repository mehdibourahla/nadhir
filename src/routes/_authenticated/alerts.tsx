import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { Locale } from "@/i18n";
import {
  alertFiresQuery,
  alertsQuery,
  markAllAlertsRead,
  unreadAlertsQuery,
  deleteAlerts,
  markAlertsRead,
  runAlertCheck,
} from "@/lib/alerts";
import { groupAlerts, groupPhase } from "@/lib/alert-groups";
import { isDefaultPoint, zonesQuery } from "@/lib/account";
import { AlertCard } from "@/components/nadhir/AlertCard";
import { titledMeta } from "@/lib/page-meta";
import { pageRows } from "@/lib/paging";
import { LoadMore } from "@/components/LoadMore";

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

function AlertsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const qc = useQueryClient();
  const alerts = useInfiniteQuery(alertsQuery);
  const unreadCount = useQuery(unreadAlertsQuery);
  const zones = useQuery(zonesQuery);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["alerts"] });
  const readMutation = useMutation({
    mutationFn: ({ ids, read }: { ids: string[]; read: boolean }) =>
      markAlertsRead(ids, read),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAlerts,
    onSuccess: invalidate,
  });
  const allReadMutation = useMutation({
    mutationFn: markAllAlertsRead,
    onSuccess: invalidate,
  });
  const checkMutation = useMutation({
    mutationFn: runAlertCheck,
    onSuccess: invalidate,
  });

  const rows = pageRows(alerts.data);
  const unread = unreadCount.data ?? 0;
  const groups = groupAlerts(rows);
  const fires = useQuery(
    alertFiresQuery(
      rows.flatMap((a) =>
        a.kind === "fire" && a.cluster_id ? [a.cluster_id] : [],
      ),
    ),
  );
  const now = Date.now();
  const zoneFor = (id: string | null) =>
    zones.data?.find((z) => z.id === id) ?? null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="font-display text-2xl font-semibold">
        {t("alerts.title")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("alerts.subtitle")}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => checkMutation.mutate()}
          disabled={checkMutation.isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {checkMutation.isPending
            ? t("alerts.checking")
            : t("alerts.checkNow")}
        </button>
        <button
          type="button"
          onClick={() => allReadMutation.mutate()}
          disabled={!unread}
          className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {t("alerts.markAllRead")}
        </button>
        <span className="text-xs text-muted-foreground">
          {t("alerts.unread", { count: unread })}
        </span>
      </div>

      {(zones.data ?? []).some(isDefaultPoint) ? (
        <div
          role="alert"
          className="mt-6 rounded-lg px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--emergency-surface)",
            color: "var(--emergency-ink)",
          }}
        >
          <p>{t("alerts.defaultPointZones")}</p>
          <Link to="/zones" className="mt-1 inline-block font-medium underline">
            {t("alerts.fixZones")}
          </Link>
        </div>
      ) : null}

      {alerts.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">{t("alerts.empty")}</p>
          <Link
            to="/zones"
            className="mt-2 inline-block text-sm font-medium text-primary"
          >
            {t("alerts.manageZones")}
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {groups.map((group) => {
              const zone = zoneFor(group.latest.zone_id);
              return (
                <AlertCard
                  key={group.key}
                  group={group}
                  phase={groupPhase(group, fires.data ?? new Map(), now)}
                  locale={locale}
                  zoneName={zone?.name ?? ""}
                  zoneRadiusKm={zone?.radius_km ?? null}
                  now={now}
                  onToggleRead={() =>
                    readMutation.mutate({
                      ids: group.messages.map((m) => m.id),
                      read: group.unread > 0,
                    })
                  }
                  onDelete={() =>
                    deleteMutation.mutate(group.messages.map((m) => m.id))
                  }
                />
              );
            })}
          </ul>
          <LoadMore query={alerts} />
        </>
      )}
    </main>
  );
}
