import { beforeEach, expect, it, vi } from "vitest";

const { from, rpc, sendTelegram, fcmSend, fcmEnabled } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  sendTelegram: vi.fn(async () => {}),
  fcmSend: vi.fn(async () => {}),
  fcmEnabled: { value: false },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from, rpc },
}));
vi.mock("@/lib/ingest/telegram.server", () => ({
  telegramConfigured: () => true,
  sendTelegram,
}));
vi.mock("@/lib/ingest/fcm.server", () => ({
  fcmConfigured: () => fcmEnabled.value,
  fcmSend,
}));

import { deliverBroadcasts } from "@/lib/ingest/delivery.server";
import { publishBroadcasts } from "@/lib/ingest/broadcast.server";

function fixture(
  kind: string,
  sourceKey: string | null = "dgpc_telegram",
  pushCodes = ["1501"],
) {
  const data: Record<string, unknown> = {
    broadcast_settings: { enabled: true },
    broadcasts: [
      {
        id: "b1",
        lease_token: "lease1",
        kind,
        severity: "Severe",
        commune_codes: ["1501"],
        push_codes: pushCodes,
        cluster_id: "f1",
        cap_alert_id: "cap1",
        onm_vigilance_id: "onm1",
        authority_warning_id: "w1",
        official_incident_id: "i1",
      },
    ],
    cap_alerts: [
      {
        id: "cap1",
        info: [
          {
            language: "fr-DZ",
            headline: "Protection Civile",
            description: "Feu signalé",
            parameter:
              sourceKey === null
                ? undefined
                : [{ valueName: "source_key", value: sourceKey }],
          },
        ],
      },
    ],
    fire_clusters: [{ id: "f1", short_id: "DZ123" }],
    onm_vigilance: [
      {
        id: "onm1",
        title: "Wind warning",
        headline_fr: null,
        wilaya_id: "w1",
        event: "Strong",
      },
    ],
    authority_warnings: [
      { id: "w1", source: "Protection Civile", body: "Manual warning" },
    ],
    official_incidents: [
      {
        id: "i1",
        incident_mentions: { text_sources: { key: "dgpc_telegram" } },
      },
    ],
    telegram_channels: [{ wilaya_id: "w15", chat_id: "chat15" }],
    admin_units: [{ code: "1501", parent_id: "w15" }],
  };
  let claimed = false;
  rpc.mockImplementation(async (name: string) => {
    if (name === "claim_broadcast_delivery") {
      const jobs = claimed
        ? []
        : (data["broadcasts"] as unknown[]).map((job) => ({ job }));
      claimed = true;
      return { data: jobs, error: null };
    }
    return { data: true, error: null };
  });
  from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "range", "upsert"])
      q[method] = () => q;
    q["single"] = async () => ({ data: data[table], error: null });
    q["then"] = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: data[table] ?? [],
        error: null,
      }).then(resolve);
    return q;
  });
}

beforeEach(() => {
  from.mockReset();
  rpc.mockReset();
  sendTelegram.mockClear();
  fcmSend.mockClear();
  fcmEnabled.value = false;
});

it.each(["fire", "onm", "authority", "earthquake", "unknown"])(
  "does not send %s broadcasts to Telegram and drains the pending row",
  async (kind) => {
    fixture(kind);
    const result = await deliverBroadcasts();
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(result.telegramSent).toBe(0);
    expect(rpc).toHaveBeenCalledWith("finish_broadcast_delivery", {
      _broadcast_id: "b1",
      _channel: "telegram",
      _lease_token: "lease1",
      _count: 0,
      _error: null,
    });
  },
);

it.each(["dgpc_telegram", "other_authority", "", null])(
  "checks registered provenance for official incidents: %s",
  async (key) => {
    fixture("official", key);
    await deliverBroadcasts();
    expect(sendTelegram).toHaveBeenCalledTimes(key === "dgpc_telegram" ? 1 : 0);
  },
);

it("relays Protection Civile even when satellite coverage suppressed FCM push codes", async () => {
  fixture("official", "dgpc_telegram", []);
  await deliverBroadcasts();
  expect(sendTelegram).toHaveBeenCalledWith(
    "chat15",
    "<b>Protection Civile</b>\n\nFeu signalé",
  );
});

it("publishes an official relay under satellite coverage without a duplicate FCM push", async () => {
  const inserted: Record<string, unknown>[] = [];
  const caps: Record<string, unknown>[] = [];
  const data: Record<string, unknown> = {
    broadcast_settings: { enabled: true },
    broadcasts: [
      {
        cluster_id: "f1",
        phase: "initial",
        severity: "Severe",
        commune_codes: ["1501"],
        inside_codes: ["1501"],
        created_at: new Date().toISOString(),
        official_incident_id: null,
      },
    ],
    fire_clusters: [],
    onm_vigilance: [],
    authority_warnings: [],
    official_incidents: [
      {
        id: "i1",
        kind: "vegetation",
        commune_id: "c1",
        wilaya_id: "w15",
        place_text: null,
        status: "ongoing",
        as_of: new Date().toISOString(),
        evidence: "Bulletin officiel incendie Azazga",
        unlisted_at: null,
        latest_mention_id: "m1",
      },
    ],
    admin_units: [
      {
        id: "c1",
        code: "1501",
        level: "commune",
        parent_id: "w15",
        lat: 36.74,
        lon: 4.37,
        name_fr: "Azazga",
        name_ar: "عزازقة",
        name_en: "Azazga",
        name_kab: "Azazga",
      },
    ],
    incident_mentions: [
      {
        id: "m1",
        text_sources: {
          label: "Protection Civile",
          key: "dgpc_telegram",
          authority_tier: "national",
        },
        source_documents: {
          body: "Bulletin officiel incendie Azazga — Protection Civile",
        },
      },
    ],
  };
  from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {};
    let insert = false;
    for (const method of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "or",
      "gte",
      "lte",
      "order",
      "range",
    ])
      q[method] = () => q;
    q["insert"] = (value: Record<string, unknown>) => {
      if (table === "broadcasts") inserted.push(value);
      if (table === "cap_alerts") caps.push(value);
      insert = true;
      return q;
    };
    q["single"] = async () => ({
      data: insert ? { id: "new1" } : data[table],
      error: null,
    });
    q["then"] = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: insert ? null : (data[table] ?? []),
        error: null,
      }).then(resolve);
    return q;
  });
  await publishBroadcasts();
  expect(caps).toContainEqual(
    expect.objectContaining({
      info: expect.arrayContaining([
        expect.objectContaining({
          parameter: expect.arrayContaining([
            { valueName: "source_key", value: "dgpc_telegram" },
          ]),
        }),
      ]),
    }),
  );
  expect(inserted).toContainEqual(
    expect.objectContaining({
      kind: "official",
      official_incident_id: "i1",
      commune_codes: ["1501"],
      push_codes: [],
    }),
  );
});

it("publishes verified DGPC non-fire flood even under satellite fire coverage, blocks ITA, and relays M4+ earthquakes once without PII", async () => {
  const inserted: Record<string, unknown>[] = [];
  const caps: Record<string, unknown>[] = [];
  const queriedTables: string[] = [];
  const nowIso = new Date().toISOString();
  const data: Record<string, unknown> = {
    broadcast_settings: { enabled: true },
    broadcasts: [
      {
        cluster_id: "f1",
        kind: "fire",
        phase: "initial",
        severity: "Severe",
        commune_codes: ["1501"],
        push_codes: ["1501"],
        inside_codes: ["1501"],
        created_at: nowIso,
        official_incident_id: null,
        earthquake_id: "eq-already-pushed",
      },
    ],
    fire_clusters: [],
    onm_vigilance: [],
    authority_warnings: [],
    official_incidents: [
      {
        id: "inc-flood-dgpc",
        kind: "flood",
        commune_id: "c1",
        wilaya_id: "w15",
        place_text: "Oued Aïssi",
        status: "ongoing",
        as_of: nowIso,
        evidence: "تدخل متواصل لامتصاص مياه الأمطار في بلدية عزازقة",
        unlisted_at: null,
        latest_mention_id: "m-dgpc",
      },
      {
        id: "inc-flood-ita",
        kind: "flood",
        commune_id: "c1",
        wilaya_id: "w15",
        place_text: "Centre",
        status: "ongoing",
        as_of: nowIso,
        evidence: "فيضانات مسجلة حسب منشور إعلامي في بلدية عزازقة",
        unlisted_at: null,
        latest_mention_id: "m-ita",
      },
    ],
    earthquakes: [
      {
        id: "eq-m44-new",
        occurred_at: nowIso,
        lat: 36.74,
        lon: 4.37,
        depth_km: 10,
        magnitude: 4.4,
        magnitude_type: "ML",
        region: "NORTHERN ALGERIA",
        network: "EMSC",
        commune_id: "c1",
        offshore: false,
      },
      {
        id: "eq-already-pushed",
        occurred_at: nowIso,
        lat: 36.74,
        lon: 4.37,
        depth_km: 10,
        magnitude: 4.6,
        magnitude_type: "ML",
        region: "NORTHERN ALGERIA",
        network: "EMSC",
        commune_id: "c1",
        offshore: false,
      },
      {
        id: "eq-m37-downgraded",
        occurred_at: nowIso,
        lat: 36.74,
        lon: 4.37,
        depth_km: 10,
        magnitude: 3.7,
        magnitude_type: "ML",
        region: "NORTHERN ALGERIA",
        network: "EMSC",
        commune_id: "c1",
        offshore: false,
      },
    ],
    admin_units: [
      {
        id: "w15",
        code: "15",
        level: "wilaya",
        parent_id: null,
        lat: 36.71,
        lon: 4.05,
        name_fr: "Tizi Ouzou",
        name_ar: "تيزي وزو",
        name_en: "Tizi Ouzou",
        name_kab: "Tizi Uzzu",
      },
      {
        id: "c1",
        code: "1501",
        level: "commune",
        parent_id: "w15",
        lat: 36.74,
        lon: 4.37,
        name_fr: "Azazga",
        name_ar: "عزازقة",
        name_en: "Azazga",
        name_kab: "Iɛeẓẓugen",
      },
      {
        id: "c-far",
        code: "3101",
        level: "commune",
        parent_id: null,
        lat: 35.7,
        lon: -0.63,
        name_fr: "Oran",
        name_ar: "وهران",
        name_en: "Oran",
        name_kab: "Wehran",
      },
    ],
    incident_mentions: [
      {
        id: "m-dgpc",
        text_sources: {
          label: "Protection Civile",
          key: "dgpc_telegram",
          authority_tier: "national",
        },
        source_documents: {
          body: "الحماية المدنية: تدخل متواصل لامتصاص مياه الأمطار في بلدية عزازقة.",
        },
      },
      {
        id: "m-ita",
        text_sources: {
          label: "Info Trafic Algérie",
          key: "ita_facebook",
          authority_tier: "media",
        },
        source_documents: {
          body: "فيضانات مسجلة حسب منشور إعلامي في بلدية عزازقة",
        },
      },
    ],
  };

  from.mockImplementation((table: string) => {
    queriedTables.push(table);
    const q: Record<string, unknown> = {};
    let insert = false;
    for (const method of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "or",
      "gte",
      "lte",
      "order",
      "range",
    ])
      q[method] = () => q;
    q["insert"] = (value: Record<string, unknown>) => {
      if (table === "broadcasts") inserted.push(value);
      if (table === "cap_alerts") caps.push(value);
      insert = true;
      return q;
    };
    q["single"] = async () => ({
      data: insert ? { id: "new-id" } : data[table],
      error: null,
    });
    q["then"] = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: insert ? null : (data[table] ?? []),
        error: null,
      }).then(resolve);
    return q;
  });

  await publishBroadcasts();

  // Zero subscriber PII tables queried
  expect(queriedTables).not.toContain("profiles");
  expect(queriedTables).not.toContain("zones");
  expect(queriedTables).not.toContain("users");

  // DGPC flood is published AND NOT suppressed by satellite fire coverage in 1501
  expect(inserted).toContainEqual(
    expect.objectContaining({
      kind: "official",
      phase: "initial",
      official_incident_id: "inc-flood-dgpc",
      hazard: "flood",
      source_key: "dgpc_telegram",
      commune_codes: ["1501"],
      push_codes: ["1501"],
    }),
  );
  // ITA flood is strictly blocked
  expect(
    inserted.some((r) => r["official_incident_id"] === "inc-flood-ita"),
  ).toBe(false);
  // Only new M4.4 earthquake is broadcast to communes within 100 km (1501, NOT Oran 3101)
  expect(inserted).toContainEqual(
    expect.objectContaining({
      kind: "earthquake",
      earthquake_id: "eq-m44-new",
      severity: "Severe",
      commune_codes: ["1501"],
      push_codes: ["1501"],
      source_key: "emsc",
    }),
  );
  // Already-pushed M4.6 never double-pushes; downgraded M3.7 never retracts
  expect(
    inserted
      .filter((r) => r["kind"] === "earthquake")
      .map((r) => r["earthquake_id"]),
  ).toEqual(["eq-m44-new"]);
});

it("delivers earthquake broadcasts to FCM commune topics only (zero Telegram) and skips cancelled ONM in FCM", async () => {
  fcmEnabled.value = true;
  const jobs = [
    {
      id: "b-eq",
      lease_token: "lease-eq",
      kind: "earthquake",
      phase: "initial",
      severity: "Severe",
      commune_codes: ["1501"],
      push_codes: ["1501"],
      cluster_id: null,
      cap_alert_id: "cap-eq",
      onm_vigilance_id: null,
      authority_warning_id: null,
      official_incident_id: null,
      earthquake_id: "eq-1",
    },
    {
      id: "b-onm-cancelled",
      lease_token: "lease-onm",
      kind: "onm",
      phase: "initial",
      severity: "Severe",
      commune_codes: ["1501"],
      push_codes: ["1501"],
      cluster_id: null,
      cap_alert_id: null,
      onm_vigilance_id: "onm-cancelled",
      authority_warning_id: null,
      official_incident_id: null,
      earthquake_id: null,
    },
  ];
  const fcmQueue = [...jobs];
  const tgQueue = [...jobs];
  const tableData: Record<string, unknown> = {
    broadcast_settings: { enabled: true },
    cap_alerts: [
      {
        id: "cap-eq",
        info: [
          {
            language: "fr-DZ",
            headline: "EMSC : séisme de magnitude 4.4 près de Azazga",
            description: "Séisme enregistré.",
            parameter: [
              { valueName: "source_key", value: "emsc" },
              { valueName: "magnitude", value: "4.4" },
              { valueName: "earthquake_id", value: "eq-1" },
            ],
          },
        ],
      },
    ],
    earthquakes: [
      {
        id: "eq-1",
        magnitude: 4.4,
        network: "EMSC",
        occurred_at: new Date().toISOString(),
      },
    ],
    onm_vigilance: [
      {
        id: "onm-cancelled",
        title: "Rain Severe",
        headline_fr: "Pluies",
        wilaya_id: "w15",
        event: "Rain",
        msg_type: "Alert",
        cancelled_at: new Date().toISOString(),
        instruction_fr: null,
      },
    ],
    telegram_channels: [{ wilaya_id: "w15", chat_id: "chat15" }],
    admin_units: [{ code: "1501", parent_id: "w15" }],
    broadcast_delivery_receipts: [],
  };

  rpc.mockImplementation(async (name: string, args: { _channel?: string }) => {
    if (name === "claim_broadcast_delivery") {
      const next = args._channel === "fcm" ? fcmQueue.shift() : tgQueue.shift();
      return { data: next ? [{ job: next }] : [], error: null };
    }
    return { data: true, error: null };
  });
  from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "range", "upsert"])
      q[method] = () => q;
    q["single"] = async () => ({ data: tableData[table], error: null });
    q["then"] = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: tableData[table] ?? [], error: null }).then(
        resolve,
      );
    return q;
  });

  const result = await deliverBroadcasts();
  expect(fcmSend).toHaveBeenCalledTimes(1);
  expect(fcmSend).toHaveBeenCalledWith(
    expect.objectContaining({
      topic: "v1.commune.1501.fr",
      android: expect.objectContaining({
        notification: expect.objectContaining({
          channel_id: "alerts_earthquakes",
        }),
      }),
      data: expect.objectContaining({
        kind: "earthquake",
        channel_id: "alerts_earthquakes",
        magnitude: "4.4",
        provenance_trigger: "commune_topic",
        provenance_source_key: "emsc",
        provenance_rule: "provenance.rule.m4Quake",
      }),
    }),
  );
  expect(sendTelegram).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith("finish_broadcast_delivery", {
    _broadcast_id: "b-onm-cancelled",
    _channel: "fcm",
    _lease_token: "lease-onm",
    _count: null,
    _error: "cap_cancelled",
  });
  expect(result.rows).toBe(1);
  expect(result.sent).toBe(1);
  expect(result.telegramSent).toBe(0);
});

it("enforces combined daily commune cap across relays (M5+ exempt) and respects the global kill switch", async () => {
  const inserted: Record<string, unknown>[] = [];
  const nowIso = new Date().toISOString();
  // Commune 1501 already has 6 pushes today -> non-Extreme relays are capped, M5.2 Extreme is exempt
  const sixToday = Array.from({ length: 6 }, () => ({
    cluster_id: null,
    kind: "fire",
    phase: "initial",
    severity: "Severe",
    commune_codes: ["1501"],
    push_codes: ["1501"],
    inside_codes: [],
    created_at: nowIso,
    official_incident_id: null,
    earthquake_id: null,
  }));
  let enabled = false;
  const data: Record<string, unknown> = {
    broadcasts: sixToday,
    fire_clusters: [],
    onm_vigilance: [],
    authority_warnings: [],
    official_incidents: [],
    earthquakes: [
      {
        id: "eq-m42-capped",
        occurred_at: nowIso,
        lat: 36.74,
        lon: 4.37,
        depth_km: 10,
        magnitude: 4.2,
        magnitude_type: "ML",
        region: "NORTHERN ALGERIA",
        network: "EMSC",
        commune_id: "c1",
        offshore: false,
      },
      {
        id: "eq-m53-exempt",
        occurred_at: nowIso,
        lat: 36.74,
        lon: 4.37,
        depth_km: 10,
        magnitude: 5.3,
        magnitude_type: "MW",
        region: "NORTHERN ALGERIA",
        network: "EMSC",
        commune_id: "c1",
        offshore: false,
      },
    ],
    admin_units: [
      {
        id: "c1",
        code: "1501",
        level: "commune",
        parent_id: null,
        lat: 36.74,
        lon: 4.37,
        name_fr: "Azazga",
      },
    ],
  };

  from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {};
    let insert = false;
    for (const method of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "or",
      "gte",
      "lte",
      "order",
      "limit",
      "range",
    ])
      q[method] = () => q;
    q["insert"] = (value: Record<string, unknown>) => {
      if (table === "broadcasts") inserted.push(value);
      insert = true;
      return q;
    };
    q["single"] = async () => ({
      data:
        table === "broadcast_settings"
          ? { enabled }
          : insert
            ? { id: "new-id" }
            : data[table],
      error: null,
    });
    q["maybeSingle"] = async () => ({ data: null, error: null });
    q["then"] = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: insert ? null : (data[table] ?? []),
        error: null,
      }).then(resolve);
    return q;
  });

  // Kill switch off -> blocks everything
  expect(await publishBroadcasts()).toEqual({ published: 0, suppressed: 1 });
  expect(inserted).toHaveLength(0);

  // Kill switch on -> M4.2 Severe is capped (push_codes: []), M5.3 Extreme is exempt (push_codes: ["1501"])
  enabled = true;
  await publishBroadcasts();
  expect(inserted).toContainEqual(
    expect.objectContaining({
      kind: "earthquake",
      earthquake_id: "eq-m42-capped",
      severity: "Severe",
      push_codes: [],
    }),
  );
  expect(inserted).toContainEqual(
    expect.objectContaining({
      kind: "earthquake",
      earthquake_id: "eq-m53-exempt",
      severity: "Extreme",
      push_codes: ["1501"],
    }),
  );
});
