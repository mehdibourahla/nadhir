import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PeopleDirectory } from "@/components/admin/PeopleDirectory";
import { PageHeader } from "@/components/admin/kit/PageHeader";
import { myRolesQuery } from "@/lib/reports";

export const Route = createFileRoute("/_authenticated/admin/people")({
  component: Page,
});

function Page() {
  const { t } = useTranslation("admin");
  const roles = useQuery(myRolesQuery);
  return (
    <section>
      <PageHeader
        title={t("people.title")}
        description={t("people.subtitle")}
      />
      {roles.isPending ? null : (roles.data ?? []).includes("admin") ? (
        <PeopleDirectory />
      ) : (
        <p className="text-sm text-muted-foreground">{t("people.noAccess")}</p>
      )}
    </section>
  );
}
