import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/admin/kit/PageHeader";
import { ReportModeration } from "@/components/admin/ReportModeration";

export const Route = createFileRoute("/_authenticated/admin/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const { t } = useTranslation("admin");
  return (
    <section>
      <PageHeader
        title={t("reportsPage.title")}
        description={t("reportsPage.description")}
      />
      <ReportModeration />
    </section>
  );
}
