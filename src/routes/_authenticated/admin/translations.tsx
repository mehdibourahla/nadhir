import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { toast } from "sonner";

import { LOCALE_LABELS, type AnyLocale } from "@/i18n";
import {
  moderateSuggestion,
  suggestionCountsQuery,
  suggestionQueueQuery,
  type SuggestionStatus,
  type TranslationSuggestion,
} from "@/lib/translate";
import {
  AdminBadge,
  AdminFilterTabs,
  AdminHeader,
  AdminQueryState,
  AdminWhen,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import { AtlasButton, AtlasPanel, AtlasSelect, SafeBdi } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/translations")({
  component: TranslationsPage,
});

const STATUSES: SuggestionStatus[] = ["pending", "accepted", "rejected"];

function TranslationsPage() {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [status, setStatus] = useState<SuggestionStatus>("pending");
  const [localeFilter, setLocaleFilter] = useState<string>("");

  const countsQ = useQuery(suggestionCountsQuery);
  const queueQ = useInfiniteQuery(
    suggestionQueueQuery(status, localeFilter || null),
  );

  const mut = useMutation({
    mutationFn: ({ id, next }: { id: string; next: SuggestionStatus }) =>
      moderateSuggestion(id, next),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["translation-suggestions"] }),
        qc.invalidateQueries({ queryKey: ["admin", "attention"] }),
        qc.invalidateQueries({ queryKey: ["admin", "translations"] }),
      ]);
      toast.success(t("sources.saved"));
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, TranslationSuggestion[]>();
    for (const row of queueQ.data ?? []) {
      const k = `${row.locale}:${row.key_path}`;
      const list = map.get(k);
      if (list) list.push(row);
      else map.set(k, [row]);
    }
    return [...map.entries()].map(([key, items]) => ({ key, items }));
  }, [queueQ.data]);

  const statusLabels: Record<SuggestionStatus, string> = {
    pending: t("queues.filterPending"),
    accepted: t("queues.filterAccepted"),
    rejected: t("queues.filterRejected"),
  };

  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.review")}
        title={t("translationsPage.title")}
        description={t("translationsPage.description")}
      />

      <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-hairline bg-surface-raised/60 px-4 py-3 text-xs text-ink-secondary">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
        <p className="leading-relaxed">{cleanCopy(t("queues.applyNote"))}</p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <AdminFilterTabs
          value={status}
          onChange={setStatus}
          options={STATUSES.map((s) => ({
            value: s,
            label: statusLabels[s],
            count: countsQ.data?.strings?.[s],
          }))}
        />

        <AtlasSelect
          aria-label={t("translationsPage.locale")}
          value={localeFilter}
          onChange={(e) => setLocaleFilter(e.target.value)}
          className="w-44"
        >
          <option value="">{t("translationsPage.allLocales")}</option>
          {(countsQ.data?.locales ?? ["ar", "fr", "kab"]).map((loc) => (
            <option key={loc} value={loc}>
              {LOCALE_LABELS[loc as AnyLocale] ?? loc}
            </option>
          ))}
        </AtlasSelect>
      </div>

      <AdminQueryState
        query={queueQ}
        isEmpty={(rows) => rows.length === 0}
        empty={t("queues.translationsEmpty")}
      >
        {() => (
          <div className="space-y-4">
            {grouped.map(({ key, items }) => {
              const first = items[0]!;
              return (
                <AtlasPanel key={key} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <AdminBadge tone="info">
                        {first.locale.toUpperCase()}
                      </AdminBadge>
                      <SafeBdi className="font-mono text-xs font-semibold text-ink">
                        {first.key_path}
                      </SafeBdi>
                    </div>
                    <span className="font-mono text-[11px] text-ink-muted">
                      {t("translationsPage.suggestions", {
                        count: items.length,
                      })}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg border border-hairline bg-canvas/50 p-3 space-y-1">
                      <div className="font-mono text-[10px] uppercase text-ink-muted">
                        {t("translationsPage.source")}
                      </div>
                      <div className="text-ink leading-relaxed" dir="ltr">
                        {cleanCopy(first.source_text)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-hairline bg-canvas/50 p-3 space-y-1">
                      <div className="font-mono text-[10px] uppercase text-ink-muted">
                        {t("translationsPage.current")}
                      </div>
                      <div
                        className="text-ink leading-relaxed"
                        dir={first.locale === "ar" ? "rtl" : "ltr"}
                      >
                        {cleanCopy(first.current_text)}
                      </div>
                    </div>
                  </div>

                  <ul className="divide-y divide-hairline">
                    {items.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-1 last:pb-0"
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <AdminBadge
                              tone={
                                item.verdict === "confirmed" ? "ok" : "warn"
                              }
                            >
                              {item.verdict === "confirmed"
                                ? t("queues.confirmedAsIs")
                                : item.locale.toUpperCase()}
                            </AdminBadge>
                            {item.reviewer_name && (
                              <span className="font-medium text-ink-secondary">
                                {cleanCopy(item.reviewer_name)}
                              </span>
                            )}
                            <span className="text-[11px] text-ink-muted">
                              <AdminWhen at={item.created_at} />
                            </span>
                          </div>
                          {item.suggestion && (
                            <p
                              className="text-sm font-medium text-ink leading-relaxed"
                              dir={item.locale === "ar" ? "rtl" : "ltr"}
                            >
                              {cleanCopy(item.suggestion)}
                            </p>
                          )}
                          {item.note && (
                            <p className="text-xs text-ink-muted">
                              {cleanCopy(item.note)}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {item.status !== "accepted" && (
                            <AtlasButton
                              variant="primary"
                              size="sm"
                              disabled={mut.isPending}
                              onClick={() =>
                                mut.mutate({ id: item.id, next: "accepted" })
                              }
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {t("queues.accept")}
                            </AtlasButton>
                          )}
                          {item.status !== "rejected" && (
                            <AtlasButton
                              variant="secondary"
                              size="sm"
                              disabled={mut.isPending}
                              onClick={() =>
                                mut.mutate({ id: item.id, next: "rejected" })
                              }
                            >
                              <XCircle className="h-3.5 w-3.5 text-hazard-extreme" />
                              {t("queues.reject")}
                            </AtlasButton>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </AtlasPanel>
              );
            })}
          </div>
        )}
      </AdminQueryState>
    </section>
  );
}
