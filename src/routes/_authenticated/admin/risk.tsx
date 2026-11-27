import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  discardSnapshot,
  publicationCheckpointsQuery,
  publishSnapshot,
  snapshotRunsQuery,
  type SnapshotRun,
} from "@/lib/admin-risk";
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
import { AtlasButton, AtlasPanel, SafeBdi } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/risk")({
  component: RiskPage,
});

function runTone(status: string): AdminTone {
  if (status === "promoted") return "ok";
  if (status === "awaiting") return "warn";
  if (status === "running") return "info";
  return "neutral";
}

function RiskPage() {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const checkpointsQ = useQuery(publicationCheckpointsQuery);
  const runsQ = useQuery(snapshotRunsQuery);

  const [target, setTarget] = useState<{
    run: SnapshotRun;
    action: "publish" | "discard";
  } | null>(null);

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["admin", "risk"] }),
      qc.invalidateQueries({ queryKey: ["admin", "attention"] }),
    ]);

  const mut = useMutation({
    mutationFn: async ({
      run,
      action,
      reason,
    }: {
      run: SnapshotRun;
      action: "publish" | "discard";
      reason: string;
    }) => {
      if (action === "publish") {
        await publishSnapshot(run, reason || null);
      } else {
        await discardSnapshot(run, reason);
      }
    },
    onSuccess: async (_, vars) => {
      await invalidate();
      toast.success(
        vars.action === "publish" ? t("risk.published") : t("risk.discarded"),
      );
      setTarget(null);
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.operations")}
        title={t("risk.title")}
        description={t("risk.subtitle")}
      />

      <AdminSection title={t("risk.lastPublished")} className="mt-0">
        <AdminQueryState
          query={checkpointsQ}
          rows={2}
          isEmpty={(rows) => rows.length === 0}
          empty={t("risk.neverPublished")}
        >
          {(rows) => (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {rows.map((cp) => (
                <AtlasPanel
                  key={`${cp.key}-${cp.published_at}`}
                  className="space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <SafeBdi className="font-mono text-xs font-semibold text-ink">
                      {cp.base_date}
                    </SafeBdi>
                    <AdminBadge
                      tone={cp.coverage_status === "complete" ? "ok" : "warn"}
                    >
                      {t(`risk.coverage_${cp.coverage_status}`, {
                        defaultValue: cp.coverage_status,
                      })}
                    </AdminBadge>
                  </div>
                  <div className="text-xs text-ink-secondary">
                    <SafeBdi className="font-mono">{cp.key}</SafeBdi> ·{" "}
                    <AdminWhen at={cp.published_at} />
                  </div>
                </AtlasPanel>
              ))}
            </div>
          )}
        </AdminQueryState>
      </AdminSection>

      <AdminSection title={t("risk.runs")} help={t("risk.runsHelp")}>
        <AdminQueryState
          query={runsQ}
          rows={4}
          isEmpty={(rows) => rows.length === 0}
          empty={t("risk.noRuns")}
        >
          {(runs) => (
            <ul className="space-y-2.5">
              {runs.map((run) => {
                const tone = runTone(run.status);
                const awaiting = run.status === "awaiting";
                return (
                  <li
                    key={run.snapshot_id}
                    className="flex items-stretch overflow-hidden rounded-xl border border-hairline bg-surface"
                  >
                    <span
                      className={cn("w-1 shrink-0", ADMIN_TONE_BAR[tone])}
                    />
                    <div className="flex flex-1 flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <SafeBdi className="font-mono text-sm font-semibold text-ink">
                            {run.base_date}
                          </SafeBdi>
                          <AdminBadge tone={tone} dot>
                            {t(`risk.run_${run.status}`, {
                              defaultValue: run.status,
                            })}
                          </AdminBadge>
                          <SafeBdi className="font-mono text-[11px] text-ink-muted">
                            {run.snapshot_id.slice(0, 8)}
                          </SafeBdi>
                        </div>
                        <div className="text-xs text-ink-secondary">
                          <AdminWhen at={run.created_at} />
                          {run.finished_at && (
                            <>
                              {" "}
                              → <AdminWhen at={run.finished_at} />
                            </>
                          )}
                        </div>
                      </div>

                      {awaiting && (
                        <div className="flex items-center gap-2">
                          <AtlasButton
                            variant="primary"
                            size="sm"
                            onClick={() =>
                              setTarget({ run, action: "publish" })
                            }
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {t("risk.publish")}
                          </AtlasButton>
                          <AtlasButton
                            variant="danger"
                            size="sm"
                            onClick={() =>
                              setTarget({ run, action: "discard" })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t("risk.discard")}
                          </AtlasButton>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </AdminQueryState>
      </AdminSection>

      <AdminConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={
          target
            ? target.action === "publish"
              ? t("risk.publishTitle", { date: target.run.base_date })
              : t("risk.discardTitle", { date: target.run.base_date })
            : ""
        }
        description={
          target
            ? target.action === "publish"
              ? t("risk.publishDescription")
              : t("risk.discardDescription")
            : ""
        }
        confirmLabel={
          target?.action === "publish" ? t("risk.publish") : t("risk.discard")
        }
        destructive={target?.action === "discard"}
        reasonMode={target?.action === "discard" ? "required" : "optional"}
        pending={mut.isPending}
        onConfirm={async (reason) => {
          if (target)
            await mut.mutateAsync({
              run: target.run,
              action: target.action,
              reason,
            });
        }}
      />
    </section>
  );
}
