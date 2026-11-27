import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Pause, Play, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import {
  acknowledgeIncident,
  deliveryQueueQuery,
  openGapsQuery,
  operationalIncidentsQuery,
  replayGap,
  setDeliveryChannelPaused,
  setSourcePaused,
  sourceHealthQuery,
  type DeliveryQueueHealth,
  type SourceGap,
  type SourceHealthRow,
} from "@/lib/admin-sources";
import { myRolesQuery } from "@/lib/reports";
import { cn } from "@/lib/utils";
import {
  ADMIN_TONE_BAR,
  AdminBadge,
  AdminConfirmDialog,
  AdminHeader,
  AdminQueryState,
  AdminSection,
  AdminWhen,
  type AdminTone,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import { AtlasButton, AtlasPanel, SafeBdi } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/sources")({
  component: SourcesPage,
});

function sourceTone(row: SourceHealthRow): AdminTone {
  if (!row.enabled || row.state === "paused") return "neutral";
  if (row.state === "healthy") return "ok";
  if (row.state === "delayed") return "warn";
  return "bad";
}

function tickColor(row: SourceHealthRow): string {
  if (!row.enabled || row.state === "paused") return "bg-hairline-strong";
  if (row.state === "healthy") return "bg-hazard-clear";
  if (row.state === "delayed") return "bg-hazard-high";
  return "bg-hazard-extreme";
}

function SourcesPage() {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const roles = useQuery(myRolesQuery);
  const isAdmin = !roles.isError && (roles.data ?? []).includes("admin");

  const healthQ = useQuery(sourceHealthQuery);
  const deliveryQ = useQuery(deliveryQueueQuery);
  const incidentsQ = useInfiniteQuery(operationalIncidentsQuery);
  const gapsQ = useInfiniteQuery(openGapsQuery);

  const [showResolved, setShowResolved] = useState(false);
  const [sourceTarget, setSourceTarget] = useState<SourceHealthRow | null>(
    null,
  );
  const [channelTarget, setChannelTarget] =
    useState<DeliveryQueueHealth | null>(null);
  const [gapTarget, setGapTarget] = useState<SourceGap | null>(null);

  const invalidateAll = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["admin", "sources"] }),
      qc.invalidateQueries({ queryKey: ["admin", "attention"] }),
    ]);

  const toggleSourceMut = useMutation({
    mutationFn: async ({
      row,
      reason,
    }: {
      row: SourceHealthRow;
      reason: string;
    }) => {
      if (!row.key) return;
      await setSourcePaused(row.key, row.enabled, reason || null);
    },
    onSuccess: async () => {
      await invalidateAll();
      toast.success(t("sources.saved"));
      setSourceTarget(null);
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  const toggleChannelMut = useMutation({
    mutationFn: async ({
      row,
      reason,
    }: {
      row: DeliveryQueueHealth;
      reason: string;
    }) => {
      await setDeliveryChannelPaused(row.channel, !row.paused, reason || null);
    },
    onSuccess: async () => {
      await invalidateAll();
      toast.success(t("sources.saved"));
      setChannelTarget(null);
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  const ackMut = useMutation({
    mutationFn: (id: string) => acknowledgeIncident(id),
    onSuccess: async () => {
      await invalidateAll();
      toast.success(t("sources.saved"));
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  const replayMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      replayGap(id, reason || null),
    onSuccess: async () => {
      await invalidateAll();
      toast.success(t("sources.saved"));
      setGapTarget(null);
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  const sources = healthQ.data ?? [];
  const healthyCount = sources.filter(
    (s) => s.enabled && s.state === "healthy",
  ).length;
  const unhealthyCount = sources.filter(
    (s) => s.enabled && s.state !== "healthy",
  ).length;
  const pausedCount = sources.filter((s) => !s.enabled).length;

  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.operations")}
        title={t("sources.title")}
        description={t("sources.subtitle")}
        actions={
          <AtlasButton
            variant="secondary"
            size="sm"
            onClick={() => void invalidateAll()}
          >
            <RefreshCw className="h-3.5 w-3.5 text-signal" />
            {t("kit.retry")}
          </AtlasButton>
        }
        metrics={[
          {
            label: t("sources.colSource"),
            value: <SafeBdi>{sources.length}</SafeBdi>,
          },
          {
            label: t("sources.state_healthy"),
            value: <SafeBdi>{healthyCount}</SafeBdi>,
            tone: "clear",
          },
          {
            label: t("sources.open"),
            value: <SafeBdi>{unhealthyCount}</SafeBdi>,
            tone: unhealthyCount > 0 ? "extreme" : "clear",
          },
          {
            label: t("sources.paused"),
            value: <SafeBdi>{pausedCount}</SafeBdi>,
            tone: pausedCount > 0 ? "high" : "neutral",
          },
        ]}
      />

      {/* Live tick telemetry bar */}
      {sources.length > 0 && (
        <AtlasPanel className="mb-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-ink">
              {unhealthyCount === 0
                ? t("sources.allHealthy")
                : t("sources.unhealthy", { count: unhealthyCount })}
            </span>
            <SafeBdi className="font-mono text-ink-muted">
              {Math.round((healthyCount / sources.length) * 100)}%
            </SafeBdi>
          </div>
          <div className="flex items-center gap-1">
            {sources.map((row) => (
              <span
                key={row.key ?? row.label}
                title={`${row.label ?? row.key ?? ""}: ${row.state ?? "unknown"}`}
                className={cn(
                  "h-6 flex-1 rounded-[3px] transition-opacity hover:opacity-80",
                  tickColor(row),
                )}
              />
            ))}
          </div>
          {isAdmin && (
            <p className="text-[11px] text-ink-muted">
              {cleanCopy(t("sources.sourcePauseHelp"))}
            </p>
          )}
        </AtlasPanel>
      )}

      {/* Sources table */}
      <AdminQueryState query={healthQ} rows={6}>
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-hairline bg-surface">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-hairline bg-surface-raised/60 text-ink-muted font-mono uppercase text-[10px]">
                  <th className="px-4 py-2.5 text-start font-medium">
                    {t("sources.colSource")}
                  </th>
                  <th className="px-3 py-2.5 text-start font-medium">
                    {t("sources.colState")}
                  </th>
                  <th className="px-3 py-2.5 text-start font-medium">
                    {t("sources.colReason")}
                  </th>
                  <th className="px-3 py-2.5 text-start font-medium">
                    {t("sources.colLastSuccess")}
                  </th>
                  {isAdmin && (
                    <th className="px-4 py-2.5 text-end font-medium">
                      {t("groups.operations")}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((row) => {
                  const tone = sourceTone(row);
                  const stateKey = !row.enabled
                    ? "paused"
                    : (row.state ?? "unknown");
                  return (
                    <tr
                      key={row.key ?? row.label}
                      className="hover:bg-surface-raised/40 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">
                          {cleanCopy(row.label ?? row.key ?? "-")}
                        </div>
                        <SafeBdi className="font-mono text-[10px] text-ink-muted">
                          {row.key ?? "-"}
                        </SafeBdi>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <AdminBadge tone={tone} dot>
                          {t(`sources.state_${stateKey}`, {
                            defaultValue: stateKey,
                          })}
                        </AdminBadge>
                      </td>
                      <td className="px-3 py-3 text-ink-secondary">
                        {row.public_reason_code
                          ? t(`sources.reason_${row.public_reason_code}`, {
                              defaultValue: row.public_reason_code,
                            })
                          : "-"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-ink-secondary">
                        <AdminWhen at={row.last_success_at} />
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-end whitespace-nowrap">
                          {row.key && !row.processing_only && (
                            <AtlasButton
                              variant="secondary"
                              size="sm"
                              onClick={() => setSourceTarget(row)}
                            >
                              {row.enabled ? (
                                <>
                                  <Pause className="h-3 w-3" />
                                  {t("sources.pause")}
                                </>
                              ) : (
                                <>
                                  <Play className="h-3 w-3 text-hazard-clear" />
                                  {t("sources.resume")}
                                </>
                              )}
                            </AtlasButton>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminQueryState>

      {/* Delivery Queues */}
      <AdminSection
        title={t("sources.deliveryQueues")}
        help={t("sources.pauseHelp")}
      >
        <AdminQueryState query={deliveryQ} rows={2}>
          {(channels) => (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {channels.map((ch) => (
                <AtlasPanel
                  key={ch.channel}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-base font-semibold text-ink">
                        {t(`sources.channel_${ch.channel}`, {
                          defaultValue: ch.channel,
                        })}
                      </span>
                      <AdminBadge tone={ch.paused ? "bad" : "ok"} dot>
                        {ch.paused ? t("sources.paused") : t("sources.running")}
                      </AdminBadge>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-secondary">
                      <span>
                        {t("sources.pending")}:{" "}
                        <SafeBdi className="font-mono font-semibold text-ink">
                          {ch.pending_count}
                        </SafeBdi>
                      </span>
                      <span>
                        {t("sources.expired")}:{" "}
                        <SafeBdi className="font-mono text-ink">
                          {ch.expired_count}
                        </SafeBdi>
                      </span>
                      {ch.oldest_pending_at && (
                        <span>
                          {t("sources.oldestPending")}:{" "}
                          <AdminWhen at={ch.oldest_pending_at} />
                        </span>
                      )}
                    </div>
                  </div>
                  <AtlasButton
                    variant={ch.paused ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setChannelTarget(ch)}
                  >
                    {ch.paused ? t("sources.resume") : t("sources.pause")}
                  </AtlasButton>
                </AtlasPanel>
              ))}
            </div>
          )}
        </AdminQueryState>
      </AdminSection>

      {/* Operational Incidents */}
      <AdminSection
        title={t("sources.operationalIncidents")}
        help={t("sources.incidentsHelp")}
      >
        <AdminQueryState query={incidentsQ} rows={3}>
          {(items) => {
            const openItems = items.filter((i) => !i.resolved_at);
            const resolvedItems = items.filter((i) => Boolean(i.resolved_at));
            const visible = showResolved ? items : openItems;
            return (
              <div className="space-y-3">
                {visible.length === 0 ? (
                  <AtlasPanel className="py-6 text-center text-xs text-ink-muted">
                    {t("sources.noOpenIncidents")}
                  </AtlasPanel>
                ) : (
                  <ul className="space-y-2">
                    {visible.map((inc) => {
                      const tone: AdminTone = inc.resolved_at
                        ? "ok"
                        : inc.acknowledged_at
                          ? "warn"
                          : "bad";
                      return (
                        <li
                          key={inc.id}
                          className="flex items-stretch overflow-hidden rounded-xl border border-hairline bg-surface"
                        >
                          <span
                            className={cn("w-1 shrink-0", ADMIN_TONE_BAR[tone])}
                          />
                          <div className="flex flex-1 flex-wrap items-center justify-between gap-3 px-4 py-3">
                            <div className="space-y-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <SafeBdi className="font-mono text-xs font-semibold text-ink">
                                  {inc.contract_key}
                                </SafeBdi>
                                <AdminBadge tone={tone}>
                                  {inc.resolved_at
                                    ? t("sources.resolved")
                                    : inc.acknowledged_at
                                      ? t("sources.acknowledged")
                                      : t("sources.open")}
                                </AdminBadge>
                              </div>
                              <div className="text-xs text-ink-secondary">
                                {t(`sources.reason_${inc.reason_code}`, {
                                  defaultValue: inc.reason_code,
                                })}{" "}
                                · <AdminWhen at={inc.last_seen_at} />
                              </div>
                            </div>
                            {!inc.resolved_at && !inc.acknowledged_at && (
                              <AtlasButton
                                variant="secondary"
                                size="sm"
                                disabled={ackMut.isPending}
                                onClick={() => ackMut.mutate(inc.id)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 text-signal" />
                                {t("sources.acknowledge")}
                              </AtlasButton>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {resolvedItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowResolved((v) => !v)}
                    className="text-xs font-medium text-signal hover:underline cursor-pointer"
                  >
                    {showResolved
                      ? t("sources.hideResolved")
                      : t("sources.showResolved", {
                          count: resolvedItems.length,
                        })}
                  </button>
                )}
              </div>
            );
          }}
        </AdminQueryState>
      </AdminSection>

      {/* Open Gaps */}
      <AdminSection title={t("sources.gaps")}>
        <AdminQueryState
          query={gapsQ}
          rows={2}
          isEmpty={(rows) => rows.length === 0}
          empty={t("sources.gapsEmpty")}
        >
          {(gaps) => (
            <ul className="space-y-2">
              {gaps.map((gap) => (
                <li
                  key={gap.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-surface px-4 py-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SafeBdi className="font-mono text-xs font-semibold text-ink">
                        {gap.contract_key}
                      </SafeBdi>
                      <AdminBadge
                        tone={
                          gap.state === "unrecoverable"
                            ? "bad"
                            : gap.state === "replaying"
                              ? "info"
                              : "warn"
                        }
                      >
                        {t(`sources.gap_${gap.state}`, {
                          defaultValue: gap.state,
                        })}
                      </AdminBadge>
                      <span className="text-[11px] font-mono text-ink-muted">
                        {t("sources.replayCount", { count: gap.replay_count })}
                      </span>
                    </div>
                    <div className="text-xs text-ink-secondary">
                      <AdminWhen at={gap.data_from} /> →{" "}
                      <AdminWhen at={gap.data_through} />
                    </div>
                  </div>
                  <AtlasButton
                    variant="secondary"
                    size="sm"
                    onClick={() => setGapTarget(gap)}
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-signal" />
                    {t("sources.replay")}
                  </AtlasButton>
                </li>
              ))}
            </ul>
          )}
        </AdminQueryState>
      </AdminSection>

      {/* Confirm dialogs */}
      <AdminConfirmDialog
        open={sourceTarget !== null}
        onOpenChange={(o) => !o && setSourceTarget(null)}
        title={
          sourceTarget
            ? sourceTarget.enabled
              ? t("sources.pauseSource", {
                  source: sourceTarget.label ?? sourceTarget.key ?? "",
                })
              : t("sources.resumeSource", {
                  source: sourceTarget.label ?? sourceTarget.key ?? "",
                })
            : ""
        }
        description={t("sources.sourcePauseHelp")}
        confirmLabel={
          sourceTarget?.enabled ? t("sources.pause") : t("sources.resume")
        }
        destructive={Boolean(sourceTarget?.enabled)}
        pending={toggleSourceMut.isPending}
        onConfirm={async (reason) => {
          if (sourceTarget)
            await toggleSourceMut.mutateAsync({ row: sourceTarget, reason });
        }}
      />

      <AdminConfirmDialog
        open={channelTarget !== null}
        onOpenChange={(o) => !o && setChannelTarget(null)}
        title={
          channelTarget
            ? `${channelTarget.paused ? t("sources.resume") : t("sources.pause")} ${t(`sources.channel_${channelTarget.channel}`, { defaultValue: channelTarget.channel })}`
            : ""
        }
        description={t("sources.pauseHelp")}
        confirmLabel={
          channelTarget?.paused ? t("sources.resume") : t("sources.pause")
        }
        destructive={Boolean(channelTarget && !channelTarget.paused)}
        pending={toggleChannelMut.isPending}
        onConfirm={async (reason) => {
          if (channelTarget)
            await toggleChannelMut.mutateAsync({ row: channelTarget, reason });
        }}
      />

      <AdminConfirmDialog
        open={gapTarget !== null}
        onOpenChange={(o) => !o && setGapTarget(null)}
        title={
          gapTarget
            ? t("sources.replayTitle", { source: gapTarget.contract_key })
            : ""
        }
        description={t("sources.replayHelp")}
        confirmLabel={t("sources.replay")}
        pending={replayMut.isPending}
        onConfirm={async (reason) => {
          if (gapTarget)
            await replayMut.mutateAsync({ id: gapTarget.id, reason });
        }}
      />
    </section>
  );
}
