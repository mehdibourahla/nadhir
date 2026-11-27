import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/admin/kit/PageHeader";
import { RiskPublication } from "@/components/admin/RiskPublication";

export const Route = createFileRoute("/_authenticated/admin/risk")({
  component: Page,
});

function Page() {
  const { t } = useTranslation("admin");
  return (
    <section>
      <PageHeader title={t("risk.title")} description={t("risk.subtitle")} />
      <RiskPublication />
    </section>
  );
}
