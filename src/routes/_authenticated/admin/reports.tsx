import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Ban, CheckCircle2, Flag, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { clustersQuery, coordLabel } from "@/lib/nadhir";
import {
  REPORT_QUEUE_FILTERS,
  blockReporter,
  moderateReport,
  moderationQueueQuery,
  reportFlagsQuery,
  signedPhotoUrl,
  type CitizenReport,
  type ReportQueueFilter,
  type ReportStatus,
} from "@/lib/reports";
import { cn } from "@/lib/utils";
import {
  ADMIN_TONE_BAR,
  AdminBadge,
  AdminConfirmDialog,
  AdminFilterTabs,
  AdminHeader,
  AdminQueryState,
  AdminSplitWorkbench,
  AdminWhen,
  type AdminTone,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import { MiniHazardMap } from "@/ui/hazard-map";
import {
  AtlasButton,
  AtlasSelect,
  AtlasTextarea,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/reports")({
  component: ReportsPage,
});

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function reportTone(report: CitizenReport): AdminTone {
  if (report.user_flagged_at || report.flagged_at) return "bad";
  if (report.status === "approved") return "ok";
  if (report.status === "rejected") return "neutral";
  return "warn";
}

function ReportInspector({
  report,
  onDone,
}: {
  report: CitizenReport;
  onDone: () => void;
}) {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [note, setNote] = useState(report.moderation_note ?? "");
  const [clusterId, setClusterId] = useState<string>(report.cluster_id ?? "");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);

  const flagsQ = useQuery({
    ...reportFlagsQuery(report.id),
    enabled: Boolean(report.user_flagged_at),
  });
  const firesQ = useQuery(clustersQuery);

  useEffect(() => {
    let active = true;
    setPhotoUrl(null);
    if (!report.photo_url) return;
    void signedPhotoUrl(report.photo_url).then((url) => {
      if (active) setPhotoUrl(url);
    });
    return () => {
      active = false;
    };
  }, [report.photo_url]);

  const nearbyFires = useMemo(() => {
    const cutoff = Date.now() - 72 * 3_600_000;
    return (firesQ.data ?? [])
      .filter((c) => Date.parse(c.last_detected_at) >= cutoff)
      .map((c) => ({
        cluster: c,
        km: haversineKm(report.lat, report.lon, c.lat, c.lon),
      }))
      .filter((x) => x.km <= 50)
      .sort((a, b) => a.km - b.km);
  }, [firesQ.data, report.lat, report.lon]);

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["reports", "queue"] }),
      qc.invalidateQueries({ queryKey: ["admin", "attention"] }),
    ]);

  const modMut = useMutation({
    mutationFn: (status: ReportStatus) =>
      moderateReport({
        id: report.id,
        status,
        moderation_note: note.trim() || null,
        cluster_id: clusterId || null,
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("sources.saved"));
      onDone();
    },
    onError: (err) => {
      const key = err instanceof Error ? err.message : "";
      toast.error(t(key, { defaultValue: t("reportsPage.moderateFailed") }));
    },
  });

  const blockMut = useMutation({
    mutationFn: (reason: string) => blockReporter(report.id, reason || null),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("reportsPage.blocked"));
      setBlockOpen(false);
      onDone();
    },
    onError: () => toast.error(t("reportsPage.blockFailed")),
  });

  const statusLabel = (s: string) =>
    s === "pending"
      ? t("queues.filterPending")
      : s === "approved"
        ? t("queues.filterApproved")
        : s === "rejected"
          ? t("queues.filterRejected")
          : s;

  const publishLabel = (s: string) =>
    s === "published"
      ? t("publication.active")
      : s === "held"
        ? t("publication.agent.hold")
        : s === "classifying"
          ? t("publication.agent.processing")
          : t("publication.reason");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <AdminBadge tone={reportTone(report)} dot>
          {statusLabel(report.status)}
        </AdminBadge>
        <AdminBadge tone="info">
          {publishLabel(report.publish_state)}
        </AdminBadge>
        <AdminBadge tone="neutral">
          {t(`publication.hazards.${report.hazard ?? report.kind}`, {
            defaultValue: (report.hazard ?? report.kind).replace(/_/g, " "),
          })}
        </AdminBadge>
        {report.flagged_at && (
          <AdminBadge tone="bad">{t("reportsPage.flagged")}</AdminBadge>
        )}
        {report.user_flagged_at && (
          <AdminBadge tone="bad">
            <Flag className="h-3 w-3" />
            {t("reportsPage.userFlagged")}
          </AdminBadge>
        )}
      </div>

      <MiniHazardMap
        lat={report.lat}
        lon={report.lon}
        zoom={12}
        className="h-48"
      />

      {photoUrl && (
        <div className="overflow-hidden rounded-xl border border-hairline bg-canvas">
          <img
            src={photoUrl}
            alt={t("reportsPage.detail")}
            className="max-h-64 w-full object-contain"
          />
        </div>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-hairline bg-surface-raised/50 p-3.5 text-xs">
        <div>
          <dt className="text-ink-muted">{t("reportsPage.observed")}</dt>
          <dd className="mt-0.5 text-ink">
            <AdminWhen at={report.observed_at} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("reportsPage.location")}</dt>
          <dd className="mt-0.5 font-mono text-ink">
            <SafeBdi>{coordLabel(report.lat, report.lon)}</SafeBdi>
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-ink-muted">{t("reportsPage.summary")}</dt>
          <dd className="mt-0.5 text-sm text-ink">
            {report.summary
              ? cleanCopy(report.summary)
              : t("reportsPage.noSummary")}
          </dd>
        </div>
        {report.note && (
          <div className="sm:col-span-2">
            <dt className="text-ink-muted">{t("reportsPage.words")}</dt>
            <dd className="mt-0.5 text-sm text-ink whitespace-pre-wrap">
              {cleanCopy(report.note)}
            </dd>
          </div>
        )}
      </dl>

      {report.user_flagged_at && (
        <div className="rounded-xl border border-hazard-extreme/35 bg-hazard-extreme-soft/40 p-3 text-xs space-y-1.5">
          <div className="font-semibold text-hazard-extreme-ink">
            {t("reportsPage.flags")}
          </div>
          {flagsQ.isError ? (
            <div className="text-ink-secondary">
              {t("reportsPage.flagsFailed")}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(flagsQ.data ?? []).map((f) => (
                <AdminBadge key={f.reason} tone="bad">
                  {t(`reportsPage.flagReason.${f.reason}`)}: {f.flags}
                </AdminBadge>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3 border-t border-hairline pt-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-ink-secondary">
            {t("reportsPage.nearbyFires")}
          </label>
          {nearbyFires.length === 0 ? (
            <p className="text-xs text-ink-muted">
              {t("reportsPage.noNearby")}
            </p>
          ) : (
            <AtlasSelect
              value={clusterId}
              onChange={(e) => setClusterId(e.target.value)}
            >
              <option value="">{t("queues.linkNone")}</option>
              {nearbyFires.map(({ cluster, km }) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.short_id} ·{" "}
                  {t("reportsPage.km", { km: km.toFixed(1) })}
                </option>
              ))}
            </AtlasSelect>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-ink-secondary">
            {t("queues.modNote")}
          </label>
          <AtlasTextarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {report.status !== "approved" && (
            <AtlasButton
              variant="primary"
              size="sm"
              disabled={modMut.isPending}
              onClick={() => modMut.mutate("approved")}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("queues.approve")}
            </AtlasButton>
          )}
          {report.status !== "rejected" && (
            <AtlasButton
              variant="secondary"
              size="sm"
              disabled={modMut.isPending}
              onClick={() => modMut.mutate("rejected")}
            >
              <XCircle className="h-3.5 w-3.5 text-hazard-extreme" />
              {t("queues.reject")}
            </AtlasButton>
          )}
          {report.status !== "pending" && (
            <AtlasButton
              variant="secondary"
              size="sm"
              disabled={modMut.isPending}
              onClick={() => modMut.mutate("pending")}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("queues.reopen")}
            </AtlasButton>
          )}
          <AtlasButton
            variant="danger"
            size="sm"
            className="ms-auto"
            onClick={() => setBlockOpen(true)}
          >
            <Ban className="h-3.5 w-3.5" />
            {t("reportsPage.block")}
          </AtlasButton>
        </div>
      </div>

      <AdminConfirmDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title={t("reportsPage.blockTitle")}
        description={t("reportsPage.blockDescription")}
        confirmLabel={t("reportsPage.blockConfirm")}
        destructive
        reasonMode="optional"
        pending={blockMut.isPending}
        onConfirm={async (reason) => {
          await blockMut.mutateAsync(reason);
        }}
      />
    </div>
  );
}

function ReportsPage() {
  const { t } = useTranslation("admin");
  const [filter, setFilter] = useState<ReportQueueFilter>("attention");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useInfiniteQuery(moderationQueueQuery(filter));
  const selected = query.data?.find((r) => r.id === selectedId) ?? null;

  const filterLabels: Record<ReportQueueFilter, string> = {
    attention: t("queues.filterAttention"),
    pending: t("queues.filterPending"),
    approved: t("queues.filterApproved"),
    rejected: t("queues.filterRejected"),
    all: t("queues.filterAll"),
  };

  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.review")}
        title={t("reportsPage.title")}
        description={t("reportsPage.description")}
      />

      <div className="mb-5">
        <AdminFilterTabs
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setSelectedId(null);
          }}
          options={REPORT_QUEUE_FILTERS.map((f) => ({
            value: f,
            label: filterLabels[f],
          }))}
        />
      </div>

      <AdminQueryState
        query={query}
        isEmpty={(rows) => rows.length === 0}
        empty={t("queues.queueEmpty")}
      >
        {(rows) => (
          <AdminSplitWorkbench
            detailTitle={t("reportsPage.detail")}
            placeholder={t("reportsPage.placeholder")}
            onClose={() => setSelectedId(null)}
            detail={
              selected ? (
                <ReportInspector
                  key={selected.id}
                  report={selected}
                  onDone={() => setSelectedId(null)}
                />
              ) : null
            }
            list={
              <ul className="space-y-2">
                {rows.map((report) => {
                  const tone = reportTone(report);
                  const active = report.id === selectedId;
                  return (
                    <li key={report.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(report.id)}
                        className={cn(
                          "flex w-full items-stretch overflow-hidden rounded-xl border text-start transition-colors cursor-pointer",
                          active
                            ? "border-signal bg-signal-soft/40"
                            : "border-hairline bg-surface hover:border-hairline-strong",
                        )}
                      >
                        <span
                          className={cn("w-1 shrink-0", ADMIN_TONE_BAR[tone])}
                        />
                        <div className="flex-1 px-3.5 py-3 space-y-1.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <AdminBadge tone={tone}>
                              {t(
                                `publication.hazards.${report.hazard ?? report.kind}`,
                                {
                                  defaultValue: (
                                    report.hazard ?? report.kind
                                  ).replace(/_/g, " "),
                                },
                              )}
                            </AdminBadge>
                            <span className="font-mono text-[11px] text-ink-muted">
                              {report.publish_state === "published"
                                ? t("publication.active")
                                : report.publish_state === "held"
                                  ? t("publication.agent.hold")
                                  : report.publish_state}
                            </span>
                            <span className="ms-auto text-[11px] text-ink-muted">
                              <AdminWhen at={report.created_at} />
                            </span>
                          </div>
                          <div className="truncate text-sm font-medium text-ink">
                            {cleanCopy(
                              report.summary ||
                                report.note ||
                                coordLabel(report.lat, report.lon),
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            }
          />
        )}
      </AdminQueryState>
    </section>
  );
}
