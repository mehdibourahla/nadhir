import { createFileRoute, notFound } from "@tanstack/react-router";

import { FireDetailPage } from "@/components/fire/FireDetailPage";
import { pageMeta } from "@/lib/page-meta";
import { clusterDetailQuery } from "@/lib/nadhir";

export const Route = createFileRoute("/fire/$id")({
  head: ({ params }) => ({
    meta: pageMeta("fire.metaTitle", "fire.metaDescription", {
      id: params.id,
    }),
  }),
  loader: async ({ context, params }) => {
    const detail = await context.queryClient.ensureQueryData(
      clusterDetailQuery(params.id),
    );
    if (!detail) throw notFound();
    return detail;
  },
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <FireDetailPage shortId={id} />;
}
