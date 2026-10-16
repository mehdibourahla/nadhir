export const FCM_LANGS = ["ar", "fr", "en", "kab"] as const;
export type FcmLang = (typeof FCM_LANGS)[number];

const APP_URL = "https://nadhir.app";

export function fcmTopic(code: string, lang: string): string {
  return `v1.commune.${code}.${lang}`;
}

export function userTopic(userId: string): string {
  return `v1.user.${userId}`;
}

type NativeDelivery = {
  android: {
    priority: "high";
    notification: { channel_id: "alerts"; tag?: string };
  };
  apns: {
    headers: { "apns-priority": "10"; "apns-collapse-id"?: string };
    payload: {
      aps: { sound: "default"; "interruption-level": "time-sensitive" };
    };
  };
};

function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text))
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

// APNs rejects ids over 64 bytes, and a bare cut would let two tags collapse into one alert
function collapseId(tag: string) {
  const bytes = new TextEncoder().encode(tag);
  if (bytes.length <= 64) return tag;
  const prefix = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 55))
    .replace(/\uFFFD$/, "");
  return `${prefix}-${fnv1a(tag)}`;
}

function nativeDelivery(tag?: string): NativeDelivery {
  return {
    android: {
      priority: "high",
      notification: { channel_id: "alerts", ...(tag ? { tag } : {}) },
    },
    apns: {
      headers: {
        "apns-priority": "10",
        ...(tag ? { "apns-collapse-id": collapseId(tag) } : {}),
      },
      payload: {
        aps: { sound: "default", "interruption-level": "time-sensitive" },
      },
    },
  };
}

function appPath(link: string) {
  const url = new URL(link);
  return url.pathname + url.search;
}

export type FcmUserMessage = NativeDelivery & {
  topic: string;
  notification: { title: string; body: string };
  webpush: {
    fcm_options: { link: string };
    notification: { tag: string; renotify: boolean };
  };
  data: { alert_id: string; kind: string; receipt: string; link: string };
};

export function fcmMessageForAlert(
  alert: {
    id: string;
    user_id: string;
    kind: string;
    title: string;
    body: string;
    source_id: string | null;
    cluster_id: string | null;
    payload: unknown;
  },
  receipt: string,
): FcmUserMessage {
  const shortId =
    alert.kind === "fire" &&
    alert.payload &&
    typeof alert.payload === "object" &&
    "short_id" in alert.payload
      ? String(alert.payload.short_id)
      : null;
  const link = shortId ? `${APP_URL}/fire/${shortId}` : `${APP_URL}/alerts`;
  const tag = alert.source_id ?? alert.cluster_id ?? alert.id;
  return {
    topic: userTopic(alert.user_id),
    notification: { title: alert.title, body: alert.body },
    webpush: {
      fcm_options: { link },
      notification: { tag, renotify: true },
    },
    ...nativeDelivery(tag),
    data: {
      alert_id: alert.id,
      kind: alert.kind,
      receipt,
      link: appPath(link),
    },
  };
}

export type FcmMessage = NativeDelivery & {
  topic: string;
  notification: { title: string; body: string };
  webpush: {
    fcm_options: { link: string };
    notification?: { tag: string; renotify: boolean };
  };
  data: { broadcast_id: string; severity: string; kind: string; link: string };
};

function message(
  topic: string,
  title: string,
  body: string,
  link: string,
  data: Omit<FcmMessage["data"], "link">,
  tag?: string,
): FcmMessage {
  return {
    topic,
    notification: { title, body },
    // a later message with the same tag replaces the earlier one in the tray
    webpush: {
      fcm_options: { link },
      ...(tag ? { notification: { tag, renotify: true } } : {}),
    },
    ...nativeDelivery(tag),
    data: { ...data, link: appPath(link) },
  };
}

export function fcmMessagesForFire(args: {
  broadcastId: string;
  severity: string;
  communeCodes: string[];
  shortId: string;
  info: { language: string; headline: string; description: string }[];
}): FcmMessage[] {
  const link = `${APP_URL}/fire/${args.shortId}`;
  const data = {
    broadcast_id: args.broadcastId,
    severity: args.severity,
    kind: "fire",
  };
  const out: FcmMessage[] = [];
  for (const code of args.communeCodes)
    for (const lang of FCM_LANGS) {
      const block = args.info.find((i) => i.language.split("-")[0] === lang);
      if (!block) continue;
      out.push(
        message(
          fcmTopic(code, lang),
          block.headline,
          block.description,
          link,
          data,
          `fire-${args.shortId}`,
        ),
      );
    }
  return out;
}

export function fcmMessagesForOnm(args: {
  broadcastId: string;
  severity: string;
  communeCodes: string[];
  title: string;
  headlineFr: string | null;
  wilayaId: string | null;
  event: string;
}): FcmMessage[] {
  const data = {
    broadcast_id: args.broadcastId,
    severity: args.severity,
    kind: "onm",
  };
  // relayed verbatim: same authority text on every language topic, attributed
  const body = args.headlineFr ?? args.title;
  const out: FcmMessage[] = [];
  for (const code of args.communeCodes)
    for (const lang of FCM_LANGS)
      out.push(
        message(
          fcmTopic(code, lang),
          "ONM · Météo Algérie",
          body,
          `${APP_URL}/forecast?commune=${encodeURIComponent(code)}`,
          data,
          args.wilayaId ? `onm-${args.wilayaId}-${args.event}` : undefined,
        ),
      );
  return out;
}

export function fcmMessagesForAuthority(args: {
  broadcastId: string;
  severity: string;
  communeCodes: string[];
  source: string;
  body: string;
}): FcmMessage[] {
  const data = {
    broadcast_id: args.broadcastId,
    severity: args.severity,
    kind: "authority",
  };
  const out: FcmMessage[] = [];
  for (const code of args.communeCodes)
    for (const lang of FCM_LANGS)
      out.push(
        message(fcmTopic(code, lang), args.source, args.body, APP_URL, data),
      );
  return out;
}

export function fcmMessagesForOfficial(args: {
  broadcastId: string;
  severity: string;
  communeCodes: string[];
  info: { language: string; headline: string; description: string }[];
}): FcmMessage[] {
  const data = {
    broadcast_id: args.broadcastId,
    severity: args.severity,
    kind: "official",
  };
  const out: FcmMessage[] = [];
  for (const code of args.communeCodes)
    for (const lang of FCM_LANGS) {
      const block = args.info.find((i) => i.language.split("-")[0] === lang);
      if (!block) continue;
      out.push(
        message(
          fcmTopic(code, lang),
          block.headline,
          block.description,
          APP_URL,
          data,
        ),
      );
    }
  return out;
}

// FCM evaluates at most five topics in one condition
const CONDITION_TOPICS = 5;

export type FcmTarget = Omit<FcmMessage, "topic"> &
  ({ topic: string } | { condition: string });

// sends, not topics, bound a delivery run, so identical payloads share one
export function packTopics(
  messages: FcmMessage[],
): { key: string; message: FcmTarget }[] {
  const groups = new Map<
    string,
    { rest: Omit<FcmMessage, "topic">; topics: string[] }
  >();
  for (const { topic, ...rest } of messages) {
    const shape = JSON.stringify(rest);
    const group = groups.get(shape);
    if (group) group.topics.push(topic);
    else groups.set(shape, { rest, topics: [topic] });
  }
  const out: { key: string; message: FcmTarget }[] = [];
  for (const { rest, topics } of groups.values())
    for (let i = 0; i < topics.length; i += CONDITION_TOPICS) {
      const chunk = topics.slice(i, i + CONDITION_TOPICS);
      if (chunk.length === 1) {
        out.push({ key: chunk[0]!, message: { ...rest, topic: chunk[0]! } });
        continue;
      }
      const condition = chunk.map((t) => `'${t}' in topics`).join(" || ");
      out.push({ key: condition, message: { ...rest, condition } });
    }
  return out;
}
