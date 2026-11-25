import {
  LIVE_STATES,
  bearingBetween,
  haversineKm,
  settlementName,
  unitName,
  type AdminUnit,
  type FireCluster,
  type OfficialIncident,
  type OnmVigilance,
  type Settlement,
} from "@/lib/nadhir";
import type { Earthquake } from "@/lib/earthquakes";
import { isFireKind } from "@/lib/text-sources/merge";
import type { Locale } from "@/i18n";

export const EMERGENCY_HAZARDS = [
  "general",
  "fire",
  "flood",
  "earthquake",
  "storm",
] as const;
export type EmergencyHazardKind = (typeof EMERGENCY_HAZARDS)[number];

export function parseEmergencyHazard(value: unknown): EmergencyHazardKind {
  if (typeof value !== "string") return "general";
  const normalized = value.trim().toLowerCase();
  return (EMERGENCY_HAZARDS as readonly string[]).includes(normalized)
    ? (normalized as EmergencyHazardKind)
    : "general";
}

export type EmergencyThreat = {
  hazard: Exclude<EmergencyHazardKind, "general">;
  titleKey: string;
  bodyKey: string;
  sourceKey: string;
  km: number | null;
  bearing: number | null;
  observedAt: string;
  areaLabel: string | null;
  /** Strictly true ONLY for offshore M5.0+ earthquakes. */
  offshoreM5Plus?: boolean;
  magnitude?: number;
  closing?: boolean | null;
};

export type StandingGuidanceSpec = {
  hazard: EmergencyHazardKind;
  titleKey: string;
  items: readonly string[];
  noInstructionKey: string;
  /** Included ONLY when hazard === "earthquake" && offshoreM5Plus === true. */
  coastalTsunamiKey: string | null;
};

export type OpenAreaCriteriaSpec = {
  titleKey: string;
  items: readonly string[];
  warningNoteKey: string | null;
};

export const SURVIVAL_AUTO_KM = 10;
// Beyond this a fire is context, not a threat to this person; showing it would overclaim.
const SURVIVAL_THREAT_KM = 50;
export const SURVIVAL_ACTIVE_KEY = "nadhir.survival.active";
export const SURVIVAL_LAST_CHECK_KEY = "nadhir.survival.lastCheck";
export const SURVIVAL_DISMISS_KEY = "nadhir.survival.dismissed";

const NEARBY_KM = 30;

export type Threat = {
  cluster: FireCluster;
  km: number;
  bearing: number;
  closing: boolean | null;
};

export function nearestThreat(
  lat: number,
  lon: number,
  clusters: FireCluster[],
  maxKm: number = SURVIVAL_THREAT_KM,
): Threat | null {
  let best: { cluster: FireCluster; km: number } | null = null;
  for (const c of clusters) {
    if (!LIVE_STATES.includes(c.state)) continue;
    const km = haversineKm(lat, lon, c.lat, c.lon);
    if (km > maxKm) continue;
    if (!best || km < best.km) best = { cluster: c, km };
  }
  if (!best) return null;
  const { cluster, km } = best;
  const bearing = bearingBetween(lat, lon, cluster.lat, cluster.lon);
  let closing: boolean | null = null;
  if (cluster.spread_bearing_deg !== null) {
    const towardUser = bearingBetween(cluster.lat, cluster.lon, lat, lon);
    const diff = Math.abs(
      ((cluster.spread_bearing_deg - towardUser + 540) % 360) - 180,
    );
    closing = diff <= 60;
  }
  return { cluster, km, bearing, closing };
}

export type PositionCard = {
  commune: string | null;
  wilaya: string | null;
  nearest: { name: string; km: number; bearing: number } | null;
  coords: string;
};

export function formatCoords(lat: number, lon: number) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)} ${ns} · ${Math.abs(lon).toFixed(4)} ${ew}`;
}

export function positionCard(
  lat: number,
  lon: number,
  units: AdminUnit[],
  settlements: Settlement[],
  locale: Locale,
): PositionCard {
  let commune: AdminUnit | null = null;
  let communeKm = Infinity;
  for (const u of units) {
    if (u.level !== "commune") continue;
    const km = haversineKm(lat, lon, u.lat, u.lon);
    if (km < communeKm) {
      commune = u;
      communeKm = km;
    }
  }
  if (communeKm > NEARBY_KM) commune = null;
  const wilaya = commune?.parent_id
    ? (units.find((u) => u.id === commune.parent_id) ?? null)
    : null;

  let nearest: PositionCard["nearest"] = null;
  let nearestKm = Infinity;
  for (const s of settlements) {
    const km = haversineKm(lat, lon, s.lat, s.lon);
    if (km < nearestKm) {
      nearestKm = km;
      // bearing runs place -> user: "2 km south of the village" locates the caller.
      nearest = {
        name: settlementName(s, locale),
        km,
        bearing: bearingBetween(s.lat, s.lon, lat, lon),
      };
    }
  }
  if (nearestKm > NEARBY_KM) nearest = null;

  return {
    commune: commune ? unitName(commune, locale) : null,
    wilaya: wilaya ? unitName(wilaya, locale) : null,
    nearest,
    coords: formatCoords(lat, lon),
  };
}

// the entry sheet claimed GPS and pack work was underway regardless of outcome
export function entryStatusKey(
  hasPosition: boolean,
  denied: boolean,
  hasPack: boolean,
): string {
  if (denied) return "survival.enterDenied";
  if (!hasPosition) return "survival.enterFetching";
  return hasPack ? "survival.enterReady" : "survival.enterSaving";
}

export function checkInMessage(opts: {
  kind: "ok" | "assist";
  name: string | null;
  card: PositionCard | null;
  time: string;
  t: (k: string, o?: Record<string, unknown>) => string;
}): string {
  const { kind, name, card, time, t } = opts;
  const location = card ?? {
    commune: null,
    wilaya: null,
    nearest: null,
    coords: t("survival.positionUnknown"),
  };
  const place = location.nearest
    ? `${location.nearest.name} (${location.nearest.km.toFixed(1)} km)`
    : (location.commune ?? location.coords);
  const body = t(
    kind === "ok" ? "survival.checkin.msgOk" : "survival.checkin.msgAssist",
    { place, coords: location.coords, time },
  );
  return name ? `${name}: ${body}` : body;
}

export function isOffshoreTsunamiEligible(
  quake: Pick<Earthquake, "offshore" | "magnitude"> | null | undefined,
): boolean {
  return Boolean(
    quake &&
    quake.offshore === true &&
    Number.isFinite(quake.magnitude) &&
    quake.magnitude >= 5.0,
  );
}

export function standingGuidanceForHazard(
  hazard: EmergencyHazardKind,
  opts?: { offshoreM5Plus?: boolean },
): StandingGuidanceSpec {
  const noInstructionKey = "track3.emergency.noInstructionNotice";
  switch (hazard) {
    case "fire":
      return {
        hazard: "fire",
        titleKey: "track3.emergency.guidance.fire.title",
        items: [
          "track3.emergency.guidance.fire.step1",
          "track3.emergency.guidance.fire.step2",
          "track3.emergency.guidance.fire.step3",
          "track3.emergency.guidance.fire.step4",
        ],
        noInstructionKey,
        coastalTsunamiKey: null,
      };
    case "flood":
      return {
        hazard: "flood",
        titleKey: "track3.emergency.guidance.flood.title",
        items: [
          "track3.emergency.guidance.flood.step1",
          "track3.emergency.guidance.flood.step2",
          "track3.emergency.guidance.flood.step3",
          "track3.emergency.guidance.flood.step4",
        ],
        noInstructionKey,
        coastalTsunamiKey: null,
      };
    case "earthquake":
      return {
        hazard: "earthquake",
        titleKey: "track3.emergency.guidance.earthquake.title",
        items: [
          "track3.emergency.guidance.earthquake.step1",
          "track3.emergency.guidance.earthquake.step2",
          "track3.emergency.guidance.earthquake.step3",
          "track3.emergency.guidance.earthquake.step4",
        ],
        noInstructionKey,
        coastalTsunamiKey:
          opts?.offshoreM5Plus === true
            ? "track3.emergency.guidance.earthquake.coastalTsunami"
            : null,
      };
    case "storm":
      return {
        hazard: "storm",
        titleKey: "track3.emergency.guidance.storm.title",
        items: [
          "track3.emergency.guidance.storm.step1",
          "track3.emergency.guidance.storm.step2",
          "track3.emergency.guidance.storm.step3",
          "track3.emergency.guidance.storm.step4",
        ],
        noInstructionKey,
        coastalTsunamiKey: null,
      };
    case "general":
    default:
      return {
        hazard: "general",
        titleKey: "track3.emergency.guidance.general.title",
        items: [
          "track3.emergency.guidance.general.step1",
          "track3.emergency.guidance.general.step2",
          "track3.emergency.guidance.general.step3",
        ],
        noInstructionKey,
        coastalTsunamiKey: null,
      };
  }
}

export function openAreaCriteriaForHazard(
  hazard: EmergencyHazardKind,
): OpenAreaCriteriaSpec {
  if (hazard === "fire") {
    return {
      titleKey: "track3.emergency.openAreaCriteria.fireTitle",
      items: [
        "survival.areasCriteria1",
        "survival.areasCriteria2",
        "survival.areasCriteria3",
        "survival.areasCriteria4",
      ],
      warningNoteKey: null,
    };
  }
  if (hazard === "earthquake") {
    return {
      titleKey: "track3.emergency.openAreaCriteria.earthquakeTitle",
      items: [
        "track3.emergency.openAreaCriteria.earthquake1",
        "track3.emergency.openAreaCriteria.earthquake2",
        "track3.emergency.openAreaCriteria.earthquake3",
      ],
      warningNoteKey: null,
    };
  }
  if (hazard === "flood") {
    return {
      titleKey: "track3.emergency.openAreaCriteria.otherTitle",
      items: [],
      warningNoteKey: "track3.emergency.openAreaCriteria.floodNote",
    };
  }
  if (hazard === "storm") {
    return {
      titleKey: "track3.emergency.openAreaCriteria.otherTitle",
      items: [],
      warningNoteKey: "track3.emergency.openAreaCriteria.stormNote",
    };
  }
  return {
    titleKey: "track3.emergency.openAreaCriteria.otherTitle",
    items: [],
    warningNoteKey: "track3.emergency.openAreaCriteria.generalNote",
  };
}

const OFFICIAL_PROMPT_KM = 15;
const OFFICIAL_FRESH_MS = 12 * 3_600_000;
const QUAKE_PROMPT_KM = 100;
const QUAKE_FRESH_MS = 6 * 3_600_000;
const ONM_RAIN_RE =
  /\b(rain|flood|pluie|pluies|inondation|crue)\b|أمطار|فيضان/i;
const ONM_STORM_RE =
  /\b(storm|thunder|wind|gale|sand|orage|vent|tempête|rafale)\b|عاصفة|رعد|رياح/i;

export function selectEmergencyThreat(
  lat: number,
  lon: number,
  input: {
    fires?: FireCluster[];
    official?: OfficialIncident[];
    warnings?: OnmVigilance[];
    earthquakes?: Earthquake[];
    units?: AdminUnit[];
    now?: number;
  },
): EmergencyThreat | null {
  const now = input.now ?? Date.now();
  const units = input.units ?? [];
  const candidates: Array<{
    priority: number;
    distance: number;
    threat: EmergencyThreat;
  }> = [];

  // 1. Active wildfire within SURVIVAL_AUTO_KM (10 km)
  const fireThreat = nearestThreat(
    lat,
    lon,
    input.fires ?? [],
    SURVIVAL_AUTO_KM,
  );
  if (fireThreat && fireThreat.cluster.state === "active") {
    candidates.push({
      priority: 1,
      distance: fireThreat.km,
      threat: {
        hazard: "fire",
        titleKey: "survival.interTitle",
        bodyKey: "survival.interBody",
        sourceKey: "survival.interSatellite",
        km: fireThreat.km,
        bearing: fireThreat.bearing,
        observedAt: fireThreat.cluster.last_detected_at,
        areaLabel: null,
        closing: fireThreat.closing,
      },
    });
  }

  // Nearest commune/wilaya resolved strictly on-device (ADR-0006)
  let nearestCommune: AdminUnit | null = null;
  let nearestCommuneKm = Infinity;
  for (const unit of units) {
    if (unit.level !== "commune") continue;
    const km = haversineKm(lat, lon, unit.lat, unit.lon);
    if (km < nearestCommuneKm) {
      nearestCommune = unit;
      nearestCommuneKm = km;
    }
  }
  if (nearestCommuneKm > NEARBY_KM) nearestCommune = null;
  const userWilayaId = nearestCommune?.parent_id ?? null;

  // 2. Ongoing non-media DGPC official incidents within 15 km & <= 12h fresh
  for (const inc of input.official ?? []) {
    if (inc.status !== "ongoing" || inc.authority_tier === "media") continue;
    const asOfMs = Date.parse(inc.as_of ?? inc.last_reported_at);
    if (
      Number.isNaN(asOfMs) ||
      now - asOfMs > OFFICIAL_FRESH_MS ||
      asOfMs > now
    )
      continue;
    const anchor =
      inc.commune ??
      (inc.commune_id ? units.find((u) => u.id === inc.commune_id) : null) ??
      inc.wilaya ??
      units.find((u) => u.id === inc.wilaya_id);
    if (!anchor) continue;
    const km = haversineKm(lat, lon, anchor.lat, anchor.lon);
    const sameCommune =
      nearestCommune !== null && inc.commune_id === nearestCommune.id;
    if (km > OFFICIAL_PROMPT_KM && !sameCommune) continue;

    const hazard: Exclude<EmergencyHazardKind, "general"> = isFireKind(inc.kind)
      ? "fire"
      : inc.kind === "flood"
        ? "flood"
        : inc.kind === "storm"
          ? "storm"
          : "flood";
    if (inc.kind !== "flood" && inc.kind !== "storm" && !isFireKind(inc.kind)) {
      continue;
    }
    candidates.push({
      priority: 1,
      distance: km,
      threat: {
        hazard,
        titleKey:
          hazard === "fire"
            ? "survival.interTitle"
            : hazard === "flood"
              ? "track3.emergency.prompt.floodTitle"
              : "track3.emergency.prompt.stormTitle",
        bodyKey:
          hazard === "fire"
            ? "survival.interBody"
            : hazard === "flood"
              ? "track3.emergency.prompt.floodBody"
              : "track3.emergency.prompt.stormBody",
        sourceKey: "track3.emergency.prompt.sourceOfficial",
        km,
        bearing: bearingBetween(lat, lon, anchor.lat, anchor.lon),
        observedAt: inc.as_of ?? inc.last_reported_at,
        areaLabel: anchor.name_fr ?? null,
      },
    });
  }

  // 3. Recent M4.0+ earthquakes within 100 km and 6h
  for (const quake of input.earthquakes ?? []) {
    if (!Number.isFinite(quake.magnitude) || quake.magnitude < 4.0) continue;
    const occurredMs = Date.parse(quake.occurred_at);
    if (
      Number.isNaN(occurredMs) ||
      now - occurredMs > QUAKE_FRESH_MS ||
      occurredMs > now
    )
      continue;
    const km = haversineKm(lat, lon, quake.lat, quake.lon);
    if (km > QUAKE_PROMPT_KM) continue;
    const offshoreM5Plus = isOffshoreTsunamiEligible(quake);
    candidates.push({
      priority: quake.magnitude >= 5.0 ? 1 : 2,
      distance: km,
      threat: {
        hazard: "earthquake",
        titleKey: "track3.emergency.prompt.quakeTitle",
        bodyKey: "track3.emergency.prompt.quakeBody",
        sourceKey: "track3.emergency.prompt.sourceSeismic",
        km,
        bearing: bearingBetween(lat, lon, quake.lat, quake.lon),
        observedAt: quake.occurred_at,
        areaLabel: quake.region ?? null,
        offshoreM5Plus,
        magnitude: quake.magnitude,
      },
    });
  }

  // 4. Active non-cancelled ONM Severe/Extreme warnings matching user's wilaya
  if (userWilayaId) {
    for (const warning of input.warnings ?? []) {
      if (warning.wilaya_id !== userWilayaId) continue;
      if (
        warning.cancelled_at ||
        warning.superseded_by ||
        warning.msg_type === "Cancel"
      )
        continue;
      if (!warning.expires || Date.parse(warning.expires) <= now) continue;
      const sev = warning.severity?.trim().toLowerCase() ?? "";
      if (sev !== "extreme" && sev !== "severe") continue;
      const text = `${warning.event ?? ""} ${warning.title ?? ""} ${warning.headline_fr ?? ""}`;
      const hazard: Exclude<EmergencyHazardKind, "general"> | null =
        ONM_RAIN_RE.test(text)
          ? "flood"
          : ONM_STORM_RE.test(text)
            ? "storm"
            : null;
      if (!hazard) continue;
      candidates.push({
        priority: sev === "extreme" ? 3 : 4,
        distance: 0,
        threat: {
          hazard,
          titleKey:
            hazard === "flood"
              ? "track3.emergency.prompt.floodTitle"
              : "track3.emergency.prompt.stormTitle",
          bodyKey:
            hazard === "flood"
              ? "track3.emergency.prompt.floodBody"
              : "track3.emergency.prompt.stormBody",
          sourceKey: "track3.emergency.prompt.sourceOnm",
          km: 0,
          bearing: null,
          observedAt: warning.sent,
          areaLabel: warning.area_desc ?? null,
        },
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
  return candidates[0]!.threat;
}
