import { useState } from "react";
import { useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  downloadSourcePayload,
  sourceArchiveQuery,
} from "@/lib/admin-source-archive";
import { LoadMore } from "@/components/LoadMore";

export function SourceArchive() {
  const { t } = useTranslation("admin");
  const [source, setSource] = useState("");
  const [draft, setDraft] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const captures = useInfiniteQuery(sourceArchiveQuery(source, errorsOnly));
  const download = useMutation({ mutationFn: downloadSourcePayload });
  return (
    <section className="mt-8" aria-labelledby="source-archive-title">
      <h2 id="source-archive-title" className="text-sm font-medium">
        {t("sources.archive.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("sources.archive.description")}
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSource(draft.trim());
        }}
      >
        <label className="text-sm">
          {t("sources.archive.source")}
          <input
            className="ms-2 rounded border border-border bg-background px-2 py-1"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={100}
            pattern="[a-z0-9_-]*"
            placeholder="ita_website"
          />
        </label>
        <button
          className="rounded border border-border px-3 py-1 text-sm"
          type="submit"
        >
          {t("sources.archive.filter")}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(event) => setErrorsOnly(event.target.checked)}
          />
          {t("sources.archive.errorsOnly")}
        </label>
      </form>
      {captures.isPending && (
        <p className="mt-2 text-sm">{t("sources.loading")}</p>
      )}
      {captures.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("sources.loadFailed")}: {captures.error.message}
        </p>
      )}
      {download.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("sources.actionFailed")}: {download.error.message}
        </p>
      )}
      {captures.data?.length === 0 && (
        <p className="mt-2 text-sm">{t("sources.archive.empty")}</p>
      )}
      <div className="mt-3 space-y-2">
        {captures.data?.map((capture) => (
          <details
            key={capture.id}
            className="rounded border border-border p-3 text-sm"
          >
            <summary className="cursor-pointer">
              {capture.source_key} · {capture.endpoint} · {capture.requested_at}{" "}
              · {t(`sources.archive.${capture.status}`)}
            </summary>
            <p className="mt-2 text-xs">
              {capture.media_type ?? t("empty.unknown")} ·{" "}
              {capture.byte_length ?? 0} bytes · HTTP{" "}
              {capture.http_status ?? t("empty.unknown")}
            </p>
            {capture.error_code && (
              <p className="mt-1 text-destructive">{capture.error_code}</p>
            )}
            {capture.status === "captured" && (
              <button
                className="mt-2 rounded border border-border px-3 py-1 disabled:opacity-50"
                disabled={download.isPending}
                onClick={() => download.mutate(capture)}
              >
                {t("sources.archive.download")}
              </button>
            )}
            <pre
              dir="ltr"
              className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs"
            >
              {JSON.stringify(capture, null, 2)}
            </pre>
          </details>
        ))}
      </div>
      <LoadMore query={captures} />
    </section>
  );
}
