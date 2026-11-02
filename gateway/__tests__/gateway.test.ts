import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CodexUnavailable,
  type CodexUsage,
} from "../../src/lib/llm/codex.server";
import type { Lease } from "../../src/lib/llm/codex-login.server";
import { createGateway, type GatewayDeps } from "../gateway";
import { POLICIES, type Purpose } from "../policy";

const TOKEN = "access-token-never-logged";
const MODEL_TEXT = '{"answer":"model words never logged"}';
const NOTE = "citizen note never logged";
const NOW = Date.UTC(2026, 10, 2, 12);

const usage = (primaryUsed: number | null, resetS = 600): CodexUsage => ({
  primaryUsed,
  primaryResetAfter: resetS,
  secondaryUsed: null,
  secondaryResetAfter: null,
});

const chat = (messages = 2, content = NOTE) => ({
  messages: Array.from({ length: messages }, (_, i) => ({
    role: i === 0 ? "system" : "user",
    content,
  })),
  response_format: {
    type: "json_schema",
    json_schema: { name: "answer", strict: true, schema: { type: "object" } },
  },
  model: "ignored",
  temperature: 0,
});

function setup(over: Partial<GatewayDeps> = {}) {
  const clock = { now: NOW };
  const logs: Record<string, unknown>[] = [];
  const lease = vi.fn(async (): Promise<Lease> => ({
    status: "ready",
    token: TOKEN,
    account: "acct-1",
  }));
  const report = vi.fn(async () => ({ pausedSeconds: null }));
  const complete = vi.fn(async () => ({ text: MODEL_TEXT, usage: usage(10) }));
  const handle = createGateway({
    model: "gpt-6-luna",
    login: { lease, report },
    authorized: async (headers) => headers.get("x-test-auth") === "yes",
    status: async () => ({ login: "present", pausedUntil: null }),
    complete,
    now: () => clock.now,
    log: (fields) => logs.push(fields),
    ...over,
  });
  const call = async (
    purpose: string,
    request: unknown = chat(),
    headers: Record<string, string> = { "x-test-auth": "yes" },
  ) => {
    const res = await handle(
      new Request("http://gateway/v1/complete", {
        method: "POST",
        headers,
        body: JSON.stringify({ purpose, request }),
      }),
    );
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  return { handle, call, clock, logs, lease, report, complete };
}

const console_ = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  for (const [level, spy] of Object.entries(console_)) {
    spy.mockClear();
    vi.spyOn(console, level as keyof typeof console_).mockImplementation(spy);
  }
});
afterEach(() => vi.restoreAllMocks());

describe("purpose allowlist", () => {
  it.each(Object.keys(POLICIES) as Purpose[])(
    "%s completes at its own effort",
    async (purpose) => {
      const { call, complete } = setup();
      const reply = await call(purpose);
      expect(reply).toMatchObject({ status: 200, body: { text: MODEL_TEXT } });
      const [model, request, lease, options] = complete.mock
        .calls[0] as unknown as [string, unknown, unknown, { effort: string }];
      expect(model).toBe("gpt-6-luna");
      expect(request).toEqual({
        messages: chat().messages,
        response_format: chat().response_format,
      });
      expect(lease).toMatchObject({ token: TOKEN });
      expect(options.effort).toBe(
        purpose === "classify_report" ? "none" : "low",
      );
    },
  );

  it.each(["", "chat", "__proto__", "toString", null])(
    "refuses purpose %s",
    async (purpose) => {
      const { call, complete } = setup();
      expect(await call(purpose as string)).toMatchObject({
        status: 400,
        body: { reason: "bad_request" },
      });
      expect(complete).not.toHaveBeenCalled();
    },
  );
});

describe("caps", () => {
  it("refuses more messages than the purpose allows", async () => {
    const { call, complete } = setup();
    expect((await call("classify_report", chat(3))).status).toBe(400);
    expect((await call("civil_agent_step", chat(24))).status).toBe(200);
    expect((await call("civil_agent_step", chat(25))).status).toBe(400);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("refuses more characters than the purpose allows", async () => {
    const { call } = setup();
    expect(
      (await call("classify_report", chat(2, "x".repeat(4000)))).status,
    ).toBe(200);
    expect(
      (await call("classify_report", chat(2, "x".repeat(4001)))).body,
    ).toEqual({
      reason: "bad_request",
    });
  });

  it("refuses a body over the purpose limit before parsing its messages", async () => {
    const { call } = setup();
    const request = { ...chat(), padding: "x".repeat(40_000) };
    expect((await call("classify_report", request)).status).toBe(400);
    expect((await call("extract_ita", request)).status).toBe(200);
  });

  it("refuses a declared length over the largest limit without reading it", async () => {
    const { handle } = setup();
    const res = await handle(
      new Request("http://gateway/v1/complete", {
        method: "POST",
        headers: { "x-test-auth": "yes", "content-length": "99999999" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(400);
  });

  it.each([
    ["no messages", { ...chat(), messages: [] }],
    ["a tool role", { ...chat(), messages: [{ role: "tool", content: "x" }] }],
    [
      "non-text content",
      { ...chat(), messages: [{ role: "user", content: [] }] },
    ],
    [
      "no schema",
      { messages: chat().messages, response_format: { type: "text" } },
    ],
  ])("refuses %s", async (_name, request) => {
    const { call } = setup();
    expect(await call("extract_dgpc", request)).toMatchObject({
      status: 400,
      body: { reason: "bad_request" },
    });
  });
});

describe("auth", () => {
  it("rejects an unauthorized caller before reading anything", async () => {
    const { call, handle, lease, complete } = setup();
    expect(await call("classify_report", chat(), {})).toEqual(
      expect.objectContaining({
        status: 401,
        body: { reason: "unauthorized" },
      }),
    );
    const health = await handle(new Request("http://gateway/health"));
    expect(health.status).toBe(401);
    expect(lease).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("usage ceilings", () => {
  it("stops each purpose at its own tier until the window resets", async () => {
    const { call, complete, clock } = setup();
    complete.mockResolvedValueOnce({ text: MODEL_TEXT, usage: usage(60, 120) });
    expect((await call("classify_report")).status).toBe(200);

    const civil = await call("civil_agent_step");
    expect(civil).toMatchObject({
      status: 429,
      body: { reason: "plan_paused", retry_after: 120 },
    });
    expect(civil.headers.get("retry-after")).toBe("120");

    complete.mockResolvedValueOnce({ text: MODEL_TEXT, usage: usage(75, 120) });
    expect((await call("extract_ita")).status).toBe(200);
    expect((await call("extract_ita")).body.reason).toBe("plan_paused");
    expect((await call("extract_dgpc")).status).toBe(200);

    complete.mockResolvedValueOnce({ text: MODEL_TEXT, usage: usage(90, 120) });
    expect((await call("dgpc_situation")).status).toBe(200);
    for (const purpose of Object.keys(POLICIES))
      expect((await call(purpose)).body.reason).toBe("plan_paused");

    clock.now += 121_000;
    expect((await call("civil_agent_step")).status).toBe(200);
  });

  it("reads the weekly window as well as the five-hour one", async () => {
    const { call, complete } = setup();
    complete.mockResolvedValueOnce({
      text: MODEL_TEXT,
      usage: { ...usage(5), secondaryUsed: 76, secondaryResetAfter: 86_400 },
    });
    await call("classify_report");
    expect((await call("extract_ita")).body).toEqual({
      reason: "plan_paused",
      retry_after: 86_400,
    });
    expect((await call("extract_dgpc")).status).toBe(200);
  });
});

describe("rate limit", () => {
  it("empties a purpose's bucket without touching the others", async () => {
    const { call, clock } = setup();
    const { capacity, refillPerSecond } = POLICIES.extract_dgpc.bucket;
    for (let i = 0; i < capacity; i++)
      expect((await call("extract_dgpc")).status).toBe(200);
    expect(await call("extract_dgpc")).toMatchObject({
      status: 429,
      body: { reason: "rate_limited", retry_after: 1 / refillPerSecond },
    });
    expect((await call("dgpc_situation")).status).toBe(200);
    clock.now += 1000 / refillPerSecond;
    expect((await call("extract_dgpc")).status).toBe(200);
  });
});

describe("error reasons", () => {
  it.each<[string, Partial<GatewayDeps>, number, Record<string, unknown>]>([
    [
      "a paused plan",
      { login: { lease: async () => ({ status: "paused" }), report: vi.fn() } },
      429,
      { reason: "plan_paused", retry_after: 60 },
    ],
    [
      "a missing login",
      {
        login: {
          lease: async () => ({
            status: "unavailable",
            reason: "login_missing",
            pausedSeconds: 600,
          }),
          report: vi.fn(),
        },
      },
      503,
      { reason: "login_expired", retry_after: 600 },
    ],
    [
      "a revoked refresh token",
      {
        login: {
          lease: async () => ({
            status: "unavailable",
            reason: "refresh_http_401",
            pausedSeconds: 600,
          }),
          report: vi.fn(),
        },
      },
      503,
      { reason: "login_expired", retry_after: 600 },
    ],
    [
      "an auth server outage",
      {
        login: {
          lease: async () => ({
            status: "unavailable",
            reason: "refresh_http_503",
            pausedSeconds: 60,
          }),
          report: vi.fn(),
        },
      },
      502,
      { reason: "upstream", retry_after: 60 },
    ],
    [
      "an unreadable login store",
      {
        login: {
          lease: async () => {
            throw new Error(`file holds ${TOKEN}`);
          },
          report: vi.fn(),
        },
      },
      502,
      { reason: "upstream" },
    ],
    [
      "the plan's own 429",
      {
        complete: async () => {
          throw new CodexUnavailable("http_429", {
            sent: true,
            status: 429,
            retryAfter: 1800,
          });
        },
      },
      429,
      { reason: "plan_paused", retry_after: 1800 },
    ],
    [
      "a plan server error",
      {
        complete: async () => {
          throw new CodexUnavailable("http_500", { sent: true, status: 500 });
        },
      },
      502,
      { reason: "upstream" },
    ],
    [
      "a broken stream",
      {
        complete: async () => {
          throw new CodexUnavailable("stream_failed", { sent: true });
        },
      },
      502,
      { reason: "upstream" },
    ],
    [
      "an unexpected error carrying model text",
      {
        complete: async () => {
          throw new Error(MODEL_TEXT);
        },
      },
      502,
      { reason: "upstream" },
    ],
  ])("maps %s", async (_name, over, status, body) => {
    const { call } = setup(over);
    expect(await call("extract_dgpc")).toMatchObject({ status, body });
  });

  it("keeps reporting an expired login while the login owner is paused", async () => {
    const lease = vi
      .fn<() => Promise<Lease>>()
      .mockResolvedValueOnce({
        status: "unavailable",
        reason: "refresh_http_400",
        pausedSeconds: 600,
      })
      .mockResolvedValue({ status: "paused" });
    const { call, handle, clock } = setup({
      login: { lease, report: vi.fn() },
    });
    await call("extract_dgpc");
    clock.now += 100_000;
    expect(await call("dgpc_situation")).toMatchObject({
      status: 503,
      body: { reason: "login_expired", retry_after: 500 },
    });
    const health = await handle(
      new Request("http://gateway/health", {
        headers: { "x-test-auth": "yes" },
      }),
    );
    expect(await health.json()).toMatchObject({ login: "expired" });
  });

  it("reports every outcome to the login owner and honours its pause", async () => {
    const report = vi.fn(async () => ({ pausedSeconds: 300 }));
    const lease = vi
      .fn<() => Promise<Lease>>()
      .mockResolvedValueOnce({ status: "ready", token: TOKEN, account: "a" })
      .mockResolvedValue({ status: "paused" });
    const { call } = setup({ login: { lease, report } });
    expect((await call("extract_dgpc")).status).toBe(200);
    expect(report).toHaveBeenCalledWith(TOKEN, { ok: true, usage: usage(10) });
    expect((await call("extract_dgpc")).body).toEqual({
      reason: "plan_paused",
      retry_after: 300,
    });
  });
});

describe("leaks", () => {
  it("never writes a token, a prompt or model text to logs, errors or health", async () => {
    const scenarios: Partial<GatewayDeps>[] = [
      {},
      {
        complete: async () => {
          throw new Error(`${MODEL_TEXT} ${TOKEN}`);
        },
      },
      {
        complete: async () => {
          throw new CodexUnavailable("http_401", { sent: true, status: 401 });
        },
      },
      {
        login: {
          lease: async () => {
            throw new Error(TOKEN);
          },
          report: vi.fn(),
        },
      },
    ];
    const seen: string[] = [];
    for (const over of scenarios) {
      const { call, handle, logs } = setup({
        ...over,
        log: undefined as never,
      });
      for (const purpose of ["classify_report", "nope"]) {
        const reply = await call(purpose);
        if (reply.status !== 200) seen.push(JSON.stringify(reply.body));
      }
      seen.push(JSON.stringify(await call("classify_report", chat(), {})));
      const health = await handle(
        new Request("http://gateway/health", {
          headers: { "x-test-auth": "yes" },
        }),
      );
      seen.push(await health.text());
      seen.push(JSON.stringify(logs));
    }
    for (const spy of Object.values(console_))
      seen.push(JSON.stringify(spy.mock.calls));
    const all = seen.join("\n");
    expect(console_.log).toHaveBeenCalled();
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("model words");
    expect(all).not.toContain(NOTE);
  });
});
