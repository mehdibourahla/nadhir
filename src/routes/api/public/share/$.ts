import { createFileRoute } from "@tanstack/react-router";

async function serveUniversalShare(request: Request): Promise<Response> {
  const [
    { extractRawPathname, parseUniversalSharePath },
    { handleUniversalShareRequest },
  ] = await Promise.all([
    import("@/lib/share-card"),
    import("@/lib/share-render.server"),
  ]);

  const url = new URL(request.url);
  const rawPathname = extractRawPathname(request.url);
  const parsed = parseUniversalSharePath(rawPathname, url.searchParams);
  if (!parsed.ok) {
    return new Response(parsed.error, {
      status: parsed.status,
      headers: {
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      },
    });
  }

  return handleUniversalShareRequest(request, parsed.target);
}

export const Route = createFileRoute("/api/public/share/$")({
  server: {
    handlers: {
      ANY: async () => {
        const { methodNotAllowed } = await import("@/lib/public-api.server");
        return methodNotAllowed();
      },
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/public-api.server");
        return preflight();
      },
      HEAD: async ({ request }) => serveUniversalShare(request),
      GET: async ({ request }) => serveUniversalShare(request),
    },
  },
});
