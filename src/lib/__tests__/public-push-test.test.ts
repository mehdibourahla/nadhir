import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminFrom, adminRpc, fcmConfigured, fcmSend } = vi.hoisted(() => ({
  adminFrom: vi.fn(),
  adminRpc: vi.fn(),
  fcmConfigured: vi.fn(),
  fcmSend: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: adminFrom, rpc: adminRpc },
}));

vi.mock("@/lib/ingest/fcm.server", () => ({
  fcmConfigured,
  fcmSend,
}));

import {
  parseProvenancePayload,
  validateProvenanceInvariants,
} from "@/lib/alert-provenance";
import { handlePublicPushTest, sha256Hex } from "@/lib/push-test.server";
import { Route } from "@/routes/api/public/v1/push-test";

type Handler = (input: { request: Request }) => Promise<Response>;

function handlers() {
  return Route.options.server?.handlers as unknown as {
    ANY: Handler;
    OPTIONS: Handler;
    POST: Handler;
  };
}

const VALID_TOKEN = "fcm_public_device_token_1234567890:APA91bFakeToken";

describe("POST /api/public/v1/push-test (accountless self-test)", () => {
  beforeEach(() => {
    adminFrom.mockReset();
    adminRpc.mockReset();
    fcmConfigured.mockReset();
    fcmSend.mockReset();
    adminRpc.mockResolvedValue({ data: true, error: null });
    fcmConfigured.mockReturnValue(true);
    fcmSend.mockResolvedValue(undefined);
  });

  it.each(["GET", "PUT", "DELETE"])(
    "returns 405 JSON with Allow: POST, OPTIONS and no-store for %s",
    async (method) => {
      const res = await handlers().ANY({
        request: new Request("https://nadhir.test/api/public/v1/push-test", {
          method,
        }),
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST, OPTIONS");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      await expect(res.json()).resolves.toEqual({
        error: "method not allowed",
      });
      expect(adminRpc).not.toHaveBeenCalled();
      expect(adminFrom).not.toHaveBeenCalled();
      expect(fcmSend).not.toHaveBeenCalled();
    },
  );

  it("handles OPTIONS CORS preflight with 204 and Cache-Control: no-store", async () => {
    const res = await handlers().OPTIONS({
      request: new Request("https://nadhir.test/api/public/v1/push-test", {
        method: "OPTIONS",
      }),
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("sends single-token alerts_test push with zero PII persistence and SHA-256 rate-limit buckets", async () => {
    const res = await handlers().POST({
      request: new Request("https://nadhir.test/api/public/v1/push-test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "41.100.12.34",
        },
        body: JSON.stringify({ token: VALID_TOKEN, lang: "ar" }),
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      accepted: true,
      ok: true,
      channelId: "alerts_test",
    });
    expect(typeof body["testId"]).toBe("string");
    expect(typeof body["sentAt"]).toBe("string");

    // ZERO database table reads/writes (zero PII persistence)
    expect(adminFrom).not.toHaveBeenCalled();

    // Raw token NEVER appears in any rate-limit bucket name
    const expectedHash = await sha256Hex(VALID_TOKEN);
    const buckets = adminRpc.mock.calls.map(
      (call) => (call[1] as { _bucket: string })._bucket,
    );
    expect(buckets).toEqual([
      "public-push-test:ip:41.100.12.34",
      "public-push-test:ip-hour:41.100.12.34",
      `public-push-test:tok:${expectedHash}`,
    ]);
    for (const bucket of buckets) {
      expect(bucket).not.toContain(VALID_TOKEN);
    }

    expect(fcmSend).toHaveBeenCalledOnce();
    const sent = fcmSend.mock.calls[0]![0];
    expect(sent.token).toBe(VALID_TOKEN);
    expect("topic" in sent).toBe(false);
    expect("condition" in sent).toBe(false);
    expect(sent.android.notification.channel_id).toBe("alerts_test");
    expect(sent.data.provenance_trigger).toBe("self_test");
    expect(sent.data.link).toBe("/");
    expect(sent.notification.title).not.toContain("\u2014");
    expect(sent.notification.body).not.toContain("\u2014");

    const parsed = parseProvenancePayload(sent.data);
    expect(parsed).not.toBeNull();
    expect(validateProvenanceInvariants(parsed!)).toEqual([]);
  });

  it("fails closed with 503 when consume_rate_limit errors or returns null", async () => {
    adminRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "limiter down" },
    });
    const res = await handlePublicPushTest(
      new Request("https://nadhir.test/api/public/v1/push-test", {
        method: "POST",
        body: JSON.stringify({ token: VALID_TOKEN }),
      }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(fcmSend).not.toHaveBeenCalled();
  });

  it("enforces per-IP 60s, per-IP hourly, and per-token-hash 60s rate limits with Retry-After", async () => {
    const req = () =>
      new Request("https://nadhir.test/api/public/v1/push-test", {
        method: "POST",
        headers: { "cf-connecting-ip": "10.0.0.1" },
        body: JSON.stringify({ token: VALID_TOKEN }),
      });

    adminRpc.mockResolvedValueOnce({ data: false, error: null });
    const r1 = await handlePublicPushTest(req());
    expect(r1.status).toBe(429);
    expect(r1.headers.get("Retry-After")).toBe("60");

    adminRpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const r2 = await handlePublicPushTest(req());
    expect(r2.status).toBe(429);
    expect(r2.headers.get("Retry-After")).toBe("3600");

    adminRpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const r3 = await handlePublicPushTest(req());
    expect(r3.status).toBe(429);
    expect(r3.headers.get("Retry-After")).toBe("60");
    expect(fcmSend).not.toHaveBeenCalled();
  });

  it("returns 503 when FCM is unconfigured and 413 on oversized bodies", async () => {
    fcmConfigured.mockReturnValueOnce(false);
    const r503 = await handlePublicPushTest(
      new Request("https://nadhir.test/api/public/v1/push-test", {
        method: "POST",
        body: JSON.stringify({ token: VALID_TOKEN }),
      }),
    );
    expect(r503.status).toBe(503);

    const r413 = await handlePublicPushTest(
      new Request("https://nadhir.test/api/public/v1/push-test", {
        method: "POST",
        body: JSON.stringify({ token: "a".repeat(9000) }),
      }),
    );
    expect(r413.status).toBe(413);
    expect(fcmSend).not.toHaveBeenCalled();
  });

  it.each([
    { token: "/topics/v1.commune.1601.ar" },
    { token: VALID_TOKEN, topic: "v1.commune.1601.ar" },
    { token: VALID_TOKEN, condition: "'v1.commune.1601.ar' in topics" },
    { token: VALID_TOKEN, title: "injected" },
    { token: VALID_TOKEN, lang: "es" },
    { token: "short" },
  ])("rejects injection/malformed payload %j with 400", async (payload) => {
    const res = await handlePublicPushTest(
      new Request("https://nadhir.test/api/public/v1/push-test", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    expect(res.status).toBe(400);
    expect(fcmSend).not.toHaveBeenCalled();
  });

  it("returns sanitized 502 on FCM provider failure without echoing token or provider error", async () => {
    fcmSend.mockRejectedValueOnce(
      new Error(`upstream-fcm-secret-401 ${VALID_TOKEN}`),
    );
    const res = await handlePublicPushTest(
      new Request("https://nadhir.test/api/public/v1/push-test", {
        method: "POST",
        body: JSON.stringify({ token: VALID_TOKEN }),
      }),
    );
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(VALID_TOKEN);
    expect(text).not.toContain("upstream-fcm-secret-401");
  });
});
