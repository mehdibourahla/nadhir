import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/admin/kit/PageHeader";
import { OfficialIncidents } from "@/components/admin/OfficialIncidents";

export const Route = createFileRoute("/_authenticated/admin/incidents")({
  component: Page,
});

function Page() {
  const { t } = useTranslation("admin");
  return (
    <section>
      <PageHeader
        title={t("incidents.title")}
        description={t("incidents.subtitle")}
      />
      <OfficialIncidents />
    </section>
  );
}
