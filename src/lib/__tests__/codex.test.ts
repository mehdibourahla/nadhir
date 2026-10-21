import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CODEX_RESPONSES_URL,
  CodexUnavailable,
  completeWithCodex,
  pauseFor,
  usagePause,
} from "@/lib/llm/codex.server";

const lease = { token: "access-1", account: "acct-1" };

const request = {
  model: "google/gemini-2.5-flash",
  messages: [
    { role: "system" as const, content: "You read bulletins." },
    { role: "user" as const, content: "first" },
    { role: "assistant" as const, content: '{"step":1}' },
    { role: "user" as const, content: "again" },
  ],
  response_format: {
    type: "json_schema" as const,
    json_schema: {
      name: "fire_mentions",
      strict: true,
      schema: { type: "object" },
    },
  },
  temperature: 0,
  max_tokens: 8192,
  provider: { require_parameters: true },
};

const USAGE = {
  "x-codex-primary-used-percent": "12",
  "x-codex-primary-reset-after-seconds": "900",
  "x-codex-secondary-used-percent": "3",
  "x-codex-secondary-reset-after-seconds": "500000",
};

function sse(
  events: unknown[],
  {
    headers = USAGE,
    raw,
  }: { headers?: Record<string, string>; raw?: string } = {},
) {
  return new Response(
    raw ?? events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
    {
      status: 200,
      headers: { "content-type": "text/event-stream", ...headers },
    },
  );
}

const delta = (text: string) => ({
  type: "response.output_text.delta",
  delta: text,
});
const completed = { type: "response.completed", response: {} };

async function failure(promise: Promise<unknown>): Promise<CodexUnavailable> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CodexUnavailable);
  return error as CodexUnavailable;
}

afterEach(() => vi.unstubAllGlobals());

describe("completeWithCodex", () => {
  it("sends our own instructions and schema and joins the streamed text", async () => {
    const fetch = vi.fn(async () =>
      sse([delta('{"mentions"'), delta(":[]}"), completed]),
    );
    vi.stubGlobal("fetch", fetch);

    const reply = await completeWithCodex("gpt-6-luna", request, lease);

    expect(reply.text).toBe('{"mentions":[]}');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CODEX_RESPONSES_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer access-1");
    expect(headers["chatgpt-account-id"]).toBe("acct-1");
    expect(headers["originator"]).toBe("codex_cli_rs");
    expect(headers["accept"]).toBe("text/event-stream");
    expect(headers["session_id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-6-luna",
      instructions: "You read bulletins.",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "first" }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: '{"step":1}' }],
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "again" }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "fire_mentions",
          schema: { type: "object" },
          strict: true,
        },
      },
      store: false,
      stream: true,
      reasoning: { effort: "none" },
    });
  });

  it("opens a fresh session for every call", async () => {
    const fetch = vi.fn(async () => sse([delta("{}"), completed]));
    vi.stubGlobal("fetch", fetch);
    await completeWithCodex("gpt-6-luna", request, lease);
    await completeWithCodex("gpt-6-luna", request, lease);
    const sessions = fetch.mock.calls.map(
      (call) =>
        (
          (call as unknown as [string, RequestInit])[1].headers as Record<
            string,
            string
          >
        )["session_id"],
    );
    expect(new Set(sessions).size).toBe(2);
  });

  it("returns the plan usage headers", async () => {
    vi.stubGlobal("fetch", async () => sse([delta("{}"), completed]));
    const reply = await completeWithCodex("gpt-6-luna", request, lease);
    expect(reply.usage).toEqual({
      primaryUsed: 12,
      primaryResetAfter: 900,
      secondaryUsed: 3,
      secondaryResetAfter: 500000,
    });
  });

  it.each([401, 403, 500, 503])(
    "an HTTP %i is unavailable after send",
    async (status) => {
      vi.stubGlobal("fetch", async () => new Response("no", { status }));
      const error = await failure(
        completeWithCodex("gpt-6-luna", request, lease),
      );
      expect(error).toMatchObject({
        reason: `http_${status}`,
        status,
        sent: true,
      });
    },
  );

  it.each([
    [
      { "x-codex-primary-reset-after-seconds": "1800", "retry-after": "30" },
      1800,
    ],
    [{ "retry-after": "30" }, 30],
    [{}, null],
  ])(
    "a 429 carries the server's reset time %j",
    async (headers, retryAfter) => {
      vi.stubGlobal(
        "fetch",
        async () => new Response("slow", { status: 429, headers }),
      );
      const error = await failure(
        completeWithCodex("gpt-6-luna", request, lease),
      );
      expect(error).toMatchObject({ reason: "http_429", retryAfter });
    },
  );

  it("a failed stream is unavailable", async () => {
    vi.stubGlobal("fetch", async () =>
      sse([delta("{"), { type: "response.failed", response: {} }]),
    );
    expect(
      await failure(completeWithCodex("gpt-6-luna", request, lease)),
    ).toMatchObject({
      reason: "stream_failed",
      sent: true,
    });
  });

  it("an error event is unavailable", async () => {
    vi.stubGlobal("fetch", async () => sse([{ type: "error", message: "x" }]));
    expect(
      (await failure(completeWithCodex("gpt-6-luna", request, lease))).reason,
    ).toBe("stream_failed");
  });

  it("a stream that ends before completion is unavailable", async () => {
    vi.stubGlobal("fetch", async () => sse([delta('{"mentions":')]));
    expect(
      (await failure(completeWithCodex("gpt-6-luna", request, lease))).reason,
    ).toBe("stream_incomplete");
  });

  it("a malformed stream line is unavailable", async () => {
    vi.stubGlobal("fetch", async () => sse([], { raw: "data: {not json\n\n" }));
    expect(
      (await failure(completeWithCodex("gpt-6-luna", request, lease))).reason,
    ).toBe("stream_malformed");
  });

  it("a connection failure is unavailable and counted as possibly sent", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network connection lost");
    });
    expect(
      await failure(completeWithCodex("gpt-6-luna", request, lease)),
    ).toMatchObject({
      reason: "network",
      sent: true,
    });
  });

  it("its own timeout is unavailable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(
      (await failure(completeWithCodex("gpt-6-luna", request, lease))).reason,
    ).toBe("timeout");
  });

  it("the caller's abort is the caller's, not a subscription failure", async () => {
    const caller = new AbortController();
    const reason = new Error("job budget spent");
    vi.stubGlobal("fetch", async () => {
      caller.abort(reason);
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      completeWithCodex("gpt-6-luna", request, lease, caller.signal),
    ).rejects.toBe(reason);
  });
});

describe("pauseFor", () => {
  const unavailable = (reason: string, retryAfter: number | null = null) =>
    new CodexUnavailable(reason, { sent: true, retryAfter });

  it("waits for the server's reset time on a 429", () => {
    expect(pauseFor(unavailable("http_429", 1800))).toBe(1800);
    expect(pauseFor(unavailable("http_429"))).toBe(60);
  });

  it.each([
    "http_500",
    "http_503",
    "stream_failed",
    "stream_malformed",
    "stream_incomplete",
    "network",
    "timeout",
    "transport",
    "refresh_network",
    "refresh_http_502",
    "unreachable",
  ])("pauses a transient %s for a minute", (reason) => {
    expect(pauseFor(unavailable(reason))).toBe(60);
  });

  it.each([
    "http_401",
    "http_403",
    "http_400",
    "login_missing",
    "login_seed_invalid",
    "refresh_http_400",
    "refresh_malformed",
  ])("pauses a login problem %s for ten minutes", (reason) => {
    expect(pauseFor(unavailable(reason))).toBe(600);
  });
});

describe("usagePause", () => {
  const usage = {
    primaryUsed: 10,
    primaryResetAfter: 900,
    secondaryUsed: 10,
    secondaryResetAfter: 500000,
  };

  it("leaves the plan alone below 80% of both windows", () => {
    expect(usagePause({ ...usage, primaryUsed: 79 })).toBeNull();
  });

  it("pauses until the window that crossed 80% resets", () => {
    expect(usagePause({ ...usage, primaryUsed: 80 })).toBe(900);
    expect(usagePause({ ...usage, secondaryUsed: 95 })).toBe(500000);
    expect(usagePause({ ...usage, primaryUsed: 90, secondaryUsed: 81 })).toBe(
      500000,
    );
  });

  it("pauses five minutes when the reset time is missing", () => {
    expect(
      usagePause({ ...usage, primaryUsed: 85, primaryResetAfter: null }),
    ).toBe(300);
  });
});
