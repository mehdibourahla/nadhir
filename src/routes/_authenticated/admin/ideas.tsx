import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { IdeaQueue } from "@/components/admin/IdeaQueue";
import { PageHeader } from "@/components/admin/kit/PageHeader";
import type { Locale } from "@/i18n";

export const Route = createFileRoute("/_authenticated/admin/ideas")({
  component: IdeasPage,
});

function IdeasPage() {
  const { t, i18n } = useTranslation("admin");
  return (
    <section>
      <PageHeader
        title={t("ideasPage.title")}
        description={t("ideasPage.description")}
      />
      <IdeaQueue locale={i18n.language as Locale} />
    </section>
  );
}
