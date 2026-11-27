import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";
import { QueryState } from "@/components/admin/kit/QueryState";
import { StatusBadge, type Tone } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  acknowledgeIncident,
  deliveryQueueQuery,
  openGapsQuery,
  operationalIncidentsQuery,
  replayGap,
  setDeliveryChannelPaused,
  setSourcePaused,
  sourceHealthQuery,
  type SourceHealthRow,
} from "@/lib/admin-sources";
import { myRolesQuery } from "@/lib/reports";

const STATE_TONE: Record<string, Tone> = {
  healthy: "ok",
  delayed: "warn",
  degraded: "warn",
  stale: "bad",
  paused: "neutral",
};
// the same states admin_attention_counts counts, so the verdict and the nav badge agree
const UNHEALTHY = ["delayed", "degraded", "stale"];
const REASONS = [
  "internal_error",
  "data_delayed",
  "credentials_missing",
  "upstream_unreachable",
  "schema_invalid",
  "licence_invalid",
  "run_delayed",
  "queue_delayed",
  "lease_expired",
  "delivery_expired",
  "budget_exhausted",
  "disabled",
  "network_error",
];

export function Section({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-medium">{title}</h2>
      {help ? (
        <p className="mt-0.5 text-sm text-muted-foreground">{help}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["admin"] });
}

function sourceState(row: SourceHealthRow) {
  return row.enabled ? (row.state ?? "unknown") : "paused";
}

export function Health({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation("admin");
  const { t: tApp } = useTranslation();
  const health = useQuery(sourceHealthQuery);
  const invalidate = useInvalidate();
  const reason = (code: string | null) =>
    !code ? "" : REASONS.includes(code) ? t(`sources.reason_${code}`) : code;
  return (
    <QueryState query={health} rows={6}>
      {(rows) => {
        const unhealthy = rows.filter((row) =>
          UNHEALTHY.includes(sourceState(row)),
        ).length;
        return (
          <>
            <StatusBadge tone={unhealthy === 0 ? "ok" : "bad"}>
              {unhealthy === 0
                ? t("sources.allHealthy")
                : t("sources.unhealthy", { count: unhealthy })}
            </StatusBadge>
            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("sources.colSource")}</TableHead>
                    <TableHead>{t("sources.colState")}</TableHead>
                    <TableHead>{t("sources.colLastSuccess")}</TableHead>
                    <TableHead>{t("sources.colReason")}</TableHead>
                    {isAdmin ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const state = sourceState(row);
                    return (
                      <TableRow
                        key={`${row.key}:${row.processing_only ?? false}`}
                      >
                        <TableCell>
                          <span className="font-medium">
                            {row.label ?? row.key}
                          </span>
                          {row.processing_only ? (
                            <span className="block text-xs text-muted-foreground">
                              {tApp("status.processingDegraded")}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={STATE_TONE[state] ?? "neutral"}>
                            {t(`sources.state_${state}`, {
                              defaultValue: state,
                            })}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-sm">
                          <When at={row.last_success_at} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {reason(row.public_reason_code)}
                        </TableCell>
                        {isAdmin ? (
                          <TableCell className="text-end">
                            {row.key && !row.processing_only ? (
                              <ConfirmDialog
                                trigger={
                                  <Button size="sm" variant="outline">
                                    {row.enabled
                                      ? t("sources.pause")
                                      : t("sources.resume")}
                                  </Button>
                                }
                                title={t(
                                  row.enabled
                                    ? "sources.pauseSource"
                                    : "sources.resumeSource",
                                  { source: row.label ?? row.key },
                                )}
                                description={t("sources.sourcePauseHelp")}
                                confirmLabel={
                                  row.enabled
                                    ? t("sources.pause")
                                    : t("sources.resume")
                                }
                                destructive={row.enabled}
                                reason={row.enabled ? "required" : "optional"}
                                onConfirm={async (why) => {
                                  await setSourcePaused(
                                    row.key!,
                                    row.enabled,
                                    why,
                                  );
                                  toast.success(t("sources.saved"));
                                  await invalidate();
                                }}
                              />
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        );
      }}
    </QueryState>
  );
}

export function Delivery() {
  const { t } = useTranslation("admin");
  const queues = useQuery(deliveryQueueQuery);
  const invalidate = useInvalidate();
  return (
    <QueryState query={queues} rows={2}>
      {(rows) => (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sources.channel")}</TableHead>
                <TableHead>{t("sources.colState")}</TableHead>
                <TableHead className="text-end">
                  {t("sources.pending")}
                </TableHead>
                <TableHead className="text-end">
                  {t("sources.expired")}
                </TableHead>
                <TableHead>{t("sources.oldestPending")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.channel}>
                  <TableCell className="font-medium">
                    {t(`sources.channel_${row.channel}`)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={row.paused ? "warn" : "ok"}>
                      {row.paused ? t("sources.paused") : t("sources.running")}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {row.pending_count}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {row.expired_count}
                  </TableCell>
                  <TableCell className="text-sm">
                    <When at={row.oldest_pending_at} />
                  </TableCell>
                  <TableCell className="text-end">
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="outline">
                          {row.paused
                            ? t("sources.resume")
                            : t("sources.pause")}
                        </Button>
                      }
                      title={t(
                        row.paused
                          ? "sources.resumeSource"
                          : "sources.pauseSource",
                        { source: t(`sources.channel_${row.channel}`) },
                      )}
                      description={t("sources.pauseHelp")}
                      confirmLabel={
                        row.paused ? t("sources.resume") : t("sources.pause")
                      }
                      destructive={!row.paused}
                      reason={row.paused ? "optional" : "required"}
                      onConfirm={async (why) => {
                        await setDeliveryChannelPaused(
                          row.channel,
                          !row.paused,
                          why,
                        );
                        toast.success(t("sources.saved"));
                        await invalidate();
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </QueryState>
  );
}

export function Incidents() {
  const { t } = useTranslation("admin");
  const incidents = useInfiniteQuery(operationalIncidentsQuery);
  const invalidate = useInvalidate();
  const [showResolved, setShowResolved] = useState(false);
  const acknowledge = useMutation({
    mutationFn: acknowledgeIncident,
    onSuccess: invalidate,
  });
  return (
    <QueryState query={incidents} rows={2}>
      {(rows) => {
        const open = rows.filter((row) => !row.resolved_at);
        const resolved = rows.filter((row) => row.resolved_at);
        const shown = showResolved ? rows : open;
        return (
          <div className="space-y-2">
            {open.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("sources.noOpenIncidents")}
              </p>
            ) : null}
            {shown.length > 0 ? (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {shown.map((incident) => (
                  <li
                    key={incident.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                  >
                    <StatusBadge
                      tone={
                        incident.resolved_at
                          ? "neutral"
                          : incident.acknowledged_at
                            ? "warn"
                            : "bad"
                      }
                    >
                      {incident.resolved_at
                        ? t("sources.resolved")
                        : incident.acknowledged_at
                          ? t("sources.acknowledged")
                          : t("sources.open")}
                    </StatusBadge>
                    <span className="font-medium">{incident.contract_key}</span>
                    <span className="text-muted-foreground">
                      {REASONS.includes(incident.reason_code)
                        ? t(`sources.reason_${incident.reason_code}`)
                        : incident.reason_code}
                    </span>
                    <span className="ms-auto text-xs text-muted-foreground">
                      <When at={incident.last_seen_at} />
                    </span>
                    {!incident.resolved_at && !incident.acknowledged_at ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={acknowledge.isPending}
                        onClick={() => acknowledge.mutate(incident.id)}
                      >
                        {t("sources.acknowledge")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {resolved.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowResolved((value) => !value)}
              >
                {showResolved
                  ? t("sources.hideResolved")
                  : t("sources.showResolved", { count: resolved.length })}
              </Button>
            ) : null}
          </div>
        );
      }}
    </QueryState>
  );
}

export function Gaps() {
  const { t } = useTranslation("admin");
  const gaps = useInfiniteQuery(openGapsQuery);
  const invalidate = useInvalidate();
  return (
    <QueryState
      query={gaps}
      rows={2}
      isEmpty={(rows) => rows.length === 0}
      empty={t("sources.gapsEmpty")}
    >
      {(rows) => (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {rows.map((gap) => (
            <li
              key={gap.id}
              className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
            >
              <span className="font-medium">{gap.contract_key}</span>
              <span className="text-muted-foreground">
                <When at={gap.data_from} /> → <When at={gap.data_through} />
              </span>
              <span className="text-xs text-muted-foreground">
                {t(`sources.gap_${gap.state}`, { defaultValue: gap.state })} ·{" "}
                {t("sources.replayCount", { count: gap.replay_count })}
              </span>
              <span className="ms-auto">
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline">
                      {t("sources.replay")}
                    </Button>
                  }
                  title={t("sources.replayTitle", { source: gap.contract_key })}
                  description={t("sources.replayHelp")}
                  confirmLabel={t("sources.replay")}
                  reason="optional"
                  onConfirm={async (why) => {
                    await replayGap(gap.id, why);
                    toast.success(t("sources.saved"));
                    await invalidate();
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </QueryState>
  );
}
