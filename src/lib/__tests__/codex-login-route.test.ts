import { describe, expect, it, vi } from "vitest";

import { handleCodexLoginRequest } from "@/routes/api/internal/codex-login";

const post = (body: unknown) =>
  new Request("https://nadhir.app/api/internal/codex-login", {
    method: "POST",
    headers: { authorization: "Bearer runtime-secret" },
    body: JSON.stringify(body),
  });

function login() {
  return {
    lease: vi.fn(async () => ({
      status: "ready" as const,
      token: "access-1",
      account: "acct-1",
    })),
    report: vi.fn(async () => ({ pausedSeconds: 600 })),
  };
}

const allow = vi.fn(async () => null);

describe("handleCodexLoginRequest", () => {
  it("refuses a caller without the cron secret before touching the login", async () => {
    const owner = login();
    const response = await handleCodexLoginRequest(post({ action: "lease" }), {
      authenticate: async () => new Response("Unauthorized", { status: 401 }),
      login: async () => owner,
    });
    expect(response.status).toBe(401);
    expect(owner.lease).not.toHaveBeenCalled();
  });

  it("hands out the access token and account, never cached", async () => {
    const response = await handleCodexLoginRequest(post({ action: "lease" }), {
      authenticate: allow,
      login: async () => login(),
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ready",
      access_token: "access-1",
      account_id: "acct-1",
    });
  });

  it("passes a paused lease through without a token", async () => {
    const owner = login();
    owner.lease.mockResolvedValue({ status: "paused" } as never);
    const response = await handleCodexLoginRequest(post({ action: "lease" }), {
      authenticate: allow,
      login: async () => owner,
    });
    expect(await response.json()).toEqual({ status: "paused" });
  });

  it("forwards a runner's 401 to the login owner", async () => {
    const owner = login();
    const outcome = {
      ok: false,
      reason: "http_401",
      status: 401,
      retryAfter: null,
    };
    const response = await handleCodexLoginRequest(
      post({ action: "report", token: "access-1", outcome }),
      { authenticate: allow, login: async () => owner },
    );
    expect(owner.report).toHaveBeenCalledWith("access-1", outcome);
    expect(await response.json()).toEqual({ pausedSeconds: 600 });
  });

  it("forwards the plan usage of a served call", async () => {
    const owner = login();
    const outcome = {
      ok: true,
      usage: {
        primaryUsed: 81,
        primaryResetAfter: 900,
        secondaryUsed: 3,
        secondaryResetAfter: null,
      },
    };
    await handleCodexLoginRequest(
      post({ action: "report", token: "access-1", outcome }),
      { authenticate: allow, login: async () => owner },
    );
    expect(owner.report).toHaveBeenCalledWith("access-1", outcome);
  });

  it.each([
    [{ action: "refresh" }],
    [{ action: "report", token: "access-1", outcome: { ok: false } }],
    [
      {
        action: "report",
        token: "access-1",
        outcome: {
          ok: false,
          reason: "http_429",
          status: 429,
          retryAfter: 10_000_000,
        },
      },
    ],
  ])("rejects a malformed body %j", async (body) => {
    const owner = login();
    const response = await handleCodexLoginRequest(post(body), {
      authenticate: allow,
      login: async () => owner,
    });
    expect(response.status).toBe(400);
    expect(owner.report).not.toHaveBeenCalled();
  });

  it("is unavailable when the Worker has no login binding", async () => {
    const response = await handleCodexLoginRequest(post({ action: "lease" }), {
      authenticate: allow,
      login: async () => null,
    });
    expect(response.status).toBe(503);
  });
});
