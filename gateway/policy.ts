import type { ChatRequest, CodexEffort } from "../src/lib/llm/codex.server";

export type Purpose =
  | "classify_report"
  | "extract_ita"
  | "extract_dgpc"
  | "dgpc_situation"
  | "civil_agent_step";

export type Policy = {
  effort: CodexEffort;
  // weekly or 5-hour plan use, in percent, at which this purpose stops
  ceiling: number;
  maxBodyBytes: number;
  maxMessages: number;
  maxChars: number;
  bucket: { capacity: number; refillPerSecond: number };
};

// the owner's ChatGPT plan is shared: background work yields first, the citizen path last
export const POLICIES: Record<Purpose, Policy> = {
  classify_report: {
    effort: "none",
    ceiling: 90,
    maxBodyBytes: 32_768,
    maxMessages: 2,
    maxChars: 8_000,
    bucket: { capacity: 20, refillPerSecond: 0.5 },
  },
  extract_ita: {
    effort: "low",
    ceiling: 75,
    maxBodyBytes: 262_144,
    maxMessages: 6,
    maxChars: 80_000,
    bucket: { capacity: 15, refillPerSecond: 0.1 },
  },
  extract_dgpc: {
    effort: "low",
    ceiling: 90,
    maxBodyBytes: 65_536,
    maxMessages: 2,
    maxChars: 24_000,
    bucket: { capacity: 10, refillPerSecond: 0.1 },
  },
  dgpc_situation: {
    effort: "low",
    ceiling: 90,
    maxBodyBytes: 65_536,
    maxMessages: 2,
    maxChars: 24_000,
    bucket: { capacity: 10, refillPerSecond: 0.1 },
  },
  civil_agent_step: {
    effort: "low",
    ceiling: 60,
    maxBodyBytes: 524_288,
    maxMessages: 24,
    maxChars: 240_000,
    bucket: { capacity: 12, refillPerSecond: 0.2 },
  },
};

export const MAX_BODY_BYTES = Math.max(
  ...Object.values(POLICIES).map((p) => p.maxBodyBytes),
);
export const PLAN_PAUSE_CEILING = Math.max(
  ...Object.values(POLICIES).map((p) => p.ceiling),
);

export function isPurpose(value: unknown): value is Purpose {
  return typeof value === "string" && Object.hasOwn(POLICIES, value);
}

const ROLES = new Set(["system", "user", "assistant"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// only the fields the plan client reads cross the gateway
export function parseRequest(
  value: unknown,
  policy: Policy,
): ChatRequest | null {
  if (!isObject(value)) return null;
  const { messages, response_format: format } = value;
  if (!Array.isArray(messages) || !messages.length) return null;
  if (messages.length > policy.maxMessages) return null;
  let chars = 0;
  const parsed: ChatRequest["messages"] = [];
  for (const message of messages) {
    if (!isObject(message)) return null;
    const { role, content } = message;
    if (typeof role !== "string" || !ROLES.has(role)) return null;
    if (typeof content !== "string") return null;
    chars += content.length;
    parsed.push({ role: role as "system" | "user" | "assistant", content });
  }
  if (chars > policy.maxChars) return null;
  if (!isObject(format) || format["type"] !== "json_schema") return null;
  const schema = format["json_schema"];
  if (!isObject(schema)) return null;
  if (typeof schema["name"] !== "string" || !schema["name"]) return null;
  if (typeof schema["strict"] !== "boolean") return null;
  if (!isObject(schema["schema"])) return null;
  return {
    messages: parsed,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schema["name"],
        strict: schema["strict"],
        schema: schema["schema"],
      },
    },
  };
}

export class TokenBucket {
  #tokens: number;
  #at: number;
  readonly #capacity: number;
  readonly #rate: number;

  constructor({ capacity, refillPerSecond }: Policy["bucket"], now: number) {
    this.#capacity = capacity;
    this.#rate = refillPerSecond;
    this.#tokens = capacity;
    this.#at = now;
  }

  // seconds until a token is free; 0 means one was taken
  take(now: number): number {
    this.#tokens = Math.min(
      this.#capacity,
      this.#tokens + ((now - this.#at) / 1000) * this.#rate,
    );
    this.#at = now;
    if (this.#tokens >= 1) {
      this.#tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - this.#tokens) / this.#rate);
  }
}
