import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  upserts: [] as Record<string, unknown>[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcImpl: vi.fn(),
  fetch: vi.fn(),
  detailRows: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return state.rpcImpl(name, args);
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        not: () => query,
        order: () => query,
        limit: () => query,
        range: () => query,
        upsert: async (rows: Record<string, unknown>[]) => {
          state.upserts.push(...rows);
          return { error: null };
        },
        then: (resolve: (value: unknown) => unknown) => {
          if (table === "admin_units") {
            return Promise.resolve({
              data: [
                { id: "w-16", name_fr: "Alger", name_en: "Algiers" },
                { id: "w-09", name_fr: "Blida", name_en: "Blida" },
              ],
              error: null,
            }).then(resolve);
          }
          if (table === "onm_vigilance") {
            return Promise.resolve({
              data: state.detailRows,
              error: null,
            }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return query;
    },
  },
}));

vi.mock("@/lib/source-archive.server", () => ({
  archivedFetch: (...args: unknown[]) => state.fetch(...args),
  ArchiveFailure: class extends Error {},
}));

import {
  onmRelayPlan,
  onmUpdateMaterialChange,
  onmWarningIsCurrent,
  type OnmWarning,
} from "@/lib/broadcast-rules";
import {
  parseCapMsgType,
  parseCapReferenceIds,
  parseCapReferences,
} from "@/lib/cap";
import { fcmMessagesForOnm } from "@/lib/fcm";
import {
  backfillCapDetails,
  ingestOnm,
  parseCapDetail,
  parseOnmFeed,
} from "@/lib/ingest/onm.server";

describe("CAP 1.2 msgType & references parsing (ReDoS-safe)", () => {
  it("parses Alert, Update, Cancel case-insensitively and rejects Ack/Error/unknown", () => {
    expect(parseCapMsgType("Alert")).toBe("Alert");
    expect(parseCapMsgType("  update ")).toBe("Update");
    expect(parseCapMsgType("CANCEL")).toBe("Cancel");
    expect(parseCapMsgType("Ack")).toBeNull();
    expect(parseCapMsgType("Error")).toBeNull();
    expect(parseCapMsgType("unknown")).toBeNull();
    expect(parseCapMsgType("")).toBeNull();
    expect(parseCapMsgType(null)).toBeNull();
  });

  it("parses single, multi whitespace-delimited, newline-delimited, and comma-joined CAP reference tuples", () => {
    const refs = parseCapReferences(
      "onm@meteo.dz,urn:oid:cap.1,2026-11-24T10:00:00+01:00\n  onm@meteo.dz,urn:oid:cap.2,2026-11-24T11:00:00Z onm@meteo.dz,urn:oid:cap.1,2026-11-24T10:00:00+01:00",
    );
    expect(refs).toEqual([
      {
        sender: "onm@meteo.dz",
        identifier: "urn:oid:cap.1",
        sent: "2026-11-24T10:00:00+01:00",
      },
      {
        sender: "onm@meteo.dz",
        identifier: "urn:oid:cap.2",
        sent: "2026-11-24T11:00:00Z",
      },
    ]);

    const commaJoined = parseCapReferenceIds(
      "s@meteo.dz,id-a,2026-11-24T08:00:00Z,s@meteo.dz,id-b,2026-11-24T09:00:00Z",
    );
    expect(commaJoined).toEqual(["id-a", "id-b"]);
  });

  it("skips malformed tuples without throwing and handles 32 KB adversarial input in linear time", () => {
    expect(
      parseCapReferences(
        "broken,tuple onm@meteo.dz,id-bad,not-a-date ,empty,2026-11-24T10:00:00Z onm@meteo.dz,id-ok,2026-11-24T10:00:00Z",
      ),
    ).toEqual([
      {
        sender: "onm@meteo.dz",
        identifier: "id-ok",
        sent: "2026-11-24T10:00:00Z",
      },
    ]);

    const adversarial = `${"a,".repeat(20_000)}not-a-date`;
    const start = performance.now();
    const result = parseCapReferences(adversarial);
    const elapsedMs = performance.now() - start;
    expect(result).toEqual([]);
    expect(elapsedMs).toBeLessThan(50);
  });
});

describe("ONM Atom & CAP detail chain parsing + ingestion", () => {
  beforeEach(() => {
    state.upserts = [];
    state.rpcCalls = [];
    state.detailRows = [];
    state.rpcImpl.mockReset().mockImplementation(async (name: string) => {
      if (name === "supersede_onm_absent") return { data: 1, error: null };
      if (name === "apply_onm_cap_chain") {
        return {
          data: {
            linked_updates: 1,
            cancelled_warnings: 1,
            invalidated_deliveries: 2,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    state.fetch.mockReset();
  });

  it("parses Update, Cancel, references, geocodes, and drops Ack entries in Atom feed", () => {
    const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <entry>
    <id>urn:oid:onm.cancel.3</id>
    <title>Rain Cancel for ALGER</title>
    <cap:msgType>Cancel</cap:msgType>
    <cap:references>prevision_meteo@meteo.dz,urn:oid:onm.update.2,2026-11-24T11:00:00Z</cap:references>
    <cap:sent>2026-11-24T12:00:00Z</cap:sent>
    <cap:severity>Severe</cap:severity>
    <cap:areaDesc>ALGER</cap:areaDesc>
  </entry>
  <entry>
    <id>urn:oid:onm.ack.skip</id>
    <title>Ack entry</title>
    <cap:msgType>Ack</cap:msgType>
    <cap:sent>2026-11-24T12:05:00Z</cap:sent>
    <cap:areaDesc>ALGER</cap:areaDesc>
  </entry>
  <entry>
    <id>urn:oid:onm.update.2</id>
    <title>Rain Extreme warning for the wilaya: ALGER</title>
    <cap:msgType>Update</cap:msgType>
    <cap:references>prevision_meteo@meteo.dz,urn:oid:onm.alert.1,2026-11-24T10:00:00Z</cap:references>
    <cap:sent>2026-11-24T11:00:00Z</cap:sent>
    <cap:severity>Extreme</cap:severity>
    <cap:areaDesc>ALGER</cap:areaDesc>
    <cap:geocode><cap:valueName>commune</cap:valueName><cap:value>1601</cap:value></cap:geocode>
  </entry>
</feed>`;
    const entries = parseOnmFeed(atom);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.msg_type).toBe("Cancel");
    expect(entries[0]!.referenced_cap_ids).toEqual(["urn:oid:onm.update.2"]);
    expect(entries[1]!.msg_type).toBe("Update");
    expect(entries[1]!.referenced_cap_ids).toEqual(["urn:oid:onm.alert.1"]);
    expect(entries[1]!.geocodes).toEqual(["1601"]);
  });

  it("parses CAP detail msgType, references, geocodes, and preserves verbatim authority instruction", () => {
    const capXml = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>urn:oid:onm.update.2</identifier>
  <sender>prevision_meteo@meteo.dz</sender>
  <sent>2026-11-24T11:00:00+01:00</sent>
  <status>Actual</status>
  <msgType>Update</msgType>
  <scope>Public</scope>
  <references>prevision_meteo@meteo.dz,urn:oid:onm.alert.1,2026-11-24T10:00:00+01:00</references>
  <info>
    <language>fr-FR</language>
    <headline>Bulletin Spécial Pluie — Alger</headline>
    <instruction>Évitez les oueds et suivez les consignes de la Protection Civile.</instruction>
    <area>
      <areaDesc>ALGER</areaDesc>
      <geocode><valueName>DZ_COMMUNE</valueName><value>1601</value></geocode>
      <geocode><valueName>DZ_COMMUNE</valueName><value>1602</value></geocode>
    </area>
  </info>
</alert>`;
    const detail = parseCapDetail(capXml)!;
    expect(detail.msg_type).toBe("Update");
    expect(detail.referenced_cap_ids).toEqual(["urn:oid:onm.alert.1"]);
    expect(detail.geocodes).toEqual(["1601", "1602"]);
    expect(detail.headline_fr).toBe("Bulletin Spécial Pluie — Alger");
    expect(detail.instruction_fr).toBe(
      "Évitez les oueds et suivez les consignes de la Protection Civile.",
    );
  });

  it("sorts Alert < Update < Cancel on equal timestamps, runs supersede_onm_absent before apply_onm_cap_chain", async () => {
    const sameTs = "2026-11-24T11:00:00Z";
    const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <entry>
    <id>urn:oid:c3</id>
    <title>Rain Cancel for ALGER</title>
    <cap:msgType>Cancel</cap:msgType>
    <cap:references>onm@meteo.dz,urn:oid:u2,${sameTs}</cap:references>
    <cap:sent>${sameTs}</cap:sent>
    <cap:severity>Severe</cap:severity>
    <cap:areaDesc>ALGER</cap:areaDesc>
  </entry>
  <entry>
    <id>urn:oid:u2</id>
    <title>Rain Extreme warning for ALGER</title>
    <cap:msgType>Update</cap:msgType>
    <cap:references>onm@meteo.dz,urn:oid:a1,${sameTs}</cap:references>
    <cap:sent>${sameTs}</cap:sent>
    <cap:severity>Extreme</cap:severity>
    <cap:areaDesc>ALGER</cap:areaDesc>
  </entry>
  <entry>
    <id>urn:oid:a1</id>
    <title>Rain Severe warning for ALGER</title>
    <cap:msgType>Alert</cap:msgType>
    <cap:sent>${sameTs}</cap:sent>
    <cap:severity>Severe</cap:severity>
    <cap:areaDesc>ALGER</cap:areaDesc>
  </entry>
</feed>`;
    state.fetch.mockResolvedValueOnce(new Response(feed));
    const run = await ingestOnm();
    expect(state.upserts.map((r) => r["cap_id"])).toEqual([
      "urn:oid:a1",
      "urn:oid:u2",
      "urn:oid:c3",
    ]);
    expect(state.rpcCalls.map((c) => c.name)).toEqual([
      "supersede_onm_absent",
      "apply_onm_cap_chain",
    ]);
    expect(run.linkedUpdates).toBe(1);
    expect(run.cancelled).toBe(1);
    expect(run.invalidatedDeliveries).toBe(2);
  });

  it("triggers apply_onm_cap_chain when CAP detail XML populates references", async () => {
    state.detailRows = [
      {
        id: "row-2",
        cap_id: "urn:oid:onm.detail.2",
        cap_url: "https://ametvigilance.meteo.dz/CAPs/detail2.xml",
      },
    ];
    state.fetch.mockResolvedValueOnce(
      new Response(`<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
        <msgType>Cancel</msgType>
        <references>onm@meteo.dz,urn:oid:onm.detail.1,2026-11-24T09:00:00Z</references>
        <info><headline>Annulation</headline></info>
      </alert>`),
    );
    const res = await backfillCapDetails();
    expect(res).toEqual({ filled: 1, failed: 0 });
    expect(state.rpcCalls.map((c) => c.name)).toEqual([
      "store_onm_detail",
      "apply_onm_cap_chain",
    ]);
    expect(state.rpcCalls[1]!.args).toEqual({
      _cap_ids: ["urn:oid:onm.detail.2"],
    });
  });
});

describe("ONM CAP Update/Cancel material change & relay rules", () => {
  const t = (iso: string) => Date.parse(iso);
  const baseAlert: OnmWarning = {
    id: "w-1",
    capId: "urn:oid:1",
    msgType: "Alert",
    wilayaId: "w-16",
    event: "Rain",
    severity: "Severe",
    sentMs: t("2026-11-24T09:00:00Z"),
    onsetMs: t("2026-11-24T10:00:00Z"),
    expiresMs: t("2026-11-24T22:00:00Z"),
    areaDesc: "ALGER",
    geocodes: ["1601"],
    instructionFr: "Restez vigilants.",
  };

  it("emits update on severity escalation, area expansion, or material instruction change", () => {
    const escalated = {
      ...baseAlert,
      id: "w-2",
      capId: "urn:oid:2",
      msgType: "Update" as const,
      severity: "Extreme",
      sentMs: t("2026-11-24T10:30:00Z"),
      referencedCapIds: ["urn:oid:1"],
    };
    expect(onmUpdateMaterialChange(escalated, [baseAlert])).toEqual({
      material: true,
      reasons: ["severity_escalation"],
    });
    expect(
      onmRelayPlan([escalated], [baseAlert]).relay.map((w) => w.id),
    ).toEqual(["w-2"]);

    const expanded = {
      ...baseAlert,
      id: "w-3",
      capId: "urn:oid:3",
      msgType: "Update" as const,
      sentMs: t("2026-11-24T10:40:00Z"),
      referencedCapIds: ["urn:oid:1"],
      geocodes: ["1601", "1602"],
    };
    expect(onmUpdateMaterialChange(expanded, [baseAlert])).toEqual({
      material: true,
      reasons: ["area_expansion"],
    });
    expect(
      onmRelayPlan([expanded], [baseAlert]).relay.map((w) => w.id),
    ).toEqual(["w-3"]);

    const instructed = {
      ...baseAlert,
      id: "w-4",
      capId: "urn:oid:4",
      msgType: "Update" as const,
      sentMs: t("2026-11-24T10:50:00Z"),
      referencedCapIds: ["urn:oid:1"],
      instructionFr: "Évitez tout déplacement près des oueds.",
    };
    expect(onmUpdateMaterialChange(instructed, [baseAlert])).toEqual({
      material: true,
      reasons: ["instruction_change"],
    });
    expect(
      onmRelayPlan([instructed], [baseAlert]).relay.map((w) => w.id),
    ).toEqual(["w-4"]);
  });

  it("keeps identical reissue Updates and de-escalations silent", () => {
    const identical = {
      ...baseAlert,
      id: "w-reissue",
      capId: "urn:oid:reissue",
      msgType: "Update" as const,
      sentMs: t("2026-11-24T11:00:00Z"),
      referencedCapIds: ["urn:oid:1"],
    };
    expect(onmUpdateMaterialChange(identical, [baseAlert]).material).toBe(
      false,
    );
    const plan = onmRelayPlan([identical], [baseAlert]);
    expect(plan.relay).toEqual([]);
    expect(plan.suppressed.map((w) => w.id)).toEqual(["w-reissue"]);

    const boilerplateUpdate = {
      ...baseAlert,
      id: "w-bp",
      capId: "urn:oid:bp",
      msgType: "Update" as const,
      sentMs: t("2026-11-24T11:15:00Z"),
      referencedCapIds: ["urn:oid:1"],
      instructionFr: "No additional information.",
    };
    expect(
      onmUpdateMaterialChange(boilerplateUpdate, [baseAlert]).material,
    ).toBe(false);

    const deescalated = {
      ...baseAlert,
      id: "w-down",
      capId: "urn:oid:down",
      msgType: "Update" as const,
      severity: "Severe",
      sentMs: t("2026-11-24T11:30:00Z"),
      referencedCapIds: ["urn:oid:ext"],
    };
    const extremePrior = {
      ...baseAlert,
      id: "w-ext",
      capId: "urn:oid:ext",
      severity: "Extreme",
    };
    expect(onmRelayPlan([deescalated], [extremePrior]).relay).toEqual([]);
  });

  it("excludes Cancel, cancelled, and superseded warnings from current and relay plans without fabricating all-clear", () => {
    const now = t("2026-11-24T12:00:00Z");
    const cancelRow: OnmWarning = {
      ...baseAlert,
      id: "w-cancel",
      msgType: "Cancel",
    };
    const cancelledRow: OnmWarning = {
      ...baseAlert,
      id: "w-cancelled",
      cancelledAtMs: t("2026-11-24T11:30:00Z"),
    };
    const supersededRow: OnmWarning = {
      ...baseAlert,
      id: "w-sup",
      supersededBy: "w-2",
    };
    expect(onmWarningIsCurrent(cancelRow, now)).toBe(false);
    expect(onmWarningIsCurrent(cancelledRow, now)).toBe(false);
    expect(onmWarningIsCurrent(supersededRow, now)).toBe(false);
    expect(
      onmRelayPlan([cancelRow, cancelledRow, supersededRow], []).relay,
    ).toEqual([]);
  });

  it("preserves verbatim ONM attribution without alteration", () => {
    const msgs = fcmMessagesForOnm({
      broadcastId: "b-onm",
      severity: "Extreme",
      communeCodes: ["1601"],
      title: "Rain Extreme warning for ALGER",
      headlineFr: "Pluies torrentielles attendues sur ALGER",
      wilayaId: "w-16",
      event: "Rain",
    });
    for (const m of msgs) {
      expect(m.notification.title).toBe("ONM · Météo Algérie");
      expect(m.notification.body).toBe(
        "Pluies torrentielles attendues sur ALGER",
      );
    }
  });
});
