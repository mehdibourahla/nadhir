import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/admin/kit/PageHeader";
import { TranslationQueue } from "@/components/admin/TranslationQueue";

export const Route = createFileRoute("/_authenticated/admin/translations")({
  component: TranslationsPage,
});

function TranslationsPage() {
  const { t } = useTranslation("admin");
  return (
    <section>
      <PageHeader
        title={t("translationsPage.title")}
        description={t("translationsPage.description")}
      />
      <TranslationQueue />
    </section>
  );
}
