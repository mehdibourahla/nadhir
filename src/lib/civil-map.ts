import {
  fireStage,
  type AdminUnit,
  type FireCluster,
  type OfficialIncident,
  type OnmVigilance,
} from "./nadhir";
import {
  fireConfidence,
  fireLevel,
  hasSightingNear,
  singleCandidateLinks,
  type Confidence,
  type FireLevel,
} from "./fire-confidence";
import type { HazardCategory } from "./civil-map-search";
import type { HazardReport } from "./open-areas";
import {
  isSandstorm,
  STATION_FRESH_HOURS,
  type AirportWeather,
} from "./airport-weather";
import {
  QUAKE_NEARBY_RADIUS_KM,
  QUAKE_WINDOW_HOURS,
  type Earthquake,
} from "./earthquakes";
import type { CivilPublication } from "./civil-publication";
import { parseDestination, parseRoadRef } from "./road-ref";
import { isFireKind } from "./text-sources/merge";
import {
  firePhase,
  isVisibleByDefault,
  officialPhase,
  publicationPhase,
  quakePhase,
  reportPhase,
  warningPhase,
  type Phase,
} from "./incident-lifecycle";

type SituationBase = {
  id: string;
  category: Exclude<HazardCategory, "all">;
  at: string;
  lat: number | null;
  lon: number | null;
  areaId: string | null;
  wilayaId: string | null;
  phase: Phase;
  confidence: Confidence;
  candidate: boolean;
};
export type Situation = SituationBase &
  (
    | { source: "satellite"; data: FireCluster; level: FireLevel }
    | { source: "official"; data: OfficialIncident }
    | { source: "citizen"; data: HazardReport }
    | { source: "onm"; data: OnmVigilance }
    | { source: "civil"; data: CivilPublication }
    | { source: "seismic"; data: Earthquake }
    | { source: "station"; data: AirportWeather }
  );
type SituationInput = {
  fires: FireCluster[];
  official: OfficialIncident[];
  reports: HazardReport[];
  warnings: OnmVigilance[];
  publications?: CivilPublication[];
  earthquakes?: Earthquake[];
  stations?: AirportWeather[];
  danger?: ReadonlyMap<string, number>;
  units: AdminUnit[];
  now: number;
};
type SituationFilters = {
  category: HazardCategory;
  area: AdminUnit | null;
  showEnded: boolean;
  showCandidates: boolean;
};

export const CITIZEN_NEARBY_RADIUS_KM = 20;
// an airport observation speaks for the plain around it, not for the next valley
const STATION_NEARBY_RADIUS_KM = 50;

export function selectedSituation(
  items: Situation[],
  visible: Situation[],
  id?: string,
) {
  return (id?.startsWith("civil:") ? items : visible).find(
    (item) => item.id === id,
  );
}

function coordinates(point: { lat: number; lon: number } | null | undefined) {
  return point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180
    ? { lat: point.lat, lon: point.lon }
    : { lat: null, lon: null };
}

export function buildSituations({
  fires,
  official,
  reports,
  warnings,
  publications = [],
  earthquakes = [],
  stations = [],
  danger = new Map(),
  units,
  now,
}: SituationInput): Situation[] {
  const recent = (at: string, hours: number) => {
    const time = Date.parse(at);
    return time <= now && time >= now - hours * 3_600_000;
  };
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const items: Situation[] = [];
  for (const data of publications) {
    const area = data.area ?? byId.get(data.area_id);
    items.push({
      id: `civil:${data.id}`,
      source: "civil",
      category: data.hazard === "flood" ? "weather" : data.hazard,
      at: data.updated_at,
      ...coordinates(area),
      areaId: data.area_id,
      wilayaId: area?.level === "wilaya" ? area.id : (area?.parent_id ?? null),
      phase: publicationPhase(data, now),
      confidence: "single",
      candidate: false,
      data,
    });
  }
  const linked = singleCandidateLinks(
    official.filter((o) => isFireKind(o.kind)),
    fires,
  );
  for (const data of fires) {
    if (data.state === "false_positive" || !recent(data.last_detected_at, 72))
      continue;
    const level = fireLevel(fireStage(data), {
      forestFraction: data.commune_id
        ? (byId.get(data.commune_id)?.forest_fraction ?? null)
        : null,
      dangerLevel: data.commune_id
        ? (danger.get(data.commune_id) ?? null)
        : null,
      nearbySighting: hasSightingNear(data, reports),
      officialMention: linked.has(data.id),
    });
    items.push({
      id: `fire:${data.id}`,
      source: "satellite",
      category: "fire",
      at: data.last_detected_at,
      ...coordinates(data),
      areaId: data.commune_id ?? data.wilaya_id,
      wilayaId:
        data.wilaya_id ??
        (data.commune_id
          ? (byId.get(data.commune_id)?.parent_id ?? null)
          : null),
      phase: firePhase(data, now),
      confidence: fireConfidence(level),
      candidate: data.state === "unconfirmed" && data.confirmed_at === null,
      data,
      level,
    });
  }
  for (const data of official) {
    if (!recent(data.last_reported_at, 72)) continue;
    const commune =
      data.commune_id && data.precision !== "wilaya"
        ? (data.commune ?? byId.get(data.commune_id))
        : null;
    items.push({
      id: `official:${data.id}`,
      source: "official",
      category: OFFICIAL_CATEGORY[data.kind] ?? "fire",
      at: data.last_reported_at,
      ...coordinates(commune ?? data.wilaya ?? byId.get(data.wilaya_id)),
      areaId: commune ? data.commune_id : data.wilaya_id,
      wilayaId: data.wilaya_id,
      phase: officialPhase(data, now),
      confidence: data.authority_tier === "media" ? "single" : "official",
      candidate: false,
      data,
    });
  }
  for (const data of reports) {
    if (data.status === "rejected" || !recent(data.observed_at, 24)) continue;
    const category = REPORT_CATEGORY[data.hazard ?? ""] ?? "other";
    items.push({
      id: `report:${data.id}`,
      source: "citizen",
      category,
      at: data.observed_at,
      ...coordinates(data),
      areaId: null,
      wilayaId: null,
      phase: reportPhase(data, now),
      confidence: "single",
      candidate: false,
      data,
    });
  }
  for (const data of earthquakes) {
    if (!recent(data.occurred_at, QUAKE_WINDOW_HOURS)) continue;
    items.push({
      id: `quake:${data.id}`,
      source: "seismic",
      category: "earthquake",
      at: data.occurred_at,
      ...coordinates(data),
      areaId: null,
      wilayaId: null,
      phase: quakePhase(data, now),
      confidence: "corroborated",
      candidate: false,
      data,
    });
  }
  for (const data of stations) {
    if (!isSandstorm(data) || !recent(data.observed_at, STATION_FRESH_HOURS))
      continue;
    items.push({
      id: `station:${data.station}`,
      source: "station",
      category: "weather",
      at: data.observed_at,
      ...coordinates(data),
      areaId: null,
      wilayaId: null,
      phase: "live",
      confidence: "corroborated",
      candidate: false,
      data,
    });
  }
  for (const data of warnings) {
    if (
      data.cancelled_at ||
      data.superseded_by ||
      data.msg_type === "Cancel" ||
      !data.expires ||
      !(Date.parse(data.expires) > now) ||
      !(Date.parse(data.sent) <= now)
    )
      continue;
    const area = data.wilaya_id ? byId.get(data.wilaya_id) : null;
    items.push({
      id: `weather:${data.id}`,
      source: "onm",
      category: "weather",
      at: data.sent,
      ...coordinates(area?.level === "wilaya" ? area : null),
      areaId: data.wilaya_id,
      wilayaId: data.wilaya_id,
      phase: warningPhase(data, now),
      confidence: "official",
      candidate: false,
      data,
    });
  }
  return items.sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id),
  );
}

export function situationSummary(items: Situation[]) {
  const live = items.filter((item) => isVisibleByDefault(item.phase));
  // a satellite fire is confirmed by the very DGPC incident listed beside it
  const officialAreas = new Set(
    live.flatMap((item) =>
      item.source === "official" &&
      item.confidence === "official" &&
      item.category === "fire"
        ? [item.areaId]
        : [],
    ),
  );
  const wilayas = new Set<string>();
  const summary = {
    confirmedFires: officialAreas.size,
    probableFires: 0,
    heatSignals: 0,
    warningWilayas: 0,
    roads: 0,
    reports: 0,
  };
  for (const item of live) {
    if (item.source === "satellite") {
      if (item.level === "probable") summary.probableFires += 1;
      else if (item.level === "heat_signal") summary.heatSignals += 1;
      else if (!officialAreas.has(item.areaId)) summary.confirmedFires += 1;
    } else if (item.source === "onm") {
      if (item.data.wilaya_id) wilayas.add(item.data.wilaya_id);
    } else if (
      item.source !== "official" ||
      item.confidence !== "official" ||
      item.category !== "fire"
    )
      summary[item.category === "road" ? "roads" : "reports"] += 1;
  }
  summary.warningWilayas = wilayas.size;
  return summary;
}

export type RoadHint = {
  id: string;
  ref: string;
  anchor: [number, number];
  toward: [number, number] | null;
};

export function roadHints(items: Situation[], units: AdminUnit[]): RoadHint[] {
  return items.flatMap((item) => {
    if (
      item.source !== "civil" ||
      item.category !== "road" ||
      item.phase !== "live" ||
      item.data.area?.level !== "commune"
    )
      return [];
    const ref = parseRoadRef(item.data.summary);
    if (!ref) return [];
    const destination = parseDestination(item.data.summary);
    const place = destination ? findPlaces(units, destination, "fr")[0] : null;
    return [
      {
        id: item.id,
        ref,
        anchor: [item.data.area.lon, item.data.area.lat],
        toward: place ? [place.lon, place.lat] : null,
      },
    ];
  });
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const rad = Math.PI / 180;
  const arc =
    Math.sin(((bLat - aLat) * rad) / 2) ** 2 +
    Math.cos(aLat * rad) *
      Math.cos(bLat * rad) *
      Math.sin(((bLon - aLon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, arc)));
}

export function filterSituations(
  items: Situation[],
  filters: SituationFilters,
  units: AdminUnit[],
): Situation[] {
  const { area } = filters;
  // Citizen locations have no administrative membership: this is proximity, not a boundary claim.
  const anchors = !area
    ? []
    : area.level === "commune"
      ? [area]
      : units.filter(
          (unit) => unit.level === "commune" && unit.parent_id === area.id,
        );
  return items.filter((item) => {
    if (
      (filters.category !== "all" && item.category !== filters.category) ||
      (!filters.showEnded &&
        !isVisibleByDefault(item.phase) &&
        !(item.phase === "fading" && area)) ||
      (!filters.showCandidates && item.candidate)
    )
      return false;
    if (!area) return true;
    if (
      item.source === "citizen" ||
      item.source === "seismic" ||
      item.source === "station"
    ) {
      const radius =
        item.source === "seismic"
          ? QUAKE_NEARBY_RADIUS_KM
          : item.source === "station"
            ? STATION_NEARBY_RADIUS_KM
            : CITIZEN_NEARBY_RADIUS_KM;
      return (
        item.lat !== null &&
        item.lon !== null &&
        anchors.some(
          (anchor) =>
            distanceKm(item.lat!, item.lon!, anchor.lat, anchor.lon) <= radius,
        )
      );
    }
    if (area.level === "wilaya") return item.wilayaId === area.id;
    return (
      item.areaId === area.id ||
      ((item.source === "official" ||
        item.source === "onm" ||
        item.source === "civil") &&
        item.areaId === area.parent_id)
    );
  });
}

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "")
    .toLowerCase()
    .trim();
}

export function findPlaces(
  units: AdminUnit[],
  query: string,
  locale: string,
): AdminUnit[] {
  const needle = normalized(query);
  if (!needle) return [];
  const localName = (unit: AdminUnit) =>
    locale === "ar"
      ? unit.name_ar
      : locale === "en"
        ? unit.name_en
        : locale === "kab"
          ? (unit.name_kab ?? unit.name_fr)
          : unit.name_fr;
  return units
    .filter((unit) =>
      [unit.name_ar, unit.name_fr, unit.name_en, unit.name_kab, unit.code].some(
        (value) => value && normalized(value).includes(needle),
      ),
    )
    .sort(
      (a, b) =>
        normalized(localName(a)).localeCompare(normalized(localName(b))) ||
        a.code.localeCompare(b.code) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 12);
}

const OFFICIAL_CATEGORY: Partial<Record<string, "weather" | "road" | "other">> =
  {
    flood: "weather",
    storm: "weather",
    road: "road",
    structure: "other",
    other: "other",
  };

const REPORT_CATEGORY: Record<
  string,
  "fire" | "weather" | "road" | "earthquake" | "other"
> = {
  fire: "fire",
  flooding: "weather",
  storm_damage: "weather",
  sandstorm: "weather",
  road_blocked: "road",
  landslide: "road",
  snow_ice: "road",
};

export function nearestPlace(
  units: AdminUnit[],
  lat: number,
  lon: number,
): AdminUnit | null {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < 18.9 ||
    lat > 37.2 ||
    lon < -8.7 ||
    lon > 12
  )
    return null;
  let nearest: AdminUnit | null = null;
  let minimum = 50;
  for (const unit of units) {
    if (unit.level !== "commune" || coordinates(unit).lat === null) continue;
    const distance = distanceKm(lat, lon, unit.lat, unit.lon);
    if (
      distance < minimum ||
      (distance === minimum && nearest !== null && unit.id < nearest.id)
    ) {
      nearest = unit;
      minimum = distance;
    }
  }
  return nearest;
}
