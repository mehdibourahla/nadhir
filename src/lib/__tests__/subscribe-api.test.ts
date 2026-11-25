import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminFrom, adminRpc, fcmConfigured, fcmSubscribeTopics } = vi.hoisted(
  () => ({
    adminFrom: vi.fn(),
    adminRpc: vi.fn(),
    fcmConfigured: vi.fn(),
    fcmSubscribeTopics: vi.fn(),
  }),
);

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: adminFrom, rpc: adminRpc },
}));

vi.mock("@/lib/ingest/fcm.server", () => ({
  fcmConfigured,
  fcmSubscribeTopics,
}));

import { Route } from "@/routes/api/public/v1/subscribe";

type Handler = (input: { request: Request }) => Promise<Response>;

function handlers() {
  return Route.options.server?.handlers as unknown as {
    ANY?: Handler;
    OPTIONS: Handler;
    POST: Handler;
  };
}

describe("public push subscription API", () => {
  beforeEach(() => {
    adminFrom.mockReset();
    adminRpc.mockReset();
    fcmConfigured.mockReset();
    fcmSubscribeTopics.mockReset();
  });

  it.each(["GET", "PUT", "DELETE"])(
    "returns the POST-only JSON 405 contract for %s",
    async (method) => {
      const handler = handlers().ANY;
      expect(handler).toBeTypeOf("function");

      const response = await handler!({
        request: new Request("https://nadhir.test/api/public/v1/subscribe", {
          method,
        }),
      });

      expect(response.status).toBe(405);
      await expect(response.json()).resolves.toEqual({
        error: "method not allowed",
      });
      expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
        "POST, OPTIONS",
      );
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(adminRpc).not.toHaveBeenCalled();
      expect(fcmConfigured).not.toHaveBeenCalled();
      expect(fcmSubscribeTopics).not.toHaveBeenCalled();
    },
  );

  it("advertises POST in browser preflight responses", async () => {
    const response = await handlers().OPTIONS({
      request: new Request("https://nadhir.test/api/public/v1/subscribe", {
        method: "OPTIONS",
      }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(adminRpc).not.toHaveBeenCalled();
    expect(fcmConfigured).not.toHaveBeenCalled();
    expect(fcmSubscribeTopics).not.toHaveBeenCalled();
  });

  it("keeps an unconfigured POST structured and skips the provider", async () => {
    adminRpc.mockResolvedValueOnce({ data: true, error: null });
    fcmConfigured.mockReturnValueOnce(false);

    const response = await handlers().POST({
      request: new Request("https://nadhir.test/api/public/v1/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "push delivery is not configured",
    });
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(fcmSubscribeTopics).not.toHaveBeenCalled();
  });

  it("advertises POST when rate limiting rejects the request", async () => {
    adminRpc.mockResolvedValueOnce({ data: false, error: null });

    const response = await handlers().POST({
      request: new Request("https://nadhir.test/api/public/v1/subscribe", {
        method: "POST",
      }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(fcmConfigured).not.toHaveBeenCalled();
    expect(fcmSubscribeTopics).not.toHaveBeenCalled();
  });

  it("rejects malformed POST JSON before calling the provider", async () => {
    adminRpc.mockResolvedValueOnce({ data: true, error: null });
    fcmConfigured.mockReturnValueOnce(true);

    const response = await handlers().POST({
      request: new Request("https://nadhir.test/api/public/v1/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid JSON body",
    });
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(fcmSubscribeTopics).not.toHaveBeenCalled();
  });

  it("advertises POST on successful subscription responses", async () => {
    adminRpc.mockResolvedValueOnce({ data: true, error: null });
    fcmConfigured.mockReturnValueOnce(true);
    fcmSubscribeTopics.mockResolvedValueOnce(undefined);
    adminFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: [{ code: "1601" }], error: null }),
        }),
      }),
    });

    const response = await handlers().POST({
      request: new Request("https://nadhir.test/api/public/v1/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "test-registration-token",
          communes: ["1601"],
          lang: "en",
          action: "subscribe",
        }),
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      topics: ["v1.commune.1601.en"],
    });
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(fcmSubscribeTopics).toHaveBeenCalledWith(
      "test-registration-token",
      ["v1.commune.1601.en"],
      true,
    );
  });

  it("rejects JSON null bodies with 400 and oversized payloads (>16 KiB) with 413 (T5-R2-02)", async () => {
    adminRpc.mockResolvedValue({ data: true, error: null });
    fcmConfigured.mockReturnValue(true);

    const nullRes = await handlers().POST({
      request: new Request("https://nadhir.test/api/public/v1/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      }),
    });
    expect(nullRes.status).toBe(400);
    await expect(nullRes.json()).resolves.toEqual({
      error: "invalid JSON body",
    });

    const largeRes = await handlers().POST({
      request: new Request("https://nadhir.test/api/public/v1/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "t".repeat(20_000),
          communes: ["1601"],
          lang: "en",
          action: "subscribe",
        }),
      }),
    });
    expect(largeRes.status).toBe(413);
    await expect(largeRes.json()).resolves.toEqual({
      error: "body too large",
    });
    expect(fcmSubscribeTopics).not.toHaveBeenCalled();
  });
});
