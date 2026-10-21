export const CODEX_RESPONSES_URL =
  "https://chatgpt.com/backend-api/codex/responses";
export const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
// the Codex CLI's public OAuth client
export const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TIMEOUT_MS = 30_000;
const TRANSIENT_PAUSE_S = 60;
const LOGIN_PAUSE_S = 600;
const USAGE_PAUSE_S = 300;
// the plan is also the owner's own Codex and SanoX allowance: stop short of its limits
const USAGE_CEILING_PERCENT = 80;
const TRANSIENT = [
  "http_429",
  "http_5",
  "stream_",
  "network",
  "timeout",
  "transport",
  "refresh_network",
  "refresh_http_5",
  "unreachable",
];

export type ChatRequest = {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  response_format: {
    type: "json_schema";
    json_schema: { name: string; strict: boolean; schema: unknown };
  };
};

export type CodexLease = { token: string; account: string };

export type CodexUsage = {
  primaryUsed: number | null;
  primaryResetAfter: number | null;
  secondaryUsed: number | null;
  secondaryResetAfter: number | null;
};

export class CodexUnavailable extends Error {
  override name = "CodexUnavailable";
  readonly reason: string;
  readonly sent: boolean;
  readonly retryAfter: number | null;
  readonly status: number | null;

  constructor(
    reason: string,
    options: { sent: boolean; retryAfter?: number | null; status?: number },
  ) {
    super(`codex subscription unavailable: ${reason}`);
    this.reason = reason;
    this.sent = options.sent;
    this.retryAfter = options.retryAfter ?? null;
    this.status = options.status ?? null;
  }
}

function intHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function codexBody(model: string, request: ChatRequest) {
  const { name, schema, strict } = request.response_format.json_schema;
  return {
    model,
    instructions: request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n"),
    input: request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        type: "message",
        role: m.role,
        content: [
          {
            type: m.role === "assistant" ? "output_text" : "input_text",
            text: m.content,
          },
        ],
      })),
    text: { format: { type: "json_schema", name, schema, strict } },
    store: false,
    stream: true,
    reasoning: { effort: "none" },
  };
}

export async function completeWithCodex(
  model: string,
  request: ChatRequest,
  lease: CodexLease,
  signal?: AbortSignal,
): Promise<{ text: string; usage: CodexUsage }> {
  const timeout = AbortSignal.timeout(CODEX_TIMEOUT_MS);
  try {
    const res = await fetch(CODEX_RESPONSES_URL, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        authorization: `Bearer ${lease.token}`,
        "chatgpt-account-id": lease.account,
        originator: "codex_cli_rs",
        accept: "text/event-stream",
        "content-type": "application/json",
        session_id: crypto.randomUUID(),
      },
      body: JSON.stringify(codexBody(model, request)),
    });
    if (res.status !== 200) {
      await res.body?.cancel();
      throw new CodexUnavailable(`http_${res.status}`, {
        sent: true,
        status: res.status,
        retryAfter:
          res.status === 429
            ? (intHeader(res.headers, "x-codex-primary-reset-after-seconds") ??
              intHeader(res.headers, "retry-after"))
            : null,
      });
    }
    const text = await readStream(res);
    return {
      text,
      usage: {
        primaryUsed: intHeader(res.headers, "x-codex-primary-used-percent"),
        primaryResetAfter: intHeader(
          res.headers,
          "x-codex-primary-reset-after-seconds",
        ),
        secondaryUsed: intHeader(res.headers, "x-codex-secondary-used-percent"),
        secondaryResetAfter: intHeader(
          res.headers,
          "x-codex-secondary-reset-after-seconds",
        ),
      },
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof CodexUnavailable) throw error;
    const reason =
      error instanceof TypeError
        ? "network"
        : error instanceof DOMException &&
            (error.name === "TimeoutError" || error.name === "AbortError")
          ? "timeout"
          : "transport";
    throw new CodexUnavailable(reason, { sent: true });
  }
}

async function readStream(res: Response): Promise<string> {
  if (!res.body)
    throw new CodexUnavailable("stream_incomplete", { sent: true });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const parts: string[] = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += value ?? "";
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      let event: { type?: string; delta?: string };
      try {
        event = JSON.parse(line.slice(5));
      } catch {
        await reader.cancel();
        throw new CodexUnavailable("stream_malformed", { sent: true });
      }
      if (event.type === "response.output_text.delta")
        parts.push(event.delta ?? "");
      else if (event.type === "response.completed") {
        await reader.cancel();
        return parts.join("");
      } else if (event.type === "response.failed" || event.type === "error") {
        await reader.cancel();
        throw new CodexUnavailable("stream_failed", { sent: true });
      }
    }
    if (done) throw new CodexUnavailable("stream_incomplete", { sent: true });
  }
}

export function transient(reason: string): boolean {
  return TRANSIENT.some((prefix) => reason.startsWith(prefix));
}

export function pauseFor(error: CodexUnavailable): number {
  if (error.retryAfter !== null) return error.retryAfter;
  return transient(error.reason) ? TRANSIENT_PAUSE_S : LOGIN_PAUSE_S;
}

export function usagePause(usage: CodexUsage): number | null {
  const windows: [number | null, number | null][] = [
    [usage.primaryUsed, usage.primaryResetAfter],
    [usage.secondaryUsed, usage.secondaryResetAfter],
  ];
  const over = windows
    .filter(([used]) => used !== null && used >= USAGE_CEILING_PERCENT)
    .map(([, reset]) => reset ?? USAGE_PAUSE_S);
  return over.length ? Math.max(...over) : null;
}
