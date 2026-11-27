import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bell, CloudSun, Download, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import {
  downloadSourcePayload,
  sourceArchiveQuery,
} from "@/lib/admin-source-archive";
import {
  retryTextDocument,
  textRecoveryQuery,
} from "@/lib/admin-text-recovery";
import type { EnsemblePreview } from "@/lib/ensemble";
import { fetchEnsemblePreview } from "@/lib/ensemble-preview";
import { pushTestArrival, testPushOnThisDevice } from "@/lib/push";
import { onTestPushArrival } from "@/lib/push-test-events";
import { cn } from "@/lib/utils";
import {
  AdminBadge,
  AdminHeader,
  AdminQueryState,
  AdminSection,
  AdminWhen,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import { AtlasButton, AtlasInput, AtlasPanel, SafeBdi } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/tools")({
  component: ToolsPage,
});

function TextRecoverySection() {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const query = useQuery(textRecoveryQuery);

  const retryMut = useMutation({
    mutationFn: (id: string) => retryTextDocument(id),
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["admin", "sources", "text-recovery"],
      });
      toast.success(t("sources.textRecovery.retryQueued"));
    },
    onError: () => toast.error(t("sources.textRecovery.retryFailed")),
  });

  return (
    <AdminSection
      title={t("sources.textRecovery.title")}
      help={t("sources.textRecovery.description")}
      className="mt-0"
    >
      <AdminQueryState
        query={query}
        rows={3}
        isEmpty={(rows) => rows.length === 0}
        empty={t("sources.textRecovery.empty")}
      >
        {(rows) => (
          <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface">
            {rows.map((row) => {
              const doc = row.source_documents as {
                published_at?: string | null;
                text_sources?: { label?: string | null } | null;
              } | null;
              return (
                <li
                  key={row.document_id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-medium text-ink">
                      {cleanCopy(doc?.text_sources?.label || row.document_id)}
                    </div>
                    <div className="text-ink-muted">
                      {t("sources.textRecovery.exhausted", {
                        count: row.attempts,
                      })}{" "}
                      · <AdminWhen at={row.updated_at} />
                    </div>
                  </div>
                  <AtlasButton
                    variant="secondary"
                    size="sm"
                    disabled={retryMut.isPending}
                    onClick={() => retryMut.mutate(row.document_id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-signal" />
                    {t("sources.textRecovery.retry")}
                  </AtlasButton>
                </li>
              );
            })}
          </ul>
        )}
      </AdminQueryState>
    </AdminSection>
  );
}

function SourceArchiveSection() {
  const { t } = useTranslation("admin");
  const [sourceInput, setSourceInput] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);

  const query = useInfiniteQuery(sourceArchiveQuery(sourceFilter, errorsOnly));

  const downloadMut = useMutation({
    mutationFn: (capture: {
      sha256: string | null;
      storage_path: string | null;
      byte_length: number | null;
    }) => downloadSourcePayload(capture),
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("sources.actionFailed"),
      ),
  });

  return (
    <AdminSection
      title={t("sources.archive.title")}
      help={t("sources.archive.description")}
    >
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSourceFilter(sourceInput.trim());
          }}
        >
          <AtlasInput
            value={sourceInput}
            onChange={(e) => setSourceInput(e.target.value)}
            placeholder={t("sources.archive.source")}
            className="w-56"
            dir="ltr"
          />
          <AtlasButton type="submit" variant="secondary" size="sm">
            <Search className="h-3.5 w-3.5" />
            {t("sources.archive.filter")}
          </AtlasButton>
        </form>

        <button
          type="button"
          role="switch"
          aria-checked={errorsOnly}
          onClick={() => setErrorsOnly((v) => !v)}
          className="inline-flex min-h-11 items-center gap-2.5 rounded-xl border border-hairline bg-surface px-3.5 text-xs font-medium text-ink hover:bg-surface-raised cursor-pointer"
        >
          <span
            className={cn(
              "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
              errorsOnly
                ? "bg-signal justify-end"
                : "bg-hairline-strong justify-start",
            )}
          >
            <span className="h-4 w-4 rounded-full bg-surface shadow-xs" />
          </span>
          <span>{t("sources.archive.errorsOnly")}</span>
        </button>
      </div>

      <AdminQueryState
        query={query}
        rows={4}
        isEmpty={(rows) => rows.length === 0}
        empty={t("sources.archive.empty")}
      >
        {(rows) => (
          <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface">
            {rows.map((cap) => {
              const status = cap.http_status ?? 0;
              const tone =
                status >= 400 || cap.error_code
                  ? "bad"
                  : status === 304
                    ? "neutral"
                    : "ok";
              return (
                <li
                  key={cap.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SafeBdi className="font-mono font-semibold text-ink">
                        {cap.source_key}
                      </SafeBdi>
                      <AdminBadge tone={tone}>
                        {status > 0
                          ? `HTTP ${status}`
                          : cap.error_code || t("sources.archive.captured")}
                      </AdminBadge>
                      {cap.byte_length !== null && (
                        <SafeBdi className="font-mono text-[11px] text-ink-muted">
                          {Math.round(cap.byte_length / 1024)} KB
                        </SafeBdi>
                      )}
                    </div>
                    <div className="text-ink-muted">
                      <AdminWhen at={cap.requested_at} />
                    </div>
                  </div>
                  {cap.storage_path && cap.sha256 && (
                    <AtlasButton
                      variant="secondary"
                      size="sm"
                      disabled={downloadMut.isPending}
                      onClick={() => downloadMut.mutate(cap)}
                    >
                      <Download className="h-3.5 w-3.5 text-signal" />
                      {t("sources.archive.download")}
                    </AtlasButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </AdminQueryState>
    </AdminSection>
  );
}

function PushTestSection() {
  const { t } = useTranslation("admin");
  const [status, setStatus] = useState<string | null>(null);
  const [testId, setTestId] = useState<string | null>(null);

  useEffect(() => {
    if (!testId) return;
    let active = true;
    const unsub = onTestPushArrival((ev) => {
      if (!ev.testId || ev.testId === testId) {
        setStatus(t("sources.pushTestReceived", { time: ev.receivedAt }));
        setTestId(null);
      }
    });
    const timer = window.setInterval(async () => {
      try {
        const at = await pushTestArrival(testId);
        if (active && at) {
          setStatus(t("sources.pushTestReceived", { time: at }));
          setTestId(null);
        }
      } catch {
        // keep polling until timeout
      }
    }, 4000);
    const timeout = window.setTimeout(() => {
      if (active) {
        setStatus(t("sources.pushTestUnconfirmed"));
        setTestId(null);
      }
    }, 60_000);
    return () => {
      active = false;
      unsub();
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [testId, t]);

  const sendMut = useMutation({
    mutationFn: testPushOnThisDevice,
    onSuccess: (id) => {
      setTestId(id);
      setStatus(t("sources.pushTestAccepted"));
    },
    onError: (err) => {
      const key = err instanceof Error ? err.message : "";
      setStatus(
        t(key, { defaultValue: t("sources.pushTestErrors.unavailable") }),
      );
    },
  });

  return (
    <AdminSection
      title={t("sources.pushTestTitle")}
      help={t("sources.pushTestHelp")}
    >
      <AtlasPanel className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 text-xs text-ink-secondary">
          <div className="font-medium text-ink">
            {t("sources.pushTestTitle")}
          </div>
          {status && <p className="text-signal">{cleanCopy(status)}</p>}
        </div>
        <AtlasButton
          variant="primary"
          size="sm"
          disabled={sendMut.isPending}
          onClick={() => sendMut.mutate()}
        >
          <Bell className="h-3.5 w-3.5" />
          {sendMut.isPending
            ? t("sources.pushTestWaiting")
            : t("sources.pushTestButton")}
        </AtlasButton>
      </AtlasPanel>
    </AdminSection>
  );
}

function EnsembleSection() {
  const { t } = useTranslation("admin");
  const [code, setCode] = useState("1601");
  const [preview, setPreview] = useState<EnsemblePreview | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => fetchEnsemblePreview(code.trim()),
    onSuccess: (data) => {
      setPreview(data);
      setErrorKey(null);
    },
    onError: (err) => {
      setPreview(null);
      setErrorKey(err instanceof Error ? err.message : "unavailable");
    },
  });

  return (
    <AdminSection
      title={t("sources.ensemble.title")}
      help={t("sources.ensemble.description")}
    >
      <AtlasPanel className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mut.mutate();
          }}
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-ink-secondary">
              {t("sources.ensemble.communeCode")}
            </label>
            <AtlasInput
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="1601"
              className="w-36 font-mono"
              dir="ltr"
            />
          </div>
          <AtlasButton
            type="submit"
            variant="primary"
            size="sm"
            disabled={mut.isPending || !code.trim()}
          >
            <CloudSun className="h-3.5 w-3.5" />
            {mut.isPending
              ? t("sources.ensemble.loading")
              : t("sources.ensemble.submit")}
          </AtlasButton>
        </form>

        {errorKey && (
          <div className="rounded-xl border border-hazard-extreme/35 bg-hazard-extreme-soft/40 p-3 text-xs text-hazard-extreme-ink">
            {t(`sources.ensemble.${errorKey}`, {
              defaultValue: t("sources.ensemble.unavailable"),
            })}
          </div>
        )}

        {preview && (
          <div className="space-y-3 border-t border-hairline pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-ink">
                {t("sources.ensemble.retrieved", {
                  name: preview.commune.name_fr,
                  code: preview.commune.code,
                  time: preview.fetched_at,
                })}
              </span>
              <span className="font-mono text-ink-muted">
                {t("sources.ensemble.forecastDate", {
                  date: preview.hours[0]?.valid_at.slice(0, 10) ?? "",
                })}
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-hairline">
              <table className="w-full text-start text-xs font-mono">
                <thead>
                  <tr className="border-b border-hairline bg-surface-raised/60 text-ink-muted text-[10px] uppercase">
                    <th className="px-3 py-2 text-start">
                      {t("sources.ensemble.validTime")}
                    </th>
                    <th className="px-3 py-2 text-start">
                      {t("sources.ensemble.temperature")}
                    </th>
                    <th className="px-3 py-2 text-start">
                      {t("sources.ensemble.precipitation")}
                    </th>
                    <th className="px-3 py-2 text-start">
                      {t("sources.ensemble.wind")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {preview.hours.map((h) => (
                    <tr key={h.valid_at}>
                      <td className="px-3 py-1.5 text-ink">
                        <SafeBdi>{h.valid_at.slice(11, 16)}Z</SafeBdi>
                      </td>
                      <td className="px-3 py-1.5 text-ink">
                        <SafeBdi>
                          {h.temperature_2m.min.toFixed(1)} ..{" "}
                          {h.temperature_2m.max.toFixed(1)}
                        </SafeBdi>
                      </td>
                      <td className="px-3 py-1.5 text-hazard-rain-ink">
                        <SafeBdi>
                          {h.precipitation.min.toFixed(1)} ..{" "}
                          {h.precipitation.max.toFixed(1)}
                        </SafeBdi>
                      </td>
                      <td className="px-3 py-1.5 text-ink-secondary">
                        <SafeBdi>
                          {h.wind_speed_10m.min.toFixed(0)} ..{" "}
                          {h.wind_speed_10m.max.toFixed(0)}
                        </SafeBdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-ink-muted">
              {cleanCopy(t("sources.ensemble.attribution"))}
            </p>
          </div>
        )}
      </AtlasPanel>
    </AdminSection>
  );
}

function ToolsPage() {
  const { t } = useTranslation("admin");
  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.admin")}
        title={t("tools.title")}
        description={t("tools.description")}
      />
      <TextRecoverySection />
      <SourceArchiveSection />
      <PushTestSection />
      <EnsembleSection />
    </section>
  );
}
