import { describe, expect, it } from "vitest";

import {
  parseProvenancePayload,
  validateProvenanceInvariants,
} from "@/lib/alert-provenance";
import {
  hazardAlerts,
  type HazardContext,
  type HazardZone,
} from "@/lib/zone-hazard-alerts";

const zone: HazardZone = {
  id: "z1",
  user_id: "u1",
  name: "Home",
  lat: 36.6,
  lon: 3.1,
  radius_km: 5,
  commune_id: "c1",
  min_danger_level: 1,
  notify_weather: true,
  notify_official: true,
  notify_road: true,
  notify_citizen: true,
  notify_earthquake: true,
};

const context: HazardContext = {
  communes: new Map([["c1", { code: "1601", wilayaId: "w16" }]]),
  weather: [
    {
      id: "onm1",
      severity: "Moderate",
      event: "Thunderstorm",
      onset: "2026-09-25T06:00:00Z",
      title: "Thunderstorm Moderate warning for the wilaya: ALGER",
      headline_fr: "Orages modérés sur Alger",
      polygon: null,
      wilaya_id: "w16",
      expires: "2026-09-25T18:00:00Z",
      alert_key: "weather:onm1:2",
      advice: null,
    },
  ],
  official: [
    {
      id: "dgpc1",
      kind: "vegetation",
      commune_id: null,
      wilaya_id: "w16",
      place_text: "Alger",
      last_reported_at: "2026-09-24T10:00:00Z",
    },
  ],
  authority: [
    {
      id: "auth1",
      source: "Protection Civile",
      body: "Évacuez la route forestière",
      severity: "Severe",
      wilaya_id: "w16",
      commune_codes: null,
      created_at: "2026-09-24T09:00:00Z",
    },
  ],
  road: [
    {
      id: "road1",
      summary: "RN5 fermée à Bab Ezzouar",
      area_id: "c1",
      source_name: "Info Trafic Algérie",
      expires_at: "2026-09-26T09:00:00Z",
    },
  ],
  citizen: [],
  earthquakes: [],
};

const awake = () => ({ locale: "fr", quiet: false, minLevel: 1 });

describe("hazardAlerts", () => {
  it("raises one alert per matching hazard with a stable key and its source", () => {
    const { rows } = hazardAlerts([zone], context, awake);
    expect(rows.map((r) => [r.kind, r.dedupe_key, r.source_table])).toEqual([
      ["weather", "weather:onm1:2", "onm_vigilance"],
      ["official", "official:dgpc1", "official_incidents"],
      ["official", "official:auth1", "authority_warnings"],
      ["road", "road:road1", "civil_publications"],
    ]);
  });

  it("respects each zone switch", () => {
    const { rows } = hazardAlerts(
      [{ ...zone, notify_weather: false, notify_road: false }],
      context,
      awake,
    );
    expect(rows.map((r) => r.kind)).toEqual(["official", "official"]);
  });

  it("holds back road and moderate weather in quiet hours, never official warnings", () => {
    const { rows, suppressed } = hazardAlerts([zone], context, () => ({
      locale: "fr",
      quiet: true,
      minLevel: 1,
    }));
    expect(rows.map((r) => r.kind)).toEqual(["official", "official"]);
    expect(suppressed).toBe(2);
  });

  it("lets an Extreme ONM warning through quiet hours", () => {
    const extreme = {
      ...context,
      weather: [{ ...context.weather[0]!, severity: "Extreme" }],
    };
    const { rows } = hazardAlerts([zone], extreme, () => ({
      locale: "fr",
      quiet: true,
      minLevel: 1,
    }));
    expect(rows.some((r) => r.kind === "weather" && r.severity === 4)).toBe(
      true,
    );
  });

  it("adds Protection Civile's own advice after ONM's words", () => {
    const advised = {
      ...context,
      weather: [
        { ...context.weather[0]!, advice: "Évitez les abords des oueds" },
      ],
    };
    const weather = hazardAlerts([zone], advised, awake).rows.find(
      (r) => r.kind === "weather",
    )!;
    expect(weather.body).toBe(
      "ONM : « Orages modérés sur Alger » Protection civile : « Évitez les abords des oueds »",
    );
  });

  it("quotes ONM's own wording with attribution", () => {
    const { rows } = hazardAlerts([zone], context, awake);
    const weather = rows.find((r) => r.kind === "weather")!;
    expect(weather.body).toContain("ONM");
    expect(weather.body).toContain("Orages modérés sur Alger");
  });

  it("presents a road item as reviewed information, not an order", () => {
    const { rows } = hazardAlerts([zone], context, () => ({
      locale: "en",
      quiet: false,
      minLevel: 1,
    }));
    const road = rows.find((r) => r.kind === "road")!;
    expect(road.body).toContain("RN5 fermée à Bab Ezzouar");
    expect(road.body).toContain("Info Trafic Algérie");
  });

  it("skips hazards that do not concern the zone", () => {
    const elsewhere = {
      ...zone,
      commune_id: "c9",
    };
    const { rows } = hazardAlerts(
      [elsewhere],
      {
        ...context,
        communes: new Map([["c9", { code: "0901", wilayaId: "w09" }]]),
      },
      awake,
    );
    expect(rows).toEqual([]);
  });

  it("records when each hazard stops being current and where it sits on the map", () => {
    const { rows } = hazardAlerts([zone], context, awake);
    expect(
      rows.map((r) => [r.payload["expires_at"], r.payload["map_event"]]),
    ).toEqual([
      ["2026-09-25T18:00:00Z", "weather:onm1"],
      ["2026-09-27T10:00:00.000Z", "official:dgpc1"],
      ["2026-09-25T09:00:00.000Z", undefined],
      ["2026-09-26T09:00:00Z", "civil:road1"],
    ]);
  });

  it("does not re-alert when ONM re-issues an unchanged warning under a new id", () => {
    const reissued = {
      ...context,
      weather: [context.weather[0]!, { ...context.weather[0]!, id: "onm2" }],
    };
    const keys = new Set(
      hazardAlerts([zone], reissued, awake)
        .rows.filter((r) => r.kind === "weather")
        .map((r) => r.dedupe_key),
    );
    expect(keys.size).toBe(1);
  });

  it("alerts again when ONM raises the severity", () => {
    const raised = {
      ...context,
      weather: [
        context.weather[0]!,
        {
          ...context.weather[0]!,
          id: "onm2",
          severity: "Severe",
          alert_key: "weather:onm1:3",
        },
      ],
    };
    const keys = new Set(
      hazardAlerts([zone], raised, awake)
        .rows.filter((r) => r.kind === "weather")
        .map((r) => r.dedupe_key),
    );
    expect(keys.size).toBe(2);
  });

  it("keeps weather below the zone's own level out, but never official or road items", () => {
    const { rows } = hazardAlerts(
      [{ ...zone, min_danger_level: 3 }],
      context,
      awake,
    );
    expect(rows.map((r) => r.kind)).toEqual(["official", "official", "road"]);
  });

  it("applies the account-wide level when it is stricter than the zone's", () => {
    const { rows } = hazardAlerts([zone], context, () => ({
      locale: "fr",
      quiet: false,
      minLevel: 3,
    }));
    expect(rows.some((r) => r.kind === "weather")).toBe(false);
  });

  it("raises one alert per person per hazard when several of their zones cover it", () => {
    const farm = { ...zone, id: "z2", name: "Farm" };
    const { rows } = hazardAlerts([zone, farm], context, awake);
    expect(rows.filter((r) => r.kind === "road")).toHaveLength(1);
    expect(rows.find((r) => r.kind === "road")!.zone_id).toBe("z1");
  });

  it("still alerts two different people about the same hazard", () => {
    const neighbour = { ...zone, id: "z9", user_id: "u2" };
    const { rows } = hazardAlerts([zone, neighbour], context, awake);
    expect(rows.filter((r) => r.kind === "road").map((r) => r.user_id)).toEqual(
      ["u1", "u2"],
    );
  });
});

describe("Protection Civile incidents", () => {
  it("names the hazard the authority reported", () => {
    const flood = {
      ...context,
      weather: [],
      authority: [],
      road: [],
      official: [{ ...context.official[0]!, kind: "flood" }],
    };
    const { rows } = hazardAlerts([zone], flood, () => ({
      locale: "en",
      quiet: false,
      minLevel: 1,
    }));
    expect(rows[0]!.body).toBe("Protection Civile report, Alger: Flooding.");
  });
});

describe("citizen report alerts", () => {
  const flood: HazardContext["citizen"][number] = {
    id: "r1",
    reporter: "u7",
    hazard: "flooding",
    summary: "Water over the road near the market",
    lat: 36.61,
    lon: 3.1,
    expires_at: "2026-09-25T18:00:00Z",
    witnesses: ["u8"],
  };
  const withReport = (over: Partial<typeof flood> = {}) => ({
    ...context,
    weather: [],
    official: [],
    authority: [],
    road: [],
    citizen: [{ ...flood, ...over }],
  });
  const english = () => ({ locale: "en", quiet: false, minLevel: 1 });

  it("pushes a corroborated report inside the zone, labelled as unverified", () => {
    const { rows } = hazardAlerts([zone], withReport(), english);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "citizen",
      dedupe_key: "citizen:r1",
      source_table: "citizen_reports",
      source_id: "r1",
      payload: { witnesses: 1, map_event: "report:r1" },
    });
    expect(rows[0]!.title).toBe("Citizen report near Home: Flooding");
    expect(rows[0]!.body).toBe(
      "“Water over the road near the market” Confirmed by one person nearby. Not verified by authorities.",
    );
  });

  it("stays silent until someone else confirms it, and outside the zone", () => {
    expect(
      hazardAlerts([zone], withReport({ witnesses: [] }), english).rows,
    ).toEqual([]);
    expect(
      hazardAlerts([zone], withReport({ lat: 36.8 }), english).rows,
    ).toEqual([]);
    expect(
      hazardAlerts([{ ...zone, notify_citizen: false }], withReport(), english)
        .rows,
    ).toEqual([]);
  });

  it("never alerts the reporter or a witness about what they already saw", () => {
    const zones = ["u7", "u8", "u9"].map((user_id, i) => ({
      ...zone,
      id: `z${i}`,
      user_id,
    }));
    const { rows } = hazardAlerts(zones, withReport(), english);
    expect(rows.map((r) => r.user_id)).toEqual(["u9"]);
  });

  it("waits for quiet hours to end and names the bare category without a summary", () => {
    const quiet = hazardAlerts([zone], withReport(), () => ({
      locale: "fr",
      quiet: true,
      minLevel: 1,
    }));
    expect(quiet).toEqual({ rows: [], suppressed: 1 });
    const bare = hazardAlerts(
      [zone],
      withReport({ summary: null, witnesses: ["u8", "u9"] }),
      () => ({ locale: "fr", quiet: false, minLevel: 1 }),
    ).rows[0]!;
    expect(bare.title).toBe("Signalement citoyen près de Home : Inondation");
    expect(bare.body).toBe(
      "Confirmé par 2 personnes sur place. Non vérifié par les autorités.",
    );
  });
});

describe("earthquake alerts", () => {
  const quake = {
    id: "20260925_0000100",
    occurred_at: "2026-09-25T10:02:00Z",
    lat: 36.65,
    lon: 3.3,
    magnitude: 4.3,
    network: "CRAAG",
    offshore: false,
  };
  const only = (over: Partial<typeof quake> = {}) => ({
    ...context,
    weather: [],
    official: [],
    authority: [],
    road: [],
    earthquakes: [{ ...quake, ...over }],
  });
  const english = () => ({ locale: "en", quiet: false, minLevel: 1 });

  it("pushes an M4 or stronger earthquake within 100 km, once per event", () => {
    const { rows } = hazardAlerts([zone], only(), english);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "earthquake",
      dedupe_key: "earthquake:20260925_0000100",
      source_table: null,
      payload: { magnitude: 4.3, map_event: "quake:20260925_0000100" },
    });
    expect(rows[0]!.title).toBe("Earthquake M4.3 near Home");
    expect(rows[0]!.body).toContain("CRAAG");
  });

  it("stays silent below M4 or beyond 100 km", () => {
    expect(
      hazardAlerts([zone], only({ magnitude: 3.9 }), english).rows,
    ).toEqual([]);
    expect(hazardAlerts([zone], only({ lat: 35.5 }), english).rows).toEqual([]);
    expect(
      hazardAlerts([{ ...zone, notify_earthquake: false }], only(), english)
        .rows,
    ).toEqual([]);
  });

  it("wakes a sleeping person only from M5", () => {
    const quiet = () => ({ locale: "en", quiet: true, minLevel: 1 });
    expect(hazardAlerts([zone], only(), quiet)).toEqual({
      rows: [],
      suppressed: 1,
    });
    expect(
      hazardAlerts([zone], only({ magnitude: 5.1 }), quiet).rows,
    ).toHaveLength(1);
  });
});

describe("watch-zone hazard alert trigger provenance (F10 + F11)", () => {
  it("embeds valid provenance_* keys on all 6 hazard alert types and hazard kind on official incidents", () => {
    const richContext: HazardContext = {
      ...context,
      weather: [{ ...context.weather[0]!, sent: "2026-09-25T05:30:00Z" }],
      official: [
        context.official[0]!,
        {
          id: "dgpc-flood",
          kind: "flood",
          commune_id: "c1",
          wilaya_id: "w16",
          place_text: "Bab El Oued",
          last_reported_at: "2026-09-24T11:00:00Z",
        },
      ],
      road: [{ ...context.road[0]!, updated_at: "2026-09-24T08:00:00Z" }],
      citizen: [
        {
          id: "r1",
          reporter: "u7",
          hazard: "flooding",
          summary: "Water on road",
          lat: 36.61,
          lon: 3.1,
          expires_at: "2026-09-25T18:00:00Z",
          observed_at: "2026-09-24T12:00:00Z",
          witnesses: ["u8"],
        },
      ],
      earthquakes: [
        {
          id: "eq-1",
          occurred_at: "2026-09-25T10:02:00Z",
          lat: 36.65,
          lon: 3.3,
          magnitude: 4.3,
          network: "EMSC",
          offshore: false,
        },
      ],
    };

    const { rows } = hazardAlerts([zone], richContext, awake);
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      const prov = parseProvenancePayload(row.payload);
      expect(prov, row.dedupe_key).not.toBeNull();
      expect(validateProvenanceInvariants(prov!), row.dedupe_key).toEqual([]);
      expect(prov!.triggerKind).toBe("watch_zone");
      expect(prov!.areaLabel).toBe("Home");
      expect(prov!.radiusKm).toBe(5);
    }

    const dgpcFlood = rows.find((r) => r.dedupe_key === "official:dgpc-flood")!;
    expect(dgpcFlood.payload["hazard"]).toBe("flood");
    expect(dgpcFlood.payload["provenance_rule"]).toBe(
      "provenance.rule.dgpcNonFire",
    );
    const dgpcFire = rows.find((r) => r.dedupe_key === "official:dgpc1")!;
    expect(dgpcFire.payload["hazard"]).toBe("vegetation");
    expect(dgpcFire.payload["provenance_rule"]).toBe(
      "provenance.rule.dgpcFire",
    );
  });
});
