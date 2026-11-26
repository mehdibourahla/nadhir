import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/push-receipt")({
  server: {
    handlers: {
      ANY: () =>
        new Response(JSON.stringify({ error: "method not allowed" }), {
          status: 405,
          headers: {
            Allow: "POST, OPTIONS",
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        }),
      OPTIONS: async ({ request }) => {
        const { appPreflight } = await import("@/lib/app-cors.server");
        return appPreflight(request, "POST");
      },
      POST: async ({ request }) => {
        const { recordPushReceipt } = await import("@/lib/push-receipt.server");
        const { readJsonBody } = await import("@/lib/request-body.server");
        const { withAppCors } = await import("@/lib/app-cors.server");
        const headers = { "Cache-Control": "no-store" };
        const read = await readJsonBody(request, 1024);
        if ("error" in read) {
          return withAppCors(
            request,
            new Response(null, { status: read.status, headers }),
          );
        }
        const outcome = await recordPushReceipt(read.body);
        return withAppCors(
          request,
          new Response(null, {
            status:
              outcome === "recorded" ? 204 : outcome === "forged" ? 403 : 400,
            headers,
          }),
        );
      },
    },
  },
});
