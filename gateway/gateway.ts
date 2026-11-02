import {
  CodexUnavailable,
  completeWithCodex,
  type ChatRequest,
  type CodexEffort,
  type CodexUsage,
} from "../src/lib/llm/codex.server";
import type {
  CodexLoginRpc,
  CodexOutcome,
} from "../src/lib/llm/codex-login.server";
import {
  isPurpose,
  MAX_BODY_BYTES,
  POLICIES,
  TokenBucket,
  parseRequest,
  type Purpose,
} from "./policy";
import type { LoginStatus } from "./token-file";

export type Reason =
  "plan_paused" | "rate_limited" | "login_expired" | "upstream" | "bad_request";

const STATUS: Record<Reason, number> = {
  plan_paused: 429,
  rate_limited: 429,
  login_expired: 503,
  upstream: 502,
  bad_request: 400,
};

const DEFAULT_PAUSE_S = 60;
const USAGE_PAUSE_S = 300;

// lease failures that only a new device login can cure
const LOGIN_REASONS = [
  "login_missing",
  "login_seed_invalid",
  "login_account_missing",
  "refresh_http_400",
  "refresh_http_401",
  "refresh_http_403",
];

export type GatewayDeps = {
  model: string;
  login: CodexLoginRpc;
  authorized: (headers: Headers) => Promise<boolean>;
  status: () => Promise<LoginStatus>;
  complete?: typeof completeWithCodex;
  now?: () => number;
  log?: (fields: Record<string, unknown>) => void;
};

type Window = { used: number; until: number };

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

export function createGateway(deps: GatewayDeps) {
  const now = deps.now ?? Date.now;
  const complete = deps.complete ?? completeWithCodex;
  const log =
    deps.log ??
    ((fields: Record<string, unknown>) => console.log(JSON.stringify(fields)));
  const buckets = new Map<Purpose, TokenBucket>();
  let usage: Window[] = [];
  let pausedUntil = 0;
  let loginFailure: { reason: string; until: number } | null = null;

  function fail(
    purpose: string | null,
    reason: Reason,
    detail: string,
    retryAfter: number | null = null,
  ) {
    log({
      message: "gateway refused",
      purpose,
      reason,
      detail,
      retry_after_s: retryAfter,
    });
    return json(
      retryAfter === null ? { reason } : { reason, retry_after: retryAfter },
      STATUS[reason],
      retryAfter === null ? {} : { "retry-after": String(retryAfter) },
    );
  }

  function remember(observed: CodexUsage) {
    const at = now();
    const windows: [number | null, number | null][] = [
      [observed.primaryUsed, observed.primaryResetAfter],
      [observed.secondaryUsed, observed.secondaryResetAfter],
    ];
    usage = windows.flatMap(([used, reset]) =>
      used === null
        ? []
        : [{ used, until: at + (reset ?? USAGE_PAUSE_S) * 1000 }],
    );
  }

  function overCeiling(ceiling: number): number | null {
    const at = now();
    const over = usage.filter((w) => w.until > at && w.used >= ceiling);
    return over.length
      ? Math.ceil((Math.max(...over.map((w) => w.until)) - at) / 1000)
      : null;
  }

  async function report(token: string, outcome: CodexOutcome) {
    try {
      const { pausedSeconds } = await deps.login.report(token, outcome);
      if (pausedSeconds !== null)
        pausedUntil = Math.max(pausedUntil, now() + pausedSeconds * 1000);
    } catch {
      log({ message: "login report failed" });
    }
  }

  async function completion(request: Request): Promise<Response> {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_BODY_BYTES)
      return fail(null, "bad_request", "body_too_large");
    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return fail(null, "bad_request", "body_unreadable");
    }
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES)
      return fail(null, "bad_request", "body_too_large");
    let body: { purpose?: unknown; request?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(null, "bad_request", "body_not_json");
    }
    if (!isPurpose(body?.purpose))
      return fail(null, "bad_request", "purpose_unknown");
    const purpose = body.purpose;
    const policy = POLICIES[purpose];
    if (Buffer.byteLength(raw) > policy.maxBodyBytes)
      return fail(purpose, "bad_request", "body_too_large");
    const chat: ChatRequest | null = parseRequest(body.request, policy);
    if (!chat) return fail(purpose, "bad_request", "request_invalid");

    const ceilingWait = overCeiling(policy.ceiling);
    if (ceilingWait !== null)
      return fail(purpose, "plan_paused", "usage_ceiling", ceilingWait);
    let bucket = buckets.get(purpose);
    if (!bucket) {
      bucket = new TokenBucket(policy.bucket, now());
      buckets.set(purpose, bucket);
    }
    const wait = bucket.take(now());
    if (wait) return fail(purpose, "rate_limited", "bucket_empty", wait);

    const lease = await deps.login.lease().catch(() => null);
    if (!lease) return fail(purpose, "upstream", "login_store");
    if (lease.status === "paused") {
      const left = Math.max(1, Math.ceil((pausedUntil - now()) / 1000));
      if (loginFailure && loginFailure.until > now())
        return fail(purpose, "login_expired", loginFailure.reason, left);
      return fail(
        purpose,
        "plan_paused",
        "paused",
        pausedUntil > now() ? left : DEFAULT_PAUSE_S,
      );
    }
    if (lease.status === "unavailable") {
      pausedUntil = Math.max(pausedUntil, now() + lease.pausedSeconds * 1000);
      const login = LOGIN_REASONS.includes(lease.reason);
      if (login)
        loginFailure = {
          reason: lease.reason,
          until: now() + lease.pausedSeconds * 1000,
        };
      return fail(
        purpose,
        login ? "login_expired" : "upstream",
        lease.reason,
        lease.pausedSeconds,
      );
    }
    loginFailure = null;

    const started = now();
    let text: string;
    try {
      const reply = await complete(deps.model, chat, lease, {
        effort: policy.effort as CodexEffort,
        signal: request.signal,
      });
      text = reply.text;
      remember(reply.usage);
      await report(lease.token, { ok: true, usage: reply.usage });
    } catch (error) {
      if (!(error instanceof CodexUnavailable)) {
        log({ message: "gateway error", purpose, reason: "upstream" });
        return fail(purpose, "upstream", "unexpected");
      }
      await report(lease.token, {
        ok: false,
        reason: error.reason,
        status: error.status,
        retryAfter: error.retryAfter,
      });
      if (error.reason === "http_429")
        return fail(
          purpose,
          "plan_paused",
          error.reason,
          error.retryAfter ?? DEFAULT_PAUSE_S,
        );
      return fail(purpose, "upstream", error.reason);
    }
    log({
      message: "gateway completed",
      purpose,
      ms: now() - started,
      primary_used: usage[0]?.used ?? null,
    });
    return json({ text });
  }

  async function health(): Promise<Response> {
    const state = await deps.status();
    const at = now();
    const until = Math.max(state.pausedUntil ?? 0, pausedUntil);
    return json({
      ok: state.login === "present" || state.login === "stale",
      login: loginFailure && loginFailure.until > at ? "expired" : state.login,
      paused_until: until > at ? new Date(until).toISOString() : null,
      usage: usage
        .filter((w) => w.until > at)
        .map((w) => ({
          used: w.used,
          resets_at: new Date(w.until).toISOString(),
        })),
    });
  }

  return async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!(await deps.authorized(request.headers)))
      return json({ reason: "unauthorized" }, 401);
    if (pathname === "/v1/complete" && request.method === "POST")
      return completion(request);
    if (pathname === "/health" && request.method === "GET") return health();
    return json({ reason: "not_found" }, 404);
  };
}
