import { afterEach, describe, expect, it, vi } from "vitest";

import {
  civilAgentCompletion,
  investigateCivilReport,
} from "@/lib/civil-agent.server";
import type { ChatRequest } from "@/lib/llm/codex.server";
import {
  fallbackConfig,
  LlmCircuitBreaker,
  PURPOSE_POLICIES,
  redactSecrets,
  resetLlmCircuitBreakers,
  validatePurposeRequest,
} from "@/lib/llm/fallback.server";
import {
  completeWithGateway,
  completeWithGatewayResult,
  GATEWAY_MODEL,
  GatewayFailed,
  GatewayPending,
  type GatewayProvenance,
} from "@/lib/llm/gateway.server";
import { publishWaitingReports } from "@/lib/report-publication.server";
import { extractMentionsWithLlm } from "@/lib/text-sources/extract-llm.server";
import { extractItaReport } from "@/lib/text-sources/ita-extract.server";
import { runItaSourceWith } from "@/lib/text-sources/ita-pipeline.server";
import { LlmUnavailable } from "@/lib/text-sources/llm-unavailable";

const PRIMARY_CONFIG = {
  url: "https://secret-home-m2.internal",
  clientId: "cf-id-test",
  clientSecret: "cf-secret-xyz-999",
};

const MISTRAL_FALLBACK = {
  id: "mistral",
  provider: "openai-compatible" as const,
  apiUrl: "https://api.mistral.ai/v1/chat/completions",
  apiKey: "sk-mistral-secret-111",
  model: "mistral-small-latest",
};

const ANTHROPIC_FALLBACK = {
  id: "anthropic-backup",
  provider: "anthropic" as const,
  apiUrl: "https://api.anthropic.com/v1/messages",
  apiKey: "sk-ant-super-secret-999",
  model: "claude-3-5-haiku-latest",
};

const BASE_REQUEST: ChatRequest = {
  messages: [
    { role: "system", content: "Return JSON." },
    { role: "user", content: "citizen private words Benali" },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "fire_mentions",
      strict: true,
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          mentions: { type: "array", items: { type: "string" } },
        },
        required: ["mentions"],
        additionalProperties: false,
      },
    },
  },
};

afterEach(() => {
  resetLlmCircuitBreakers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fallbackConfig & purpose policies", () => {
  it("parses single-provider EU Mistral preset env vars", () => {
    const providers = fallbackConfig({
      LLM_FALLBACK_PROVIDER: "mistral",
      LLM_FALLBACK_API_KEY: "sk-test-mistral",
      LLM_FALLBACK_MODEL: "mistral-small-latest",
      LLM_FALLBACK_TIMEOUT_MS: "15000",
      LLM_FALLBACK_MAX_RETRIES: "1",
      LLM_FALLBACK_HEADERS: JSON.stringify({
        "HTTP-Referer": "https://nadhir.app",
        "X-Title": "Nadhir",
        Authorization: "Bearer hijack-attempt",
        "x-api-key": "hijack-attempt",
      }),
    });

    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      id: "mistral",
      provider: "openai-compatible",
      apiUrl: "https://api.mistral.ai/v1/chat/completions",
      apiKey: "sk-test-mistral",
      model: "mistral-small-latest",
      timeoutMs: 15_000,
      maxRetries: 1,
      headers: {
        "HTTP-Referer": "https://nadhir.app",
        "X-Title": "Nadhir",
      },
    });
  });

  it("normalizes base URLs and rejects embedded URL credentials", () => {
    const normalized = fallbackConfig({
      LLM_FALLBACK_PROVIDER: "openai-compatible",
      LLM_FALLBACK_API_URL: "https://eu-proxy.example/v1",
      LLM_FALLBACK_API_KEY: "sk-test",
      LLM_FALLBACK_MODEL: "mistral-small-latest",
    });
    expect(normalized[0]?.apiUrl).toBe(
      "https://eu-proxy.example/v1/chat/completions",
    );

    const anthropic = fallbackConfig({
      LLM_FALLBACK_PROVIDER: "anthropic",
      LLM_FALLBACK_API_URL: "https://eu-claude.example",
      LLM_FALLBACK_API_KEY: "sk-ant-test",
      LLM_FALLBACK_MODEL: "claude-3-5-haiku-latest",
    });
    expect(anthropic[0]?.apiUrl).toBe("https://eu-claude.example/v1/messages");

    const rejected = fallbackConfig({
      LLM_FALLBACK_PROVIDER: "openai-compatible",
      LLM_FALLBACK_API_URL: "https://user:pass@eu-proxy.example/v1",
      LLM_FALLBACK_API_KEY: "sk-test",
      LLM_FALLBACK_MODEL: "mistral-small-latest",
    });
    expect(rejected).toEqual([]);
  });

  it("gives LLM_FALLBACK_CHAIN precedence and logs safely on malformed JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chain = fallbackConfig({
      LLM_FALLBACK_PROVIDER: "openai",
      LLM_FALLBACK_API_KEY: "sk-single-ignored",
      LLM_FALLBACK_MODEL: "gpt-4o-mini",
      LLM_FALLBACK_CHAIN: JSON.stringify([
        {
          id: "eu-mistral",
          provider: "mistral",
          apiKey: "sk-mistral-1",
          model: "mistral-small-latest",
        },
        {
          id: "eu-claude",
          provider: "anthropic",
          apiKey: "sk-ant-2",
          model: "claude-3-5-haiku-latest",
        },
      ]),
    });
    expect(chain.map((p) => [p.id, p.provider, p.apiUrl])).toEqual([
      [
        "eu-mistral",
        "openai-compatible",
        "https://api.mistral.ai/v1/chat/completions",
      ],
      ["eu-claude", "anthropic", "https://api.anthropic.com/v1/messages"],
    ]);

    const invalid = fallbackConfig({
      LLM_FALLBACK_CHAIN: "{bad-json-sk-secret-do-not-log",
    });
    expect(invalid).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).not.toContain("sk-secret-do-not-log");
  });

  it("enforces per-purpose message and char ceilings", () => {
    expect(validatePurposeRequest("classify_report", BASE_REQUEST)).toBe(true);
    expect(
      validatePurposeRequest("classify_report", {
        ...BASE_REQUEST,
        messages: [
          { role: "system", content: "s" },
          { role: "user", content: "u1" },
          { role: "user", content: "u2" },
        ],
      }),
    ).toBe(false);
    expect(
      validatePurposeRequest("classify_report", {
        ...BASE_REQUEST,
        messages: [{ role: "user", content: "x".repeat(8_001) }],
      }),
    ).toBe(false);
  });
});

describe("completeWithGatewayResult automatic failover", () => {
  it("uses primary gateway without invoking fallback when primary succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ text: '{"mentions":[]}' }));
    vi.stubGlobal("fetch", fetchMock);

    const seenProvenance: GatewayProvenance[] = [];
    const result = await completeWithGatewayResult(
      "extract_dgpc",
      BASE_REQUEST,
      {
        config: PRIMARY_CONFIG,
        fallback: [MISTRAL_FALLBACK],
        onProvenance: (p) => seenProvenance.push(p),
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${PRIMARY_CONFIG.url}/v1/complete`,
    );
    expect(result.text).toBe('{"mentions":[]}');
    expect(result.provenance).toEqual({
      provider: "gateway",
      providerId: "home-gateway",
      model: GATEWAY_MODEL,
      fallbackUsed: false,
      primaryErrorKind: null,
      attempts: 1,
      purpose: "extract_dgpc",
    });
    expect(seenProvenance).toEqual([result.provenance]);
  });

  it("automatically uses EU Mistral fallback when primary gateway is unset", async () => {
    vi.stubEnv("NADHIR_GATEWAY_URL", "");
    vi.stubEnv("NADHIR_GATEWAY_ACCESS_CLIENT_ID", "");
    vi.stubEnv("NADHIR_GATEWAY_ACCESS_CLIENT_SECRET", "");
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "mistral");
    vi.stubEnv("LLM_FALLBACK_API_KEY", "sk-mistral-env-test");
    vi.stubEnv("LLM_FALLBACK_MODEL", "mistral-small-latest");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: '{"mentions":[]}' } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeWithGatewayResult(
      "extract_dgpc",
      BASE_REQUEST,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.mistral.ai/v1/chat/completions",
    );
    expect(result.provenance).toEqual({
      provider: "openai-compatible",
      providerId: "mistral",
      model: "mistral-small-latest",
      fallbackUsed: true,
      primaryErrorKind: "unset",
      attempts: 1,
      purpose: "extract_dgpc",
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "429 plan_paused",
      () =>
        Response.json(
          { reason: "plan_paused", retry_after: 900 },
          { status: 429 },
        ),
      "paused",
    ],
    [
      "429 rate_limited",
      () =>
        Response.json(
          { reason: "rate_limited", retry_after: 10 },
          { status: 429 },
        ),
      "rate_limited",
    ],
    [
      "502 upstream",
      () => Response.json({ reason: "upstream" }, { status: 502 }),
      "upstream_5xx",
    ],
    [
      "500 server error",
      () => Response.json({ reason: "unknown" }, { status: 500 }),
      "upstream_5xx",
    ],
    [
      "503 login_expired",
      () => Response.json({ reason: "login_expired" }, { status: 503 }),
      "login_expired",
    ],
    [
      "504 gateway timeout",
      () => new Response("<html>timeout</html>", { status: 504 }),
      "upstream_5xx",
    ],
    [
      "401 unauthorized",
      () => Response.json({ reason: "unauthorized" }, { status: 401 }),
      "unauthorized",
    ],
    [
      "primary timeout",
      () => {
        throw new DOMException("timed out", "TimeoutError");
      },
      "timeout",
    ],
    [
      "network failure",
      () => {
        throw new TypeError("fetch failed https://secret-home-m2.internal");
      },
      "unreachable",
    ],
    [
      "Access 302 redirect",
      () => new Response(null, { status: 302 }),
      "unreachable",
    ],
    [
      "Cloudflare 530 tunnel HTML",
      () => new Response("<html>tunnel down</html>", { status: 530 }),
      "unreachable",
    ],
  ] as const)(
    "fails over automatically on primary %s",
    async (_label, primaryReply, expectedPrimaryKind) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(async () => primaryReply())
        .mockImplementationOnce(async () =>
          Response.json({
            choices: [{ message: { content: '{"mentions":[]}' } }],
          }),
        );
      vi.stubGlobal("fetch", fetchMock);

      const result = await completeWithGatewayResult(
        "extract_dgpc",
        BASE_REQUEST,
        {
          config: PRIMARY_CONFIG,
          fallback: [MISTRAL_FALLBACK],
        },
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.text).toBe('{"mentions":[]}');
      expect(result.provenance).toMatchObject({
        provider: "openai-compatible",
        providerId: "mistral",
        model: "mistral-small-latest",
        fallbackUsed: true,
        primaryErrorKind: expectedPrimaryKind,
        attempts: 2,
      });
    },
  );

  it("opens primary circuit breaker after threshold and half-open probes after cooldown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 1_000_000;
    const breaker = new LlmCircuitBreaker({
      failureThreshold: 2,
      defaultCooldownMs: 30_000,
    });
    const fetchMock = vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (target.includes("secret-home-m2")) {
        if (now < 1_030_000) {
          throw new TypeError("connect ECONNREFUSED");
        }
        return Response.json({ text: '{"mentions":[]}' });
      }
      return Response.json({
        choices: [{ message: { content: '{"mentions":[]}' } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // 2 primary failures open the circuit
    await completeWithGatewayResult("extract_dgpc", BASE_REQUEST, {
      config: PRIMARY_CONFIG,
      fallback: [MISTRAL_FALLBACK],
      circuitBreaker: breaker,
      now: () => now,
    });
    await completeWithGatewayResult("extract_dgpc", BASE_REQUEST, {
      config: PRIMARY_CONFIG,
      fallback: [MISTRAL_FALLBACK],
      circuitBreaker: breaker,
      now: () => now,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 3rd call skips primary completely (circuit_open)
    const duringOpen = await completeWithGatewayResult(
      "extract_dgpc",
      BASE_REQUEST,
      {
        config: PRIMARY_CONFIG,
        fallback: [MISTRAL_FALLBACK],
        circuitBreaker: breaker,
        now: () => now,
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(duringOpen.provenance).toMatchObject({
      fallbackUsed: true,
      primaryErrorKind: "circuit_open",
      attempts: 1,
    });

    // After cooldown expires, half-open probe hits primary and closes circuit
    now += 31_000;
    const recovered = await completeWithGatewayResult(
      "extract_dgpc",
      BASE_REQUEST,
      {
        config: PRIMARY_CONFIG,
        fallback: [MISTRAL_FALLBACK],
        circuitBreaker: breaker,
        now: () => now,
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(recovered.provenance).toMatchObject({
      provider: "gateway",
      fallbackUsed: false,
      primaryErrorKind: null,
      attempts: 1,
    });
  });

  it("never fails over on caller abort or primary HTTP 400 bad_request", async () => {
    const controller = new AbortController();
    const abortReason = new Error("caller aborted");
    const fetchAbort = vi.fn(async () => {
      controller.abort(abortReason);
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchAbort);

    await expect(
      completeWithGateway("extract_dgpc", BASE_REQUEST, {
        config: PRIMARY_CONFIG,
        fallback: [MISTRAL_FALLBACK],
        signal: controller.signal,
      }),
    ).rejects.toBe(abortReason);
    expect(fetchAbort).toHaveBeenCalledTimes(1);

    const fetch400 = vi
      .fn()
      .mockResolvedValue(
        Response.json({ reason: "bad_request" }, { status: 400 }),
      );
    vi.stubGlobal("fetch", fetch400);

    await expect(
      completeWithGateway("extract_dgpc", BASE_REQUEST, {
        config: PRIMARY_CONFIG,
        fallback: [MISTRAL_FALLBACK],
      }),
    ).rejects.toMatchObject({ name: "GatewayFailed", reason: "bad_request" });
    expect(fetch400).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized requests pre-flight without calling primary or fallback", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      completeWithGateway(
        "classify_report",
        {
          ...BASE_REQUEST,
          messages: [{ role: "user", content: "x".repeat(9_000) }],
        },
        {
          config: PRIMARY_CONFIG,
          fallback: [MISTRAL_FALLBACK],
        },
      ),
    ).rejects.toBeInstanceOf(GatewayFailed);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OpenAI-compatible & Anthropic Messages adapters", () => {
  it("formats OpenAI-compatible requests cleanly, strips $schema & markdown fences, and caps max_tokens", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: '```json\n{"mentions":[]}\n```' },
              ],
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const text = await completeWithGateway("classify_report", BASE_REQUEST, {
      config: null,
      fallback: [
        {
          ...MISTRAL_FALLBACK,
          maxTokens: 9_999,
          headers: { "X-Title": "Nadhir" },
        },
      ],
    });

    expect(text).toBe('{"mentions":[]}');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.redirect).toBe("manual");
    expect(init.headers).toMatchObject({
      authorization: `Bearer ${MISTRAL_FALLBACK.apiKey}`,
      "content-type": "application/json",
      "X-Title": "Nadhir",
    });
    const sent = JSON.parse(String(init.body));
    expect(sent.max_tokens).toBe(PURPOSE_POLICIES.classify_report.maxTokens);
    expect(sent.temperature).toBe(0);
    expect(sent.response_format.json_schema.schema.$schema).toBeUndefined();
  });

  it("coalesces consecutive user messages for Anthropic Messages and parses tool_use or text fallback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const consecutiveRequest: ChatRequest = {
      ...BASE_REQUEST,
      messages: [
        { role: "system", content: "System rules" },
        { role: "user", content: "Initial report" },
        { role: "user", content: "Tool result 1" },
        { role: "user", content: "Tool result 2" },
      ],
    };

    const fetchToolUse = vi.fn().mockResolvedValue(
      Response.json({
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "fire_mentions",
            input: { mentions: ["Alger"] },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchToolUse);

    const toolText = await completeWithGateway(
      "civil_agent_step",
      consecutiveRequest,
      {
        config: null,
        fallback: [ANTHROPIC_FALLBACK],
      },
    );
    expect(JSON.parse(toolText)).toEqual({ mentions: ["Alger"] });

    const init = fetchToolUse.mock.calls[0]?.[1] as RequestInit;
    expect(init.redirect).toBe("manual");
    expect(init.headers).toMatchObject({
      "x-api-key": ANTHROPIC_FALLBACK.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    const sent = JSON.parse(String(init.body));
    expect(sent.system).toBe("System rules");
    expect(sent.messages).toEqual([
      {
        role: "user",
        content: "Initial report\n\nTool result 1\n\nTool result 2",
      },
    ]);
    expect(sent.tool_choice).toEqual({ type: "tool", name: "fire_mentions" });
    expect(sent.tools[0].input_schema.$schema).toBeUndefined();
    expect(sent.max_tokens).toBe(PURPOSE_POLICIES.civil_agent_step.maxTokens);

    // Fallback to text content block with markdown fences
    const fetchTextFallback = vi.fn().mockResolvedValue(
      Response.json({
        content: [
          { type: "text", text: '```json\n{"mentions":["Oran"]}\n```' },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchTextFallback);
    const parsedFromText = await completeWithGateway(
      "civil_agent_step",
      consecutiveRequest,
      {
        config: null,
        fallback: [ANTHROPIC_FALLBACK],
      },
    );
    expect(JSON.parse(parsedFromText)).toEqual({ mentions: ["Oran"] });
  });

  it("walks ordered LLM_FALLBACK_CHAIN when first fallback fails or returns malformed JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ reason: "upstream" }, { status: 502 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: "not valid json" } }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          content: [
            {
              type: "tool_use",
              name: "fire_mentions",
              input: { mentions: ["Blida"] },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeWithGatewayResult(
      "extract_dgpc",
      BASE_REQUEST,
      {
        config: PRIMARY_CONFIG,
        fallback: [MISTRAL_FALLBACK, ANTHROPIC_FALLBACK],
      },
    );

    expect(JSON.parse(result.text)).toEqual({ mentions: ["Blida"] });
    expect(result.provenance).toEqual({
      provider: "anthropic",
      providerId: "anthropic-backup",
      model: "claude-3-5-haiku-latest",
      fallbackUsed: true,
      primaryErrorKind: "upstream_5xx",
      attempts: 3,
      purpose: "extract_dgpc",
    });
  });

  it("throws GatewayPending(fallback_unavailable) with smallest retryAfter when all providers fail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { reason: "plan_paused", retry_after: 120 },
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "25" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("overloaded", {
          status: 529,
          headers: { "retry-after": "45" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown;
    try {
      await completeWithGateway("extract_dgpc", BASE_REQUEST, {
        config: PRIMARY_CONFIG,
        fallback: [MISTRAL_FALLBACK, ANTHROPIC_FALLBACK],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GatewayPending);
    expect(thrown).toBeInstanceOf(LlmUnavailable);
    expect(thrown).toMatchObject({
      reason: "fallback_unavailable",
      retryAfter: 25,
      message: "model gateway fallback_unavailable",
    });
    expect((thrown as Error).message).toMatch(/^model gateway \w+$/);
  });
});

describe("strict secret, prompt & hostname redaction", () => {
  it("never leaks API keys, Access secrets, hostnames, or prompt text in errors or logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const fetchFailAll = vi
      .fn()
      .mockRejectedValueOnce(
        new TypeError(
          `connect failed https://secret-home-m2.internal key=${PRIMARY_CONFIG.clientSecret}`,
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          `upstream echo ${ANTHROPIC_FALLBACK.apiKey} citizen private words Benali https://secret-eu-llm.internal`,
          { status: 502 },
        ),
      );
    vi.stubGlobal("fetch", fetchFailAll);

    let caught: unknown;
    try {
      await completeWithGateway("extract_dgpc", BASE_REQUEST, {
        config: PRIMARY_CONFIG,
        fallback: [
          {
            ...ANTHROPIC_FALLBACK,
            apiUrl: "https://secret-eu-llm.internal/v1/messages",
          },
        ],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GatewayPending);
    const serialized = [
      (caught as Error).message,
      (caught as Error).stack ?? "",
      JSON.stringify(caught),
      ...warn.mock.calls.flat().map(String),
      ...errorSpy.mock.calls.flat().map(String),
    ].join("\n");

    for (const forbidden of [
      "cf-secret-xyz-999",
      "sk-ant-super-secret-999",
      "secret-home-m2.internal",
      "secret-eu-llm.internal",
      "citizen private words Benali",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const scrubbed = redactSecrets(
      "Bearer tok123 sk-ant-abc999 https://secret.example/path custom-secret",
      ["custom-secret"],
    );
    expect(scrubbed).not.toContain("tok123");
    expect(scrubbed).not.toContain("sk-ant-abc999");
    expect(scrubbed).not.toContain("secret.example");
    expect(scrubbed).not.toContain("custom-secret");
  });
});

describe("real caller end-to-end failover integration", () => {
  it("extractItaReport succeeds via fenced OpenAI fallback when primary returns 503 login_expired", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NADHIR_GATEWAY_URL", PRIMARY_CONFIG.url);
    vi.stubEnv("NADHIR_GATEWAY_ACCESS_CLIENT_ID", PRIMARY_CONFIG.clientId);
    vi.stubEnv(
      "NADHIR_GATEWAY_ACCESS_CLIENT_SECRET",
      PRIMARY_CONFIG.clientSecret,
    );
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "mistral");
    vi.stubEnv("LLM_FALLBACK_API_KEY", MISTRAL_FALLBACK.apiKey);
    vi.stubEnv("LLM_FALLBACK_MODEL", MISTRAL_FALLBACK.model);

    const post = {
      id: "post-1",
      uri: "traficalg",
      created_time: "2026-11-24T10:00:00Z",
      message: "Accident route nationale 5 a Bouira circulation bloquee",
      region: "Bouira",
      type: ["iAccident"],
    };

    const extractionPayload = {
      disposition: "incident_report",
      incidents: [
        {
          kind: "collision",
          summary_fr: "Accident signale sur la RN5 a Bouira.",
          evidence: "Accident route nationale 5 a Bouira",
          location_text: "route nationale 5 a Bouira",
          location_evidence: "route nationale 5 a Bouira",
          direction_text: null,
          direction_evidence: null,
          current_status: "ongoing",
          status_evidence: "circulation bloquee",
          region_assessment: "consistent",
          review_reasons: [],
        },
      ],
      review_reasons: [],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ reason: "login_expired" }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: `\`\`\`json\n${JSON.stringify(extractionPayload)}\n\`\`\``,
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const extracted = await extractItaReport(post);
    expect(extracted.disposition).toBe("incident_report");
    expect(extracted.incidents).toHaveLength(1);
    expect(extracted.incidents[0]?.location_text).toBe(
      "route nationale 5 a Bouira",
    );
  });

  it("runItaSourceWith releases without quarantine when both primary and fallback fail", async () => {
    vi.stubEnv("NADHIR_GATEWAY_URL", PRIMARY_CONFIG.url);
    vi.stubEnv("NADHIR_GATEWAY_ACCESS_CLIENT_ID", PRIMARY_CONFIG.clientId);
    vi.stubEnv(
      "NADHIR_GATEWAY_ACCESS_CLIENT_SECRET",
      PRIMARY_CONFIG.clientSecret,
    );
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "mistral");
    vi.stubEnv("LLM_FALLBACK_API_KEY", MISTRAL_FALLBACK.apiKey);
    vi.stubEnv("LLM_FALLBACK_MODEL", MISTRAL_FALLBACK.model);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ reason: "login_expired" }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "90" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const release = vi.fn().mockResolvedValue(undefined);
    const finish = vi.fn().mockResolvedValue(undefined);
    const result = await runItaSourceWith({
      store: {
        etag: async () => null,
        saveFeed: async () => 0,
        claim: async () => [
          {
            id: "rep-1",
            raw: {
              id: "p1",
              uri: "traficalg",
              created_time: "2026-11-24T10:00:00Z",
              message: "Accident Alger",
              region: "Alger",
              type: ["iAccident"],
            },
          },
        ],
        finish,
        release,
        pendingCount: async () => 1,
      },
      fetchFeed: async () => ({
        posts: [],
        etag: null,
        notModified: true,
        rejectedPosts: 0,
      }),
      extract: (raw) => extractItaReport(raw),
    });

    expect(release).toHaveBeenCalledWith("rep-1", 90);
    expect(finish).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
    expect(result.error).toBe("model gateway fallback_unavailable");
  });

  it("extractMentionsWithLlm succeeds via fallback when primary is paused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NADHIR_GATEWAY_URL", PRIMARY_CONFIG.url);
    vi.stubEnv("NADHIR_GATEWAY_ACCESS_CLIENT_ID", PRIMARY_CONFIG.clientId);
    vi.stubEnv(
      "NADHIR_GATEWAY_ACCESS_CLIENT_SECRET",
      PRIMARY_CONFIG.clientSecret,
    );
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "mistral");
    vi.stubEnv("LLM_FALLBACK_API_KEY", MISTRAL_FALLBACK.apiKey);
    vi.stubEnv("LLM_FALLBACK_MODEL", MISTRAL_FALLBACK.model);

    const text = "حريق غابة في ولاية تيزي وزو";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { reason: "plan_paused", retry_after: 300 },
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  mentions: [
                    {
                      wilaya: "تيزي وزو",
                      commune: null,
                      place: null,
                      kind: "vegetation",
                      status: "ongoing",
                      count: 1,
                      evidence: "حريق غابة في ولاية تيزي وزو",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractMentionsWithLlm({
      text,
      language: "ar",
      wilayaHint: null,
    });
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]?.wilaya).toBe("تيزي وزو");
  });

  it("publishWaitingReports records fallback model name via defaultClassifier on primary 502", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NADHIR_GATEWAY_URL", PRIMARY_CONFIG.url);
    vi.stubEnv("NADHIR_GATEWAY_ACCESS_CLIENT_ID", PRIMARY_CONFIG.clientId);
    vi.stubEnv(
      "NADHIR_GATEWAY_ACCESS_CLIENT_SECRET",
      PRIMARY_CONFIG.clientSecret,
    );
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "mistral");
    vi.stubEnv("LLM_FALLBACK_API_KEY", MISTRAL_FALLBACK.apiKey);
    vi.stubEnv("LLM_FALLBACK_MODEL", MISTRAL_FALLBACK.model);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ reason: "upstream" }, { status: 502 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  publishable: true,
                  hazard: "flooding",
                  summary: "Accumulation d eau signalee pres de Bab El Oued.",
                  severity: 3,
                  reason: "ok",
                }),
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const save = vi.fn().mockResolvedValue(undefined);
    const tally = await publishWaitingReports(["report-1"], {
      store: {
        waiting: async () => [
          {
            id: "report-1",
            kind: "flooding",
            note: "Route inondee a Bab El Oued",
            commune_id: "c1",
          },
        ],
        place: async () => "Bab El Oued",
        save,
      },
      now: () => Date.parse("2026-11-24T12:00:00Z"),
    });

    expect(tally).toEqual({ published: 1, held: 0, waiting: 0 });
    expect(save).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({
        publish_state: "published",
        hazard: "flooding",
        summary: "Accumulation d eau signalee pres de Bab El Oued.",
        classifier: "mistral-small-latest",
      }),
    );
  });

  it("investigateCivilReport succeeds via Anthropic tool_use fallback with coalesced user messages", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NADHIR_GATEWAY_URL", PRIMARY_CONFIG.url);
    vi.stubEnv("NADHIR_GATEWAY_ACCESS_CLIENT_ID", PRIMARY_CONFIG.clientId);
    vi.stubEnv(
      "NADHIR_GATEWAY_ACCESS_CLIENT_SECRET",
      PRIMARY_CONFIG.clientSecret,
    );
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "anthropic");
    vi.stubEnv("LLM_FALLBACK_API_KEY", ANTHROPIC_FALLBACK.apiKey);
    vi.stubEnv("LLM_FALLBACK_MODEL", ANTHROPIC_FALLBACK.model);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { reason: "plan_paused", retry_after: 600 },
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          content: [
            {
              type: "tool_use",
              id: "toolu_civil_1",
              name: "civil_investigation_step",
              input: {
                action: "decide",
                query: null,
                parent_id: null,
                decision: {
                  outcome: "discard",
                  reason: "Message de prevention general sans incident actif.",
                  area_id: null,
                  hazard: "road",
                  summary: "Message general sur la prudence routiere.",
                  location_evidence: null,
                  expires_at: null,
                  duplicate_id: null,
                  official_match: null,
                },
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    let recordedModel = GATEWAY_MODEL;
    const signal = AbortSignal.timeout(15_000);
    const result = await investigateCivilReport(
      {
        body: "Soyez prudents sur la route en hiver.",
        publishedAt: "2026-11-24T11:30:00Z",
        incident: { kind: "other", summary_fr: "Message general" },
      },
      {
        get model() {
          return recordedModel;
        },
        now: new Date("2026-11-24T12:00:00Z"),
        complete: civilAgentCompletion(signal, (p) => {
          recordedModel = p.model;
        }),
        searchAreas: async () => [],
        officialReports: async () => [],
        recentPublications: async () => [],
      },
    );

    expect(result.decision.outcome).toBe("discard");
    expect(result.model).toBe(ANTHROPIC_FALLBACK.model);

    // Verify consecutive user messages were coalesced before hitting Anthropic
    const anthropicBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    );
    expect(anthropicBody.messages).toHaveLength(1);
    expect(anthropicBody.messages[0].role).toBe("user");
  });
});
