/**
 * Canonical Android notification channel IDs, metadata, and hazard routing rules.
 *
 * Mirrored verbatim in native Android startup (`NotificationChannels.java` in M1)
 * and consumed by FCM payload builders and foreground push re-posting (`fcm.ts`
 * and `push-native.ts` in M2).
 */

export const NOTIFICATION_CHANNEL_IDS = Object.freeze([
  "alerts_urgent",
  "alerts_official",
  "alerts_earthquakes",
  "alerts_civil",
  "alerts_test",
  "alerts",
] as const);

export type NotificationChannelId = (typeof NOTIFICATION_CHANNEL_IDS)[number];

export const LEGACY_NOTIFICATION_CHANNEL_ID: NotificationChannelId = "alerts";

/**
 * Android 14+ trap: exact local notification scheduling opens the
 * "Alarms & reminders" settings screen instead of posting a notification.
 */
export const DEFAULT_LOCAL_NOTIFICATION_EXACT = false as const;

/** Android NotificationManager importance constants (API 26+). */
export const ANDROID_IMPORTANCE = Object.freeze({
  DEFAULT: 3,
  HIGH: 4,
} as const);

/** @capacitor-firebase/messaging CreateChannelOptions importance scale (1..5). */
export const CAPACITOR_IMPORTANCE = Object.freeze({
  DEFAULT: 3,
  HIGH: 4,
  MAX: 5,
} as const);

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

export const NOTIFICATION_CHANNELS: readonly NotificationChannelSpec[] =
  Object.freeze(
    (
      [
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
      ] satisfies NotificationChannelSpec[]
    ).map((spec) => Object.freeze(spec)),
  );

const CHANNEL_ID_SET: ReadonlySet<string> = new Set(NOTIFICATION_CHANNEL_IDS);

export const NOTIFICATION_CHANNEL_MAP: Readonly<
  Record<NotificationChannelId, NotificationChannelSpec>
> = Object.freeze(
  NOTIFICATION_CHANNELS.reduce<
    Record<NotificationChannelId, NotificationChannelSpec>
  >(
    (acc, spec) => {
      acc[spec.id] = spec;
      return acc;
    },
    Object.create(null) as Record<
      NotificationChannelId,
      NotificationChannelSpec
    >,
  ),
);

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

function parseSeverityNumber(
  severity: string | number | null | undefined,
): number | undefined {
  if (typeof severity === "number") {
    return Number.isFinite(severity) ? severity : undefined;
  }
  if (typeof severity === "string") {
    const trimmed = severity.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Authority / DGPC severity scale (`AUTHORITY_SEVERITY` in `zone-hazard-alerts.ts`):
 * Severe = 4, Extreme = 5.
 */
function isAuthorityExtremeSeverity(
  severity: string | number | null | undefined,
): boolean {
  if (
    typeof severity === "string" &&
    severity.trim().toLowerCase() === "extreme"
  ) {
    return true;
  }
  const parsed = parseSeverityNumber(severity);
  return parsed !== undefined && parsed >= 5;
}

/**
 * ONM weather severity scale (`ONM_SEVERITY` in `zone-hazards.ts`):
 * Minor = 1, Moderate = 2, Severe = 3, Extreme = 4.
 * Values >= 4 (including defensive 5) route to `alerts_urgent`.
 */
function isOnmExtremeSeverity(
  severity: string | number | null | undefined,
): boolean {
  if (
    typeof severity === "string" &&
    severity.trim().toLowerCase() === "extreme"
  ) {
    return true;
  }
  const parsed = parseSeverityNumber(severity);
  return parsed !== undefined && parsed >= 4;
}

/**
 * ONM Severe threshold on the 1..4 `ONM_SEVERITY` scale (`3 = Severe`).
 * Callers check `isOnmExtremeSeverity` first so `>= 4` routes to `alerts_urgent`.
 */
function isOnmSevereSeverity(
  severity: string | number | null | undefined,
): boolean {
  if (
    typeof severity === "string" &&
    severity.trim().toLowerCase() === "severe"
  ) {
    return true;
  }
  const parsed = parseSeverityNumber(severity);
  return parsed !== undefined && parsed >= 3;
}

/**
 * Watch-zone earthquake numeric severity fallback (`zone-hazard-alerts.ts`):
 * M5+ = 4 (urgent), M4.0-4.9 = 3 (earthquakes).
 */
function isEarthquakeUrgentSeverity(
  severity: string | number | null | undefined,
): boolean {
  if (
    typeof severity === "string" &&
    severity.trim().toLowerCase() === "extreme"
  ) {
    return true;
  }
  const parsed = parseSeverityNumber(severity);
  return parsed !== undefined && parsed >= 4;
}

export function isNotificationChannelId(
  value: unknown,
): value is NotificationChannelId {
  return typeof value === "string" && CHANNEL_ID_SET.has(value);
}

export function channelSpec(
  id: NotificationChannelId,
): NotificationChannelSpec {
  if (
    !isNotificationChannelId(id) ||
    !Object.hasOwn(NOTIFICATION_CHANNEL_MAP, id)
  ) {
    return undefined as unknown as NotificationChannelSpec;
  }
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

  // Uses the 1..4 ONM_SEVERITY scale (Minor=1, Moderate=2, Severe=3, Extreme=4).
  if (kind === "onm" || kind === "weather") {
    if (isOnmExtremeSeverity(input.severity)) return "alerts_urgent";
    if (isOnmSevereSeverity(input.severity)) return "alerts_official";
    return "alerts_civil";
  }

  // Uses AUTHORITY_SEVERITY (Severe=4, Extreme=5) & DGPC official incident severity.
  if (kind === "official") {
    if (isAuthorityExtremeSeverity(input.severity)) return "alerts_urgent";
    const hazard = normalizeToken(input.hazard);
    if (NON_FIRE_OFFICIAL_HAZARDS.has(hazard)) return "alerts_official";
    return "alerts_urgent";
  }

  if (kind === "authority") {
    if (isAuthorityExtremeSeverity(input.severity)) return "alerts_urgent";
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
    if (isEarthquakeUrgentSeverity(input.severity)) return "alerts_urgent";
    return "alerts_earthquakes";
  }

  if (CIVIL_KINDS.has(kind)) return "alerts_civil";

  return LEGACY_NOTIFICATION_CHANNEL_ID;
}

function ownProp(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
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
  const explicit = ownProp(record, "channel_id");
  if (isNotificationChannelId(explicit)) return explicit;

  const rawKind = ownProp(record, "kind");
  if (typeof rawKind !== "string" || rawKind.trim().length === 0) {
    return LEGACY_NOTIFICATION_CHANNEL_ID;
  }

  const rawSeverity = ownProp(record, "severity");
  const severity =
    typeof rawSeverity === "string" || typeof rawSeverity === "number"
      ? rawSeverity
      : undefined;
  const rawHazard = ownProp(record, "hazard");
  const hazard = typeof rawHazard === "string" ? rawHazard : undefined;
  const magnitude = parseOptionalNumber(ownProp(record, "magnitude"));
  const rawPhase = ownProp(record, "phase");
  const phase = typeof rawPhase === "string" ? rawPhase : undefined;
  const rawStatus = ownProp(record, "status");
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
