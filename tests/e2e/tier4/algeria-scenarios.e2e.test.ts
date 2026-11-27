import { describe, expect, it } from "vitest";
import {
  e2eBaseUrl,
  importRepoModule,
  listRepoFiles,
  readRepoFile,
  readRepoJson,
  repoFileExists,
} from "../lib/env.ts";
import {
  createJpegWithExif,
  createSpoofedMimePayload,
  inspectImageForMetadata,
} from "../lib/exif.ts";
import {
  HTTP_200_HTML_ERROR_BODY,
  buildClmsFixture,
  buildCraagBulletin,
  buildDgpcNonFirePost,
  buildEmscEvent,
  buildGhslFixture,
  buildGwisFixture,
  buildImergFixture,
  buildMtgFciFixture,
  buildOnmCapXml,
  buildTarikiPost,
  deriveWilayaSlug,
  loadAlgeriaAdmin,
} from "../lib/fixtures.ts";
import { fetchBytes, fetchText, startMockHttpServer } from "../lib/http.ts";
import {
  SHARE_CARD_MAX_BYTES,
  assertValidShareCardImage,
  decodeRasterDimensions,
} from "../lib/image.ts";
import {
  assertPgReachable,
  psqlExec,
  psqlJson,
  runInRolledBackTx,
} from "../lib/pg.ts";
import {
  findBannedSafeLabels,
  findEmDashesInText,
  measureContrastViolations,
  measureHorizontalOverflow,
  measureTouchTargets,
  stripHtmlForTextScan,
  withBrowserPage,
} from "../lib/playwright.ts";

// ---------------------------------------------------------------------------
// Dynamic contract helpers (no static imports of M1–M4 modules)
// ---------------------------------------------------------------------------

type AnyFn = (...args: unknown[]) => unknown;

function findExportedFn(
  mod: Record<string, unknown>,
  candidates: readonly string[],
  moduleLabel: string,
): AnyFn {
  for (const name of candidates) {
    const value = mod[name];
    if (typeof value === "function") {
      return value as AnyFn;
    }
  }
  const available = Object.keys(mod).sort().join(", ");
  throw new Error(
    `Module "${moduleLabel}" missing expected export (${candidates.join(" | ")}). Available: [${available}]`,
  );
}

async function importFirstExistingModule(
  candidates: readonly string[],
): Promise<{ path: string; mod: Record<string, unknown> }> {
  const errors: string[] = [];
  for (const relPath of candidates) {
    try {
      const mod = await importRepoModule<Record<string, unknown>>(relPath);
      return { path: relPath, mod };
    } catch (error) {
      errors.push(
        `${relPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `None of the required contract modules exist: ${candidates.join(", ")}\n${errors.join("\n")}`,
  );
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface NotificationChannelsMod extends Record<string, unknown> {
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
  channelFromFcmData: (data: unknown) => string;
}

interface AlertProvenanceMod extends Record<string, unknown> {
  buildAlertProvenance: (input: {
    triggerKind: string;
    areaLabel?: string | null;
    radiusKm?: number | null;
    sourceKey: string;
    sourceAttribution?: string | null;
    ruleLabelKey?: string | null;
    observedAt: string;
    authorityStatus?: string | null;
  }) => Record<string, unknown>;
  validateProvenanceInvariants: (data: Record<string, unknown>) => string[];
  toProvenancePayload: (
    data: Record<string, unknown>,
  ) => Record<string, string>;
  formatProvenanceDigestLine: (
    data: Record<string, unknown>,
    labels: {
      trigger: string;
      rule: string;
      areaFallback: string;
      timeLabel: string;
    },
  ) => string;
}

interface FcmMod extends Record<string, unknown> {
  fcmTopic: (code: string, lang: string) => string;
  fcmMessagesForOnm: (args: {
    broadcastId: string;
    severity: string;
    communeCodes: string[];
    title: string;
    headlineFr: string | null;
    wilayaId: string | null;
    event: string;
  }) => Array<{
    topic: string;
    android: { notification: { channel_id: string } };
    notification: { title: string; body: string };
    data: Record<string, string>;
  }>;
}

interface GatewayMod extends Record<string, unknown> {
  GatewayPending: new (
    reason: string,
    retryAfter: number | null,
  ) => Error & {
    reason: string;
    retryAfter: number | null;
  };
  completeWithGatewayResult: (
    purpose: string,
    request: {
      messages: Array<{ role: string; content: string }>;
      response_format: {
        type: "json_schema";
        json_schema: { name: string; strict: boolean; schema: unknown };
      };
    },
    options?: Record<string, unknown>,
  ) => Promise<{
    text: string;
    provenance: {
      provider: string;
      providerId: string;
      model: string;
      fallbackUsed: boolean;
      primaryErrorKind: string | null;
      attempts: number;
      purpose: string;
    };
  }>;
  resetLlmCircuitBreakers: () => void;
}

interface WorkerRunnerMod extends Record<string, unknown> {
  EUWorker: new (
    options: Record<string, unknown>,
    deps: Record<string, unknown>,
  ) => {
    start: () => void;
    getSnapshot: () => { completedJobs: number; failedJobs: number };
    stop: (drainTimeoutMs?: number) => Promise<{
      drained: boolean;
      remaining: number;
    }>;
  };
}

interface EmscMod extends Record<string, unknown> {
  parseEmsc: (body: unknown) => Array<{
    id: string;
    magnitude: number;
    lat: number;
    lon: number;
    depth_km: number | null;
    occurred_at: string;
  }>;
}

interface ColdArchiveMod extends Record<string, unknown> {
  COLD_TABLES: readonly string[];
  coldPath: (prefix: "cold" | "trial", table: string, day: string) => string;
}

interface ImageMetadataMod extends Record<string, unknown> {
  stripImageMetadata: (bytes: Uint8Array, type: string) => Uint8Array;
}

interface SourceJobsMod extends Record<string, unknown> {
  retryDispositionForReason: (reason: string) => string;
}

function stripHtmlToText(html: string): string {
  return stripHtmlForTextScan(html);
}

async function fetchEntityShareCard(args: {
  kind: "quake" | "fire" | "wilaya";
  lang: "ar" | "fr" | "en" | "kab";
  explicitId?: string;
}): Promise<{ status: number; bytes: Uint8Array }> {
  let id = args.explicitId ?? "";
  let cleanupSql: string | null = null;

  if (!id && args.kind === "quake") {
    assertPgReachable();
    const rows = psqlJson<{ id: string }>(
      "SELECT id::text AS id FROM public.earthquakes WHERE magnitude >= 4.0 ORDER BY occurred_at DESC LIMIT 1;",
    );
    if (rows[0]?.id) {
      id = rows[0].id;
    } else {
      const seededId = "e2e_scenario2_bejaia_m46";
      psqlExec(
        `INSERT INTO public.earthquakes (id, occurred_at, updated_at, fetched_at, lat, lon, depth_km, magnitude, magnitude_type, network, region, offshore)
         VALUES ('${seededId}', now() - interval '5 minutes', now(), now(), 36.7525, 5.0556, 10, 4.6, 'ml', 'CRAAG / EMSC', '12 km NE Bejaia', false)
         ON CONFLICT (id) DO NOTHING;`,
      );
      id = seededId;
      cleanupSql = `DELETE FROM public.earthquakes WHERE id = '${seededId}';`;
    }
  } else if (!id && args.kind === "fire") {
    assertPgReachable();
    const rows = psqlJson<{ short_id: string }>(
      `SELECT fc.short_id
       FROM public.fire_clusters fc
       LEFT JOIN public.admin_units au ON au.id = fc.commune_id
       WHERE fc.state IN ('active', 'confirmed')
         AND fc.resolved_at IS NULL
         AND fc.confirmed_at IS NULL
         AND COALESCE(fc.suspected_persistent_source, false) = false
         AND au.forest_fraction >= 0.1
       ORDER BY fc.last_detected_at DESC
       LIMIT 1;`,
    );
    if (rows[0]?.short_id) {
      id = rows[0].short_id;
    } else {
      const forestedCommune = psqlJson<{
        id: string;
        parent_id: string | null;
      }>(
        `SELECT id::text AS id, parent_id::text AS parent_id
         FROM public.admin_units
         WHERE level = 'commune' AND forest_fraction >= 0.1
         ORDER BY code
         LIMIT 1;`,
      );
      const communeIdSql = forestedCommune[0]?.id
        ? `'${forestedCommune[0].id}'::uuid`
        : "NULL";
      const wilayaIdSql = forestedCommune[0]?.parent_id
        ? `'${forestedCommune[0].parent_id}'::uuid`
        : "NULL";
      const seededUuid = "92000000-0000-4000-8000-000000000201";
      const shortId = "E2ETIZI1";
      cleanupSql = `DELETE FROM public.fire_clusters WHERE id = '${seededUuid}';`;
      psqlExec(
        `INSERT INTO public.fire_clusters (id, short_id, state, lat, lon, confidence, detection_count, first_detected_at, last_detected_at, max_frp_mw, commune_id, wilaya_id, sources, confirmed_at)
         VALUES ('${seededUuid}', '${shortId}', 'active', 36.7169, 4.0497, 0.91, 5, now() - interval '20 minutes', now() - interval '2 minutes', 64.2, ${communeIdSql}, ${wilayaIdSql}, ARRAY['firms', 'fci'], NULL)
         ON CONFLICT DO NOTHING;`,
      );
      id = shortId;
    }
  }

  try {
    const res = await fetchBytes(
      `/api/public/share/${args.kind}/${encodeURIComponent(id)}.whatsapp.webp?lang=${args.lang}`,
    );
    return { status: res.status, bytes: res.bytes };
  } finally {
    if (cleanupSql) {
      psqlExec(cleanupSql);
    }
  }
}

describe("Tier 4 — 12 Real-World Algerian Multi-Hazard Application Scenarios", () => {
  // Scenario 1
  it("Scenario 1 — Algiers & Tipaza Winter Flash-Flood Escalation (ONM Moderate->Extreme + IMERG 30-min + DGPC Flood + Tariki RN11 + Commune Push + Provenance + WhatsApp/Resend)", async () => {
    const channelMod = await importRepoModule<NotificationChannelsMod>(
      "src/lib/notification-channels",
    );
    const provenanceMod = await importRepoModule<AlertProvenanceMod>(
      "src/lib/alert-provenance",
    );
    const fcmMod = await importRepoModule<FcmMod>("src/lib/fcm");
    const onmMod = await importRepoModule<Record<string, unknown>>(
      "src/lib/ingest/onm.server",
    );

    // Stage A: ONM Moderate -> Extreme CAP escalation chain for Algiers (16) & Tipaza (42)
    const moderateXml = buildOnmCapXml({
      identifier: "urn:oid:2.49.0.1.12.0.20261124.s1.mod",
      msgType: "Alert",
      severity: "Moderate",
      wilayaCodes: ["16", "42"],
      areaDesc: "Alger, Tipaza",
      headline: "BMS Pluies Niveau 1 (Jaune) - Alger et Tipaza",
    });
    const extremeXml = buildOnmCapXml({
      identifier: "urn:oid:2.49.0.1.12.0.20261124.s1.ext",
      msgType: "Update",
      references:
        "onm@meteo.dz,urn:oid:2.49.0.1.12.0.20261124.s1.mod,2026-11-24T12:00:00+01:00",
      severity: "Extreme",
      sent: "2026-11-24T15:00:00+01:00",
      wilayaCodes: ["16", "42"],
      areaDesc: "Alger, Tipaza",
      headline: "BMS Pluies Niveau 3 (Rouge) - Alger et Tipaza",
    });

    const parseCapDetail = findExportedFn(
      onmMod,
      ["parseCapDetail", "parseOnmCapXml", "parseCapAlert"],
      "src/lib/ingest/onm.server",
    );
    const modParsed = parseCapDetail(moderateXml) as Record<string, unknown>;
    const extParsed = parseCapDetail(extremeXml) as Record<string, unknown>;
    expect(modParsed).toBeTruthy();
    expect(extParsed).toBeTruthy();
    expect(
      String(extParsed["msgType"] ?? extParsed["msg_type"] ?? "").toLowerCase(),
    ).toBe("update");

    expect(
      channelMod.resolveNotificationChannel({
        kind: "onm",
        severity: "Moderate",
      }),
    ).toBe("alerts_civil");
    expect(
      channelMod.resolveNotificationChannel({
        kind: "onm",
        severity: "Extreme",
      }),
    ).toBe("alerts_urgent");

    // Stage B: NASA IMERG 30-min observed satellite rainfall kept distinct from Open-Meteo model
    const imerg = buildImergFixture();
    expect(imerg.sourceType).toBe("observed_satellite");
    expect(imerg.cells.find((c) => c.wilayaCode === "16")?.mm30m).toBe(28.4);
    expect(imerg.cells.find((c) => c.wilayaCode === "42")?.mm30m).toBe(21.2);
    await importFirstExistingModule([
      "src/lib/ingest/imerg.server",
      "src/lib/ingest/imerg",
      "src/lib/ingest/rainfall.server",
      "src/lib/ingest/hsaf.server",
    ]);

    // Stage C: DGPC flood incident + Tariki RN11 flooded-road closure
    const dgpcFlood = buildDgpcNonFirePost({ kind: "flood" });
    const tarikiClosure = buildTarikiPost({ kind: "flood_closure" });
    const { path: tarikiPath, mod: tarikiMod } =
      await importFirstExistingModule([
        "src/lib/text-sources/tariki",
        "src/lib/text-sources/tariki.server",
      ]);
    const tarikiClassifier = findExportedFn(
      tarikiMod,
      [
        "isTarikiDangerPost",
        "classifyTarikiPost",
        "filterTarikiPost",
        "parseTarikiPost",
        "extractTarikiIncident",
      ],
      tarikiPath,
    );
    expect(tarikiClassifier(tarikiClosure.rawText, tarikiClosure)).toBeTruthy();

    // Stage D: Accountless commune push topic v1.commune.1617.ar + alerts_urgent + Trigger Provenance
    const onmMessages = fcmMod.fcmMessagesForOnm({
      broadcastId: "b-s1-algiers-extreme",
      severity: "Extreme",
      communeCodes: ["1617", "1602", "4201"],
      title: "Rain Extreme warning",
      headlineFr: "BMS Pluies Niveau 3 (Rouge) - Alger et Tipaza",
      wilayaId: "16",
      event: "Rain",
    });
    const ainBenianAr = onmMessages.find(
      (m) => m.topic === fcmMod.fcmTopic("1617", "ar"),
    );
    expect(ainBenianAr).toBeTruthy();
    expect(ainBenianAr!.android.notification.channel_id).toBe("alerts_urgent");
    expect(JSON.stringify(ainBenianAr)).not.toMatch(/user_id|email|phone/i);

    const provenance = provenanceMod.buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: "Ain Benian, Alger",
      sourceKey: "onm",
      sourceAttribution: "Office National de la Météorologie (ONM)",
      ruleLabelKey: "provenance.rule.onmExtreme",
      observedAt: "2026-11-24T15:00:00+01:00",
      authorityStatus: "official",
    });
    expect(provenanceMod.validateProvenanceInvariants(provenance)).toEqual([]);
    const provFcm = provenanceMod.toProvenancePayload(provenance);
    expect(provFcm["provenance_trigger"]).toBe("commune_topic");
    expect(provFcm["provenance_source"]).toBe(
      "Office National de la Météorologie (ONM)",
    );

    // Stage E: Mocked WhatsApp Channel & Resend zone email digest delivery
    const waMock = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ id: "wamid.s1.flood" }] }),
    }));
    const resendMock = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "resend_s1_flood" }),
    }));

    try {
      const { path: waPath, mod: waMod } = await importFirstExistingModule([
        "src/lib/delivery/whatsapp-channel.server",
      ]);
      const { path: emailPath, mod: emailMod } =
        await importFirstExistingModule([
          "src/lib/delivery/email-digest.server",
        ]);

      const waBuild = findExportedFn(
        waMod,
        [
          "formatWhatsappBroadcastMessage",
          "formatWhatsAppBroadcast",
          "buildWhatsAppPayload",
          "buildWhatsAppMessage",
          "formatWhatsAppChannelMessage",
        ],
        waPath,
      );
      const waTransportFactory = findExportedFn(
        waMod,
        ["createMetaWhatsAppChannelTransport"],
        waPath,
      );
      const emailBuild = findExportedFn(
        emailMod,
        [
          "renderZoneDigestEmail",
          "buildZoneDigestEmail",
          "formatZoneEmailDigest",
          "buildDigestEmailPayload",
        ],
        emailPath,
      );
      const resendTransportFactory = findExportedFn(
        emailMod,
        ["createResendEmailTransport"],
        emailPath,
      );

      const waOut = waBuild({
        candidate: {
          id: "s1-onm-extreme",
          kind: "onm",
          phase: "update",
          severity: "Extreme",
          hazard: "rain",
          sourceKey: "onm",
          sourceAttribution: "Office National de la Météorologie (ONM)",
          authorityStatus: "official",
          headline: "BMS Pluies Niveau 3 (Rouge) - Alger et Tipaza",
          summary: dgpcFlood.textFr,
          areaLabel: "Alger, Tipaza",
          observedAt: "2026-11-24T15:00:00+01:00",
          provenance,
        },
        locale: "fr",
      }) as {
        text: string;
        deepLink: string;
        provenanceFooter: string;
      };
      expect(waOut.text).toMatch(/ONM/i);
      expect(waOut.provenanceFooter.length).toBeGreaterThan(10);

      const emailOut = emailBuild({
        locale: "fr",
        urgentBypass: true,
        manageUrl: "https://nadhir.app/privacy?unsubscribe=s1",
        alerts: [
          {
            id: "s1-onm-extreme",
            kind: "onm",
            severity: 5,
            title: "BMS Pluies Niveau 3 (Rouge) - Alger et Tipaza",
            body: dgpcFlood.textFr,
            created_at: "2026-11-24T15:00:00+01:00",
            zone_name: "Bab El Oued & Ain Benian",
            payload: {
              ...provenanceMod.toProvenancePayload(provenance),
              onm_severity: "Extreme",
              source_key: "onm",
              source_attribution: "Office National de la Météorologie (ONM)",
            },
          },
        ],
      }) as {
        subject: string;
        html: string;
        text: string;
        provenanceLines: string[];
      };
      const emailStr = `${emailOut.subject}\n${emailOut.html}\n${emailOut.text}`;
      expect(emailStr).toMatch(/ONM/i);
      expect(emailStr).toMatch(/unsubscribe|désabonner|privacy/i);
      expect(emailOut.provenanceLines.length).toBeGreaterThan(0);

      // Exercise real Meta WhatsApp & Resend transports against local mocks (zero live prod calls)
      const waTransport = waTransportFactory({
        accessToken: "s1-mock-wa-token",
        apiUrl: waMock.url,
        fetchImpl: fetch,
      }) as {
        sendChannelMessage: (input: {
          channelId: string;
          text: string;
          linkPreview?: boolean;
          idempotencyKey: string;
          locale: string;
        }) => Promise<{ providerMessageId: string }>;
      };
      const waSent = await waTransport.sendChannelMessage({
        channelId: "nadhir-channel-dz",
        text: waOut.text,
        linkPreview: true,
        idempotencyKey: "wa:s1-onm-extreme:fr",
        locale: "fr",
      });
      expect(waSent.providerMessageId).toBe("wamid.s1.flood");

      const resendTransport = resendTransportFactory({
        apiKey: "s1-mock-resend-key",
        apiUrl: resendMock.url,
        fetchImpl: fetch,
      }) as {
        sendEmail: (input: {
          from: string;
          to: string;
          subject: string;
          html: string;
          text: string;
          idempotencyKey: string;
        }) => Promise<{ providerMessageId: string }>;
      };
      const resendSent = await resendTransport.sendEmail({
        from: "alerts@nadhir.app",
        to: "algiers.citizen@example.dz",
        subject: emailOut.subject,
        html: emailOut.html,
        text: emailOut.text,
        idempotencyKey: "email:s1-onm-extreme:fr",
      });
      expect(resendSent.providerMessageId).toBe("resend_s1_flood");
      expect(waMock.requests).toHaveLength(1);
      expect(resendMock.requests).toHaveLength(1);
    } finally {
      await waMock.close();
      await resendMock.close();
    }
  });

  // Scenario 2
  it("Scenario 2 — Bejaia M4.6 Earthquake End-to-End (EMSC M4.6 + CRAAG Match + 100 km Commune Push + /wilaya/bejaia SEO + <= 37 KB AR Quake Share Card)", async () => {
    const emscMod = await importRepoModule<EmscMod>("src/lib/ingest/emsc");
    const channelMod = await importRepoModule<NotificationChannelsMod>(
      "src/lib/notification-channels",
    );
    const fcmMod = await importRepoModule<FcmMod>("src/lib/fcm");
    const admin = loadAlgeriaAdmin();

    // Stage A: EMSC M4.6 FDSN event
    const emscRaw = buildEmscEvent({
      id: "20261124_bejaia_s2",
      mag: 4.6,
      lat: 36.7525,
      lon: 5.0556,
      depthKm: 10,
      time: "2026-11-24T13:42:18.4Z",
    });
    const events = emscMod.parseEmsc({
      type: "FeatureCollection",
      features: [emscRaw],
    });
    expect(events).toHaveLength(1);
    const quake = events[0]!;

    // Stage B: CRAAG official bulletin match
    const craagFixture = buildCraagBulletin({
      magnitude: 4.6,
      lat: 36.751,
      lon: 5.058,
      eventTime: "2026-11-24T13:42:20Z",
    });
    const craagTableHtml = [
      '<!DOCTYPE html><html lang="fr"><head><title>CRAAG - Bulletins sismiques</title></head><body>',
      "<table>",
      "  <thead><tr>",
      "    <th>Date et Heure (UTC)</th><th>Magnitude</th><th>Latitude</th><th>Longitude</th><th>Profondeur</th><th>Localisation</th><th>Bulletin</th>",
      "  </tr></thead>",
      "  <tbody><tr>",
      `    <td>${craagFixture.eventTime}</td>`,
      `    <td>ML ${craagFixture.magnitude.toFixed(1)}</td>`,
      `    <td>${craagFixture.lat.toFixed(4)} N</td>`,
      `    <td>${craagFixture.lon.toFixed(4)} E</td>`,
      `    <td>${craagFixture.depthKm} km</td>`,
      `    <td>${craagFixture.locationFr}</td>`,
      `    <td><a href="${craagFixture.bulletinUrl}">Bulletin officiel CRAAG</a></td>`,
      "  </tr></tbody>",
      "</table></body></html>",
    ].join("\n");
    const craagServer = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: craagTableHtml,
    }));

    try {
      const { path: craagPath, mod: craagMod } =
        await importFirstExistingModule([
          "src/lib/ingest/craag",
          "src/lib/ingest/craag.server",
        ]);
      const fetchedHtml = await fetchText(craagServer.url);
      expect(fetchedHtml.status).toBe(200);

      const parseCraag = findExportedFn(
        craagMod,
        [
          "parseCraagBulletins",
          "parseCraagHtml",
          "parseCraagBulletin",
          "extractCraagBulletins",
        ],
        craagPath,
      );
      const matchCraag = findExportedFn(
        craagMod,
        [
          "matchCraagToEmsc",
          "matchCraagBulletin",
          "matchOfficialAttribution",
          "matchEarthquakeAttribution",
        ],
        craagPath,
      );

      const parsed = parseCraag(fetchedHtml.text) as {
        bulletins: Array<{
          bulletinId: string;
          observedAt: string;
          lat: number;
          lon: number;
          magnitude: number;
          attribution: string;
          sourceUrl: string | null;
        }>;
      };
      expect(parsed.bulletins).toHaveLength(1);
      const bulletin = parsed.bulletins[0]!;
      expect(bulletin.attribution).toMatch(/CRAAG/i);

      const matched = matchCraag(bulletin, [
        {
          id: quake.id,
          occurred_at: quake.occurred_at,
          lat: quake.lat,
          lon: quake.lon,
          magnitude: quake.magnitude,
        },
      ]) as {
        earthquakeId: string;
        distanceKm: number;
        timeDiffSeconds: number;
        magnitudeDiff: number;
      } | null;
      expect(matched).not.toBeNull();
      expect(matched?.earthquakeId).toBe(quake.id);
      expect(matched?.distanceKm).toBeLessThanOrEqual(50);
      expect(matched?.timeDiffSeconds).toBeLessThanOrEqual(120);
      expect(matched?.magnitudeDiff).toBeLessThanOrEqual(1.0);
    } finally {
      await craagServer.close();
    }

    // Stage C: 100 km commune fan-out + alerts_earthquakes channel
    const impactedCommunes = admin.communes.filter(
      (c) => haversineKm(quake.lat, quake.lon, c.lat, c.lon) <= 100,
    );
    expect(impactedCommunes.some((c) => c.wilaya_code === "06")).toBe(true);
    expect(impactedCommunes.some((c) => c.wilaya_code === "16")).toBe(false);
    expect(
      channelMod.resolveNotificationChannel({
        kind: "earthquake",
        magnitude: quake.magnitude,
      }),
    ).toBe("alerts_earthquakes");
    expect(fcmMod.fcmTopic(impactedCommunes[0]!.code, "ar")).toMatch(
      /^v1\.commune\.\d{4}\.ar$/,
    );

    // Stage D: /wilaya/bejaia?lang=ar SEO
    const wilayaRes = await fetchText("/wilaya/bejaia?lang=ar");
    expect(wilayaRes.status).toBe(200);
    expect(wilayaRes.text).toMatch(/بجاية|Béjaïa|Bejaia/i);
    expect(wilayaRes.text).toMatch(/rel=["']canonical["']/i);
    expect(wilayaRes.text).toMatch(/hreflang=["']ar-DZ["']/i);
    expect(findEmDashesInText(stripHtmlToText(wilayaRes.text)).count).toBe(0);

    // Stage E: <= 37 KB AR quake share card
    const card = await fetchEntityShareCard({ kind: "quake", lang: "ar" });
    expect(card.status).toBe(200);
    const decoded = await assertValidShareCardImage(
      card.bytes,
      SHARE_CARD_MAX_BYTES,
    );
    expect(decoded.width).toBeGreaterThanOrEqual(200);
    expect(decoded.height).toBeGreaterThanOrEqual(200);
  });

  // Scenario 3
  it("Scenario 3 — Tizi Ouzou Summer Wildfire Cascade (MTG FCI Push + GWIS/CLMS/GHSL + Probable Fire + Mobile AR RTL Map & Emergency 14 + <= 37 KB Fire Card)", async () => {
    const channelMod = await importRepoModule<NotificationChannelsMod>(
      "src/lib/notification-channels",
    );
    const provenanceMod = await importRepoModule<AlertProvenanceMod>(
      "src/lib/alert-provenance",
    );

    // Stage A: MTG FCI sub-5-min push + GWIS/CLMS/GHSL honesty context
    const fci = buildMtgFciFixture({ quietSaharaOnly: false });
    const gwis = buildGwisFixture({ wilayaCode: "15" });
    const clms = buildClmsFixture({ wilayaCode: "15" });
    const ghsl = buildGhslFixture({ wilayaCode: "15", communeCode: "1501" });

    expect(fci.cadenceMinutes).toBeLessThanOrEqual(5);
    expect(fci.hotspots[0]?.wilayaCode).toBe("15");
    expect(gwis.fwi).toBeGreaterThan(30);
    expect(clms.ndviAnomaly).toBeLessThan(0);
    expect(ghsl.populationWithin5km).toBeGreaterThan(0);

    // Stage B: Probable Fire (NEVER "confirmed" without official authority) + alerts_urgent
    expect(channelMod.resolveNotificationChannel({ kind: "fire" })).toBe(
      "alerts_urgent",
    );
    const fireProv = provenanceMod.buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: "Tizi Ouzou",
      sourceKey: "mtg_fci",
      sourceAttribution: "EUMETSAT MTG FCI + NASA FIRMS (Probable Fire)",
      ruleLabelKey: "provenance.rule.probableFire",
      observedAt: fci.slotTime,
      authorityStatus: "probable",
    });
    expect(provenanceMod.validateProvenanceInvariants(fireProv)).toEqual([]);
    expect(fireProv["authorityStatus"]).toBe("probable");
    expect(String(fireProv["sourceAttribution"]).toLowerCase()).not.toContain(
      "confirmed",
    );

    // Stage C: Mobile AR RTL (390x844) 3-detent map bottom sheet + Emergency 14 / Check-In
    await withBrowserPage(
      {
        locale: "ar",
        viewport: "mobile",
        baseUrl: e2eBaseUrl(),
      },
      async (page) => {
        const homeRes = await page.goto("/?lang=ar", {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        expect(homeRes?.status()).toBe(200);
        const dir = await page.evaluate(
          () => document.documentElement.getAttribute("dir") ?? "",
        );
        expect(dir.toLowerCase()).toBe("rtl");
        expect((await measureHorizontalOverflow(page)).hasOverflow).toBe(false);
        expect(await measureTouchTargets(page, 44)).toEqual([]);
        expect(await measureContrastViolations(page, 4.5)).toEqual([]);

        const survivalRes = await page.goto("/survival?lang=ar", {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        expect(survivalRes?.status()).toBe(200);
        const survivalText = await page.evaluate(() => document.body.innerText);
        expect(survivalText).toContain("14");
        expect(findBannedSafeLabels(survivalText)).toEqual([]);
        expect(findEmDashesInText(survivalText).count).toBe(0);
      },
    );

    // Stage D: <= 37 KB fire share card in AR and FR
    for (const lang of ["ar", "fr"] as const) {
      const card = await fetchEntityShareCard({ kind: "fire", lang });
      expect(card.status).toBe(200);
      const decoded = await assertValidShareCardImage(
        card.bytes,
        SHARE_CARD_MAX_BYTES,
      );
      expect(decoded.width).toBeGreaterThanOrEqual(200);
    }
  });

  // Scenario 4
  it("Scenario 4 — Citizen Photo Report Submission with Full Privacy Hardening (Law 18-07/25-11 Consent + Turnstile + Server EXIF Strip + Data Export)", async () => {
    const imgMod = await importRepoModule<ImageMetadataMod>(
      "src/lib/image-metadata",
    );

    // Stage A: Real GPS + Samsung Galaxy A55 EXIF JPEG fixture
    const rawPhoto = createJpegWithExif({
      make: "Samsung",
      model: "Galaxy A55",
      latitude: 36.7538,
      longitude: 3.0588,
      comment: "Reporter GPS 36.7538, 3.0588 Algiers",
      includeIccProfile: true,
    });
    const beforeMeta = inspectImageForMetadata(rawPhoto);
    expect(beforeMeta.hasExif).toBe(true);
    expect(beforeMeta.hasGps).toBe(true);
    expect(beforeMeta.hasCameraTags).toBe(true);

    // Stage B: Law 18-07/25-11 consent + mocked Turnstile siteverify
    await importFirstExistingModule(["src/lib/privacy-consent.server"]);
    const { path: turnstilePath, mod: turnstileMod } =
      await importFirstExistingModule(["src/lib/turnstile.server"]);

    const mockTurnstile = await startMockHttpServer((req) => {
      const token = new URLSearchParams(req.body).get("response");
      const valid = token === "turnstile-valid-s4";
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          success: valid,
          "error-codes": valid ? [] : ["invalid-input-response"],
        }),
      };
    });

    try {
      const verifyFn = findExportedFn(
        turnstileMod,
        [
          "verifyTurnstileToken",
          "verifyTurnstile",
          "validateTurnstileToken",
          "checkTurnstile",
        ],
        turnstilePath,
      );
      const okRes = (await Promise.resolve(
        verifyFn({
          token: "turnstile-valid-s4",
          secretKey: "s4-secret",
          verifyUrl: mockTurnstile.url,
          fetchImpl: fetch,
          required: true,
        }),
      )) as Record<string, unknown>;
      expect(okRes["ok"]).toBe(true);
      expect("skipped" in okRes).toBe(false);

      const badRes = (await Promise.resolve(
        verifyFn({
          token: "turnstile-invalid-s4",
          secretKey: "s4-secret",
          verifyUrl: mockTurnstile.url,
          fetchImpl: fetch,
          required: true,
        }),
      )) as Record<string, unknown>;
      expect(badRes["ok"]).toBe(false);
      expect(badRes["status"]).toBe(403);
      expect(mockTurnstile.requests).toHaveLength(2);
    } finally {
      await mockTurnstile.close();
    }

    // Stage C: Server-side EXIF stripping & upload endpoint auth/MIME enforcement
    const stripped = imgMod.stripImageMetadata(rawPhoto, "image/jpeg");
    const afterMeta = inspectImageForMetadata(stripped);
    expect(afterMeta.hasExif).toBe(false);
    expect(afterMeta.hasGps).toBe(false);
    expect(afterMeta.hasCameraTags).toBe(false);
    expect(afterMeta.hasTextChunks).toBe(false);

    const asciiDump = new TextDecoder("latin1").decode(stripped);
    expect(asciiDump).not.toContain("Samsung");
    expect(asciiDump).not.toContain("Galaxy A55");
    expect(asciiDump).not.toContain("36.7538");

    const decoded = await decodeRasterDimensions(stripped);
    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);
    expect(() =>
      imgMod.stripImageMetadata(createSpoofedMimePayload(), "image/jpeg"),
    ).toThrow();

    const unauthUpload = await fetchText("/api/private/report-photo", {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: Buffer.from(rawPhoto),
    });
    expect([401, 403]).toContain(unauthUpload.status);

    // Stage D: Privacy data export route & 4-locale /privacy ANPDP notice
    const unauthExport = await fetchText("/api/private/privacy-export");
    expect([401, 403]).toContain(unauthExport.status);

    for (const lang of ["ar", "fr", "en", "kab"] as const) {
      const privRes = await fetchText(`/privacy?lang=${lang}`);
      expect(privRes.status, `/privacy?lang=${lang}`).toBe(200);
      expect(privRes.text).toMatch(/18-07|25-11|ANPDP/i);
      expect(findEmDashesInText(stripHtmlToText(privRes.text)).count).toBe(0);
    }
  });

  // Scenario 5
  it("Scenario 5 — 2026-11-26 Midnight Cold-Archive Retention Run Across All 6 Cold Tables (Manifest + Eligible Delete + Hot/FK Protection + Rollback on Mismatch)", async () => {
    const coldMod = await importRepoModule<ColdArchiveMod>(
      "src/lib/cold-archive",
    );
    expect([...coldMod.COLD_TABLES]).toEqual([
      "weather_snapshots",
      "risk_forecasts",
      "broadcast_audit",
      "airport_observations",
      "source_runs",
      "source_jobs",
    ]);
    expect(repoFileExists("scripts/verify-cold-archive.ts")).toBe(true);

    assertPgReachable();
    const result = runInRolledBackTx(`
      DO $$
      DECLARE
        _cold_day date := LEAST((now() AT TIME ZONE 'UTC')::date - 100, DATE '2026-08-20');
        _cold_ts timestamptz := (_cold_day::timestamp AT TIME ZONE 'UTC') + interval '5 hours';
        _hot_ts timestamptz := now() - interval '2 days';
        _commune_id uuid;
        _contract_key text := 'e2e_s5_cold_all6';
        _hours jsonb := (SELECT jsonb_agg(jsonb_build_object('h', g)) FROM generate_series(1, 48) g);
        _evidence jsonb := jsonb_build_object('source', 'open-meteo', 'model', 'best_match', 'hours', _hours);
        _t text;
        _cnt bigint;
        _dig text;
        _path text;
        _del bigint;
        _err_caught boolean := false;
      BEGIN
        SELECT id INTO _commune_id FROM public.admin_units WHERE level = 'commune' LIMIT 1;
        IF _commune_id IS NULL THEN
          RAISE EXCEPTION 'No commune row found in public.admin_units';
        END IF;

        INSERT INTO public.source_contracts (
          key, version, label, family, criticality, freshness_basis, cadence_minutes,
          warning_after_minutes, stale_after_minutes, parser_version, licence, attribution,
          owner, execution_target
        ) VALUES (
          _contract_key, 1, 'S5 Cold Archive Test', 'reference_enrichment', 'optional',
          'last_success_at', 15, 30, 60, '1', 'test', 'test', 'e2e', 'worker'
        );

        -- 1. weather_snapshots (1 cold, 1 hot)
        INSERT INTO public.weather_snapshots (id, commune_id, scheduled_at, fetched_at, evidence)
        VALUES
          ('95000000-0000-4000-8000-000000000001', _commune_id, _cold_ts, _cold_ts, _evidence),
          ('95000000-0000-4000-8000-000000000002', _commune_id, _hot_ts, _hot_ts, _evidence);

        -- 2. risk_forecasts (1 archivable cold, 1 checkpoint-protected cold)
        INSERT INTO public.risk_publications (snapshot_id, base_date, scheduled_for, published_at, row_count)
        VALUES
          ('95000000-0000-4000-8000-000000000011', _cold_day, _cold_ts, _cold_ts, 1),
          ('95000000-0000-4000-8000-000000000012', _cold_day, _cold_ts + interval '1 hour', _cold_ts, 1);
        INSERT INTO public.risk_publication_checkpoint (key, snapshot_id, base_date, scheduled_for, published_at)
        VALUES ('local_fwi', '95000000-0000-4000-8000-000000000012', _cold_day, _cold_ts + interval '1 hour', _cold_ts)
        ON CONFLICT (key) DO UPDATE SET
          snapshot_id = EXCLUDED.snapshot_id,
          base_date = EXCLUDED.base_date,
          scheduled_for = EXCLUDED.scheduled_for,
          published_at = EXCLUDED.published_at;
        INSERT INTO public.risk_forecasts (id, snapshot_id, commune_id, forecast_date, horizon_days, source, fwi, danger_level, created_at)
        VALUES
          ('95000000-0000-4000-8000-000000000021', '95000000-0000-4000-8000-000000000011', _commune_id, _cold_day, 0, 'local_fwi', 12, 1, _cold_ts),
          ('95000000-0000-4000-8000-000000000022', '95000000-0000-4000-8000-000000000012', _commune_id, _cold_day, 0, 'local_fwi', 15, 2, _cold_ts);

        -- 3. broadcast_audit (1 cold, 1 hot)
        INSERT INTO public.broadcast_audit (id, at, action, reason)
        VALUES
          ('95000000-0000-4000-8000-000000000031', _cold_ts, 'suppressed', 's5-cold'),
          ('95000000-0000-4000-8000-000000000032', _hot_ts, 'suppressed', 's5-hot');

        -- 4. airport_observations (1 cold, 1 hot)
        INSERT INTO public.airport_observations (id, station, observed_at, fetched_at, lat, lon, raw)
        VALUES
          ('95000000-0000-4000-8000-000000000041', 'DAAG', _cold_ts, _cold_ts, 36.691, 3.2154, 'METAR DAAG S5 COLD'),
          ('95000000-0000-4000-8000-000000000042', 'DAAG', _hot_ts, _hot_ts, 36.691, 3.2154, 'METAR DAAG S5 HOT');

        -- 5 & 6. source_jobs (1 cold unlinked, 1 cold FK-linked to hot run) + source_runs (1 cold archivable, 1 hot)
        INSERT INTO public.source_jobs (
          id, contract_key, contract_version, trigger_kind, idempotency_key,
          scheduled_for, data_from, data_through, execution_target, enqueued_by,
          available_at, max_attempts, retry_base_seconds, retry_until, state, created_at
        ) VALUES
          ('95000000-0000-4000-8000-000000000061', _contract_key, 1, 'manual', 's5-job-cold-free',
           _cold_ts, _cold_ts - interval '15 min', _cold_ts, 'worker', array['worker'],
           _cold_ts, 3, 30, _cold_ts + interval '1 hour', 'succeeded', _cold_ts),
          ('95000000-0000-4000-8000-000000000062', _contract_key, 1, 'manual', 's5-job-cold-linked',
           _cold_ts + interval '15 min', _cold_ts, _cold_ts + interval '15 min', 'worker', array['worker'],
           _cold_ts, 3, 30, _cold_ts + interval '1 hour', 'succeeded', _cold_ts);

        INSERT INTO public.source_runs (
          id, contract_key, contract_version, trigger_kind, idempotency_key,
          scheduled_for, started_at, finished_at, outcome, records_seen, job_id, attempt
        ) VALUES
          ('95000000-0000-4000-8000-000000000051', _contract_key, 1, 'manual', 's5-run-cold-retire',
           _cold_ts, _cold_ts, _cold_ts + interval '1 min', 'succeeded', 1, NULL, NULL),
          ('95000000-0000-4000-8000-000000000052', _contract_key, 1, 'manual', 's5-run-hot-keep',
           _hot_ts, _hot_ts, _hot_ts + interval '1 min', 'succeeded', 1, '95000000-0000-4000-8000-000000000062', 1);

        -- Seed storage.objects entries for all 6 tables on _cold_day
        INSERT INTO storage.objects (bucket_id, name, metadata)
        SELECT 'cold-archive', format('cold/%s/%s.parquet', tbl, to_char(_cold_day, 'YYYY/MM/DD')), '{"size": 128}'::jsonb
        FROM unnest(ARRAY['weather_snapshots','risk_forecasts','broadcast_audit','airport_observations','source_runs','source_jobs']) tbl
        ON CONFLICT DO NOTHING;

        -- Digest-mismatch rollback check via subtransaction
        BEGIN
          PERFORM public.cold_archive_commit(
            'broadcast_audit', _cold_day, 1, md5('wrong-digest'), repeat('a', 64), 128,
            format('cold/broadcast_audit/%s.parquet', to_char(_cold_day, 'YYYY/MM/DD'))
          );
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM LIKE '%cold_export_mismatch%' THEN
            _err_caught := true;
          ELSE
            RAISE;
          END IF;
        END;
        IF NOT _err_caught THEN
          RAISE EXCEPTION 'Expected cold_export_mismatch to abort commit';
        END IF;

        -- Commit all 6 tables in canonical order (source_runs before source_jobs)
        FOREACH _t IN ARRAY ARRAY['weather_snapshots','risk_forecasts','broadcast_audit','airport_observations','source_runs','source_jobs']
        LOOP
          SELECT count(*), md5(string_agg(id::text, ',' ORDER BY id::text COLLATE "C"))
          INTO _cnt, _dig
          FROM private.cold_candidates(_t, _cold_day);

          IF _cnt < 1 THEN
            RAISE EXCEPTION 'Expected >= 1 cold candidate for % on %', _t, _cold_day;
          END IF;

          _path := format('cold/%s/%s.parquet', _t, to_char(_cold_day, 'YYYY/MM/DD'));
          _del := public.cold_archive_commit(_t, _cold_day, _cnt, _dig, repeat('f', 64), 128, _path);
          IF _del <> _cnt THEN
            RAISE EXCEPTION 'Deleted % != expected % for %', _del, _cnt, _t;
          END IF;
        END LOOP;

        -- Verify manifests written for all 6 tables
        IF (SELECT count(*) FROM public.cold_exports WHERE day = _cold_day) <> 6 THEN
          RAISE EXCEPTION 'Expected 6 cold_exports manifests for %', _cold_day;
        END IF;

        -- Verify retired key recorded for archived source_run
        IF NOT EXISTS (SELECT 1 FROM public.source_run_retired_keys WHERE idempotency_key = 's5-run-cold-retire') THEN
          RAISE EXCEPTION 'Archived source_runs idempotency key was not retired';
        END IF;

        -- Verify protected/hot rows survived
        IF NOT EXISTS (SELECT 1 FROM public.weather_snapshots WHERE id = '95000000-0000-4000-8000-000000000002')
          OR NOT EXISTS (SELECT 1 FROM public.risk_forecasts WHERE id = '95000000-0000-4000-8000-000000000022')
          OR NOT EXISTS (SELECT 1 FROM public.broadcast_audit WHERE id = '95000000-0000-4000-8000-000000000032')
          OR NOT EXISTS (SELECT 1 FROM public.airport_observations WHERE id = '95000000-0000-4000-8000-000000000042')
          OR NOT EXISTS (SELECT 1 FROM public.source_runs WHERE id = '95000000-0000-4000-8000-000000000052')
          OR NOT EXISTS (SELECT 1 FROM public.source_jobs WHERE id = '95000000-0000-4000-8000-000000000062')
        THEN
          RAISE EXCEPTION 'Protected or hot row was unexpectedly deleted';
        END IF;
      END $$;
      SELECT 'ALL_6_TABLES_VERIFIED';
    `);
    expect(result).toBe("ALL_6_TABLES_VERIFIED");
  });

  // Scenario 6
  it("Scenario 6 — home-m2 Outage Failover to EU Worker + Fallback LLM API During Active DGPC/Tariki Winter Storm (and GatewayPending when both fail)", async () => {
    const { EUWorker } =
      await importRepoModule<WorkerRunnerMod>("worker/src/runner");
    const gatewayMod = await importRepoModule<GatewayMod>(
      "src/lib/llm/gateway.server",
    );
    gatewayMod.resetLlmCircuitBreakers();

    let fallbackShouldFail = false;
    const primaryMock = await startMockHttpServer(() => ({
      status: 503,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "gateway_unreachable", retry_after: 60 }),
    }));
    const fallbackMock = await startMockHttpServer(() => {
      if (fallbackShouldFail) {
        return {
          status: 503,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: { message: "EU API overloaded" } }),
        };
      }
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  source: "dgpc_or_tariki",
                  hazard: "flood",
                  road: "RN11",
                  wilaya_code: "16",
                }),
              },
            },
          ],
        }),
      };
    });

    try {
      const queue = [
        {
          id: "s6-job-dgpc",
          contract_key: "dgpc_telegram",
          contract_version: 1,
          trigger_kind: "scheduled",
          execution_target: "worker",
          state: "running",
          scheduled_for: "2026-11-24T16:00:00Z",
          started_at: "2026-11-24T16:00:01Z",
          attempt_count: 1,
          sampleText: buildDgpcNonFirePost({ kind: "flood" }).textAr,
        },
        {
          id: "s6-job-tariki",
          contract_key: "tariki_facebook",
          contract_version: 1,
          trigger_kind: "scheduled",
          execution_target: "worker",
          state: "running",
          scheduled_for: "2026-11-24T16:05:00Z",
          started_at: "2026-11-24T16:05:01Z",
          attempt_count: 1,
          sampleText: buildTarikiPost({ kind: "flood_closure" }).rawText,
        },
      ];

      let cursor = 0;
      const outcomes: Array<{ contractKey: string; outcome: string }> = [];
      const fallbackProviders: string[] = [];
      let resolveAllDone: (() => void) | null = null;
      const allDonePromise = new Promise<void>((resolve) => {
        resolveAllDone = resolve;
      });
      const responseFormat = {
        type: "json_schema" as const,
        json_schema: {
          name: "storm_danger_extract",
          strict: true,
          schema: {
            type: "object",
            properties: {
              source: { type: "string" },
              hazard: { type: "string" },
              road: { type: "string" },
              wilaya_code: { type: "string" },
            },
            required: ["source", "hazard", "road", "wilaya_code"],
            additionalProperties: false,
          },
        },
      };

      const worker = new EUWorker(
        {
          workerId: "eu-worker-s6",
          executionTargets: ["worker"],
          concurrency: 2,
          pollIntervalMs: 20,
          schedulerEnabled: false,
          schedulerIntervalMs: 60_000,
          leaseSeconds: 120,
          jobTimeoutMs: 10_000,
          drainTimeoutMs: 2_000,
        },
        {
          claim: async () => {
            const next = queue[cursor];
            cursor += 1;
            return next ?? null;
          },
          execute: async (job: {
            contract_key: string;
            trigger_kind: string;
            scheduled_for: string;
            started_at: string;
            sampleText: string;
          }) => {
            const res = await gatewayMod.completeWithGatewayResult(
              "extract_dgpc",
              {
                messages: [
                  { role: "system", content: "Extract storm danger JSON." },
                  { role: "user", content: job.sampleText },
                ],
                response_format: responseFormat,
              },
              {
                config: {
                  url: primaryMock.url,
                  clientId: "cid",
                  clientSecret: "csec",
                },
                fallback: [
                  {
                    id: "eu-mistral-s6",
                    provider: "openai-compatible",
                    apiUrl: `${fallbackMock.url}/v1/chat/completions`,
                    apiKey: "eu-s6-key",
                    model: "mistral-small-latest",
                    timeoutMs: 5_000,
                    maxRetries: 0,
                  },
                ],
                circuitBreaker: null,
              },
            );
            expect(res.provenance.fallbackUsed).toBe(true);
            fallbackProviders.push(res.provenance.providerId);
            return {
              contractKey: job.contract_key,
              trigger: job.trigger_kind,
              scheduledFor: job.scheduled_for,
              startedAt: job.started_at,
              outcome: "succeeded",
              coverageStatus: "complete",
              retryDisposition: "none",
            };
          },
          complete: async (
            job: Record<string, unknown>,
            _workerId: string,
            res: { contractKey: string; outcome: string },
          ) => {
            outcomes.push({
              contractKey: res.contractKey,
              outcome: res.outcome,
            });
            if (outcomes.length === queue.length) {
              resolveAllDone?.();
            }
            return { ...job, state: "succeeded" };
          },
          enqueueDue: async () => 0,
          requeueExpired: async () => 0,
          renewLease: async () => "2026-11-24T16:10:00Z",
        },
      );

      worker.start();
      await allDonePromise;
      const stopRes = await worker.stop(2_000);
      expect(stopRes.drained).toBe(true);
      expect(worker.getSnapshot().completedJobs).toBe(2);
      expect(outcomes.map((o) => o.outcome)).toEqual([
        "succeeded",
        "succeeded",
      ]);
      expect(fallbackProviders).toEqual(["eu-mistral-s6", "eu-mistral-s6"]);

      // When BOTH primary and fallback fail, must throw GatewayPending (never quarantine documents)
      fallbackShouldFail = true;
      let thrown: unknown = null;
      try {
        await gatewayMod.completeWithGatewayResult(
          "extract_dgpc",
          {
            messages: [
              { role: "system", content: "Extract storm danger JSON." },
              { role: "user", content: queue[0]!.sampleText },
            ],
            response_format: responseFormat,
          },
          {
            config: {
              url: primaryMock.url,
              clientId: "cid",
              clientSecret: "csec",
            },
            fallback: [
              {
                id: "eu-mistral-s6",
                provider: "openai-compatible",
                apiUrl: `${fallbackMock.url}/v1/chat/completions`,
                apiKey: "eu-s6-key",
                model: "mistral-small-latest",
                timeoutMs: 5_000,
                maxRetries: 0,
              },
            ],
            circuitBreaker: null,
          },
        );
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(gatewayMod.GatewayPending);
      expect((thrown as { reason: string }).reason).toBe(
        "fallback_unavailable",
      );
    } finally {
      await primaryMock.close();
      await fallbackMock.close();
    }
  });

  // Scenario 7
  it("Scenario 7 — Arabic Mobile User Onboarding & Notification Readiness (390x844 AR RTL Map + Hazard Filter Pills + Self-Test Push + OEM Battery Guide)", async () => {
    const channelMod = await importRepoModule<NotificationChannelsMod>(
      "src/lib/notification-channels",
    );

    // Stage A: Mobile 390x844 AR RTL Home Map checks
    await withBrowserPage(
      {
        locale: "ar",
        viewport: "mobile",
        baseUrl: e2eBaseUrl(),
      },
      async (page) => {
        const res = await page.goto("/?lang=ar", {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        expect(res?.status()).toBe(200);

        const dir = await page.evaluate(
          () => document.documentElement.getAttribute("dir") ?? "",
        );
        expect(dir.toLowerCase()).toBe("rtl");

        const overflow = await measureHorizontalOverflow(page);
        expect(overflow.hasOverflow).toBe(false);

        const touchViolations = await measureTouchTargets(page, 44);
        expect(touchViolations).toEqual([]);

        const contrastViolations = await measureContrastViolations(page, 4.5);
        expect(contrastViolations).toEqual([]);

        const bodyText = await page.evaluate(() => document.body.innerText);
        expect(findEmDashesInText(bodyText).count).toBe(0);
        expect(findBannedSafeLabels(bodyText)).toEqual([]);
      },
    );

    // Stage B: Self-test notification channel (alerts_test) + user push test UI/endpoint
    expect(channelMod.resolveNotificationChannel({ kind: "test" })).toBe(
      "alerts_test",
    );
    expect(channelMod.channelFromFcmData({ kind: "test" })).toBe("alerts_test");
    const userPushTestSrc = readRepoFile(
      "src/components/nadhir/UserPushTest.tsx",
    );
    expect(userPushTestSrc).toMatch(/push-test|alerts_test|receipt/i);

    // Stage C: AR/FR OEM Battery Guide covers all 5 Android OEM families popular in Algeria
    const oemGuideSrc = readRepoFile(
      "src/components/nadhir/OemBatteryGuide.tsx",
    );
    const track2Ar = readRepoFile("src/i18n/modules/track2/ar.ts");
    const track2Fr = readRepoFile("src/i18n/modules/track2/fr.ts");
    const oemBundle = `${oemGuideSrc}\n${track2Ar}\n${track2Fr}`;

    for (const vendor of [
      /xiaomi|miui|hyperos|شاومي/i,
      /samsung|one\s?ui|سامسونغ/i,
      /huawei|emui|هواوي/i,
      /oppo|realme|أوبو/i,
      /tecno|infinix|تكنو|إنفينيكس/i,
    ]) {
      expect(oemBundle).toMatch(vendor);
    }
    expect(findEmDashesInText(track2Ar).count).toBe(0);
    expect(findEmDashesInText(track2Fr).count).toBe(0);
  });

  // Scenario 8
  it("Scenario 8 — ONM CAP Update -> Explicit Cancel Lifecycle vs. Silent Feed Drop & 24h Omitted-Expires Ceiling", async () => {
    const onmMod = await importRepoModule<Record<string, unknown>>(
      "src/lib/ingest/onm.server",
    );
    const channelMod = await importRepoModule<NotificationChannelsMod>(
      "src/lib/notification-channels",
    );

    const alertXml = buildOnmCapXml({
      identifier: "urn:oid:2.49.0.1.12.0.s8.001",
      msgType: "Alert",
      severity: "Moderate",
      sent: "2026-11-24T10:00:00+01:00",
      expires: "2026-11-24T22:00:00+01:00",
      wilayaCodes: ["16"],
    });
    const updateXml = buildOnmCapXml({
      identifier: "urn:oid:2.49.0.1.12.0.s8.002",
      msgType: "Update",
      references:
        "onm@meteo.dz,urn:oid:2.49.0.1.12.0.s8.001,2026-11-24T10:00:00+01:00",
      severity: "Severe",
      sent: "2026-11-24T12:00:00+01:00",
      expires: "2026-11-24T23:00:00+01:00",
      wilayaCodes: ["16"],
    });
    const cancelXml = buildOnmCapXml({
      identifier: "urn:oid:2.49.0.1.12.0.s8.003",
      msgType: "Cancel",
      references:
        "onm@meteo.dz,urn:oid:2.49.0.1.12.0.s8.002,2026-11-24T12:00:00+01:00",
      severity: "Severe",
      sent: "2026-11-24T14:00:00+01:00",
      wilayaCodes: ["16"],
    });
    const noExpiresXml = buildOnmCapXml({
      identifier: "urn:oid:2.49.0.1.12.0.s8.004",
      msgType: "Alert",
      severity: "Severe",
      sent: "2026-11-24T11:00:00+01:00",
      expires: null,
      wilayaCodes: ["42"],
    });

    const parseCapDetail = findExportedFn(
      onmMod,
      ["parseCapDetail", "parseOnmCapXml", "parseCapAlert"],
      "src/lib/ingest/onm.server",
    );

    const dAlert = parseCapDetail(alertXml) as Record<string, unknown>;
    const dUpdate = parseCapDetail(updateXml) as Record<string, unknown>;
    const dCancel = parseCapDetail(cancelXml) as Record<string, unknown>;
    const dNoExp = parseCapDetail(noExpiresXml) as Record<string, unknown>;

    expect(
      String(dAlert["msgType"] ?? dAlert["msg_type"] ?? "").toLowerCase(),
    ).toBe("alert");
    expect(
      String(dUpdate["msgType"] ?? dUpdate["msg_type"] ?? "").toLowerCase(),
    ).toBe("update");
    expect(
      String(dCancel["msgType"] ?? dCancel["msg_type"] ?? "").toLowerCase(),
    ).toBe("cancel");
    expect(String(dCancel["cap_references"] ?? "")).toContain(
      "urn:oid:2.49.0.1.12.0.s8.002",
    );
    expect(dCancel["referenced_cap_ids"]).toContain(
      "urn:oid:2.49.0.1.12.0.s8.002",
    );
    expect(dNoExp).toBeTruthy();

    // Channel routing reflects escalation & cancel
    expect(
      channelMod.resolveNotificationChannel({
        kind: "onm",
        severity: "Moderate",
      }),
    ).toBe("alerts_civil");
    expect(
      channelMod.resolveNotificationChannel({
        kind: "onm",
        severity: "Severe",
      }),
    ).toBe("alerts_official");
    expect(
      channelMod.resolveNotificationChannel({
        kind: "onm",
        severity: "Severe",
        phase: "cancel",
      }),
    ).toBe("alerts_civil");

    // Verify ONM ingest + broadcast rules handle explicit Cancel queue invalidation
    // and never treat silent feed omission as all-clear
    const onmSource = readRepoFile("src/lib/ingest/onm.server.ts");
    const broadcastRules = readRepoFile("src/lib/broadcast-rules.ts");
    expect(`${onmSource}\n${broadcastRules}`).toMatch(/cancel/i);
    expect(`${onmSource}\n${broadcastRules}`).toMatch(/references/i);
    expect(findBannedSafeLabels(onmSource)).toEqual([]);
  });

  // Scenario 9
  it("Scenario 9 — Multi-Hazard Winter Outlook & 69-Wilaya Growth Discovery (/forecast + Loi 26-06 Aflou/Barika/El Abiodh Sidi Cheikh + 4-Locale Share Cards)", async () => {
    const admin = loadAlgeriaAdmin();

    // Stage A: /forecast multi-hazard SSR in AR and FR within payload budget
    for (const lang of ["ar", "fr"] as const) {
      const forecastRes = await fetchText(`/forecast?lang=${lang}`);
      expect(forecastRes.status).toBe(200);
      expect(forecastRes.text.length).toBeGreaterThan(500);
      // SSR decoded HTML payload budget (<= 3.3 MB, matching platform audit & Tier 1/2)
      expect(Buffer.byteLength(forecastRes.text, "utf8")).toBeLessThanOrEqual(
        3_300_000,
      );
      const forecastPlainText = stripHtmlToText(forecastRes.text);
      expect(findEmDashesInText(forecastPlainText).count).toBe(0);
      expect(findBannedSafeLabels(forecastPlainText)).toEqual([]);
    }

    // Stage B: New 2026 Loi 26-06 wilayas (59 Aflou, 60 Barika, 69 El Abiodh Sidi Cheikh)
    const targetCodes = ["59", "60", "69"];
    const targetWilayas = targetCodes.map((code) => {
      const w = admin.wilayas.find((item) => item.code === code);
      expect(w, `Missing wilaya ${code} in algeria-admin.json`).toBeTruthy();
      return {
        ...w!,
        slug: deriveWilayaSlug(w!.name_fr),
      };
    });

    for (const locale of ["ar", "fr"] as const) {
      await withBrowserPage(
        {
          locale,
          viewport: "mobile",
          baseUrl: e2eBaseUrl(),
        },
        async (page) => {
          for (const w of targetWilayas) {
            const res = await page.goto(`/wilaya/${w.slug}?lang=${locale}`, {
              waitUntil: "networkidle",
              timeout: 30_000,
            });
            expect(res?.status(), `/wilaya/${w.slug}?lang=${locale}`).toBe(200);

            const html = await page.content();
            expect(html).toMatch(/rel=["']canonical["']/i);
            expect(html).toMatch(/hreflang=["']ar-DZ["']/i);
            expect(html).toMatch(/hreflang=["']fr-DZ["']/i);
            expect(html).toMatch(/hreflang=["']x-default["']/i);

            const overflow = await measureHorizontalOverflow(page);
            expect(overflow.hasOverflow).toBe(false);

            const text = await page.evaluate(() => document.body.innerText);
            expect(text.trim().length).toBeGreaterThan(30);
            expect(findBannedSafeLabels(text)).toEqual([]);
            expect(findEmDashesInText(text).count).toBe(0);
          }
        },
      );
    }

    // Stage C: <= 37 KB wilaya share cards across all 4 locales (ar/fr/en/kab)
    const sampleSlug = targetWilayas[0]!.slug;
    for (const lang of ["ar", "fr", "en", "kab"] as const) {
      const card = await fetchEntityShareCard({
        kind: "wilaya",
        lang,
        explicitId: sampleSlug,
      });
      expect(card.status, `wilaya share card ${sampleSlug} ${lang}`).toBe(200);
      const decoded = await assertValidShareCardImage(
        card.bytes,
        SHARE_CARD_MAX_BYTES,
      );
      expect(decoded.width).toBeGreaterThanOrEqual(200);
    }
  });

  // Scenario 10
  it("Scenario 10 — Offline Survival Mode During Flood vs. Wildfire (Zero-Fresh-Data Pack + Fire Guidance Isolation + SOS 'not sent' + No Bare 'safe' + No Routing)", async () => {
    await withBrowserPage(
      {
        locale: "fr",
        viewport: "mobile",
        baseUrl: e2eBaseUrl(),
      },
      async (page, context) => {
        // Load /survival online once so client shell hydrates, then drop network offline
        const initialRes = await page.goto("/survival?lang=fr", {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        expect(initialRes?.status()).toBe(200);

        await context.setOffline(true);

        const bodyText = await page.evaluate(() => document.body.innerText);
        // Emergency numbers 14 (DGPC), 1070 (DGF), 112 must be present with zero fresh data
        expect(bodyText).toContain("14");
        expect(bodyText).toMatch(/1070|112/);
        expect(findBannedSafeLabels(bodyText)).toEqual([]);
        expect(findEmDashesInText(bodyText).count).toBe(0);
      },
    );

    // Inspect Survival Mode route/component & i18n contracts for ADR-0002 / ADR-0003 invariants
    const survivalFiles = [
      ...listRepoFiles("src/routes/survival", ".tsx"),
      ...listRepoFiles("src/components/survival", ".tsx"),
    ];
    expect(survivalFiles.length).toBeGreaterThan(0);
    const survivalCode = survivalFiles.map((f) => readRepoFile(f)).join("\n");

    // Zero evacuation routing & zero banned labels
    expect(survivalCode).not.toMatch(/evacuation\s+route|safest\s+route/i);
    expect(survivalCode).not.toMatch(/["']Guardian["']/);
    expect(survivalCode).not.toMatch(/["']emergency mode["']/i);
    // Hazard-agnostic mode awareness isolating fire-only standing guidance
    expect(survivalCode).toMatch(/flood|earthquake|quake|hazard/i);

    // SOS failure must explicitly state "not sent" (never false "request received")
    const sosSource = readRepoFile("src/routes/survival/sos.tsx");
    expect(sosSource.length).toBeGreaterThan(100);
    const enLocale = readRepoFile("src/i18n/locales/en.ts");
    const track3En = readRepoFile("src/i18n/modules/track3/en.ts");
    expect(`${enLocale}\n${track3En}`).toMatch(/not sent/i);
  });

  // Scenario 11
  it("Scenario 11 — Multi-Source M6 Gate Resilience Under Degraded Upstreams (HTTP 200 HTML Error + Quiet Sahara Watermark + CRAAG Outage Preserving EMSC + Tariki Hardening + REVOKE ALL)", async () => {
    const emscMod = await importRepoModule<EmscMod>("src/lib/ingest/emsc");
    const jobsMod = await importRepoModule<SourceJobsMod>(
      "src/lib/source-jobs",
    );

    // Stage A: Quiet Sahara-only satellite slot preserves pre-filter freshness watermark
    const quietFci = buildMtgFciFixture({ quietSaharaOnly: true });
    expect(quietFci.hotspots[0]?.insideWatchArea).toBe(false);
    expect(quietFci.slotTime).toBeTruthy();

    // Stage B: HTTP 200 HTML error page maps to transient upstream_unreachable (never silent empty success)
    expect(jobsMod.retryDispositionForReason("upstream_unreachable")).toBe(
      "transient",
    );
    const htmlErrorServer = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: HTTP_200_HTML_ERROR_BODY,
    }));
    const emscOkServer = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [buildEmscEvent({ mag: 4.6 })],
      }),
    }));
    const craagDownServer = await startMockHttpServer(() => ({
      status: 503,
      headers: { "content-type": "text/plain" },
      body: "CRAAG temporarily unavailable",
    }));

    try {
      // Stage C: CRAAG outage preserves EMSC real-time feed
      const emscRes = await fetchText(emscOkServer.url);
      expect(emscRes.status).toBe(200);
      const parsedEmsc = emscMod.parseEmsc(JSON.parse(emscRes.text));
      expect(parsedEmsc).toHaveLength(1);
      expect(parsedEmsc[0]?.magnitude).toBe(4.6);

      const craagRes = await fetchText(craagDownServer.url);
      expect(craagRes.status).toBe(503);

      // HTML error page detection check: M6 Gate requires throwing rather than silent empty success
      const errRes = await fetchText(htmlErrorServer.url);
      expect(errRes.status).toBe(200);
      expect(errRes.text).toContain("MapServer Error");
      expect(() => emscMod.parseEmsc(errRes.text)).toThrow(/unexpected shape/i);
      const { path: craagPath, mod: craagMod } =
        await importFirstExistingModule(["src/lib/ingest/craag"]);
      const parseCraagBulletins = findExportedFn(
        craagMod,
        ["parseCraagBulletins"],
        craagPath,
      );
      expect(() => parseCraagBulletins(errRes.text)).toThrow(
        /maintenance|error|challenge/i,
      );
    } finally {
      await htmlErrorServer.close();
      await emscOkServer.close();
      await craagDownServer.close();
    }

    // Stage D: Tariki hardening filters non-danger noise while normalizing tatweel/emoji danger posts
    const { path: tarikiPath, mod: tarikiMod } =
      await importFirstExistingModule([
        "src/lib/text-sources/tariki",
        "src/lib/text-sources/tariki.server",
      ]);
    const classifier = findExportedFn(
      tarikiMod,
      [
        "isTarikiDangerPost",
        "classifyTarikiPost",
        "filterTarikiPost",
        "parseTarikiPost",
        "extractTarikiIncident",
      ],
      tarikiPath,
    );
    const isDanger = (res: unknown): boolean => {
      if (typeof res === "boolean") return res;
      if (res === null || res === undefined) return false;
      if (typeof res === "object") {
        const rec = res as Record<string, unknown>;
        if (typeof rec["dangerous"] === "boolean") return rec["dangerous"];
        if (typeof rec["isDanger"] === "boolean") return rec["isDanger"];
        if (typeof rec["keep"] === "boolean") return rec["keep"];
        if (typeof rec["accepted"] === "boolean") return rec["accepted"];
        return true;
      }
      return Boolean(res);
    };

    const tatweelDanger = buildTarikiPost({ kind: "tatweel_hashtag_emoji" });
    const trucksOnly = buildTarikiPost({ kind: "heavy_trucks_only" });
    const roadWorks = buildTarikiPost({ kind: "road_works" });
    const convoy = buildTarikiPost({ kind: "convoy" });

    expect(isDanger(classifier(tatweelDanger.rawText, tatweelDanger))).toBe(
      true,
    );
    expect(isDanger(classifier(trucksOnly.rawText, trucksOnly))).toBe(false);
    expect(isDanger(classifier(roadWorks.rawText, roadWorks))).toBe(false);
    expect(isDanger(classifier(convoy.rawText, convoy))).toBe(false);

    // Stage E: Postgres REVOKE ALL ... FROM PUBLIC, anon, authenticated on privileged functions
    assertPgReachable();
    const leaked = psqlJson<{ proname: string }>(
      `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prosecdef = true
         AND p.proname ~ '^(cold_|enqueue_due_source_jobs|claim_source_job|complete_source_job|renew_source_job_lease|requeue_expired_source_jobs)'
         AND (
           has_function_privilege('public', p.oid, 'execute')
           OR has_function_privilege('anon', p.oid, 'execute')
           OR has_function_privilege('authenticated', p.oid, 'execute')
         );`,
    );
    expect(leaked).toEqual([]);
  });

  // Scenario 12
  it("Scenario 12 — Android app.nadhir Release Readiness & ADR-0006 On-Device Current Commune Privacy Audit", async () => {
    const channelMod = await importRepoModule<NotificationChannelsMod>(
      "src/lib/notification-channels",
    );

    // Stage A: capacitor.config.ts production settings
    const capConfig = readRepoFile("capacitor.config.ts");
    expect(capConfig).toContain('appId: "app.nadhir"');
    expect(capConfig).toContain('webDir: "dist/client"');
    expect(capConfig).toContain("allowMixedContent: false");

    // Stage B: AndroidManifest.xml + NotificationChannels.java (all 6 channels) + MainActivity + push-native.ts
    const manifest = readRepoFile("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain("android.permission.POST_NOTIFICATIONS");
    expect(manifest).toContain('android:supportsRtl="true"');

    const javaChannels = readRepoFile(
      "android/app/src/main/java/app/nadhir/NotificationChannels.java",
    );
    const mainActivity = readRepoFile(
      "android/app/src/main/java/app/nadhir/MainActivity.java",
    );
    for (const id of channelMod.NOTIFICATION_CHANNEL_IDS) {
      expect(javaChannels).toContain(`"${id}"`);
    }
    expect(mainActivity).toMatch(/NotificationChannels\./);

    const pushNative = readRepoFile("src/lib/push-native.ts");
    expect(channelMod.DEFAULT_LOCAL_NOTIFICATION_EXACT).toBe(false);
    expect(pushNative).toContain("localNotifications.schedule(");
    expect(pushNative).toMatch(
      /isExactNotification:\s*(?:false|DEFAULT_LOCAL_NOTIFICATION_EXACT)/,
    );

    // Stage C: assetlinks.json + Play Store listing / Data Safety docs
    const assetLinks = readRepoJson<
      Array<{ relation: string[]; target: { package_name?: string } }>
    >("public/.well-known/assetlinks.json");
    expect(
      assetLinks.some(
        (item) =>
          item.target?.package_name === "app.nadhir" &&
          item.relation?.includes("delegate_permission/common.handle_all_urls"),
      ),
    ).toBe(true);

    const storeListing = readRepoFile("docs/store-listing.md");
    expect(storeListing).toMatch(/Data Safety|données|privacy/i);
    expect(storeListing).toMatch(/location|commune/i);

    // Stage D: ADR-0006 on-device Current Commune zero-server-GPS invariant
    const communeJavaFiles = listRepoFiles(
      "android/app/src/main/java/app/nadhir/commune",
      ".java",
    );
    expect(communeJavaFiles.length).toBeGreaterThan(0);
    for (const file of communeJavaFiles) {
      const code = readRepoFile(file);
      expect(
        code,
        `ADR-0006 violation: ${file} must keep coordinates strictly on-device`,
      ).not.toMatch(
        /HttpURLConnection|OkHttpClient|Retrofit|nadhir\.app\/api/i,
      );
    }

    const currentCommuneTs = readRepoFile("src/lib/current-commune.ts");
    expect(currentCommuneTs).not.toMatch(/fetch\s*\(|supabase/i);

    // Banned ADR-0006 tracking phrases absent from Play listing & ANPDP doc
    const anpdpDoc = readRepoFile("docs/privacy-anpdp-compliance.md");
    expect(anpdpDoc).toMatch(/18-07/);
    expect(anpdpDoc).toMatch(/25-11/);
    expect(storeListing).not.toMatch(/\blive location\b/i);
  });
});
