import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { ItaFeed } from "@/components/admin/ita/ItaFeed";
import { ItaPublications } from "@/components/admin/ita/ItaPublications";
import { ItaQueue } from "@/components/admin/ita/ItaQueue";
import { PageHeader } from "@/components/admin/kit/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { attentionQuery, attentionTotal } from "@/lib/admin-attention";

export const Route = createFileRoute("/_authenticated/admin/ita")({
  component: ItaPage,
});

function ItaPage() {
  const { t } = useTranslation("admin");
  const attention = useQuery(attentionQuery);
  const waiting = attentionTotal(attention.data, ["ita_review", "ita_failed"]);
  return (
    <section>
      <PageHeader title={t("ita.title")} description={t("ita.description")} />
      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">
            {t("ita.tabs.queue")}
            {waiting > 0 ? (
              <span className="ms-1.5 rounded-full bg-foreground/10 px-1.5 text-xs tabular-nums">
                {waiting}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="publications">
            {t("ita.tabs.publications")}
          </TabsTrigger>
          <TabsTrigger value="feed">{t("ita.tabs.feed")}</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-4">
          <ItaQueue />
        </TabsContent>
        <TabsContent value="publications" className="mt-4">
          <ItaPublications />
        </TabsContent>
        <TabsContent value="feed" className="mt-4">
          <ItaFeed />
        </TabsContent>
      </Tabs>
    </section>
  );
}
