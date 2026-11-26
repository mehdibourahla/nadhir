import { createFileRoute } from "@tanstack/react-router";

// POST rather than GET so the reviewer key stays out of URLs and access logs.
export const Route = createFileRoute("/api/public/contribute/my-translations")({
  server: {
    handlers: {
      ANY: async () => {
        const { postOnlyMethodNotAllowed } =
          await import("@/lib/post-only.server");
        return postOnlyMethodNotAllowed();
      },
      POST: async ({ request }) => {
        const { handleContributeMyTranslations } =
          await import("@/lib/contribute-routes.server");
        return handleContributeMyTranslations(request);
      },
    },
  },
});
