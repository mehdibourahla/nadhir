import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { QueryState } from "@/components/admin/kit/QueryState";
import { SplitView } from "@/components/admin/kit/SplitView";
import { StatusBadge, type Tone } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  itaReportsQuery,
  retryItaReport,
  type ItaReport,
} from "@/lib/admin-ita";
import { myRolesQuery } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { AgentReasoning } from "./AgentReasoning";

type Report = ItaReport;

const STATE_TONE: Record<string, Tone> = {
  publish: "ok",
  review: "warn",
  failed: "bad",
  hold: "warn",
};

function status(report: Report): { key: string; tone: Tone } {
  if (report.extraction)
    return report.extraction.disposition === "incident_report"
      ? { key: "extracted", tone: "ok" }
      : { key: "general", tone: "neutral" };
  return report.extraction_error
    ? { key: "failed", tone: "bad" }
    : { key: "pending", tone: "neutral" };
}

function Detail({ report }: { report: Report }) {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const roles = useQuery(myRolesQuery);
  const retry = useMutation({
    mutationFn: () => retryItaReport(report.id),
    onSuccess: async () => {
      toast.success(t("ita.retryQueued"));
      await qc.invalidateQueries({ queryKey: ["admin", "ita"] });
    },
    onError: () => toast.error(t("ita.retryFailed")),
  });
  const canRetry =
    (roles.data ?? []).includes("admin") &&
    !report.extraction &&
    report.extraction_attempts > 0 &&
    !!report.extraction_error;
  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge tone={status(report).tone}>
          {t(`ita.extraction.${status(report).key}`)}
        </StatusBadge>
        <a
          href={report.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          {t("ita.openPost")} <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t("ita.published")}</dt>
        <dd>
          <When at={report.published_at} />
        </dd>
        <dt className="text-muted-foreground">{t("ita.collected")}</dt>
        <dd>
          <When at={report.fetched_at} />
        </dd>
      </dl>
      <blockquote
        dir="auto"
        className="whitespace-pre-wrap rounded-md bg-muted p-3"
      >
        {report.body}
      </blockquote>
      {report.extraction_error ? (
        <p role="alert" className="text-destructive">
          {report.extraction_error} ({report.extraction_attempts}/5)
        </p>
      ) : null}
      {canRetry ? (
        <Button
          variant="outline"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          {t("ita.retry")}
        </Button>
      ) : null}
      {report.extraction?.incidents.map((incident, index) => {
        const work = report.civil_investigations.find(
          (item) => item.incident_index === index,
        );
        return (
          <section
            key={index}
            className="space-y-2 border-t border-border pt-4"
          >
            <div className="flex items-center gap-2">
              {work ? (
                <StatusBadge tone={STATE_TONE[work.state] ?? "neutral"}>
                  {t(`publication.agent.${work.state}`)}
                </StatusBadge>
              ) : null}
            </div>
            <p lang="fr">{incident.summary_fr}</p>
            {work ? <AgentReasoning entries={work.history} /> : null}
          </section>
        );
      })}
      {report.extraction ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {t("ita.technical")}
          </summary>
          <pre
            dir="ltr"
            className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words"
          >
            {JSON.stringify(report.extraction, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function ItaFeed() {
  const { t } = useTranslation("admin");
  const [exhaustedOnly, setExhaustedOnly] = useState(false);
  const reports = useInfiniteQuery(itaReportsQuery(exhaustedOnly));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = reports.data?.find((row) => row.id === selectedId) ?? null;
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={exhaustedOnly}
          onCheckedChange={(value) => setExhaustedOnly(value === true)}
        />
        {t("ita.exhaustedOnly")}
      </label>
      <QueryState
        query={reports}
        isEmpty={(rows) => rows.length === 0}
        empty={t("ita.feedEmpty")}
      >
        {(rows) => (
          <SplitView
            detailTitle={t("ita.detail")}
            placeholder={t("ita.placeholder")}
            onClose={() => setSelectedId(null)}
            detail={selected ? <Detail report={selected} /> : null}
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
                        <StatusBadge tone={status(report).tone}>
                          {t(`ita.extraction.${status(report).key}`)}
                        </StatusBadge>
                        {report.extraction?.incidents.length ? (
                          <span className="text-xs text-muted-foreground">
                            {t("ita.incidents", {
                              count: report.extraction.incidents.length,
                            })}
                          </span>
                        ) : null}
                        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                          <When at={report.published_at} />
                        </span>
                      </span>
                      <span dir="auto" className="mt-1.5 line-clamp-2 text-sm">
                        {report.body}
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
