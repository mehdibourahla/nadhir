import type { ChatRequest } from "./codex.server";
import { LlmUnavailable } from "@/lib/text-sources/llm-unavailable";

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

export async function completeWithGateway(
  purpose: GatewayPurpose,
  request: ChatRequest,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal | undefined;
    config?: GatewayConfig | null;
  } = {},
): Promise<string> {
  const config =
    options.config === undefined ? gatewayConfig() : options.config;
  if (!config) throw new GatewayPending("gateway_unset", null);
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
    if (timeout.aborted) throw new GatewayFailed("timeout");
    // the fetch error is dropped on purpose: it can name the gateway host
    throw failure(
      thrown instanceof TypeError ? "gateway_unreachable" : "timeout",
      UNREACHABLE_RETRY_S,
    );
  }
  let body: { text?: unknown; reason?: unknown; retry_after?: unknown };
  try {
    body = await res.json();
  } catch {
    // an Access login page or a tunnel error page, never the gateway itself
    throw failure("gateway_unreachable", UNREACHABLE_RETRY_S);
  }
  if (res.status === 200) {
    if (typeof body.text !== "string") throw new GatewayFailed("malformed");
    return body.text;
  }
  if (res.status === 401) throw failure("gateway_unauthorized", null);
  const retryAfter =
    typeof body.retry_after === "number" ? body.retry_after : null;
  throw failure(typeof body.reason === "string" ? body.reason : "", retryAfter);
}
