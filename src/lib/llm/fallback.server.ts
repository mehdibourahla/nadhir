import type { ChatRequest } from "./codex.server";
import type { GatewayPurpose } from "./gateway.server";

export type LlmProviderKind = "gateway" | "openai-compatible" | "anthropic";

export type GatewayFailureKind =
  | "unset"
  | "unreachable"
  | "paused"
  | "rate_limited"
  | "login_expired"
  | "unauthorized"
  | "timeout"
  | "upstream_5xx"
  | "malformed"
  | "bad_request"
  | "circuit_open";

export type GatewayProvenance = {
  provider: LlmProviderKind;
  providerId: string;
  model: string;
  fallbackUsed: boolean;
  primaryErrorKind: GatewayFailureKind | null;
  attempts: number;
  purpose: GatewayPurpose;
};

export type FallbackProviderConfig = {
  id: string;
  provider: "openai-compatible" | "anthropic";
  apiUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number | undefined;
  maxTokens?: number | undefined;
  maxRetries?: number | undefined;
  headers?: Record<string, string> | undefined;
  anthropicVersion?: string | undefined;
};

export type PurposePolicy = {
  maxBodyBytes: number;
  maxMessages: number;
  maxChars: number;
  maxTokens: number;
  defaultTimeoutMs: number;
};

export type FallbackAttemptOutcome =
  | { ok: true; text: string }
  | { ok: false; kind: GatewayFailureKind; retryAfter: number | null };

export const PURPOSE_POLICIES: Record<GatewayPurpose, PurposePolicy> = {
  classify_report: {
    maxBodyBytes: 32_768,
    maxMessages: 2,
    maxChars: 8_000,
    maxTokens: 512,
    defaultTimeoutMs: 8_000,
  },
  extract_ita: {
    maxBodyBytes: 262_144,
    maxMessages: 6,
    maxChars: 80_000,
    maxTokens: 4_096,
    defaultTimeoutMs: 45_000,
  },
  extract_dgpc: {
    maxBodyBytes: 65_536,
    maxMessages: 2,
    maxChars: 24_000,
    maxTokens: 2_048,
    defaultTimeoutMs: 45_000,
  },
  dgpc_situation: {
    maxBodyBytes: 65_536,
    maxMessages: 2,
    maxChars: 24_000,
    maxTokens: 2_048,
    defaultTimeoutMs: 45_000,
  },
  civil_agent_step: {
    maxBodyBytes: 524_288,
    maxMessages: 24,
    maxChars: 240_000,
    maxTokens: 2_048,
    defaultTimeoutMs: 50_000,
  },
};

const PRESET_URLS: Record<string, string> = {
  mistral: "https://api.mistral.ai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

const RESERVED_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "content-type",
  "host",
  "content-length",
  "anthropic-version",
  "cf-access-client-id",
  "cf-access-client-secret",
]);

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const PROVIDER_ID_RE = /^[a-z0-9._-]{1,40}$/i;
const MAX_CHAIN_LENGTH = 5;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RETRIES_LIMIT = 2;
const MIN_RETRY_AFTER_S = 1;
const MAX_RETRY_AFTER_S = 3_600;
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

const textEncoder = new TextEncoder();

export function validatePurposeRequest(
  purpose: GatewayPurpose,
  request: ChatRequest,
): boolean {
  const policy = PURPOSE_POLICIES[purpose];
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return false;
  }
  if (request.messages.length > policy.maxMessages) {
    return false;
  }
  let totalChars = 0;
  for (const message of request.messages) {
    if (typeof message.content !== "string") return false;
    totalChars += message.content.length;
    if (totalChars > policy.maxChars) return false;
  }
  const bodyBytes = textEncoder.encode(
    JSON.stringify({ purpose, request }),
  ).byteLength;
  return bodyBytes <= policy.maxBodyBytes;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function parseOptionalInt(
  raw: unknown,
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed =
    typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return undefined;
  return clampInt(parsed, min, max);
}

function resolveProviderWireKind(
  rawProvider: string | undefined,
): "openai-compatible" | "anthropic" | null {
  const normalized = rawProvider?.trim().toLowerCase();
  if (!normalized) return "openai-compatible";
  if (
    normalized === "openai-compatible" ||
    normalized === "openai_compatible" ||
    normalized === "openai" ||
    normalized === "mistral" ||
    normalized === "openrouter"
  ) {
    return "openai-compatible";
  }
  if (normalized === "anthropic") return "anthropic";
  return null;
}

function normalizeProviderUrl(
  rawUrl: string,
  wireKind: "openai-compatible" | "anthropic",
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  if (wireKind === "openai-compatible") {
    if (cleanPath.endsWith("/chat/completions")) {
      parsed.pathname = cleanPath;
    } else if (cleanPath.endsWith("/v1") || cleanPath.endsWith("/v1beta")) {
      parsed.pathname = `${cleanPath}/chat/completions`;
    } else {
      parsed.pathname = `${cleanPath}/v1/chat/completions`;
    }
  } else {
    if (cleanPath.endsWith("/messages")) {
      parsed.pathname = cleanPath;
    } else if (cleanPath.endsWith("/v1")) {
      parsed.pathname = `${cleanPath}/messages`;
    } else {
      parsed.pathname = `${cleanPath}/v1/messages`;
    }
  }
  return parsed.toString();
}

function sanitizeProviderId(
  candidate: unknown,
  fallbackAlias: string | undefined,
  index: number,
): string {
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (PROVIDER_ID_RE.test(trimmed)) return trimmed;
  }
  if (fallbackAlias) {
    const trimmed = fallbackAlias.trim().toLowerCase();
    if (PROVIDER_ID_RE.test(trimmed)) return trimmed;
  }
  return `fallback-${index + 1}`;
}

function sanitizeHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const result: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const trimmedKey = key.trim();
    if (!trimmedKey || /[\r\n:]/.test(trimmedKey)) continue;
    if (RESERVED_HEADERS.has(trimmedKey.toLowerCase())) continue;
    if (typeof value !== "string") continue;
    const trimmedValue = value.trim();
    if (!trimmedValue || /[\r\n]/.test(trimmedValue)) continue;
    result[trimmedKey] = trimmedValue;
    count += 1;
  }
  return count > 0 ? result : undefined;
}

function parseHeadersEnv(
  raw: string | undefined,
  field: string,
): Record<string, string> | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(
        JSON.stringify({ message: "llm fallback config invalid", field }),
      );
      return undefined;
    }
    return sanitizeHeaders(parsed);
  } catch {
    console.warn(
      JSON.stringify({ message: "llm fallback config invalid", field }),
    );
    return undefined;
  }
}

function normalizeEntry(
  raw: Record<string, unknown>,
  index: number,
): FallbackProviderConfig | null {
  const providerRaw =
    typeof raw["provider"] === "string" ? raw["provider"].trim() : undefined;
  const wireKind = resolveProviderWireKind(providerRaw);
  if (!wireKind) return null;

  const apiKey = typeof raw["apiKey"] === "string" ? raw["apiKey"].trim() : "";
  const model = typeof raw["model"] === "string" ? raw["model"].trim() : "";
  if (!apiKey || !model) return null;

  const presetUrl = providerRaw
    ? PRESET_URLS[providerRaw.toLowerCase()]
    : undefined;
  const rawUrl =
    typeof raw["apiUrl"] === "string" && raw["apiUrl"].trim()
      ? raw["apiUrl"].trim()
      : presetUrl;
  if (!rawUrl) return null;

  const apiUrl = normalizeProviderUrl(rawUrl, wireKind);
  if (!apiUrl) return null;

  const id = sanitizeProviderId(raw["id"], providerRaw, index);
  const timeoutMs = parseOptionalInt(
    raw["timeoutMs"],
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const maxTokens = parseOptionalInt(raw["maxTokens"], 64, 16_384);
  const maxRetries = parseOptionalInt(raw["maxRetries"], 0, MAX_RETRIES_LIMIT);
  const headers = sanitizeHeaders(raw["headers"]);
  const anthropicVersion =
    typeof raw["anthropicVersion"] === "string" &&
    raw["anthropicVersion"].trim()
      ? raw["anthropicVersion"].trim()
      : undefined;

  return {
    id,
    provider: wireKind,
    apiUrl,
    apiKey,
    model,
    timeoutMs,
    maxTokens,
    maxRetries,
    headers,
    anthropicVersion,
  };
}

export function fallbackConfig(
  env: Record<string, string | undefined> = typeof process !== "undefined"
    ? process.env
    : {},
): FallbackProviderConfig[] {
  const chainRaw = env["LLM_FALLBACK_CHAIN"]?.trim();
  if (chainRaw) {
    try {
      const parsed: unknown = JSON.parse(chainRaw);
      if (!Array.isArray(parsed)) {
        console.warn(
          JSON.stringify({
            message: "llm fallback config invalid",
            field: "LLM_FALLBACK_CHAIN",
          }),
        );
        return [];
      }
      const providers: FallbackProviderConfig[] = [];
      for (const item of parsed.slice(0, MAX_CHAIN_LENGTH)) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const normalized = normalizeEntry(
          item as Record<string, unknown>,
          providers.length,
        );
        if (normalized) providers.push(normalized);
      }
      return providers;
    } catch {
      console.warn(
        JSON.stringify({
          message: "llm fallback config invalid",
          field: "LLM_FALLBACK_CHAIN",
        }),
      );
      return [];
    }
  }

  const provider = env["LLM_FALLBACK_PROVIDER"]?.trim();
  const apiUrl = env["LLM_FALLBACK_API_URL"]?.trim();
  const apiKey = env["LLM_FALLBACK_API_KEY"]?.trim();
  const model = env["LLM_FALLBACK_MODEL"]?.trim();

  if (!apiKey || !model || (!provider && !apiUrl)) {
    return [];
  }

  const headers = parseHeadersEnv(
    env["LLM_FALLBACK_HEADERS"],
    "LLM_FALLBACK_HEADERS",
  );
  const single = normalizeEntry(
    {
      id: provider || "fallback-1",
      provider,
      apiUrl,
      apiKey,
      model,
      timeoutMs: env["LLM_FALLBACK_TIMEOUT_MS"],
      maxRetries: env["LLM_FALLBACK_MAX_RETRIES"],
      headers,
      anthropicVersion: env["LLM_FALLBACK_ANTHROPIC_VERSION"],
    },
    0,
  );
  return single ? [single] : [];
}

function stripRootDollarSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }
  const record = schema as Record<string, unknown>;
  if (!("$schema" in record)) return schema;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "$schema") continue;
    copy[key] = value;
  }
  return copy;
}

function normalizeAnthropicSchema(schema: unknown): Record<string, unknown> {
  const cleaned = stripRootDollarSchema(schema);
  if (cleaned && typeof cleaned === "object" && !Array.isArray(cleaned)) {
    const record = cleaned as Record<string, unknown>;
    if (record["type"] === "object") return record;
    return { type: "object", ...record };
  }
  return { type: "object", properties: {} };
}

function sanitizeToolName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return cleaned || "structured_output";
}

function stripMarkdownFences(content: string): string {
  const trimmed = content.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match && match[1] !== undefined ? match[1].trim() : trimmed;
}

function validateJsonIfRequired(
  rawText: string,
  request: ChatRequest,
): string | null {
  const cleaned = stripMarkdownFences(rawText);
  if (!cleaned) return null;
  if (request.response_format.type === "json_schema") {
    try {
      JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
  return cleaned;
}

function parseRetryAfterHeader(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const secs = Number.parseInt(trimmed, 10);
    return Number.isFinite(secs)
      ? clampInt(secs, MIN_RETRY_AFTER_S, MAX_RETRY_AFTER_S)
      : null;
  }
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return null;
  const diffSeconds = Math.ceil((timestamp - Date.now()) / 1_000);
  if (diffSeconds <= 0) return MIN_RETRY_AFTER_S;
  return clampInt(diffSeconds, MIN_RETRY_AFTER_S, MAX_RETRY_AFTER_S);
}

function classifyHttpFailure(
  status: number,
  headers: Headers,
): { kind: GatewayFailureKind; retryAfter: number | null } {
  if (status >= 300 && status < 400) {
    return { kind: "unreachable", retryAfter: null };
  }
  if (status === 401 || status === 403) {
    return { kind: "unauthorized", retryAfter: null };
  }
  if (status === 429) {
    return { kind: "rate_limited", retryAfter: parseRetryAfterHeader(headers) };
  }
  if (status === 400 || status === 422) {
    return { kind: "bad_request", retryAfter: null };
  }
  if (status >= 500 && status <= 599) {
    return { kind: "upstream_5xx", retryAfter: parseRetryAfterHeader(headers) };
  }
  return { kind: "unreachable", retryAfter: null };
}

function extractOpenAiContent(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as {
    message?: { content?: unknown; refusal?: unknown };
  };
  const message = first?.message;
  if (!message || typeof message !== "object") return null;
  if (typeof message.refusal === "string" && message.refusal.trim()) {
    return null;
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    const parts: string[] = [];
    for (const part of message.content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        parts.push((part as { text: string }).text);
      }
    }
    return parts.length > 0 ? parts.join("") : null;
  }
  return null;
}

function buildAnthropicPayload(
  provider: FallbackProviderConfig,
  request: ChatRequest,
  maxTokens: number,
): Record<string, unknown> | null {
  const systemParts: string[] = [];
  const messages: { role: "user" | "assistant"; content: string }[] = [];

  for (const msg of request.messages) {
    if (msg.role === "system") {
      if (msg.content.trim()) systemParts.push(msg.content);
      continue;
    }
    const previous = messages.at(-1);
    if (previous && previous.role === msg.role) {
      previous.content = `${previous.content}\n\n${msg.content}`;
    } else {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  if (messages.length === 0 || messages[0]?.role !== "user") {
    return null;
  }

  const toolName = sanitizeToolName(request.response_format.json_schema.name);
  const inputSchema = normalizeAnthropicSchema(
    request.response_format.json_schema.schema,
  );

  return {
    model: provider.model,
    max_tokens: maxTokens,
    temperature: 0,
    ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
    messages,
    tools: [
      {
        name: toolName,
        description:
          "Return the structured JSON response matching the required schema.",
        input_schema: inputSchema,
      },
    ],
    tool_choice: { type: "tool", name: toolName },
  };
}

function extractAnthropicContent(
  body: unknown,
  request: ChatRequest,
): string | null {
  if (!body || typeof body !== "object") return null;
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return null;

  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "tool_use" &&
      (block as { input?: unknown }).input !== undefined
    ) {
      const serialized = JSON.stringify((block as { input: unknown }).input);
      if (typeof serialized === "string") {
        return validateJsonIfRequired(serialized, request);
      }
    }
  }

  const textParts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      textParts.push((block as { text: string }).text);
    }
  }
  if (textParts.length === 0) return null;
  return validateJsonIfRequired(textParts.join("\n"), request);
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function singleFallbackRequest(
  purpose: GatewayPurpose,
  request: ChatRequest,
  provider: FallbackProviderConfig,
  effectiveTimeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<FallbackAttemptOutcome> {
  const policy = PURPOSE_POLICIES[purpose];
  const maxTokens = Math.min(
    provider.maxTokens ?? policy.maxTokens,
    policy.maxTokens,
  );

  let headers: Record<string, string>;
  let payload: Record<string, unknown>;

  if (provider.provider === "anthropic") {
    const built = buildAnthropicPayload(provider, request, maxTokens);
    if (!built) return { ok: false, kind: "bad_request", retryAfter: null };
    payload = built;
    headers = {
      ...(provider.headers ?? {}),
      "x-api-key": provider.apiKey,
      "anthropic-version":
        provider.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION,
      "content-type": "application/json",
    };
  } else {
    const { name, strict, schema } = request.response_format.json_schema;
    payload = {
      model: provider.model,
      messages: request.messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name,
          strict,
          schema: stripRootDollarSchema(schema),
        },
      },
      temperature: 0,
      max_tokens: maxTokens,
    };
    headers = {
      ...(provider.headers ?? {}),
      authorization: `Bearer ${provider.apiKey}`,
      "content-type": "application/json",
    };
  }

  const timeout = AbortSignal.timeout(effectiveTimeoutMs);
  let res: Response | null = null;
  let thrown: unknown = null;
  try {
    res = await fetch(provider.apiUrl, {
      method: "POST",
      redirect: "manual",
      signal: callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout,
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    thrown = error;
  }

  if (!res) {
    if (callerSignal?.aborted) throw callerSignal.reason;
    if (
      timeout.aborted ||
      (thrown instanceof DOMException &&
        (thrown.name === "TimeoutError" || thrown.name === "AbortError"))
    ) {
      return { ok: false, kind: "timeout", retryAfter: null };
    }
    return { ok: false, kind: "unreachable", retryAfter: null };
  }

  if (res.status !== 200) {
    const classified = classifyHttpFailure(res.status, res.headers);
    await res.body?.cancel().catch(() => {});
    return {
      ok: false,
      kind: classified.kind,
      retryAfter: classified.retryAfter,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, kind: "malformed", retryAfter: null };
  }

  const validated =
    provider.provider === "anthropic"
      ? extractAnthropicContent(body, request)
      : (() => {
          const raw = extractOpenAiContent(body);
          return raw === null ? null : validateJsonIfRequired(raw, request);
        })();

  if (validated === null) {
    return { ok: false, kind: "malformed", retryAfter: null };
  }
  return { ok: true, text: validated };
}

export async function completeWithFallbackProvider(
  purpose: GatewayPurpose,
  request: ChatRequest,
  provider: FallbackProviderConfig,
  options: {
    timeoutMs?: number | undefined;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<FallbackAttemptOutcome> {
  const policy = PURPOSE_POLICIES[purpose];
  const effectiveTimeoutMs = Math.min(
    provider.timeoutMs ?? policy.defaultTimeoutMs,
    options.timeoutMs ?? policy.defaultTimeoutMs,
  );
  const maxRetries = clampInt(provider.maxRetries ?? 0, 0, MAX_RETRIES_LIMIT);
  const startedAt = Date.now();

  let lastOutcome: FallbackAttemptOutcome = {
    ok: false,
    kind: "unreachable",
    retryAfter: null,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) throw options.signal.reason;
    const elapsed = Date.now() - startedAt;
    const remaining = effectiveTimeoutMs - elapsed;
    if (attempt > 0 && remaining < 500) break;

    lastOutcome = await singleFallbackRequest(
      purpose,
      request,
      provider,
      Math.max(500, remaining),
      options.signal,
    );
    if (lastOutcome.ok) return lastOutcome;

    const retryable =
      lastOutcome.kind === "rate_limited" ||
      lastOutcome.kind === "upstream_5xx" ||
      lastOutcome.kind === "unreachable";
    if (!retryable || attempt >= maxRetries) {
      return lastOutcome;
    }

    const backoffMs = Math.min(250 * (attempt + 1), 500);
    if (effectiveTimeoutMs - (Date.now() - startedAt) <= backoffMs + 500) {
      return lastOutcome;
    }
    await abortableDelay(backoffMs, options.signal);
  }

  return lastOutcome;
}

type CircuitEntry = {
  consecutiveFailures: number;
  openUntil: number;
};

export class LlmCircuitBreaker {
  private readonly entries = new Map<string, CircuitEntry>();
  private readonly failureThreshold: number;
  private readonly defaultCooldownMs: number;
  private readonly maxCooldownMs: number;

  constructor(options?: {
    failureThreshold?: number | undefined;
    defaultCooldownMs?: number | undefined;
    maxCooldownMs?: number | undefined;
  }) {
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.defaultCooldownMs = options?.defaultCooldownMs ?? 60_000;
    this.maxCooldownMs = options?.maxCooldownMs ?? 300_000;
  }

  isOpen(
    key: string,
    now: number = Date.now(),
  ): { open: boolean; retryAfter: number | null } {
    const entry = this.entries.get(key);
    if (!entry || entry.openUntil <= now) {
      return { open: false, retryAfter: null };
    }
    const retryAfter = Math.max(1, Math.ceil((entry.openUntil - now) / 1_000));
    return { open: true, retryAfter };
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  recordFailure(
    key: string,
    kind: GatewayFailureKind,
    retryAfterSeconds: number | null,
    now: number = Date.now(),
  ): void {
    if (kind === "bad_request" || kind === "malformed") {
      return;
    }
    if (kind === "paused") {
      const pauseMs =
        retryAfterSeconds !== null && retryAfterSeconds > 0
          ? clampInt(retryAfterSeconds * 1_000, 5_000, this.maxCooldownMs)
          : this.defaultCooldownMs;
      this.entries.set(key, {
        consecutiveFailures: this.failureThreshold,
        openUntil: now + pauseMs,
      });
      return;
    }
    const current = this.entries.get(key) ?? {
      consecutiveFailures: 0,
      openUntil: 0,
    };
    const nextFailures = current.consecutiveFailures + 1;
    let openUntil = current.openUntil;
    if (nextFailures >= this.failureThreshold) {
      const useRetryAfter =
        (kind === "rate_limited" || kind === "login_expired") &&
        retryAfterSeconds !== null &&
        retryAfterSeconds > 0;
      const cooldownMs = useRetryAfter
        ? clampInt(retryAfterSeconds * 1_000, 5_000, this.maxCooldownMs)
        : this.defaultCooldownMs;
      openUntil = Math.max(openUntil, now + cooldownMs);
    }
    this.entries.set(key, {
      consecutiveFailures: nextFailures,
      openUntil,
    });
  }

  reset(): void {
    this.entries.clear();
  }
}

export const defaultLlmCircuitBreaker = new LlmCircuitBreaker();

export function resetLlmCircuitBreakers(): void {
  defaultLlmCircuitBreaker.reset();
}

export function redactSecrets(
  text: string,
  secrets: readonly string[] = [],
): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  out = out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/https?:\/\/[^\s'"]+/gi, "[REDACTED_URL]");
  return out;
}

export function logFallbackUsed(provenance: GatewayProvenance): void {
  console.warn(
    JSON.stringify({
      message: "llm fallback used",
      purpose: provenance.purpose,
      provider: provenance.provider,
      provider_id: provenance.providerId,
      model: provenance.model,
      primary_error_kind: provenance.primaryErrorKind,
      attempts: provenance.attempts,
    }),
  );
}
