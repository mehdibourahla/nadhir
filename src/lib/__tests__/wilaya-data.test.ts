import { afterEach, describe, expect, it, vi } from "vitest";

import type { AirportWeather } from "@/lib/airport-weather";
import type { Earthquake } from "@/lib/earthquakes";
import type {
  AdminUnit,
  FireCluster,
  OfficialIncident,
  OnmVigilance,
  RiskForecast,
} from "@/lib/nadhir";
import {
  classifyWilayaFires,
  fetchWilayaSnapshot,
  filterActiveOfficialIncidents,
  filterActiveOnmWarnings,
  filterWilayaEarthquakes,
  selectNearbyAirportWeather,
  summarizeWilayaFireDanger,
} from "@/lib/wilaya-data";
import { wilayaBySlug } from "@/lib/wilaya-slugs";

const NOW_MS = Date.parse("2026-11-25T12:00:00Z");

describe("wilaya-data", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back gracefully without throwing when Supabase env is missing", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");

    const alger = wilayaBySlug("alger")!;
    const snapshot = await fetchWilayaSnapshot(alger, { nowMs: NOW_MS });
    expect(snapshot.wilaya.slug).toBe("alger");
    expect(snapshot.dataStatus).toBe("unavailable");
    expect(snapshot.communes).toEqual([]);
    expect(snapshot.onmWarnings).toEqual([]);
    expect(snapshot.probableFires).toEqual([]);
    expect(snapshot.earthquakes).toEqual([]);
    expect(snapshot.fireDanger).toBeNull();
  });

  it("filters out cancelled, superseded, and expired ONM warnings", () => {
    const base: OnmVigilance = {
      id: "1",
      cap_id: "cap-1",
      title: "Heavy rain",
      event: "Rain",
      severity: "Severe",
      urgency: "Expected",
      certainty: "Likely",
      onset: "2026-11-25T08:00:00Z",
      expires: "2026-11-25T20:00:00Z",
      sent: "2026-11-25T06:00:00Z",
      area_desc: "Alger",
      cap_url: null,
      wilaya_id: "w-16",
      headline_fr: "Pluies",
      superseded_at: null,
      msg_type: "Alert",
      cancelled_at: null,
      superseded_by: null,
    };

    const result = filterActiveOnmWarnings(
      [
        base,
        { ...base, id: "2", cancelled_at: "2026-11-25T10:00:00Z" },
        { ...base, id: "3", superseded_by: "cap-2" },
        { ...base, id: "4", superseded_at: "2026-11-25T09:00:00Z" },
        { ...base, id: "5", msg_type: "Cancel" },
        { ...base, id: "6", expires: "2026-11-25T11:00:00Z" },
      ],
      NOW_MS,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("1");
  });

  it("excludes ADR-0002 uncorroborated heat_signal clusters from probableFires", () => {
    const communeForest: AdminUnit = {
      id: "c-forest",
      level: "commune",
      code: "1501",
      name_ar: "تيزي وزو",
      name_fr: "Tizi Ouzou",
      name_en: "Tizi Ouzou",
      name_kab: "Tizi Wezzu",
      parent_id: "w-15",
      lat: 36.7,
      lon: 4.05,
      forest_fraction: 0.4,
      population: 100000,
    };
    const communeBare: AdminUnit = {
      ...communeForest,
      id: "c-bare",
      code: "1502",
      forest_fraction: 0.01,
    };

    const baseCluster: FireCluster = {
      id: "fc-1",
      short_id: "F1",
      state: "active",
      first_detected_at: "2026-11-25T09:00:00Z",
      last_detected_at: "2026-11-25T11:00:00Z",
      lat: 36.7,
      lon: 4.05,
      detection_count: 3,
      sources: ["firms"],
      max_frp_mw: 20,
      confidence: 80,
      est_area_ha: null,
      fci_growth: null,
      wind_speed_kmh: null,
      wind_dir_deg: null,
      spread_bearing_deg: null,
      wind_gust_kmh: null,
      vpd_kpa: null,
      soil_moisture_m3m3: null,
      commune_id: "c-bare",
      wilaya_id: "w-15",
      nearest_settlement_id: null,
      nearest_settlement_km: null,
      confirmed_at: null,
      resolved_at: null,
      confirmed_mention_id: null,
    };

    const { probableFires, heatSignalCount } = classifyWilayaFires(
      [
        // Single unconfirmed heat signal in bare land -> MUST be excluded from probableFires
        {
          ...baseCluster,
          id: "heat-1",
          state: "unconfirmed",
          commune_id: "c-bare",
        },
        // Detected but low forest & low danger -> still heat_signal!
        { ...baseCluster, id: "heat-2", state: "active", commune_id: "c-bare" },
        // Active in forest -> probable
        {
          ...baseCluster,
          id: "prob-1",
          state: "active",
          commune_id: "c-forest",
        },
        // Officially confirmed -> confirmed
        {
          ...baseCluster,
          id: "conf-1",
          state: "active",
          commune_id: "c-bare",
          confirmed_at: "2026-11-25T10:30:00Z",
        },
      ],
      new Map([
        [communeForest.id, communeForest],
        [communeBare.id, communeBare],
      ]),
      new Map(),
      [] as OfficialIncident[],
    );

    expect(heatSignalCount).toBe(2);
    expect(probableFires.map((f) => [f.id, f.level])).toEqual([
      ["prob-1", "probable"],
      ["conf-1", "confirmed"],
    ]);
  });

  it("excludes state=extinguished unconditionally (even with resolved_at=null) and drops non-finite fire coords", () => {
    const communeForest: AdminUnit = {
      id: "c-forest",
      level: "commune",
      code: "1501",
      name_ar: "تيزي وزو",
      name_fr: "Tizi Ouzou",
      name_en: "Tizi Ouzou",
      name_kab: "Tizi Wezzu",
      parent_id: "w-15",
      lat: 36.7,
      lon: 4.05,
      forest_fraction: 0.4,
      population: 100000,
    };

    const baseCluster: FireCluster = {
      id: "fc-base",
      short_id: "F9",
      state: "active",
      first_detected_at: "2026-11-25T09:00:00Z",
      last_detected_at: "2026-11-25T11:00:00Z",
      lat: 36.7,
      lon: 4.05,
      detection_count: 3,
      sources: ["firms"],
      max_frp_mw: 20,
      confidence: 80,
      est_area_ha: null,
      fci_growth: null,
      wind_speed_kmh: null,
      wind_dir_deg: null,
      spread_bearing_deg: null,
      wind_gust_kmh: null,
      vpd_kpa: null,
      soil_moisture_m3m3: null,
      commune_id: "c-forest",
      wilaya_id: "w-15",
      nearest_settlement_id: null,
      nearest_settlement_km: null,
      confirmed_at: null,
      resolved_at: null,
      confirmed_mention_id: null,
    };

    const { probableFires, heatSignalCount } = classifyWilayaFires(
      [
        {
          ...baseCluster,
          id: "ext-null-resolved",
          state: "extinguished",
          resolved_at: null,
        },
        {
          ...baseCluster,
          id: "nan-coord",
          state: "active",
          lat: Number.NaN,
          lon: Number.NaN,
        },
        {
          ...baseCluster,
          id: "inf-coord",
          state: "active",
          lat: 36.7,
          lon: Number.POSITIVE_INFINITY,
        },
      ],
      new Map([[communeForest.id, communeForest]]),
      new Map(),
      [] as OfficialIncident[],
    );

    expect(probableFires).toEqual([]);
    expect(heatSignalCount).toBe(0);
  });

  it("excludes authority_tier=media (ita_facebook) from filterActiveOfficialIncidents (ADR-0002)", () => {
    const baseIncident: OfficialIncident = {
      id: "inc-dgpc",
      wilaya_id: "w-16",
      commune_id: "c-1601",
      kind: "flood",
      status: "ongoing",
      precision: "commune",
      authority_tier: "national",
      place_text: "Bab El Oued",
      first_reported_at: "2026-11-25T09:00:00Z",
      last_reported_at: "2026-11-25T11:30:00Z",
      as_of: "2026-11-25T11:30:00Z",
      updated_at: "2026-11-25T11:30:00Z",
      unlisted_at: null,
      mention_count: 1,
      evidence: "DGPC flood response",
      commune: null,
      wilaya: {
        name_ar: "الجزائر",
        name_fr: "Alger",
        name_en: "Algiers",
        name_kab: "Dzayer",
        lat: 36.7,
        lon: 3.03,
      },
      latest_mention: null,
    };

    const filtered = filterActiveOfficialIncidents(
      [
        baseIncident,
        {
          ...baseIncident,
          id: "inc-ita-media",
          kind: "road",
          authority_tier: "media",
          evidence: "Info Trafic Algérie post",
        },
      ],
      NOW_MS,
    );

    expect(filtered.map((item) => item.id)).toEqual(["inc-dgpc"]);
  });

  it("matches earthquakes within 100 km and preserves CRAAG/EMSC attribution", () => {
    const alger = wilayaBySlug("alger")!;
    const quakes: Earthquake[] = [
      {
        id: "q-craag",
        occurred_at: "2026-11-25T11:00:00Z",
        lat: 36.75,
        lon: 3.1,
        depth_km: 10,
        magnitude: 4.3,
        magnitude_type: "ML",
        region: "Algiers",
        network: "CRAAG",
        commune_id: null,
        offshore: false,
      },
      {
        id: "q-emsc",
        occurred_at: "2026-11-25T10:00:00Z",
        lat: 36.5,
        lon: 2.9,
        depth_km: 8,
        magnitude: 3.1,
        magnitude_type: "ML",
        region: "Blida",
        network: null,
        commune_id: null,
        offshore: false,
      },
      {
        id: "q-far",
        occurred_at: "2026-11-25T09:00:00Z",
        lat: 26.5,
        lon: -1.3,
        depth_km: 12,
        magnitude: 4.9,
        magnitude_type: "ML",
        region: "Adrar",
        network: "EMSC",
        commune_id: null,
        offshore: false,
      },
      {
        id: "q-nan",
        occurred_at: "2026-11-25T09:00:00Z",
        lat: Number.NaN,
        lon: 3.0,
        depth_km: 10,
        magnitude: 4.5,
        magnitude_type: "ML",
        region: "Bad",
        network: "EMSC",
        commune_id: null,
        offshore: false,
      },
    ];

    const matched = filterWilayaEarthquakes(quakes, alger, new Set());
    expect(matched.map((q) => [q.id, q.attribution])).toEqual([
      ["q-craag", "CRAAG"],
      ["q-emsc", "EMSC"],
    ]);
  });

  it("summarizes worst non-fuel-limited fire danger and handles all-fuel-limited honestly", () => {
    const row = (o: Partial<RiskForecast>): RiskForecast => ({
      id: "r1",
      commune_id: "c1",
      forecast_date: "2026-11-25",
      horizon_days: 0,
      source: "local_fwi",
      fwi: 28,
      fwi_percentile: 75,
      danger_level: 3,
      fuel_limited: false,
      snapshot_id: "s1",
      ...o,
    });

    const summary = summarizeWilayaFireDanger([
      row({
        id: "r1",
        commune_id: "c1",
        danger_level: 5,
        fwi: 55,
        fuel_limited: true,
      }),
      row({
        id: "r2",
        commune_id: "c2",
        danger_level: 4,
        fwi: 40,
        fwi_percentile: 92,
      }),
      row({
        id: "r3",
        commune_id: "c3",
        danger_level: Number.NaN,
        fwi: Number.NaN,
      }),
    ]);

    expect(summary).toEqual({
      dangerLevel: 4,
      fwi: 40,
      percentile: 92,
      communeId: "c2",
      forecastDate: "2026-11-25",
      fuelLimitedCount: 1,
      totalCount: 2,
      allFuelLimited: false,
    });

    const fuelOnly = summarizeWilayaFireDanger([
      row({ id: "r1", fuel_limited: true, danger_level: 5, fwi: 60 }),
    ]);
    expect(fuelOnly?.allFuelLimited).toBe(true);
    expect(fuelOnly?.fuelLimitedCount).toBe(1);
  });

  it("selects only fresh nearby airport METAR observations", () => {
    const alger = wilayaBySlug("alger")!;
    const stations: AirportWeather[] = [
      {
        station: "DAAG",
        name: "Houari Boumediene",
        lat: 36.691,
        lon: 3.215,
        observed_at: "2026-11-25T11:30:00Z",
        temp_c: 19,
        wind_kt: 12,
        gust_kt: 20,
        visibility_m: 10000,
        weather: "RA",
        raw: "METAR DAAG",
      },
      {
        station: "DAOL",
        name: "Stale station",
        lat: 36.7,
        lon: 3.0,
        observed_at: "2026-11-25T05:00:00Z",
        temp_c: 15,
        wind_kt: 5,
        gust_kt: null,
        visibility_m: 10000,
        weather: null,
        raw: "METAR DAOL",
      },
    ];
    const selected = selectNearbyAirportWeather(stations, alger, NOW_MS);
    expect(selected.map((s) => s.station)).toEqual(["DAAG"]);
  });
});
