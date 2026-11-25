import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/private/push-test")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const { appPreflight } = await import("@/lib/app-cors.server");
        return appPreflight(request, "POST");
      },
      POST: async ({ request }) => {
        const { handlePushTest } = await import("@/lib/push-test.server");
        const { withAppCors } = await import("@/lib/app-cors.server");
        return withAppCors(request, await handlePushTest(request));
      },
      ANY: () =>
        new Response(JSON.stringify({ error: "method not allowed" }), {
          status: 405,
          headers: {
            Allow: "POST, OPTIONS",
            "Content-Type": "application/json",
            "Cache-Control": "private, no-store",
          },
        }),
    },
  },
});
