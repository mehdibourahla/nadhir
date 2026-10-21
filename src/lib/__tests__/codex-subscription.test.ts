import { afterEach, describe, expect, it, vi } from "vitest";

import type { Lease } from "@/lib/llm/codex-login.server";
import {
  routeLogin,
  subscriptionFirst,
  subscriptionTransport,
} from "@/lib/llm/subscription.server";

const request = {
  model: "google/gemini-2.5-flash",
  messages: [
    { role: "system" as const, content: "Read bulletins." },
    { role: "user" as const, content: "bulletin" },
  ],
  response_format: {
    type: "json_schema" as const,
    json_schema: { name: "fire_mentions", strict: true, schema: {} },
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
  pausedSeconds: number | null = null,
) {
  return {
    lease: vi.fn(async () => lease),
    report: vi.fn(async () => ({ pausedSeconds })),
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
    login: () => owner,
  });
  const call = (signal?: AbortSignal) =>
    complete("dgpc_bulletin", request, openRouter, { effort: "low", signal });
  return { call, openRouter, owner, codex };
}

function logged(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) => JSON.parse(call[0] as string));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("subscriptionFirst", () => {
  it("stays on OpenRouter when no Codex model is configured", async () => {
    const owner = login();
    const { call, openRouter, codex } = setup({ model: "", owner });
    expect(await call()).toBe('{"from":"openrouter"}');
    expect(openRouter).toHaveBeenCalledWith(request);
    expect(owner.lease).not.toHaveBeenCalled();
    expect(codex).not.toHaveBeenCalled();
  });

  it("is off outside a GitHub runner even with CODEX_MODEL set", async () => {
    vi.stubEnv("CODEX_MODEL", "gpt-6-luna");
    vi.stubEnv("GITHUB_ACTIONS", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const openRouter = vi.fn(async () => "openrouter");
    expect(
      await subscriptionFirst("dgpc_bulletin", request, openRouter, {
        effort: "low",
      }),
    ).toBe("openrouter");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves the call on the subscription with the call site's effort and reports its usage", async () => {
    const { call, openRouter, codex, owner } = setup();
    expect(await call()).toBe('{"from":"codex"}');
    expect(openRouter).not.toHaveBeenCalled();
    const body = JSON.parse(
      (codex.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      reasoning: { effort: "low" },
    });
    expect(owner!.report).toHaveBeenCalledWith("access-1", {
      ok: true,
      usage: {
        primaryUsed: 12,
        primaryResetAfter: 900,
        secondaryUsed: 3,
        secondaryResetAfter: 500000,
      },
    });
  });

  it("goes straight to OpenRouter while the subscription is paused", async () => {
    const { call, openRouter, codex } = setup({
      owner: login({ status: "paused" }),
    });
    expect(await call()).toBe('{"from":"openrouter"}');
    expect(codex).not.toHaveBeenCalled();
  });

  it("falls back and logs an error when the login is unusable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { call, openRouter, codex } = setup({
      owner: login({
        status: "unavailable",
        reason: "refresh_http_400",
        pausedSeconds: 600,
      }),
    });
    expect(await call()).toBe('{"from":"openrouter"}');
    expect(codex).not.toHaveBeenCalled();
    expect(logged(error)).toEqual([
      expect.objectContaining({
        message: "codex subscription unavailable",
        purpose: "dgpc_bulletin",
        reason: "refresh_http_400",
        sent: false,
        paused_s: 600,
      }),
    ]);
  });

  it("reports a failed call to the login owner and falls back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const owner = login(undefined, 60);
    const { call, openRouter } = setup({
      owner,
      codex: vi.fn(async () => new Response("down", { status: 503 })),
    });
    expect(await call()).toBe('{"from":"openrouter"}');
    expect(openRouter).toHaveBeenCalledWith(request);
    expect(owner.report).toHaveBeenCalledWith("access-1", {
      ok: false,
      reason: "http_503",
      status: 503,
      retryAfter: null,
    });
    expect(logged(warn)).toEqual([
      expect.objectContaining({
        reason: "http_503",
        sent: true,
        paused_s: 60,
      }),
    ]);
  });

  it("reports a 401 with its status so the owner refreshes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const owner = login(undefined, 600);
    const { call } = setup({
      owner,
      codex: vi.fn(async () => new Response("expired", { status: 401 })),
    });
    await call();
    expect(owner.report).toHaveBeenCalledWith(
      "access-1",
      expect.objectContaining({ ok: false, status: 401 }),
    );
  });

  it("keeps the answer and logs the pause when the owner hits the 80% ceiling", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { call } = setup({
      owner: login(undefined, 900),
      codex: vi.fn(async () =>
        codexReply({ ...USAGE, "x-codex-primary-used-percent": "81" }),
      ),
    });
    expect(await call()).toBe('{"from":"codex"}');
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
    const { call } = setup({ codex: vi.fn(async () => codexReply({})) });
    await call();
    await call();
    expect(logged(warn).map((l) => l.message)).toEqual(["codex usage unknown"]);
  });

  it("falls back when the runner has no route to the login", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { call, openRouter } = setup({ owner: null });
    expect(await call()).toBe('{"from":"openrouter"}');
    expect(logged(error)).toEqual([
      expect.objectContaining({ reason: "login_route_unset" }),
    ]);
    expect(openRouter).toHaveBeenCalled();
  });

  it("falls back when the login route cannot be reached", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const owner = login();
    owner.lease.mockRejectedValue(new Error("route HTTP 502"));
    const { call } = setup({ owner });
    expect(await call()).toBe('{"from":"openrouter"}');
  });

  it("still falls back when the report cannot be delivered", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const owner = login();
    owner.report.mockRejectedValue(new Error("route HTTP 502"));
    const { call } = setup({
      owner,
      codex: vi.fn(async () => new Response("down", { status: 502 })),
    });
    expect(await call()).toBe('{"from":"openrouter"}');
  });

  it("rethrows the caller's abort instead of retrying on OpenRouter", async () => {
    const caller = new AbortController();
    const reason = new Error("job budget spent");
    const { call, openRouter } = setup({
      codex: vi.fn(async () => {
        caller.abort(reason);
        throw new DOMException("aborted", "AbortError");
      }),
    });
    await expect(call(caller.signal)).rejects.toBe(reason);
    expect(openRouter).not.toHaveBeenCalled();
  });
});

describe("routeLogin", () => {
  it("leases through the internal route with the cron secret", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        status: "ready",
        access_token: "access-1",
        account_id: "acct-1",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const lease = await routeLogin(
      "https://nadhir.app",
      "runtime-secret",
    ).lease();
    expect(lease).toEqual({
      status: "ready",
      token: "access-1",
      account: "acct-1",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://nadhir.app/api/internal/codex-login");
    expect((init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer runtime-secret",
    );
    expect(JSON.parse(init.body as string)).toEqual({ action: "lease" });
  });

  it("fails loudly on a refused route", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 401 }));
    await expect(
      routeLogin("https://nadhir.app", "wrong").lease(),
    ).rejects.toThrow("401");
  });

  it("rejects a lease reply without a token", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ status: "ready" }));
    await expect(
      routeLogin("https://nadhir.app", "runtime-secret").lease(),
    ).rejects.toThrow();
  });
});
