import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";
import { QueryState } from "@/components/admin/kit/QueryState";
import { StatusBadge, type Tone } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { Button } from "@/components/ui/button";
import {
  discardSnapshot,
  publicationCheckpointsQuery,
  publishSnapshot,
  snapshotRunsQuery,
  type SnapshotRun,
} from "@/lib/admin-risk";

function runState(run: SnapshotRun): { key: string; tone: Tone } {
  if (run.status === "promoted") return { key: "promoted", tone: "ok" };
  if (run.status === "discarded") return { key: "discarded", tone: "neutral" };
  return run.finished_at
    ? { key: "awaiting", tone: "warn" }
    : { key: "running", tone: "neutral" };
}

export function RiskPublication() {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const runs = useQuery(snapshotRunsQuery);
  const checkpoints = useQuery(publicationCheckpointsQuery);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] });

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-medium">{t("risk.lastPublished")}</h2>
        <div className="mt-3">
          <QueryState
            query={checkpoints}
            rows={1}
            isEmpty={(rows) => rows.length === 0}
            empty={t("risk.neverPublished")}
          >
            {(rows) => (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {rows.slice(0, 5).map((checkpoint) => (
                  <li
                    key={checkpoint.key}
                    className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium tabular-nums">
                      {checkpoint.base_date}
                    </span>
                    <StatusBadge
                      tone={
                        checkpoint.coverage_status === "complete"
                          ? "ok"
                          : "warn"
                      }
                    >
                      {t(`risk.coverage_${checkpoint.coverage_status}`, {
                        defaultValue: checkpoint.coverage_status,
                      })}
                    </StatusBadge>
                    <span className="ms-auto text-xs text-muted-foreground">
                      <When at={checkpoint.published_at} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </div>
      </section>
      <section>
        <h2 className="font-medium">{t("risk.runs")}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("risk.runsHelp")}
        </p>
        <div className="mt-3">
          <QueryState
            query={runs}
            rows={3}
            isEmpty={(rows) => rows.length === 0}
            empty={t("risk.noRuns")}
          >
            {(rows) => (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {rows.map((run) => {
                  const state = runState(run);
                  return (
                    <li
                      key={run.snapshot_id}
                      className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                    >
                      <StatusBadge tone={state.tone}>
                        {t(`risk.run_${state.key}`)}
                      </StatusBadge>
                      <span className="font-medium tabular-nums">
                        {run.base_date}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        <When at={run.finished_at ?? run.created_at} />
                      </span>
                      {state.key === "awaiting" ? (
                        <span className="ms-auto flex gap-2">
                          <ConfirmDialog
                            trigger={
                              <Button size="sm">{t("risk.publish")}</Button>
                            }
                            title={t("risk.publishTitle", {
                              date: run.base_date,
                            })}
                            description={t("risk.publishDescription")}
                            confirmLabel={t("risk.publish")}
                            reason="optional"
                            onConfirm={async (reason) => {
                              await publishSnapshot(run, reason);
                              toast.success(t("risk.published"));
                              await refresh();
                            }}
                          />
                          <ConfirmDialog
                            trigger={
                              <Button size="sm" variant="outline">
                                {t("risk.discard")}
                              </Button>
                            }
                            title={t("risk.discardTitle", {
                              date: run.base_date,
                            })}
                            description={t("risk.discardDescription")}
                            confirmLabel={t("risk.discard")}
                            destructive
                            reason="required"
                            onConfirm={async (reason) => {
                              await discardSnapshot(run, reason ?? "");
                              toast.success(t("risk.discarded"));
                              await refresh();
                            }}
                          />
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </QueryState>
        </div>
      </section>
    </div>
  );
}
