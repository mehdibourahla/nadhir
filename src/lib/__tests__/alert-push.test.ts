import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {},
}));
vi.mock("@/lib/ingest/fcm.server", () => ({
  fcmSend: vi.fn(),
  fcmConfigured: () => true,
}));

import { drainAlertPushes, type ClaimedPush } from "@/lib/alert-push.server";

const claimed = (overrides: Partial<ClaimedPush> = {}): ClaimedPush => ({
  id: "a1",
  user_id: "u1",
  kind: "weather",
  title: "ONM warning for Home",
  body: "ONM: “Orages”",
  source_id: "onm1",
  cluster_id: null,
  payload: null,
  push_attempts: 1,
  push_claimed_at: "2026-09-24T20:00:00Z",
  ...overrides,
});

function harness(rows: ClaimedPush[], send: () => Promise<void>) {
  const finished: [string, string][] = [];
  return {
    finished,
    deps: {
      configured: () => true,
      claim: vi.fn(async () => rows),
      withdrawnPushConsent: vi.fn(async () => new Set<string>()),
      devices: vi.fn(async () => new Set(rows.map((row) => row.user_id))),
      send: vi.fn(send),
      finish: vi.fn(async (row: ClaimedPush, state: string) => {
        finished.push([row.id, state]);
      }),
    },
  };
}

describe("drainAlertPushes", () => {
  it("marks a delivered alert as sent", async () => {
    const { deps, finished } = harness([claimed()], async () => undefined);
    expect(await drainAlertPushes(deps)).toEqual({
      pushed: 1,
      pushFailed: 0,
      noDevice: 0,
      consentWithdrawn: 0,
      claimsLost: 0,
    });
    expect(finished).toEqual([["a1", "sent"]]);
  });

  it("keeps a failed alert pending so the next run retries it", async () => {
    const { deps, finished } = harness([claimed()], async () => {
      throw new Error("fcm send failed (500)");
    });
    expect(await drainAlertPushes(deps)).toEqual({
      pushed: 0,
      pushFailed: 1,
      noDevice: 0,
      consentWithdrawn: 0,
      claimsLost: 0,
    });
    expect(finished).toEqual([["a1", "pending"]]);
  });

  it("gives up on the fifth failed attempt", async () => {
    const { deps, finished } = harness(
      [claimed({ push_attempts: 5 })],
      async () => {
        throw new Error("fcm send failed (500)");
      },
    );
    await drainAlertPushes(deps);
    expect(finished).toEqual([["a1", "failed"]]);
  });

  it("marks an alert for a user with no opted-in device without calling FCM", async () => {
    const rows = [
      claimed({ id: "a1", user_id: "u1" }),
      claimed({ id: "a2", user_id: "u2" }),
    ];
    const { deps, finished } = harness(rows, async () => undefined);
    deps.devices.mockResolvedValue(new Set(["u2"]));
    expect(await drainAlertPushes(deps)).toEqual({
      pushed: 1,
      pushFailed: 0,
      noDevice: 1,
      consentWithdrawn: 0,
      claimsLost: 0,
    });
    expect(finished).toEqual([
      ["a1", "no_device"],
      ["a2", "sent"],
    ]);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.devices).toHaveBeenCalledWith(["u1", "u2"]);
  });

  it("claims nothing when push is not configured", async () => {
    const { deps } = harness([claimed()], async () => undefined);
    const result = await drainAlertPushes({ ...deps, configured: () => false });
    expect(result).toEqual({
      pushed: 0,
      pushFailed: 0,
      noDevice: 0,
      consentWithdrawn: 0,
      claimsLost: 0,
    });
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("carries on with the batch when another run reclaimed an alert", async () => {
    const rows = [claimed({ id: "a1" }), claimed({ id: "a2" })];
    const { deps } = harness(rows, async () => undefined);
    deps.finish.mockImplementationOnce(async () => {
      throw new Error("alert push claim lost");
    });
    expect(await drainAlertPushes(deps)).toEqual({
      pushed: 1,
      pushFailed: 0,
      noDevice: 0,
      consentWithdrawn: 0,
      claimsLost: 1,
    });
    expect(deps.send).toHaveBeenCalledTimes(2);
  });

  it("skips alerts for users whose push_alerts consent is withdrawn without calling FCM or affecting other users", async () => {
    const rows = [
      claimed({ id: "a1", user_id: "u-withdrawn" }),
      claimed({ id: "a2", user_id: "u-allowed" }),
    ];
    const { deps, finished } = harness(rows, async () => undefined);
    deps.withdrawnPushConsent.mockResolvedValue(new Set(["u-withdrawn"]));
    expect(await drainAlertPushes(deps)).toEqual({
      pushed: 1,
      pushFailed: 0,
      noDevice: 0,
      consentWithdrawn: 1,
      claimsLost: 0,
    });
    expect(finished).toEqual([
      ["a1", "skipped"],
      ["a2", "sent"],
    ]);
    expect(deps.devices).toHaveBeenCalledWith(["u-allowed"]);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(rows[1]);
  });

  it("fails closed without sending any FCM push if consent lookup errors", async () => {
    const rows = [claimed({ id: "a1", user_id: "u1" })];
    const { deps } = harness(rows, async () => undefined);
    deps.withdrawnPushConsent.mockRejectedValue(
      new Error("privacy_consents unavailable"),
    );
    await expect(drainAlertPushes(deps)).rejects.toThrow(
      "privacy_consents unavailable",
    );
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.finish).not.toHaveBeenCalled();
  });
});
