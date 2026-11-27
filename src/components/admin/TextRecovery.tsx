import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  retryTextDocument,
  textRecoveryQuery,
} from "@/lib/admin-text-recovery";

export function TextRecovery() {
  const { t } = useTranslation("admin");
  const reports = useQuery(textRecoveryQuery);
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: retryTextDocument,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "sources"] }),
  });
  return (
    <section className="mt-8" aria-labelledby="text-recovery-title">
      <h2 id="text-recovery-title" className="text-sm font-medium">
        {t("sources.textRecovery.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("sources.textRecovery.description")}
      </p>
      {reports.isPending && <p role="status">{t("sources.loading")}</p>}
      {reports.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("sources.loadFailed")}
        </p>
      )}
      {retry.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("sources.textRecovery.retryFailed")}
        </p>
      )}
      {retry.isSuccess && (
        <p role="status" className="text-sm">
          {t("sources.textRecovery.retryQueued")}
        </p>
      )}
      {reports.data?.length === 0 && (
        <p className="mt-2 text-sm">{t("sources.textRecovery.empty")}</p>
      )}
      <div className="mt-3 space-y-3">
        {reports.data?.map((report) => (
          <article
            key={report.document_id}
            className="rounded border border-border p-3 text-sm"
          >
            <p>{report.source_documents.text_sources.label}</p>
            <time dateTime={report.source_documents.published_at}>
              {new Date(report.source_documents.published_at).toLocaleString()}
            </time>
            <p>
              {t("sources.textRecovery.exhausted", { count: report.attempts })}
            </p>
            <button
              type="button"
              className="mt-2 rounded border px-3 py-1"
              disabled={retry.isPending}
              onClick={() => retry.mutate(report.document_id)}
            >
              {t("sources.textRecovery.retry")}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
