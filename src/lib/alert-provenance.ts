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
      local_fwi: "Nadhir FWI",
      citizen_reports: "Citizen report",
      metar: "METAR",
      authority: "Official authority",
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
  /^ONM(?:\b|\s|[·(:-])/i,
  /^M[ée]t[ée]o\s+Alg[ée]rie\s*(?:[·(:-]\s*|\s+)ONM\b/i,
  /^Office\s+National\s+de\s+la\s+M[ée]t[ée]orologie(?:\b|$)/i,
  /^الديوان\s+الوطني\s+للأرصاد\s+الجوية(?:\s|[·(:-]|$)/,
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
  const normalized = attribution.trim().normalize("NFC");
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
  } else {
    if (data.sourceAttribution.includes(EM_DASH)) {
      violations.push("sourceAttribution contains banned em dash");
    }
    if (
      hasValidSourceKey &&
      data.sourceKey.trim().toLowerCase() === "onm" &&
      !hasValidOnmAttribution(data.sourceAttribution)
    ) {
      violations.push("ONM sourceAttribution must preserve ONM attribution");
    }
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

const MAX_PROVENANCE_AREA_CHARS = 240;
const MAX_PROVENANCE_AREA_BYTES = 512;
const MAX_PROVENANCE_SOURCE_CHARS = 240;
const MAX_PROVENANCE_SOURCE_BYTES = 512;
const UNINTERPOLATED_TOKEN = /\{\{[^{}]+\}\}/;
const utf8Encoder = new TextEncoder();

function capUtf8CodePoints(
  value: string,
  maxChars: number,
  maxBytes: number,
): string {
  if (value.length === 0) return "";
  if (
    value.length <= maxChars &&
    utf8Encoder.encode(value).byteLength <= maxBytes
  ) {
    return value;
  }
  let chars = 0;
  let bytes = 0;
  let endIndex = 0;
  for (const cp of value) {
    const cpBytes = utf8Encoder.encode(cp).byteLength;
    if (chars + 1 > maxChars || bytes + cpBytes > maxBytes) {
      break;
    }
    chars += 1;
    bytes += cpBytes;
    endIndex += cp.length;
  }
  return value.slice(0, endIndex).trimEnd();
}

function capAreaForPayload(areaLabel: string | null): string {
  if (typeof areaLabel !== "string" || areaLabel.length === 0) return "";
  const normalized = normalizeAreaLabel(areaLabel);
  if (!normalized) return "";
  return capUtf8CodePoints(
    normalized,
    MAX_PROVENANCE_AREA_CHARS,
    MAX_PROVENANCE_AREA_BYTES,
  );
}

function capSourceForPayload(
  sourceKey: string,
  sourceAttribution: string,
): string {
  if (typeof sourceAttribution !== "string" || sourceAttribution.length === 0) {
    return "";
  }
  if (sourceKey.trim().toLowerCase() === "onm") {
    return sourceAttribution;
  }
  const normalized = normalizeAreaLabel(sourceAttribution) ?? sourceAttribution;
  return capUtf8CodePoints(
    normalized,
    MAX_PROVENANCE_SOURCE_CHARS,
    MAX_PROVENANCE_SOURCE_BYTES,
  );
}

export function toProvenancePayload(
  data: AlertProvenanceData,
): Record<string, string> {
  const payload: Record<string, string> = {
    provenance_trigger: data.triggerKind,
    provenance_area: capAreaForPayload(data.areaLabel),
    provenance_source_key: data.sourceKey,
    provenance_source: capSourceForPayload(
      data.sourceKey,
      data.sourceAttribution,
    ),
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

  const rawObservedAt = ownProp(record, "provenance_observed_at");
  if (!isValidObservedAt(rawObservedAt)) return null;

  const rawArea = ownProp(record, "provenance_area");
  const rawSource = ownProp(record, "provenance_source");
  const rawRule = ownProp(record, "provenance_rule");
  const rawAuthority = ownProp(record, "provenance_authority");

  return buildAlertProvenance({
    triggerKind: trigger,
    areaLabel: typeof rawArea === "string" ? rawArea : null,
    radiusKm: parseRadiusFromPayload(ownProp(record, "provenance_radius_km")),
    sourceKey: rawSourceKey,
    sourceAttribution: typeof rawSource === "string" ? rawSource : null,
    ruleLabelKey: typeof rawRule === "string" ? rawRule : null,
    observedAt: rawObservedAt as string,
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

const NON_FIRE_OFFICIAL_HAZARDS: ReadonlySet<string> = new Set([
  "flood",
  "flooding",
  "storm",
  "weather",
  "road",
  "structure",
  "other",
]);

function onmRuleKey(
  severity: string | number | null | undefined,
): ProvenanceRuleKey {
  if (typeof severity === "string") {
    const token = severity.trim().toLowerCase();
    if (token === "extreme") return "provenance.rule.onmExtreme";
    if (token === "severe") return "provenance.rule.onmSevere";
    const parsed = Number(token);
    if (Number.isFinite(parsed)) {
      if (parsed >= 4) return "provenance.rule.onmExtreme";
      if (parsed >= 3) return "provenance.rule.onmSevere";
    }
    return "provenance.rule.onmWarning";
  }
  if (typeof severity === "number" && Number.isFinite(severity)) {
    if (severity >= 4) return "provenance.rule.onmExtreme";
    if (severity >= 3) return "provenance.rule.onmSevere";
  }
  return "provenance.rule.onmWarning";
}

function isNonFireOfficialHazard(hazard: string | null | undefined): boolean {
  if (typeof hazard !== "string") return false;
  return NON_FIRE_OFFICIAL_HAZARDS.has(hazard.trim().toLowerCase());
}

function quakeRuleKey(
  magnitude: number | null | undefined,
  severity?: string | number | null | undefined,
): ProvenanceRuleKey {
  if (typeof magnitude === "number" && Number.isFinite(magnitude)) {
    if (magnitude >= 5.0) return "provenance.rule.m5Quake";
    if (magnitude >= 4.0) return "provenance.rule.m4Quake";
    return "provenance.rule.civilUpdate";
  }
  if (
    typeof severity === "string" &&
    severity.trim().toLowerCase() === "extreme"
  ) {
    return "provenance.rule.m5Quake";
  }
  if (typeof severity === "number" && Number.isFinite(severity)) {
    if (severity >= 4) return "provenance.rule.m5Quake";
  }
  return "provenance.rule.m4Quake";
}

export interface BroadcastProvenanceInput {
  kind: string;
  severity?: string | number | null | undefined;
  hazard?: string | null | undefined;
  magnitude?: number | null | undefined;
  confirmed?: boolean | undefined;
  sourceKey?: string | null | undefined;
  sourceAttribution?: string | null | undefined;
  areaLabel?: string | null | undefined;
  observedAt: string;
}

export function provenanceForBroadcast(
  input: BroadcastProvenanceInput,
): AlertProvenanceData {
  const kind = input.kind.trim().toLowerCase();
  if (kind === "onm") {
    return buildAlertProvenance({
      triggerKind: "wilaya_warning",
      areaLabel: input.areaLabel,
      sourceKey: "onm",
      sourceAttribution: input.sourceAttribution ?? "ONM · Météo Algérie",
      ruleLabelKey: onmRuleKey(input.severity),
      observedAt: input.observedAt,
      authorityStatus: "official",
    });
  }
  if (kind === "fire") {
    const confirmed = Boolean(input.confirmed);
    return buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: input.areaLabel,
      sourceKey: input.sourceKey?.trim() || "firms",
      sourceAttribution: input.sourceAttribution ?? "NASA FIRMS",
      ruleLabelKey: confirmed
        ? "provenance.rule.dgpcFire"
        : "provenance.rule.probableFire",
      observedAt: input.observedAt,
      authorityStatus: confirmed ? "official" : "probable",
    });
  }
  if (kind === "official") {
    return buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: input.areaLabel,
      sourceKey: input.sourceKey?.trim() || "dgpc_telegram",
      sourceAttribution: input.sourceAttribution ?? "DGPC",
      ruleLabelKey: isNonFireOfficialHazard(input.hazard)
        ? "provenance.rule.dgpcNonFire"
        : "provenance.rule.dgpcFire",
      observedAt: input.observedAt,
      authorityStatus: "official",
    });
  }
  if (kind === "earthquake") {
    const rawAttr = input.sourceAttribution?.trim() ?? "";
    const inferredKey =
      input.sourceKey?.trim() ||
      (rawAttr.toLowerCase().includes("craag") ? "craag" : "emsc");
    return buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: input.areaLabel,
      sourceKey: inferredKey,
      sourceAttribution: rawAttr || "EMSC",
      ruleLabelKey: quakeRuleKey(input.magnitude, input.severity),
      observedAt: input.observedAt,
      authorityStatus: "observed",
    });
  }
  if (kind === "authority") {
    return buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: input.areaLabel,
      sourceKey: input.sourceKey?.trim() || "authority",
      sourceAttribution: input.sourceAttribution ?? "Official authority",
      ruleLabelKey: "provenance.rule.civilUpdate",
      observedAt: input.observedAt,
      authorityStatus: "official",
    });
  }
  return buildAlertProvenance({
    triggerKind: "commune_topic",
    areaLabel: input.areaLabel,
    sourceKey: input.sourceKey?.trim() || "nadhir",
    sourceAttribution: input.sourceAttribution,
    ruleLabelKey: "provenance.rule.generic",
    observedAt: input.observedAt,
  });
}

export interface WatchZoneAlertProvenanceInput {
  kind: string;
  sourceTable?: string | null | undefined;
  severity?: string | number | null | undefined;
  hazard?: string | null | undefined;
  phase?: string | null | undefined;
  confirmed?: boolean | undefined;
  magnitude?: number | null | undefined;
  sourceKey?: string | null | undefined;
  sourceAttribution?: string | null | undefined;
  areaLabel?: string | null | undefined;
  radiusKm?: number | null | undefined;
  observedAt: string;
}

export function provenanceForWatchZoneAlert(
  input: WatchZoneAlertProvenanceInput,
): AlertProvenanceData {
  const kind = input.kind.trim().toLowerCase();
  const sourceTable = input.sourceTable?.trim().toLowerCase() ?? "";

  if (kind === "fire") {
    const confirmed = Boolean(input.confirmed);
    const phase = input.phase?.trim().toLowerCase() ?? "";
    return buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: input.areaLabel,
      radiusKm: input.radiusKm,
      sourceKey: input.sourceKey?.trim() || "firms",
      sourceAttribution: input.sourceAttribution ?? "NASA FIRMS",
      ruleLabelKey:
        phase === "observation_ended"
          ? "provenance.rule.watchZone"
          : confirmed
            ? "provenance.rule.dgpcFire"
            : "provenance.rule.probableFire",
      observedAt: input.observedAt,
      authorityStatus: confirmed ? "official" : "probable",
    });
  }

  if (kind === "risk") {
    return buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: input.areaLabel,
      radiusKm: input.radiusKm,
      sourceKey: input.sourceKey?.trim() || "local_fwi",
      sourceAttribution: input.sourceAttribution ?? "Nadhir FWI",
      ruleLabelKey: "provenance.rule.watchZone",
      observedAt: input.observedAt,
      authorityStatus: "model",
    });
  }

  if (kind === "weather" || kind === "onm") {
    return buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: input.areaLabel,
      radiusKm: input.radiusKm,
      sourceKey: "onm",
      sourceAttribution: input.sourceAttribution ?? "ONM · Météo Algérie",
      ruleLabelKey: onmRuleKey(input.severity),
      observedAt: input.observedAt,
      authorityStatus: "official",
    });
  }

  if (
    kind === "authority" ||
    (kind === "official" &&
      (sourceTable === "authority_warnings" ||
        input.sourceKey?.trim().toLowerCase() === "authority"))
  ) {
    return buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: input.areaLabel,
      radiusKm: input.radiusKm,
      sourceKey: "authority",
      sourceAttribution: input.sourceAttribution ?? "Official authority",
      ruleLabelKey: "provenance.rule.civilUpdate",
      observedAt: input.observedAt,
      authorityStatus: "official",
    });
  }

  if (kind === "official") {
    const sourceKey = input.sourceKey?.trim() || "dgpc_telegram";
    const lookupKey = sourceKey.toLowerCase();
    const isDgpc = lookupKey === "dgpc_telegram";
    const resolvedAttribution =
      input.sourceAttribution?.trim() ||
      (Object.hasOwn(KNOWN_SOURCE_ATTRIBUTIONS, lookupKey)
        ? KNOWN_SOURCE_ATTRIBUTIONS[lookupKey]!
        : isDgpc
          ? "DGPC"
          : sourceKey);
    const hazard = input.hazard?.trim().toLowerCase() ?? "";
    const ruleLabelKey: ProvenanceRuleKey = isDgpc
      ? isNonFireOfficialHazard(input.hazard)
        ? "provenance.rule.dgpcNonFire"
        : "provenance.rule.dgpcFire"
      : hazard === "road"
        ? "provenance.rule.roadDanger"
        : "provenance.rule.civilUpdate";
    return buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: input.areaLabel,
      radiusKm: input.radiusKm,
      sourceKey,
      sourceAttribution: resolvedAttribution,
      ruleLabelKey,
      observedAt: input.observedAt,
      authorityStatus: "official",
    });
  }

  if (kind === "road") {
    const rawAttr = input.sourceAttribution?.trim() ?? "";
    const inferredKey =
      input.sourceKey?.trim() ||
      (rawAttr.toLowerCase().includes("tariki")
        ? "tariki_facebook"
        : "ita_facebook");
    return buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: input.areaLabel,
      radiusKm: input.radiusKm,
      sourceKey: inferredKey,
      sourceAttribution: rawAttr || undefined,
      ruleLabelKey: "provenance.rule.roadDanger",
      observedAt: input.observedAt,
      authorityStatus: "observed",
    });
  }

  if (kind === "citizen") {
    return buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: input.areaLabel,
      radiusKm: input.radiusKm,
      sourceKey: input.sourceKey?.trim() || "citizen_reports",
      sourceAttribution: input.sourceAttribution ?? "Citizen report",
      ruleLabelKey: "provenance.rule.watchZone",
      observedAt: input.observedAt,
      authorityStatus: "observed",
    });
  }

  if (kind === "earthquake") {
    const rawAttr = input.sourceAttribution?.trim() ?? "";
    const inferredKey =
      input.sourceKey?.trim() ||
      (rawAttr.toLowerCase().includes("craag") ? "craag" : "emsc");
    return buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: input.areaLabel,
      radiusKm: input.radiusKm,
      sourceKey: inferredKey,
      sourceAttribution: rawAttr || "EMSC",
      ruleLabelKey: quakeRuleKey(input.magnitude, input.severity),
      observedAt: input.observedAt,
      authorityStatus: "observed",
    });
  }

  return buildAlertProvenance({
    triggerKind: "watch_zone",
    areaLabel: input.areaLabel,
    radiusKm: input.radiusKm,
    sourceKey: input.sourceKey?.trim() || "nadhir",
    sourceAttribution: input.sourceAttribution,
    ruleLabelKey: "provenance.rule.watchZone",
    observedAt: input.observedAt,
  });
}

export function provenanceForSelfTest(
  observedAt: string = new Date().toISOString(),
): AlertProvenanceData {
  return buildAlertProvenance({
    triggerKind: "self_test",
    areaLabel: null,
    sourceKey: "nadhir_test",
    sourceAttribution: "Nadhir",
    ruleLabelKey: "provenance.rule.selfTest",
    observedAt,
  });
}

export function formatLocalizedProvenanceDigest(
  data: AlertProvenanceData,
  translate: (key: string, vars?: Record<string, unknown>) => string,
  timeLabel: string,
): string {
  const safeTriggerKind = isAlertTriggerKind(data.triggerKind)
    ? data.triggerKind
    : "national_feed";
  const rawRuleKey =
    typeof data.ruleLabelKey === "string" ? data.ruleLabelKey.trim() : "";
  const candidateRule = rawRuleKey.length > 0 ? translate(rawRuleKey) : "";
  const rule =
    typeof candidateRule === "string" &&
    candidateRule.trim().length > 0 &&
    candidateRule !== rawRuleKey &&
    !UNINTERPOLATED_TOKEN.test(candidateRule)
      ? candidateRule
      : translate("provenance.rule.generic");

  const radiusLabel =
    safeTriggerKind === "watch_zone" && isValidRadiusKm(data.radiusKm)
      ? translate("provenance.radiusKm", { km: data.radiusKm })
      : undefined;

  return formatProvenanceDigestLine(data, {
    trigger: translate(`provenance.trigger.${safeTriggerKind}`),
    rule,
    areaFallback: translate("common.notRecorded"),
    timeLabel,
    radiusLabel,
  });
}
