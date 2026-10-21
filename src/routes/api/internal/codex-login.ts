import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import type { CodexLoginRpc } from "@/lib/llm/codex-login.server";

const WEEK_SECONDS = 7 * 24 * 3600;
const seconds = z.number().int().min(0).max(WEEK_SECONDS).nullable();

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("lease") }),
  z.object({
    action: z.literal("report"),
    token: z.string().min(1),
    outcome: z.discriminatedUnion("ok", [
      z.object({
        ok: z.literal(true),
        usage: z.object({
          primaryUsed: z.number().nullable(),
          primaryResetAfter: seconds,
          secondaryUsed: z.number().nullable(),
          secondaryResetAfter: seconds,
        }),
      }),
      z.object({
        ok: z.literal(false),
        reason: z.string().min(1).max(100),
        status: z.number().int().nullable(),
        retryAfter: seconds,
      }),
    ]),
  }),
]);

type CodexLoginRouteDependencies = {
  authenticate: typeof authenticateCronRequest;
  login: () => Promise<CodexLoginRpc | null>;
};

const codexLoginRouteDependencies: CodexLoginRouteDependencies = {
  authenticate: authenticateCronRequest,
  login: async () => {
    const namespace = (await import("cloudflare:workers")).env[
      "CODEX_LOGIN"
    ] as
      | { idFromName(name: string): unknown; get(id: unknown): CodexLoginRpc }
      | undefined;
    return namespace ? namespace.get(namespace.idFromName("codex")) : null;
  },
};

export async function handleCodexLoginRequest(
  request: Request,
  dependencies: CodexLoginRouteDependencies = codexLoginRouteDependencies,
): Promise<Response> {
  const unauthorized = await dependencies.authenticate(request);
  if (unauthorized) return unauthorized;

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json({ error: "Invalid request" }, { status: 400 });
  const login = await dependencies.login();
  if (!login)
    return Response.json({ error: "Codex login not bound" }, { status: 503 });

  try {
    if (body.data.action === "report")
      return Response.json(
        await login.report(body.data.token, body.data.outcome),
      );
    const lease = await login.lease();
    return Response.json(
      lease.status === "ready"
        ? {
            status: "ready",
            access_token: lease.token,
            account_id: lease.account,
          }
        : lease,
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "codex login request failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ error: "Codex login failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/internal/codex-login")({
  server: {
    handlers: {
      ANY: async () => {
        const { postOnlyMethodNotAllowed } =
          await import("@/lib/post-only.server");
        return postOnlyMethodNotAllowed();
      },
      POST: ({ request }) => handleCodexLoginRequest(request),
    },
  },
});
