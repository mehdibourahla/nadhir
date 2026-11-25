import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, drainWebhookDeliveries } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  drainWebhookDeliveries: vi.fn(async () => ({ sent: 0, failed: 0 })),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: fromMock },
}));

vi.mock("@/lib/webhooks.server", () => ({ drainWebhookDeliveries }));

import { evaluateAlerts } from "@/lib/alerts-engine.server";
import {
  parseProvenancePayload,
  validateProvenanceInvariants,
} from "@/lib/alert-provenance";

type Result = { data: unknown; error: { message: string } | null };

function query(table: string, result: Result, filters: [string, unknown][]) {
  let mode = "read";
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "order",
    "limit",
    "range",
    "in",
    "neq",
    "gte",
    "gt",
    "is",
    "or",
    "lte",
  ]) {
    builder[method] = vi.fn((...args: unknown[]) => {
      if (method === "in") filters.push([String(args[0]), args[1]]);
      return builder;
    });
  }
  builder["eq"] = vi.fn((column: string, value: unknown) => {
    filters.push([column, value]);
    return builder;
  });
  builder["upsert"] = vi.fn((_rows: unknown) => {
    mode = "upsert";
    return builder;
  });
  builder["maybeSingle"] = vi.fn(async () => result);
  builder["then"] = (resolve: (value: Result) => unknown) =>
    Promise.resolve(
      mode === "upsert" && table === "alerts"
        ? { data: [{ id: "alert-1" }], error: null }
        : result,
    ).then(resolve);
  return builder;
}

describe("alert risk publication boundary", () => {
  beforeEach(() => {
    fromMock.mockReset();
    drainWebhookDeliveries.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it.each(["en", "fr", "ar", "kab"])(
    "emits honest lifecycle copy in %s and respects quiet hours",
    async (locale) => {
      vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
      const baseline = {
        id: "a",
        user_id: "u1",
        zone_id: "z1",
        cluster_id: "c1",
        created_at: "2026-09-08T10:00:00Z",
        payload: {
          est_area_ha: 10,
          max_frp_mw: 20,
          last_detected_at: "2026-09-08T10:00:00Z",
        },
      };
      const profile = {
        id: "u1",
        locale,
        quiet_hours_start: null as number | null,
        quiet_hours_end: null as number | null,
      };
      const cluster = {
        id: "c1",
        short_id: "abc",
        state: "active",
        lat: 36,
        lon: 3,
        confidence: 0.9,
        spread_bearing_deg: null,
        confirmed_at: null,
        est_area_ha: 20,
        max_frp_mw: 40,
        first_detected_at: "2026-09-08T11:00:00Z",
        last_detected_at: "2026-09-08T11:50:00Z",
      };
      const data: Record<string, unknown> = {
        zones: [
          {
            id: "z1",
            user_id: "u1",
            name: "Zone",
            notify_fires: true,
            notify_risk: false,
            lat: 36,
            lon: 3,
            radius_km: 10,
          },
        ],
        profiles: [profile],
        fire_clusters: [cluster],
        alerts: [baseline],
        cluster_events: [
          {
            id: "e",
            cluster_id: "c1",
            event: "state:contained_guess",
            at: "2026-09-08T11:55:00Z",
            payload: { from: "active", detections: 2 },
          },
        ],
      };
      const writes: Record<string, unknown>[][] = [];
      fromMock.mockImplementation((table: string) => {
        const builder = query(
          table,
          { data: data[table] ?? [], error: null },
          [],
        );
        const upsert = builder["upsert"] as (rows: unknown) => unknown;
        builder["upsert"] = (rows: Record<string, unknown>[]) => {
          if (table === "alerts") writes.push(rows);
          return upsert(rows);
        };
        return builder;
      });
      await evaluateAlerts("u1");
      expect(
        writes
          .flat()
          .some((r) => (r["payload"] as { phase: string }).phase === "growth"),
      ).toBe(true);
      writes.length = 0;
      cluster.state = "contained_guess";
      await evaluateAlerts("u1");
      const row = writes.flat()[0]!;
      expect(row["severity"]).toBe(1);
      expect(row["body"]).toContain(cluster.last_detected_at);
      expect((row["payload"] as { phase: string }).phase).toBe(
        "observation_ended",
      );
      const endedProv = parseProvenancePayload(row["payload"]);
      expect(endedProv).not.toBeNull();
      expect(validateProvenanceInvariants(endedProv!)).toEqual([]);
      expect(endedProv!.triggerKind).toBe("watch_zone");
      expect(endedProv!.areaLabel).toBe("Zone");
      expect(row["cap_alert_id"]).toBeNull();
      writes.length = 0;
      profile.quiet_hours_start = 12;
      profile.quiet_hours_end = 14;
      await evaluateAlerts("u1");
      expect(writes).toEqual([]);
      cluster.state = "active";
      await evaluateAlerts("u1");
      expect(writes).toEqual([]);
      profile.quiet_hours_start = null;
      profile.quiet_hours_end = null;
      cluster.confidence = 0.1;
      await evaluateAlerts("u1");
      expect(writes).toEqual([]);
      cluster.confidence = 0.9;
      cluster.lat = 30;
      await evaluateAlerts("u1");
      expect(writes).toEqual([]);
    },
  );

  it("uses the matching stale published horizon on the Algiers calendar", async () => {
    vi.setSystemTime(new Date("2026-09-03T23:30:00.000Z"));
    const filtersByTable = new Map<string, [string, unknown][]>();
    const data: Record<string, unknown> = {
      zones: [
        {
          id: "z1",
          user_id: "u1",
          commune_id: "c1",
          name: "Zone 1",
          active: true,
          notify_fires: false,
          notify_risk: true,
          min_danger_level: 3,
          lat: 36.7,
          lon: 3.1,
          radius_km: 10,
        },
      ],
      profiles: [
        {
          id: "u1",
          locale: "en",
          min_danger_level: 3,
          quiet_hours_start: null,
          quiet_hours_end: null,
        },
      ],
      fire_clusters: [],
      settlements: [],
      risk_publication_checkpoint: {
        coverage_status: "complete",
        snapshot_id: "f0220000-0000-4000-8000-000000000001",
        base_date: "2026-08-31",
        published_at: "2026-08-31T00:20:00.000Z",
      },
      risk_forecasts: [
        {
          commune_id: "c1",
          forecast_date: "2026-09-04",
          horizon_days: 4,
          danger_level: 4,
          fuel_limited: false,
          source: "local_fwi",
        },
      ],
      alerts: [],
    };
    fromMock.mockImplementation((table: string) => {
      const filters: [string, unknown][] = [];
      filtersByTable.set(table, filters);
      return query(table, { data: data[table] ?? [], error: null }, filters);
    });

    const result = await evaluateAlerts("u1");

    expect(result.created).toBe(1);
    expect(filtersByTable.get("risk_publication_checkpoint")).toContainEqual([
      "key",
      "local_fwi",
    ]);
    expect(filtersByTable.get("risk_forecasts")).toEqual(
      expect.arrayContaining([
        ["source", "local_fwi"],
        ["snapshot_id", "f0220000-0000-4000-8000-000000000001"],
        ["forecast_date", "2026-09-04"],
        ["horizon_days", 4],
      ]),
    );
  });

  it.each([
    ["missing", null, null],
    [
      "partial",
      {
        coverage_status: "partial",
        snapshot_id: "f0220000-0000-4000-8000-000000000009",
        base_date: "2026-08-31",
        published_at: "2026-08-31T00:20:00.000Z",
      },
      null,
    ],
    ["errored", null, { message: "checkpoint unavailable" }],
  ])(
    "creates no risk alert and skips forecast reads for a %s checkpoint",
    async (_label, checkpoint, checkpointError) => {
      vi.setSystemTime(new Date("2026-09-03T23:30:00.000Z"));
      const tables: string[] = [];
      const data: Record<string, unknown> = {
        zones: [
          {
            id: "z1",
            user_id: "u1",
            commune_id: "c1",
            name: "Zone 1",
            active: true,
            notify_fires: false,
            notify_risk: true,
            min_danger_level: 3,
            lat: 36.7,
            lon: 3.1,
            radius_km: 10,
          },
        ],
        profiles: [{ id: "u1", locale: "en", min_danger_level: 3 }],
        fire_clusters: [],
        settlements: [],
        alerts: [],
      };
      fromMock.mockImplementation((table: string) => {
        tables.push(table);
        const result =
          table === "risk_publication_checkpoint"
            ? { data: checkpoint, error: checkpointError }
            : { data: data[table] ?? [], error: null };
        return query(table, result, []);
      });

      const result = await evaluateAlerts("u1");

      expect(result.created).toBe(0);
      expect(tables).not.toContain("risk_forecasts");
      expect(drainWebhookDeliveries).not.toHaveBeenCalled();
    },
  );

  it("creates no risk alert when the published forecast read fails", async () => {
    vi.setSystemTime(new Date("2026-09-03T23:30:00.000Z"));
    const data: Record<string, unknown> = {
      zones: [
        {
          id: "z1",
          user_id: "u1",
          commune_id: "c1",
          name: "Zone 1",
          active: true,
          notify_fires: false,
          notify_risk: true,
          min_danger_level: 3,
          lat: 36.7,
          lon: 3.1,
          radius_km: 10,
        },
      ],
      profiles: [{ id: "u1", locale: "en", min_danger_level: 3 }],
      fire_clusters: [],
      settlements: [],
      risk_publication_checkpoint: {
        coverage_status: "complete",
        snapshot_id: "f0220000-0000-4000-8000-000000000001",
        base_date: "2026-08-31",
        published_at: "2026-08-31T00:20:00.000Z",
      },
      alerts: [],
    };
    fromMock.mockImplementation((table: string) => {
      const result =
        table === "risk_forecasts"
          ? {
              data: [{ commune_id: "c1", danger_level: 5 }],
              error: { message: "forecast failed" },
            }
          : { data: data[table] ?? [], error: null };
      return query(table, result, []);
    });

    const result = await evaluateAlerts("u1");

    expect(result.created).toBe(0);
    expect(drainWebhookDeliveries).not.toHaveBeenCalled();
  });
});

describe("zone fire alerts follow the confidence ladder", () => {
  beforeEach(() => {
    fromMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  async function phases(
    forest: number,
    settlements: unknown[] = [],
    failing?: string,
  ) {
    const data: Record<string, unknown> = {
      zones: [
        {
          id: "z1",
          user_id: "u1",
          name: "Zone",
          notify_fires: true,
          notify_risk: false,
          lat: 36,
          lon: 3,
          radius_km: 10,
        },
      ],
      profiles: [{ id: "u1", locale: "en" }],
      fire_clusters: [
        {
          id: "c1",
          short_id: "abc",
          state: "active",
          lat: 36,
          lon: 3,
          confidence: 0.9,
          spread_bearing_deg: 0,
          confirmed_at: null,
          est_area_ha: 5,
          max_frp_mw: 10,
          first_detected_at: "2026-09-08T11:00:00Z",
          last_detected_at: "2026-09-08T11:50:00Z",
          commune_id: "k1",
        },
      ],
      admin_units: [{ id: "k1", forest_fraction: forest }],
      settlements,
    };
    const written: Record<string, unknown>[] = [];
    fromMock.mockImplementation((table: string) => {
      const builder = query(
        table,
        table === failing
          ? { data: null, error: { message: `${table} unavailable` } }
          : { data: data[table] ?? [], error: null },
        [],
      );
      const upsert = builder["upsert"] as (rows: unknown) => unknown;
      builder["upsert"] = (rows: Record<string, unknown>[]) => {
        if (table === "alerts") written.push(...rows);
        return upsert(rows);
      };
      return builder;
    });
    const run = evaluateAlerts("u1");
    if (failing) await expect(run).rejects.toThrow(`${failing} unavailable`);
    else await run;
    return written.map((r) => (r["payload"] as { phase: string }).phase);
  }

  it("does not alert a zone about a bare heat signal", async () => {
    expect(await phases(0)).not.toContain("new");
  });

  it("alerts a zone about a probable fire", async () => {
    expect(await phases(0.4)).toContain("new");
  });

  it("still escalates a heat signal spreading towards a settlement", async () => {
    expect(
      await phases(0, [{ id: "s1", name: "Village", lat: 36.02, lon: 3 }]),
    ).toContain("urgent");
  });

  it("still raises the urgent alert when fire context cannot be read, then fails loudly", async () => {
    expect(
      await phases(
        0.4,
        [{ id: "s1", name: "Village", lat: 36.02, lon: 3 }],
        "hazard_reports",
      ),
    ).toEqual(["urgent"]);
  });
});

describe("zone hazard alerts reach the alert table", () => {
  beforeEach(() => {
    fromMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  async function written(extra: Record<string, unknown>, failing?: string) {
    const data: Record<string, unknown> = {
      zones: [
        {
          id: "z1",
          user_id: "u1",
          name: "Home",
          notify_fires: false,
          notify_risk: false,
          notify_weather: true,
          notify_official: true,
          notify_road: true,
          lat: 36.6,
          lon: 3.1,
          radius_km: 5,
          commune_id: "k1",
        },
      ],
      profiles: [{ id: "u1", locale: "en" }],
      admin_units: [{ id: "k1", code: "1601", parent_id: "w16" }],
      ...extra,
    };
    const rows: Record<string, unknown>[] = [];
    fromMock.mockImplementation((table: string) => {
      const builder = query(
        table,
        table === failing
          ? { data: null, error: { message: `${table} unavailable` } }
          : { data: data[table] ?? [], error: null },
        [],
      );
      const upsert = builder["upsert"] as (rows: unknown) => unknown;
      builder["upsert"] = (next: Record<string, unknown>[]) => {
        if (table === "alerts") rows.push(...next);
        return upsert(next);
      };
      return builder;
    });
    const run = evaluateAlerts("u1");
    if (failing) await expect(run).rejects.toThrow(`${failing} unavailable`);
    else await run;
    return rows;
  }

  it("writes a weather alert for an ONM warning covering the zone", async () => {
    const rows = await written({
      onm_vigilance: [
        {
          id: "onm1",
          severity: "Severe",
          event: "Rain",
          onset: "2026-09-08T15:00:00Z",
          title: "Rain Severe warning for the wilaya: ALGER",
          headline_fr: null,
          area: null,
          wilaya_id: "w16",
          expires: "2026-09-09T12:00:00Z",
          episode_id: "ep1",
          episode_peak: 3,
        },
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "weather",
        source_table: "onm_vigilance",
        source_id: "onm1",
        dedupe_key: "weather:ep1:3",
      }),
    ]);
  });

  it("fails loudly when a hazard source cannot be read", async () => {
    await written({}, "civil_publications");
  });

  it("excludes watch zones for users who withdrew zone_alerts consent and fails closed on consent lookup errors (T5-R2-01)", async () => {
    const onmRow = {
      id: "onm1",
      severity: "Severe",
      event: "Rain",
      onset: "2026-09-08T15:00:00Z",
      title: "Rain Severe warning for the wilaya: ALGER",
      headline_fr: null,
      area: null,
      wilaya_id: "w16",
      expires: "2026-09-09T12:00:00Z",
      episode_id: "ep1",
      episode_peak: 3,
    };

    const withdrawnRows = await written({
      privacy_consents: [{ user_id: "u1" }],
      onm_vigilance: [onmRow],
    });
    expect(withdrawnRows).toEqual([]);
    expect(drainWebhookDeliveries).not.toHaveBeenCalled();

    // Multi-user run: withdrawn user excluded while consented user still receives alerts
    const multiWrites: Record<string, unknown>[] = [];
    const multiData: Record<string, unknown> = {
      zones: [
        {
          id: "z-withdrawn",
          user_id: "u-withdrawn",
          name: "Withdrawn Zone",
          notify_fires: false,
          notify_risk: false,
          notify_weather: true,
          lat: 36.6,
          lon: 3.1,
          radius_km: 5,
          commune_id: "k1",
        },
        {
          id: "z-granted",
          user_id: "u-granted",
          name: "Granted Zone",
          notify_fires: false,
          notify_risk: false,
          notify_weather: true,
          lat: 36.6,
          lon: 3.1,
          radius_km: 5,
          commune_id: "k1",
        },
      ],
      privacy_consents: [{ user_id: "u-withdrawn" }],
      profiles: [
        { id: "u-withdrawn", locale: "en" },
        { id: "u-granted", locale: "en" },
      ],
      admin_units: [{ id: "k1", code: "1601", parent_id: "w16" }],
      onm_vigilance: [onmRow],
    };
    fromMock.mockImplementation((table: string) => {
      const builder = query(
        table,
        { data: multiData[table] ?? [], error: null },
        [],
      );
      const upsert = builder["upsert"] as (rows: unknown) => unknown;
      builder["upsert"] = (next: Record<string, unknown>[]) => {
        if (table === "alerts") multiWrites.push(...next);
        return upsert(next);
      };
      return builder;
    });
    const multiResult = await evaluateAlerts("u-granted");
    expect(multiResult.evaluated).toBe(1);
    expect(multiWrites.map((r) => r["user_id"])).toEqual(["u-granted"]);

    // Fail-closed: DB error on privacy_consents must throw before inserting any alert
    await written({ onm_vigilance: [onmRow] }, "privacy_consents");
  });

  it("chunks privacy_consents, profiles, alerts, risk_forecasts, and admin_units .in() queries to <= 100 UUIDs at 250+ watch-zone users (T5-R3-01)", async () => {
    const totalUsers = 255;
    const withdrawnIndices = new Set([0, 99, 100, 199, 254]);
    const makeUserId = (i: number) =>
      `5e030000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    const makeCommuneId = (i: number) =>
      `6e030000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;

    const zones = Array.from({ length: totalUsers }, (_, i) => ({
      id: `z-${i}`,
      user_id: makeUserId(i),
      name: `Zone ${i}`,
      active: true,
      notify_fires: true,
      notify_risk: true,
      notify_weather: true,
      min_danger_level: 3,
      lat: 36.6,
      lon: 3.1,
      radius_km: 5,
      commune_id: makeCommuneId(i),
    }));
    const withdrawnUsers = new Set(
      [...withdrawnIndices].map((i) => makeUserId(i)),
    );
    const profiles = Array.from({ length: totalUsers }, (_, i) => ({
      id: makeUserId(i),
      locale: "en",
      min_danger_level: 3,
      quiet_hours_start: null,
      quiet_hours_end: null,
    }));
    const adminUnits = Array.from({ length: totalUsers }, (_, i) => ({
      id: makeCommuneId(i),
      code: `16${String(i).padStart(2, "0")}`,
      parent_id: "w16",
    }));
    const forecasts = Array.from({ length: totalUsers }, (_, i) => ({
      commune_id: makeCommuneId(i),
      forecast_date: "2026-09-08",
      horizon_days: 1,
      danger_level: 4,
      fuel_limited: false,
      source: "local_fwi",
    }));

    const inCallsByTable = new Map<string, Array<[string, number]>>();
    const writtenAlerts: Record<string, unknown>[] = [];

    fromMock.mockImplementation((table: string) => {
      const filters: [string, unknown][] = [];
      let mode = "read";
      const builder: Record<string, unknown> = {};
      for (const method of [
        "select",
        "order",
        "limit",
        "range",
        "neq",
        "gte",
        "gt",
        "is",
        "or",
        "lte",
      ]) {
        builder[method] = vi.fn(() => builder);
      }
      builder["in"] = vi.fn((col: string, vals: unknown[]) => {
        filters.push([col, vals]);
        const list = inCallsByTable.get(table) ?? [];
        list.push([col, vals.length]);
        inCallsByTable.set(table, list);
        return builder;
      });
      builder["eq"] = vi.fn((col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      });
      builder["upsert"] = vi.fn((next: Record<string, unknown>[]) => {
        mode = "upsert";
        if (table === "alerts") writtenAlerts.push(...next);
        return builder;
      });

      const resolveData = (): Result => {
        if (mode === "upsert" && table === "alerts") {
          return { data: [{ id: "alert-batch" }], error: null };
        }
        if (table === "zones") return { data: zones, error: null };
        if (table === "privacy_consents") {
          const batch =
            (filters.find(([c]) => c === "user_id")?.[1] as string[]) ?? [];
          return {
            data: batch
              .filter((id) => withdrawnUsers.has(id))
              .map((user_id) => ({ user_id })),
            error: null,
          };
        }
        if (table === "profiles") {
          const batch = new Set(
            (filters.find(([c]) => c === "id")?.[1] as string[]) ?? [],
          );
          return {
            data: profiles.filter((p) => batch.has(p.id)),
            error: null,
          };
        }
        if (table === "fire_clusters") {
          return {
            data: [
              {
                id: "c-live-1",
                short_id: "live1",
                state: "active",
                lat: 30,
                lon: 3,
                confidence: 0.9,
                spread_bearing_deg: null,
                confirmed_at: null,
                est_area_ha: 5,
                max_frp_mw: 10,
                first_detected_at: "2026-09-08T11:00:00Z",
                last_detected_at: "2026-09-08T11:50:00Z",
                commune_id: null,
              },
            ],
            error: null,
          };
        }
        if (table === "risk_publication_checkpoint") {
          return {
            data: {
              coverage_status: "complete",
              snapshot_id: "f0220000-0000-4000-8000-000000000001",
              base_date: "2026-09-07",
              published_at: "2026-09-07T00:20:00.000Z",
            },
            error: null,
          };
        }
        if (table === "risk_forecasts") {
          const batch = new Set(
            (filters.find(([c]) => c === "commune_id")?.[1] as string[]) ?? [],
          );
          return {
            data: forecasts.filter((f) => batch.has(f.commune_id)),
            error: null,
          };
        }
        if (table === "admin_units") {
          const batch = new Set(
            (filters.find(([c]) => c === "id")?.[1] as string[]) ?? [],
          );
          return {
            data: adminUnits.filter((u) => batch.has(u.id)),
            error: null,
          };
        }
        return { data: [], error: null };
      };

      builder["maybeSingle"] = vi.fn(async () => resolveData());
      builder["then"] = (resolve: (value: Result) => unknown) =>
        Promise.resolve(resolveData()).then(resolve);
      return builder;
    });

    const result = await evaluateAlerts();

    expect(result.evaluated).toBe(250);
    expect(writtenAlerts).toHaveLength(250);
    for (const row of writtenAlerts) {
      expect(withdrawnUsers.has(String(row["user_id"]))).toBe(false);
    }

    const sizesFor = (table: string, col: string) =>
      (inCallsByTable.get(table) ?? [])
        .filter(([c]) => c === col)
        .map(([, len]) => len);

    expect(sizesFor("privacy_consents", "user_id")).toEqual([100, 100, 55]);
    expect(sizesFor("profiles", "id")).toEqual([100, 100, 50]);
    expect(sizesFor("alerts", "user_id")).toEqual([100, 100, 50]);
    expect(sizesFor("risk_forecasts", "commune_id")).toEqual([100, 100, 50]);
    expect(sizesFor("admin_units", "id")).toEqual([100, 100, 50]);
    for (const [table, calls] of inCallsByTable) {
      for (const [col, len] of calls) {
        expect(
          len,
          `${table}.in(${col}) exceeded 100 UUIDs`,
        ).toBeLessThanOrEqual(100);
      }
    }
  });
});
