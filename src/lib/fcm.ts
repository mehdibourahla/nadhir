import {
  parseProvenancePayload,
  provenanceForBroadcast,
  provenanceForSelfTest,
  provenanceForWatchZoneAlert,
  toProvenancePayload,
} from "@/lib/alert-provenance";
import {
  LEGACY_NOTIFICATION_CHANNEL_ID,
  channelSpec,
  resolveNotificationChannel,
  type NotificationChannelId,
} from "@/lib/notification-channels";

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
    priority: "high" | "normal";
    notification: { channel_id: NotificationChannelId; tag?: string };
  };
  apns: {
    headers: { "apns-priority": "10" | "5"; "apns-collapse-id"?: string };
    payload: {
      aps: {
        sound: "default";
        "interruption-level": "time-sensitive" | "active";
      };
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

function nativeDelivery(
  channelId: NotificationChannelId,
  tag?: string,
): NativeDelivery {
  const spec =
    channelSpec(channelId) ?? channelSpec(LEGACY_NOTIFICATION_CHANNEL_ID);
  const apnsPriority: "10" | "5" = spec.androidPriority === "high" ? "10" : "5";
  return {
    android: {
      priority: spec.androidPriority,
      notification: { channel_id: spec.id, ...(tag ? { tag } : {}) },
    },
    apns: {
      headers: {
        "apns-priority": apnsPriority,
        ...(tag ? { "apns-collapse-id": collapseId(tag) } : {}),
      },
      payload: {
        aps: {
          sound: spec.sound,
          "interruption-level": spec.apnsInterruptionLevel,
        },
      },
    },
  };
}

function appPath(link: string) {
  const url = new URL(link);
  return url.pathname + url.search;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!record || !Object.hasOwn(record, key)) return null;
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(
  record: Record<string, unknown> | null,
  key: string,
): number | null {
  if (!record || !Object.hasOwn(record, key)) return null;
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type FcmUserMessage = NativeDelivery & {
  topic: string;
  notification: { title: string; body: string };
  webpush: {
    fcm_options: { link: string };
    notification: { tag: string; renotify: boolean };
  };
  data: Record<string, string> & {
    alert_id: string;
    kind: string;
    channel_id: NotificationChannelId;
    receipt: string;
    link: string;
  };
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
    severity?: number | string | null;
    zone_id?: string | null;
    source_table?: string | null;
    created_at?: string | null;
  },
  receipt: string,
): FcmUserMessage {
  const payload = asRecord(alert.payload);
  const shortId =
    alert.kind === "fire" && payload && "short_id" in payload
      ? String(payload["short_id"])
      : null;
  const link = shortId ? `${APP_URL}/fire/${shortId}` : `${APP_URL}/alerts`;
  const tag = alert.source_id ?? alert.cluster_id ?? alert.id;

  const authoritySource = readString(payload, "authority");
  const effectiveKind =
    alert.source_table === "authority_warnings" || authoritySource !== null
      ? "authority"
      : alert.kind;
  const severity =
    readString(payload, "onm_severity") ?? alert.severity ?? null;
  const hazard = readString(payload, "hazard");
  const magnitude = readNumber(payload, "magnitude");
  const phase = readString(payload, "phase");
  const status = readString(payload, "status");

  const channelId = resolveNotificationChannel({
    kind: effectiveKind,
    severity,
    hazard,
    magnitude,
    phase,
    status,
  });

  const observedAt =
    readString(payload, "occurred_at") ??
    readString(payload, "last_detected_at") ??
    alert.created_at ??
    new Date().toISOString();
  const provenance =
    parseProvenancePayload(alert.payload) ??
    provenanceForWatchZoneAlert({
      kind: alert.kind,
      sourceTable: alert.source_table,
      severity,
      hazard,
      phase,
      magnitude,
      sourceAttribution: authoritySource,
      areaLabel: null,
      observedAt,
    });

  return {
    topic: userTopic(alert.user_id),
    notification: { title: alert.title, body: alert.body },
    webpush: {
      fcm_options: { link },
      notification: { tag, renotify: true },
    },
    ...nativeDelivery(channelId, tag),
    data: {
      ...toProvenancePayload(provenance),
      alert_id: alert.id,
      kind: alert.kind,
      channel_id: channelId,
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
  data: Record<string, string> & {
    broadcast_id: string;
    severity: string;
    kind: string;
    channel_id: NotificationChannelId;
    link: string;
  };
};

function message(
  topic: string,
  title: string,
  body: string,
  link: string,
  channelId: NotificationChannelId,
  data: Record<string, string> & {
    broadcast_id: string;
    severity: string;
    kind: string;
  },
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
    ...nativeDelivery(channelId, tag),
    data: { ...data, channel_id: channelId, link: appPath(link) },
  };
}

export function fcmMessagesForFire(args: {
  broadcastId: string;
  severity: string;
  communeCodes: string[];
  shortId: string;
  info: { language: string; headline: string; description: string }[];
  phase?: string | null;
  observedAt?: string | null;
  areaLabel?: string | null;
  confirmed?: boolean;
  sourceKey?: string | null;
  sourceAttribution?: string | null;
}): FcmMessage[] {
  const link = `${APP_URL}/fire/${args.shortId}`;
  const channelId = resolveNotificationChannel({
    kind: "fire",
    severity: args.severity,
    phase: args.phase,
  });
  const provenance = provenanceForBroadcast({
    kind: "fire",
    severity: args.severity,
    confirmed: args.confirmed,
    sourceKey: args.sourceKey,
    sourceAttribution: args.sourceAttribution,
    areaLabel: args.areaLabel,
    observedAt: args.observedAt ?? new Date().toISOString(),
  });
  const data = {
    ...toProvenancePayload(provenance),
    broadcast_id: args.broadcastId,
    severity: args.severity,
    kind: "fire",
    ...(args.phase ? { phase: args.phase } : {}),
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
          channelId,
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
  phase?: string | null;
  observedAt?: string | null;
  areaLabel?: string | null;
}): FcmMessage[] {
  const channelId = resolveNotificationChannel({
    kind: "onm",
    severity: args.severity,
    phase: args.phase,
  });
  const provenance = provenanceForBroadcast({
    kind: "onm",
    severity: args.severity,
    sourceKey: "onm",
    sourceAttribution: "ONM · Météo Algérie",
    areaLabel: args.areaLabel,
    observedAt: args.observedAt ?? new Date().toISOString(),
  });
  const data = {
    ...toProvenancePayload(provenance),
    broadcast_id: args.broadcastId,
    severity: args.severity,
    kind: "onm",
    ...(args.phase ? { phase: args.phase } : {}),
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
          channelId,
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
  observedAt?: string | null;
  areaLabel?: string | null;
}): FcmMessage[] {
  const channelId = resolveNotificationChannel({
    kind: "authority",
    severity: args.severity,
  });
  const provenance = provenanceForBroadcast({
    kind: "authority",
    severity: args.severity,
    sourceKey: "authority",
    sourceAttribution: args.source,
    areaLabel: args.areaLabel,
    observedAt: args.observedAt ?? new Date().toISOString(),
  });
  const data = {
    ...toProvenancePayload(provenance),
    broadcast_id: args.broadcastId,
    severity: args.severity,
    kind: "authority",
  };
  const out: FcmMessage[] = [];
  for (const code of args.communeCodes)
    for (const lang of FCM_LANGS)
      out.push(
        message(
          fcmTopic(code, lang),
          args.source,
          args.body,
          APP_URL,
          channelId,
          data,
        ),
      );
  return out;
}

export function fcmMessagesForOfficial(args: {
  broadcastId: string;
  severity: string;
  communeCodes: string[];
  info: { language: string; headline: string; description: string }[];
  incidentId?: string | null;
  phase?: string | null;
  hazard?: string | null;
  status?: string | null;
  sourceKey?: string | null;
  sourceAttribution?: string | null;
  observedAt?: string | null;
  areaLabel?: string | null;
}): FcmMessage[] {
  const channelId = resolveNotificationChannel({
    kind: "official",
    severity: args.severity,
    hazard: args.hazard,
    phase: args.phase,
    status: args.status,
  });
  const provenance = provenanceForBroadcast({
    kind: "official",
    severity: args.severity,
    hazard: args.hazard,
    sourceKey: args.sourceKey,
    sourceAttribution: args.sourceAttribution,
    areaLabel: args.areaLabel,
    observedAt: args.observedAt ?? new Date().toISOString(),
  });
  const data: Record<string, string> & {
    broadcast_id: string;
    severity: string;
    kind: string;
  } = {
    ...toProvenancePayload(provenance),
    broadcast_id: args.broadcastId,
    severity: args.severity,
    kind: "official",
    ...(args.hazard ? { hazard: args.hazard } : {}),
    ...(args.phase ? { phase: args.phase } : {}),
    ...(args.status ? { status: args.status } : {}),
    ...(args.sourceKey ? { source_key: args.sourceKey } : {}),
    ...(args.sourceAttribution
      ? { source_attribution: args.sourceAttribution }
      : {}),
    ...(args.observedAt ? { observed_at: args.observedAt } : {}),
    ...(args.areaLabel ? { area_label: args.areaLabel } : {}),
  };
  const link = args.incidentId
    ? `${APP_URL}/?event=${encodeURIComponent(`official:${args.incidentId}`)}`
    : APP_URL;
  const tag = args.incidentId ? `official-${args.incidentId}` : undefined;
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
          channelId,
          data,
          tag,
        ),
      );
    }
  return out;
}

export function fcmMessagesForEarthquake(args: {
  broadcastId: string;
  severity: string;
  communeCodes: string[];
  earthquakeId: string;
  magnitude: number;
  info: { language: string; headline: string; description: string }[];
  sourceKey?: string | null;
  sourceAttribution?: string | null;
  observedAt?: string | null;
  areaLabel?: string | null;
}): FcmMessage[] {
  const link = `${APP_URL}/?event=${encodeURIComponent(`quake:${args.earthquakeId}`)}`;
  const channelId = resolveNotificationChannel({
    kind: "earthquake",
    severity: args.severity,
    magnitude: args.magnitude,
  });
  const provenance = provenanceForBroadcast({
    kind: "earthquake",
    severity: args.severity,
    magnitude: args.magnitude,
    sourceKey: args.sourceKey ?? "emsc",
    sourceAttribution: args.sourceAttribution ?? "EMSC",
    areaLabel: args.areaLabel,
    observedAt: args.observedAt ?? new Date().toISOString(),
  });
  const data: Record<string, string> & {
    broadcast_id: string;
    severity: string;
    kind: string;
  } = {
    ...toProvenancePayload(provenance),
    broadcast_id: args.broadcastId,
    severity: args.severity,
    kind: "earthquake",
    hazard: "earthquake",
    magnitude: args.magnitude.toFixed(1),
    source_key: args.sourceKey ?? "emsc",
    ...(args.sourceAttribution
      ? { source_attribution: args.sourceAttribution }
      : {}),
    ...(args.observedAt ? { observed_at: args.observedAt } : {}),
    ...(args.areaLabel ? { area_label: args.areaLabel } : {}),
  };
  const tag = `quake-${args.earthquakeId}`;
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
          channelId,
          data,
          tag,
        ),
      );
    }
  return out;
}

export type SelfTestLinkPath = "/settings" | "/" | "/admin/sources";

const SELF_TEST_LINK_PATHS: ReadonlySet<string> = new Set([
  "/settings",
  "/",
  "/admin/sources",
]);

const SELF_TEST_COPY: Record<FcmLang, { title: string; body: string }> = {
  ar: {
    title: "نذير · اختبار الإشعارات",
    body: "إشعار تجريبي للتحقق من وصول التنبيهات إلى هذا الجهاز. هذا ليس تنبيه خطر.",
  },
  fr: {
    title: "Nadhir · Test de notification",
    body: "Notification de test pour vérifier la réception sur cet appareil. Ceci n'est pas une alerte.",
  },
  en: {
    title: "Nadhir · Notification test",
    body: "Test notification to verify delivery on this device. This is not a hazard alert.",
  },
  kab: {
    title: "Nadhir · Asekyed n yilɣa",
    body: "Talɣut n usekyed i usenqed n tuṭṭfa deg yibenk-a. Mačči d alɣu n umihi.",
  },
};

const SELF_TEST_TAG = "nadhir-self-test";

export type FcmSelfTestMessage = {
  token: string;
  topic?: never;
  condition?: never;
  notification: { title: string; body: string };
  android: {
    priority: "high";
    notification: { channel_id: "alerts_test"; tag: string };
  };
  apns: {
    headers: { "apns-priority": "10"; "apns-collapse-id": string };
    payload: {
      aps: { sound: "default"; "interruption-level": "active" };
    };
  };
  webpush: {
    headers: { TTL: string };
    fcm_options: { link: string };
    notification: { tag: string; renotify: boolean };
  };
  data: Record<string, string> & {
    kind: "test";
    channel_id: "alerts_test";
    test_id: string;
    link: string;
    provenance_trigger: "self_test";
    provenance_source_key: "nadhir_test";
    provenance_source: "Nadhir";
    provenance_rule: "provenance.rule.selfTest";
    provenance_observed_at: string;
  };
};

export function fcmMessageForSelfTest(args: {
  token: string;
  testId: string;
  lang?: FcmLang;
  receipt?: string;
  linkPath?: SelfTestLinkPath;
  observedAt?: string;
}): FcmSelfTestMessage {
  const lang: FcmLang =
    args.lang && FCM_LANGS.includes(args.lang) ? args.lang : "ar";
  const copy = SELF_TEST_COPY[lang];
  const safeLinkPath: SelfTestLinkPath =
    args.linkPath && SELF_TEST_LINK_PATHS.has(args.linkPath)
      ? args.linkPath
      : "/settings";
  const link = `${APP_URL}${safeLinkPath}`;
  const observedAt = args.observedAt ?? new Date().toISOString();
  const channelId = resolveNotificationChannel({ kind: "test" }) as
    "alerts_test" | NotificationChannelId;
  const spec = channelSpec(channelId);
  const provenance = provenanceForSelfTest(observedAt);
  const provenanceData = toProvenancePayload(provenance);

  return {
    token: args.token,
    notification: { title: copy.title, body: copy.body },
    android: {
      priority: spec.androidPriority as "high",
      notification: {
        channel_id: spec.id as "alerts_test",
        tag: SELF_TEST_TAG,
      },
    },
    apns: {
      headers: {
        "apns-priority": "10",
        "apns-collapse-id": SELF_TEST_TAG,
      },
      payload: {
        aps: {
          sound: spec.sound,
          "interruption-level": spec.apnsInterruptionLevel as "active",
        },
      },
    },
    webpush: {
      headers: { TTL: "60" },
      fcm_options: { link },
      notification: { tag: SELF_TEST_TAG, renotify: true },
    },
    data: {
      ...provenanceData,
      kind: "test",
      channel_id: "alerts_test",
      test_id: args.testId,
      ...(args.receipt ? { receipt: args.receipt } : {}),
      link: safeLinkPath,
      provenance_trigger: "self_test",
      provenance_source_key: "nadhir_test",
      provenance_source: "Nadhir",
      provenance_rule: "provenance.rule.selfTest",
      provenance_observed_at: observedAt,
    },
  };
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
