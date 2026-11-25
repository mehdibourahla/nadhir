import { describe, expect, it } from "vitest";

import {
  BROADCAST_DAILY_COMMUNE_LIMIT,
  EARTHQUAKE_BROADCAST_RADIUS_KM,
  applyDailyLimit,
  coverageOf,
  downwindAdditions,
  earthquakeSeverity,
  evaluateOfficialIncidentBroadcast,
  setThreadCoverage,
  fireSeverity,
  insideCommunes,
  onmRelayPlan,
  onmWarningIsCurrent,
  kmToMultiPolygon,
  planEarthquakeBroadcast,
  planFireBroadcast,
  pointInMultiPolygon,
  pushCodesFor,
  fuelLimitedCodes,
  targetCommunes,
  targetCommunesForEarthquake,
  type CommuneShape,
  type OfficialIncidentBroadcastInput,
  type OpenThread,
  type OnmWarning,
} from "@/lib/broadcast-rules";

const square = (
  code: string,
  lonMin: number,
  lonMax: number,
  latMin: number,
  latMax: number,
): CommuneShape => ({
  code,
  lat: (latMin + latMax) / 2,
  lon: (lonMin + lonMax) / 2,
  geom: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [lonMin, latMin],
          [lonMax, latMin],
          [lonMax, latMax],
          [lonMin, latMax],
          [lonMin, latMin],
        ],
      ],
    ],
  },
});

const home = square("1503", 4.2, 4.4, 36.6, 36.8);

describe("pointInMultiPolygon", () => {
  it("detects containment", () => {
    expect(pointInMultiPolygon(36.7, 4.3, home.geom)).toBe(true);
    expect(pointInMultiPolygon(36.5, 4.3, home.geom)).toBe(false);
    expect(pointInMultiPolygon(36.7, 4.3, null)).toBe(false);
  });
});

describe("kmToMultiPolygon", () => {
  it("is zero inside and the edge distance outside", () => {
    expect(kmToMultiPolygon(36.7, 4.3, home.geom)).toBe(0);
    const south = kmToMultiPolygon(36.5, 4.3, home.geom);
    expect(south).toBeGreaterThan(10);
    expect(south).toBeLessThan(12.5);
    expect(kmToMultiPolygon(36.7, 4.3, null)).toBe(Infinity);
  });
});

describe("targetCommunes", () => {
  const near = square("1510", 4.38, 4.5, 36.6, 36.8);
  const far = square("1590", 4.6, 4.7, 36.6, 36.8);

  it("targets the containing commune plus the 15 km ring", () => {
    const codes = targetCommunes({ lat: 36.7, lon: 4.3, communeCode: null }, [
      far,
      near,
      home,
    ]);
    expect(codes).toEqual(["1503", "1510"]);
  });

  it("falls back to the fusion commune when no polygon contains the fire", () => {
    const codes = targetCommunes({ lat: 36.7, lon: 4.3, communeCode: "0601" }, [
      { code: "0601", lat: 36.7, lon: 4.3, geom: null },
    ]);
    expect(codes).toEqual(["0601"]);
  });
});

describe("fireSeverity", () => {
  it("is Extreme only for an intense fire near a settlement", () => {
    expect(fireSeverity(3, 45)).toBe("Extreme");
    expect(fireSeverity(3, 9.7)).toBe("Severe");
    expect(fireSeverity(3, null)).toBe("Severe");
    expect(fireSeverity(12, 45)).toBe("Severe");
    expect(fireSeverity(null, 45)).toBe("Severe");
  });
});

describe("downwindAdditions", () => {
  const east = square("2001", 4.45, 4.55, 36.65, 36.75);
  const west = square("2002", 4.05, 4.15, 36.65, 36.75);
  const byCode = new Map([
    ["2001", east],
    ["2002", west],
  ]);

  it("keeps only new communes in the downwind direction", () => {
    expect(
      downwindAdditions(
        { lat: 36.7, lon: 4.3, spreadBearing: 90 },
        ["1503"],
        ["1503", "2001", "2002"],
        byCode,
      ),
    ).toEqual(["2001"]);
  });

  it("adds nothing without a known spread direction", () => {
    expect(
      downwindAdditions(
        { lat: 36.7, lon: 4.3, spreadBearing: null },
        ["1503"],
        ["1503", "2001"],
        byCode,
      ),
    ).toEqual([]);
  });
});

describe("planFireBroadcast", () => {
  const HOUR = 3600_000;
  const now = Date.parse("2026-08-30T12:00:00Z");
  const base = {
    state: "active",
    confidence: 0.7,
    lastDetectedMs: now - HOUR,
    nowMs: now,
    severity: "Severe" as const,
    open: null,
    targets: ["1503", "1510"],
    additions: [],
    inside: [],
    eligible: true,
  };
  const thread = (
    phase: string,
    communeCodes: string[],
    severity = "Severe",
    atMs = now - HOUR,
  ) => ({ phase, communeCodes, insideCodes: [], severity, atMs });

  it("opens a thread for a confirmed cluster", () => {
    expect(planFireBroadcast(base)).toEqual({
      action: "initial",
      codes: ["1503", "1510"],
      inside: [],
    });
  });

  it("never starts a thread for a bare heat signal", () => {
    expect(planFireBroadcast({ ...base, eligible: false })).toBeNull();
    expect(
      planFireBroadcast({
        ...base,
        eligible: false,
        open: thread("end", ["1503"]),
      }),
    ).toBeNull();
  });

  it("keeps an open thread alive once it started, whatever the context now", () => {
    const open = thread("initial", ["1503"]);
    expect(
      planFireBroadcast({
        ...base,
        eligible: false,
        open,
        additions: ["1510"],
      }),
    ).toMatchObject({ action: "update", added: ["1510"] });
    expect(
      planFireBroadcast({
        ...base,
        eligible: false,
        open,
        lastDetectedMs: now - 13 * HOUR,
      }),
    ).toEqual({ action: "end" });
    expect(
      planFireBroadcast({
        ...base,
        eligible: false,
        open,
        state: "false_positive",
      }),
    ).toEqual({ action: "cancel" });
  });

  it("never opens below the confidence floor or before confirmation", () => {
    expect(planFireBroadcast({ ...base, confidence: 0.5 })).toBeNull();
    expect(planFireBroadcast({ ...base, state: "unconfirmed" })).toBeNull();
  });

  it("ends observation-honestly after 12 h without detections", () => {
    expect(
      planFireBroadcast({
        ...base,
        state: "contained_guess",
        lastDetectedMs: now - 13 * HOUR,
        open: thread("initial", ["1503"]),
      }),
    ).toEqual({ action: "end" });
  });

  it("cancels when the cluster turns out to be a false positive", () => {
    expect(
      planFireBroadcast({
        ...base,
        state: "false_positive",
        open: thread("initial", ["1503"]),
      }),
    ).toEqual({ action: "cancel" });
  });

  it("updates when the fire spreads downwind into new communes", () => {
    expect(
      planFireBroadcast({
        ...base,
        open: thread("initial", ["1503"]),
        additions: ["1510"],
      }),
    ).toEqual({
      action: "update",
      codes: ["1503", "1510"],
      added: ["1510"],
      inside: [],
    });
  });

  it("updates when severity escalates even without new communes", () => {
    expect(
      planFireBroadcast({
        ...base,
        severity: "Extreme",
        open: thread("update", ["1503"]),
      }),
    ).toEqual({ action: "update", codes: ["1503"], added: [], inside: [] });
  });

  it("updates when the fire enters a covered commune", () => {
    expect(
      planFireBroadcast({
        ...base,
        inside: ["1503"],
        open: thread("initial", ["1503", "1510"]),
      }),
    ).toEqual({
      action: "update",
      codes: ["1503", "1510"],
      added: [],
      inside: ["1503"],
    });
  });

  it("stays silent while nothing changed", () => {
    expect(
      planFireBroadcast({
        ...base,
        open: thread("initial", ["1503"]),
        targets: ["1503"],
      }),
    ).toBeNull();
    expect(
      planFireBroadcast({
        ...base,
        inside: ["1503"],
        open: { ...thread("initial", ["1503"]), insideCodes: ["1503"] },
        targets: ["1503"],
      }),
    ).toBeNull();
  });

  it("reopens as an update while the end is less than 24 h old", () => {
    expect(
      planFireBroadcast({
        ...base,
        open: thread("end", ["1503"], "Severe", now - 6 * HOUR),
      }),
    ).toEqual({
      action: "update",
      codes: ["1503", "1510"],
      added: ["1510"],
      inside: [],
    });
  });

  it("keeps the level-2 communes of the thread it reopens", () => {
    expect(
      planFireBroadcast({
        ...base,
        inside: ["1510"],
        open: {
          ...thread("end", ["1503", "1510"], "Severe", now - 6 * HOUR),
          insideCodes: ["1503"],
        },
      }),
    ).toEqual({
      action: "update",
      codes: ["1503", "1510"],
      added: [],
      inside: ["1503", "1510"],
    });
  });

  it("opens a fresh thread once the end is a day old", () => {
    expect(
      planFireBroadcast({
        ...base,
        open: thread("end", ["1503"], "Severe", now - 25 * HOUR),
      }),
    ).toEqual({ action: "initial", codes: ["1503", "1510"], inside: [] });
  });
});

describe("fuelLimitedCodes", () => {
  const communes = [
    {
      code: "3306",
      landcover: {
        tree: 0,
        shrub: 0,
        grass: 0,
        crop: 0,
        bare: 1,
        built: 0,
        water: 0,
        other: 0,
      },
    },
    {
      code: "1518",
      landcover: {
        tree: 0.5,
        shrub: 0.1,
        grass: 0.2,
        crop: 0.14,
        bare: 0.06,
        built: 0,
        water: 0,
        other: 0,
      },
    },
    { code: "9999", landcover: null },
  ];

  it("names the communes with nothing to burn", () => {
    expect(fuelLimitedCodes(communes)).toEqual(new Set(["3306"]));
  });

  it("never masks a commune whose land cover is unknown", () => {
    expect(fuelLimitedCodes([{ code: "9999", landcover: null }]).size).toBe(0);
  });
});

describe("planFireBroadcast fuel gate", () => {
  const HOUR = 3600_000;
  const now = Date.parse("2026-08-30T12:00:00Z");
  const base = {
    state: "active",
    confidence: 0.7,
    lastDetectedMs: now - HOUR,
    nowMs: now,
    severity: "Extreme" as const,
    open: null,
    targets: ["3306"],
    additions: [],
    inside: [],
    fuelLimited: new Set(["3306"]),
    eligible: true,
  };

  it("does not open a thread where every target commune has no fuel", () => {
    expect(planFireBroadcast(base)).toBeNull();
  });

  it("still opens for the communes that can burn", () => {
    expect(planFireBroadcast({ ...base, targets: ["3306", "1518"] })).toEqual({
      action: "initial",
      codes: ["1518"],
      inside: [],
    });
  });

  it("still closes a thread that was already open", () => {
    expect(
      planFireBroadcast({
        ...base,
        lastDetectedMs: now - 13 * HOUR,
        open: {
          phase: "initial",
          communeCodes: ["3306"],
          insideCodes: [],
          severity: "Extreme",
          atMs: now - HOUR,
        },
      }),
    ).toEqual({ action: "end" });
  });
});

describe("applyDailyLimit", () => {
  const atLimit = new Map([["1503", BROADCAST_DAILY_COMMUNE_LIMIT]]);

  it("drops communes that already got their daily share", () => {
    expect(applyDailyLimit(["1503", "1510"], atLimit, false)).toEqual({
      allowed: ["1510"],
      dropped: ["1503"],
    });
  });

  it("never drops exempt messages", () => {
    expect(applyDailyLimit(["1503"], atLimit, true)).toEqual({
      allowed: ["1503"],
      dropped: [],
    });
  });
});

describe("insideCommunes", () => {
  const east = square("1510", 4.4, 4.6, 36.6, 36.8);
  const byCode = new Map([home, east].map((s) => [s.code, s]));
  it("names the target communes that contain a detection pixel", () => {
    const points = [
      { lat: 36.7, lon: 4.3 },
      { lat: 36.7, lon: 4.9 },
    ];
    expect(insideCommunes(points, ["1503", "1510", "1599"], byCode)).toEqual([
      "1503",
    ]);
  });
});

describe("pushCodesFor", () => {
  const now = Date.parse("2026-08-26T14:00:00Z");
  const thread = (
    communeCodes: string[],
    insideCodes: string[] = [],
    phase = "initial",
  ): OpenThread => ({
    phase,
    severity: "Severe",
    communeCodes,
    insideCodes,
    atMs: now,
  });

  it("pushes every commune of a first thread when nothing covers them", () => {
    expect(
      pushCodesFor({
        clusterId: "A",
        action: "initial",
        codes: ["1503", "1510"],
        inside: ["1503"],
        previous: null,
        coverage: coverageOf([]),
      }),
    ).toEqual(["1503", "1510"]);
  });

  it("stays silent for a commune another thread already covers at the same level", () => {
    const coverage = coverageOf([["A", thread(["1503", "1510"])]]);
    expect(
      pushCodesFor({
        clusterId: "B",
        action: "initial",
        codes: ["1510", "1520"],
        inside: [],
        previous: null,
        coverage,
      }),
    ).toEqual(["1520"]);
  });

  it("pushes a commune the fire has entered even if a ring already covered it", () => {
    const coverage = coverageOf([["A", thread(["1503", "1510"])]]);
    expect(
      pushCodesFor({
        clusterId: "B",
        action: "initial",
        codes: ["1510"],
        inside: ["1510"],
        previous: null,
        coverage,
      }),
    ).toEqual(["1510"]);
  });

  it("on update pushes only communes whose level rose for this thread", () => {
    const previous = thread(["1503", "1510"], []);
    const coverage = coverageOf([["A", previous]]);
    expect(
      pushCodesFor({
        clusterId: "A",
        action: "update",
        codes: ["1503", "1510", "1520"],
        inside: ["1503"],
        previous,
        coverage,
      }),
    ).toEqual(["1503", "1520"]);
  });

  it("does not re-push a rise another thread already announced", () => {
    const previous = thread(["1503"], []);
    const coverage = coverageOf([
      ["A", previous],
      ["B", thread(["1503"], ["1503"])],
    ]);
    expect(
      pushCodesFor({
        clusterId: "A",
        action: "update",
        codes: ["1503"],
        inside: ["1503"],
        previous,
        coverage,
      }),
    ).toEqual([]);
  });

  it("ends only where no other thread still covers the commune", () => {
    const previous = thread(["1503", "1510"]);
    const coverage = coverageOf([
      ["A", previous],
      ["B", thread(["1510"])],
    ]);
    expect(
      pushCodesFor({
        clusterId: "A",
        action: "end",
        codes: ["1503", "1510"],
        inside: [],
        previous,
        coverage,
      }),
    ).toEqual(["1503"]);
  });

  it("sees a thread advanced earlier in the same run", () => {
    const coverage = coverageOf([]);
    const a = thread(["1503", "1510"], ["1503"]);
    setThreadCoverage(coverage, "A", a);
    expect(
      pushCodesFor({
        clusterId: "B",
        action: "initial",
        codes: ["1503", "1510", "1520"],
        inside: ["1503"],
        previous: null,
        coverage,
      }),
    ).toEqual(["1520"]);
    setThreadCoverage(coverage, "A", { ...a, phase: "end" });
    expect(
      pushCodesFor({
        clusterId: "B",
        action: "initial",
        codes: ["1503", "1510"],
        inside: [],
        previous: null,
        coverage,
      }),
    ).toEqual(["1503", "1510"]);
  });

  it("ignores closed threads when computing coverage", () => {
    const coverage = coverageOf([["A", thread(["1503"], [], "end")]]);
    expect(coverage.size).toBe(0);
  });
});

describe("onmRelayPlan", () => {
  const t = (iso: string) => Date.parse(iso);
  const warning = (id: string, over: Partial<OnmWarning> = {}): OnmWarning => ({
    id,
    wilayaId: "w-setif",
    event: "Rain",
    severity: "Severe",
    sentMs: t("2026-08-31T09:31:19Z"),
    onsetMs: t("2026-08-31T15:00:00Z"),
    expiresMs: t("2026-09-01T00:00:00Z"),
    ...over,
  });

  it("relays one warning and suppresses its reissues", () => {
    const plan = onmRelayPlan(
      [
        warning("a"),
        warning("b", { sentMs: t("2026-08-31T11:44:58Z") }),
        warning("c", {
          sentMs: t("2026-08-31T16:10:24Z"),
          onsetMs: t("2026-08-31T18:00:00Z"),
        }),
      ],
      [],
    );
    expect(plan.relay.map((w) => w.id)).toEqual(["a"]);
    expect(plan.suppressed.map((w) => w.id)).toEqual(["b", "c"]);
  });

  it("stops publishing missing-expiry warnings after their bounded validity", () => {
    const open = warning("open", { expiresMs: null });
    expect(onmWarningIsCurrent(open, t("2026-09-01T14:59:59Z"))).toBe(true);
    expect(onmWarningIsCurrent(open, t("2026-09-01T15:00:00Z"))).toBe(false);
    expect(
      onmWarningIsCurrent(
        warning("no-onset", { onsetMs: null, expiresMs: null }),
        t("2026-09-01T09:31:19Z"),
      ),
    ).toBe(false);
  });

  it("allows advance official warnings but rejects expired or invalid validity", () => {
    const now = t("2026-08-31T12:00:00Z");
    expect(onmWarningIsCurrent(warning("advance"), now)).toBe(true);
    expect(
      onmWarningIsCurrent(warning("expired"), t("2026-09-01T00:00:00Z")),
    ).toBe(false);
    expect(
      onmWarningIsCurrent(warning("future-issued", { sentMs: now + 1 }), now),
    ).toBe(false);
    expect(
      onmWarningIsCurrent(warning("backward", { expiresMs: now }), now),
    ).toBe(false);
    expect(
      onmWarningIsCurrent(warning("invalid", { expiresMs: NaN }), now),
    ).toBe(false);
  });

  it("suppresses a reissue of something already broadcast in an earlier run", () => {
    const plan = onmRelayPlan([warning("b")], [warning("a")]);
    expect(plan.relay).toEqual([]);
    expect(plan.suppressed.map((w) => w.id)).toEqual(["b"]);
  });

  it("relays a different event, a different wilaya, and a later window", () => {
    const relayed = [warning("a")];
    expect(
      onmRelayPlan([warning("b", { event: "Wind" })], relayed).relay,
    ).toHaveLength(1);
    expect(
      onmRelayPlan([warning("c", { wilayaId: "w-jijel" })], relayed).relay,
    ).toHaveLength(1);
    expect(
      onmRelayPlan(
        [
          warning("d", {
            sentMs: t("2026-09-02T09:00:00Z"),
            onsetMs: t("2026-09-02T15:00:00Z"),
            expiresMs: t("2026-09-03T00:00:00Z"),
          }),
        ],
        relayed,
      ).relay,
    ).toHaveLength(1);
  });

  it("relays an escalation but not a de-escalation of the same warning", () => {
    const relayed = [warning("a")];
    expect(
      onmRelayPlan([warning("up", { severity: "Extreme" })], relayed).relay.map(
        (w) => w.id,
      ),
    ).toEqual(["up"]);
    expect(
      onmRelayPlan([warning("down")], [warning("a", { severity: "Extreme" })])
        .relay,
    ).toEqual([]);
  });

  it("treats a warning with no stated expiry as covering a day, not forever", () => {
    const open = warning("a", { expiresMs: null });
    expect(
      onmRelayPlan([warning("same-day", { expiresMs: null })], [open]).relay,
    ).toEqual([]);
    expect(
      onmRelayPlan(
        [
          warning("two-days-later", {
            expiresMs: null,
            sentMs: t("2026-09-02T09:00:00Z"),
            onsetMs: t("2026-09-02T15:00:00Z"),
          }),
        ],
        [open],
      ).relay,
    ).toHaveLength(1);
  });
});

describe("evaluateOfficialIncidentBroadcast (F8)", () => {
  const nowMs = Date.parse("2026-11-24T12:00:00Z");
  const baseNonFire = (
    over: Partial<OfficialIncidentBroadcastInput> = {},
  ): OfficialIncidentBroadcastInput => ({
    kind: "flood",
    status: "ongoing",
    communeCode: "1601",
    asOfMs: nowMs - 2 * 3600_000,
    nowMs,
    unlistedAt: null,
    sourceKey: "dgpc_telegram",
    authorityTier: "national",
    evidence: "تدخل متواصل لامتصاص مياه الأمطار في بلدية باب الوادي",
    documentBody:
      "الحماية المدنية: تدخل متواصل لامتصاص مياه الأمطار في بلدية باب الوادي ولاية الجزائر.",
    hasInitialBroadcast: false,
    initialDelivered: false,
    hasEndBroadcast: false,
    ...over,
  });

  it.each(["flood", "storm", "road", "structure"] as const)(
    "accepts verified ongoing dgpc_telegram %s incident within 12h",
    (kind) => {
      expect(evaluateOfficialIncidentBroadcast(baseNonFire({ kind }))).toEqual({
        action: "initial",
      });
    },
  );

  it("rejects ITA, media tier, unapproved sources, unsupported kinds, missing commune, stale, future, non-ongoing, missing verbatim evidence, and retrospective summaries", () => {
    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({ sourceKey: "ita_facebook", authorityTier: "media" }),
      ),
    ).toEqual({ action: "suppress", reason: "media_source_excluded" });

    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({ sourceKey: "ita_website", authorityTier: "national" }),
      ),
    ).toEqual({ action: "suppress", reason: "ita_source_excluded" });

    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({ sourceKey: "other_source" }),
      ),
    ).toEqual({ action: "suppress", reason: "unapproved_non_fire_source" });

    expect(
      evaluateOfficialIncidentBroadcast(baseNonFire({ kind: "other" })),
    ).toEqual({ action: "suppress", reason: "unsupported_hazard_kind" });

    expect(
      evaluateOfficialIncidentBroadcast(baseNonFire({ communeCode: null })),
    ).toEqual({ action: "suppress", reason: "missing_commune" });

    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({ asOfMs: nowMs - 13 * 3600_000 }),
      ),
    ).toEqual({ action: "suppress", reason: "stale_incident" });

    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({ asOfMs: nowMs + 60_000 }),
      ),
    ).toEqual({ action: "suppress", reason: "future_as_of" });

    expect(
      evaluateOfficialIncidentBroadcast(baseNonFire({ status: "unknown" })),
    ).toEqual({ action: "suppress", reason: "non_fire_not_ongoing" });

    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({ documentBody: "Unrelated bulletin text" }),
      ),
    ).toEqual({ action: "suppress", reason: "missing_verbatim_evidence" });

    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          evidence: "حصيلة تدخلات الحماية المدنية خلال 24 ساعة الماضية",
          documentBody: "حصيلة تدخلات الحماية المدنية خلال 24 ساعة الماضية",
        }),
      ),
    ).toEqual({ action: "suppress", reason: "retrospective_or_summary" });
  });

  it("blocks retrospective headers in documentBody (clean evidence), Arabic tatweel/diacritics/Eastern numerals, and unlisted/NaN asOf on cleared", () => {
    // Recap header in documentBody while evidence is a clean bullet line (both initial & end)
    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          evidence: "امتصاص مياه الأمطار المتراكمة ببلدية باب الوادي",
          documentBody:
            "حصيلة تدخلات الحماية المدنية خلال 24 ساعة:\n- امتصاص مياه الأمطار المتراكمة ببلدية باب الوادي",
        }),
      ),
    ).toEqual({ action: "suppress", reason: "retrospective_or_summary" });

    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          status: "cleared",
          hasInitialBroadcast: true,
          initialDelivered: true,
          evidence: "امتصاص مياه الأمطار المتراكمة ببلدية باب الوادي",
          documentBody:
            "Bilan des interventions durant les 24 dernières heures : امتصاص مياه الأمطار المتراكمة ببلدية باب الوادي",
        }),
      ),
    ).toEqual({ action: "suppress", reason: "retrospective_or_summary" });

    // Arabic tatweel
    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          evidence: "حـصـيـلـة تدخلات ببلدية باب الوادي",
          documentBody: "حـصـيـلـة تدخلات ببلدية باب الوادي",
        }),
      ),
    ).toEqual({ action: "suppress", reason: "retrospective_or_summary" });

    // Arabic diacritics
    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          evidence: "حَصِيلَة تدخلات ببلدية باب الوادي",
          documentBody: "حَصِيلَة تدخلات ببلدية باب الوادي",
        }),
      ),
    ).toEqual({ action: "suppress", reason: "retrospective_or_summary" });

    // Eastern Arabic numerals (٢٤) and Extended Arabic-Indic numerals (۲۴)
    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          evidence: "تدخلات الحماية المدنية خلال ٢٤ ساعة ببلدية باب الوادي",
          documentBody: "تدخلات الحماية المدنية خلال ٢٤ ساعة ببلدية باب الوادي",
        }),
      ),
    ).toEqual({ action: "suppress", reason: "retrospective_or_summary" });

    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          evidence: "تدخلات الحماية المدنية خلال ۲۴ ساعة ببلدية باب الوادي",
          documentBody: "تدخلات الحماية المدنية خلال ۲۴ ساعة ببلدية باب الوادي",
        }),
      ),
    ).toEqual({ action: "suppress", reason: "retrospective_or_summary" });

    // Unlisted incident marked cleared must NEVER emit end
    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          status: "cleared",
          hasInitialBroadcast: true,
          initialDelivered: true,
          unlistedAt: "2026-11-24T11:30:00Z",
        }),
      ),
    ).toEqual({ action: "suppress", reason: "unlisted_incident" });

    // Invalid/NaN asOfMs on cleared must suppress cleanly (never crash buildOfficialCap)
    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          status: "cleared",
          hasInitialBroadcast: true,
          initialDelivered: true,
          asOfMs: Number.NaN,
        }),
      ),
    ).toEqual({ action: "suppress", reason: "invalid_timestamp" });
  });

  it("emits end on cleared ONLY when initial was delivered, stays silent if cleared before delivery, and never infers cleared from silence", () => {
    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          status: "cleared",
          hasInitialBroadcast: true,
          initialDelivered: true,
        }),
      ),
    ).toEqual({ action: "end" });

    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          status: "cleared",
          hasInitialBroadcast: true,
          initialDelivered: false,
        }),
      ),
    ).toEqual({ action: "suppress", reason: "cleared_before_delivery" });

    expect(
      evaluateOfficialIncidentBroadcast(
        baseNonFire({
          status: "ongoing",
          hasInitialBroadcast: true,
          initialDelivered: true,
        }),
      ),
    ).toEqual({ action: "suppress", reason: "already_broadcast" });
  });
});

describe("earthquake commune targeting & severity (F9)", () => {
  const communes = [
    { code: "1601", lat: 36.75, lon: 3.05 }, // ~0 km
    { code: "0901", lat: 36.47, lon: 2.83 }, // ~37 km
    { code: "1501", lat: 36.71, lon: 4.05 }, // ~89 km
    { code: "3101", lat: 35.7, lon: -0.63 }, // ~350 km (Oran)
  ];

  it("targets all communes within 100 km sorted by distance then code, excluding distant communes", () => {
    expect(EARTHQUAKE_BROADCAST_RADIUS_KM).toBe(100);
    expect(
      targetCommunesForEarthquake({ lat: 36.75, lon: 3.05 }, communes),
    ).toEqual(["1601", "0901", "1501"]);
  });

  it("maps M4.0-4.9 to Severe and M5.0+ to Extreme", () => {
    expect(earthquakeSeverity(4.0)).toBe("Severe");
    expect(earthquakeSeverity(4.9)).toBe("Severe");
    expect(earthquakeSeverity(5.0)).toBe("Extreme");
    expect(earthquakeSeverity(6.2)).toBe("Extreme");
  });
});

describe("planEarthquakeBroadcast (F9)", () => {
  const HOUR = 3_600_000;
  const nowMs = Date.parse("2026-11-25T12:00:00Z");

  it("enforces M3.99 vs M4.00 and M4.99 vs M5.00 severity boundaries", () => {
    expect(
      planEarthquakeBroadcast({
        id: "eq-399",
        magnitude: 3.99,
        lat: 36.75,
        lon: 3.05,
        occurredMs: nowMs - HOUR,
        nowMs,
        alreadyBroadcast: false,
      }),
    ).toEqual({
      action: "suppress",
      shouldBroadcast: false,
      send: false,
      retract: false,
      severity: null,
      reason: "below_threshold",
    });

    expect(
      planEarthquakeBroadcast({
        id: "eq-400",
        magnitude: 4.0,
        lat: 36.75,
        lon: 3.05,
        occurredMs: nowMs - HOUR,
        nowMs,
        alreadyBroadcast: false,
      }),
    ).toEqual({
      action: "publish",
      shouldBroadcast: true,
      send: true,
      retract: false,
      severity: "Severe",
      reason: "m4_threshold_met",
    });

    expect(
      planEarthquakeBroadcast({
        id: "eq-499",
        magnitude: 4.99,
        alreadyBroadcast: false,
      }),
    ).toMatchObject({
      action: "publish",
      shouldBroadcast: true,
      severity: "Severe",
    });

    expect(
      planEarthquakeBroadcast({
        id: "eq-500",
        magnitude: 5.0,
        alreadyBroadcast: false,
      }),
    ).toEqual({
      action: "publish",
      shouldBroadcast: true,
      send: true,
      retract: false,
      severity: "Extreme",
      reason: "m4_threshold_met",
    });
  });

  it("rejects non-finite and implausible magnitudes, out-of-range coordinates, and future/stale timestamps", () => {
    for (const badMag of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -2.1,
      10.1,
    ]) {
      expect(
        planEarthquakeBroadcast({ id: "eq-bad-mag", magnitude: badMag }),
      ).toMatchObject({
        action: "suppress",
        shouldBroadcast: false,
        send: false,
        retract: false,
        reason: "invalid_magnitude",
      });
    }

    for (const coords of [
      { lat: -91, lon: 3.0 },
      { lat: 91, lon: 3.0 },
      { lat: 36.7, lon: -181 },
      { lat: 36.7, lon: 181 },
      { lat: Number.NaN, lon: 3.0 },
      { lat: null, lon: 3.0 },
    ]) {
      expect(
        planEarthquakeBroadcast({
          id: "eq-bad-coords",
          magnitude: 4.5,
          ...coords,
        }),
      ).toMatchObject({
        action: "suppress",
        shouldBroadcast: false,
        reason: "invalid_coordinates",
      });
    }

    expect(
      planEarthquakeBroadcast({
        id: "eq-future",
        magnitude: 4.6,
        occurredMs: nowMs + 60_000,
        nowMs,
      }),
    ).toMatchObject({
      action: "suppress",
      shouldBroadcast: false,
      reason: "future_earthquake",
    });

    expect(
      planEarthquakeBroadcast({
        id: "eq-stale",
        magnitude: 4.6,
        occurredMs: nowMs - 7 * HOUR,
        nowMs,
      }),
    ).toMatchObject({
      action: "suppress",
      shouldBroadcast: false,
      reason: "stale_earthquake",
    });

    expect(
      planEarthquakeBroadcast({
        id: "eq-nan-ts",
        magnitude: 4.6,
        occurredMs: Number.NaN,
        nowMs,
      }),
    ).toMatchObject({
      action: "suppress",
      shouldBroadcast: false,
      reason: "invalid_timestamp",
    });
  });

  it("enforces revision asymmetry: upward M3.8 -> M4.2 pushes once, repeat M4.2 -> M4.8 suppresses, downward M4.5 -> M3.6 never retracts or emits banned labels", () => {
    const upward = planEarthquakeBroadcast({
      id: "eq-rev-up",
      magnitude: 4.2,
      previousMagnitude: 3.8,
      alreadyBroadcast: false,
    });
    expect(upward).toEqual({
      action: "publish",
      shouldBroadcast: true,
      send: true,
      retract: false,
      severity: "Severe",
      reason: "upward_revision_crossed_threshold",
    });

    const repeat = planEarthquakeBroadcast({
      id: "eq-rev-repeat",
      magnitude: 4.8,
      previousMagnitude: 4.2,
      alreadyBroadcast: true,
    });
    expect(repeat).toEqual({
      action: "suppress",
      shouldBroadcast: false,
      send: false,
      retract: false,
      severity: null,
      reason: "already_broadcast",
    });

    const downward = planEarthquakeBroadcast({
      id: "eq-rev-down",
      magnitude: 3.6,
      previousMagnitude: 4.5,
      alreadyBroadcast: true,
    });
    expect(downward).toEqual({
      action: "suppress",
      shouldBroadcast: false,
      send: false,
      retract: false,
      severity: null,
      reason: "downward_revision_no_retraction",
    });
    expect(JSON.stringify(downward)).not.toMatch(/safe|all[-\s]clear/i);
  });
});
