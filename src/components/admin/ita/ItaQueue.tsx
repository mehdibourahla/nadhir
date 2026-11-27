import { useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";
import { QueryState } from "@/components/admin/kit/QueryState";
import { SplitView } from "@/components/admin/kit/SplitView";
import { StatusBadge } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { Button } from "@/components/ui/button";
import {
  civilAttentionQuery,
  type CivilAttention,
  dismissCivilInvestigation,
} from "@/lib/admin-ita";
import { cn } from "@/lib/utils";
import { AgentReasoning } from "./AgentReasoning";
import { PublicationForm } from "./PublicationForm";

type Work = CivilAttention;

function Detail({ work, onDone }: { work: Work; onDone: () => void }) {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const published = work.report.civil_publications.some(
    (p) => p.incident_index === work.incident_index,
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge tone={work.state === "failed" ? "bad" : "warn"}>
          {t(`publication.agent.${work.state}`)}
        </StatusBadge>
        <a
          href={work.report.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm underline"
        >
          {t("ita.openPost")} <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </div>
      <blockquote
        dir="auto"
        className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm"
      >
        {work.report.body}
      </blockquote>
      {work.error ? (
        <p role="alert" className="text-sm text-destructive">
          {work.error}
        </p>
      ) : null}
      <AgentReasoning entries={work.history} />
      {published ? (
        <p className="text-sm text-muted-foreground">
          {t("ita.alreadyPublished")}
        </p>
      ) : (
        <PublicationForm
          key={work.id}
          reportId={work.report_id}
          incidentIndex={work.incident_index}
          summary={work.latest?.summary ?? work.summary}
          publishedAt={work.report.published_at}
          suggestion={work.latest}
          onDone={onDone}
        />
      )}
      <div className="border-t border-border pt-4">
        <ConfirmDialog
          trigger={<Button variant="outline">{t("ita.dismiss")}</Button>}
          title={t("ita.dismiss")}
          description={t("ita.dismissDescription")}
          confirmLabel={t("ita.dismiss")}
          reason="required"
          onConfirm={async (reason) => {
            await dismissCivilInvestigation(work.id, reason ?? "");
            toast.success(t("ita.dismissed"));
            await qc.invalidateQueries({ queryKey: ["admin"] });
            onDone();
          }}
        />
      </div>
    </div>
  );
}

export function ItaQueue() {
  const { t } = useTranslation("admin");
  const queue = useInfiniteQuery(civilAttentionQuery);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = queue.data?.find((work) => work.id === selectedId) ?? null;
  return (
    <QueryState
      query={queue}
      isEmpty={(rows) => rows.length === 0}
      empty={t("ita.queueEmpty")}
    >
      {(rows) => (
        <SplitView
          detailTitle={t("ita.detail")}
          placeholder={t("ita.placeholder")}
          onClose={() => setSelectedId(null)}
          detail={
            selected ? (
              <Detail work={selected} onDone={() => setSelectedId(null)} />
            ) : null
          }
          list={
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {rows.map((work) => (
                <li key={work.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(work.id)}
                    className={cn(
                      "block w-full px-4 py-3 text-start hover:bg-muted",
                      work.id === selectedId && "bg-muted",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <StatusBadge
                        tone={work.state === "failed" ? "bad" : "warn"}
                      >
                        {t(`publication.agent.${work.state}`)}
                      </StatusBadge>
                      <span className="ms-auto text-xs text-muted-foreground">
                        <When at={work.report.published_at} />
                      </span>
                    </span>
                    <span
                      lang="fr"
                      dir="auto"
                      className="mt-1.5 line-clamp-2 text-sm"
                    >
                      {work.latest?.summary ?? work.summary}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          }
        />
      )}
    </QueryState>
  );
}
