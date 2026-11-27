import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";
import { QueryState } from "@/components/admin/kit/QueryState";
import { SplitView } from "@/components/admin/kit/SplitView";
import { StatusBadge, type Tone } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { ReportPhoto } from "@/components/ReportPhoto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AnyLocale } from "@/i18n";
import {
  adminUnitsQuery,
  clustersQuery,
  unitName,
  type FireCluster,
} from "@/lib/nadhir";
import {
  blockReporter,
  moderateReport,
  reportFlagsQuery,
  type CitizenReport,
  type ReportStatus,
  ReportMutationError,
  moderationQueueQuery,
  moderationCountsQuery,
  REPORT_QUEUE_FILTERS,
  type ReportQueueFilter,
} from "@/lib/reports";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<ReportStatus, Tone> = {
  pending: "warn",
  approved: "ok",
  rejected: "neutral",
};

function Verdict({ report }: { report: CitizenReport }) {
  const { t } = useTranslation("admin");
  const open =
    !!report.expires_at && Date.parse(report.expires_at) > Date.now();
  return (
    <>
      {report.user_flagged_at && report.status !== "rejected" && open ? (
        <StatusBadge tone="bad">{t("reportsPage.userFlagged")}</StatusBadge>
      ) : null}
      <StateBadge report={report} />
    </>
  );
}

function StateBadge({ report }: { report: CitizenReport }) {
  const { t } = useTranslation("admin");
  const { t: tApp } = useTranslation();
  if (report.status !== "pending")
    return (
      <StatusBadge tone={STATUS_TONE[report.status]}>
        {tApp(`reports.status${capital(report.status)}`)}
      </StatusBadge>
    );
  if (!report.expires_at || Date.parse(report.expires_at) <= Date.now())
    return <StatusBadge tone="neutral">{tApp("reports.expired")}</StatusBadge>;
  if (report.flagged_at)
    return <StatusBadge tone="bad">{t("reportsPage.flagged")}</StatusBadge>;
  return (
    <StatusBadge
      tone={
        report.publish_state === "private"
          ? "bad"
          : report.publish_state === "published"
            ? "ok"
            : "warn"
      }
    >
      {tApp(`reports.state.${report.publish_state}`)}
    </StatusBadge>
  );
}

const hazardLabel = (report: CitizenReport) =>
  report.hazard
    ? `reports.hazardName.${report.hazard}`
    : `reports.tile.${report.kind}`;
const capital = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function Detail({
  report,
  fires,
  onDone,
}: {
  report: CitizenReport;
  fires: FireCluster[];
  onDone: () => void;
}) {
  const { t } = useTranslation("admin");
  const { t: tApp } = useTranslation();
  const qc = useQueryClient();
  const [note, setNote] = useState(report.moderation_note ?? "");
  const [clusterId, setClusterId] = useState(report.cluster_id ?? "");
  const nearby = useMemo(
    () =>
      fires
        .map((fire) => ({ fire, km: distanceKm(report, fire) }))
        .filter(({ km }) => km <= 50)
        .sort((a, b) => a.km - b.km)
        .slice(0, 8),
    [fires, report],
  );
  const flags = useQuery(reportFlagsQuery(report.id));
  const moderate = useMutation({
    mutationFn: (status: ReportStatus) =>
      moderateReport({
        id: report.id,
        status,
        moderation_note: note.trim() || null,
        cluster_id: clusterId || null,
      }),
    onSuccess: async (_, status) => {
      toast.success(tApp(`reports.status${capital(status)}`));
      await qc.invalidateQueries({ queryKey: ["reports"] });
      await qc.invalidateQueries({ queryKey: ["admin", "attention"] });
      onDone();
    },
  });

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Verdict report={report} />
        {report.commune_id ? (
          <a
            className="inline-flex items-center gap-1 underline"
            href={`/?area=${report.commune_id}`}
          >
            <MapPin aria-hidden className="size-3.5" />
            {t("reportsPage.openMap")}
          </a>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t("reportsPage.observed")}</dt>
        <dd>
          <When at={report.observed_at} />
        </dd>
        <dt className="text-muted-foreground">{t("reportsPage.location")}</dt>
        <dd className="tabular-nums" dir="ltr">
          {report.lat.toFixed(4)}, {report.lon.toFixed(4)}
        </dd>
        <dt className="text-muted-foreground">{t("reportsPage.check")}</dt>
        <dd>
          {report.classified_at ? (
            <>
              {report.classifier === "fallback"
                ? t("reportsPage.checkFallback")
                : report.classifier}{" "}
              · <When at={report.classified_at} />
            </>
          ) : (
            t("reportsPage.checkPending")
          )}
        </dd>
        <dt className="text-muted-foreground">{t("reportsPage.summary")}</dt>
        <dd dir="auto">{report.summary ?? t("reportsPage.noSummary")}</dd>
      </dl>
      {flags.isError ? (
        <p role="alert" className="text-destructive">
          {t("reportsPage.flagsFailed")}
        </p>
      ) : flags.data?.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="col-span-2 font-medium">{t("reportsPage.flags")}</dt>
          {flags.data.map(({ reason, flags: count }) => (
            <div key={reason} className="contents">
              <dt className="text-muted-foreground">
                {t(`reportsPage.flagReason.${reason}`)}
              </dt>
              <dd className="tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {report.note ? (
        <figure className="space-y-1">
          <figcaption className="font-medium">
            {t("reportsPage.words")}
          </figcaption>
          <blockquote dir="auto" className="rounded-md bg-muted p-3">
            {report.note}
          </blockquote>
        </figure>
      ) : null}
      <ReportPhoto photo={report.photo_url} />
      {report.hazard === "fire" ? (
        <fieldset>
          <legend className="font-medium">
            {t("reportsPage.nearbyFires")}
          </legend>
          {nearby.length === 0 ? (
            <p className="mt-1 text-muted-foreground">
              {t("reportsPage.noNearby")}
            </p>
          ) : (
            <div className="mt-2 space-y-1">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`link-${report.id}`}
                  checked={clusterId === ""}
                  onChange={() => setClusterId("")}
                />
                {t("queues.linkNone")}
              </label>
              {nearby.map(({ fire, km }) => (
                <label key={fire.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`link-${report.id}`}
                    checked={clusterId === fire.id}
                    onChange={() => setClusterId(fire.id)}
                  />
                  <span className="font-mono text-xs">{fire.short_id}</span>
                  <span className="text-muted-foreground">
                    {t("reportsPage.km", { km: km.toFixed(1) })} ·{" "}
                    <When at={fire.last_detected_at} />
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ) : null}
      <label className="block">
        <span className="font-medium">{t("queues.modNote")}</span>
        <Input
          className="mt-1"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {moderate.isError ? (
        <p role="alert" className="text-destructive">
          {t(
            moderate.error instanceof ReportMutationError
              ? moderate.error.message
              : "reportsPage.moderateFailed",
          )}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={moderate.isPending}
          onClick={() => moderate.mutate("approved")}
        >
          {t("queues.approve")}
        </Button>
        <Button
          variant="outline"
          disabled={moderate.isPending}
          onClick={() => moderate.mutate("rejected")}
        >
          {t("queues.reject")}
        </Button>
        {report.status !== "pending" ? (
          <Button
            variant="ghost"
            disabled={moderate.isPending}
            onClick={() => moderate.mutate("pending")}
          >
            {t("queues.reopen")}
          </Button>
        ) : null}
        <ConfirmDialog
          trigger={
            <Button variant="destructive" disabled={moderate.isPending}>
              {t("reportsPage.block")}
            </Button>
          }
          title={t("reportsPage.blockTitle")}
          description={t("reportsPage.blockDescription")}
          confirmLabel={t("reportsPage.blockConfirm")}
          destructive
          reason="optional"
          onConfirm={async (reason) => {
            try {
              await blockReporter(report.id, reason);
            } catch (failure) {
              throw new Error(
                t(
                  failure instanceof ReportMutationError
                    ? failure.message
                    : "reportsPage.blockFailed",
                ),
                { cause: failure },
              );
            }
            toast.success(t("reportsPage.blocked"));
            await qc.invalidateQueries({ queryKey: ["reports"] });
            await qc.invalidateQueries({ queryKey: ["admin", "attention"] });
            onDone();
          }}
        />
      </div>
    </div>
  );
}

export function ReportModeration() {
  const { t } = useTranslation("admin");
  const { t: tApp, i18n } = useTranslation();
  const [filter, setFilter] = useState<ReportQueueFilter>("attention");
  const queue = useInfiniteQuery(moderationQueueQuery(filter));
  const counts = useQuery(moderationCountsQuery);
  const clusters = useQuery(clustersQuery);
  const units = useQuery(adminUnitsQuery);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const communes = useMemo(
    () =>
      new Map(
        (units.data ?? []).map((unit) => [
          unit.id,
          unitName(unit, i18n.language as AnyLocale),
        ]),
      ),
    [units.data, i18n.language],
  );
  const selected =
    queue.data?.find((report) => report.id === selectedId) ?? null;
  const countOf = (value: ReportQueueFilter) => counts.data?.[value] ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {REPORT_QUEUE_FILTERS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? "default" : "outline"}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {t(`queues.filter${capital(value)}`)}
            <span className="tabular-nums opacity-70">{countOf(value)}</span>
          </Button>
        ))}
      </div>
      <QueryState
        query={queue}
        isEmpty={(rows) => rows.length === 0}
        empty={t("queues.queueEmpty")}
      >
        {(rows) => (
          <SplitView
            detailTitle={t("reportsPage.detail")}
            placeholder={t("reportsPage.placeholder")}
            onClose={() => setSelectedId(null)}
            detail={
              selected ? (
                <Detail
                  key={selected.id}
                  report={selected}
                  fires={clusters.data ?? []}
                  onDone={() => setSelectedId(null)}
                />
              ) : null
            }
            list={
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {rows.map((report) => (
                  <li key={report.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(report.id)}
                      className={cn(
                        "block w-full px-4 py-3 text-start hover:bg-muted",
                        report.id === selectedId && "bg-muted",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <Verdict report={report} />
                        <span className="truncate text-sm font-medium">
                          {tApp(hazardLabel(report))}
                        </span>
                        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                          <When at={report.observed_at} />
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {(report.commune_id &&
                          communes.get(report.commune_id)) ||
                          `${report.lat.toFixed(3)}, ${report.lon.toFixed(3)}`}
                        {report.note ? (
                          <>
                            {" · "}
                            <bdi>{report.note}</bdi>
                          </>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </QueryState>
    </div>
  );
}
