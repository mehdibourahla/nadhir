import { afterEach, beforeEach, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getToken: vi.fn(),
  subscribeToTopic: vi.fn(),
  unsubscribeFromTopic: vi.fn(),
  addListener: vi.fn(),
  createChannel: vi.fn(),
}));
const platform = vi.hoisted(() => ({ name: "ios" }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => platform.name },
}));
const follow = vi.hoisted(() => ({ status: vi.fn(), setPinned: vi.fn() }));
vi.mock("@/lib/current-commune", () => ({ CurrentCommune: follow }));
const local = vi.hoisted(() => ({ addListener: vi.fn(), schedule: vi.fn() }));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: local,
}));
vi.mock("@capacitor-firebase/messaging", () => ({
  FirebaseMessaging: plugin,
}));
const session = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: session },
}));

import {
  appLink,
  nativeTransport,
  notificationId,
  startNativePush,
} from "@/lib/push-native";
import {
  setUserPush,
  subscribeToCommunes,
  syncSubscription,
  unsubscribeAll,
  type PushTransport,
} from "@/lib/push";

const store = new Map<string, string>();

beforeEach(() => {
  vi.resetAllMocks();
  platform.name = "ios";
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ok: true })),
  );
});

afterEach(() => vi.unstubAllGlobals());

function fakeTransport(): PushTransport & {
  joined: string[][];
  left: string[][];
  settledWith: [string[], string][];
} {
  const joined: string[][] = [];
  const left: string[][] = [];
  const settledWith: [string[], string][] = [];
  return {
    joined,
    left,
    settledWith,
    settled: async (communes, lang) => void settledWith.push([communes, lang]),
    permission: async () => "granted",
    request: async () => true,
    token: async () => "native-token",
    topics: async (communes, lang, join) =>
      void (join ? joined : left).push(communes.map((c) => `${c}.${lang}`)),
  };
}

it("joins and leaves commune topics through the device SDK", async () => {
  await nativeTransport.topics(["1503", "1510"], "ar", true);
  expect(plugin.subscribeToTopic.mock.calls).toEqual([
    [{ topic: "v1.commune.1503.ar" }],
    [{ topic: "v1.commune.1510.ar" }],
  ]);
  await nativeTransport.topics(["1503"], "fr", false);
  expect(plugin.unsubscribeFromTopic).toHaveBeenCalledWith({
    topic: "v1.commune.1503.fr",
  });
});

it("maps the plugin permission states", async () => {
  plugin.checkPermissions.mockResolvedValue({
    receive: "prompt-with-rationale",
  });
  expect(await nativeTransport.permission()).toBe("prompt");
  plugin.checkPermissions.mockResolvedValue({ receive: "denied" });
  expect(await nativeTransport.permission()).toBe("denied");
});

it("changing communes joins the new ones and leaves the stale language, without the server", async () => {
  const transport = fakeTransport();
  store.set(
    "nadhir.push.v1",
    JSON.stringify({ communes: ["1503"], lang: "fr" }),
  );
  await subscribeToCommunes(["1503", "1510"], "ar", transport);
  expect(transport.joined).toEqual([["1503.ar", "1510.ar"]]);
  expect(transport.left).toEqual([["1503.fr"]]);
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.parse(store.get("nadhir.push.v1")!)).toEqual({
    communes: ["1503", "1510"],
    lang: "ar",
  });
});

it("registers the device token on the signed-in user's topic through the server", async () => {
  session.getSession.mockResolvedValue({
    data: { session: { access_token: "jwt" } },
    error: null,
  });
  await setUserPush(true, fakeTransport());
  const [url, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(String(url)).toContain("/api/private/user-push");
  expect(JSON.parse(String(init!.body))).toEqual({
    token: "native-token",
    action: "subscribe",
  });
  expect(store.get("nadhir.userpush.v1")).toBe("on");
});

it("follows only same-app paths from a notification", () => {
  expect(appLink({ link: "/fire/DZ1" })).toBe("/fire/DZ1");
  expect(appLink({ link: "/forecast?commune=1503" })).toBe(
    "/forecast?commune=1503",
  );
  expect(appLink({ link: "https://evil.example" })).toBeNull();
  expect(appLink({ link: "//evil.example" })).toBeNull();
  expect(appLink({ link: "/\\evil.example" })).toBeNull();
  expect(appLink({ link: 3 })).toBeNull();
  expect(appLink(undefined)).toBeNull();
});

it("registers notification listeners once however often it starts", async () => {
  const options = { channelName: "x", navigate: vi.fn(), onToken: vi.fn() };
  await startNativePush(options);
  await startNativePush({ ...options, channelName: "y" });
  const events = plugin.addListener.mock.calls.map(([name]) => name);
  expect(events).toEqual([
    "notificationActionPerformed",
    "tokenReceived",
    "notificationReceived",
  ]);
  const tap = plugin.addListener.mock.calls[0]![1] as (e: unknown) => void;
  tap({ notification: { data: { link: "/fire/DZ1" } } });
  expect(options.navigate).toHaveBeenCalledExactlyOnceWith("/fire/DZ1");
});

it("registers all 6 canonical Android channels without sound, routes foreground pushes by channel, and reports test arrivals", async () => {
  vi.resetModules();
  platform.name = "android";
  const [
    { startNativePush: startFresh },
    { onTestPushArrival },
    { NOTIFICATION_CHANNELS },
  ] = await Promise.all([
    import("@/lib/push-native"),
    import("@/lib/push-test-events"),
    import("@/lib/notification-channels"),
  ]);

  const arrivals: { testId?: string | undefined; receivedAt: string }[] = [];
  const off = onTestPushArrival((ev) => arrivals.push(ev));

  await startFresh({
    channelName: "Nadhir alerts",
    translate: (key) => `tr:${key}`,
    navigate: vi.fn(),
    onToken: vi.fn(),
  });

  // All 6 channels created in canonical order, with exact importance/visibility/vibration/lights and NO `sound`
  expect(plugin.createChannel).toHaveBeenCalledTimes(
    NOTIFICATION_CHANNELS.length,
  );
  NOTIFICATION_CHANNELS.forEach((spec, idx) => {
    const call = plugin.createChannel.mock.calls[idx]![0] as Record<
      string,
      unknown
    >;
    expect(call).toEqual({
      id: spec.id,
      name: spec.id === "alerts" ? "Nadhir alerts" : `tr:${spec.i18nNameKey}`,
      description: `tr:${spec.i18nDescriptionKey}`,
      importance: spec.capacitorImportance,
      visibility: spec.visibility,
      vibration: spec.vibration,
      lights: spec.lights,
    });
    expect("sound" in call).toBe(false);
  });

  const received = plugin.addListener.mock.calls.find(
    ([name]) => name === "notificationReceived",
  )![1] as (e: unknown) => void;

  // Legacy data without channel_id/kind falls back to "alerts"
  received({
    notification: { title: "t", body: "b", data: { link: "/fire/DZ1" } },
  });
  // Tagged urgent fire pushes reuse deterministic notification ID and route to alerts_urgent
  received({
    notification: {
      title: "t2",
      body: "b2",
      tag: "fire-DZ1",
      data: { link: "/fire/DZ1", channel_id: "alerts_urgent" },
    },
  });
  received({
    notification: {
      title: "t3",
      body: "b3",
      tag: "fire-DZ1",
      data: { link: "/fire/DZ1", kind: "fire" },
    },
  });
  // Earthquake & official & civil & test channel routing
  received({
    notification: {
      title: "eq",
      body: "m4.3",
      data: { kind: "earthquake", magnitude: "4.3" },
    },
  });
  received({
    notification: {
      title: "test",
      body: "self",
      data: {
        kind: "test",
        channel_id: "alerts_test",
        test_id: "t-42",
        receipt: "sig-42",
      },
    },
  });

  const scheduled = local.schedule.mock.calls.map(
    ([arg]) => arg.notifications[0],
  );
  expect(scheduled[1].id).toBe(scheduled[2].id);
  expect(scheduled[0]).toMatchObject({
    title: "t",
    body: "b",
    channelId: "alerts",
    isExactNotification: false,
    extra: { link: "/fire/DZ1" },
  });
  expect(scheduled[1].channelId).toBe("alerts_urgent");
  expect(scheduled[2].channelId).toBe("alerts_urgent");
  expect(scheduled[3].channelId).toBe("alerts_earthquakes");
  expect(scheduled[4].channelId).toBe("alerts_test");
  expect(scheduled.every((n) => n.isExactNotification === false)).toBe(true);

  expect(arrivals).toHaveLength(1);
  expect(arrivals[0]!.testId).toBe("t-42");
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/api/public/push-receipt"),
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ test_id: "t-42", receipt: "sig-42" }),
    }),
  );
  off();
});

it("tells the location tracker which communes are now manual after every change", async () => {
  const transport = fakeTransport();
  await subscribeToCommunes(["1503"], "ar", transport);
  await unsubscribeAll(transport);
  expect(transport.settledWith).toEqual([
    [["1503"], "ar"],
    [[], "ar"],
  ]);
});

it("pins manual communes only while the tracker is on", async () => {
  follow.status.mockResolvedValue({ enabled: false });
  await nativeTransport.settled!(["1503"], "ar");
  expect(follow.setPinned).not.toHaveBeenCalled();
  follow.status.mockResolvedValue({ enabled: true });
  await nativeTransport.settled!(["1503"], "fr");
  expect(follow.setPinned).toHaveBeenCalledWith({
    pinned: ["1503"],
    lang: "fr",
  });
});

it("never lets a startup re-sync rejoin communes the user just left", async () => {
  store.set(
    "nadhir.push.v1",
    JSON.stringify({ communes: ["1503"], lang: "ar" }),
  );
  const ops: string[] = [];
  let grant!: (v: "granted") => void;
  const transport: PushTransport = {
    permission: () => new Promise((resolve) => (grant = resolve)),
    request: async () => true,
    token: async () => "native-token",
    topics: async (communes, lang, join) =>
      void ops.push(`${join ? "join" : "leave"} ${communes.join()}.${lang}`),
  };
  const sync = syncSubscription(transport);
  const leave = unsubscribeAll(transport);
  await new Promise((resolve) => setTimeout(resolve, 0));
  grant("granted");
  await Promise.all([sync, leave]);
  expect(ops).toEqual(["join 1503.ar", "leave 1503.ar"]);
  expect(store.has("nadhir.push.v1")).toBe(false);
});

it("keeps notificationId strictly within signed 32-bit int range [0, 2147483647] even on INT32_MIN hash collisions", () => {
  // "polygenelubricants" has a classic Java/31-multiplier hashCode of -2147483648 (INT32_MIN)
  const samples = [
    "polygenelubricants",
    "GydZG_",
    "DESIGNING WORKHOUSES",
    "fire-DZ1",
    "",
    "الجزائر",
  ];
  for (const key of samples) {
    const id = notificationId(key);
    expect(Number.isInteger(id), key).toBe(true);
    expect(id, key).toBeGreaterThanOrEqual(0);
    expect(id, key).toBeLessThanOrEqual(2_147_483_647);
  }
});
