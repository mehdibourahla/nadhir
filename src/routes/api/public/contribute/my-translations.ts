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
        const [{ readMySuggestions }, { readJsonBody }] = await Promise.all([
          import("@/lib/translate.server"),
          import("@/lib/request-body.server"),
        ]);
        const read = await readJsonBody(request, 16_384);
        if ("error" in read) {
          return Response.json({ rows: [] }, { status: read.status });
        }
        const body = read.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return Response.json({ rows: [] }, { status: 400 });
        }
        const input = body as Record<string, unknown>;
        const rows = await readMySuggestions(
          String(input["locale"] ?? ""),
          String(input["reviewerKey"] ?? ""),
        );
        return Response.json(
          { rows },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
