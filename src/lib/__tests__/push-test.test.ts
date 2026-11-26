import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  send: vi.fn(),
  insert: vi.fn(),
  ownedLookup: vi.fn(),
  fcmEnabled: { value: true },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table === "user_push_devices") {
        return {
          select: () => ({
            eq: (_col1: string, userId: string) => ({
              eq: (_col2: string, deviceHash: string) => ({
                maybeSingle: () => mocks.ownedLookup(userId, deviceHash),
              }),
            }),
          }),
        };
      }
      return {
        insert: (row: unknown) => ({
          select: () => ({ single: () => mocks.insert(row) }),
        }),
      };
    },
  },
}));

vi.mock("@/lib/ingest/fcm.server", () => ({
  fcmSend: mocks.send,
  fcmConfigured: () => mocks.fcmEnabled.value,
}));

import {
  parseProvenancePayload,
  validateProvenanceInvariants,
} from "@/lib/alert-provenance";
import { testPushReceipt } from "@/lib/push-receipt.server";
import { handlePushTest, sha256Hex } from "@/lib/push-test.server";
import { Route as PrivatePushTestRoute } from "@/routes/api/private/push-test";

const DEVICE_TOKEN = "device-registration-token";
const testId = "0c000000-0000-4000-8000-000000000001";

const makeRequest = (
  body: unknown = { token: DEVICE_TOKEN, lang: "fr" },
  bearer = true,
) =>
  new Request("https://nadhir.app/api/private/push-test", {
    method: "POST",
    headers: bearer ? { authorization: "Bearer user-session-jwt" } : {},
    body: JSON.stringify(body),
  });

describe("POST /api/private/push-test (authenticated user self-test)", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    mocks.fcmEnabled.value = true;
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "regular-user-id" } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.ownedLookup.mockResolvedValue({
      data: { device_hash: await sha256Hex(DEVICE_TOKEN) },
      error: null,
    });
    mocks.send.mockResolvedValue(undefined);
    mocks.insert.mockResolvedValue({ data: { id: testId }, error: null });
  });

  it("allows any authenticated user whose device is registered in user_push_devices and sends alerts_test + self_test provenance", async () => {
    const response = await handlePushTest(makeRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      accepted: true,
      ok: true,
      testId,
      channelId: "alerts_test",
    });
    expect(typeof body["sentAt"]).toBe("string");

    const expectedHash = await sha256Hex(DEVICE_TOKEN);
    expect(mocks.ownedLookup).toHaveBeenCalledWith(
      "regular-user-id",
      expectedHash,
    );
    expect(mocks.insert).toHaveBeenCalledWith({ user_id: "regular-user-id" });

    // Never checks admin-only role
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "has_any_role",
      expect.anything(),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      _bucket: "push-test:regular-user-id",
      _limit: 2,
      _window_seconds: 60,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      _bucket: "push-test:hour:regular-user-id",
      _limit: 6,
      _window_seconds: 3600,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      _bucket: `push-test:tok:${expectedHash}`,
      _limit: 3,
      _window_seconds: 300,
    });

    expect(mocks.send).toHaveBeenCalledOnce();
    const sent = mocks.send.mock.calls[0]![0];
    expect(sent).toMatchObject({
      token: DEVICE_TOKEN,
      android: {
        priority: "high",
        notification: { channel_id: "alerts_test", tag: "nadhir-self-test" },
      },
      data: {
        kind: "test",
        channel_id: "alerts_test",
        test_id: testId,
        receipt: await testPushReceipt(testId, "service-key"),
        provenance_trigger: "self_test",
        provenance_source_key: "nadhir_test",
        provenance_source: "Nadhir",
        provenance_rule: "provenance.rule.selfTest",
      },
    });
    expect(sent).not.toHaveProperty("topic");
    expect(sent).not.toHaveProperty("condition");
    expect(sent.notification.title).not.toContain("\u2014");
    expect(sent.notification.body).not.toContain("\u2014");

    const parsed = parseProvenancePayload(sent.data);
    expect(parsed).not.toBeNull();
    expect(validateProvenanceInvariants(parsed!)).toEqual([]);
  });

  it("rejects with 403 device_not_owned when token does not belong to authenticated user (blocks cross-user or arbitrary tokens)", async () => {
    mocks.ownedLookup.mockResolvedValueOnce({ data: null, error: null });
    const response = await handlePushTest(
      makeRequest({ token: "someone-elses-device-token" }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "device_not_owned",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when ownership verification fails", async () => {
    mocks.ownedLookup.mockResolvedValueOnce({
      data: null,
      error: { message: "db offline" },
    });
    const response = await handlePushTest(makeRequest());
    expect(response.status).toBe(503);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects missing or invalid authentication", async () => {
    expect((await handlePushTest(makeRequest({}, false))).status).toBe(401);
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "bad jwt" },
    });
    expect((await handlePushTest(makeRequest())).status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("enforces per-user 60s, per-user hourly, and per-token-hash rate limits with Retry-After", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    const r1 = await handlePushTest(makeRequest());
    expect(r1.status).toBe(429);
    expect(r1.headers.get("retry-after")).toBe("60");

    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const r2 = await handlePushTest(makeRequest());
    expect(r2.status).toBe(429);
    expect(r2.headers.get("retry-after")).toBe("3600");

    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const r3 = await handlePushTest(makeRequest());
    expect(r3.status).toBe(429);
    expect(r3.headers.get("retry-after")).toBe("300");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when quota RPC fails or returns null", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "offline" },
    });
    expect((await handlePushTest(makeRequest())).status).toBe(503);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends nothing when push_test_receipts insert fails or FCM is unconfigured", async () => {
    mocks.insert.mockResolvedValueOnce({
      data: null,
      error: { message: "offline" },
    });
    expect((await handlePushTest(makeRequest())).status).toBe(503);

    mocks.fcmEnabled.value = false;
    expect((await handlePushTest(makeRequest())).status).toBe(503);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed body with 413", async () => {
    expect(
      (await handlePushTest(makeRequest({ token: "x".repeat(9000) }))).status,
    ).toBe(413);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    {},
    { token: "" },
    { token: "short" },
    { token: "x".repeat(4097) },
    { token: "/topics/v1.commune.1601.ar" },
    { token: "'v1.commune.1601.ar' in topics" },
    { token: "device token with spaces" },
    { token: DEVICE_TOKEN, lang: "de" },
    { token: DEVICE_TOKEN, topic: "public" },
    { token: DEVICE_TOKEN, condition: "'a' in topics" },
    { token: DEVICE_TOKEN, title: "Spoofed" },
    { token: DEVICE_TOKEN, body: "Spoofed" },
    { token: DEVICE_TOKEN, channel_id: "alerts_urgent" },
  ])("rejects invalid or injected fields %j with 400", async (body) => {
    expect((await handlePushTest(makeRequest(body))).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sanitizes provider failures without leaking sensitive tokens", async () => {
    mocks.send.mockRejectedValueOnce(new Error("sensitive-token-leak"));
    const response = await handlePushTest(makeRequest());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("sensitive-token-leak");
  });

  it.each(["GET", "PUT", "DELETE"])(
    "returns 405 JSON with Allow: POST, OPTIONS and Cache-Control: private, no-store on %s",
    async (method) => {
      const handlers = PrivatePushTestRoute.options.server
        ?.handlers as unknown as {
        ANY: (input: { request: Request }) => Promise<Response> | Response;
      };
      const response = await handlers.ANY({
        request: new Request("https://nadhir.app/api/private/push-test", {
          method,
        }),
      });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      await expect(response.json()).resolves.toEqual({
        error: "method not allowed",
      });
    },
  );
});
