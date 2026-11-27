import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { QueryState } from "@/components/admin/kit/QueryState";
import { When } from "@/components/admin/kit/When";
import { Button } from "@/components/ui/button";
import {
  moderateSuggestion,
  suggestionQueueQuery,
  type SuggestionStatus,
  suggestionCountsQuery,
} from "@/lib/translate";

const STATUSES: SuggestionStatus[] = ["pending", "accepted", "rejected"];
const capital = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

export function TranslationQueue() {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [status, setStatus] = useState<SuggestionStatus>("pending");
  const [locale, setLocale] = useState<string>("all");
  const queue = useInfiniteQuery(
    suggestionQueueQuery(status, locale === "all" ? null : locale),
  );
  const counts = useQuery(suggestionCountsQuery);

  const act = useMutation({
    mutationFn: (input: { id: string; status: SuggestionStatus }) =>
      moderateSuggestion(input.id, input.status),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["translation-suggestions"] });
      await qc.invalidateQueries({ queryKey: ["admin", "attention"] });
    },
  });

  const rows = queue.data ?? [];
  const locales = counts.data?.locales ?? [];
  const groups = [
    ...rows
      .reduce((map, s) => {
        const key = `${s.locale}:${s.key_path}`;
        map.set(key, [...(map.get(key) ?? []), s]);
        return map;
      }, new Map<string, typeof rows>())
      .values(),
  ];
  const countOf = (value: SuggestionStatus) => counts.data?.strings[value] ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={status === value ? "default" : "outline"}
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
          >
            {t(`queues.filter${capital(value)}`)}
            <span className="tabular-nums opacity-70">{countOf(value)}</span>
          </Button>
        ))}
        <select
          aria-label={t("translationsPage.locale")}
          className="ms-auto h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={locale}
          onChange={(event) => setLocale(event.target.value)}
        >
          <option value="all">{t("translationsPage.allLocales")}</option>
          {locales.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <QueryState
        query={queue}
        isEmpty={() => groups.length === 0}
        empty={t("queues.translationsEmpty")}
      >
        {() => (
          <ul className="space-y-3">
            {groups.map((group) => {
              const first = group[0]!;
              return (
                <li
                  key={`${first.locale}:${first.key_path}`}
                  className="rounded-lg border border-border p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-semibold uppercase">
                      {first.locale}
                    </span>
                    <span className="font-mono">{first.key_path}</span>
                    {group.length > 1 ? (
                      <span>
                        ·{" "}
                        {t("translationsPage.suggestions", {
                          count: group.length,
                        })}
                      </span>
                    ) : null}
                  </div>
                  <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="text-muted-foreground">
                      {t("translationsPage.source")}
                    </dt>
                    <dd dir="ltr">{first.source_text}</dd>
                    <dt className="text-muted-foreground">
                      {t("translationsPage.current")}
                    </dt>
                    <dd dir="auto">{first.current_text}</dd>
                  </dl>
                  <ul className="mt-3 divide-y divide-border border-t border-border">
                    {group.map((s) => (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center gap-3 py-2 text-sm"
                      >
                        <span dir="auto" className="min-w-0 flex-1 font-medium">
                          {s.verdict === "confirmed"
                            ? t("queues.confirmedAsIs")
                            : s.suggestion}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {s.reviewer_name ? `${s.reviewer_name} · ` : ""}
                          <When at={s.created_at} />
                        </span>
                        {s.status === "pending" ? (
                          <span className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={act.isPending}
                              onClick={() =>
                                act.mutate({ id: s.id, status: "accepted" })
                              }
                            >
                              {t("queues.accept")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={act.isPending}
                              onClick={() =>
                                act.mutate({ id: s.id, status: "rejected" })
                              }
                            >
                              {t("queues.reject")}
                            </Button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
      <p className="text-xs text-muted-foreground">{t("queues.applyNote")}</p>
    </div>
  );
}
