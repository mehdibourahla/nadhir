import { describe, expect, it } from "vitest";
import {
  buildSituations,
  countSituationsByHazard,
  filterSituations,
  roadHints,
  situationSummary,
  findPlaces,
  nearestPlace,
  selectedSituation,
} from "../civil-map";
import type {
  AdminUnit,
  FireCluster,
  OfficialIncident,
  OnmVigilance,
} from "../nadhir";
import type { AirportWeather } from "../airport-weather";
import type { Earthquake } from "../earthquakes";
import type { HazardReport } from "../open-areas";

const now = Date.parse("2026-09-16T12:00:00Z");
const at = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
const commune: AdminUnit = {
  id: "c1",
  level: "commune",
  code: "0601",
  name_ar: "بجاية",
  name_fr: "Béjaïa",
  name_en: "Bejaia",
  name_kab: "Bgayet",
  parent_id: "w1",
  lat: 36.75,
  lon: 5.08,
  forest_fraction: 0,
  population: null,
};
const wilaya: AdminUnit = {
  ...commune,
  id: "w1",
  level: "wilaya",
  parent_id: null,
  code: "06",
};
const other: AdminUnit = {
  ...commune,
  id: "c2",
  parent_id: "w2",
  lat: 36,
  lon: 3,
};
const units = [commune, wilaya, other];
const fire = (over: Partial<FireCluster> = {}): FireCluster => ({
  id: "f",
  short_id: "F",
  state: "active",
  first_detected_at: at(5),
  last_detected_at: at(1),
  lat: 36.75,
  lon: 5.08,
  detection_count: 2,
  sources: ["firms"],
  max_frp_mw: null,
  confidence: 80,
  est_area_ha: null,
  fci_growth: null,
  wind_speed_kmh: null,
  wind_dir_deg: null,
  spread_bearing_deg: null,
  wind_gust_kmh: null,
  vpd_kpa: null,
  soil_moisture_m3m3: null,
  commune_id: "c1",
  wilaya_id: "w1",
  nearest_settlement_id: null,
  nearest_settlement_km: null,
  confirmed_at: null,
  confirmed_mention_id: null,
  resolved_at: null,
  ...over,
});
const official = (over: Partial<OfficialIncident> = {}): OfficialIncident => ({
  id: "i",
  wilaya_id: "w1",
  commune_id: "c1",
  kind: "vegetation",
  status: "ongoing",
  precision: "commune",
  authority_tier: "national",
  place_text: null,
  first_reported_at: at(5),
  last_reported_at: at(1),
  as_of: at(1),
  updated_at: at(1),
  unlisted_at: null,
  mention_count: 1,
  evidence: "حريق",
  commune,
  wilaya,
  latest_mention: null,
  ...over,
});
const report = (over: Partial<HazardReport> = {}): HazardReport => ({
  id: "r",
  kind: "sighting",
  hazard: "fire",
  sighting: "flames",
  summary: null,
  lat: 36.75,
  lon: 5.08,
  commune_id: "c1",
  observed_at: at(1),
  created_at: at(1),
  expires_at: null,
  status: "pending",
  witnesses: 0,
  ...over,
});
const warning = (over: Partial<OnmVigilance> = {}): OnmVigilance => ({
  id: "w",
  cap_id: "cap",
  title: "Vigilance",
  event: "Pluie",
  severity: "Severe",
  urgency: "Future",
  certainty: "Likely",
  onset: at(-2),
  expires: at(-10),
  sent: at(1),
  area_desc: "Béjaïa",
  cap_url: null,
  wilaya_id: "w1",
  headline_fr: null,
  superseded_at: null,
  ...over,
});
const build = (over: Partial<Parameters<typeof buildSituations>[0]> = {}) =>
  buildSituations({
    fires: [],
    official: [],
    reports: [],
    warnings: [],
    units,
    now,
    ...over,
  });
const filters = {
  category: "all" as const,
  area: null,
  showEnded: false,
  showCandidates: false,
};

const quake = (over: Partial<Earthquake> = {}): Earthquake => ({
  id: "q1",
  occurred_at: at(2),
  lat: 36.9,
  lon: 5.5,
  depth_km: 10,
  magnitude: 4.2,
  magnitude_type: "ml",
  region: "NORTHERN ALGERIA",
  network: "CRAAG",
  commune_id: "c1",
  offshore: false,
  ...over,
});

describe("airport sandstorms on the map", () => {
  const station = (over: Partial<AirportWeather> = {}): AirportWeather => ({
    station: "DAAE",
    name: "Béjaïa Arpt",
    lat: 36.71,
    lon: 5.07,
    observed_at: at(1),
    temp_c: 30,
    wind_kt: 25,
    gust_kt: 35,
    visibility_m: 600,
    weather: "SA",
    raw: "METAR DAAE 161100Z 36025G35KT 0600 SA 30/05 Q1010",
    ...over,
  });

  it("shows a fresh sandstorm measured at an airport, and nothing for ordinary weather", () => {
    const items = build({
      stations: [
        station({}),
        station({ station: "DAAG", weather: null, visibility_m: 9999 }),
        station({ station: "DAAT", observed_at: at(5) }),
      ],
    });
    expect(
      items
        .filter((i) => i.source === "station")
        .map((i) => [i.id, i.category]),
    ).toEqual([["station:DAAE", "weather"]]);
  });
});

describe("earthquakes on the map", () => {
  it("files an earthquake under its own category, live for hours then fading", () => {
    const items = build({
      earthquakes: [quake({}), quake({ id: "old", occurred_at: at(30) })],
    });
    expect(
      items
        .filter((i) => i.source === "seismic")
        .map((i) => [i.id, i.category, i.phase]),
    ).toEqual([
      ["quake:q1", "earthquake", "live"],
      ["quake:old", "earthquake", "fading"],
    ]);
  });

  it("shows an earthquake felt around an area within 100 km, never by administrative membership", () => {
    const items = build({
      earthquakes: [quake({}), quake({ id: "far", lat: 35, lon: 0 })],
    });
    expect(
      filterSituations(items, { ...filters, area: commune }, units).map(
        (i) => i.id,
      ),
    ).toEqual(["quake:q1"]);
  });
});

describe("civil situations", () => {
  it("keeps reviewed publications available for historical links but excludes inactive publications from current results", () => {
    const publication = {
      id: "p",
      ita_report_id: "r",
      incident_index: 0,
      hazard: "flood" as const,
      summary: "Route inondée",
      area_id: "w1",
      source_name: "Info Trafic Algérie",
      source_url: "https://infotraficalgerie.com/home",
      source_published_at: at(2),
      published_at: at(1),
      updated_at: at(1),
      expires_at: at(-2),
      state: "published" as const,
      revision: 1,
      area: wilaya,
      cap_references: [],
    };
    const items = build({
      publications: [
        publication,
        {
          ...publication,
          id: "expired",
          source_published_at: at(100),
          updated_at: at(100),
          expires_at: at(99),
        },
        {
          ...publication,
          id: "fading",
          source_published_at: at(5),
          updated_at: at(4),
          expires_at: at(3),
        },
        { ...publication, id: "withdrawn", state: "withdrawn" },
      ],
    });
    expect(items).toHaveLength(4);
    expect(filterSituations(items, filters, units).map((i) => i.id)).toEqual([
      "civil:p",
    ]);
    expect(
      filterSituations(items, { ...filters, area: commune }, units).map(
        (i) => i.id,
      ),
    ).toEqual(["civil:p", "civil:fading"]);
    expect(items.find((i) => i.id === "civil:p")).toMatchObject({
      source: "civil",
      category: "flood",
      areaId: "w1",
      wilayaId: "w1",
      lat: wilaya.lat,
    });
    expect(
      filterSituations(items, { ...filters, showEnded: true }, units),
    ).toHaveLength(4);
    expect(selectedSituation(items, [], "civil:expired")?.id).toBe(
      "civil:expired",
    );
    expect(selectedSituation(items, [], "civil:withdrawn")?.phase).toBe(
      "archived",
    );
    expect(selectedSituation(items, [], "civil:missing")).toBeUndefined();
  });
  it("enforces source time windows and rejects invalid or future observations", () => {
    expect(
      build({
        fires: [
          fire(),
          fire({ id: "old", last_detected_at: at(73) }),
          fire({ id: "false", state: "false_positive" }),
          fire({ id: "future", last_detected_at: at(-1) }),
          fire({ id: "invalid", last_detected_at: "bad" }),
        ],
        official: [
          official({ last_reported_at: at(72) }),
          official({ id: "old", last_reported_at: at(73) }),
        ],
        reports: [
          report(),
          report({ id: "old", observed_at: at(25) }),
          report({ id: "rejected", status: "rejected" }),
        ],
      })
        .map((x) => x.id)
        .sort(),
    ).toEqual(["fire:f", "official:i", "report:r"]);
  });
  it("ends only on an authority's word or an operator's closure, never on silence", () => {
    const items = build({
      official: [
        official({ id: "contained", status: "contained" }),
        official({ id: "unlisted", status: "unknown", unlisted_at: at(1) }),
        official({ id: "ended", status: "extinguished" }),
      ],
      fires: [
        fire({ id: "candidate", state: "unconfirmed" }),
        fire({ id: "confirmed", state: "unconfirmed", confirmed_at: at(1) }),
        fire({
          id: "quiet",
          state: "contained_guess",
          last_detected_at: at(8),
        }),
        fire({ id: "silent", state: "extinguished", last_detected_at: at(30) }),
        fire({ id: "closed", state: "extinguished", resolved_at: at(0.5) }),
      ],
    });
    const phase = (id: string) => items.find((x) => x.id === id)?.phase;
    expect(phase("fire:silent")).toBe("archived");
    expect(phase("fire:closed")).toBe("ended");
    expect(phase("official:ended")).toBe("ended");
    expect(phase("official:unlisted")).toBe("fading");
    expect(
      filterSituations(items, filters, units)
        .map((x) => x.id)
        .sort(),
    ).toEqual(["fire:confirmed", "official:contained"]);
    expect(
      filterSituations(items, { ...filters, area: commune }, units)
        .map((x) => x.id)
        .sort(),
    ).toEqual([
      "fire:confirmed",
      "fire:quiet",
      "official:contained",
      "official:unlisted",
    ]);
    expect(
      filterSituations(
        items,
        { ...filters, showEnded: true, showCandidates: true },
        units,
      ),
    ).toHaveLength(8);
  });
  it("ranks every source on one confidence ladder", () => {
    const forested = { ...commune, forest_fraction: 0.4 };
    const desert = { ...other, id: "c3", parent_id: "w1", forest_fraction: 0 };
    const items = buildSituations({
      fires: [
        fire({ id: "forest" }),
        fire({ id: "desert", commune_id: "c3" }),
        fire({ id: "extreme", commune_id: "c3", lat: 36, lon: 3 }),
      ],
      official: [
        official(),
        official({ id: "press", authority_tier: "media" }),
      ],
      reports: [report({ lat: 20, lon: 5 })],
      warnings: [warning()],
      danger: new Map([["c3", 5]]),
      units: [forested, wilaya, desert],
      now,
    });
    const at = (id: string) => items.find((x) => x.id === id);
    expect(at("fire:forest")).toMatchObject({
      confidence: "corroborated",
      level: "probable",
    });
    expect(at("official:i")?.confidence).toBe("official");
    expect(at("official:press")?.confidence).toBe("single");
    expect(at("weather:w")?.confidence).toBe("official");
    expect(at("report:r")?.confidence).toBe("single");
    expect(at("fire:extreme")).toMatchObject({ level: "probable" });
    const withoutDanger = buildSituations({
      fires: [fire({ id: "desert", commune_id: "c3" })],
      official: [],
      reports: [],
      warnings: [],
      units: [forested, wilaya, desert],
      now,
    });
    expect(withoutDanger[0]).toMatchObject({
      confidence: "single",
      level: "heat_signal",
    });
  });
  it("summarises the day's live situations by type and confidence", () => {
    const forested = { ...commune, forest_fraction: 0.4 };
    const desert = { ...other, id: "c3", parent_id: "w1", forest_fraction: 0 };
    const items = buildSituations({
      fires: [
        fire({ id: "probable" }),
        fire({ id: "signal", commune_id: "c3" }),
        fire({ id: "quiet", last_detected_at: at(8) }),
        fire({ id: "confirmed", confirmed_at: at(1) }),
      ],
      official: [official(), official({ id: "old", last_reported_at: at(30) })],
      reports: [
        report({ kind: "road_blocked", hazard: "road_blocked" }),
        report({ id: "r2", lat: 20, lon: 5 }),
      ],
      warnings: [
        warning(),
        warning({ id: "w2" }),
        warning({ id: "w3", wilaya_id: "w9" }),
      ],
      units: [forested, wilaya, desert],
      now,
    });
    expect(situationSummary(items)).toEqual({
      confirmedFires: 1,
      probableFires: 1,
      heatSignals: 1,
      warningWilayas: 2,
      roads: 1,
      reports: 1,
    });
  });
  it("hints a road segment only for a named road at commune level", () => {
    const algiers = {
      ...wilaya,
      id: "w16",
      code: "16",
      name_fr: "Alger",
      name_en: "Algiers",
      lat: 36.75,
      lon: 3.06,
    };
    const publication = (id: string, summary: string, area: AdminUnit) => ({
      id,
      ita_report_id: "r",
      incident_index: 0,
      hazard: "road" as const,
      summary,
      area_id: area.id,
      source_name: "Info Trafic Algérie",
      source_url: "https://infotraficalgerie.com/home",
      source_published_at: at(1),
      published_at: at(1),
      updated_at: at(1),
      expires_at: at(-1),
      state: "published" as const,
      revision: 1,
      area,
      cap_references: [],
    });
    const items = build({
      publications: [
        publication(
          "named",
          "Accident sur la route nationale numéro 12, à Naciria, en direction d'Alger.",
          commune,
        ),
        publication("wilaya", "Accident sur la RN11 (Tipaza).", wilaya),
        publication("unnamed", "Congestion à l'entrée de Béjaïa.", commune),
      ],
      units: [...units, algiers],
    });
    expect(roadHints(items, [...units, algiers])).toEqual([
      {
        id: "civil:named",
        ref: "RN 12",
        anchor: [commune.lon, commune.lat],
        toward: [algiers.lon, algiers.lat],
      },
    ]);
  });
  it("backs a lone satellite fire with a DGPC report naming only its wilaya", () => {
    const desert = { ...other, id: "c3", parent_id: "w1", forest_fraction: 0 };
    const report = official({
      commune_id: null,
      precision: "wilaya",
      first_reported_at: at(1),
    });
    const one = buildSituations({
      fires: [fire({ id: "lone", commune_id: "c3", wilaya_id: "w1" })],
      official: [report],
      reports: [],
      warnings: [],
      units: [commune, wilaya, desert],
      now,
    });
    expect(one.find((x) => x.id === "fire:lone")).toMatchObject({
      level: "probable",
    });
    const two = buildSituations({
      fires: [
        fire({ id: "a", commune_id: "c3", wilaya_id: "w1" }),
        fire({ id: "b", commune_id: "c3", wilaya_id: "w1" }),
      ],
      official: [report],
      reports: [],
      warnings: [],
      units: [commune, wilaya, desert],
      now,
    });
    expect(two.filter((x) => x.source === "satellite")).toEqual([
      expect.objectContaining({ level: "heat_signal" }),
      expect.objectContaining({ level: "heat_signal" }),
    ]);
  });
  it("includes upcoming ONM warnings but excludes expired, undated and unsent warnings", () => {
    const items = build({
      warnings: [
        warning(),
        warning({ id: "expired", expires: at(0) }),
        warning({ id: "missing", expires: null }),
        warning({ id: "future", sent: at(-1) }),
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "weather:w",
      source: "onm",
      category: "weather",
      areaId: "w1",
      lat: 36.75,
    });
    expect(items[0]?.data).toMatchObject({ onset: at(-2) });
  });
  it("keeps missing positions unknown and never infers report admin membership", () => {
    expect(
      build({
        reports: [report({ lat: NaN })],
        warnings: [warning({ wilaya_id: null })],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "report:r",
          lat: null,
          lon: null,
          areaId: null,
          wilayaId: null,
        }),
        expect.objectContaining({
          id: "weather:w",
          lat: null,
          lon: null,
          areaId: null,
        }),
      ]),
    );
  });
  it("files each citizen report under its classified hazard, never defaulting to fire", () => {
    const items = build({
      reports: [
        report({ id: "road", kind: "road_blocked", hazard: "road_blocked" }),
        report({ id: "flood", kind: "flooding", hazard: "flooding" }),
        report({ id: "other", kind: "other", hazard: "hazmat" }),
        report({ id: "unclassified", kind: "other", hazard: null }),
        report({ id: "smoke", sighting: "smoke" }),
      ],
    });
    expect(
      filterSituations(items, { ...filters, category: "flood" }, units).map(
        (x) => x.id,
      ),
    ).toEqual(["report:flood"]);
    expect(
      filterSituations(items, { ...filters, category: "fire" }, units).map(
        (x) => x.id,
      ),
    ).toEqual(["report:smoke"]);
    expect(
      filterSituations(items, { ...filters, category: "road" }, units).map(
        (x) => x.id,
      ),
    ).toEqual(["report:road"]);
  });

  it("matches ONM rain/flood bulletins under both weather and flood filters and counts hazards accurately", () => {
    const items = build({
      official: [official({ id: "off-flood", kind: "flood" })],
      warnings: [
        warning({
          id: "onm-rain",
          event: "Rain",
          title: "Pluies torrentielles",
          headline_fr: "Pluies et inondations sur Alger",
        }),
        warning({
          id: "onm-wind",
          event: "Wind",
          title: "Vents violents",
          headline_fr: "Rafales sur le littoral",
        }),
      ],
    });
    expect(
      filterSituations(items, { ...filters, category: "flood" }, units).map(
        (x) => x.id,
      ),
    ).toEqual(["official:off-flood", "weather:onm-rain"]);
    expect(
      filterSituations(items, { ...filters, category: "weather" }, units).map(
        (x) => x.id,
      ),
    ).toEqual(["weather:onm-rain", "weather:onm-wind"]);
    const counts = countSituationsByHazard(items);
    expect(counts.all).toBe(3);
    expect(counts.flood).toBe(2);
    expect(counts.weather).toBe(2);
    expect(counts.fire).toBe(0);
  });

  it("matches ONM French plurals (Inondations, Crues, Averses) and hamza-less Arabic (امطار, سيول) under flood", () => {
    const items = build({
      warnings: [
        warning({
          id: "onm-inondations",
          event: "Inondations",
          title: "Risque d'inondations",
          headline_fr: "Inondations",
        }),
        warning({
          id: "onm-crues",
          event: "Crues",
          title: "Crues soudaines",
          headline_fr: "Crues",
        }),
        warning({
          id: "onm-averses",
          event: "Averses",
          title: "Fortes averses",
          headline_fr: "Averses",
        }),
        warning({
          id: "onm-ar-nohamza",
          event: "امطار",
          title: "امطار رعدية",
          headline_fr: "امطار",
        }),
        warning({
          id: "onm-ar-suyul",
          event: "سيول",
          title: "سيول وفيضانات",
          headline_fr: "سيول",
        }),
      ],
    });
    expect(
      filterSituations(items, { ...filters, category: "flood" }, units)
        .map((x) => x.id)
        .sort(),
    ).toEqual([
      "weather:onm-ar-nohamza",
      "weather:onm-ar-suyul",
      "weather:onm-averses",
      "weather:onm-crues",
      "weather:onm-inondations",
    ]);
  });
  it("includes wilaya-wide warnings and incidents in a commune without pulling other communes", () => {
    const items = build({
      official: [
        official({ commune_id: null, commune: null, precision: "wilaya" }),
        official({ id: "other", commune_id: "c2", commune: other }),
      ],
      warnings: [warning()],
      fires: [fire({ commune_id: "c2" })],
      reports: [report(), report({ id: "far", lat: 36, lon: 3 })],
    });
    expect(
      filterSituations(items, { ...filters, area: commune }, units)
        .map((x) => x.id)
        .sort(),
    ).toEqual(["official:i", "report:r", "weather:w"]);
    expect(
      filterSituations(items, { ...filters, area: wilaya }, units).some(
        (x) => x.id === "report:far",
      ),
    ).toBe(false);
  });
});

describe("civil places", () => {
  it("searches names in every language with accent-insensitive deterministic bounded results", () => {
    for (const query of ["bejaia", "BÉJAÏA", "بجاية", "bgayet", "0601"])
      expect(findPlaces(units, query, "fr").map((x) => x.id)).toContain("c1");
    expect(findPlaces(units, "   ", "ar")).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...commune,
      id: `c${i}`,
      code: String(i).padStart(2, "0"),
    }));
    expect(findPlaces(many, "bejaia", "fr")).toHaveLength(12);
    expect(findPlaces(many, "bejaia", "fr")).toEqual(
      findPlaces([...many].reverse(), "bejaia", "fr"),
    );
  });
  it("uses only nearby communes and rejects invalid, distant or implausible GPS", () => {
    expect(nearestPlace(units, 36.751, 5.081)?.id).toBe("c1");
    for (const [lat, lon] of [
      [NaN, 5],
      [91, 5],
      [48.85, 2.35],
      [0, 0],
      [24, 8],
    ])
      expect(nearestPlace(units, lat!, lon!)).toBeNull();
    expect(nearestPlace([wilaya], wilaya.lat, wilaya.lon)).toBeNull();
  });
});
