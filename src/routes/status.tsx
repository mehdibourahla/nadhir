import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SourceHealth } from "@/components/nadhir/SourceHealth";
import { SkeletonList } from "@/components/nadhir/states";
import type { Locale } from "@/i18n";
import { recallDailyQuery, sourceHealthQuery } from "@/lib/nadhir";
import { pageMeta } from "@/lib/page-meta";
import { summariseSourceHealth } from "@/lib/source-health";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: pageMeta("status.metaTitle", "status.metaDescription"),
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(sourceHealthQuery),
  component: StatusPage,
});

function StatusPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const sources = useQuery(sourceHealthQuery);
  const recall = useQuery({ ...recallDailyQuery, retry: false });

  const summary = summariseSourceHealth(sources.data ?? []);
  const recallTotals = (recall.data ?? []).reduce(
    (acc, d) => ({
      communes: acc.communes + d.communes,
      withCluster: acc.withCluster + d.with_cluster,
    }),
    { communes: 0, withCluster: 0 },
  );

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6">
      <h1 className="text-2xl">{t("status.title")}</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        {t("status.subtitle")}
      </p>

      {sources.isError ? (
        <p
          role="alert"
          className="mt-4 rounded-lg px-3 py-2 text-sm"
          style={{
            backgroundColor: "var(--emergency-surface)",
            color: "var(--emergency-ink)",
          }}
        >
          {t("status.state.unavailable")}
        </p>
      ) : summary.affected > 0 ? (
        <p
          role="status"
          className="mt-4 rounded-lg px-3 py-2 text-sm"
          style={{
            backgroundColor: "var(--emergency-surface)",
            color: "var(--emergency-ink)",
          }}
        >
          {t("status.degradedCount", { count: summary.affected })}
        </p>
      ) : null}

      {sources.isLoading ? (
        <SkeletonList rows={4} className="mt-5" />
      ) : sources.isError ? null : (
        <ul className="card mt-5">
          {(sources.data ?? []).map((source) => (
            <SourceHealth key={source.key} source={source} locale={locale} />
          ))}
        </ul>
      )}

      {recall.data && recall.data.length > 0 ? (
        <section className="card mt-5 p-4">
          <h2 className="text-base">{t("status.recallTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("status.recallBody", {
              seen: recallTotals.withCluster,
              total: recallTotals.communes,
              days: recall.data.length,
            })}
          </p>
          <ul className="mt-3 grid gap-1 text-sm tabular">
            {recall.data.map((d) => (
              <li key={d.day} className="flex justify-between gap-4">
                <span>{d.day}</span>
                <span>
                  {d.with_cluster} / {d.communes}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground">{t("status.note")}</p>
    </div>
  );
}
