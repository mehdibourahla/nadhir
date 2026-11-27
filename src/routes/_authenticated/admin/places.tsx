import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/admin/kit/PageHeader";
import { OpenAreas } from "@/components/admin/OpenAreas";

export const Route = createFileRoute("/_authenticated/admin/places")({
  component: Page,
});

function Page() {
  const { t } = useTranslation("admin");
  return (
    <section>
      <PageHeader
        title={t("places.title")}
        description={t("places.subtitle")}
      />
      <OpenAreas />
    </section>
  );
}
