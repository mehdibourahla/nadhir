import {
  CodexUnavailable,
  completeWithCodex,
  pauseFor,
  transient,
  usagePause,
  type ChatRequest,
} from "./codex.server";
import type { Lease } from "./codex-login.server";

export type CodexLoginRpc = {
  lease(): Promise<Lease>;
  pause(seconds: number): Promise<void>;
  expire(token: string): Promise<void>;
};

type Namespace = {
  idFromName(name: string): unknown;
  get(id: unknown): CodexLoginRpc;
};

async function workersLogin(): Promise<CodexLoginRpc | null> {
  const namespace = (await import("cloudflare:workers")).env["CODEX_LOGIN"] as
    Namespace | undefined;
  return namespace ? namespace.get(namespace.idFromName("codex")) : null;
}

function log(level: "warn" | "error", fields: Record<string, unknown>) {
  console[level](JSON.stringify(fields));
}

export function subscriptionTransport(deps: {
  model: () => string | undefined;
  login: () => Promise<CodexLoginRpc | null>;
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
    signal?: AbortSignal,
  ): Promise<string> {
    const model = deps.model();
    if (!model) return openRouter(request);
    let login: CodexLoginRpc | null;
    let lease: Lease;
    try {
      login = await deps.login();
      if (!login) {
        unavailable(purpose, "binding_missing", false, null);
        return openRouter(request);
      }
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
    try {
      const reply = await completeWithCodex(model, request, lease, signal);
      const { usage } = reply;
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
      const ceiling = usagePause(usage);
      if (ceiling !== null) {
        log("warn", {
          message: "codex subscription paused",
          reason: "usage_ceiling",
          primary_used: usage.primaryUsed,
          secondary_used: usage.secondaryUsed,
          paused_s: ceiling,
        });
        await login.pause(ceiling).catch(recordFailed);
      }
      return reply.text;
    } catch (error) {
      if (!(error instanceof CodexUnavailable)) throw error;
      const seconds = pauseFor(error);
      unavailable(purpose, error.reason, error.sent, seconds);
      if (error.status === 401)
        await login.expire(lease.token).catch(recordFailed);
      await login.pause(seconds).catch(recordFailed);
      return openRouter(request);
    }
  };
}

function recordFailed(error: unknown) {
  log("error", {
    message: "codex login state not recorded",
    error: error instanceof Error ? error.message : String(error),
  });
}

export const subscriptionFirst = subscriptionTransport({
  model: () => process.env["CODEX_MODEL"] || undefined,
  login: workersLogin,
});
