/**
 * Canonical Trigger Provenance data model, invariant validator, and
 * FCM / digest serializers shared across M2 alerting and M3 alert cards.
 *
 * Honesty & voice invariants (ADR-0002 & antislop R-02):
 * - Non-empty authority/source attributions (including ONM) are preserved verbatim.
 * - "safe" (and equivalents) is banned as a status label.
 * - Missing areas render as explicit null (localized "Not recorded"), never "—".
 */

export const ALERT_TRIGGER_KINDS = Object.freeze([
  "watch_zone",
  "current_commune",
  "commune_topic",
  "wilaya_warning",
  "national_feed",
  "self_test",
] as const);

export type AlertTriggerKind = (typeof ALERT_TRIGGER_KINDS)[number];

export const AUTHORITY_STATUSES = Object.freeze([
  "official",
  "probable",
  "observed",
  "model",
] as const);

export type AuthorityStatus = (typeof AUTHORITY_STATUSES)[number];

export const PROVENANCE_RULE_KEYS = Object.freeze([
  "provenance.rule.onmExtreme",
  "provenance.rule.onmSevere",
  "provenance.rule.onmWarning",
  "provenance.rule.dgpcFire",
  "provenance.rule.dgpcNonFire",
  "provenance.rule.probableFire",
  "provenance.rule.m4Quake",
  "provenance.rule.m5Quake",
  "provenance.rule.watchZone",
  "provenance.rule.roadDanger",
  "provenance.rule.civilUpdate",
  "provenance.rule.selfTest",
  "provenance.rule.generic",
] as const);

export type ProvenanceRuleKey = (typeof PROVENANCE_RULE_KEYS)[number];

export const KNOWN_SOURCE_ATTRIBUTIONS: Readonly<Record<string, string>> =
  Object.freeze(
    Object.assign(Object.create(null) as Record<string, string>, {
      onm: "ONM · Météo Algérie",
      dgpc_telegram: "DGPC",
      emsc: "EMSC",
      craag: "CRAAG",
      firms: "NASA FIRMS",
      mtg_fci: "EUMETSAT MTG FCI",
      tariki_facebook: "Gendarmerie Nationale (Tariki)",
      ita_facebook: "Info Trafic Algérie",
      nadhir_test: "Nadhir",
    }),
  );

export const BANNED_STATUS_LABELS = Object.freeze([
  "safe",
  "all-clear",
  "all clear",
  "sûr",
  "sûre",
  "آمن",
  "آمنة",
  "yeɣlel",
] as const);

const EM_DASH = "\u2014";
const BLANK_OR_EM_DASH_ONLY = /^[\s\u2014]+$/;
const ISO_8601_WITH_TZ_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:[Zz]|([+-])(\d{2}):?(\d{2}))$/;
const ONM_ATTRIBUTION_PATTERNS: readonly RegExp[] = [
  /\bONM\b/i,
  /الديوان الوطني للأرصاد الجوية/,
  /Office National de la M[ée]t[ée]orologie/i,
];

const TRIGGER_KIND_SET: ReadonlySet<string> = new Set(ALERT_TRIGGER_KINDS);
const AUTHORITY_STATUS_SET: ReadonlySet<string> = new Set(AUTHORITY_STATUSES);
const BANNED_STATUS_SET: ReadonlySet<string> = new Set(
  BANNED_STATUS_LABELS.map((label) => label.normalize("NFC").toLowerCase()),
);

export interface AlertProvenanceData {
  triggerKind: AlertTriggerKind;
  areaLabel: string | null;
  radiusKm?: number | null | undefined;
  sourceKey: string;
  sourceAttribution: string;
  ruleLabelKey: string;
  observedAt: string;
  authorityStatus?: AuthorityStatus | undefined;
}

export interface BuildAlertProvenanceInput {
  triggerKind: AlertTriggerKind;
  areaLabel?: string | null | undefined;
  radiusKm?: number | null | undefined;
  sourceKey: string;
  sourceAttribution?: string | null | undefined;
  ruleLabelKey?: string | null | undefined;
  observedAt: string;
  authorityStatus?: string | null | undefined;
}

export interface ProvenanceDigestLabels {
  trigger: string;
  rule: string;
  areaFallback: string;
  timeLabel: string;
  radiusLabel?: string | undefined;
}

export function isAlertTriggerKind(value: unknown): value is AlertTriggerKind {
  return typeof value === "string" && TRIGGER_KIND_SET.has(value);
}

export function isAuthorityStatus(value: unknown): value is AuthorityStatus {
  return typeof value === "string" && AUTHORITY_STATUS_SET.has(value);
}

export function isValidRadiusKm(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isValidObservedAt(iso: unknown): boolean {
  if (typeof iso !== "string") return false;
  const trimmed = iso.trim();
  const match = ISO_8601_WITH_TZ_RE.exec(trimmed);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] !== undefined ? Number(match[6]) : 0;

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  if (match[8] !== undefined) {
    const tzHour = Number(match[9]);
    const tzMinute = Number(match[10]);
    if (tzHour > 23 || tzMinute > 59) return false;
  }

  // Verify real calendar date without JS Date rollover (e.g. rejects 2026-02-31).
  const checkDate = new Date(0);
  checkDate.setUTCFullYear(year, month - 1, day);
  if (
    checkDate.getUTCFullYear() !== year ||
    checkDate.getUTCMonth() !== month - 1 ||
    checkDate.getUTCDate() !== day
  ) {
    return false;
  }

  return Number.isFinite(Date.parse(trimmed));
}

export function normalizeAreaLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const segments = value
    .replace(/\u2014/g, "·")
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return segments.length > 0 ? segments.join(" · ") : null;
}

function normalizeRadiusKm(value: number | null | undefined): number | null {
  return isValidRadiusKm(value) ? value : null;
}

function normalizeAuthorityStatus(
  value: string | null | undefined,
): AuthorityStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().normalize("NFC").toLowerCase();
  if (BANNED_STATUS_SET.has(normalized)) return undefined;
  return isAuthorityStatus(normalized) ? normalized : undefined;
}

function hasValidOnmAttribution(attribution: string): boolean {
  const normalized = attribution.normalize("NFC");
  return ONM_ATTRIBUTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function ownProp(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function buildAlertProvenance(
  input: BuildAlertProvenanceInput,
): AlertProvenanceData {
  const sourceKey = input.sourceKey.trim();
  const lookupKey = sourceKey.toLowerCase();
  const canonicalAttribution = Object.hasOwn(
    KNOWN_SOURCE_ATTRIBUTIONS,
    lookupKey,
  )
    ? KNOWN_SOURCE_ATTRIBUTIONS[lookupKey]!
    : sourceKey;

  const rawAttribution =
    typeof input.sourceAttribution === "string"
      ? input.sourceAttribution.trim()
      : "";
  const sourceAttribution =
    rawAttribution.length > 0 && !BLANK_OR_EM_DASH_ONLY.test(rawAttribution)
      ? rawAttribution
      : canonicalAttribution;

  const rawRule =
    typeof input.ruleLabelKey === "string" ? input.ruleLabelKey.trim() : "";
  const ruleLabelKey = rawRule.length > 0 ? rawRule : "provenance.rule.generic";

  const observedAt = input.observedAt.trim();
  const areaLabel = normalizeAreaLabel(input.areaLabel);
  const radiusKm = normalizeRadiusKm(input.radiusKm);
  const authorityStatus = normalizeAuthorityStatus(input.authorityStatus);

  return {
    triggerKind: input.triggerKind,
    areaLabel,
    ...(radiusKm !== null ? { radiusKm } : { radiusKm: null }),
    sourceKey,
    sourceAttribution,
    ruleLabelKey,
    observedAt,
    ...(authorityStatus !== undefined ? { authorityStatus } : {}),
  };
}

export function validateProvenanceInvariants(
  data: AlertProvenanceData,
): string[] {
  const violations: string[] = [];

  if (!isAlertTriggerKind(data.triggerKind)) {
    violations.push(`Invalid triggerKind: ${String(data.triggerKind)}`);
  }

  const hasValidSourceKey =
    typeof data.sourceKey === "string" && data.sourceKey.trim().length > 0;
  if (!hasValidSourceKey) {
    violations.push("sourceKey must be non-empty");
  } else if (data.sourceKey.includes(EM_DASH)) {
    violations.push("sourceKey contains banned em dash");
  }

  if (
    typeof data.ruleLabelKey !== "string" ||
    data.ruleLabelKey.trim().length === 0
  ) {
    violations.push("ruleLabelKey must be non-empty");
  } else if (data.ruleLabelKey.includes(EM_DASH)) {
    violations.push("ruleLabelKey contains banned em dash");
  }

  if (typeof data.areaLabel === "string" && data.areaLabel.includes(EM_DASH)) {
    violations.push("areaLabel contains banned em dash");
  }

  if (
    typeof data.sourceAttribution !== "string" ||
    data.sourceAttribution.trim().length === 0 ||
    BLANK_OR_EM_DASH_ONLY.test(data.sourceAttribution)
  ) {
    violations.push("sourceAttribution must be non-empty");
  } else if (
    hasValidSourceKey &&
    data.sourceKey.trim().toLowerCase() === "onm" &&
    !hasValidOnmAttribution(data.sourceAttribution)
  ) {
    violations.push("ONM sourceAttribution must preserve ONM attribution");
  }

  if (data.authorityStatus !== undefined) {
    const normalized = String(data.authorityStatus)
      .trim()
      .normalize("NFC")
      .toLowerCase();
    if (BANNED_STATUS_SET.has(normalized)) {
      violations.push(
        `authorityStatus uses banned status label: ${String(data.authorityStatus)}`,
      );
    } else if (!isAuthorityStatus(data.authorityStatus)) {
      violations.push(
        `authorityStatus is not allowed: ${String(data.authorityStatus)}`,
      );
    }
  }

  if (!isValidObservedAt(data.observedAt)) {
    violations.push("observedAt must be a valid ISO timestamp");
  }

  if (
    data.radiusKm !== undefined &&
    data.radiusKm !== null &&
    !isValidRadiusKm(data.radiusKm)
  ) {
    violations.push("radiusKm must be a positive finite number or null");
  }

  return violations;
}

export function toProvenancePayload(
  data: AlertProvenanceData,
): Record<string, string> {
  const payload: Record<string, string> = {
    provenance_trigger: data.triggerKind,
    provenance_area: data.areaLabel ?? "",
    provenance_source_key: data.sourceKey,
    provenance_source: data.sourceAttribution,
    provenance_rule: data.ruleLabelKey,
    provenance_observed_at: data.observedAt,
  };

  if (isValidRadiusKm(data.radiusKm)) {
    payload["provenance_radius_km"] = String(data.radiusKm);
  }

  if (
    data.authorityStatus !== undefined &&
    isAuthorityStatus(data.authorityStatus)
  ) {
    payload["provenance_authority"] = data.authorityStatus;
  }

  return payload;
}

function parseRadiusFromPayload(value: unknown): number | null {
  if (isValidRadiusKm(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return isValidRadiusKm(parsed) ? parsed : null;
  }
  return null;
}

export function parseProvenancePayload(
  raw: unknown,
): AlertProvenanceData | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const trigger = ownProp(record, "provenance_trigger");
  if (!isAlertTriggerKind(trigger)) return null;

  const rawSourceKey = ownProp(record, "provenance_source_key");
  if (typeof rawSourceKey !== "string" || rawSourceKey.trim().length === 0) {
    return null;
  }

  const rawArea = ownProp(record, "provenance_area");
  const rawSource = ownProp(record, "provenance_source");
  const rawRule = ownProp(record, "provenance_rule");
  const rawObservedAt = ownProp(record, "provenance_observed_at");
  const rawAuthority = ownProp(record, "provenance_authority");

  return buildAlertProvenance({
    triggerKind: trigger,
    areaLabel: typeof rawArea === "string" ? rawArea : null,
    radiusKm: parseRadiusFromPayload(ownProp(record, "provenance_radius_km")),
    sourceKey: rawSourceKey,
    sourceAttribution: typeof rawSource === "string" ? rawSource : null,
    ruleLabelKey: typeof rawRule === "string" ? rawRule : null,
    observedAt: typeof rawObservedAt === "string" ? rawObservedAt : "",
    authorityStatus: typeof rawAuthority === "string" ? rawAuthority : null,
  });
}

export function formatProvenanceDigestLine(
  data: AlertProvenanceData,
  labels: ProvenanceDigestLabels,
): string {
  const safeArea = normalizeAreaLabel(data.areaLabel);
  const areaBase = safeArea ?? labels.areaFallback;
  const areaSegment =
    data.triggerKind === "watch_zone" &&
    isValidRadiusKm(data.radiusKm) &&
    labels.radiusLabel
      ? `${areaBase} (${labels.radiusLabel})`
      : areaBase;

  const safeSource =
    typeof data.sourceAttribution === "string" &&
    !BLANK_OR_EM_DASH_ONLY.test(data.sourceAttribution)
      ? data.sourceAttribution.trim()
      : "";

  const parts = [
    safeSource,
    labels.trigger,
    areaSegment,
    labels.rule,
    labels.timeLabel,
  ].filter((part) => part.trim().length > 0);

  return parts.join(" · ");
}
