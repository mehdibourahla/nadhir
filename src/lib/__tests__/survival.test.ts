import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import {
  EMERGENCY_HAZARDS,
  SURVIVAL_AUTO_KM,
  checkInMessage,
  entryStatusKey,
  isOffshoreTsunamiEligible,
  nearestThreat,
  openAreaCriteriaForHazard,
  parseEmergencyHazard,
  positionCard,
  selectEmergencyThreat,
  standingGuidanceForHazard,
} from "@/lib/survival";
import type { Earthquake } from "@/lib/earthquakes";
import type {
  AdminUnit,
  FireCluster,
  OfficialIncident,
  OnmVigilance,
  Settlement,
} from "@/lib/nadhir";

const cluster = (over: Partial<FireCluster>): FireCluster => ({
  id: "c1",
  short_id: "F-1",
  state: "active",
  first_detected_at: "2026-08-29T10:00:00Z",
  last_detected_at: "2026-08-29T12:00:00Z",
  lat: 36.5,
  lon: 4.0,
  detection_count: 3,
  confirmed_at: null,
  confirmed_mention_id: null,
  resolved_at: null,
  sources: ["firms"],
  max_frp_mw: 10,
  confidence: 0.8,
  est_area_ha: 5,
  fci_growth: null,
  wind_speed_kmh: 20,
  wind_dir_deg: 225,
  spread_bearing_deg: null,
  wind_gust_kmh: null,
  vpd_kpa: null,
  soil_moisture_m3m3: null,
  commune_id: null,
  wilaya_id: null,
  nearest_settlement_id: null,
  nearest_settlement_km: null,
  ...over,
});

const wilaya: AdminUnit = {
  id: "w1",
  level: "wilaya",
  code: "15",
  name_ar: "تيزي وزو",
  name_fr: "Tizi Ouzou",
  name_en: "Tizi Ouzou",
  name_kab: "Tizi Wezzu",
  parent_id: null,
  lat: 36.7,
  lon: 4.05,
  forest_fraction: 0,
  population: null,
};

const commune: AdminUnit = {
  id: "u1",
  level: "commune",
  code: "1529",
  name_ar: "آيت بوعدو",
  name_fr: "Aït Bouadou",
  name_en: "Ait Bouadou",
  name_kab: "At Buɛddu",
  parent_id: "w1",
  lat: 36.52,
  lon: 4.05,
  forest_fraction: 0,
  population: null,
};

const settlement: Settlement = {
  id: "s1",
  name: "Aït Bouadou village",
  name_ar: null,
  place_type: "village",
  lat: 36.54,
  lon: 4.05,
  commune_id: "u1",
  population: null,
};

describe("nearestThreat", () => {
  it("picks the nearest live cluster and ignores ended ones", () => {
    const near = cluster({ id: "near", lat: 36.51, lon: 4.0 });
    const far = cluster({ id: "far", lat: 37.5, lon: 5.0 });
    const dead = cluster({
      id: "dead",
      lat: 36.5,
      lon: 4.0,
      state: "extinguished",
    });
    const threat = nearestThreat(36.5, 4.0, [far, dead, near]);
    expect(threat?.cluster.id).toBe("near");
    expect(threat!.km).toBeLessThan(2);
  });

  it("returns null when no live cluster exists", () => {
    expect(
      nearestThreat(36.5, 4.0, [cluster({ state: "false_positive" })]),
    ).toBeNull();
  });

  it("reports bearing from the user toward the fire", () => {
    const west = cluster({ lat: 36.5, lon: 3.9 });
    const threat = nearestThreat(36.5, 4.0, [west]);
    expect(threat!.bearing).toBeGreaterThan(250);
    expect(threat!.bearing).toBeLessThan(290);
  });

  it("flags closing when spread bearing points at the user", () => {
    const towardUser = cluster({ lat: 36.5, lon: 3.9, spread_bearing_deg: 90 });
    const awayFromUser = cluster({
      lat: 36.5,
      lon: 3.9,
      spread_bearing_deg: 270,
    });
    const unknown = cluster({ lat: 36.5, lon: 3.9 });
    expect(nearestThreat(36.5, 4.0, [towardUser])!.closing).toBe(true);
    expect(nearestThreat(36.5, 4.0, [awayFromUser])!.closing).toBe(false);
    expect(nearestThreat(36.5, 4.0, [unknown])!.closing).toBeNull();
  });

  it("keeps the auto-entry radius at 10 km", () => {
    expect(SURVIVAL_AUTO_KM).toBe(10);
  });

  it("treats a distant fire as no threat at all", () => {
    const far = cluster({ lat: 45.0, lon: 20.0 });
    expect(nearestThreat(36.5, 4.0, [far])).toBeNull();
  });
});

describe("positionCard", () => {
  it("names the nearest commune, its wilaya and the nearest settlement", () => {
    const card = positionCard(
      36.521,
      4.052,
      [wilaya, commune],
      [settlement],
      "fr",
    );
    expect(card.commune).toBe("Aït Bouadou");
    expect(card.wilaya).toBe("Tizi Ouzou");
    expect(card.nearest?.name).toBe("Aït Bouadou village");
    expect(card.nearest!.km).toBeGreaterThan(1.5);
    expect(card.nearest!.km).toBeLessThan(2.7);
  });

  it("gives the user's offset from the settlement, not the reverse", () => {
    const card = positionCard(
      36.52,
      4.05,
      [wilaya, commune],
      [settlement],
      "fr",
    );
    expect(card.nearest!.bearing).toBeGreaterThan(150);
    expect(card.nearest!.bearing).toBeLessThan(210);
  });

  it("returns nulls when everything is far away", () => {
    const card = positionCard(28.0, 1.0, [wilaya, commune], [settlement], "fr");
    expect(card.commune).toBeNull();
    expect(card.wilaya).toBeNull();
    expect(card.nearest).toBeNull();
  });

  it("formats coordinates readable aloud", () => {
    const card = positionCard(36.5231, 4.0517, [], [], "en");
    expect(card.coords).toBe("36.5231 N · 4.0517 E");
  });
});

describe("checkInMessage", () => {
  const t = (k: string, o?: Record<string, unknown>) =>
    `${k}|${JSON.stringify(o ?? {})}`;
  const card = positionCard(
    36.521,
    4.052,
    [wilaya, commune],
    [settlement],
    "en",
  );

  it("builds the OK message with place, coords and time", () => {
    const msg = checkInMessage({
      kind: "ok",
      name: "Mehdi",
      card,
      time: "20:48",
      t,
    });
    expect(msg.startsWith("Mehdi: ")).toBe(true);
    expect(msg).toContain("survival.checkin.msgOk");
    expect(msg).toContain("36.5210 N · 4.0520 E");
    expect(msg).toContain("20:48");
  });

  it("uses the assist key for the assistance state", () => {
    const msg = checkInMessage({
      kind: "assist",
      name: null,
      card,
      time: "20:48",
      t,
    });
    expect(msg).toContain("survival.checkin.msgAssist");
    expect(msg.startsWith("survival.")).toBe(true);
  });

  it("falls back to bare coordinates when no place is known", () => {
    const remote = positionCard(28.0, 1.0, [], [], "en");
    const msg = checkInMessage({
      kind: "ok",
      name: null,
      card: remote,
      time: "20:48",
      t,
    });
    expect(msg).toContain("28.0000 N · 1.0000 E");
  });
});

describe("entryStatusKey", () => {
  it("never claims a saved pack or a position it does not have", () => {
    expect(entryStatusKey(false, false, false)).toBe("survival.enterFetching");
    expect(entryStatusKey(false, true, false)).toBe("survival.enterDenied");
    expect(entryStatusKey(true, false, false)).toBe("survival.enterSaving");
    expect(entryStatusKey(true, false, true)).toBe("survival.enterReady");
  });

  it("reports denial even once a stale pack exists", () => {
    expect(entryStatusKey(false, true, true)).toBe("survival.enterDenied");
  });
});

it.each(["ok", "assist"] as const)(
  "builds a manual %s check-in with explicitly unavailable position and no saved location",
  (kind) => {
    const message = checkInMessage({
      kind,
      name: null,
      card: null,
      time: "20:48",
      t: (key, options) =>
        key === "survival.positionUnknown"
          ? "Position unavailable"
          : JSON.stringify(options),
    });
    expect(JSON.parse(message)).toEqual({
      place: "Position unavailable",
      coords: "Position unavailable",
      time: "20:48",
    });
    expect(message).not.toContain("36.5210");
  },
);

describe("hazard-agnostic standing guidance & tsunami gating", () => {
  it("parses valid hazard kinds and defaults unknown inputs to general", () => {
    expect(EMERGENCY_HAZARDS).toEqual([
      "general",
      "fire",
      "flood",
      "earthquake",
      "storm",
    ]);
    expect(parseEmergencyHazard("flood")).toBe("flood");
    expect(parseEmergencyHazard("EARTHQUAKE")).toBe("earthquake");
    expect(parseEmergencyHazard("unknown")).toBe("general");
    expect(parseEmergencyHazard(null)).toBe("general");
  });

  it("gates coastal tsunami guidance strictly on offshore M5.0+ earthquakes", () => {
    expect(isOffshoreTsunamiEligible({ offshore: true, magnitude: 5.0 })).toBe(
      true,
    );
    expect(isOffshoreTsunamiEligible({ offshore: true, magnitude: 5.8 })).toBe(
      true,
    );
    expect(isOffshoreTsunamiEligible({ offshore: true, magnitude: 4.9 })).toBe(
      false,
    );
    expect(isOffshoreTsunamiEligible({ offshore: false, magnitude: 6.4 })).toBe(
      false,
    );
    expect(isOffshoreTsunamiEligible(null)).toBe(false);

    expect(
      standingGuidanceForHazard("earthquake", { offshoreM5Plus: true })
        .coastalTsunamiKey,
    ).toBe("track3.emergency.guidance.earthquake.coastalTsunami");
    expect(
      standingGuidanceForHazard("earthquake", { offshoreM5Plus: false })
        .coastalTsunamiKey,
    ).toBeNull();
    expect(
      standingGuidanceForHazard("flood", { offshoreM5Plus: true })
        .coastalTsunamiKey,
    ).toBeNull();
  });

  it("strictly isolates fire/smoke wording from flood, earthquake, storm and general guidance across all 4 locales", () => {
    const fireOnlyWords =
      /\b(smoke|wildfire|1070|fumée|incendie)\b|دخان|حرائق|dexxan/i;
    for (const locale of ["en", "fr", "ar", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      for (const hazard of [
        "general",
        "flood",
        "earthquake",
        "storm",
      ] as const) {
        const spec = standingGuidanceForHazard(hazard, {
          offshoreM5Plus: hazard === "earthquake",
        });
        const allText = [
          t(spec.titleKey),
          ...spec.items.map((k) => t(k)),
          t(spec.noInstructionKey),
          ...(spec.coastalTsunamiKey ? [t(spec.coastalTsunamiKey)] : []),
        ].join(" ");
        expect(allText, `${locale}/${hazard}`).not.toMatch(fireOnlyWords);
        expect(allText, `${locale}/${hazard}`).not.toContain("\u2014");
      }
    }
  });

  it("never presents fire low-ground criteria for flood or storm open areas", () => {
    const floodCriteria = openAreaCriteriaForHazard("flood");
    expect(floodCriteria.items).toEqual([]);
    expect(floodCriteria.warningNoteKey).toBe(
      "track3.emergency.openAreaCriteria.floodNote",
    );
    expect(floodCriteria.items).not.toContain("survival.areasCriteria3");

    const stormCriteria = openAreaCriteriaForHazard("storm");
    expect(stormCriteria.items).toEqual([]);
    expect(stormCriteria.warningNoteKey).toBe(
      "track3.emergency.openAreaCriteria.stormNote",
    );

    const quakeCriteria = openAreaCriteriaForHazard("earthquake");
    expect(quakeCriteria.items).toHaveLength(3);
    expect(quakeCriteria.warningNoteKey).toBeNull();

    const fireCriteria = openAreaCriteriaForHazard("fire");
    expect(fireCriteria.items).toContain("survival.areasCriteria3");
  });
});

describe("selectEmergencyThreat (multi-hazard on-device evaluation)", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");

  it("detects ongoing DGPC flood incidents nearby", () => {
    const floodIncident = {
      id: "inc-flood",
      wilaya_id: "w1",
      commune_id: "u1",
      kind: "flood",
      status: "ongoing",
      precision: "commune",
      authority_tier: "national",
      place_text: null,
      first_reported_at: "2026-11-25T10:00:00Z",
      last_reported_at: "2026-11-25T11:30:00Z",
      as_of: "2026-11-25T11:30:00Z",
      updated_at: "2026-11-25T11:30:00Z",
      unlisted_at: null,
      mention_count: 1,
      evidence: "DGPC",
      commune: {
        name_ar: commune.name_ar,
        name_fr: commune.name_fr,
        name_en: commune.name_en,
        name_kab: commune.name_kab,
        lat: commune.lat,
        lon: commune.lon,
      },
      wilaya: {
        name_ar: wilaya.name_ar,
        name_fr: wilaya.name_fr,
        name_en: wilaya.name_en,
        name_kab: wilaya.name_kab,
        lat: wilaya.lat,
        lon: wilaya.lon,
      },
      latest_mention: null,
    } as OfficialIncident;

    const threat = selectEmergencyThreat(36.521, 4.052, {
      official: [floodIncident],
      units: [wilaya, commune],
      now,
    });
    expect(threat?.hazard).toBe("flood");
    expect(threat?.offshoreM5Plus).toBeUndefined();
  });

  it("detects offshore M5+ earthquake with offshoreM5Plus=true and inland M6 with offshoreM5Plus=false", () => {
    const offshoreQuake: Earthquake = {
      id: "eq-off",
      magnitude: 5.3,
      magnitude_type: "Mw",
      depth_km: 12,
      lat: 36.8,
      lon: 4.1,
      occurred_at: "2026-11-25T11:20:00Z",
      network: "EMSC",
      region: "NORTHERN ALGERIA COAST",
      commune_id: null,
      offshore: true,
    };
    const offshoreThreat = selectEmergencyThreat(36.521, 4.052, {
      earthquakes: [offshoreQuake],
      units: [wilaya, commune],
      now,
    });
    expect(offshoreThreat?.hazard).toBe("earthquake");
    expect(offshoreThreat?.offshoreM5Plus).toBe(true);

    const inlandThreat = selectEmergencyThreat(36.521, 4.052, {
      earthquakes: [
        { ...offshoreQuake, id: "eq-inland", magnitude: 6.1, offshore: false },
      ],
      units: [wilaya, commune],
      now,
    });
    expect(inlandThreat?.hazard).toBe("earthquake");
    expect(inlandThreat?.offshoreM5Plus).toBe(false);
  });

  it("detects active non-cancelled ONM Severe/Extreme rain or storm warnings for the user's wilaya and ignores cancelled warnings", () => {
    const rainWarning = {
      id: "onm-1",
      wilaya_id: "w1",
      event: "Rain",
      title: "Pluies torrentielles",
      headline_fr: "Pluies intenses sur Tizi Ouzou",
      severity: "Extreme",
      sent: "2026-11-25T10:00:00Z",
      expires: "2026-11-25T20:00:00Z",
      area_desc: "Tizi Ouzou",
      cancelled_at: null,
      superseded_by: null,
      msg_type: "Alert",
    } as unknown as OnmVigilance;

    const activeThreat = selectEmergencyThreat(36.521, 4.052, {
      warnings: [rainWarning],
      units: [wilaya, commune],
      now,
    });
    expect(activeThreat?.hazard).toBe("flood");

    const cancelledThreat = selectEmergencyThreat(36.521, 4.052, {
      warnings: [
        { ...rainWarning, msg_type: "Cancel" } as unknown as OnmVigilance,
      ],
      units: [wilaya, commune],
      now,
    });
    expect(cancelledThreat).toBeNull();
  });
});
