import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { EnsemblePreview } from "@/components/admin/EnsemblePreview";
import { PageHeader } from "@/components/admin/kit/PageHeader";
import { PushDeviceTest } from "@/components/admin/PushDeviceTest";
import { SourceArchive } from "@/components/admin/SourceArchive";
import { TextRecovery } from "@/components/admin/TextRecovery";

export const Route = createFileRoute("/_authenticated/admin/tools")({
  component: ToolsPage,
});

function ToolsPage() {
  const { t } = useTranslation("admin");
  return (
    <section>
      <PageHeader
        title={t("tools.title")}
        description={t("tools.description")}
      />
      <TextRecovery />
      <SourceArchive />
      <PushDeviceTest />
      <EnsemblePreview />
    </section>
  );
}
