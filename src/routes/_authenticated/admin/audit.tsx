import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { AuditLog } from "@/components/admin/AuditLog";
import { PageHeader } from "@/components/admin/kit/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  component: Page,
});

function Page() {
  const { t } = useTranslation("admin");
  return (
    <section>
      <PageHeader title={t("audit.title")} description={t("audit.subtitle")} />
      <AuditLog />
    </section>
  );
}
