import { afterEach, describe, expect, it, vi } from "vitest";

import { routeLogin } from "@/lib/llm/subscription.server";

afterEach(() => {
  vi.unstubAllGlobals();
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
