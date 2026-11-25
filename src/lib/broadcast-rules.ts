import {
  MIN_CONFIDENCE,
  SETTLEMENT_EMERGENCY_KM,
  downwindOf,
} from "@/lib/alerts-rules";
import { BROADCAST_RING_KM, type CapMsgType } from "@/lib/cap";
import { bearingBetween, haversineKm } from "@/lib/nadhir";
import { isFireKind } from "@/lib/text-sources/merge";
import { isFuelLimited, type LandcoverFractions } from "@/lib/zonal";

export const BROADCAST_END_AFTER_HOURS = 12;
export const BROADCAST_DAILY_COMMUNE_LIMIT = 6;

const HOUR = 3600_000;

export type CommuneShape = {
  code: string;
  lat: number;
  lon: number;
  geom: { type: string; coordinates: unknown } | null;
};

type Ring = [number, number][];

function polygonsOf(geom: CommuneShape["geom"]): Ring[][] {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates as Ring[]];
  if (geom.type === "MultiPolygon") return geom.coordinates as Ring[][];
  return [];
}

function pointInRing(lat: number, lon: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInMultiPolygon(
  lat: number,
  lon: number,
  geom: CommuneShape["geom"],
): boolean {
  for (const rings of polygonsOf(geom)) {
    const [outer, ...holes] = rings;
    if (!outer || !pointInRing(lat, lon, outer)) continue;
    if (!holes.some((h) => pointInRing(lat, lon, h))) return true;
  }
  return false;
}

function kmToSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  const px = ax + t * dx - x;
  const py = ay + t * dy - y;
  return Math.sqrt(px * px + py * py);
}

export function kmToMultiPolygon(
  lat: number,
  lon: number,
  geom: CommuneShape["geom"],
): number {
  const polygons = polygonsOf(geom);
  if (!polygons.length) return Infinity;
  if (pointInMultiPolygon(lat, lon, geom)) return 0;

  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.574;
  let best = Infinity;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        const km = kmToSegment(
          0,
          0,
          (xi - lon) * kx,
          (yi - lat) * ky,
          (xj - lon) * kx,
          (yj - lat) * ky,
        );
        if (km < best) best = km;
      }
    }
  }
  return best;
}

export function targetCommunes(
  fire: { lat: number; lon: number; communeCode: string | null },
  communes: CommuneShape[],
): string[] {
  let containing: string | null = null;
  const ring: { code: string; km: number }[] = [];
  for (const c of communes) {
    if (!containing && pointInMultiPolygon(fire.lat, fire.lon, c.geom)) {
      containing = c.code;
      continue;
    }
    const km = kmToMultiPolygon(fire.lat, fire.lon, c.geom);
    if (km <= BROADCAST_RING_KM) ring.push({ code: c.code, km });
  }
  const head = containing ?? fire.communeCode;
  ring.sort((a, b) => a.km - b.km);
  const codes = ring.map((r) => r.code).filter((code) => code !== head);
  return head ? [head, ...codes] : codes;
}

const EXTREME_MIN_FRP_MW = 20;

const SEVERITY_RANK: Record<string, number> = { Extreme: 2, Severe: 1 };

export function fireSeverity(
  nearestSettlementKm: number | null,
  maxFrpMw: number | null,
): "Extreme" | "Severe" {
  return nearestSettlementKm !== null &&
    nearestSettlementKm <= SETTLEMENT_EMERGENCY_KM &&
    maxFrpMw !== null &&
    maxFrpMw >= EXTREME_MIN_FRP_MW
    ? "Extreme"
    : "Severe";
}

export function downwindAdditions(
  fire: { lat: number; lon: number; spreadBearing: number | null },
  current: string[],
  targets: string[],
  byCode: Map<string, CommuneShape>,
): string[] {
  if (fire.spreadBearing === null) return [];
  const known = new Set(current);
  return targets.filter((code) => {
    if (known.has(code)) return false;
    const commune = byCode.get(code);
    if (!commune) return false;
    return downwindOf(
      fire.spreadBearing,
      bearingBetween(fire.lat, fire.lon, commune.lat, commune.lon),
    );
  });
}

/* A wildfire broadcast for a commune with nothing to burn is a false alarm by
 * construction — the Sahara flares that reach fusion land here. Unknown land
 * cover never masks: absence of data is not evidence of bare ground. */
export function fuelLimitedCodes(
  communes: { code: string; landcover: LandcoverFractions | null }[],
): Set<string> {
  return new Set(
    communes.filter((c) => isFuelLimited(c.landcover)).map((c) => c.code),
  );
}

export const REOPEN_WINDOW_HOURS = 24;

export type OpenThread = {
  phase: string;
  severity: string;
  communeCodes: string[];
  insideCodes: string[];
  atMs: number;
};

export type FirePlan =
  | { action: "initial"; codes: string[]; inside: string[] }
  | { action: "update"; codes: string[]; added: string[]; inside: string[] }
  | { action: "end" }
  | { action: "cancel" }
  | null;

export function planFireBroadcast(args: {
  state: string;
  confidence: number;
  lastDetectedMs: number;
  nowMs: number;
  severity: "Extreme" | "Severe";
  open: OpenThread | null;
  targets: string[];
  additions: string[];
  inside: string[];
  fuelLimited?: Set<string>;
  eligible: boolean;
}): FirePlan {
  const burnable = (codes: string[]) =>
    args.fuelLimited ? codes.filter((c) => !args.fuelLimited!.has(c)) : codes;
  const live =
    args.open && (args.open.phase === "initial" || args.open.phase === "update")
      ? args.open
      : null;
  const reopened =
    args.open &&
    args.open.phase === "end" &&
    args.nowMs - args.open.atMs < REOPEN_WINDOW_HOURS * HOUR
      ? args.open
      : null;

  if (live) {
    if (args.state === "false_positive") return { action: "cancel" };
    if (args.nowMs - args.lastDetectedMs >= BROADCAST_END_AFTER_HOURS * HOUR)
      return { action: "end" };
    if (args.state !== "active" || args.confidence < MIN_CONFIDENCE)
      return null;
    const escalated = live.severity === "Severe" && args.severity === "Extreme";
    const additions = burnable(args.additions);
    const codes = [...live.communeCodes, ...additions];
    const insideNew = burnable(args.inside).filter(
      (c) => codes.includes(c) && !live.insideCodes.includes(c),
    );
    if (additions.length || escalated || insideNew.length)
      return {
        action: "update",
        codes,
        added: additions,
        inside: [...live.insideCodes, ...insideNew],
      };
    return null;
  }

  if (
    args.eligible &&
    args.state === "active" &&
    args.confidence >= MIN_CONFIDENCE
  ) {
    const codes = burnable(args.targets);
    if (!codes.length) return null;
    const fresh = burnable(args.inside).filter((c) => codes.includes(c));
    if (reopened) {
      const kept = reopened.insideCodes.filter((c) => codes.includes(c));
      return {
        action: "update",
        codes,
        added: codes.filter((c) => !reopened.communeCodes.includes(c)),
        inside: [...kept, ...fresh.filter((c) => !kept.includes(c))],
      };
    }
    return { action: "initial", codes, inside: fresh };
  }
  return null;
}

export function applyDailyLimit(
  codes: string[],
  sentToday: Map<string, number>,
  exempt: boolean,
): { allowed: string[]; dropped: string[] } {
  if (exempt) return { allowed: codes, dropped: [] };
  const allowed: string[] = [];
  const dropped: string[] = [];
  for (const code of codes) {
    if ((sentToday.get(code) ?? 0) >= BROADCAST_DAILY_COMMUNE_LIMIT)
      dropped.push(code);
    else allowed.push(code);
  }
  return { allowed, dropped };
}

export function insideCommunes(
  points: { lat: number; lon: number }[],
  codes: string[],
  byCode: Map<string, CommuneShape>,
): string[] {
  return codes.filter((code) => {
    const shape = byCode.get(code);
    return (
      !!shape &&
      points.some((p) => pointInMultiPolygon(p.lat, p.lon, shape.geom))
    );
  });
}

export type Coverage = Map<string, Map<string, 1 | 2>>;

/* Coverage must follow each thread advance within a run, or two clusters
 * sharing a commune both see it uncovered and push it twice. */
export function setThreadCoverage(
  coverage: Coverage,
  clusterId: string,
  thread: OpenThread,
): void {
  for (const byCluster of coverage.values()) byCluster.delete(clusterId);
  if (thread.phase !== "initial" && thread.phase !== "update") return;
  for (const code of thread.communeCodes) {
    const byCluster = coverage.get(code) ?? new Map<string, 1 | 2>();
    byCluster.set(clusterId, thread.insideCodes.includes(code) ? 2 : 1);
    coverage.set(code, byCluster);
  }
}

export function coverageOf(threads: Iterable<[string, OpenThread]>): Coverage {
  const coverage: Coverage = new Map();
  for (const [clusterId, t] of threads)
    setThreadCoverage(coverage, clusterId, t);
  return coverage;
}

function levelElsewhere(
  coverage: Coverage,
  code: string,
  self: string,
): number {
  let best = 0;
  for (const [id, level] of coverage.get(code) ?? [])
    if (id !== self && level > best) best = level;
  return best;
}

/* A push means the commune's alert level rose: a ring-covered commune hears
 * again only when the fire is inside it, and never twice from two clusters. */
export function pushCodesFor(args: {
  clusterId: string;
  action: "initial" | "update" | "end" | "cancel";
  codes: string[];
  inside: string[];
  previous: OpenThread | null;
  coverage: Coverage;
}): string[] {
  if (args.action === "end" || args.action === "cancel")
    return args.codes.filter(
      (code) => levelElsewhere(args.coverage, code, args.clusterId) === 0,
    );
  const mine = (code: string) =>
    args.previous?.insideCodes.includes(code)
      ? 2
      : args.previous?.communeCodes.includes(code)
        ? 1
        : 0;
  return args.codes.filter((code) => {
    const level = args.inside.includes(code) ? 2 : 1;
    return (
      level >
      Math.max(mine(code), levelElsewhere(args.coverage, code, args.clusterId))
    );
  });
}

const ONM_NO_EXPIRY_WINDOW_HOURS = 24;
const ONM_BOILERPLATE_INSTRUCTION = "no additional information.";

const ONM_SEVERITY_RANK: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
};

export type OnmWarning = {
  id: string;
  wilayaId: string;
  event: string;
  severity: string;
  sentMs: number;
  onsetMs: number | null;
  expiresMs: number | null;
  capId?: string;
  msgType?: CapMsgType;
  referencedCapIds?: string[];
  areaDesc?: string | null;
  geocodes?: string[];
  instructionFr?: string | null;
  cancelledAtMs?: number | null;
  supersededBy?: string | null;
};

export type OnmUpdateChangeReason =
  "severity_escalation" | "area_expansion" | "instruction_change";

function validity(w: OnmWarning): { start: number; end: number } {
  const start = w.onsetMs ?? w.sentMs;
  // ONM often omits expires; a warning without one covers a day rather than forever,
  // or one silent reissue would suppress every later warning for that wilaya.
  // This is strictly an internal delivery deadline, never an authority expiry or all-clear.
  return {
    start,
    end: w.expiresMs ?? start + ONM_NO_EXPIRY_WINDOW_HOURS * HOUR,
  };
}

export function onmWarningIsCurrent(w: OnmWarning, now: number): boolean {
  if (
    w.msgType === "Cancel" ||
    w.cancelledAtMs != null ||
    w.supersededBy != null
  )
    return false;
  const { start, end } = validity(w);
  return (
    [w.sentMs, start, end, now].every(Number.isFinite) &&
    w.sentMs <= now &&
    end > start &&
    end > now
  );
}

function normalizeOnmInstruction(raw: string | null | undefined): string {
  if (!raw) return "";
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";
  if (collapsed.toLowerCase() === ONM_BOILERPLATE_INSTRUCTION) return "";
  return collapsed;
}

function normalizeAreaTokens(areaDesc: string | null | undefined): string[] {
  if (!areaDesc) return [];
  return areaDesc
    .split(/[,;/\n]+/)
    .map((part) =>
      part
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, " "),
    )
    .filter(Boolean);
}

function normalizeGeocodes(geocodes: readonly string[] | undefined): string[] {
  if (!geocodes?.length) return [];
  return geocodes.map((g) => g.trim().toUpperCase()).filter(Boolean);
}

/**
 * Evaluates whether an ONM CAP `Update` carries a material change over its prior
 * bulletin(s): severity escalation, area expansion (wilaya, geocode, or areaDesc),
 * or a material non-boilerplate authority instruction change.
 * Identical reissues and de-escalations return `{ material: false, reasons: [] }`.
 */
export function onmUpdateMaterialChange(
  next: OnmWarning,
  priors: readonly OnmWarning[],
): { material: boolean; reasons: OnmUpdateChangeReason[] } {
  if (!priors.length) return { material: false, reasons: [] };

  const reasons: OnmUpdateChangeReason[] = [];

  const nextRank =
    ONM_SEVERITY_RANK[next.severity] ?? SEVERITY_RANK[next.severity] ?? 0;
  const maxPriorRank = Math.max(
    ...priors.map(
      (p) => ONM_SEVERITY_RANK[p.severity] ?? SEVERITY_RANK[p.severity] ?? 0,
    ),
  );
  if (nextRank > maxPriorRank) {
    reasons.push("severity_escalation");
  }

  const priorWilayas = new Set(priors.map((p) => p.wilayaId));
  const nextGeocodes = normalizeGeocodes(next.geocodes);
  const priorGeocodes = new Set(
    priors.flatMap((p) => normalizeGeocodes(p.geocodes)),
  );
  let areaExpanded = !priorWilayas.has(next.wilayaId);
  if (!areaExpanded && priorGeocodes.size > 0 && nextGeocodes.length > 0) {
    areaExpanded = nextGeocodes.some((code) => !priorGeocodes.has(code));
  } else if (!areaExpanded) {
    const nextTokens = normalizeAreaTokens(next.areaDesc);
    const priorTokens = new Set(
      priors.flatMap((p) => normalizeAreaTokens(p.areaDesc)),
    );
    if (nextTokens.length > 0 && priorTokens.size > 0) {
      areaExpanded = nextTokens.some((tok) => !priorTokens.has(tok));
    }
  }
  if (areaExpanded) {
    reasons.push("area_expansion");
  }

  const nextInstruction = normalizeOnmInstruction(next.instructionFr);
  if (nextInstruction) {
    const latestPrior = [...priors].sort((a, b) => b.sentMs - a.sentMs)[0]!;
    const priorInstruction = normalizeOnmInstruction(latestPrior.instructionFr);
    if (nextInstruction !== priorInstruction) {
      reasons.push("instruction_change");
    }
  }

  return { material: reasons.length > 0, reasons };
}

/**
 * Deduplicated union of CAP-referenced priors and overlapping same-(wilaya, event)
 * already-relayed warnings, so chained de-escalations referencing an earlier root
 * Alert still see intermediate Extreme Updates.
 */
export function onmUpdatePriors(
  warning: OnmWarning,
  seen: readonly OnmWarning[],
): OnmWarning[] {
  const refIds = new Set(warning.referencedCapIds ?? []);
  const wv = validity(warning);
  const priors: OnmWarning[] = [];
  const added = new Set<string>();
  for (const p of seen) {
    const matchesRef = p.capId != null && refIds.has(p.capId);
    let overlapsSame = false;
    if (p.wilayaId === warning.wilayaId && p.event === warning.event) {
      const pv = validity(p);
      overlapsSame = pv.start <= wv.end && wv.start <= pv.end;
    }
    if ((matchesRef || overlapsSame) && !added.has(p.id)) {
      added.add(p.id);
      priors.push(p);
    }
  }
  return priors;
}

function covers(previous: OnmWarning, next: OnmWarning): boolean {
  if (previous.wilayaId !== next.wilayaId || previous.event !== next.event)
    return false;
  if (
    (ONM_SEVERITY_RANK[previous.severity] ?? 0) <
    (ONM_SEVERITY_RANK[next.severity] ?? 0)
  )
    return false;
  const a = validity(previous);
  const b = validity(next);
  return a.start <= b.end && b.start <= a.end;
}

/* ONM reissues the same warning every few hours with a fresh CAP id, so dedup on the
 * identity a subscriber perceives — wilaya, event and overlapping validity — not the id.
 * CAP Updates additionally check referenced priors for material changes (escalation,
 * area expansion, or authority instruction change), keeping identical reissues silent. */
export function onmRelayPlan(
  pending: readonly OnmWarning[],
  relayed: readonly OnmWarning[],
): { relay: OnmWarning[]; suppressed: OnmWarning[] } {
  const seen = relayed.filter(
    (w) => w.msgType !== "Cancel" && w.cancelledAtMs == null,
  );
  const relay: OnmWarning[] = [];
  const suppressed: OnmWarning[] = [];
  const candidates = [...pending]
    .filter(
      (w) =>
        w.msgType !== "Cancel" &&
        w.cancelledAtMs == null &&
        w.supersededBy == null,
    )
    .sort((a, b) => a.sentMs - b.sentMs);

  for (const warning of candidates) {
    if (warning.msgType === "Update") {
      const priors = onmUpdatePriors(warning, seen);
      if (priors.length > 0) {
        const change = onmUpdateMaterialChange(warning, priors);
        if (!change.material) {
          suppressed.push(warning);
          continue;
        }
        relay.push(warning);
        seen.push(warning);
        continue;
      }
    }

    if (seen.some((previous) => covers(previous, warning))) {
      suppressed.push(warning);
      continue;
    }
    relay.push(warning);
    seen.push(warning);
  }
  return { relay, suppressed };
}

/* ---------- Feature F8: DGPC Non-Fire Broadcast Policy Gate ---------- */

export const NON_FIRE_BROADCAST_KINDS = [
  "flood",
  "storm",
  "road",
  "structure",
] as const;
export type NonFireBroadcastKind = (typeof NON_FIRE_BROADCAST_KINDS)[number];

export const OFFICIAL_FIRE_FRESH_HOURS = 24;
export const OFFICIAL_NON_FIRE_FRESH_HOURS = 12;

export function isNonFireBroadcastKind(
  kind: string,
): kind is NonFireBroadcastKind {
  return (NON_FIRE_BROADCAST_KINDS as readonly string[]).includes(kind);
}

export function isOfficialBroadcastKind(kind: string): boolean {
  return isFireKind(kind) || isNonFireBroadcastKind(kind);
}

export function squashOfficialText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\u0640/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

export function hasVerbatimOfficialEvidence(
  evidence: string | null | undefined,
  documentBody?: string | null,
): boolean {
  if (!evidence) return false;
  const needle = squashOfficialText(evidence);
  if (needle.length < 8) return false;
  if (documentBody !== undefined) {
    if (!documentBody) return false;
    return squashOfficialText(documentBody).includes(needle);
  }
  return true;
}

const RETROSPECTIVE_SUMMARY_PATTERNS: readonly RegExp[] = [
  /\bbilan\b/i,
  /\br[ée]capitulatif\b/i,
  /\bsynth[èe]se\s+(?:des\s+)?interventions\b/i,
  /\b(?:au\s+cours\s+des|durant\s+les)\s+24\s*(?:h|heures|derni[èe]res\s+heures)\b/i,
  /\bactivit[ée]s?\s+(?:hebdomadaires?|mensuelles?|journali[èe]res?)\b/i,
  /\b(?:retrospective|weekly\s+summary|daily\s+tally|activity\s+summary)\b/i,
  /حصيلة/,
  /ملخص\s+التدخلات/,
  /خلال\s+(?:ال\s*)?24\s*ساعة/,
  /الإحصائيات\s+الأسبوعية/,
];

function normalizeForSummaryCheck(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\u0640/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u0660-\u0669]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x0660 + 48),
    )
    .replace(/[\u06F0-\u06F9]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x06f0 + 48),
    );
}

export function looksRetrospectiveOrSummary(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  const normalized = normalizeForSummaryCheck(text);
  return RETROSPECTIVE_SUMMARY_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

export type OfficialIncidentBroadcastInput = {
  kind: string;
  status: string;
  communeCode: string | null;
  asOfMs: number;
  nowMs: number;
  unlistedAt: string | null;
  sourceKey: string | null;
  authorityTier: string | null;
  evidence: string | null;
  documentBody?: string | null | undefined;
  hasInitialBroadcast: boolean;
  initialDelivered: boolean;
  hasEndBroadcast: boolean;
};

export type OfficialIncidentBroadcastDecision =
  | { action: "initial" }
  | { action: "end" }
  | { action: "suppress"; reason: string };

const ENDED_OFFICIAL_STATUSES = new Set(["cleared", "extinguished"]);

export function evaluateOfficialIncidentBroadcast(
  input: OfficialIncidentBroadcastInput,
): OfficialIncidentBroadcastDecision {
  const isFire = isFireKind(input.kind);
  const isNonFire = isNonFireBroadcastKind(input.kind);
  if (!isFire && !isNonFire) {
    return { action: "suppress", reason: "unsupported_hazard_kind" };
  }

  // Strict media & ITA exclusion per docs/official-notification-policy.md
  if (input.authorityTier === "media") {
    return { action: "suppress", reason: "media_source_excluded" };
  }
  const normalizedSourceKey = input.sourceKey?.trim().toLowerCase() ?? "";
  if (normalizedSourceKey.startsWith("ita")) {
    return { action: "suppress", reason: "ita_source_excluded" };
  }
  if (isNonFire && normalizedSourceKey !== "dgpc_telegram") {
    return { action: "suppress", reason: "unapproved_non_fire_source" };
  }

  if (!input.communeCode || !input.communeCode.trim()) {
    return { action: "suppress", reason: "missing_commune" };
  }

  if (input.unlistedAt !== null) {
    return { action: "suppress", reason: "unlisted_incident" };
  }
  if (!Number.isFinite(input.asOfMs) || !Number.isFinite(input.nowMs)) {
    return { action: "suppress", reason: "invalid_timestamp" };
  }

  const ended = ENDED_OFFICIAL_STATUSES.has(input.status);

  if (input.hasInitialBroadcast) {
    if (input.hasEndBroadcast) {
      return { action: "suppress", reason: "already_closed" };
    }
    if (ended) {
      if (!input.initialDelivered) {
        return { action: "suppress", reason: "cleared_before_delivery" };
      }
      if (isNonFire) {
        if (!hasVerbatimOfficialEvidence(input.evidence, input.documentBody)) {
          return { action: "suppress", reason: "missing_verbatim_evidence" };
        }
        if (
          looksRetrospectiveOrSummary(input.evidence) ||
          looksRetrospectiveOrSummary(input.documentBody)
        ) {
          return { action: "suppress", reason: "retrospective_or_summary" };
        }
      }
      return { action: "end" };
    }
    return { action: "suppress", reason: "already_broadcast" };
  }

  if (ended) {
    return { action: "suppress", reason: "incident_already_ended" };
  }
  if (isNonFire && input.status !== "ongoing") {
    return { action: "suppress", reason: "non_fire_not_ongoing" };
  }

  if (input.asOfMs > input.nowMs) {
    return { action: "suppress", reason: "future_as_of" };
  }
  const maxAgeHours = isFire
    ? OFFICIAL_FIRE_FRESH_HOURS
    : OFFICIAL_NON_FIRE_FRESH_HOURS;
  if (input.nowMs - input.asOfMs > maxAgeHours * HOUR) {
    return { action: "suppress", reason: "stale_incident" };
  }

  if (isNonFire) {
    if (!hasVerbatimOfficialEvidence(input.evidence, input.documentBody)) {
      return { action: "suppress", reason: "missing_verbatim_evidence" };
    }
    if (
      looksRetrospectiveOrSummary(input.evidence) ||
      looksRetrospectiveOrSummary(input.documentBody)
    ) {
      return { action: "suppress", reason: "retrospective_or_summary" };
    }
  } else if (!input.evidence || !input.evidence.trim()) {
    return { action: "suppress", reason: "missing_verbatim_evidence" };
  }

  return { action: "initial" };
}

/* ---------- Feature F9: Accountless M4+ Earthquake Commune Targeting ---------- */

export const EARTHQUAKE_BROADCAST_MIN_MAGNITUDE = 4.0;
export const EARTHQUAKE_PLAUSIBLE_MIN_MAGNITUDE = -2.0;
export const EARTHQUAKE_PLAUSIBLE_MAX_MAGNITUDE = 10.0;
export const EARTHQUAKE_BROADCAST_RADIUS_KM = 100;
export const EARTHQUAKE_BROADCAST_FRESH_HOURS = 6;

export type EarthquakeBroadcastInput = {
  id?: string | null;
  magnitude: number;
  lat?: number | null;
  lon?: number | null;
  occurredMs?: number | null;
  nowMs?: number | null;
  previousMagnitude?: number | null;
  alreadyBroadcast?: boolean;
};

export type EarthquakeBroadcastDecision =
  | {
      action: "publish";
      shouldBroadcast: true;
      send: true;
      retract: false;
      severity: "Extreme" | "Severe";
      reason: "m4_threshold_met" | "upward_revision_crossed_threshold";
    }
  | {
      action: "suppress";
      shouldBroadcast: false;
      send: false;
      retract: false;
      severity: null;
      reason:
        | "invalid_magnitude"
        | "invalid_coordinates"
        | "invalid_timestamp"
        | "future_earthquake"
        | "stale_earthquake"
        | "downward_revision_no_retraction"
        | "already_broadcast"
        | "below_threshold";
    };

export function earthquakeSeverity(magnitude: number): "Extreme" | "Severe" {
  return magnitude >= 5.0 ? "Extreme" : "Severe";
}

/**
 * Pure M4+ earthquake broadcast planner (Feature F9).
 * Enforces finite plausibility bounds, WGS84 bounds when coordinates are
 * provided, freshness bounds when timestamps are provided, single-shot
 * idempotency on upward revisions crossing M4.0, and strict suppression
 * (never retraction) on downward revisions below M4.0.
 */
export function planEarthquakeBroadcast(
  input: EarthquakeBroadcastInput,
): EarthquakeBroadcastDecision {
  const suppress = (
    reason: Extract<
      EarthquakeBroadcastDecision,
      { action: "suppress" }
    >["reason"],
  ): EarthquakeBroadcastDecision => ({
    action: "suppress",
    shouldBroadcast: false,
    send: false,
    retract: false,
    severity: null,
    reason,
  });

  const { magnitude } = input;
  if (
    typeof magnitude !== "number" ||
    !Number.isFinite(magnitude) ||
    magnitude < EARTHQUAKE_PLAUSIBLE_MIN_MAGNITUDE ||
    magnitude > EARTHQUAKE_PLAUSIBLE_MAX_MAGNITUDE
  ) {
    return suppress("invalid_magnitude");
  }

  if (input.lat !== undefined) {
    if (
      typeof input.lat !== "number" ||
      !Number.isFinite(input.lat) ||
      input.lat < -90 ||
      input.lat > 90
    ) {
      return suppress("invalid_coordinates");
    }
  }
  if (input.lon !== undefined) {
    if (
      typeof input.lon !== "number" ||
      !Number.isFinite(input.lon) ||
      input.lon < -180 ||
      input.lon > 180
    ) {
      return suppress("invalid_coordinates");
    }
  }

  if (input.occurredMs !== undefined) {
    if (
      typeof input.occurredMs !== "number" ||
      !Number.isFinite(input.occurredMs)
    ) {
      return suppress("invalid_timestamp");
    }
  }
  if (input.nowMs !== undefined) {
    if (typeof input.nowMs !== "number" || !Number.isFinite(input.nowMs)) {
      return suppress("invalid_timestamp");
    }
  }
  if (typeof input.occurredMs === "number" && typeof input.nowMs === "number") {
    if (input.occurredMs > input.nowMs) {
      return suppress("future_earthquake");
    }
    if (
      input.nowMs - input.occurredMs >
      EARTHQUAKE_BROADCAST_FRESH_HOURS * HOUR
    ) {
      return suppress("stale_earthquake");
    }
  }

  if (input.alreadyBroadcast === true) {
    return suppress(
      magnitude < EARTHQUAKE_BROADCAST_MIN_MAGNITUDE
        ? "downward_revision_no_retraction"
        : "already_broadcast",
    );
  }

  if (magnitude < EARTHQUAKE_BROADCAST_MIN_MAGNITUDE) {
    return suppress("below_threshold");
  }

  const crossedUpward =
    typeof input.previousMagnitude === "number" &&
    Number.isFinite(input.previousMagnitude) &&
    input.previousMagnitude < EARTHQUAKE_BROADCAST_MIN_MAGNITUDE;

  return {
    action: "publish",
    shouldBroadcast: true,
    send: true,
    retract: false,
    severity: earthquakeSeverity(magnitude),
    reason: crossedUpward
      ? "upward_revision_crossed_threshold"
      : "m4_threshold_met",
  };
}

export function targetCommunesForEarthquake(
  quake: { lat: number; lon: number },
  communes: readonly { code: string; lat: number; lon: number }[],
  radiusKm = EARTHQUAKE_BROADCAST_RADIUS_KM,
): string[] {
  if (
    !Number.isFinite(quake.lat) ||
    !Number.isFinite(quake.lon) ||
    !Number.isFinite(radiusKm) ||
    radiusKm < 0
  ) {
    return [];
  }
  const hits: { code: string; km: number }[] = [];
  for (const c of communes) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    const km = haversineKm(quake.lat, quake.lon, c.lat, c.lon);
    if (km <= radiusKm) hits.push({ code: c.code, km });
  }
  hits.sort((a, b) => a.km - b.km || a.code.localeCompare(b.code));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (seen.has(h.code)) continue;
    seen.add(h.code);
    out.push(h.code);
  }
  return out;
}
