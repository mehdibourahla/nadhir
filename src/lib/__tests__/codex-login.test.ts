import { afterEach, describe, expect, it, vi } from "vitest";

import { OAUTH_CLIENT_ID, OAUTH_TOKEN_URL } from "@/lib/llm/codex.server";
import { CodexLogin, type LoginStorage } from "@/lib/llm/codex-login.server";

const NOW = Date.UTC(2026, 9, 21, 12);

function jwt(claims: Record<string, unknown>) {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
}

const access = (name: string, expiresInS: number) =>
  jwt({
    sub: name,
    exp: Math.floor(NOW / 1000) + expiresInS,
    "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
  });

function memory(): LoginStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T>(key: string) =>
      structuredClone(data.get(key)) as T | undefined,
    put: async (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
    },
  };
}

function setup({
  seed = JSON.stringify({
    refresh_token: "refresh-1",
    access_token: access("a1", 3600),
  }),
  storage = memory(),
}: { seed?: string; storage?: ReturnType<typeof memory> } = {}) {
  const clock = { now: NOW };
  const login = new CodexLogin({
    storage,
    seed: () => seed,
    now: () => clock.now,
  });
  return { login, storage, clock };
}

function refreshReplies(...bodies: (Record<string, unknown> | Response)[]) {
  const fetch = vi.fn(async () => {
    const next = bodies.shift();
    if (!next) throw new Error("unexpected refresh");
    return next instanceof Response ? next : Response.json(next);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("CodexLogin", () => {
  it("leases a fresh seeded token without refreshing", async () => {
    const fetch = refreshReplies();
    const { login } = setup();
    expect(await login.lease()).toEqual({
      status: "ready",
      token: access("a1", 3600),
      account: "acct-1",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes an expiring token and keeps the rotated refresh token", async () => {
    const fetch = refreshReplies({
      access_token: access("a2", 3600),
      refresh_token: "refresh-2",
    });
    const { login, storage } = setup({
      seed: JSON.stringify({
        refresh_token: "refresh-1",
        access_token: access("a1", 120),
      }),
    });

    expect(await login.lease()).toMatchObject({
      status: "ready",
      token: access("a2", 3600),
    });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OAUTH_TOKEN_URL);
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: OAUTH_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
      scope: "openid profile email",
    });
    expect(JSON.stringify([...storage.data.values()])).toContain("refresh-2");
    expect(JSON.stringify([...storage.data.values()])).not.toContain(
      "refresh-1",
    );
  });

  it("makes one refresh for many concurrent leases", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetch = vi.fn(async () => {
      await gate;
      return Response.json({
        access_token: access("a2", 3600),
        refresh_token: "refresh-2",
      });
    });
    vi.stubGlobal("fetch", fetch);
    const { login } = setup({
      seed: JSON.stringify({ refresh_token: "refresh-1" }),
    });

    const leases = Promise.all(Array.from({ length: 8 }, () => login.lease()));
    release();

    expect(new Set((await leases).map((l) => "token" in l && l.token))).toEqual(
      new Set([access("a2", 3600)]),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps using its own rotated record after a restart instead of the old seed", async () => {
    refreshReplies({
      access_token: access("a2", 3600),
      refresh_token: "refresh-2",
    });
    const seed = JSON.stringify({ refresh_token: "refresh-1" });
    const first = setup({ seed });
    await first.login.lease();

    const fetch = refreshReplies();
    const restarted = setup({ seed, storage: first.storage });
    expect(await restarted.login.lease()).toMatchObject({
      token: access("a2", 3600),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("adopts a new seed and lifts a pause", async () => {
    refreshReplies();
    const first = setup();
    await first.login.lease();
    await first.login.pause(600);

    const relogin = setup({
      seed: JSON.stringify({
        refresh_token: "refresh-9",
        access_token: access("a9", 3600),
      }),
      storage: first.storage,
    });
    expect(await relogin.login.lease()).toMatchObject({
      status: "ready",
      token: access("a9", 3600),
    });
  });

  it("is unavailable and pauses ten minutes without any login", async () => {
    const { login, clock } = setup({ seed: "" });
    expect(await login.lease()).toEqual({
      status: "unavailable",
      reason: "login_missing",
      pausedSeconds: 600,
    });
    clock.now += 599_000;
    expect(await login.lease()).toEqual({ status: "paused" });
  });

  it("rejects an unreadable seed", async () => {
    const { login } = setup({ seed: "{not json" });
    expect(await login.lease()).toMatchObject({ reason: "login_seed_invalid" });
  });

  it("pauses ten minutes and keeps the record when the refresh is refused", async () => {
    refreshReplies(new Response("invalid_grant", { status: 400 }));
    const { login, storage, clock } = setup({
      seed: JSON.stringify({ refresh_token: "refresh-1" }),
    });
    expect(await login.lease()).toEqual({
      status: "unavailable",
      reason: "refresh_http_400",
      pausedSeconds: 600,
    });
    expect(JSON.stringify([...storage.data.values()])).toContain("refresh-1");
    clock.now += 601_000;
    refreshReplies({
      access_token: access("a2", 3600),
      refresh_token: "refresh-2",
    });
    expect(await login.lease()).toMatchObject({ status: "ready" });
  });

  it("pauses a minute when the refresh endpoint cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("connection refused");
    });
    const { login } = setup({
      seed: JSON.stringify({ refresh_token: "refresh-1" }),
    });
    expect(await login.lease()).toEqual({
      status: "unavailable",
      reason: "refresh_network",
      pausedSeconds: 60,
    });
  });

  it("refreshes on the next lease after a 401 marks the current token stale", async () => {
    const fetch = refreshReplies({
      access_token: access("a2", 3600),
      refresh_token: "refresh-2",
    });
    const { login } = setup();
    const first = await login.lease();
    await login.expire("token" in first ? first.token : "");
    expect(await login.lease()).toMatchObject({ token: access("a2", 3600) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores a late 401 for a token it already replaced", async () => {
    const fetch = refreshReplies({
      access_token: access("a2", 3600),
      refresh_token: "refresh-2",
    });
    const { login } = setup();
    await login.expire(access("a1", 3600));
    await login.lease();
    await login.expire(access("a1", 3600));
    expect(await login.lease()).toMatchObject({ token: access("a2", 3600) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("only ever extends a pause", async () => {
    refreshReplies();
    const { login, clock } = setup();
    await login.lease();
    await login.pause(600);
    await login.pause(60);
    clock.now += 61_000;
    expect(await login.lease()).toEqual({ status: "paused" });
    clock.now += 540_000;
    expect(await login.lease()).toMatchObject({ status: "ready" });
  });
});
