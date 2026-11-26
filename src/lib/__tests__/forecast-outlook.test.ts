import { describe, expect, it } from "vitest";

import {
  airCells,
  algiersDate,
  classifyOnmEvent,
  defaultCommune,
  fireCells,
  nationalRanking,
  onmCells,
  outlookDays,
  weatherCells,
} from "@/lib/forecast-outlook";
import type { Earthquake } from "@/lib/earthquakes";
import type {
  AdminUnit,
  OfficialIncident,
  OnmVigilance,
  RiskForecast,
} from "@/lib/nadhir";

const DAYS = [
  "2026-09-25",
  "2026-09-26",
  "2026-09-27",
  "2026-09-28",
  "2026-09-29",
  "2026-09-30",
];

const warning = (o: Partial<OnmVigilance> = {}): OnmVigilance => ({
  id: "w1",
  cap_id: "cap1",
  title: "t",
  event: "Thunderstorm",
  severity: "Moderate",
  urgency: "Expected",
  certainty: "Likely",
  onset: "2026-09-25T12:00:00Z",
  expires: "2026-09-25T20:00:00Z",
  sent: "2026-09-24T18:00:00Z",
  area_desc: "Batna",
  cap_url: null,
  wilaya_id: "w-batna",
  headline_fr: null,
  superseded_at: null,
  ...o,
});

const forecast = (o: Partial<RiskForecast> = {}): RiskForecast => ({
  id: "f1",
  commune_id: "c1",
  forecast_date: "2026-09-25",
  horizon_days: 0,
  source: "local_fwi",
  fwi: 30,
  fwi_percentile: 80,
  danger_level: 3,
  fuel_limited: false,
  snapshot_id: "s1",
  ...o,
});

const unit = (o: Partial<AdminUnit>): AdminUnit => ({
  id: "x",
  level: "commune",
  code: "0",
  name_ar: "",
  name_fr: "",
  name_en: "",
  name_kab: null,
  parent_id: null,
  lat: 0,
  lon: 0,
  forest_fraction: 0,
  population: null,
  ...o,
});

describe("outlook days", () => {
  it("starts on the Algiers date, which is ahead of UTC late in the evening", () => {
    const lateUtc = Date.parse("2026-09-24T23:30:00Z");
    expect(algiersDate(lateUtc)).toBe("2026-09-25");
    expect(outlookDays(lateUtc)).toEqual(DAYS);
  });
});

describe("ONM cells", () => {
  it("says nothing was issued beyond tomorrow instead of claiming no warning", () => {
    const cells = onmCells([], "w-batna", DAYS);
    expect(cells.slice(0, 2)).toEqual([{ state: "none" }, { state: "none" }]);
    expect(cells.slice(2).every((c) => c.state === "not_issued")).toBe(true);
  });

  it("counts a re-issued warning once and takes the highest severity", () => {
    const cells = onmCells(
      [
        warning({ id: "a" }),
        warning({ id: "b", sent: "2026-09-24T19:00:00Z" }),
        warning({ id: "c", event: "Rain", severity: "Severe" }),
      ],
      "w-batna",
      DAYS,
    );
    expect(cells[0]).toEqual({
      state: "warning",
      level: 3,
      events: ["storm", "rain"],
    });
    expect(cells[1]).toEqual({ state: "none" });
  });

  it("shows a long warning on the later days it covers", () => {
    const cells = onmCells(
      [warning({ expires: "2026-09-27T12:00:00Z" })],
      "w-batna",
      DAYS,
    );
    expect(cells[2]).toMatchObject({ state: "warning", level: 2 });
    expect(cells[3]).toEqual({ state: "not_issued" });
  });

  it("ignores other wilayas", () => {
    expect(onmCells([warning()], "w-other", DAYS)[0]).toEqual({
      state: "none",
    });
  });
});

describe("fire and weather cells", () => {
  it("matches rows by date, not horizon, so a late publication stays aligned", () => {
    const rows = [
      forecast({
        forecast_date: "2026-09-26",
        horizon_days: 2,
        danger_level: 5,
        components: { temp_c: 31, wind_kmh: 22, rain_mm: 0 },
      }),
    ];
    expect(fireCells(rows, DAYS)[0]).toBeNull();
    expect(fireCells(rows, DAYS)[1]).toMatchObject({ level: 5 });
    expect(weatherCells(rows, DAYS)[1]).toEqual({
      tempC: 31,
      windKmh: 22,
      rainMm: 0,
    });
    expect(weatherCells([forecast({ components: null })], DAYS)[0]).toBeNull();
  });
});

describe("air cells", () => {
  const hours = (day: string, n: number, pm25: number, pm10: number) => ({
    time: Array.from(
      { length: n },
      (_, h) => `${day}T${String(h).padStart(2, "0")}:00`,
    ),
    pm2_5: Array(n).fill(pm25),
    pm10: Array(n).fill(pm10),
  });

  it("rates a full day by its 24 h means and names the pollutant that set the level", () => {
    const cells = airCells(hours("2026-09-25", 24, 10, 90), DAYS);
    expect(cells[0]).toEqual({
      state: "ok",
      level: "high",
      pollutant: "pm10",
      pm25: 10,
      pm10: 90,
    });
  });

  it("refuses a day with fewer than 24 model hours", () => {
    const partial = hours("2026-09-25", 23, 10, 10);
    const withGap = hours("2026-09-26", 24, 10, 10);
    withGap.pm10[5] = null as unknown as number;
    const cells = airCells(
      {
        time: [...partial.time, ...withGap.time],
        pm2_5: [...partial.pm2_5, ...withGap.pm2_5],
        pm10: [...partial.pm10, ...withGap.pm10],
      },
      DAYS,
    );
    expect(cells[0]).toEqual({ state: "beyond" });
    expect(cells[1]).toEqual({ state: "beyond" });
  });
});

describe("national ranking", () => {
  const units = [
    unit({ id: "w-batna", level: "wilaya", code: "05" }),
    unit({ id: "w-tizi", level: "wilaya", code: "15" }),
    unit({ id: "w-oran", level: "wilaya", code: "31" }),
    unit({ id: "c-batna", parent_id: "w-batna", population: 300 }),
    unit({ id: "c-tizi-a", parent_id: "w-tizi", population: 100 }),
    unit({ id: "c-tizi-b", parent_id: "w-tizi", population: 900 }),
    unit({ id: "c-oran", parent_id: "w-oran", population: 800 }),
  ];

  it("ranks wilayas by their worst hazard and points each at a commune", () => {
    const rows = nationalRanking(
      units,
      [
        forecast({ commune_id: "c-tizi-a", danger_level: 5 }),
        forecast({
          commune_id: "c-tizi-b",
          danger_level: 5,
          fuel_limited: true,
        }),
        forecast({ commune_id: "c-oran", danger_level: 2 }),
      ],
      [warning({ severity: "Severe" })],
      DAYS,
    );
    expect(rows.map((r) => [r.wilaya.id, r.level, r.targetCommuneId])).toEqual([
      ["w-tizi", 5, "c-tizi-a"],
      ["w-batna", 3, "c-batna"],
    ]);
    expect(rows[1]!.weather).toEqual({ level: 3, events: ["storm"] });
    expect(rows[1]!.fire).toBeNull();
  });

  it("is empty on a quiet day", () => {
    expect(nationalRanking(units, [], [], DAYS)).toEqual([]);
  });
});

describe("default commune", () => {
  const communes = [
    unit({ id: "c1", code: "1601" }),
    unit({ id: "c2", code: "1502" }),
    unit({ id: "c3", code: "3101" }),
  ];
  const zones = [
    { commune_id: "c3", created_at: "2026-09-20T00:00:00Z" },
    { commune_id: null, created_at: "2026-09-01T00:00:00Z" },
    { commune_id: "c2", created_at: "2026-09-10T00:00:00Z" },
  ];

  it("prefers the link, then the oldest zone with a commune, then this device", () => {
    expect(defaultCommune(communes, "1601", zones, "c3")?.id).toBe("c1");
    expect(defaultCommune(communes, undefined, zones, "c3")?.id).toBe("c2");
    expect(defaultCommune(communes, undefined, [], "c3")?.id).toBe("c3");
  });

  it("shows nobody's place rather than an arbitrary one", () => {
    expect(defaultCommune(communes, undefined, [], null)).toBeNull();
    expect(defaultCommune(communes, "9999", zones, "c3")).toBeNull();
  });
});

describe("M3B winter multi-hazard & finite guards", () => {
  it("classifies winter ONM hazards (snow, cold, flood, wind, waves, fog) in EN/FR/AR", () => {
    expect(classifyOnmEvent("Snow")).toBe("snow");
    expect(classifyOnmEvent("Other", "Chutes de neige sur les reliefs")).toBe(
      "snow",
    );
    expect(classifyOnmEvent("Other", "تساقط ثلوج")).toBe("snow");
    expect(classifyOnmEvent("Cold", "Vague de froid")).toBe("cold");
    expect(classifyOnmEvent("Flood", "Inondations locales")).toBe("flood");
    expect(classifyOnmEvent("Other", "سيول وفيضانات")).toBe("flood");
    expect(classifyOnmEvent("Waves", "Mer forte et vagues")).toBe("waves");
    expect(classifyOnmEvent("Fog", "Brouillard dense")).toBe("fog");
    expect(classifyOnmEvent("Wind", "Vents violents")).toBe("wind");
    expect(classifyOnmEvent("UnknownEvent")).toBe("other");
  });

  it("rejects NaN and Infinity in fireCells and weatherCells instead of rendering broken values", () => {
    const badWeather = forecast({
      forecast_date: DAYS[0]!,
      components: { temp_c: Number.NaN, wind_kmh: 15, rain_mm: 2 },
    });
    const infWeather = forecast({
      forecast_date: DAYS[1]!,
      components: {
        temp_c: 20,
        wind_kmh: Number.POSITIVE_INFINITY,
        rain_mm: 0,
      },
    });
    expect(weatherCells([badWeather, infWeather], DAYS)[0]).toBeNull();
    expect(weatherCells([badWeather, infWeather], DAYS)[1]).toBeNull();

    const badFire = forecast({
      forecast_date: DAYS[0]!,
      fwi: Number.NaN,
      danger_level: 4,
    });
    expect(fireCells([badFire], DAYS)[0]).toBeNull();
  });

  it("includes active official DGPC flood/road incidents and M4+ earthquakes in nationalRanking", () => {
    const nowMs = Date.parse("2026-09-25T12:00:00Z");
    const units = [
      unit({
        id: "w-alger",
        level: "wilaya",
        code: "16",
        lat: 36.7,
        lon: 3.03,
      }),
      unit({
        id: "w-bejaia",
        level: "wilaya",
        code: "06",
        lat: 36.75,
        lon: 5.06,
      }),
      unit({ id: "c-alger", parent_id: "w-alger", population: 500 }),
      unit({ id: "c-bejaia", parent_id: "w-bejaia", population: 400 }),
    ];

    const floodIncident: OfficialIncident = {
      id: "inc-flood",
      wilaya_id: "w-alger",
      commune_id: "c-alger",
      kind: "flood",
      status: "ongoing",
      precision: "commune",
      authority_tier: "national",
      place_text: "Bab El Oued",
      first_reported_at: "2026-09-25T10:00:00Z",
      last_reported_at: "2026-09-25T11:00:00Z",
      as_of: "2026-09-25T11:00:00Z",
      updated_at: "2026-09-25T11:00:00Z",
      unlisted_at: null,
      mention_count: 1,
      evidence: "DGPC flood intervention",
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

    const m5Quake: Earthquake = {
      id: "q-5",
      occurred_at: "2026-09-25T09:00:00Z",
      lat: 36.75,
      lon: 5.06,
      depth_km: 10,
      magnitude: 5.2,
      magnitude_type: "ML",
      region: "Bejaia",
      network: "CRAAG",
      commune_id: "c-bejaia",
      offshore: false,
    };

    const rows = nationalRanking(
      units,
      [],
      [],
      DAYS,
      [floodIncident],
      [m5Quake],
      nowMs,
    );
    expect(
      rows.map((r) => [
        r.wilaya.code,
        r.level,
        r.incidents,
        r.quake?.magnitude ?? null,
      ]),
    ).toEqual([
      ["06", 5, 0, 5.2],
      ["16", 4, 1, null],
    ]);
  });

  it("keeps ONM warnings active even when model weather reports 0 mm rain (ADR-0002)", () => {
    const cells = onmCells(
      [warning({ event: "Snow", severity: "Extreme", wilaya_id: "w-batna" })],
      "w-batna",
      DAYS,
    );
    const wCells = weatherCells(
      [
        forecast({
          forecast_date: DAYS[0]!,
          components: { temp_c: 10, wind_kmh: 5, rain_mm: 0 },
        }),
      ],
      DAYS,
    );
    expect(cells[0]).toEqual({ state: "warning", level: 4, events: ["snow"] });
    expect(wCells[0]).toEqual({ tempC: 10, windKmh: 5, rainMm: 0 });
  });

  it("fails closed on invalid ONM expires or onset timestamps across all 6 outlook days", () => {
    const badExpires = onmCells(
      [warning({ expires: "not-a-valid-date", severity: "Severe" })],
      "w-batna",
      DAYS,
    );
    expect(badExpires.some((c) => c.state === "warning")).toBe(false);
    expect(badExpires.slice(0, 2)).toEqual([
      { state: "none" },
      { state: "none" },
    ]);
    expect(badExpires.slice(2).every((c) => c.state === "not_issued")).toBe(
      true,
    );

    const badOnset = onmCells(
      [warning({ onset: "not-a-valid-date", severity: "Extreme" })],
      "w-batna",
      DAYS,
    );
    expect(badOnset.some((c) => c.state === "warning")).toBe(false);

    const badSentFallback = onmCells(
      [
        warning({
          onset: null,
          sent: "not-a-valid-date",
          severity: "Extreme",
        }),
      ],
      "w-batna",
      DAYS,
    );
    expect(badSentFallback.some((c) => c.state === "warning")).toBe(false);
  });

  it("fails closed on invalid earthquake occurred_at timestamps in nationalRanking", () => {
    const nowMs = Date.parse("2026-09-25T12:00:00Z");
    const units = [
      unit({
        id: "w-alger",
        level: "wilaya",
        code: "16",
        lat: 36.7,
        lon: 3.03,
      }),
      unit({ id: "c-alger", parent_id: "w-alger", population: 500 }),
    ];
    const invalidDateQuake: Earthquake = {
      id: "q-bad-date",
      occurred_at: "not-a-date",
      lat: 36.7,
      lon: 3.03,
      depth_km: 10,
      magnitude: 5.5,
      magnitude_type: "ML",
      region: "Algiers",
      network: "EMSC",
      commune_id: "c-alger",
      offshore: false,
    };

    expect(
      nationalRanking(units, [], [], DAYS, [], [invalidDateQuake], nowMs),
    ).toEqual([]);
  });
});
