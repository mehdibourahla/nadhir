import { describe, expect, it, vi } from "vitest";

import type { AnyLocale } from "@/i18n";
import {
  buildCanonicalBroadcastLink,
  buildWhatsappDedupeKey,
  classifyDeliveryError,
  computeBackoffSeconds,
  createMetaWhatsAppChannelTransport,
  createSupabaseWhatsAppDeliveryStore,
  deliverWhatsappChannelBroadcasts,
  evaluateWhatsappBroadcastEligibility,
  formatAlgiersTimestamp,
  formatWhatsappBroadcastMessage,
  mapPendingBroadcastRowToCandidate,
  sanitizeCopyText,
  WhatsAppHttpError,
  type PendingWhatsAppBroadcastRow,
  type QueuedWhatsAppDelivery,
  type WhatsAppBroadcastCandidate,
  type WhatsAppChannelTransport,
  type WhatsAppDeliveryStore,
} from "@/lib/delivery/whatsapp-channel.server";

const NOW = new Date("2026-11-25T10:00:00Z");

function makeOnmCandidate(
  overrides: Partial<WhatsAppBroadcastCandidate> = {},
): WhatsAppBroadcastCandidate {
  return {
    id: "b-onm-1",
    kind: "onm",
    phase: "initial",
    severity: "Extreme",
    hazard: "rain",
    sourceKey: "onm",
    sourceAttribution: "ONM · Météo Algérie",
    authorityStatus: "official",
    msgType: "Alert",
    sentAt: "2026-11-25T09:00:00Z",
    onsetAt: "2026-11-25T09:30:00Z",
    expiresAt: "2026-11-25T20:00:00Z",
    observedAt: "2026-11-25T09:00:00Z",
    headline: "Pluies torrentielles sur la wilaya d'Alger",
    summary: "Cumuls importants prévus sur le littoral.",
    areaLabel: "Wilaya d'Alger",
    communeCode: "1601",
    ...overrides,
  };
}

function makeInMemoryStore(options?: {
  globalEnabled?: boolean;
  pipelineActive?: boolean;
  invalidatedIds?: Set<string>;
}) {
  const rows = new Map<string, QueuedWhatsAppDelivery>();
  const byDedupe = new Map<string, string>();
  const byTriple = new Map<string, string>();
  const finishedCalls: Array<
    Parameters<WhatsAppDeliveryStore["finishDelivery"]>[0]
  > = [];
  let seq = 0;

  const store: WhatsAppDeliveryStore = {
    async isGlobalBroadcastEnabled() {
      return options?.globalEnabled ?? true;
    },
    async isPipelineActive() {
      return options?.pipelineActive ?? true;
    },
    async enqueueBroadcast(input) {
      const triple = `${input.broadcastId}|${input.channelTarget}|${input.locale}`;
      if (byDedupe.has(input.dedupeKey)) return null;
      if (byTriple.has(triple)) return null;
      seq += 1;
      const id = `wa-row-${seq}`;
      const row: QueuedWhatsAppDelivery = {
        id,
        broadcast_id: input.broadcastId,
        channel_target: input.channelTarget,
        locale: input.locale,
        dedupe_key: input.dedupeKey,
        state: "pending",
        attempts: 0,
        expires_at: input.expiresAt ?? "2026-11-26T10:00:00Z",
        lease_token: null,
        last_error: null,
        payload: input.payload,
      };
      rows.set(id, row);
      byDedupe.set(input.dedupeKey, id);
      byTriple.set(triple, id);
      return id;
    },
    async claimDeliveries(limit) {
      const claimed: QueuedWhatsAppDelivery[] = [];
      for (const row of rows.values()) {
        if (claimed.length >= limit) break;
        if (row.state !== "pending") continue;
        row.state = "leased";
        row.attempts += 1;
        row.lease_token = `lease-${row.id}-${row.attempts}`;
        claimed.push({ ...row });
      }
      return claimed;
    },
    async isDeliveryInvalidated(deliveryId) {
      return options?.invalidatedIds?.has(deliveryId) ? "cap_cancelled" : null;
    },
    async finishDelivery(input) {
      finishedCalls.push(input);
      const row = rows.get(input.id);
      if (!row || row.lease_token !== input.leaseToken) return false;
      row.lease_token = null;
      if (
        !input.delivered &&
        (input.error === "cap_cancelled" || input.error === "official_cleared")
      ) {
        row.state = "cancelled";
        row.last_error = input.error;
        return true;
      }
      if (input.delivered) {
        row.state = "delivered";
        row.last_error = null;
        return true;
      }
      if (input.permanent || row.attempts >= 8) {
        row.state = "failed";
        row.last_error = input.error ?? "permanent_failure";
        return true;
      }
      row.state = "pending";
      row.last_error = input.error ?? "transient_failure";
      return true;
    },
  };

  return { store, rows, finishedCalls };
}

describe("evaluateWhatsappBroadcastEligibility", () => {
  it("accepts approved ONM Severe/Extreme, DGPC fire & non-fire, M4+ quakes, and corroborated fires", () => {
    expect(
      evaluateWhatsappBroadcastEligibility(makeOnmCandidate(), NOW),
    ).toEqual({ eligible: true });

    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-dgpc-flood",
          kind: "official",
          phase: "initial",
          severity: "Severe",
          hazard: "flood",
          sourceKey: "dgpc_telegram",
          sourceAttribution: "DGPC",
          authorityTier: "national",
          incidentStatus: "ongoing",
          observedAt: "2026-11-25T09:30:00Z",
          headline: "Intervention DGPC inondation",
        },
        NOW,
      ),
    ).toEqual({ eligible: true });

    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-quake-45",
          kind: "earthquake",
          phase: "initial",
          severity: "Severe",
          sourceKey: "emsc",
          sourceAttribution: "EMSC",
          magnitude: 4.5,
          observedAt: "2026-11-25T09:40:00Z",
          headline: "M4.5 Béjaïa",
        },
        NOW,
      ),
    ).toEqual({ eligible: true });

    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-fire-prob",
          kind: "fire",
          phase: "initial",
          severity: "Extreme",
          sourceKey: "firms",
          corroborated: true,
          isHeatSignal: false,
          authorityStatus: "probable",
          observedAt: "2026-11-25T09:45:00Z",
          headline: "Probable fire near Tizi Ouzou",
        },
        NOW,
      ),
    ).toEqual({ eligible: true });
  });

  it("hard-rejects ITA media, raw satellite Heat Signals, and Open-Meteo model outputs", () => {
    expect(
      evaluateWhatsappBroadcastEligibility(
        makeOnmCandidate({ sourceKey: "ita_facebook" }),
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "ita_media_excluded" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-media",
          kind: "official",
          phase: "initial",
          severity: "Severe",
          sourceKey: "dgpc_telegram",
          authorityTier: "media",
          observedAt: "2026-11-25T09:30:00Z",
          headline: "Quoted press post",
        },
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "ita_media_excluded" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        makeOnmCandidate({ sourceAttribution: "Info Trafic Algérie" }),
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "ita_media_excluded" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-heat-1",
          kind: "fire",
          phase: "initial",
          severity: "Severe",
          sourceKey: "firms",
          isHeatSignal: true,
          observedAt: "2026-11-25T09:30:00Z",
          headline: "Thermal anomaly",
        },
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "raw_heat_signal_excluded" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-heat-2",
          kind: "fire",
          phase: "initial",
          severity: "Severe",
          sourceKey: "firms",
          corroborated: false,
          observedAt: "2026-11-25T09:30:00Z",
          headline: "Single hotspot",
        },
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "raw_heat_signal_excluded" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-model",
          kind: "onm",
          phase: "initial",
          severity: "Extreme",
          sourceKey: "open_meteo",
          authorityStatus: "model",
          observedAt: "2026-11-25T09:30:00Z",
          headline: "Model rain estimate",
        },
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "model_output_excluded" });
  });

  it("rejects cancelled/superseded/expired ONM, Moderate ONM, non-DGPC official, cleared initial official, and < M4.0 quakes", () => {
    expect(
      evaluateWhatsappBroadcastEligibility(
        makeOnmCandidate({ msgType: "Cancel" }),
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "onm_cancelled_or_superseded" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        makeOnmCandidate({ cancelledAt: "2026-11-25T09:50:00Z" }),
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "onm_cancelled_or_superseded" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        makeOnmCandidate({ supersededBy: "onm-newer" }),
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "onm_cancelled_or_superseded" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        makeOnmCandidate({ expiresAt: "2026-11-25T09:59:00Z" }),
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "onm_expired_or_invalid_window" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        makeOnmCandidate({ severity: "Moderate" }),
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "below_severity_threshold" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-off-other",
          kind: "official",
          phase: "initial",
          severity: "Severe",
          hazard: "flood",
          sourceKey: "facebook_page",
          observedAt: "2026-11-25T09:30:00Z",
          headline: "Non-DGPC source",
        },
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "unapproved_official_source" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-off-cleared",
          kind: "official",
          phase: "initial",
          severity: "Severe",
          hazard: "road",
          sourceKey: "dgpc_telegram",
          incidentStatus: "cleared",
          observedAt: "2026-11-25T09:30:00Z",
          headline: "Cleared road",
        },
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "official_incident_cleared" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-quake-39",
          kind: "earthquake",
          phase: "initial",
          severity: "Severe",
          sourceKey: "emsc",
          magnitude: 3.9,
          observedAt: "2026-11-25T09:30:00Z",
          headline: "M3.9 tremor",
        },
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "earthquake_below_m4" });
  });

  it("fails closed on omitted/null fire corroboration flags, Arabic/variant ITA, open-meteo, lowercase ONM cancel, and unlisted/cleared official updates", () => {
    // Bare/minimal kind="fire" with omitted or null flags must fail closed
    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-fire-omitted",
          kind: "fire",
          phase: "initial",
          severity: "Severe",
          sourceKey: "firms",
          sourceAttribution: "NASA FIRMS",
          observedAt: "2026-11-25T09:30:00Z",
          headline: "Raw thermal hotspot",
        },
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "raw_heat_signal_excluded" });

    expect(
      evaluateWhatsappBroadcastEligibility(
        {
          id: "b-fire-null",
          kind: "fire",
          phase: "initial",
          severity: "Extreme",
          sourceKey: "firms",
          corroborated: null,
          isHeatSignal: null,
          confirmed: null,
          authorityStatus: null,
          observedAt: "2026-11-25T09:30:00Z",
          headline: "Null flags hotspot",
        },
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "raw_heat_signal_excluded" });

    // Arabic & variant ITA attributions + infix/suffix ITA sourceKey
    for (const attr of [
      "إعلام المرور",
      "إنفو ترافيك الجزائر",
      "انفو ترافيك",
      "InfoTrafic Algérie",
    ]) {
      expect(
        evaluateWhatsappBroadcastEligibility(
          {
            id: `b-ita-${attr}`,
            kind: "fire",
            phase: "initial",
            severity: "Severe",
            sourceKey: "other",
            sourceAttribution: attr,
            corroborated: true,
            observedAt: "2026-11-25T09:30:00Z",
            headline: "Road post",
          },
          NOW,
        ),
      ).toEqual({ eligible: false, reason: "ita_media_excluded" });
    }

    for (const key of ["dz_ita_feed", "ITA_CUSTOM", "feed.ita"]) {
      expect(
        evaluateWhatsappBroadcastEligibility(
          makeOnmCandidate({ sourceKey: key }),
          NOW,
        ),
      ).toEqual({ eligible: false, reason: "ita_media_excluded" });
    }

    // Hyphenated model sourceKey
    expect(
      evaluateWhatsappBroadcastEligibility(
        makeOnmCandidate({ sourceKey: "open-meteo" }),
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "model_output_excluded" });

    // Lowercase ONM msgType "cancel"
    expect(
      evaluateWhatsappBroadcastEligibility(
        makeOnmCandidate({ msgType: "cancel" }),
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "onm_cancelled_or_superseded" });

    // Unlisted official incident rejected across ALL phases (initial, update, end)
    for (const phase of ["initial", "update", "end"] as const) {
      expect(
        evaluateWhatsappBroadcastEligibility(
          {
            id: `b-off-unlisted-${phase}`,
            kind: "official",
            phase,
            severity: "Severe",
            hazard: "flood",
            sourceKey: "dgpc_telegram",
            incidentStatus: "ongoing",
            unlistedAt: "2026-11-25T09:45:00Z",
            observedAt: "2026-11-25T09:30:00Z",
            headline: "Unlisted official incident",
          },
          NOW,
        ),
      ).toEqual({ eligible: false, reason: "official_incident_cleared" });
    }

    // Cleared/extinguished official incident rejected on update phase (allowed only on end phase)
    for (const status of ["cleared", "extinguished"]) {
      expect(
        evaluateWhatsappBroadcastEligibility(
          {
            id: `b-off-update-${status}`,
            kind: "official",
            phase: "update",
            severity: "Severe",
            hazard: "flood",
            sourceKey: "dgpc_telegram",
            incidentStatus: status,
            observedAt: "2026-11-25T09:30:00Z",
            headline: "Cleared update",
          },
          NOW,
        ),
      ).toEqual({ eligible: false, reason: "official_incident_cleared" });
    }
  });
});

describe("formatWhatsappBroadcastMessage & invariants", () => {
  it("renders attribution-first, Algiers time, deep link, provenance footer across all 4 locales with zero em dashes, zero safe labels, and zero Nadhir instructions", () => {
    const locales: AnyLocale[] = ["ar", "fr", "en", "kab"];
    for (const locale of locales) {
      const formatted = formatWhatsappBroadcastMessage({
        candidate: makeOnmCandidate({
          headline: "Alerte pluie — secteur sûr et all-clear sur la wilaya",
          instruction: "Evacuate south on RN5 immediately!",
        }),
        locale,
      });

      // Attribution first
      expect(formatted.text.startsWith("ONM · Météo Algérie")).toBe(true);
      // Preserves French preposition "sur" while stripping banned "sûr" / "all-clear"
      expect(formatted.text).toContain("sur la wilaya");
      expect(formatted.text.toLowerCase()).not.toContain("all-clear");
      expect(formatted.text.toLowerCase()).not.toMatch(/\bsafe\b/);
      expect(formatted.text).not.toMatch(/\bsûre?\b/i);
      // Zero em dashes
      expect(formatted.text).not.toContain("\u2014");
      // Zero Nadhir-authored instructions leaked
      expect(formatted.text).not.toContain("Evacuate south on RN5");
      // Canonical deep link + Algiers time + provenance footer
      expect(formatted.deepLink).toBe(
        "https://nadhir.app/forecast?commune=1601",
      );
      expect(formatted.text).toContain(formatted.deepLink);
      expect(formatted.text).toContain("25/11/2026 10:00");
      expect(formatted.provenanceFooter).toContain("ONM · Météo Algérie");
      expect(formatted.text).toContain(formatted.provenanceFooter);
    }
  });

  it("preserves ONM attribution verbatim in both NFC and NFD forms", () => {
    const nfdAttr = "ONM · Me\u0301te\u0301o Alge\u0301rie";
    const arabicAttr = "الديوان الوطني للأرصاد الجوية";

    const nfdMsg = formatWhatsappBroadcastMessage({
      candidate: makeOnmCandidate({ sourceAttribution: nfdAttr }),
      locale: "fr",
    });
    expect(nfdMsg.text.startsWith(nfdAttr)).toBe(true);
    expect(nfdMsg.provenance.sourceAttribution).toBe(nfdAttr);

    const arMsg = formatWhatsappBroadcastMessage({
      candidate: makeOnmCandidate({ sourceAttribution: arabicAttr }),
      locale: "ar",
    });
    expect(arMsg.text.startsWith(arabicAttr)).toBe(true);
    expect(arMsg.provenance.sourceAttribution).toBe(arabicAttr);
  });

  it("formats Algiers midnight as 00:xx (never 24:xx) and builds URL-encoded canonical links", () => {
    // 23:30 UTC == 00:30 Africa/Algiers next day
    expect(formatAlgiersTimestamp("2026-11-25T23:30:00Z")).toBe(
      "26/11/2026 00:30",
    );
    expect(
      buildCanonicalBroadcastLink({
        ...makeOnmCandidate(),
        kind: "official",
        officialIncidentId: "inc 1/2",
      }),
    ).toBe("https://nadhir.app/?event=official%3Ainc%201%2F2");
    expect(
      buildCanonicalBroadcastLink({
        ...makeOnmCandidate(),
        kind: "earthquake",
        earthquakeId: "20261125_0001",
      }),
    ).toBe("https://nadhir.app/?event=quake%3A20261125_0001");
    expect(
      buildCanonicalBroadcastLink({
        ...makeOnmCandidate(),
        kind: "fire",
        clusterShortId: "abc-99",
      }),
    ).toBe("https://nadhir.app/fire/abc-99");
  });

  it("strips single LF/CR/NUL control chars and trims dangling middots in sanitizeCopyText and provenance footers across all 4 locales", () => {
    expect(sanitizeCopyText("Alert\nBcc: evil@attacker.com")).toBe(
      "Alert Bcc: evil@attacker.com",
    );
    expect(sanitizeCopyText("Alert\rSecond\u0000Line")).toBe(
      "Alert SecondLine",
    );
    expect(sanitizeCopyText("Safe Zone \u2014 Blida")).toBe("Blida");

    const locales: AnyLocale[] = ["ar", "fr", "en", "kab"];
    for (const locale of locales) {
      const onmMsg = formatWhatsappBroadcastMessage({
        candidate: makeOnmCandidate({
          areaLabel: "Safe Zone \u2014 Blida",
          sourceAttribution: "ONM · Me\u0301te\u0301o Alge\u0301rie",
        }),
        locale,
      });
      expect(onmMsg.text).toContain("ONM · Me\u0301te\u0301o Alge\u0301rie");
      expect(onmMsg.text).not.toContain("\u2014");
      expect(onmMsg.text.toLowerCase()).not.toMatch(/\bsafe\b/);
      expect(onmMsg.provenanceFooter.toLowerCase()).not.toMatch(/\bsafe\b/);
      expect(onmMsg.text).not.toContain(": · Blida");

      const dgpcMsg = formatWhatsappBroadcastMessage({
        candidate: {
          id: "b-dgpc-prov",
          kind: "official",
          phase: "initial",
          severity: "Severe",
          hazard: "flood",
          sourceKey: "dgpc_telegram",
          sourceAttribution: "DGPC \u2014 Algérie",
          areaLabel: "Safe Zone \u2014 Alger",
          observedAt: "2026-11-25T09:00:00Z",
          headline: "Flooding reported sur la route",
          provenance: {
            triggerKind: "commune_topic",
            areaLabel: "Safe Zone \u2014 Alger",
            sourceKey: "dgpc_telegram",
            sourceAttribution: "DGPC \u2014 Algérie",
            ruleLabelKey: "provenance.rule.dgpcNonFire",
            observedAt: "2026-11-25T09:00:00Z",
            authorityStatus: "official",
          },
        },
        locale,
      });
      expect(dgpcMsg.text).not.toContain("\u2014");
      expect(dgpcMsg.provenanceFooter).not.toContain("\u2014");
      expect(dgpcMsg.text.toLowerCase()).not.toMatch(/\bsafe\b/);
      expect(dgpcMsg.provenanceFooter.toLowerCase()).not.toMatch(/\bsafe\b/);
      expect(dgpcMsg.text).toContain("sur la route");
    }
  });
});

describe("error classification & backoff", () => {
  it("classifies 429 (honoring capped Retry-After), 5xx, timeout vs permanent 4xx", () => {
    const err429 = new WhatsAppHttpError(429, "rate limited", 180);
    expect(classifyDeliveryError(err429)).toMatchObject({
      transient: true,
      permanent: false,
      retryAfterSeconds: 180,
      code: "http_429",
    });
    expect(computeBackoffSeconds(1, 180)).toBe(180);
    expect(computeBackoffSeconds(1, 5000)).toBe(900);

    const err503 = new WhatsAppHttpError(503, "upstream down");
    expect(classifyDeliveryError(err503)).toMatchObject({
      transient: true,
      permanent: false,
      code: "http_503",
    });
    expect(computeBackoffSeconds(1)).toBe(30);
    expect(computeBackoffSeconds(2)).toBe(60);
    expect(computeBackoffSeconds(3)).toBe(120);

    for (const status of [400, 401, 403, 404, 422]) {
      expect(
        classifyDeliveryError(new WhatsAppHttpError(status, "client error")),
      ).toMatchObject({
        transient: false,
        permanent: true,
        code: `http_${status}`,
      });
    }
  });
});

describe("deliverWhatsappChannelBroadcasts pipeline", () => {
  it("returns unconfigured when credentials are missing and disabled on env/global/pipeline kill switches", async () => {
    const unconf = await deliverWhatsappChannelBroadcasts({ env: {} });
    expect(unconf).toMatchObject({
      unconfigured: true,
      disabled: false,
      sent: 0,
    });

    const envDisabled = await deliverWhatsappChannelBroadcasts({
      env: { WHATSAPP_CHANNEL_ENABLED: "false" },
    });
    expect(envDisabled).toMatchObject({ disabled: true, sent: 0 });

    const transport: WhatsAppChannelTransport = {
      sendChannelMessage: vi.fn(),
    };
    const { store: globalOffStore } = makeInMemoryStore({
      globalEnabled: false,
    });
    const globalOff = await deliverWhatsappChannelBroadcasts({
      env: {},
      transport,
      store: globalOffStore,
      channelTarget: "ch-1",
      candidates: [makeOnmCandidate()],
      now: NOW,
    });
    expect(globalOff).toMatchObject({ disabled: true, sent: 0 });
    expect(transport.sendChannelMessage).not.toHaveBeenCalled();

    const { store: pausedStore } = makeInMemoryStore({ pipelineActive: false });
    const paused = await deliverWhatsappChannelBroadcasts({
      env: {},
      transport,
      store: pausedStore,
      channelTarget: "ch-1",
      candidates: [makeOnmCandidate()],
      now: NOW,
    });
    expect(paused).toMatchObject({ disabled: true, sent: 0 });
    expect(transport.sendChannelMessage).not.toHaveBeenCalled();
  });

  it("enqueues eligible broadcasts once (deduped), skips ineligible/ITA/heat-signals, and delivers cleanly", async () => {
    const { store, rows } = makeInMemoryStore();
    const sentMessages: string[] = [];
    const transport: WhatsAppChannelTransport = {
      sendChannelMessage: vi.fn(async (input) => {
        sentMessages.push(input.text);
        return { providerMessageId: `wamid.${sentMessages.length}` };
      }),
    };

    const candidates = [
      makeOnmCandidate(),
      makeOnmCandidate({ id: "b-ita", sourceKey: "ita_facebook" }),
      makeOnmCandidate({
        id: "b-heat",
        kind: "fire",
        isHeatSignal: true,
        sourceKey: "firms",
      }),
    ];

    const first = await deliverWhatsappChannelBroadcasts({
      env: {},
      transport,
      store,
      channelTarget: "channel-dz",
      locales: ["ar", "fr"],
      candidates,
      now: NOW,
    });
    expect(first).toMatchObject({
      disabled: false,
      unconfigured: false,
      enqueued: 2,
      sent: 2,
      skipped: 2,
      failed: 0,
      retried: 0,
    });
    expect(transport.sendChannelMessage).toHaveBeenCalledTimes(2);
    expect(buildWhatsappDedupeKey("b-onm-1", "channel-dz", "ar")).toBe(
      "wa:b-onm-1:channel-dz:ar",
    );

    // Re-running with the same broadcast must not re-send (deduplicated)
    const second = await deliverWhatsappChannelBroadcasts({
      env: {},
      transport,
      store,
      channelTarget: "channel-dz",
      locales: ["ar", "fr"],
      candidates: [makeOnmCandidate()],
      now: NOW,
    });
    expect(second).toMatchObject({ enqueued: 0, sent: 0, skipped: 2 });
    expect(transport.sendChannelMessage).toHaveBeenCalledTimes(2);
    expect(rows.size).toBe(2);
  });

  it("handles 429 Retry-After retry vs 403 permanent failure and mid-flight CAP Cancel invalidation", async () => {
    // 1. Transient 429 retry
    const retryHarness = makeInMemoryStore();
    const retryTransport: WhatsAppChannelTransport = {
      sendChannelMessage: vi
        .fn()
        .mockRejectedValueOnce(new WhatsAppHttpError(429, "throttled", 120))
        .mockResolvedValueOnce({ providerMessageId: "wamid.after.retry" }),
    };

    const run1 = await deliverWhatsappChannelBroadcasts({
      env: {},
      transport: retryTransport,
      store: retryHarness.store,
      channelTarget: "channel-dz",
      locales: ["ar"],
      candidates: [makeOnmCandidate()],
      now: NOW,
    });
    expect(run1).toMatchObject({ enqueued: 1, sent: 0, retried: 1, failed: 0 });
    expect(retryHarness.finishedCalls[0]).toMatchObject({
      delivered: false,
      permanent: false,
      retryAfterSeconds: 120,
    });

    // Retry attempt succeeds
    const run2 = await deliverWhatsappChannelBroadcasts({
      env: {},
      transport: retryTransport,
      store: retryHarness.store,
      channelTarget: "channel-dz",
      locales: ["ar"],
      candidates: [],
      now: NOW,
    });
    expect(run2).toMatchObject({ sent: 1, retried: 0, failed: 0 });

    // 2. Permanent 403 fails immediately without retry
    const permHarness = makeInMemoryStore();
    const permTransport: WhatsAppChannelTransport = {
      sendChannelMessage: vi
        .fn()
        .mockRejectedValue(new WhatsAppHttpError(403, "invalid token")),
    };
    const permRun = await deliverWhatsappChannelBroadcasts({
      env: {},
      transport: permTransport,
      store: permHarness.store,
      channelTarget: "channel-dz",
      locales: ["fr"],
      candidates: [makeOnmCandidate({ id: "b-perm" })],
      now: NOW,
    });
    expect(permRun).toMatchObject({ sent: 0, retried: 0, failed: 1 });
    expect(permHarness.finishedCalls[0]).toMatchObject({
      delivered: false,
      permanent: true,
    });

    // 3. Mid-flight CAP Cancel aborts before transport call
    const cancelHarness = makeInMemoryStore({
      invalidatedIds: new Set(["wa-row-1"]),
    });
    const cancelTransport: WhatsAppChannelTransport = {
      sendChannelMessage: vi.fn(),
    };
    const cancelRun = await deliverWhatsappChannelBroadcasts({
      env: {},
      transport: cancelTransport,
      store: cancelHarness.store,
      channelTarget: "channel-dz",
      locales: ["ar"],
      candidates: [makeOnmCandidate({ id: "b-cancel" })],
      now: NOW,
    });
    expect(cancelRun).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(cancelTransport.sendChannelMessage).not.toHaveBeenCalled();
    expect(cancelHarness.rows.get("wa-row-1")?.state).toBe("cancelled");
  });

  it("createMetaWhatsAppChannelTransport sends expected headers/payload and parses 429 Retry-After without live calls", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "wamid.mock.1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("rate limit", {
          status: 429,
          headers: { "retry-after": "95" },
        }),
      );

    const transport = createMetaWhatsAppChannelTransport({
      accessToken: "test-token",
      apiUrl: "https://graph.example.test/v21.0",
      fetchImpl: fetchMock,
    });

    const ok = await transport.sendChannelMessage({
      channelId: "ch_123",
      text: "ONM test",
      idempotencyKey: "wa:b1:ch_123:ar",
      locale: "ar",
    });
    expect(ok).toEqual({ providerMessageId: "wamid.mock.1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.example.test/v21.0/ch_123/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Idempotency-Key": "wa:b1:ch_123:ar",
        }),
      }),
    );

    await expect(
      transport.sendChannelMessage({
        channelId: "ch_123",
        text: "ONM test 2",
        idempotencyKey: "wa:b2:ch_123:ar",
        locale: "ar",
      }),
    ).rejects.toMatchObject({
      name: "WhatsAppHttpError",
      status: 429,
      retryAfterSeconds: 95,
    });
  });

  it("createSupabaseWhatsAppDeliveryStore exposes loadPendingCandidates and deliverWhatsappChannelBroadcasts pulls candidates from store.loadPendingCandidates end-to-end", async () => {
    const supabaseStore = createSupabaseWhatsAppDeliveryStore({
      channelTarget: "channel-dz",
      locale: "ar",
    });
    expect(typeof supabaseStore.loadPendingCandidates).toBe("function");

    // Verify mapPendingBroadcastRowToCandidate fail-closed fire mapping & ONM/official/quake mapping
    const rawFireRow: PendingWhatsAppBroadcastRow = {
      id: "b-raw-fire",
      kind: "fire",
      phase: "initial",
      severity: "Severe",
      hazard: "fire",
      source_key: "firms",
      metadata: {},
      commune_codes: ["1601"],
      created_at: "2026-11-25T09:00:00Z",
      onm_vigilance_id: null,
      official_incident_id: null,
      earthquake_id: null,
      cluster_id: "c-1",
      onm_msg_type: null,
      onm_cancelled_at: null,
      onm_superseded_by: null,
      onm_onset: null,
      onm_expires: null,
      onm_sent: null,
      onm_area_desc: null,
      onm_title: null,
      onm_headline_fr: null,
      onm_event: null,
      incident_status: null,
      incident_unlisted_at: null,
      incident_kind: null,
      incident_source_key: null,
      incident_source_label: null,
      incident_authority_tier: null,
      incident_evidence: null,
      incident_place_text: null,
      incident_as_of: null,
      incident_area_label: null,
      quake_magnitude: null,
      quake_occurred_at: null,
      quake_region: null,
      quake_network: null,
      fire_short_id: "f-unconf",
      fire_state: "unconfirmed",
      fire_confirmed_at: null,
      fire_detection_count: 1,
      fire_sources: ["firms"],
      fire_suspected_persistent: false,
      fire_last_detected_at: "2026-11-25T09:00:00Z",
      fire_area_label: "Blida",
      cap_headline: "Single thermal hotspot",
      cap_description: null,
      cap_area_desc: "Blida",
      cap_sent: "2026-11-25T09:00:00Z",
      cap_expires: null,
    };
    const rawFireCandidate = mapPendingBroadcastRowToCandidate(rawFireRow);
    expect(evaluateWhatsappBroadcastEligibility(rawFireCandidate, NOW)).toEqual(
      { eligible: false, reason: "raw_heat_signal_excluded" },
    );

    const activeFireCandidate = mapPendingBroadcastRowToCandidate({
      ...rawFireRow,
      id: "b-active-fire",
      fire_state: "active",
    });
    expect(
      evaluateWhatsappBroadcastEligibility(activeFireCandidate, NOW),
    ).toEqual({ eligible: true });

    // End-to-end deliverWhatsappChannelBroadcasts pulling via store.loadPendingCandidates (no options.candidates)
    const { store } = makeInMemoryStore();
    const loadSpy = vi.fn(async () => [makeOnmCandidate(), rawFireCandidate]);
    store.loadPendingCandidates = loadSpy;

    const transport: WhatsAppChannelTransport = {
      sendChannelMessage: vi.fn(async () => ({
        providerMessageId: "wamid.auto.1",
      })),
    };

    const summary = await deliverWhatsappChannelBroadcasts({
      env: { WHATSAPP_CHANNEL_ID: "channel-auto" },
      transport,
      store,
      now: NOW,
    });
    expect(loadSpy).toHaveBeenCalledWith(20, "channel-auto", "ar");
    expect(summary).toMatchObject({
      enqueued: 1,
      sent: 1,
      skipped: 1,
      failed: 0,
    });
    expect(transport.sendChannelMessage).toHaveBeenCalledTimes(1);
  });
});
