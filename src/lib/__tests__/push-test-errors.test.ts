import { describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: sessionMock },
}));

import { adminEn } from "@/i18n/admin/en";
import {
  UserPushTestError,
  pushTestErrorKey,
  sendUserPushTest,
  type PushTransport,
} from "@/lib/push";

const lookup = (key: string) =>
  key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      adminEn,
    );

describe("admin error messages", () => {
  it("maps each push-test failure to a message an operator can act on", () => {
    expect([401, 403, 429, 400, 413, 502, 503].map(pushTestErrorKey)).toEqual([
      "sources.pushTestErrors.signIn",
      "sources.pushTestErrors.forbidden",
      "sources.pushTestErrors.wait",
      "sources.pushTestErrors.invalid",
      "sources.pushTestErrors.invalid",
      "sources.pushTestErrors.unavailable",
      "sources.pushTestErrors.unavailable",
    ]);
  });

  it("never points at a missing string", () => {
    for (const key of [
      "sources.pushTestErrors.notifications",
      "sources.pushTestErrors.signIn",
      "sources.pushTestErrors.forbidden",
      "sources.pushTestErrors.wait",
      "sources.pushTestErrors.invalid",
      "sources.pushTestErrors.unavailable",
      "sources.pushTestCheckFailed",
      "reportsPage.moderateForbidden",
      "reportsPage.moderateGone",
      "reportsPage.moderateFailed",
    ])
      expect(typeof lookup(key), key).toBe("string");
  });
});

describe("sendUserPushTest client transport", () => {
  const transport: PushTransport = {
    permission: async () => "granted",
    request: async () => true,
    token: async () => "valid-device-token-12345",
    topics: async () => undefined,
  };

  it("maps HTTP 401, 403 device_not_owned, 429 Retry-After, 400/413, 502, and 503 cleanly", async () => {
    sessionMock.getSession.mockResolvedValue({
      data: { session: { access_token: "jwt-1" } },
      error: null,
    });

    const cases: [number, string, Record<string, string>?][] = [
      [401, "signIn"],
      [403, "deviceNotRegistered"],
      [429, "rateLimited", { "Retry-After": "90" }],
      [400, "invalid"],
      [413, "invalid"],
      [502, "providerFailed"],
      [503, "unavailable"],
    ];

    for (const [status, expectedCode, headers] of cases) {
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "x" }), {
            status,
            ...(headers ? { headers } : {}),
          }),
      ) as unknown as typeof fetch;

      await expect(
        sendUserPushTest({
          mode: "authenticated",
          lang: "ar",
          transport,
          fetchImpl,
        }),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof UserPushTestError &&
          err.code === expectedCode &&
          (expectedCode !== "rateLimited" || err.retryAfterSeconds === 90),
      );
    }
  });

  it("posts to /api/public/v1/push-test in public mode without requiring auth session", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        accepted: true,
        ok: true,
        testId: "pub-test-1",
        channelId: "alerts_test",
        sentAt: "2026-11-25T12:00:00Z",
      }),
    ) as unknown as typeof fetch;

    const result = await sendUserPushTest({
      mode: "public",
      lang: "fr",
      transport,
      fetchImpl,
    });

    expect(result).toEqual({
      testId: "pub-test-1",
      channelId: "alerts_test",
      sentAt: "2026-11-25T12:00:00Z",
    });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(String(url)).toContain("/api/public/v1/push-test");
    expect(JSON.parse(String(init?.body))).toEqual({
      token: "valid-device-token-12345",
      lang: "fr",
    });
  });
});
