import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/private/privacy-consent")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const { appPreflight } = await import("@/lib/app-cors.server");
        return appPreflight(request, "GET, POST");
      },
      GET: async ({ request }) => {
        const { handlePrivacyConsentGet } =
          await import("@/lib/privacy-consent.server");
        const { withAppCors } = await import("@/lib/app-cors.server");
        return withAppCors(request, await handlePrivacyConsentGet(request));
      },
      POST: async ({ request }) => {
        const { handlePrivacyConsentPost } =
          await import("@/lib/privacy-consent.server");
        const { withAppCors } = await import("@/lib/app-cors.server");
        return withAppCors(request, await handlePrivacyConsentPost(request));
      },
      ANY: () =>
        new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: {
            Allow: "GET, POST, OPTIONS",
            "Content-Type": "application/json",
            "Cache-Control": "private, no-store",
          },
        }),
    },
  },
});
