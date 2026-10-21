import { z } from "zod/v4";

import {
  CodexUnavailable,
  completeWithCodex,
  transient,
  type ChatRequest,
  type CodexEffort,
} from "./codex.server";
import type { CodexLoginRpc, CodexOutcome, Lease } from "./codex-login.server";

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

function log(level: "warn" | "error", fields: Record<string, unknown>) {
  console[level](JSON.stringify(fields));
}

function recordFailed(error: unknown) {
  log("error", {
    message: "codex login route failed",
    error: error instanceof Error ? error.message : String(error),
  });
}

export function subscriptionTransport(deps: {
  model: () => string | undefined;
  login: () => CodexLoginRpc | null;
}) {
  let usageWarned = false;

  function unavailable(
    purpose: string,
    reason: string,
    sent: boolean,
    pausedSeconds: number | null,
  ) {
    log(transient(reason) ? "warn" : "error", {
      message: "codex subscription unavailable",
      purpose,
      reason,
      sent,
      paused_s: pausedSeconds,
      fallback: "openrouter",
    });
  }

  return async function subscriptionFirst<R extends ChatRequest>(
    purpose: string,
    request: R,
    openRouter: (request: R) => Promise<string>,
    options: { effort: CodexEffort; signal?: AbortSignal | undefined },
  ): Promise<string> {
    const model = deps.model();
    if (!model) return openRouter(request);
    const login = deps.login();
    if (!login) {
      unavailable(purpose, "login_route_unset", false, null);
      return openRouter(request);
    }
    let lease: Lease;
    try {
      lease = await login.lease();
    } catch (error) {
      unavailable(purpose, "unreachable", false, null);
      recordFailed(error);
      return openRouter(request);
    }
    if (lease.status === "paused") return openRouter(request);
    if (lease.status === "unavailable") {
      unavailable(purpose, lease.reason, false, lease.pausedSeconds);
      return openRouter(request);
    }

    let text: string | null = null;
    let outcome: CodexOutcome;
    let sent = true;
    try {
      const reply = await completeWithCodex(model, request, lease, options);
      text = reply.text;
      outcome = { ok: true, usage: reply.usage };
    } catch (error) {
      if (!(error instanceof CodexUnavailable)) throw error;
      sent = error.sent;
      outcome = {
        ok: false,
        reason: error.reason,
        status: error.status,
        retryAfter: error.retryAfter,
      };
    }
    const { pausedSeconds } = await login
      .report(lease.token, outcome)
      .catch((error: unknown) => {
        recordFailed(error);
        return { pausedSeconds: null };
      });

    if (!outcome.ok) {
      unavailable(purpose, outcome.reason, sent, pausedSeconds);
      return openRouter(request);
    }
    const { usage } = outcome;
    if (
      usage.primaryUsed === null &&
      usage.secondaryUsed === null &&
      !usageWarned
    ) {
      usageWarned = true;
      log("warn", {
        message: "codex usage unknown",
        detail: "no usage headers, the 80% ceiling cannot apply",
      });
    }
    if (pausedSeconds !== null)
      log("warn", {
        message: "codex subscription paused",
        reason: "usage_ceiling",
        primary_used: usage.primaryUsed,
        secondary_used: usage.secondaryUsed,
        paused_s: pausedSeconds,
      });
    return text!;
  };
}

// Workers share the code but never the plan: chatgpt.com's edge refuses Workers egress
export const subscriptionFirst = subscriptionTransport({
  model: () =>
    process.env["GITHUB_ACTIONS"] === "true"
      ? process.env["CODEX_MODEL"] || undefined
      : undefined,
  login: () => {
    const url = process.env["NADHIR_APP_URL"];
    const secret = process.env["NADHIR_CRON_SECRET"];
    return url && secret ? routeLogin(url, secret) : null;
  },
});
