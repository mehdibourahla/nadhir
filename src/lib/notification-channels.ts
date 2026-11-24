/**
 * Canonical Android notification channel IDs, metadata, and hazard routing rules.
 *
 * Mirrored verbatim in native Android startup (`NotificationChannels.java` in M1)
 * and consumed by FCM payload builders and foreground push re-posting (`fcm.ts`
 * and `push-native.ts` in M2).
 */

export const NOTIFICATION_CHANNEL_IDS = [
  "alerts_urgent",
  "alerts_official",
  "alerts_earthquakes",
  "alerts_civil",
  "alerts_test",
  "alerts",
] as const;

export type NotificationChannelId = (typeof NOTIFICATION_CHANNEL_IDS)[number];

export const LEGACY_NOTIFICATION_CHANNEL_ID: NotificationChannelId = "alerts";

/**
 * Android 14+ trap: exact local notification scheduling opens the
 * "Alarms & reminders" settings screen instead of posting a notification.
 */
export const DEFAULT_LOCAL_NOTIFICATION_EXACT = false as const;

/** Android NotificationManager importance constants (API 26+). */
export const ANDROID_IMPORTANCE = {
  DEFAULT: 3,
  HIGH: 4,
} as const;

/** @capacitor-firebase/messaging CreateChannelOptions importance scale (1..5). */
export const CAPACITOR_IMPORTANCE = {
  DEFAULT: 3,
  HIGH: 4,
  MAX: 5,
} as const;

export type NotificationChannelImportance = "high" | "default";

export interface NotificationChannelSpec {
  readonly id: NotificationChannelId;
  readonly importance: NotificationChannelImportance;
  readonly androidImportance: 3 | 4;
  readonly capacitorImportance: 3 | 4 | 5;
  readonly androidPriority: "high" | "normal";
  readonly apnsInterruptionLevel: "time-sensitive" | "active";
  readonly sound: "default";
  readonly vibration: boolean;
  readonly lights: boolean;
  /** Android Notification.VISIBILITY_PUBLIC (1). */
  readonly visibility: 1;
  readonly i18nNameKey: string;
  readonly i18nDescriptionKey: string;
  readonly isLegacyFallback: boolean;
}

export const NOTIFICATION_CHANNELS: readonly NotificationChannelSpec[] = [
  {
    id: "alerts_urgent",
    importance: "high",
    androidImportance: ANDROID_IMPORTANCE.HIGH,
    capacitorImportance: CAPACITOR_IMPORTANCE.MAX,
    androidPriority: "high",
    apnsInterruptionLevel: "time-sensitive",
    sound: "default",
    vibration: true,
    lights: true,
    visibility: 1,
    i18nNameKey: "notificationChannels.urgent.name",
    i18nDescriptionKey: "notificationChannels.urgent.description",
    isLegacyFallback: false,
  },
  {
    id: "alerts_official",
    importance: "high",
    androidImportance: ANDROID_IMPORTANCE.HIGH,
    capacitorImportance: CAPACITOR_IMPORTANCE.HIGH,
    androidPriority: "high",
    apnsInterruptionLevel: "time-sensitive",
    sound: "default",
    vibration: true,
    lights: true,
    visibility: 1,
    i18nNameKey: "notificationChannels.official.name",
    i18nDescriptionKey: "notificationChannels.official.description",
    isLegacyFallback: false,
  },
  {
    id: "alerts_earthquakes",
    importance: "high",
    androidImportance: ANDROID_IMPORTANCE.HIGH,
    capacitorImportance: CAPACITOR_IMPORTANCE.HIGH,
    androidPriority: "high",
    apnsInterruptionLevel: "time-sensitive",
    sound: "default",
    vibration: true,
    lights: true,
    visibility: 1,
    i18nNameKey: "notificationChannels.earthquakes.name",
    i18nDescriptionKey: "notificationChannels.earthquakes.description",
    isLegacyFallback: false,
  },
  {
    id: "alerts_civil",
    importance: "default",
    androidImportance: ANDROID_IMPORTANCE.DEFAULT,
    capacitorImportance: CAPACITOR_IMPORTANCE.DEFAULT,
    androidPriority: "normal",
    apnsInterruptionLevel: "active",
    sound: "default",
    vibration: false,
    lights: false,
    visibility: 1,
    i18nNameKey: "notificationChannels.civil.name",
    i18nDescriptionKey: "notificationChannels.civil.description",
    isLegacyFallback: false,
  },
  {
    id: "alerts_test",
    importance: "default",
    androidImportance: ANDROID_IMPORTANCE.DEFAULT,
    capacitorImportance: CAPACITOR_IMPORTANCE.DEFAULT,
    androidPriority: "high",
    apnsInterruptionLevel: "active",
    sound: "default",
    vibration: true,
    lights: false,
    visibility: 1,
    i18nNameKey: "notificationChannels.test.name",
    i18nDescriptionKey: "notificationChannels.test.description",
    isLegacyFallback: false,
  },
  {
    id: "alerts",
    importance: "high",
    androidImportance: ANDROID_IMPORTANCE.HIGH,
    capacitorImportance: CAPACITOR_IMPORTANCE.MAX,
    androidPriority: "high",
    apnsInterruptionLevel: "time-sensitive",
    sound: "default",
    vibration: true,
    lights: true,
    visibility: 1,
    i18nNameKey: "push.channelName",
    i18nDescriptionKey: "notificationChannels.legacy.description",
    isLegacyFallback: true,
  },
];

const CHANNEL_ID_SET: ReadonlySet<string> = new Set(NOTIFICATION_CHANNEL_IDS);

export const NOTIFICATION_CHANNEL_MAP: Readonly<
  Record<NotificationChannelId, NotificationChannelSpec>
> = Object.fromEntries(
  NOTIFICATION_CHANNELS.map((spec) => [spec.id, spec]),
) as Record<NotificationChannelId, NotificationChannelSpec>;

export interface NotificationChannelInput {
  kind: string;
  severity?: string | number | null | undefined;
  hazard?: string | null | undefined;
  magnitude?: number | null | undefined;
  phase?: string | null | undefined;
  status?: string | null | undefined;
}

const TERMINAL_PHASES: ReadonlySet<string> = new Set([
  "end",
  "cancel",
  "observation_ended",
]);

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "cleared",
  "extinguished",
  "withdrawn",
]);

const NON_FIRE_OFFICIAL_HAZARDS: ReadonlySet<string> = new Set([
  "flood",
  "flooding",
  "storm",
  "weather",
  "road",
  "structure",
  "other",
]);

const CIVIL_KINDS: ReadonlySet<string> = new Set([
  "road",
  "citizen",
  "risk",
  "civil",
  "digest",
]);

function normalizeToken(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isExtremeSeverity(
  severity: string | number | null | undefined,
): boolean {
  if (typeof severity === "number") {
    return Number.isFinite(severity) && severity >= 5;
  }
  if (typeof severity === "string") {
    const normalized = severity.trim().toLowerCase();
    if (normalized === "extreme") return true;
    if (normalized.length > 0) {
      const parsed = Number(normalized);
      if (Number.isFinite(parsed) && parsed >= 5) return true;
    }
  }
  return false;
}

function isSevereSeverity(
  severity: string | number | null | undefined,
): boolean {
  if (typeof severity === "number") {
    return Number.isFinite(severity) && severity >= 4;
  }
  if (typeof severity === "string") {
    const normalized = severity.trim().toLowerCase();
    if (normalized === "severe") return true;
    if (normalized.length > 0) {
      const parsed = Number(normalized);
      if (Number.isFinite(parsed) && parsed >= 4) return true;
    }
  }
  return false;
}

export function isNotificationChannelId(
  value: unknown,
): value is NotificationChannelId {
  return typeof value === "string" && CHANNEL_ID_SET.has(value);
}

export function channelSpec(
  id: NotificationChannelId,
): NotificationChannelSpec {
  return NOTIFICATION_CHANNEL_MAP[id];
}

export function resolveNotificationChannel(
  input: NotificationChannelInput,
): NotificationChannelId {
  const kind = normalizeToken(input.kind);
  if (kind === "test") return "alerts_test";

  const phase = normalizeToken(input.phase);
  const status = normalizeToken(input.status);
  if (TERMINAL_PHASES.has(phase) || TERMINAL_STATUSES.has(status)) {
    return "alerts_civil";
  }

  if (kind === "fire") return "alerts_urgent";

  if (kind === "onm" || kind === "weather") {
    if (isExtremeSeverity(input.severity)) return "alerts_urgent";
    if (isSevereSeverity(input.severity)) return "alerts_official";
    return "alerts_civil";
  }

  if (kind === "official") {
    if (isExtremeSeverity(input.severity)) return "alerts_urgent";
    const hazard = normalizeToken(input.hazard);
    if (NON_FIRE_OFFICIAL_HAZARDS.has(hazard)) return "alerts_official";
    return "alerts_urgent";
  }

  if (kind === "authority") {
    if (isExtremeSeverity(input.severity)) return "alerts_urgent";
    return "alerts_official";
  }

  if (kind === "earthquake") {
    if (
      typeof input.magnitude === "number" &&
      Number.isFinite(input.magnitude)
    ) {
      if (input.magnitude >= 5.0) return "alerts_urgent";
      if (input.magnitude >= 4.0) return "alerts_earthquakes";
      return "alerts_civil";
    }
    if (isExtremeSeverity(input.severity)) return "alerts_urgent";
    return "alerts_earthquakes";
  }

  if (CIVIL_KINDS.has(kind)) return "alerts_civil";

  return LEGACY_NOTIFICATION_CHANNEL_ID;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function channelFromFcmData(data: unknown): NotificationChannelId {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return LEGACY_NOTIFICATION_CHANNEL_ID;
  }
  const record = data as Record<string, unknown>;
  const explicit = record["channel_id"];
  if (isNotificationChannelId(explicit)) return explicit;

  const rawKind = record["kind"];
  if (typeof rawKind !== "string" || rawKind.trim().length === 0) {
    return LEGACY_NOTIFICATION_CHANNEL_ID;
  }

  const rawSeverity = record["severity"];
  const severity =
    typeof rawSeverity === "string" || typeof rawSeverity === "number"
      ? rawSeverity
      : undefined;
  const rawHazard = record["hazard"];
  const hazard = typeof rawHazard === "string" ? rawHazard : undefined;
  const magnitude = parseOptionalNumber(record["magnitude"]);
  const rawPhase = record["phase"];
  const phase = typeof rawPhase === "string" ? rawPhase : undefined;
  const rawStatus = record["status"];
  const status = typeof rawStatus === "string" ? rawStatus : undefined;

  return resolveNotificationChannel({
    kind: rawKind,
    severity,
    hazard,
    magnitude,
    phase,
    status,
  });
}
