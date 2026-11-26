import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/private/privacy-export")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const { appPreflight } = await import("@/lib/app-cors.server");
        return appPreflight(request, "GET");
      },
      GET: async ({ request }) => {
        const { handlePrivacyExport } =
          await import("@/lib/privacy-consent.server");
        const { withAppCors } = await import("@/lib/app-cors.server");
        return withAppCors(request, await handlePrivacyExport(request));
      },
      ANY: () =>
        new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: {
            Allow: "GET, OPTIONS",
            "Content-Type": "application/json",
            "Cache-Control": "private, no-store",
          },
        }),
    },
  },
});
