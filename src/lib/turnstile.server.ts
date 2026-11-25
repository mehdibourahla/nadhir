export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const MAX_TOKEN_LENGTH = 2048;
const DEFAULT_TIMEOUT_MS = 5_000;

export type TurnstileFailureReason =
  | "not_configured"
  | "missing_token"
  | "invalid_token_format"
  | "invalid_verify_url"
  | "invalid_token"
  | "action_mismatch"
  | "hostname_mismatch"
  | "timeout"
  | "upstream_error";

export type TurnstileVerifyResult =
  | {
      ok: true;
      skipped?: true;
      action?: string;
      hostname?: string;
      challengeTs?: string;
    }
  | {
      ok: false;
      status: 400 | 403 | 503;
      reason: TurnstileFailureReason;
      errorCodes?: string[];
    };

export interface TurnstileVerifyInput {
  token: string | null | undefined;
  remoteIp?: string | null | undefined;
  expectedAction?: string | undefined;
  expectedHostname?: string | string[] | undefined;
  secretKey?: string | null | undefined;
  required?: boolean | undefined;
  verifyUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

type EnvRecord = Record<string, string | undefined>;

function readProcessEnv(): EnvRecord {
  if (typeof process === "undefined" || !process.env) return {};
  return process.env as EnvRecord;
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function isTurnstileConfigured(env?: EnvRecord): boolean {
  const source = env ?? readProcessEnv();
  return Boolean(source["TURNSTILE_SECRET_KEY"]?.trim());
}

export function extractTurnstileToken(
  body: unknown,
  request?: Request,
): string | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    for (const key of [
      "turnstileToken",
      "turnstile_token",
      "cf-turnstile-response",
      "captchaToken",
    ]) {
      const value = record[key];
      if (typeof value === "string") return value;
    }
  }
  if (request) {
    const fromHeader =
      request.headers.get("cf-turnstile-response") ??
      request.headers.get("x-turnstile-token");
    if (fromHeader !== null) return fromHeader;
  }
  return null;
}

export function resolveExpectedTurnstileHostnames(
  request: Request,
  env?: EnvRecord,
): string[] | undefined {
  const source = env ?? readProcessEnv();
  const configured = source["TURNSTILE_ALLOWED_HOSTNAMES"]?.trim();
  if (configured) {
    const list = configured
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") {
      return undefined;
    }
    return [hostname];
  } catch {
    return undefined;
  }
}

function resolveSiteverifyUrl(verifyUrl: string | undefined): string | null {
  if (verifyUrl === undefined) return TURNSTILE_SITEVERIFY_URL;
  const trimmed = verifyUrl.trim();
  if (!trimmed) return null;
  if (trimmed === TURNSTILE_SITEVERIFY_URL) return TURNSTILE_SITEVERIFY_URL;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname !== "127.0.0.1" &&
    hostname !== "localhost" &&
    hostname !== "::1" &&
    hostname !== "[::1]"
  ) {
    return null;
  }

  return parsed.toString();
}

export async function verifyTurnstileToken(
  input: TurnstileVerifyInput,
): Promise<TurnstileVerifyResult> {
  const secret = (
    input.secretKey ?? readProcessEnv()["TURNSTILE_SECRET_KEY"]
  )?.trim();

  if (!secret) {
    if (input.required) {
      return { ok: false, status: 503, reason: "not_configured" };
    }
    return { ok: true, skipped: true };
  }

  const siteverifyUrl = resolveSiteverifyUrl(input.verifyUrl);
  if (!siteverifyUrl) {
    return { ok: false, status: 503, reason: "invalid_verify_url" };
  }

  if (typeof input.token !== "string") {
    return { ok: false, status: 400, reason: "missing_token" };
  }

  if (hasControlCharacter(input.token)) {
    return { ok: false, status: 400, reason: "invalid_token_format" };
  }

  const token = input.token.trim();
  if (token.length === 0) {
    return { ok: false, status: 400, reason: "missing_token" };
  }

  if (token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, status: 400, reason: "invalid_token_format" };
  }

  const payload = new URLSearchParams({
    secret,
    response: token,
  });
  const remoteIp = input.remoteIp?.trim();
  if (remoteIp && remoteIp !== "unknown") {
    payload.set("remoteip", remoteIp);
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(siteverifyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
      signal: controller.signal,
    });
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return { ok: false, status: 503, reason: "timeout" };
    }
    return { ok: false, status: 503, reason: "upstream_error" };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return { ok: false, status: 503, reason: "upstream_error" };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, status: 503, reason: "upstream_error" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, status: 503, reason: "upstream_error" };
  }

  const data = parsed as Record<string, unknown>;
  const errorCodes = Array.isArray(data["error-codes"])
    ? data["error-codes"].filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  if (data["success"] !== true) {
    return {
      ok: false,
      status: 403,
      reason: "invalid_token",
      errorCodes,
    };
  }

  const action =
    typeof data["action"] === "string" ? data["action"] : undefined;
  const hostname =
    typeof data["hostname"] === "string" ? data["hostname"] : undefined;
  const challengeTs =
    typeof data["challenge_ts"] === "string" ? data["challenge_ts"] : undefined;

  if (input.expectedAction && action !== input.expectedAction) {
    return { ok: false, status: 403, reason: "action_mismatch" };
  }

  if (input.expectedHostname) {
    const allowedList = (
      Array.isArray(input.expectedHostname)
        ? input.expectedHostname
        : [input.expectedHostname]
    )
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (
      allowedList.length > 0 &&
      (!hostname || !allowedList.includes(hostname.toLowerCase()))
    ) {
      return { ok: false, status: 403, reason: "hostname_mismatch" };
    }
  }

  const verified: Extract<TurnstileVerifyResult, { ok: true }> = { ok: true };
  if (action !== undefined) verified.action = action;
  if (hostname !== undefined) verified.hostname = hostname;
  if (challengeTs !== undefined) verified.challengeTs = challengeTs;
  return verified;
}
