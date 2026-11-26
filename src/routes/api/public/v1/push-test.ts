import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/push-test")({
  server: {
    handlers: {
      ANY: async () => {
        const { publicPushTestMethodNotAllowed } =
          await import("@/lib/push-test.server");
        return publicPushTestMethodNotAllowed();
      },
      OPTIONS: async () => {
        const { publicPushTestPreflight } =
          await import("@/lib/push-test.server");
        return publicPushTestPreflight();
      },
      POST: async ({ request }) => {
        const { handlePublicPushTest } = await import("@/lib/push-test.server");
        return handlePublicPushTest(request);
      },
    },
  },
});
