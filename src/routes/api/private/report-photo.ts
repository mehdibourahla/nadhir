import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/private/report-photo")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const { appPreflight } = await import("@/lib/app-cors.server");
        return appPreflight(request, "POST");
      },
      POST: async ({ request }) => {
        const { handleReportPhotoUpload } =
          await import("@/lib/report-photo.server");
        const { withAppCors } = await import("@/lib/app-cors.server");
        return withAppCors(request, await handleReportPhotoUpload(request));
      },
      ANY: () =>
        new Response(JSON.stringify({ error: "method_not_allowed" }), {
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
