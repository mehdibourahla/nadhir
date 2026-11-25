import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/contribute/vote")({
  server: {
    handlers: {
      ANY: async () => {
        const { postOnlyMethodNotAllowed } =
          await import("@/lib/post-only.server");
        return postOnlyMethodNotAllowed();
      },
      POST: async ({ request }) => {
        const { handleContributeVote } =
          await import("@/lib/contribute-routes.server");
        return handleContributeVote(request);
      },
    },
  },
});
