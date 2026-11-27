import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ChevronRight, RefreshCw } from "lucide-react";

import { sectionsFor } from "@/lib/admin-access";
import { attentionQuery } from "@/lib/admin-attention";
import { overviewRows, unappliedTranslationsQuery } from "@/lib/admin-overview";
import { myRolesQuery } from "@/lib/reports";
import { cn } from "@/lib/utils";
import {
  ADMIN_TONE_BAR,
  AdminBadge,
  AdminHeader,
  AdminQueryState,
  AdminSection,
  AdminWhen,
  type AdminTone,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import { AtlasButton, AtlasPanel, SafeBdi } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: OverviewPage,
});

function OverviewPage() {
  const { t } = useTranslation("admin");
  const roles = useQuery(myRolesQuery);
  const attention = useQuery(attentionQuery);
  const translator = (roles.data ?? []).some(
    (role) => role === "translator" || role === "admin",
  );
  const unapplied = useQuery({
    ...unappliedTranslationsQuery,
    enabled: translator,
  });

  const rows = attention.data
    ? overviewRows(attention.data, unapplied.data ?? 0)
    : [];
  const criticalCount = rows
    .filter((r) => r.tone === "bad")
    .reduce((sum, r) => sum + r.count, 0);
  const warnCount = rows
    .filter((r) => r.tone === "warn")
    .reduce((sum, r) => sum + r.count, 0);
  const totalWaiting = rows.reduce((sum, r) => sum + r.count, 0);
  const permitted = sectionsFor(roles.data ?? []).filter(
    (s) => s.key !== "overview",
  );

  return (
    <section>
      <AdminHeader
        eyebrow={t("shell.title")}
        title={t("overview.title")}
        description={t("overview.description")}
        actions={
          <AtlasButton
            variant="secondary"
            size="sm"
            onClick={() => void attention.refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5 text-signal" />
            {t("kit.retry")}
          </AtlasButton>
        }
        metrics={[
          {
            label: t("sources.open"),
            value: <SafeBdi>{rows.length}</SafeBdi>,
            tone: rows.length > 0 ? "high" : "clear",
          },
          {
            label: t("groups.operations"),
            value: <SafeBdi>{criticalCount}</SafeBdi>,
            tone: criticalCount > 0 ? "extreme" : "clear",
          },
          {
            label: t("groups.review"),
            value: <SafeBdi>{warnCount}</SafeBdi>,
            tone: warnCount > 0 ? "high" : "clear",
          },
          {
            label: t("overview.checked"),
            value: <SafeBdi>{totalWaiting}</SafeBdi>,
            detail: attention.dataUpdatedAt ? (
              <AdminWhen at={new Date(attention.dataUpdatedAt).toISOString()} />
            ) : undefined,
          },
        ]}
      />

      <AdminQueryState query={attention} rows={4}>
        {(counts) => {
          const liveRows = overviewRows(counts, unapplied.data ?? 0);
          if (liveRows.length === 0) {
            return (
              <AtlasPanel className="flex flex-col items-center justify-center py-12 text-center border-hazard-clear/35">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-hazard-clear-soft text-hazard-clear-ink">
                  <CheckCircle2 className="h-6 w-6" />
                </span>
                <AdminBadge tone="ok" dot>
                  {t("overview.allClear")}
                </AdminBadge>
                <p className="mt-2 text-xs text-ink-muted">
                  {t("overview.checked")}{" "}
                  <AdminWhen
                    at={new Date(attention.dataUpdatedAt).toISOString()}
                  />
                </p>
              </AtlasPanel>
            );
          }

          return (
            <ul className="space-y-2.5">
              {liveRows.map((row) => {
                const tone = row.tone as AdminTone;
                return (
                  <li key={row.item}>
                    <Link
                      to={row.path}
                      className="flex items-stretch overflow-hidden rounded-xl border border-hairline bg-surface hover:border-hairline-strong hover:bg-surface-raised/60 transition-colors"
                    >
                      <span
                        aria-hidden="true"
                        className={cn("w-1 shrink-0", ADMIN_TONE_BAR[tone])}
                      />
                      <div className="flex flex-1 items-center gap-4 px-4 py-3.5 min-w-0">
                        <AdminBadge
                          tone={tone}
                          className="min-w-10 justify-center font-mono tabular-nums"
                        >
                          <SafeBdi>{row.count}</SafeBdi>
                        </AdminBadge>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-ink">
                            {cleanCopy(t(`overview.items.${row.item}`))}
                          </div>
                          {row.oldest && (
                            <div className="mt-0.5 text-xs text-ink-muted">
                              {t("overview.oldest")}{" "}
                              <AdminWhen at={row.oldest} />
                            </div>
                          )}
                        </div>
                        <ChevronRight
                          aria-hidden
                          className="h-4 w-4 shrink-0 text-ink-muted atlas-dir-icon"
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </AdminQueryState>

      {permitted.length > 0 && (
        <AdminSection title={t("shell.title")}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {permitted.map((section) => (
              <Link
                key={section.key}
                to={section.path}
                className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-surface px-3.5 py-3 text-sm font-medium text-ink hover:border-hairline-strong hover:text-signal transition-colors"
              >
                <span className="truncate">
                  {cleanCopy(t(`nav.${section.key}`))}
                </span>
                <ChevronRight
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 text-ink-muted atlas-dir-icon"
                />
              </Link>
            ))}
          </div>
        </AdminSection>
      )}
    </section>
  );
}
