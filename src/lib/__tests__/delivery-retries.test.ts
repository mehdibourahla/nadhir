import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { from, rpc, fcmSend, sendTelegram } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  fcmSend: vi.fn(
    async (_message: { topic?: string; condition?: string }) => {},
  ),
  sendTelegram: vi.fn(async (_chat: string, _html: string) => {}),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from, rpc },
}));
vi.mock("@/lib/ingest/fcm.server", () => ({
  fcmConfigured: () => true,
  fcmSend,
}));
vi.mock("@/lib/ingest/telegram.server", () => ({
  telegramConfigured: () => true,
  sendTelegram,
}));

import { deliverBroadcasts } from "@/lib/ingest/delivery.server";

const target = (message: { topic?: string; condition?: string }) =>
  message.topic ?? message.condition;
const either = (...codes: string[]) =>
  codes.map((c) => `'v1.commune.${c}.fr' in topics`).join(" || ");

function store(codes = ["1501", "1601", "1701"]) {
  const broadcast: Record<string, unknown> = {
    id: "b1",
    lease_token: "lease1",
    kind: "official",
    severity: "Severe",
    commune_codes: codes,
    push_codes: codes,
    cluster_id: null,
    cap_alert_id: "cap1",
    onm_vigilance_id: null,
    authority_warning_id: null,
    fcm_delivered_at: null,
    telegram_delivered_at: null,
  };
  const receipts: Record<string, unknown>[] = [];
  const state = {
    receiptReadError: false,
    receiptWriteError: false,
    completionError: false,
    renewalAllowed: true,
    fcmRenewalAllowed: true,
    contextError: false,
  };
  const dueAt = new Map<unknown, number>();
  rpc.mockImplementation(
    async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_broadcast_delivery") {
        if ((dueAt.get(args["_channel"]) ?? 0) > Date.now())
          return { data: [], error: null };
        dueAt.set(args["_channel"], Date.now() + 90_000);
        return {
          data: broadcast[`${args["_channel"]}_delivered_at`]
            ? []
            : [{ job: broadcast }],
          error: null,
        };
      }
      if (name === "renew_broadcast_delivery")
        return {
          data:
            state.renewalAllowed &&
            (args["_channel"] !== "fcm" || state.fcmRenewalAllowed),
          error: null,
        };
      if (name === "finish_broadcast_delivery") {
        if (state.completionError)
          return { data: null, error: { message: "database unavailable" } };
        if (args["_count"] !== null) {
          broadcast[`${args["_channel"]}_delivered_at`] = "completed";
          broadcast[
            args["_channel"] === "fcm" ? "fcm_topics" : "telegram_channels"
          ] = args["_count"];
        }
        dueAt.set(
          args["_channel"],
          Date.now() + (args["_error"] === "budget_exhausted" ? 0 : 30_000),
        );
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  );
  const data: Record<string, unknown> = {
    broadcast_settings: { enabled: true },
    broadcast_delivery_receipts: receipts,
    cap_alerts: [
      {
        id: "cap1",
        info: [
          {
            language: "fr-DZ",
            headline: "Protection Civile",
            description: "Feu signalé",
            parameter: [{ valueName: "source_key", value: "dgpc_telegram" }],
          },
        ],
      },
    ],
    telegram_channels: [15, 16, 17].map((n) => ({
      wilaya_id: `w${n}`,
      chat_id: `chat${n}`,
    })),
    admin_units: [15, 16, 17].map((n) => ({
      code: `${n}01`,
      parent_id: `w${n}`,
    })),
  };
  from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {};
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let receipt: Record<string, unknown> | undefined;
    for (const method of ["select", "order", "in", "range"])
      q[method] = () => q;
    q["eq"] = (key: string, value: unknown) => {
      if (table === "broadcast_delivery_receipts")
        filters.push((row) => row[key] === value);
      return q;
    };
    q["upsert"] = (value: Record<string, unknown>) => {
      receipt = value;
      return q;
    };
    q["single"] = async () => ({ data: data[table], error: null });
    q["then"] = (resolve: (v: unknown) => unknown) => {
      if (
        (table === "broadcast_delivery_receipts" &&
          (receipt ? state.receiptWriteError : state.receiptReadError)) ||
        (table === "cap_alerts" && state.contextError)
      )
        return Promise.resolve({
          data: null,
          error: { message: "database unavailable" },
        }).then(resolve);
      if (receipt) receipts.push(receipt);
      const rows = ((data[table] ?? []) as Record<string, unknown>[]).filter(
        (row) => filters.every((f) => f(row)),
      );
      return Promise.resolve({
        data: receipt ? null : rows,
        error: null,
      }).then(resolve);
    };
    return q;
  });
  return { broadcast, receipts, state };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  from.mockReset();
  rpc.mockReset();
  fcmSend.mockReset();
  sendTelegram.mockReset();
});
afterEach(() => vi.useRealTimers());

it("retries only the failed Telegram chat and still attempts later chats", async () => {
  const { broadcast } = store();
  sendTelegram.mockImplementation(async (chat) => {
    if (chat === "chat16") throw new Error("rejected");
  });
  await expect(deliverBroadcasts()).rejects.toThrow("rejected");
  expect(sendTelegram.mock.calls.map((c) => c[0])).toEqual([
    "chat15",
    "chat16",
    "chat17",
  ]);
  expect(broadcast["telegram_delivered_at"]).toBeNull();
  expect(broadcast["fcm_delivered_at"]).not.toBeNull();
  sendTelegram.mockClear().mockResolvedValue(undefined);
  fcmSend.mockClear();
  vi.advanceTimersByTime(31_000);
  await deliverBroadcasts();
  expect(sendTelegram.mock.calls.map((c) => c[0])).toEqual(["chat16"]);
  expect(fcmSend).not.toHaveBeenCalled();
  expect(broadcast["telegram_channels"]).toBe(3);
  sendTelegram.mockClear();
  vi.advanceTimersByTime(31_000);
  await deliverBroadcasts();
  expect(sendTelegram).not.toHaveBeenCalled();
});

it("retries only the failed FCM message without blocking Telegram", async () => {
  const codes = ["1501", "1601", "1701", "1801", "1901", "2001", "2101"];
  const { broadcast } = store(codes);
  fcmSend.mockImplementation(async (message) => {
    if (target(message)?.includes("2001")) throw new Error("FCM rejected");
  });
  await expect(deliverBroadcasts()).rejects.toThrow("FCM rejected");
  expect(fcmSend.mock.calls.map((c) => target(c[0]))).toEqual([
    either("1501", "1601", "1701", "1801", "1901"),
    either("2001", "2101"),
  ]);
  expect(broadcast["telegram_delivered_at"]).not.toBeNull();
  fcmSend.mockClear().mockResolvedValue(undefined);
  sendTelegram.mockClear();
  vi.advanceTimersByTime(91_000);
  await deliverBroadcasts();
  expect(fcmSend.mock.calls.map((c) => target(c[0]))).toEqual([
    either("2001", "2101"),
  ]);
  expect(sendTelegram).not.toHaveBeenCalled();
  expect(broadcast["fcm_topics"]).toBe(7);
});

it("never repacks a topic a per-topic receipt already covers", async () => {
  const codes = ["1501", "1601", "1701", "1801", "1901", "2001", "2101"];
  const { receipts, broadcast } = store(codes);
  for (const code of ["1501", "1601", "1701"])
    receipts.push({
      broadcast_id: "b1",
      channel: "fcm",
      destination: `v1.commune.${code}.fr`,
    });
  await deliverBroadcasts();
  expect(fcmSend.mock.calls.map((c) => target(c[0]))).toEqual([
    either("1801", "1901", "2001", "2101"),
  ]);
  expect(broadcast["fcm_topics"]).toBe(7);
});

it("does not resend acknowledged destinations when the broadcast completion write fails", async () => {
  const { state, broadcast } = store();
  state.completionError = true;
  await expect(deliverBroadcasts()).rejects.toThrow("database unavailable");
  state.completionError = false;
  fcmSend.mockClear();
  sendTelegram.mockClear();
  vi.advanceTimersByTime(91_000);
  await deliverBroadcasts();
  expect(fcmSend).not.toHaveBeenCalled();
  expect(sendTelegram).not.toHaveBeenCalled();
  expect(broadcast["fcm_delivered_at"]).not.toBeNull();
  expect(broadcast["telegram_delivered_at"]).not.toBeNull();
});

it("resumes a broadcast larger than the FCM budget after its saved successes", async () => {
  const codes = Array.from({ length: 2501 }, (_, i) => String(i + 1000));
  const { broadcast } = store(codes);
  await deliverBroadcasts();
  expect(fcmSend).toHaveBeenCalledTimes(500);
  expect(broadcast["fcm_delivered_at"]).toBeNull();
  expect(rpc).toHaveBeenCalledWith("finish_broadcast_delivery", {
    _broadcast_id: "b1",
    _channel: "fcm",
    _lease_token: "lease1",
    _count: null,
    _error: "budget_exhausted",
  });
  fcmSend.mockClear();
  await deliverBroadcasts();
  expect(fcmSend.mock.calls.map((c) => target(c[0]))).toEqual([
    "v1.commune.3500.fr",
  ]);
  expect(broadcast["fcm_topics"]).toBe(2501);
  expect(broadcast["fcm_delivered_at"]).not.toBeNull();
});

it("does not send after its delivery lease cannot be renewed", async () => {
  const { state } = store();
  state.renewalAllowed = false;
  await expect(deliverBroadcasts()).rejects.toThrow("lease");
  expect(fcmSend).not.toHaveBeenCalled();
  expect(sendTelegram).not.toHaveBeenCalled();
});

it("rechecks the lease before every provider send", async () => {
  const { state } = store(["1501", "1601", "1701", "1801", "1901", "2001"]);
  fcmSend.mockImplementation(async () => {
    state.fcmRenewalAllowed = false;
  });
  await expect(deliverBroadcasts()).rejects.toThrow("lease");
  expect(fcmSend).toHaveBeenCalledTimes(1);
  expect(sendTelegram).toHaveBeenCalledTimes(3);
});

it("delivers Telegram while FCM is still waiting for its provider", async () => {
  store();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  fcmSend.mockImplementation(() => waiting);
  const delivery = deliverBroadcasts();
  try {
    await vi.waitFor(() => expect(sendTelegram).toHaveBeenCalledTimes(3), {
      timeout: 100,
    });
  } finally {
    release();
    await delivery;
  }
});

it("fails visibly and releases claimed work when context queries fail", async () => {
  const { state } = store();
  state.contextError = true;
  await expect(deliverBroadcasts()).rejects.toThrow("database unavailable");
  expect(fcmSend).not.toHaveBeenCalled();
  expect(sendTelegram).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith(
    "finish_broadcast_delivery",
    expect.objectContaining({
      _channel: "fcm",
      _count: null,
      _error: "database unavailable",
    }),
  );
});

it("sends nothing when receipt history cannot be read", async () => {
  const { state } = store();
  state.receiptReadError = true;
  await expect(deliverBroadcasts()).rejects.toThrow("database unavailable");
  expect(fcmSend).not.toHaveBeenCalled();
  expect(sendTelegram).not.toHaveBeenCalled();
});

it("caps failed FCM send attempts too and preserves their retry error", async () => {
  store(Array.from({ length: 2501 }, (_, i) => String(i + 1000)));
  fcmSend.mockRejectedValue(new Error("provider unavailable"));
  await expect(deliverBroadcasts()).rejects.toThrow("provider unavailable");
  expect(fcmSend).toHaveBeenCalledTimes(500);
  expect(rpc).toHaveBeenCalledWith(
    "finish_broadcast_delivery",
    expect.objectContaining({
      _channel: "fcm",
      _count: null,
      _error: "provider unavailable",
    }),
  );
});

it("claims at most twenty broadcasts per channel one at a time", async () => {
  const { broadcast } = store([]);
  const claimed = { fcm: 0, telegram: 0 };
  rpc.mockImplementation(
    async (
      name: string,
      args: { _channel: "fcm" | "telegram"; _limit?: number },
    ) => {
      if (name !== "claim_broadcast_delivery")
        return { data: true, error: null };
      expect(args._limit).toBe(1);
      claimed[args._channel] += 1;
      return {
        data: [{ job: { ...broadcast, id: `b${claimed[args._channel]}` } }],
        error: null,
      };
    },
  );
  const result = await deliverBroadcasts();
  expect(claimed).toEqual({ fcm: 20, telegram: 20 });
  expect(result.rows).toBe(20);
  expect(result.telegramRows).toBe(20);
  expect(from).not.toHaveBeenCalledWith("broadcasts");
});

it("continues Telegram when the FCM queue cannot be claimed", async () => {
  store();
  const normal = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (name, args) =>
    name === "claim_broadcast_delivery" && args._channel === "fcm"
      ? { data: null, error: { message: "fcm queue unavailable" } }
      : normal(name, args),
  );
  await expect(deliverBroadcasts()).rejects.toThrow("fcm queue unavailable");
  expect(fcmSend).not.toHaveBeenCalled();
  expect(sendTelegram).toHaveBeenCalledTimes(3);
});

it("stops sending destinations when an acknowledged send cannot be persisted", async () => {
  const { state, broadcast } = store();
  state.receiptWriteError = true;
  await expect(deliverBroadcasts()).rejects.toThrow("database unavailable");
  expect(fcmSend).toHaveBeenCalledTimes(1);
  expect(broadcast["fcm_delivered_at"]).toBeNull();
});
