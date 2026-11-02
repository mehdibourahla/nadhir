import { z } from "zod/v4";

import type { CodexLoginRpc, CodexOutcome, Lease } from "./codex-login.server";

// Unused since every model call goes through the home gateway (gateway.server.ts).
// Kept with the CodexLogin Durable Object and /api/internal/codex-login, which
// scripts/codex-egress-check.ts still uses; all of it goes in one later removal PR.

const LeaseReply = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    access_token: z.string().min(1),
    account_id: z.string().min(1),
  }),
  z.object({ status: z.literal("paused") }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string(),
    pausedSeconds: z.number(),
  }),
]);

const ReportReply = z.object({ pausedSeconds: z.number().nullable() });

export function routeLogin(appUrl: string, secret: string): CodexLoginRpc {
  const call = async (body: unknown): Promise<unknown> => {
    const res = await fetch(`${appUrl}/api/internal/codex-login`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`codex login route HTTP ${res.status}`);
    return res.json();
  };
  return {
    async lease(): Promise<Lease> {
      const reply = LeaseReply.parse(await call({ action: "lease" }));
      return reply.status === "ready"
        ? {
            status: "ready",
            token: reply.access_token,
            account: reply.account_id,
          }
        : reply;
    },
    async report(token: string, outcome: CodexOutcome) {
      return ReportReply.parse(
        await call({ action: "report", token, outcome }),
      );
    },
  };
}
