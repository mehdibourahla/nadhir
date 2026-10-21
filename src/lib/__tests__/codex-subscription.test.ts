import { afterEach, describe, expect, it, vi } from "vitest";

import type { Lease } from "@/lib/llm/codex-login.server";
import { subscriptionTransport } from "@/lib/llm/subscription.server";

const request = {
  model: "google/gemini-2.5-flash",
  messages: [
    { role: "system" as const, content: "Screen reports." },
    { role: "user" as const, content: "smoke near the school" },
  ],
  response_format: {
    type: "json_schema" as const,
    json_schema: { name: "report_decision", strict: true, schema: {} },
  },
  temperature: 0,
};

const USAGE = {
  "x-codex-primary-used-percent": "12",
  "x-codex-primary-reset-after-seconds": "900",
  "x-codex-secondary-used-percent": "3",
  "x-codex-secondary-reset-after-seconds": "500000",
};

function codexReply(headers: Record<string, string> = USAGE) {
  return new Response(
    [
      { type: "response.output_text.delta", delta: '{"from":"codex"}' },
      { type: "response.completed" },
    ]
      .map((e) => `data: ${JSON.stringify(e)}\n\n`)
      .join(""),
    { status: 200, headers },
  );
}

function login(
  lease: Lease = { status: "ready", token: "access-1", account: "acct-1" },
) {
  return {
    lease: vi.fn(async () => lease),
    pause: vi.fn(async (_seconds: number) => {}),
    expire: vi.fn(async (_token: string) => {}),
  };
}

function setup({
  model = "gpt-6-luna",
  owner = login() as ReturnType<typeof login> | null,
  codex = vi.fn(async () => codexReply()),
} = {}) {
  vi.stubGlobal("fetch", codex);
  const openRouter = vi.fn(
    async (_request: typeof request) => '{"from":"openrouter"}',
  );
  const complete = subscriptionTransport({
    model: () => model || undefined,
    login: async () => owner,
  });
  return { complete, openRouter, owner, codex };
}

function logged(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) => JSON.parse(call[0] as string));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("subscriptionFirst", () => {
  it("stays on OpenRouter when no Codex model is configured", async () => {
    const owner = login();
    const { complete, openRouter, codex } = setup({ model: "", owner });
    expect(await complete("report_classifier", request, openRouter)).toBe(
      '{"from":"openrouter"}',
    );
    expect(openRouter).toHaveBeenCalledWith(request);
    expect(owner.lease).not.toHaveBeenCalled();
    expect(codex).not.toHaveBeenCalled();
  });

  it("serves the call on the subscription with the configured model", async () => {
    const { complete, openRouter, codex } = setup();
    expect(await complete("report_classifier", request, openRouter)).toBe(
      '{"from":"codex"}',
    );
    expect(openRouter).not.toHaveBeenCalled();
    const init = (codex.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string).model).toBe("gpt-6-luna");
  });

  it("goes straight to OpenRouter while the subscription is paused", async () => {
    const { complete, openRouter, codex } = setup({
      owner: login({ status: "paused" }),
    });
    expect(await complete("dgpc_situation", request, openRouter)).toBe(
      '{"from":"openrouter"}',
    );
    expect(codex).not.toHaveBeenCalled();
  });

  it("falls back and logs an error when the login is unusable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { complete, openRouter, codex } = setup({
      owner: login({
        status: "unavailable",
        reason: "refresh_http_400",
        pausedSeconds: 600,
      }),
    });
    expect(await complete("ita_extract", request, openRouter)).toBe(
      '{"from":"openrouter"}',
    );
    expect(codex).not.toHaveBeenCalled();
    expect(logged(error)).toEqual([
      expect.objectContaining({
        message: "codex subscription unavailable",
        purpose: "ita_extract",
        reason: "refresh_http_400",
        sent: false,
        paused_s: 600,
      }),
    ]);
  });

  it("falls back after a server error and pauses a minute", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const owner = login();
    const { complete, openRouter } = setup({
      owner,
      codex: vi.fn(async () => new Response("down", { status: 503 })),
    });
    expect(await complete("civil_agent", request, openRouter)).toBe(
      '{"from":"openrouter"}',
    );
    expect(openRouter).toHaveBeenCalledWith(request);
    expect(owner.pause).toHaveBeenCalledWith(60);
    expect(logged(warn)).toEqual([
      expect.objectContaining({ reason: "http_503", sent: true, paused_s: 60 }),
    ]);
  });

  it("marks the token stale and pauses ten minutes on a 401", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const owner = login();
    const { complete, openRouter } = setup({
      owner,
      codex: vi.fn(async () => new Response("expired", { status: 401 })),
    });
    await complete("civil_agent", request, openRouter);
    expect(owner.expire).toHaveBeenCalledWith("access-1");
    expect(owner.pause).toHaveBeenCalledWith(600);
  });

  it("waits for the server's reset time on a 429", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const owner = login();
    const { complete, openRouter } = setup({
      owner,
      codex: vi.fn(
        async () =>
          new Response("limit", {
            status: 429,
            headers: { "x-codex-primary-reset-after-seconds": "1800" },
          }),
      ),
    });
    await complete("dgpc_extract", request, openRouter);
    expect(owner.pause).toHaveBeenCalledWith(1800);
  });

  it("keeps the answer but pauses until the window resets at the 80% ceiling", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const owner = login();
    const { complete, openRouter } = setup({
      owner,
      codex: vi.fn(async () =>
        codexReply({ ...USAGE, "x-codex-primary-used-percent": "81" }),
      ),
    });
    expect(await complete("dgpc_extract", request, openRouter)).toBe(
      '{"from":"codex"}',
    );
    expect(owner.pause).toHaveBeenCalledWith(900);
    expect(logged(warn)).toEqual([
      expect.objectContaining({
        message: "codex subscription paused",
        reason: "usage_ceiling",
        primary_used: 81,
        secondary_used: 3,
        paused_s: 900,
      }),
    ]);
  });

  it("warns once when the plan usage headers are missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { complete, openRouter } = setup({
      codex: vi.fn(async () => codexReply({})),
    });
    await complete("dgpc_extract", request, openRouter);
    await complete("dgpc_extract", request, openRouter);
    expect(logged(warn).map((l) => l.message)).toEqual(["codex usage unknown"]);
  });

  it("falls back when the login binding is missing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { complete, openRouter } = setup({ owner: null });
    expect(await complete("report_classifier", request, openRouter)).toBe(
      '{"from":"openrouter"}',
    );
    expect(logged(error)).toEqual([
      expect.objectContaining({ reason: "binding_missing" }),
    ]);
  });

  it("falls back when the login owner cannot be reached", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const owner = login();
    owner.lease.mockRejectedValue(new Error("Durable Object reset"));
    const { complete, openRouter } = setup({ owner });
    expect(await complete("report_classifier", request, openRouter)).toBe(
      '{"from":"openrouter"}',
    );
  });

  it("still falls back when recording the pause fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const owner = login();
    owner.pause.mockRejectedValue(new Error("Durable Object reset"));
    const { complete, openRouter } = setup({
      owner,
      codex: vi.fn(async () => new Response("down", { status: 502 })),
    });
    expect(await complete("civil_agent", request, openRouter)).toBe(
      '{"from":"openrouter"}',
    );
  });

  it("rethrows the caller's abort instead of retrying on OpenRouter", async () => {
    const caller = new AbortController();
    const reason = new Error("job budget spent");
    const { complete, openRouter } = setup({
      codex: vi.fn(async () => {
        caller.abort(reason);
        throw new DOMException("aborted", "AbortError");
      }),
    });
    await expect(
      complete("ita_extract", request, openRouter, caller.signal),
    ).rejects.toBe(reason);
    expect(openRouter).not.toHaveBeenCalled();
  });
});
