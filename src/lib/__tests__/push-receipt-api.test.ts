import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      update: () => ({
        eq: () => ({
          is: () => updateMock(),
        }),
      }),
    }),
  },
}));

import { testPushReceipt } from "@/lib/push-receipt.server";
import { Route } from "@/routes/api/public/push-receipt";

type Handler = (input: { request: Request }) => Promise<Response> | Response;

function handlers() {
  return Route.options.server?.handlers as unknown as {
    ANY: Handler;
    OPTIONS: Handler;
    POST: Handler;
  };
}

const TEST_SECRET = "receipt-route-test-secret";
const TEST_ID = "0c000000-0000-4000-8000-000000000042";

describe("/api/public/push-receipt route (Capacitor CORS & receipt recording)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", TEST_SECRET);
    updateMock.mockResolvedValue({ error: null });
  });

  it.each(["https://localhost", "capacitor://localhost"])(
    "allows OPTIONS preflight with 204 and CORS headers for Capacitor origin %s",
    async (origin) => {
      const res = await handlers().OPTIONS({
        request: new Request("https://nadhir.app/api/public/push-receipt", {
          method: "OPTIONS",
          headers: { origin },
        }),
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
        "POST, OPTIONS",
      );
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
        "content-type",
      );
      expect(res.headers.get("Vary")).toContain("Origin");
    },
  );

  it.each(["https://evil.example", "http://localhost", null])(
    "rejects OPTIONS preflight with 403 for untrusted or absent origin %s",
    async (origin) => {
      const res = await handlers().OPTIONS({
        request: new Request("https://nadhir.app/api/public/push-receipt", {
          method: "OPTIONS",
          headers: origin ? { origin } : {},
        }),
      });
      expect(res.status).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    },
  );

  it.each(["GET", "PUT", "DELETE"])(
    "returns 405 with Allow: POST, OPTIONS and Cache-Control: no-store for %s",
    async (method) => {
      const res = await handlers().ANY({
        request: new Request("https://nadhir.app/api/public/push-receipt", {
          method,
        }),
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST, OPTIONS");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      await expect(res.json()).resolves.toEqual({
        error: "method not allowed",
      });
    },
  );

  it.each(["https://localhost", "capacitor://localhost"])(
    "attaches CORS and no-store headers on POST responses for native Capacitor origin %s",
    async (origin) => {
      const receipt = await testPushReceipt(TEST_ID, TEST_SECRET);
      const okRes = await handlers().POST({
        request: new Request("https://nadhir.app/api/public/push-receipt", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
          },
          body: JSON.stringify({ test_id: TEST_ID, receipt }),
        }),
      });
      expect(okRes.status).toBe(204);
      expect(okRes.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(okRes.headers.get("Vary")).toContain("Origin");
      expect(okRes.headers.get("Cache-Control")).toBe("no-store");

      const badRes = await handlers().POST({
        request: new Request("https://nadhir.app/api/public/push-receipt", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
          },
          body: "not-json",
        }),
      });
      expect(badRes.status).toBe(400);
      expect(badRes.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(badRes.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it("keeps same-origin web service-worker POST requests without Access-Control-Allow-Origin", async () => {
    const receipt = await testPushReceipt(TEST_ID, TEST_SECRET);
    const res = await handlers().POST({
      request: new Request("https://nadhir.app/api/public/push-receipt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ test_id: TEST_ID, receipt }),
      }),
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
