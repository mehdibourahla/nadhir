/**
 * Canonical Trigger Provenance data model, invariant validator, and
 * FCM / digest serializers shared across M2 alerting and M3 alert cards.
 *
 * Honesty & voice invariants (ADR-0002 & antislop R-02):
 * - Non-empty authority/source attributions (including ONM) are preserved verbatim.
 * - "safe" (and equivalents) is banned as a status label.
 * - Missing areas render as explicit null (localized "Not recorded"), never "—".
 */

export const ALERT_TRIGGER_KINDS = [
  "watch_zone",
  "current_commune",
  "commune_topic",
  "wilaya_warning",
  "national_feed",
  "self_test",
] as const;

export type AlertTriggerKind = (typeof ALERT_TRIGGER_KINDS)[number];

export const AUTHORITY_STATUSES = [
  "official",
  "probable",
  "observed",
  "model",
] as const;

export type AuthorityStatus = (typeof AUTHORITY_STATUSES)[number];

export const PROVENANCE_RULE_KEYS = [
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
] as const;

export type ProvenanceRuleKey = (typeof PROVENANCE_RULE_KEYS)[number];

export const KNOWN_SOURCE_ATTRIBUTIONS: Readonly<Record<string, string>> = {
  onm: "ONM · Météo Algérie",
  dgpc_telegram: "DGPC",
  emsc: "EMSC",
  craag: "CRAAG",
  firms: "NASA FIRMS",
  mtg_fci: "EUMETSAT MTG FCI",
  tariki_facebook: "Gendarmerie Nationale (Tariki)",
  ita_facebook: "Info Trafic Algérie",
  nadhir_test: "Nadhir",
};

export const BANNED_STATUS_LABELS = [
  "safe",
  "all-clear",
  "all clear",
  "sûr",
  "sûre",
  "آمن",
  "آمنة",
  "yeɣlel",
] as const;

const EM_DASH = "\u2014";
const TRIGGER_KIND_SET: ReadonlySet<string> = new Set(ALERT_TRIGGER_KINDS);
const AUTHORITY_STATUS_SET: ReadonlySet<string> = new Set(AUTHORITY_STATUSES);
const BANNED_STATUS_SET: ReadonlySet<string> = new Set(
  BANNED_STATUS_LABELS.map((label) => label.toLowerCase()),
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

export function isValidObservedAt(iso: string): boolean {
  const trimmed = iso.trim();
  if (trimmed.length === 0) return false;
  return Number.isFinite(Date.parse(trimmed));
}

function normalizeAreaLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === EM_DASH) return null;
  return trimmed;
}

function normalizeRadiusKm(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function normalizeAuthorityStatus(
  value: string | null | undefined,
): AuthorityStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (BANNED_STATUS_SET.has(normalized)) return undefined;
  return isAuthorityStatus(normalized) ? normalized : undefined;
}

export function buildAlertProvenance(
  input: BuildAlertProvenanceInput,
): AlertProvenanceData {
  const sourceKey = input.sourceKey.trim();
  const rawAttribution =
    typeof input.sourceAttribution === "string"
      ? input.sourceAttribution.trim()
      : "";
  const sourceAttribution =
    rawAttribution.length > 0
      ? rawAttribution
      : (KNOWN_SOURCE_ATTRIBUTIONS[sourceKey] ?? sourceKey);

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

  if (data.sourceKey.trim().length === 0) {
    violations.push("sourceKey must be non-empty");
  }
  if (data.sourceKey.includes(EM_DASH)) {
    violations.push("sourceKey contains banned em dash");
  }
  if (data.ruleLabelKey.trim().length === 0) {
    violations.push("ruleLabelKey must be non-empty");
  }
  if (data.ruleLabelKey.includes(EM_DASH)) {
    violations.push("ruleLabelKey contains banned em dash");
  }
  if (typeof data.areaLabel === "string" && data.areaLabel.includes(EM_DASH)) {
    violations.push("areaLabel contains banned em dash");
  }

  if (data.sourceAttribution.trim().length === 0) {
    violations.push("sourceAttribution must be non-empty");
  } else if (
    data.sourceKey.trim().toLowerCase() === "onm" &&
    !/ONM/i.test(data.sourceAttribution)
  ) {
    violations.push("ONM sourceAttribution must preserve ONM attribution");
  }

  if (data.authorityStatus !== undefined) {
    const lower = String(data.authorityStatus).trim().toLowerCase();
    if (BANNED_STATUS_SET.has(lower)) {
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
    (!Number.isFinite(data.radiusKm) || data.radiusKm <= 0)
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

  if (
    typeof data.radiusKm === "number" &&
    Number.isFinite(data.radiusKm) &&
    data.radiusKm > 0
  ) {
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
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
  const trigger = record["provenance_trigger"];
  if (!isAlertTriggerKind(trigger)) return null;

  const rawSourceKey = record["provenance_source_key"];
  if (typeof rawSourceKey !== "string" || rawSourceKey.trim().length === 0) {
    return null;
  }

  const rawArea = record["provenance_area"];
  const rawSource = record["provenance_source"];
  const rawRule = record["provenance_rule"];
  const rawObservedAt = record["provenance_observed_at"];
  const rawAuthority = record["provenance_authority"];

  return buildAlertProvenance({
    triggerKind: trigger,
    areaLabel: typeof rawArea === "string" ? rawArea : null,
    radiusKm: parseRadiusFromPayload(record["provenance_radius_km"]),
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
  const areaBase = data.areaLabel ?? labels.areaFallback;
  const areaSegment =
    data.triggerKind === "watch_zone" &&
    data.radiusKm != null &&
    labels.radiusLabel
      ? `${areaBase} (${labels.radiusLabel})`
      : areaBase;

  const parts = [
    data.sourceAttribution,
    labels.trigger,
    areaSegment,
    labels.rule,
    labels.timeLabel,
  ].filter((part) => part.trim().length > 0);

  return parts.join(" · ");
}
