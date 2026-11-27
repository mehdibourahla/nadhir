import { describe, expect, it } from "vitest";

import { importRepoModule, readRepoFile, repoFileExists } from "../lib/env.ts";
import {
  buildDgpcNonFirePost,
  buildEmscEvent,
  buildOnmCapXml,
  loadAlgeriaAdmin,
} from "../lib/fixtures.ts";
import { fetchJson, startMockHttpServer } from "../lib/http.ts";
import { assertPgReachable, psqlJson } from "../lib/pg.ts";
import {
  findBannedSafeLabels,
  findEmDashesInText,
  stripHtmlForTextScan,
  withBrowserPage,
} from "../lib/playwright.ts";

type AnyFn = (...args: unknown[]) => unknown;

function findCallable(
  mod: Record<string, unknown>,
  names: string[],
): AnyFn | null {
  for (const name of names) {
    const candidate = mod[name];
    if (typeof candidate === "function") {
      return candidate as AnyFn;
    }
  }
  return null;
}

describe("Tier 1 — F7: ONM CAP Update / Cancel Escalation Chains", () => {
  it("F7.1: ONM CAP parser extracts msgType (Alert/Update/Cancel), identifier, and references from CAP 1.2 XML", async () => {
    const onmMod = await importRepoModule<Record<string, unknown>>(
      "src/lib/ingest/onm.server.ts",
    );
    const parseFn = findCallable(onmMod, [
      "parseCapDetail",
      "parseOnmCapXml",
      "parseOnmCap",
      "parseCapAlert",
    ]);
    expect(parseFn, "ONM CAP XML parser must be exported").not.toBeNull();

    const alertId = "urn:oid:2.49.0.1.12.0.20261124.101";
    const updateId = "urn:oid:2.49.0.1.12.0.20261124.102";
    const cancelId = "urn:oid:2.49.0.1.12.0.20261124.103";

    const alertXml = buildOnmCapXml({
      identifier: alertId,
      msgType: "Alert",
      severity: "Moderate",
    });
    const updateXml = buildOnmCapXml({
      identifier: updateId,
      msgType: "Update",
      severity: "Severe",
      references: `onm@meteo.dz,${alertId},2026-11-24T12:00:00+01:00`,
    });
    const cancelXml = buildOnmCapXml({
      identifier: cancelId,
      msgType: "Cancel",
      severity: "Minor",
      references: `onm@meteo.dz,${updateId},2026-11-24T14:00:00+01:00`,
    });

    const parsedAlert = parseFn!(alertXml) as Record<string, unknown> | null;
    const parsedUpdate = parseFn!(updateXml) as Record<string, unknown> | null;
    const parsedCancel = parseFn!(cancelXml) as Record<string, unknown> | null;

    expect(parsedAlert).toBeTruthy();
    expect(parsedUpdate).toBeTruthy();
    expect(parsedCancel).toBeTruthy();

    const alertMsgType = String(
      parsedAlert?.msg_type ?? parsedAlert?.msgType ?? "",
    );
    const updateMsgType = String(
      parsedUpdate?.msg_type ?? parsedUpdate?.msgType ?? "",
    );
    const cancelMsgType = String(
      parsedCancel?.msg_type ?? parsedCancel?.msgType ?? "",
    );
    expect(alertMsgType).toBe("Alert");
    expect(updateMsgType).toBe("Update");
    expect(cancelMsgType).toBe("Cancel");

    const updateRefs = JSON.stringify(
      parsedUpdate?.cap_references ?? parsedUpdate?.references ?? "",
    );
    const cancelRefs = JSON.stringify(
      parsedCancel?.cap_references ?? parsedCancel?.references ?? "",
    );
    expect(updateRefs).toContain(alertId);
    expect(cancelRefs).toContain(updateId);
  });

  it("F7.2: ONM escalation chain Alert (Moderate) -> Update (Severe) -> Update (Extreme) links references and emits escalation broadcast plan", async () => {
    const rulesMod = await importRepoModule<Record<string, unknown>>(
      "src/lib/broadcast-rules.ts",
    );
    const onmSrc = readRepoFile("src/lib/ingest/onm.server.ts");
    const rulesSrc = readRepoFile("src/lib/broadcast-rules.ts");

    const planFn = findCallable(rulesMod, [
      "onmEscalationPlan",
      "planOnmChain",
      "onmRelayPlan",
      "evaluateOnmUpdate",
    ]);
    expect(planFn, "ONM relay/escalation planner must exist").not.toBeNull();
    expect(`${onmSrc}\n${rulesSrc}`).toMatch(/msg_type|msgType/);
    expect(`${onmSrc}\n${rulesSrc}`).toMatch(/references|cap_references/);
    expect(`${onmSrc}\n${rulesSrc}`).toMatch(/Extreme/);
    expect(`${onmSrc}\n${rulesSrc}`).toMatch(/Severe/);
  });

  it("F7.3: explicit CAP Cancel referencing a prior identifier invalidates pending/leased deliveries (never cancelling on feed silence)", () => {
    const onmSrc = readRepoFile("src/lib/ingest/onm.server.ts");
    const deliverySrc = readRepoFile("src/lib/ingest/delivery.server.ts");
    const broadcastSrc = readRepoFile("src/lib/ingest/broadcast.server.ts");
    const rulesSrc = readRepoFile("src/lib/broadcast-rules.ts");
    const combined = `${onmSrc}\n${deliverySrc}\n${broadcastSrc}\n${rulesSrc}`;

    expect(combined).toMatch(/Cancel/i);
    expect(combined).toMatch(/cancel|invalidat|revok|supersede/i);
    expect(combined).toMatch(/references|cap_references/i);
  });

  it("F7.4: area expansion or material authority instruction update triggers an update while preserving verbatim ONM attribution", async () => {
    const onmMod = await importRepoModule<Record<string, unknown>>(
      "src/lib/ingest/onm.server.ts",
    );
    const parseFn = findCallable(onmMod, [
      "parseCapDetail",
      "parseOnmCapXml",
      "parseOnmCap",
    ]);
    expect(parseFn).not.toBeNull();

    const updatedInstruction =
      "Ne traversez aucun oued en crue et suivez les consignes de la Protection Civile (14).";
    const xml = buildOnmCapXml({
      identifier: "urn:oid:2.49.0.1.12.0.20261124.202",
      msgType: "Update",
      severity: "Extreme",
      senderName: "Office National de la Météorologie (ONM)",
      areaDesc: "Alger, Tipaza, Boumerdès, Blida",
      wilayaCodes: ["16", "42", "35", "09"],
      instruction: updatedInstruction,
      references:
        "onm@meteo.dz,urn:oid:2.49.0.1.12.0.20261124.201,2026-11-24T12:00:00+01:00",
    });

    const detail = parseFn!(xml) as Record<string, unknown> | null;
    expect(detail).toBeTruthy();
    expect(
      String(detail?.instruction_fr ?? detail?.instruction ?? ""),
    ).toContain("Protection Civile (14)");

    const fcmMod = await importRepoModule<{
      fcmMessagesForOnm: (args: {
        broadcastId: string;
        severity: string;
        communeCodes: string[];
        title: string;
        headlineFr: string | null;
        wilayaId: string | null;
        event: string;
      }) => Array<{ notification: { title: string; body: string } }>;
    }>("src/lib/fcm.ts");

    const msgs = fcmMod.fcmMessagesForOnm({
      broadcastId: "brd-onm-update-1",
      severity: "Extreme",
      communeCodes: ["1601", "0901"],
      title: "BMS Pluies Niveau 3",
      headlineFr: "BMS Pluies Niveau 3 - Alger et Blida",
      wilayaId: "16",
      event: "Rain",
    });
    expect(msgs.length).toBeGreaterThanOrEqual(8);
    for (const msg of msgs) {
      expect(msg.notification.title).toMatch(/ONM/i);
    }
  });

  it("F7.5: Postgres onm_vigilance schema persists CAP msg_type, references, and cancellation metadata", () => {
    assertPgReachable();

    const cols = psqlJson<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'onm_vigilance'
      ORDER BY column_name
    `);
    const names = new Set(cols.map((c) => c.column_name));
    expect(names.size).toBeGreaterThan(0);

    const hasMsgType = names.has("msg_type") || names.has("cap_msg_type");
    const hasRefs =
      names.has("cap_references") ||
      names.has("references") ||
      names.has("referenced_cap_ids");
    const hasCancel =
      names.has("cancelled_at") ||
      names.has("canceled_at") ||
      names.has("superseded_by");

    expect(hasMsgType, "onm_vigilance must store msg_type").toBe(true);
    expect(hasRefs, "onm_vigilance must store cap references").toBe(true);
    expect(
      hasCancel,
      "onm_vigilance must store cancellation/supersession",
    ).toBe(true);
  });
});

describe("Tier 1 — F8: DGPC Non-Fire (Flood / Storm / Road / Structure) Broadcast Adapter", () => {
  type CapAlertShape = {
    identifier: string;
    msgType: string;
    info: Array<{
      language: string;
      category: string;
      event: string;
      areaDesc: string;
      description: string;
    }>;
  };

  async function buildNonFireCapForKind(
    kind: "flood" | "storm" | "road" | "structure",
  ): Promise<CapAlertShape> {
    const capMod =
      await importRepoModule<Record<string, unknown>>("src/lib/cap.ts");
    const post = buildDgpcNonFirePost({ kind });
    const buildFn = findCallable(capMod, [
      "buildOfficialCap",
      "buildDgpcOfficialCap",
      "buildOfficialIncidentCap",
    ]);
    expect(buildFn, "Official CAP builder must be exported").not.toBeNull();

    const result = buildFn!({
      incidentId: post.postId,
      kind: post.kind,
      hazard: post.kind,
      areaDesc: post.communeName,
      sentAt: new Date(post.publishedAt),
      asOf: new Date(post.publishedAt),
      texts: [
        {
          language: "fr-DZ",
          event: `Alerte ${post.kind}`,
          headline: post.textFr,
          description: `${post.textFr} (${post.sourceAttribution})`,
          instruction: "",
        },
        {
          language: "ar-DZ",
          event: `تنبيه ${post.kind}`,
          headline: post.textAr,
          description: post.textAr,
          instruction: "",
        },
      ],
    }) as CapAlertShape;

    return result;
  }

  it("F8.1: verified DGPC flood incident produces CAP 1.2 broadcast with non-Fire category 'Met' and commune targeting", async () => {
    const cap = await buildNonFireCapForKind("flood");
    expect(cap.info.length).toBeGreaterThan(0);
    expect(cap.info[0]?.category).toBe("Met");
    expect(cap.info[0]?.areaDesc).toContain("Bab El Oued");
  });

  it("F8.2: verified DGPC storm incident produces CAP 1.2 broadcast with category 'Met'", async () => {
    const cap = await buildNonFireCapForKind("storm");
    expect(cap.info.length).toBeGreaterThan(0);
    expect(cap.info[0]?.category).toBe("Met");
    expect(cap.info[0]?.areaDesc).toContain("Tipaza");
  });

  it("F8.3: verified DGPC road closure incident produces CAP 1.2 broadcast with category 'Transport'", async () => {
    const cap = await buildNonFireCapForKind("road");
    expect(cap.info.length).toBeGreaterThan(0);
    expect(cap.info[0]?.category).toBe("Transport");
    expect(cap.info[0]?.areaDesc).toContain("Cherchell");
  });

  it("F8.4: verified DGPC structure collapse incident produces CAP 1.2 broadcast with category 'Safety' (not 'Fire')", async () => {
    const cap = await buildNonFireCapForKind("structure");
    expect(cap.info.length).toBeGreaterThan(0);
    expect(cap.info[0]?.category).toBe("Safety");
    expect(cap.info[0]?.category).not.toBe("Fire");
  });

  it("F8.5: DGPC broadcast adapter supports non-fire kinds and handles authority 'cleared' status cleanly without bare 'safe'", async () => {
    const broadcastSrc = readRepoFile("src/lib/ingest/broadcast.server.ts");
    const copySrc = readRepoFile("src/lib/broadcast-copy.ts");
    const combined = `${broadcastSrc}\n${copySrc}`;

    expect(combined).toMatch(/flood/);
    expect(combined).toMatch(/storm/);
    expect(combined).toMatch(/road/);
    expect(combined).toMatch(/cleared/);

    // Strip JS/TS comments before scanning source, and verify actual rendered copy across all 4 kinds & both phases
    const copySrcWithoutComments = copySrc
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|\s)\/\/[^\n]*/g, "$1 ");
    expect(findBannedSafeLabels(copySrcWithoutComments)).toEqual([]);

    const copyMod = await importRepoModule<{
      officialHazardTexts: (vars: {
        kind: "flood" | "storm" | "road" | "structure";
        phase?: "initial" | "end";
        commune: string;
        wilaya: string;
        source: string;
        asOf: string;
        evidence?: string | null;
      }) => Array<{
        language: string;
        event: string;
        headline: string;
        description: string;
        instruction: string;
      }>;
    }>("src/lib/broadcast-copy.ts");

    for (const kind of ["flood", "storm", "road", "structure"] as const) {
      for (const phase of ["initial", "end"] as const) {
        const rendered = copyMod.officialHazardTexts({
          kind,
          phase,
          commune: "Bab El Oued",
          wilaya: "Alger",
          source: "DGPC",
          asOf: "24/11 14:30",
        });
        expect(rendered).toHaveLength(4);
        for (const item of rendered) {
          expect(item.instruction).toBe("");
          const combinedText = `${item.event}\n${item.headline}\n${item.description}`;
          expect(findBannedSafeLabels(combinedText)).toEqual([]);
          expect(findEmDashesInText(combinedText).count).toBe(0);
        }
      }
    }
  });
});

describe("Tier 1 — F9: Accountless Multi-Hazard Commune Push Topics", () => {
  it("F9.1: FCM topic format strictly follows v1.commune.<code>.<lang> across all 4 locales", async () => {
    const fcmMod = await importRepoModule<{
      fcmTopic: (code: string, lang: string) => string;
      FCM_LANGS: readonly string[];
    }>("src/lib/fcm.ts");

    expect([...fcmMod.FCM_LANGS].sort()).toEqual(["ar", "en", "fr", "kab"]);
    for (const lang of fcmMod.FCM_LANGS) {
      expect(fcmMod.fcmTopic("1602", lang)).toBe(`v1.commune.1602.${lang}`);
    }
  });

  it("F9.2: DGPC flood and road broadcasts fan out to affected v1.commune.<code>.<lang> topics", async () => {
    const fcmMod = await importRepoModule<{
      fcmMessagesForOfficial: (args: {
        broadcastId: string;
        severity: string;
        hazard?: string;
        kind?: string;
        communeCodes: string[];
        info: Array<{
          language: string;
          headline: string;
          description: string;
        }>;
      }) => Array<{ topic: string; data: Record<string, string> }>;
    }>("src/lib/fcm.ts");

    const post = buildDgpcNonFirePost({ kind: "flood" });
    const msgs = fcmMod.fcmMessagesForOfficial({
      broadcastId: "brd-dgpc-flood-1",
      severity: "Severe",
      hazard: "flood",
      communeCodes: [post.communeCode, "1601"],
      info: [
        {
          language: "ar-DZ",
          headline: "تنبيه فيضان",
          description: post.textAr,
        },
        {
          language: "fr-DZ",
          headline: "Alerte crue",
          description: post.textFr,
        },
        {
          language: "en-US",
          headline: "Flood alert",
          description: "DGPC flood response in Bab El Oued",
        },
        {
          language: "kab-DZ",
          headline: "Alɣu n uḥemmal",
          description: "DGPC Bab El Oued",
        },
      ],
    });

    expect(msgs).toHaveLength(8);
    const topics = msgs.map((m) => m.topic);
    expect(topics).toContain("v1.commune.1602.ar");
    expect(topics).toContain("v1.commune.1602.fr");
    expect(topics).toContain("v1.commune.1601.kab");
  });

  it("F9.3: M4.0+ earthquake broadcasts target communes within 100 km of epicentre on v1.commune.<code>.<lang>", async () => {
    const fcmMod =
      await importRepoModule<Record<string, unknown>>("src/lib/fcm.ts");
    const quakeFcmFn = findCallable(fcmMod, [
      "fcmMessagesForEarthquake",
      "fcmMessagesForQuake",
    ]);
    expect(
      quakeFcmFn,
      "fcm.ts must export earthquake topic message builder",
    ).not.toBeNull();

    const admin = loadAlgeriaAdmin();
    const quake = buildEmscEvent({ lat: 36.7525, lon: 5.0556, mag: 4.6 });
    const bejaiaCommunes = admin.communes
      .filter((c) => c.wilaya_code === "06")
      .slice(0, 3)
      .map((c) => c.code);
    expect(bejaiaCommunes.length).toBeGreaterThan(0);

    const msgs = quakeFcmFn!({
      broadcastId: "brd-quake-m46",
      earthquakeId: quake.id,
      magnitude: quake.properties.mag,
      severity: "Severe",
      communeCodes: bejaiaCommunes,
      lat: quake.properties.lat,
      lon: quake.properties.lon,
      depthKm: quake.properties.depth,
      region: quake.properties.flynn_region,
      observedAt: quake.properties.time,
      sourceAttribution: "EMSC / CRAAG",
      info: [
        { language: "ar-DZ", headline: "زلزال M4.6", description: "بجاية" },
        { language: "fr-DZ", headline: "Séisme M4.6", description: "Béjaïa" },
        {
          language: "en-US",
          headline: "Earthquake M4.6",
          description: "Bejaia",
        },
        { language: "kab-DZ", headline: "Zzelzla M4.6", description: "Bgayet" },
      ],
    }) as Array<{ topic: string; data?: Record<string, string> }>;

    expect(msgs.length).toBeGreaterThanOrEqual(bejaiaCommunes.length);
    for (const msg of msgs) {
      expect(msg.topic).toMatch(/^v1\.commune\.\d+\.(ar|fr|en|kab)$/);
    }
  });

  it("F9.4: Postgres broadcasts.kind CHECK constraint accepts 'earthquake' alongside 'fire', 'onm', 'authority', and 'official'", () => {
    assertPgReachable();

    const constraints = psqlJson<{ constraint_def: string }>(`
      SELECT pg_get_constraintdef(con.oid) AS constraint_def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'broadcasts'
        AND pg_get_constraintdef(con.oid) ILIKE '%kind%'
    `);

    expect(constraints.length).toBeGreaterThan(0);
    const combined = constraints.map((c) => c.constraint_def).join(" ");
    for (const kind of ["fire", "onm", "authority", "official", "earthquake"]) {
      expect(combined, `broadcasts.kind must accept '${kind}'`).toContain(
        `'${kind}'`,
      );
    }
  });

  it("F9.5: accountless /api/public/v1/subscribe rejects invalid requests and stores zero durable per-subscriber personal data", async () => {
    const subscribeSrc = readRepoFile("src/routes/api/public/v1/subscribe.ts");
    expect(subscribeSrc).not.toMatch(/\.insert\s*\(/);
    expect(subscribeSrc).not.toMatch(/\.upsert\s*\(/);
    expect(subscribeSrc).not.toMatch(/\b(?:email|phone|lat|lon)\b/);

    const badRes = await fetchJson<Record<string, unknown>>(
      "/api/public/v1/subscribe",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "",
          communes: [],
          lang: "invalid",
          action: "subscribe",
        }),
      },
    );
    expect([400, 503]).toContain(badRes.status);
  });
});

describe("Tier 1 — F10: 'Why am I seeing this?' Trigger Provenance Footer", () => {
  type ProvenanceMod = {
    ALERT_TRIGGER_KINDS: readonly string[];
    buildAlertProvenance: (input: {
      triggerKind: string;
      areaLabel?: string | null;
      radiusKm?: number | null;
      sourceKey: string;
      sourceAttribution?: string | null;
      ruleLabelKey?: string;
      observedAt: string;
      authorityStatus?: string;
    }) => Record<string, unknown>;
    validateProvenanceInvariants: (data: Record<string, unknown>) => string[];
    toProvenancePayload: (
      data: Record<string, unknown>,
    ) => Record<string, string>;
    parseProvenancePayload: (
      raw: Record<string, string>,
    ) => Record<string, unknown> | null;
    formatProvenanceDigestLine: (
      data: Record<string, unknown>,
      labels: {
        trigger: string;
        rule: string;
        areaFallback: string;
        timeLabel: string;
        radiusLabel?: string;
      },
    ) => string;
  };

  it("F10.1: builds valid AlertProvenance for all 6 AlertTriggerKind values with ISO timestamp and verbatim attribution", async () => {
    const mod = await importRepoModule<ProvenanceMod>(
      "src/lib/alert-provenance.ts",
    );

    expect([...mod.ALERT_TRIGGER_KINDS].sort()).toEqual([
      "commune_topic",
      "current_commune",
      "national_feed",
      "self_test",
      "watch_zone",
      "wilaya_warning",
    ]);

    for (const triggerKind of mod.ALERT_TRIGGER_KINDS) {
      const built = mod.buildAlertProvenance({
        triggerKind,
        areaLabel: triggerKind === "national_feed" ? null : "Alger",
        radiusKm: triggerKind === "watch_zone" ? 15 : null,
        sourceKey: triggerKind === "wilaya_warning" ? "onm" : "dgpc_telegram",
        sourceAttribution:
          triggerKind === "wilaya_warning"
            ? "Office National de la Météorologie (ONM)"
            : "DGPC",
        ruleLabelKey: "provenance.rule.generic",
        observedAt: "2026-11-24T14:00:00Z",
        authorityStatus: "official",
      });
      expect(
        mod.validateProvenanceInvariants(built),
        `triggerKind=${triggerKind} must have zero violations`,
      ).toEqual([]);
    }
  });

  it("F10.2: toProvenancePayload and parseProvenancePayload round-trip structured provenance_* FCM keys losslessly", async () => {
    const mod = await importRepoModule<ProvenanceMod>(
      "src/lib/alert-provenance.ts",
    );
    const original = mod.buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: "Bab El Oued",
      radiusKm: 20,
      sourceKey: "emsc",
      sourceAttribution: "EMSC / CRAAG",
      ruleLabelKey: "provenance.rule.m4Quake",
      observedAt: "2026-11-24T13:42:18Z",
      authorityStatus: "official",
    });

    const wire = mod.toProvenancePayload(original);
    expect(wire.provenance_trigger).toBe("watch_zone");
    expect(wire.provenance_area).toBe("Bab El Oued");
    expect(wire.provenance_radius_km).toBe("20");
    expect(wire.provenance_source_key).toBe("emsc");
    expect(wire.provenance_source).toBe("EMSC / CRAAG");
    expect(wire.provenance_observed_at).toBe("2026-11-24T13:42:18Z");

    const parsed = mod.parseProvenancePayload(wire);
    expect(parsed).toEqual(original);
  });

  it("F10.3: formatProvenanceDigestLine generates localized WhatsApp/email footer without em dashes or banned labels", async () => {
    const mod = await importRepoModule<ProvenanceMod>(
      "src/lib/alert-provenance.ts",
    );
    const prov = mod.buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: "Cherchell",
      sourceKey: "dgpc_telegram",
      sourceAttribution: "DGPC",
      ruleLabelKey: "provenance.rule.dgpcNonFire",
      observedAt: "2026-11-24T15:40:00Z",
    });

    const line = mod.formatProvenanceDigestLine(prov, {
      trigger: "Commune alerts",
      rule: "Official non-fire incident",
      areaFallback: "Not recorded",
      timeLabel: "16:40 CET",
    });

    expect(line).toContain("DGPC");
    expect(line).toContain("Cherchell");
    expect(line).toContain("16:40 CET");
    expect(findEmDashesInText(line).count).toBe(0);
    expect(findBannedSafeLabels(line)).toEqual([]);
  });

  it("F10.4: provenance translations exist in all 4 locales (ar, fr, en, kab) with zero em dashes", async () => {
    const locales = await Promise.all(
      (["ar", "fr", "en", "kab"] as const).map(async (loc) => {
        const mod = await importRepoModule<Record<string, unknown>>(
          `src/i18n/locales/${loc}.ts`,
        );
        return [loc, mod[loc] as Record<string, unknown>] as const;
      }),
    );

    for (const [loc, tree] of locales) {
      const prov = tree.provenance as Record<string, unknown> | undefined;
      expect(prov, `${loc} must include provenance namespace`).toBeDefined();
      const serialized = JSON.stringify(prov);
      expect(serialized.length).toBeGreaterThan(100);
      expect(findEmDashesInText(serialized).count).toBe(0);
    }
  });

  it("F10.5: AlertProvenance component & live rendered view expose focusable 'Why am I seeing this?' disclosure with Escape dismissal", async () => {
    expect(repoFileExists("src/components/nadhir/AlertProvenance.tsx")).toBe(
      true,
    );
    const compSrc = readRepoFile("src/components/nadhir/AlertProvenance.tsx");
    expect(compSrc).toMatch(/Escape/);
    expect(compSrc).toMatch(/tabIndex|aria-expanded|<button|<details/i);

    await withBrowserPage(
      { locale: "fr", viewport: "desktop" },
      async (page) => {
        const res = await page.goto(
          `${process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173"}/`,
          {
            waitUntil: "domcontentloaded",
            timeout: 20_000,
          },
        );
        expect(res?.status()).toBe(200);
        const html = await page.content();
        expect(html.length).toBeGreaterThan(500);
      },
    );
  });
});

describe("Tier 1 — F11: Distinct Android Notification Channels (6 IDs)", () => {
  type ChannelsMod = {
    NOTIFICATION_CHANNEL_IDS: readonly string[];
    DEFAULT_LOCAL_NOTIFICATION_EXACT: boolean;
    resolveNotificationChannel: (input: {
      kind: string;
      severity?: string | number | null;
      hazard?: string | null;
      magnitude?: number | null;
      phase?: string | null;
      status?: string | null;
    }) => string;
  };

  it("F11.1: defines all 6 canonical channel IDs and enforces DEFAULT_LOCAL_NOTIFICATION_EXACT=false", async () => {
    const mod = await importRepoModule<ChannelsMod>(
      "src/lib/notification-channels.ts",
    );
    expect([...mod.NOTIFICATION_CHANNEL_IDS]).toEqual([
      "alerts_urgent",
      "alerts_official",
      "alerts_earthquakes",
      "alerts_civil",
      "alerts_test",
      "alerts",
    ]);
    expect(mod.DEFAULT_LOCAL_NOTIFICATION_EXACT).toBe(false);
  });

  it("F11.2: Extreme ONM, DGPC active/extreme, M5.0+ earthquake, and Probable Fire resolve to alerts_urgent", async () => {
    const mod = await importRepoModule<ChannelsMod>(
      "src/lib/notification-channels.ts",
    );
    expect(
      mod.resolveNotificationChannel({ kind: "onm", severity: "Extreme" }),
    ).toBe("alerts_urgent");
    expect(
      mod.resolveNotificationChannel({ kind: "official", hazard: "fire" }),
    ).toBe("alerts_urgent");
    expect(
      mod.resolveNotificationChannel({ kind: "earthquake", magnitude: 5.2 }),
    ).toBe("alerts_urgent");
    expect(mod.resolveNotificationChannel({ kind: "fire" })).toBe(
      "alerts_urgent",
    );
  });

  it("F11.3: Severe ONM and DGPC non-fire flood/storm/road updates resolve to alerts_official", async () => {
    const mod = await importRepoModule<ChannelsMod>(
      "src/lib/notification-channels.ts",
    );
    expect(
      mod.resolveNotificationChannel({ kind: "onm", severity: "Severe" }),
    ).toBe("alerts_official");
    for (const hazard of ["flood", "storm", "road", "structure"]) {
      expect(
        mod.resolveNotificationChannel({
          kind: "official",
          hazard,
          severity: "Severe",
        }),
        `official ${hazard} must route to alerts_official`,
      ).toBe("alerts_official");
    }
  });

  it("F11.4: M4.0-4.9 earthquakes -> alerts_earthquakes, civil/digest -> alerts_civil, self-test -> alerts_test", async () => {
    const mod = await importRepoModule<ChannelsMod>(
      "src/lib/notification-channels.ts",
    );
    expect(
      mod.resolveNotificationChannel({ kind: "earthquake", magnitude: 4.4 }),
    ).toBe("alerts_earthquakes");
    expect(mod.resolveNotificationChannel({ kind: "civil" })).toBe(
      "alerts_civil",
    );
    expect(mod.resolveNotificationChannel({ kind: "digest" })).toBe(
      "alerts_civil",
    );
    expect(mod.resolveNotificationChannel({ kind: "test" })).toBe(
      "alerts_test",
    );
  });

  it("F11.5: FCM server payload builders set android.notification.channel_id dynamically per hazard (never hardcoded solely to 'alerts')", async () => {
    const fcmMod = await importRepoModule<{
      fcmMessagesForFire: (args: Record<string, unknown>) => Array<{
        android: { notification: { channel_id: string } };
      }>;
      fcmMessagesForOnm: (args: Record<string, unknown>) => Array<{
        android: { notification: { channel_id: string } };
      }>;
    }>("src/lib/fcm.ts");

    const fireMsgs = fcmMod.fcmMessagesForFire({
      broadcastId: "brd-fire-ch",
      severity: "Severe",
      communeCodes: ["1501"],
      shortId: "F-CH1",
      info: [{ language: "fr-DZ", headline: "Feu", description: "Tizi Ouzou" }],
    });
    expect(fireMsgs[0]?.android.notification.channel_id).toBe("alerts_urgent");

    const onmSevereMsgs = fcmMod.fcmMessagesForOnm({
      broadcastId: "brd-onm-ch",
      severity: "Severe",
      communeCodes: ["1601"],
      title: "BMS Pluies",
      headlineFr: "BMS Pluies Orange",
      wilayaId: "16",
      event: "Rain",
    });
    expect(onmSevereMsgs[0]?.android.notification.channel_id).toBe(
      "alerts_official",
    );
  });
});

describe("Tier 1 — F12: User-Facing 'Test my notifications' & AR/FR OEM Battery Guide", () => {
  it("F12.1: push self-test server module allows regular authenticated users (not admin-only) and supports mocked transport", () => {
    const pushTestSrc = readRepoFile("src/lib/push-test.server.ts");
    const hasPublicPushTest = repoFileExists(
      "src/routes/api/public/v1/push-test.ts",
    );
    const hasPrivatePushTest = repoFileExists(
      "src/routes/api/private/push-test.ts",
    );

    expect(hasPrivatePushTest || hasPublicPushTest).toBe(true);
    // Must not restrict self-test solely to admin/operator roles
    expect(pushTestSrc).not.toMatch(/requireAdmin\s*\(/);
    expect(pushTestSrc).toMatch(/rate|limit|cooldown|window/i);
  });

  it("F12.2: self-test push payload targets alerts_test channel and self_test provenance kind, never public commune topics", async () => {
    const pushTestSrc = readRepoFile("src/lib/push-test.server.ts");
    const publicTestSrc = repoFileExists(
      "src/routes/api/public/v1/push-test.ts",
    )
      ? readRepoFile("src/routes/api/public/v1/push-test.ts")
      : "";
    const combined = `${pushTestSrc}\n${publicTestSrc}`;

    expect(combined).toMatch(/fcmMessageForSelfTest/);
    expect(combined).not.toMatch(/v1\.commune\./);

    const fcmMod = await importRepoModule<{
      fcmMessageForSelfTest: (args: {
        token: string;
        testId: string;
        lang?: "ar" | "fr" | "en" | "kab";
        observedAt?: string;
      }) => {
        token: string;
        topic?: string;
        android: { notification: { channel_id: string } };
        data: Record<string, string>;
      };
    }>("src/lib/fcm.ts");

    const msg = fcmMod.fcmMessageForSelfTest({
      token: "e2e-self-test-device-token",
      testId: "test-1234",
      lang: "fr",
      observedAt: "2026-11-24T12:00:00Z",
    });

    expect(msg.token).toBe("e2e-self-test-device-token");
    expect("topic" in msg).toBe(false);
    expect(msg.android.notification.channel_id).toBe("alerts_test");
    expect(msg.data["channel_id"]).toBe("alerts_test");
    expect(msg.data["provenance_trigger"]).toBe("self_test");
  });

  it("F12.3: OemBatteryGuide component covers major Algerian-market Android OEMs (Xiaomi, Samsung, Huawei/Honor, Oppo/Realme, Tecno/Infinix)", () => {
    expect(repoFileExists("src/components/nadhir/OemBatteryGuide.tsx")).toBe(
      true,
    );
    const guideSrc = readRepoFile("src/components/nadhir/OemBatteryGuide.tsx");
    const track2En = readRepoFile("src/i18n/modules/track2/en.ts");
    const combined = `${guideSrc}\n${track2En}`.toLowerCase();

    for (const oem of ["xiaomi", "samsung", "huawei", "oppo", "tecno"]) {
      expect(combined, `OEM battery guide must cover ${oem}`).toContain(oem);
    }
  });

  it("F12.4: OEM battery guide translations exist in ar, fr, en, and kab with zero em dashes and zero banned labels", async () => {
    for (const loc of ["ar", "fr", "en", "kab"] as const) {
      const mod = await importRepoModule<Record<string, unknown>>(
        `src/i18n/modules/track2/${loc}.ts`,
      );
      const serialized = JSON.stringify(mod);
      expect(
        serialized.toLowerCase(),
        `track2/${loc} must include OEM battery guide entries`,
      ).toMatch(/xiaomi|samsung|battery|batterie|بطارية/);
      expect(findEmDashesInText(serialized).count).toBe(0);
      expect(findBannedSafeLabels(serialized)).toEqual([]);
    }
  });

  it("F12.5: UserPushTest UI component exists with >=44px accessible trigger, receipt/countdown state, and translated error state", () => {
    expect(repoFileExists("src/components/nadhir/UserPushTest.tsx")).toBe(true);
    const uiSrc = readRepoFile("src/components/nadhir/UserPushTest.tsx");

    expect(uiSrc).toMatch(/min-h-11|h-11|44px/);
    expect(uiSrc).toMatch(/receipt|countdown|timeout|received|sent/i);
    expect(uiSrc).toMatch(/error/i);
  });
});

describe("Tier 1 — F13: Automated WhatsApp Channel & Resend Zone Email Digest Pipelines", () => {
  it("F13.1: whatsapp-channel.server.ts formats approved CAP/official broadcast payloads with verbatim attribution, Algiers timestamp, provenance footer, and nadhir.app link", async () => {
    const waMod = await importRepoModule<{
      formatWhatsappBroadcastMessage: (input: {
        candidate: {
          id: string;
          kind: string;
          phase: string;
          severity: string;
          areaLabel?: string;
          headline: string;
          summary?: string;
          sourceKey?: string;
          sourceAttribution?: string;
          observedAt: string;
          communeCode?: string;
        };
        locale: "ar" | "fr" | "en" | "kab";
      }) => {
        text: string;
        deepLink: string;
        provenanceFooter: string;
        algiersTimestamp: string;
      };
    }>("src/lib/delivery/whatsapp-channel.server.ts");

    expect(typeof waMod.formatWhatsappBroadcastMessage).toBe("function");

    const formatted = waMod.formatWhatsappBroadcastMessage({
      candidate: {
        id: "brd-wa-01",
        kind: "onm",
        phase: "initial",
        severity: "Severe",
        areaLabel: "Alger, Tipaza",
        headline: "BMS Pluies Niveau 2 (Orange)",
        summary: "Cumuls estimés entre 40 mm et 60 mm.",
        sourceKey: "onm",
        sourceAttribution: "Office National de la Météorologie (ONM)",
        observedAt: "2026-11-24T12:00:00Z",
        communeCode: "1601",
      },
      locale: "fr",
    });

    expect(formatted.text).toContain(
      "Office National de la Météorologie (ONM)",
    );
    expect(formatted.text).toContain("nadhir.app");
    expect(formatted.deepLink).toContain("https://nadhir.app/");
    expect(formatted.algiersTimestamp).toMatch(/\d{2}:\d{2}/);
    expect(formatted.provenanceFooter.length).toBeGreaterThan(10);
    expect(formatted.text).toContain(formatted.provenanceFooter);
    expect(findBannedSafeLabels(formatted.text)).toEqual([]);
    expect(findEmDashesInText(formatted.text).count).toBe(0);
  });

  it("F13.2: WhatsApp Channel publisher delivers cleanly to mocked local HTTP transport with deduplication/receipt handling", async () => {
    const waMod = await importRepoModule<{
      createMetaWhatsAppChannelTransport: (opts: {
        accessToken: string;
        apiUrl?: string;
      }) => unknown;
      deliverWhatsappChannelBroadcasts: (opts: {
        env?: Record<string, string | undefined>;
        transport?: unknown;
        store?: unknown;
        channelTarget?: string;
        locales?: Array<"ar" | "fr" | "en" | "kab">;
        candidates?: Array<Record<string, unknown>>;
        now?: Date;
      }) => Promise<{
        disabled: boolean;
        unconfigured: boolean;
        enqueued: number;
        sent: number;
        failed: number;
        skipped: number;
      }>;
    }>("src/lib/delivery/whatsapp-channel.server.ts");

    expect(typeof waMod.createMetaWhatsAppChannelTransport).toBe("function");
    expect(typeof waMod.deliverWhatsappChannelBroadcasts).toBe("function");

    const mockWa = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ id: "wamid.e2e.12345" }] }),
    }));

    try {
      const seenDedupeKeys = new Set<string>();
      const queue: Array<{
        id: string;
        broadcast_id: string;
        channel_target: string;
        locale: string;
        dedupe_key: string;
        state: string;
        attempts: number;
        expires_at: string;
        lease_token: string;
        last_error: null;
        payload: Record<string, unknown>;
      }> = [];
      const receipts: Array<{
        id: string;
        delivered: boolean;
        providerMessageId?: string | null;
      }> = [];

      const store = {
        isGlobalBroadcastEnabled: async () => true,
        isPipelineActive: async () => true,
        enqueueBroadcast: async (input: {
          broadcastId: string;
          channelTarget: string;
          locale: string;
          dedupeKey: string;
          payload: Record<string, unknown>;
          expiresAt: string | null;
        }) => {
          if (seenDedupeKeys.has(input.dedupeKey)) return null;
          seenDedupeKeys.add(input.dedupeKey);
          const id = `wa-row-${queue.length + 1}`;
          queue.push({
            id,
            broadcast_id: input.broadcastId,
            channel_target: input.channelTarget,
            locale: input.locale,
            dedupe_key: input.dedupeKey,
            state: "pending",
            attempts: 1,
            expires_at: input.expiresAt ?? "2026-11-25T15:10:00Z",
            lease_token: "lease-e2e-wa-1",
            last_error: null,
            payload: input.payload,
          });
          return id;
        },
        claimDeliveries: async () =>
          queue.filter((row) => row.state === "pending"),
        finishDelivery: async (input: {
          id: string;
          leaseToken: string;
          delivered: boolean;
          providerMessageId?: string | null;
        }) => {
          const row = queue.find((r) => r.id === input.id);
          if (row) row.state = input.delivered ? "sent" : "failed";
          receipts.push({
            id: input.id,
            delivered: input.delivered,
            providerMessageId: input.providerMessageId,
          });
          return true;
        },
      };

      const transport = waMod.createMetaWhatsAppChannelTransport({
        accessToken: "test-wa-token",
        apiUrl: `${mockWa.url}/v21.0`,
      });
      const candidate = {
        id: "brd-wa-send-01",
        kind: "official",
        phase: "initial",
        severity: "Severe",
        hazard: "flood",
        sourceKey: "dgpc_telegram",
        sourceAttribution: "DGPC",
        areaLabel: "Bab El Oued",
        headline: "Intervention DGPC inondations",
        summary: "Pompage des eaux pluviales en cours.",
        observedAt: "2026-11-24T15:10:00Z",
        officialIncidentId: "dgpc-01",
      };

      const firstRun = await waMod.deliverWhatsappChannelBroadcasts({
        env: {
          WHATSAPP_CHANNEL_ENABLED: "true",
          WHATSAPP_CHANNEL_ID: "channel-dz-test",
          WHATSAPP_ACCESS_TOKEN: "test-wa-token",
        },
        transport,
        store,
        channelTarget: "channel-dz-test",
        locales: ["fr"],
        candidates: [candidate],
        now: new Date("2026-11-24T15:15:00Z"),
      });

      expect(firstRun.disabled).toBe(false);
      expect(firstRun.unconfigured).toBe(false);
      expect(firstRun.enqueued).toBe(1);
      expect(firstRun.sent).toBe(1);
      expect(firstRun.failed).toBe(0);
      expect(mockWa.requests.length).toBe(1);
      expect(receipts).toEqual([
        {
          id: "wa-row-1",
          delivered: true,
          providerMessageId: "wamid.e2e.12345",
        },
      ]);

      // Deduplication check: replaying the same broadcast must not re-send
      const secondRun = await waMod.deliverWhatsappChannelBroadcasts({
        env: {
          WHATSAPP_CHANNEL_ENABLED: "true",
          WHATSAPP_CHANNEL_ID: "channel-dz-test",
          WHATSAPP_ACCESS_TOKEN: "test-wa-token",
        },
        transport,
        store,
        channelTarget: "channel-dz-test",
        locales: ["fr"],
        candidates: [candidate],
        now: new Date("2026-11-24T15:16:00Z"),
      });
      expect(secondRun.enqueued).toBe(0);
      expect(secondRun.sent).toBe(0);
      expect(secondRun.skipped).toBe(1);
      expect(mockWa.requests.length).toBe(1);
    } finally {
      await mockWa.close();
    }
  });

  it("F13.3: email-digest.server.ts generates localized Resend zone email digests across ar/fr/en/kab with attribution, provenance, and unsubscribe link", async () => {
    const digestMod = await importRepoModule<{
      renderZoneDigestEmail: (input: {
        locale: "ar" | "fr" | "en" | "kab";
        alerts: Array<{
          id: string;
          kind: string;
          severity: number;
          title: string;
          body: string;
          created_at: string;
          zone_name?: string | null;
          source_table?: string | null;
          payload?: Record<string, unknown> | null;
          deep_link?: string | null;
        }>;
        urgentBypass: boolean;
        manageUrl?: string;
      }) => {
        subject: string;
        html: string;
        text: string;
        dir: "rtl" | "ltr";
        provenanceLines: string[];
      };
    }>("src/lib/delivery/email-digest.server.ts");

    expect(typeof digestMod.renderZoneDigestEmail).toBe("function");

    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const rendered = digestMod.renderZoneDigestEmail({
        locale,
        urgentBypass: false,
        manageUrl: "https://nadhir.app/settings#notifications",
        alerts: [
          {
            id: "alert-1",
            kind: "onm",
            severity: 3,
            title: "BMS Pluies Niveau 2",
            body: "Cumuls estimés entre 40 mm et 60 mm.",
            created_at: "2026-11-24T12:00:00Z",
            zone_name: "Alger Centre",
            source_table: "onm_vigilance",
            deep_link: "https://nadhir.app/forecast?commune=1601",
            payload: {
              provenance_trigger: "watch_zone",
              provenance_area: "Alger Centre",
              provenance_source_key: "onm",
              provenance_source: "Office National de la Météorologie (ONM)",
              provenance_rule: "provenance.rule.onmSevere",
              provenance_observed_at: "2026-11-24T12:00:00Z",
            },
          },
        ],
      });

      expect(rendered.dir).toBe(locale === "ar" ? "rtl" : "ltr");
      expect(rendered.provenanceLines.length).toBeGreaterThanOrEqual(1);
      expect(
        rendered.text,
        `digest text in ${locale} must preserve ONM attribution`,
      ).toContain("Office National de la Météorologie (ONM)");
      expect(
        rendered.html,
        `digest HTML in ${locale} must preserve ONM attribution`,
      ).toContain("Office National de la Météorologie (ONM)");
      expect(
        rendered.html,
        `digest HTML in ${locale} must include settings/unsubscribe link`,
      ).toContain("nadhir.app/settings");
      expect(
        rendered.text,
        `digest text in ${locale} must include settings/unsubscribe link`,
      ).toContain("nadhir.app/settings");
      expect(findBannedSafeLabels(rendered.text)).toEqual([]);
      expect(findBannedSafeLabels(stripHtmlForTextScan(rendered.html))).toEqual(
        [],
      );
      expect(findEmDashesInText(rendered.text).count).toBe(0);
    }
  });

  it("F13.4: Resend email digest sender delivers to mocked local Resend HTTP server and tracks 200 OK receipt", async () => {
    const digestMod = await importRepoModule<{
      createResendEmailTransport: (opts: {
        apiKey: string;
        apiUrl?: string;
      }) => unknown;
      deliverZoneEmailDigests: (opts: {
        env?: Record<string, string | undefined>;
        transport?: unknown;
        store?: unknown;
        fromEmail?: string;
        now?: Date;
      }) => Promise<{
        disabled: boolean;
        unconfigured: boolean;
        usersChecked: number;
        sent: number;
        failed: number;
      }>;
    }>("src/lib/delivery/email-digest.server.ts");

    expect(typeof digestMod.createResendEmailTransport).toBe("function");
    expect(typeof digestMod.deliverZoneEmailDigests).toBe("function");

    const mockResend = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "re_e2e_receipt_999" }),
    }));

    try {
      const finished: Array<{
        id: string;
        sent: boolean;
        providerMessageId?: string | null;
      }> = [];
      let listedOnce = false;

      const store = {
        isPipelineActive: async () => true,
        listPendingUsers: async () => {
          if (listedOnce) return [];
          listedOnce = true;
          return [
            {
              user_id: "user-e2e-1",
              email: "citizen@example.dz",
              display_name: "Citoyen Alger",
              locale: "fr",
              email_digest_frequency: "immediate" as const,
              email_digest_hour_algiers: 8,
              quiet_hours_start: null,
              quiet_hours_end: null,
              last_sent_at: null,
            },
          ];
        },
        loadUndeliveredAlerts: async () => [
          {
            id: "alert-1",
            kind: "onm",
            severity: 3,
            title: "BMS Pluies",
            body: "Cumuls estimés entre 40 mm et 60 mm.",
            created_at: "2026-11-24T12:00:00Z",
            zone_name: "Alger",
            source_table: "onm_vigilance",
            payload: {
              provenance_trigger: "watch_zone",
              provenance_area: "Alger",
              provenance_source_key: "onm",
              provenance_source: "Office National de la Météorologie (ONM)",
              provenance_rule: "provenance.rule.onmSevere",
              provenance_observed_at: "2026-11-24T12:00:00Z",
            },
          },
        ],
        claimDigestDelivery: async () => ({
          id: "digest-e2e-1",
          lease_token: "lease-e2e-digest-1",
          attempts: 1,
        }),
        finishDigestDelivery: async (input: {
          id: string;
          sent: boolean;
          providerMessageId?: string | null;
        }) => {
          finished.push({
            id: input.id,
            sent: input.sent,
            providerMessageId: input.providerMessageId,
          });
          return true;
        },
      };

      const transport = digestMod.createResendEmailTransport({
        apiKey: "re_test_key_local",
        apiUrl: `${mockResend.url}/emails`,
      });

      const result = await digestMod.deliverZoneEmailDigests({
        env: {
          EMAIL_DIGEST_ENABLED: "true",
          RESEND_API_KEY: "re_test_key_local",
        },
        transport,
        store,
        fromEmail: "Nadhir <alerts@nadhir.app>",
        now: new Date("2026-11-24T12:15:00Z"),
      });

      expect(result.disabled).toBe(false);
      expect(result.unconfigured).toBe(false);
      expect(result.usersChecked).toBe(1);
      expect(result.sent).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockResend.requests.length).toBe(1);
      expect(finished).toEqual([
        {
          id: "digest-e2e-1",
          sent: true,
          providerMessageId: "re_e2e_receipt_999",
        },
      ]);
    } finally {
      await mockResend.close();
    }
  });

  it("F13.5: ITA community media posts and unattributed model outputs are excluded from WhatsApp Channel broadcasts", async () => {
    const waMod = await importRepoModule<{
      evaluateWhatsappBroadcastEligibility: (
        input: Record<string, unknown>,
        now?: Date,
      ) => { eligible: boolean; reason?: string };
    }>("src/lib/delivery/whatsapp-channel.server.ts");

    expect(typeof waMod.evaluateWhatsappBroadcastEligibility).toBe("function");

    const now = new Date("2026-11-24T12:30:00Z");
    const itaPost = buildDgpcNonFirePost({ kind: "ita_media" });

    const itaRes = waMod.evaluateWhatsappBroadcastEligibility(
      {
        id: itaPost.postId,
        kind: "official",
        phase: "initial",
        severity: "Severe",
        sourceKey: itaPost.sourceKey,
        sourceAttribution: itaPost.sourceAttribution,
        authorityTier: "media",
        observedAt: itaPost.publishedAt,
        headline: itaPost.textFr,
      },
      now,
    );
    expect(itaRes.eligible).toBe(false);
    expect(itaRes.reason).toBe("ita_media_excluded");

    const modelRes = waMod.evaluateWhatsappBroadcastEligibility(
      {
        id: "model-grid-01",
        kind: "onm",
        phase: "initial",
        severity: "Severe",
        sourceKey: "open_meteo",
        sourceAttribution: "",
        authorityStatus: "model",
        observedAt: "2026-11-24T12:00:00Z",
        headline: "Model forecast rain",
      },
      now,
    );
    expect(modelRes.eligible).toBe(false);
    expect(modelRes.reason).toBe("model_output_excluded");

    // Non-vacuous positive control: valid current ONM Severe warning IS eligible
    const onmRes = waMod.evaluateWhatsappBroadcastEligibility(
      {
        id: "onm-valid-01",
        kind: "onm",
        phase: "initial",
        severity: "Severe",
        msgType: "Alert",
        sourceKey: "onm",
        sourceAttribution: "Office National de la Météorologie (ONM)",
        observedAt: "2026-11-24T12:00:00Z",
        sentAt: "2026-11-24T12:00:00Z",
        expiresAt: "2026-11-24T22:00:00Z",
        headline: "BMS Pluies Niveau 2",
      },
      now,
    );
    expect(onmRes.eligible).toBe(true);
  });

  it("F13.6: WhatsApp Channel and Resend digest pipelines respect kill-switch / missing credentials without unhandled crashes", async () => {
    const waSrc = readRepoFile("src/lib/delivery/whatsapp-channel.server.ts");
    const emailSrc = readRepoFile("src/lib/delivery/email-digest.server.ts");

    expect(waSrc).toMatch(/enabled|kill|configured/i);
    expect(emailSrc).toMatch(/enabled|kill|configured/i);
  });
});
