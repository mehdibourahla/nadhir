import type { ChatRequest } from "./codex.server";
import { LlmUnavailable } from "@/lib/text-sources/llm-unavailable";
import {
  completeWithFallbackProvider,
  defaultLlmCircuitBreaker,
  fallbackConfig,
  logFallbackUsed,
  validatePurposeRequest,
  type FallbackProviderConfig,
  type GatewayFailureKind,
  type GatewayProvenance,
  type LlmCircuitBreaker,
  type LlmProviderKind,
  resetLlmCircuitBreakers,
} from "./fallback.server";

export {
  fallbackConfig,
  resetLlmCircuitBreakers,
  type FallbackProviderConfig,
  type GatewayFailureKind,
  type GatewayProvenance,
  type LlmProviderKind,
};

// the gateway serves this model on the owner's ChatGPT plan; stored decisions name it
export const GATEWAY_MODEL = "gpt-6-luna";
const DEFAULT_TIMEOUT_MS = 50_000;
const UNREACHABLE_RETRY_S = 60;

export type GatewayPurpose =
  | "classify_report"
  | "extract_ita"
  | "extract_dgpc"
  | "dgpc_situation"
  | "civil_agent_step";

// the item waits for the plan or the gateway without spending a retry attempt
const PENDING = [
  "plan_paused",
  "rate_limited",
  "login_expired",
  "gateway_unset",
  "gateway_unreachable",
  "gateway_unauthorized",
  "fallback_unavailable",
] as const;
// the document's own retry path
const FAILED = ["upstream", "bad_request", "timeout", "malformed"] as const;

export type GatewayReason = (typeof PENDING)[number] | (typeof FAILED)[number];

export class GatewayPending extends LlmUnavailable {
  override name = "GatewayPending";
  readonly reason: GatewayReason;
  constructor(reason: GatewayReason, retryAfter: number | null) {
    super(`model gateway ${reason}`, retryAfter);
    this.reason = reason;
  }
}

export class GatewayFailed extends Error {
  override name = "GatewayFailed";
  readonly reason: GatewayReason;
  constructor(reason: GatewayReason) {
    super(`model gateway ${reason}`);
    this.reason = reason;
  }
}

export function gatewayReason(error: unknown): string {
  return error instanceof GatewayPending || error instanceof GatewayFailed
    ? error.reason
    : "invalid_output";
}

function failure(reason: string, retryAfter: number | null) {
  if ((PENDING as readonly string[]).includes(reason))
    return new GatewayPending(reason as GatewayReason, retryAfter);
  if ((FAILED as readonly string[]).includes(reason))
    return new GatewayFailed(reason as GatewayReason);
  return new GatewayPending("gateway_unreachable", UNREACHABLE_RETRY_S);
}

export type GatewayConfig = {
  url: string;
  clientId: string;
  clientSecret: string;
};

export function gatewayConfig(): GatewayConfig | null {
  const url = process.env["NADHIR_GATEWAY_URL"];
  const clientId = process.env["NADHIR_GATEWAY_ACCESS_CLIENT_ID"];
  const clientSecret = process.env["NADHIR_GATEWAY_ACCESS_CLIENT_SECRET"];
  return url && clientId && clientSecret
    ? { url: url.replace(/\/+$/, ""), clientId, clientSecret }
    : null;
}

export type CompleteWithGatewayOptions = {
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
  config?: GatewayConfig | null | undefined;
  fallback?: readonly FallbackProviderConfig[] | null | undefined;
  onProvenance?: ((provenance: GatewayProvenance) => void) | undefined;
  circuitBreaker?: LlmCircuitBreaker | null | undefined;
  now?: (() => number) | undefined;
};

export type GatewayCompletionResult = {
  text: string;
  provenance: GatewayProvenance;
};

type PrimaryFailure = {
  kind: GatewayFailureKind;
  retryAfter: number | null;
  error: GatewayPending | GatewayFailed;
};

function classifyPrimaryFailure(
  error: GatewayPending | GatewayFailed,
  status: number | null,
): PrimaryFailure {
  const retryAfter = error instanceof GatewayPending ? error.retryAfter : null;
  switch (error.reason) {
    case "gateway_unset":
      return { kind: "unset", retryAfter, error };
    case "plan_paused":
      return { kind: "paused", retryAfter, error };
    case "rate_limited":
      return { kind: "rate_limited", retryAfter, error };
    case "login_expired":
      return { kind: "login_expired", retryAfter, error };
    case "gateway_unauthorized":
      return { kind: "unauthorized", retryAfter, error };
    case "timeout":
      return { kind: "timeout", retryAfter, error };
    case "upstream":
      return { kind: "upstream_5xx", retryAfter, error };
    case "malformed":
      return { kind: "malformed", retryAfter, error };
    case "bad_request":
      return { kind: "bad_request", retryAfter, error };
    case "gateway_unreachable":
      if (status !== null && status >= 500 && status <= 599 && status !== 530) {
        return { kind: "upstream_5xx", retryAfter, error };
      }
      return { kind: "unreachable", retryAfter, error };
    default:
      return { kind: "unreachable", retryAfter, error };
  }
}

async function callPrimaryGateway(
  purpose: GatewayPurpose,
  request: ChatRequest,
  config: GatewayConfig,
  options: { timeoutMs?: number | undefined; signal?: AbortSignal | undefined },
): Promise<{ ok: true; text: string } | ({ ok: false } & PrimaryFailure)> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response | null = null;
  let thrown: unknown = null;
  try {
    res = await fetch(`${config.url}/v1/complete`, {
      method: "POST",
      redirect: "manual",
      signal: options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout,
      headers: {
        "cf-access-client-id": config.clientId,
        "cf-access-client-secret": config.clientSecret,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        purpose,
        request: {
          messages: request.messages,
          response_format: request.response_format,
        },
      }),
    });
  } catch (error) {
    thrown = error;
  }
  if (!res) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (timeout.aborted) {
      return {
        ok: false,
        ...classifyPrimaryFailure(new GatewayFailed("timeout"), null),
      };
    }
    // the fetch error is dropped on purpose: it can name the gateway host
    const err = failure(
      thrown instanceof TypeError ? "gateway_unreachable" : "timeout",
      UNREACHABLE_RETRY_S,
    );
    return { ok: false, ...classifyPrimaryFailure(err, null) };
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => {});
    return {
      ok: false,
      ...classifyPrimaryFailure(
        failure("gateway_unreachable", UNREACHABLE_RETRY_S),
        res.status,
      ),
    };
  }
  let body: { text?: unknown; reason?: unknown; retry_after?: unknown };
  try {
    body = await res.json();
  } catch {
    // an Access login page or a tunnel error page, never the gateway itself
    return {
      ok: false,
      ...classifyPrimaryFailure(
        failure("gateway_unreachable", UNREACHABLE_RETRY_S),
        res.status,
      ),
    };
  }
  if (res.status === 200) {
    if (typeof body.text !== "string") {
      return {
        ok: false,
        ...classifyPrimaryFailure(new GatewayFailed("malformed"), 200),
      };
    }
    return { ok: true, text: body.text };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      ...classifyPrimaryFailure(
        failure("gateway_unauthorized", null),
        res.status,
      ),
    };
  }
  const retryAfter =
    typeof body.retry_after === "number" ? body.retry_after : null;
  const err = failure(
    typeof body.reason === "string" ? body.reason : "",
    retryAfter,
  );
  return { ok: false, ...classifyPrimaryFailure(err, res.status) };
}

function smallestPositiveRetryAfter(
  current: number | null,
  candidate: number | null,
): number | null {
  if (candidate === null || candidate <= 0) return current;
  if (current === null) return candidate;
  return Math.min(current, candidate);
}

export async function completeWithGatewayResult(
  purpose: GatewayPurpose,
  request: ChatRequest,
  options: CompleteWithGatewayOptions = {},
): Promise<GatewayCompletionResult> {
  const config =
    options.config === undefined ? gatewayConfig() : options.config;
  const fallbacks =
    options.fallback === undefined
      ? fallbackConfig()
      : (options.fallback ?? []);

  // Legacy primary-only path when no fallback providers are configured:
  // preserves 100% existing behavior without consulting or tripping circuit breakers.
  if (fallbacks.length === 0) {
    if (!config) throw new GatewayPending("gateway_unset", null);
    const primary = await callPrimaryGateway(purpose, request, config, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    if (!primary.ok) throw primary.error;
    const provenance: GatewayProvenance = {
      provider: "gateway",
      providerId: "home-gateway",
      model: GATEWAY_MODEL,
      fallbackUsed: false,
      primaryErrorKind: null,
      attempts: 1,
      purpose,
    };
    options.onProvenance?.(provenance);
    return { text: primary.text, provenance };
  }

  if (options.signal?.aborted) throw options.signal.reason;
  if (!validatePurposeRequest(purpose, request)) {
    throw new GatewayFailed("bad_request");
  }

  const breaker =
    options.circuitBreaker === undefined
      ? defaultLlmCircuitBreaker
      : options.circuitBreaker;
  const nowFn = options.now ?? Date.now;

  let attempts = 0;
  let primaryErrorKind: GatewayFailureKind;
  let minRetryAfter: number | null = null;
  let allMalformed = false;

  if (!config) {
    primaryErrorKind = "unset";
  } else {
    const primaryCircuit = breaker
      ? breaker.isOpen("primary", nowFn())
      : { open: false, retryAfter: null };
    if (primaryCircuit.open) {
      primaryErrorKind = "circuit_open";
      minRetryAfter = smallestPositiveRetryAfter(
        minRetryAfter,
        primaryCircuit.retryAfter,
      );
    } else {
      attempts += 1;
      const primary = await callPrimaryGateway(purpose, request, config, {
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      if (primary.ok) {
        breaker?.recordSuccess("primary");
        const provenance: GatewayProvenance = {
          provider: "gateway",
          providerId: "home-gateway",
          model: GATEWAY_MODEL,
          fallbackUsed: false,
          primaryErrorKind: null,
          attempts,
          purpose,
        };
        options.onProvenance?.(provenance);
        return { text: primary.text, provenance };
      }
      if (options.signal?.aborted) throw options.signal.reason;
      if (primary.kind === "bad_request") {
        throw new GatewayFailed("bad_request");
      }
      primaryErrorKind = primary.kind;
      allMalformed = primary.kind === "malformed";
      minRetryAfter = smallestPositiveRetryAfter(
        minRetryAfter,
        primary.retryAfter,
      );
      breaker?.recordFailure(
        "primary",
        primary.kind,
        primary.retryAfter,
        nowFn(),
      );
    }
  }

  for (const provider of fallbacks) {
    if (options.signal?.aborted) throw options.signal.reason;
    const circuitKey = `fallback:${provider.id}`;
    const fbCircuit = breaker
      ? breaker.isOpen(circuitKey, nowFn())
      : { open: false, retryAfter: null };
    if (fbCircuit.open) {
      allMalformed = false;
      minRetryAfter = smallestPositiveRetryAfter(
        minRetryAfter,
        fbCircuit.retryAfter,
      );
      continue;
    }

    attempts += 1;
    const outcome = await completeWithFallbackProvider(
      purpose,
      request,
      provider,
      {
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      },
    );
    if (outcome.ok) {
      breaker?.recordSuccess(circuitKey);
      const provenance: GatewayProvenance = {
        provider: provider.provider,
        providerId: provider.id,
        model: provider.model,
        fallbackUsed: true,
        primaryErrorKind,
        attempts,
        purpose,
      };
      logFallbackUsed(provenance);
      options.onProvenance?.(provenance);
      return { text: outcome.text, provenance };
    }

    if (options.signal?.aborted) throw options.signal.reason;
    if (outcome.kind !== "malformed") {
      allMalformed = false;
    }
    minRetryAfter = smallestPositiveRetryAfter(
      minRetryAfter,
      outcome.retryAfter,
    );
    breaker?.recordFailure(
      circuitKey,
      outcome.kind,
      outcome.retryAfter,
      nowFn(),
    );
  }

  if (allMalformed) {
    throw new GatewayFailed("malformed");
  }
  throw new GatewayPending(
    "fallback_unavailable",
    minRetryAfter ?? UNREACHABLE_RETRY_S,
  );
}

export async function completeWithGateway(
  purpose: GatewayPurpose,
  request: ChatRequest,
  options: CompleteWithGatewayOptions = {},
): Promise<string> {
  const result = await completeWithGatewayResult(purpose, request, options);
  return result.text;
}
