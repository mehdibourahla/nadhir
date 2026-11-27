import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/admin/kit/PageHeader";
import {
  Delivery,
  Gaps,
  Health,
  Incidents,
  Section,
} from "@/components/admin/SourceSections";
import { myRolesQuery } from "@/lib/reports";

export const Route = createFileRoute("/_authenticated/admin/sources")({
  component: SourcesPage,
});

function SourcesPage() {
  const { t } = useTranslation("admin");
  const roles = useQuery(myRolesQuery);
  const isAdmin = !roles.isError && (roles.data ?? []).includes("admin");
  return (
    <section>
      <PageHeader
        title={t("sources.title")}
        description={t("sources.subtitle")}
      />
      <Health isAdmin={isAdmin} />
      <Section
        title={t("sources.deliveryQueues")}
        help={t("sources.pauseHelp")}
      >
        <Delivery />
      </Section>
      <Section
        title={t("sources.operationalIncidents")}
        help={t("sources.incidentsHelp")}
      >
        <Incidents />
      </Section>
      <Section title={t("sources.gaps")}>
        <Gaps />
      </Section>
    </section>
  );
}
