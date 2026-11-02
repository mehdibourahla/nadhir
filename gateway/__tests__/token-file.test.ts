import {
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OAUTH_TOKEN_URL } from "../../src/lib/llm/codex.server";
import { parseDeviceLogin } from "../../src/lib/llm/codex-device-login";
import {
  fileLogin,
  loginStatus,
  withFileLock,
  writeLogin,
} from "../token-file";

const NOW = Date.now();

function jwt(expiresInS: number, sub: string) {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part({
    sub,
    exp: Math.floor(NOW / 1000) + expiresInS,
    "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
  })}.sig`;
}

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nadhir-gateway-"));
  file = join(dir, "login.json");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("login file", () => {
  it("is written owner-only and reports its state without its tokens", async () => {
    await writeLogin(file, {
      refresh_token: "refresh-secret",
      access_token: jwt(3600, "a1"),
      account_id: "acct-1",
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).record.refresh_token).toBe(
      "refresh-secret",
    );
    const status = await loginStatus(file, NOW);
    expect(status).toEqual({ login: "present", pausedUntil: null });
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(await loginStatus(join(dir, "none.json"), NOW)).toEqual({
      login: "missing",
      pausedUntil: null,
    });
  });

  it("serves a fresh token without refreshing", async () => {
    await writeLogin(file, {
      refresh_token: "refresh-1",
      access_token: jwt(3600, "a1"),
      account_id: "acct-1",
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await fileLogin(file, { usageCeiling: 90 }).lease()).toEqual({
      status: "ready",
      token: jwt(3600, "a1"),
      account: "acct-1",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes an expiring grant once across concurrent callers in two processes", async () => {
    await writeLogin(file, {
      refresh_token: "refresh-1",
      access_token: jwt(60, "old"),
      account_id: "acct-1",
    });
    const fresh = jwt(3600, "new");
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(OAUTH_TOKEN_URL);
      expect(JSON.parse(init.body as string).refresh_token).toBe("refresh-1");
      await new Promise((resolve) => setTimeout(resolve, 50));
      return Response.json({ access_token: fresh, refresh_token: "refresh-2" });
    });
    vi.stubGlobal("fetch", fetch);
    // separate instances share no memory, like the gateway and the login helper
    const first = fileLogin(file, { usageCeiling: 90 });
    const second = fileLogin(file, { usageCeiling: 90 });
    const leases = await Promise.all(
      Array.from({ length: 6 }, (_, i) => (i % 2 ? first : second).lease()),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const lease of leases)
      expect(lease).toEqual({
        status: "ready",
        token: fresh,
        account: "acct-1",
      });
    const stored = JSON.parse(readFileSync(file, "utf8"));
    expect(stored.record.refresh_token).toBe("refresh-2");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("applies the gateway's ceiling, not the 80% default, to the shared pause", async () => {
    await writeLogin(file, {
      refresh_token: "refresh-1",
      access_token: jwt(3600, "a1"),
      account_id: "acct-1",
    });
    const login = fileLogin(file, { usageCeiling: 90 });
    const usage = (used: number) => ({
      primaryUsed: used,
      primaryResetAfter: 900,
      secondaryUsed: null,
      secondaryResetAfter: null,
    });
    expect(await login.report("t", { ok: true, usage: usage(85) })).toEqual({
      pausedSeconds: null,
    });
    expect(await login.report("t", { ok: true, usage: usage(91) })).toEqual({
      pausedSeconds: 900,
    });
    expect(await login.lease()).toEqual({ status: "paused" });
    expect((await loginStatus(file, Date.now())).pausedUntil).not.toBeNull();
  });
});

describe("file lock", () => {
  it("serializes holders and clears a lock left by a dead process", async () => {
    const order: string[] = [];
    const hold = (name: string) =>
      withFileLock(file, async () => {
        order.push(`${name}:in`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`${name}:out`);
      });
    await Promise.all([hold("a"), hold("b")]);
    expect(order).toHaveLength(4);
    expect(order[1]).toBe(order[0]!.replace(":in", ":out"));
    expect(order[3]).toBe(order[2]!.replace(":in", ":out"));

    writeFileSync(`${file}.lock`, "");
    const old = new Date(Date.now() - 120_000);
    utimesSync(`${file}.lock`, old, old);
    expect(await withFileLock(file, async () => "taken")).toBe("taken");
  });
});

describe("device login", () => {
  it("names the source but never the token when a login file is unusable", () => {
    expect(() =>
      parseDeviceLogin(
        JSON.stringify({ tokens: { access_token: "access-secret" } }),
        "auth.json",
      ),
    ).toThrow(/^auth\.json holds no ChatGPT login/);
    try {
      parseDeviceLogin(
        '{"tokens": {"refresh_token": "refresh-secret"',
        "stdin",
      );
    } catch (error) {
      expect((error as Error).message).toBe("stdin is not a Codex login file");
    }
    expect(
      parseDeviceLogin(
        JSON.stringify({
          tokens: { refresh_token: "r", account_id: "a", extra: "x" },
        }),
        "auth.json",
      ),
    ).toEqual({ refresh_token: "r", account_id: "a" });
  });
});
