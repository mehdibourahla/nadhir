import { Capacitor } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";

import { CurrentCommune } from "@/lib/current-commune";
import { fcmTopic } from "@/lib/fcm";
import {
  DEFAULT_LOCAL_NOTIFICATION_EXACT,
  LEGACY_NOTIFICATION_CHANNEL_ID,
  NOTIFICATION_CHANNELS,
  channelFromFcmData,
  type NotificationChannelId,
  type NotificationChannelSpec,
} from "@/lib/notification-channels";
import { apiUrl } from "@/lib/platform";
import type { PushTransport } from "@/lib/push";
import { emitTestPushArrival } from "@/lib/push-test-events";

export const nativeTransport: PushTransport = {
  async permission() {
    const { receive } = await FirebaseMessaging.checkPermissions();
    return receive === "granted" || receive === "denied" ? receive : "prompt";
  },
  async request() {
    const { receive } = await FirebaseMessaging.requestPermissions();
    return receive === "granted";
  },
  async token() {
    const { token } = await FirebaseMessaging.getToken();
    if (!token) throw new Error("no registration token");
    return token;
  },
  async topics(communes, lang, join) {
    for (const code of communes) {
      const topic = fcmTopic(code, lang);
      if (join) await FirebaseMessaging.subscribeToTopic({ topic });
      else await FirebaseMessaging.unsubscribeFromTopic({ topic });
    }
  },
  async settled(communes, lang) {
    if ((await CurrentCommune.status()).enabled)
      await CurrentCommune.setPinned({ pinned: communes, lang });
  },
};

export function appLink(data: unknown): string | null {
  const link =
    data && typeof data === "object" && "link" in data ? data.link : null;
  return typeof link === "string" &&
    link.startsWith("/") &&
    !link.startsWith("//") &&
    !link.startsWith("/\\")
    ? link
    : null;
}

const CHANNEL_FALLBACK_TEXT: Record<
  NotificationChannelId,
  { name: string; description: string }
> = {
  alerts_urgent: {
    name: "Urgent safety alerts",
    description:
      "Extreme ONM warnings, active civil protection incidents, M5+ earthquakes and probable fires.",
  },
  alerts_official: {
    name: "Official bulletins",
    description:
      "Severe ONM weather warnings and official flood, storm or road updates.",
  },
  alerts_earthquakes: {
    name: "Earthquakes",
    description:
      "M4.0 to M4.9 earthquakes recorded near your followed communes.",
  },
  alerts_civil: {
    name: "Civil updates and digests",
    description:
      "General civil updates, road notices and alert lifecycle summaries.",
  },
  alerts_test: {
    name: "Notification tests",
    description:
      "Self-test notifications you trigger to verify delivery on this device.",
  },
  alerts: {
    name: "Nadhir alerts",
    description:
      "Legacy fallback channel kept for compatibility with earlier app versions.",
  },
};

type NativePushOptions = {
  channelName: string;
  translate?: (key: string) => string;
  navigate: (path: string) => void;
  onToken: () => void;
};

let current: NativePushOptions | null = null;
let listening: Promise<void> | null = null;

function notificationId(key: string) {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function handleTestPushData(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  const record = data as Record<string, unknown>;
  if (record["kind"] !== "test") return;
  const testId =
    typeof record["test_id"] === "string" ? record["test_id"] : undefined;
  const receipt =
    typeof record["receipt"] === "string" ? record["receipt"] : undefined;
  emitTestPushArrival({
    testId,
    receivedAt: new Date().toISOString(),
  });
  if (testId && receipt) {
    void fetch(apiUrl("/api/public/push-receipt"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ test_id: testId, receipt }),
    }).catch(() => undefined);
  }
}

function open(data: unknown) {
  handleTestPushData(data);
  const link = appLink(data);
  if (link) current?.navigate(link);
}

function resolveChannelText(
  spec: NotificationChannelSpec,
  options: NativePushOptions,
): { name: string; description: string } {
  const fallback = CHANNEL_FALLBACK_TEXT[spec.id];
  const translate = options.translate;
  const translateWithFallback = (key: string, defaultText: string) => {
    if (!translate) return defaultText;
    const translated = translate(key);
    return typeof translated === "string" &&
      translated.trim().length > 0 &&
      translated !== key
      ? translated
      : defaultText;
  };
  const name =
    spec.id === LEGACY_NOTIFICATION_CHANNEL_ID && options.channelName.trim()
      ? options.channelName
      : translateWithFallback(spec.i18nNameKey, fallback.name);
  const description = translateWithFallback(
    spec.i18nDescriptionKey,
    fallback.description,
  );
  return { name, description };
}

type Handle = { remove(): Promise<void> };

async function listen() {
  const handles: Handle[] = [];
  try {
    await registerListeners(handles);
  } catch (error) {
    // a retry must not stack a second tap handler on top of one that did register
    await Promise.all(handles.map((handle) => handle.remove()));
    throw error;
  }
}

async function registerListeners(handles: Handle[]) {
  handles.push(
    await FirebaseMessaging.addListener(
      "notificationActionPerformed",
      (event) => open(event.notification.data),
    ),
  );
  handles.push(
    await FirebaseMessaging.addListener("tokenReceived", () =>
      current?.onToken(),
    ),
  );
  const isAndroid = Capacitor.getPlatform() === "android";
  const localNotifications = isAndroid
    ? (await import("@capacitor/local-notifications")).LocalNotifications
    : null;
  if (localNotifications) {
    handles.push(
      await localNotifications.addListener(
        "localNotificationActionPerformed",
        (event) => open(event.notification.extra),
      ),
    );
  }
  // Foreground pushes emit test-arrival events on both platforms and re-post locally on Android
  handles.push(
    await FirebaseMessaging.addListener("notificationReceived", (event) => {
      const { notification } = event;
      handleTestPushData(notification.data);
      if (!localNotifications) return;
      void localNotifications.schedule({
        notifications: [
          {
            id: notificationId(
              notification.tag ?? notification.id ?? String(Date.now()),
            ),
            title: notification.title ?? "",
            body: notification.body ?? "",
            channelId: channelFromFcmData(notification.data),
            smallIcon: "ic_stat_nadhir",
            // the exact default opens the "Alarms & reminders" settings screen instead of notifying
            isExactNotification: DEFAULT_LOCAL_NOTIFICATION_EXACT,
            extra: notification.data,
          },
        ],
      });
    }),
  );
}

export async function startNativePush(options: NativePushOptions) {
  current = options;
  listening ??= listen().catch((error: unknown) => {
    listening = null;
    throw error;
  });
  await listening;
  if (Capacitor.getPlatform() !== "android") return;
  for (const spec of NOTIFICATION_CHANNELS) {
    const { name, description } = resolveChannelText(spec, options);
    // CRITICAL: omit `sound` so @capacitor-firebase/messaging preserves Android's
    // default notification sound instead of looking up a non-existent raw/default resource
    await FirebaseMessaging.createChannel({
      id: spec.id,
      name,
      description,
      importance: spec.capacitorImportance,
      visibility: spec.visibility,
      vibration: spec.vibration,
      lights: spec.lights,
    });
  }
}
