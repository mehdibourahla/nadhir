import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/admin/kit/PageHeader";
import { QueryState } from "@/components/admin/kit/QueryState";
import { StatusBadge } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { attentionQuery } from "@/lib/admin-attention";
import { overviewRows, unappliedTranslationsQuery } from "@/lib/admin-overview";
import { myRolesQuery } from "@/lib/reports";

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

  return (
    <section>
      <PageHeader
        title={t("overview.title")}
        description={t("overview.description")}
      />
      <QueryState query={attention} rows={4}>
        {(counts) => {
          const rows = overviewRows(counts, unapplied.data ?? 0);
          if (rows.length === 0)
            return (
              <div className="rounded-lg border border-border p-8 text-center">
                <StatusBadge tone="ok">{t("overview.allClear")}</StatusBadge>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("overview.checked")}{" "}
                  <When at={new Date(attention.dataUpdatedAt).toISOString()} />
                </p>
              </div>
            );
          return (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {rows.map((row) => (
                <li key={row.item}>
                  <Link
                    to={row.path}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted"
                  >
                    <StatusBadge tone={row.tone} className="tabular-nums">
                      {row.count}
                    </StatusBadge>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {t(`overview.items.${row.item}`)}
                      </span>
                      {row.oldest ? (
                        <span className="text-xs text-muted-foreground">
                          {t("overview.oldest")} <When at={row.oldest} />
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
    </section>
  );
}
