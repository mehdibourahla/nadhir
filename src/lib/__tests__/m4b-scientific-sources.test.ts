import { readFileSync } from "node:fs";
import { writeArrayBuffer } from "geotiff";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {},
}));
vi.mock("@/lib/source-archive.server", () => ({
  archivedFetch: vi.fn(),
  ArchiveFailure: class ArchiveFailure extends Error {
    constructor(code: string, options?: ErrorOptions) {
      super(`Source archive ${code}`, options);
      this.name = "ArchiveFailure";
    }
  },
}));

import {
  CLMS_ATTRIBUTION,
  CLMS_SOURCE_KEY,
  parseClmsGeoTiff,
  parseClmsJson,
} from "@/lib/ingest/clms";
import { runClmsNdviSwiSource } from "@/lib/ingest/clms.server";
import {
  GHSL_ATTRIBUTION,
  GHSL_BANNED_LABELS,
  GHSL_SOURCE_KEY,
  parseGhslGeoTiff,
  parseGhslJson,
} from "@/lib/ingest/ghsl";
import { runGhslPopulationSource } from "@/lib/ingest/ghsl.server";
import {
  GWIS_ATTRIBUTION,
  GWIS_LICENCE,
  GWIS_SOURCE_KEY,
  parseGwisGeoJson,
} from "@/lib/ingest/gwis";
import { runGwisBurnedAreasSource } from "@/lib/ingest/gwis.server";
import {
  buildCanonicalFciNaturalKey,
  MTG_FCI_PUSH_SOURCE_KEY,
  parseMtgFciPushJson,
  type MtgFciPushDeliveryAudit,
  type MtgFciPushDetectionRow,
} from "@/lib/ingest/mtg-fci-push";
import { runMtgFciPushSource } from "@/lib/ingest/mtg-fci-push.server";
import {
  MTG_LIGHTNING_ATTRIBUTION,
  MTG_LIGHTNING_SOURCE_KEY,
  parseMtgLightningJson,
} from "@/lib/ingest/mtg-lightning";
import { runMtgLightningSource } from "@/lib/ingest/mtg-lightning.server";
import { ArchiveFailure } from "@/lib/source-archive.server";
import type { ClaimedSourceJob } from "@/lib/source-jobs";

import clmsEmpty from "./fixtures/clms-ndvi-swi-empty-window.json";
import clmsSample from "./fixtures/clms-ndvi-swi-sample.json";
import clmsSchemaError from "./fixtures/clms-ndvi-swi-schema-error.json";
import ghslEmpty from "./fixtures/ghsl-population-empty-window.json";
import ghslSample from "./fixtures/ghsl-population-sample.json";
import ghslSchemaError from "./fixtures/ghsl-population-schema-error.json";
import gwisSchemaError from "./fixtures/gwis-burned-areas-schema-error.json";
import mtgFciEmpty from "./fixtures/mtg-fci-push-empty-window.json";
import mtgFciL1cError from "./fixtures/mtg-fci-push-l1c-0665-error.json";
import mtgFciSample from "./fixtures/mtg-fci-push-sample.json";
import mtgLightningEmpty from "./fixtures/mtg-lightning-empty-window.json";
import mtgLightningSample from "./fixtures/mtg-lightning-sample.json";
import mtgLightningSchemaError from "./fixtures/mtg-lightning-schema-error.json";

const readFixtureText = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const gwisSample = JSON.parse(
  readFixtureText("gwis-burned-areas-sample.geojson"),
) as Record<string, unknown>;
const gwisEmpty = JSON.parse(
  readFixtureText("gwis-burned-areas-empty-window.geojson"),
) as Record<string, unknown>;

const mtgFciHtmlError = readFixtureText(
  "mtg-fci-push-upstream-html-error.html",
);
const mtgLightningHtmlError = readFixtureText(
  "mtg-lightning-upstream-html-error.html",
);
const gwisHtmlError = readFixtureText(
  "gwis-burned-areas-upstream-html-error.html",
);
const clmsHtmlError = readFixtureText("clms-ndvi-swi-upstream-html-error.html");
const ghslHtmlError = readFixtureText(
  "ghsl-population-upstream-html-error.html",
);

const sampleCommunes = [
  { id: "c-alger", code: "1601", lat: 36.7529, lon: 3.042 },
  { id: "c-tizi", code: "1501", lat: 36.7118, lon: 4.0459 },
  { id: "c-bejaia", code: "0601", lat: 36.7509, lon: 5.0567 },
  { id: "c-tam", code: "1101", lat: 22.79, lon: 5.52 },
];

function makeJob(
  contractKey:
    | "mtg_fci_push"
    | "mtg_lightning"
    | "gwis_burned_areas"
    | "clms_ndvi_swi"
    | "ghsl_population",
  trigger: "scheduled" | "replay" = "scheduled",
  overrides: Partial<ClaimedSourceJob> = {},
): ClaimedSourceJob {
  return {
    id: `00000000-0000-4000-8000-${contractKey.slice(0, 12).padEnd(12, "0")}`,
    contract_key: contractKey,
    contract_version: 1,
    trigger_kind: trigger,
    execution_target: "worker",
    state: "running",
    scheduled_for: "2026-08-15T13:25:00Z",
    started_at: "2026-08-15T13:25:02Z",
    available_at: "2026-08-15T13:25:00Z",
    data_from: "2026-08-15T13:15:00Z",
    data_through: "2026-08-15T13:25:00Z",
    attempt_count: 1,
    max_attempts: 3,
    retry_base_seconds: 30,
    retry_until: "2026-08-15T13:55:00Z",
    dispatched_at: "2026-08-15T13:25:01Z",
    enqueued_by: ["scheduler"],
    finished_at: null,
    gap_id: null,
    idempotency_key: `${contractKey}:${trigger}:2026-08-15T13:25:00Z`,
    last_error_at: null,
    last_public_reason_code: null,
    created_at: "2026-08-15T13:25:00Z",
    updated_at: "2026-08-15T13:25:02Z",
    ...overrides,
  };
}

async function buildGeoTiff(
  values: Uint8Array | Float32Array,
  width: number,
  height: number,
): Promise<ArrayBuffer> {
  // Covers northern Algeria: west=2.5, north=37.2, pixel scale 1.0 deg
  return writeArrayBuffer(values, {
    width,
    height,
    ModelPixelScale: [1.0, 1.0, 0],
    ModelTiepoint: [0, 0, 0, 2.5, 37.2, 0],
    GTModelTypeGeoKey: 2,
    GeographicTypeGeoKey: 4326,
  });
}

describe("M4B - MTG FCI L2P FRP Push Adapter", () => {
  it("parses L2P FRP push feed with exact WFS-compatible natural_key and push provenance", () => {
    const parsed = parseMtgFciPushJson(mtgFciSample, {
      receivedAt: "2026-08-15T13:23:10Z",
    });
    expect(parsed.sourceKey).toBe(MTG_FCI_PUSH_SOURCE_KEY);
    expect(parsed.upstreamPublishedAt).toBe("2026-08-15T13:22:30.000Z");
    expect(parsed.latencySeconds).toBe(190);
    expect(parsed.pixelsSeen).toBe(4);
    expect(parsed.pixelsOutsideWatchBox).toBe(1);
    expect(parsed.pixelsFilteredWatchArea).toBe(1);
    expect(parsed.rows).toHaveLength(2);

    const first = parsed.rows[0]!;
    expect(first).toMatchObject({
      source: "fci",
      sensor: "FCI",
      lat: 36.71234,
      lon: 4.05123,
      confidence_raw: 0.86,
      frp_mw: 48.6,
      daynight: "D",
      intake_channel: "push",
      push_product_id: "EO:EUM:DAT:0662:MTG-I1-FCI-L2P-FRP-20260815T132000Z",
      push_received_at: "2026-08-15T13:23:10.000Z",
    });
    expect(first.natural_key).toBe(
      buildCanonicalFciNaturalKey(36.71234, 4.05123, "2026-08-15T13:20:00Z"),
    );
    expect(first.natural_key).toBe(
      "fci:FCI:36.71234:4.05123:2026-08-15T13:20:00Z",
    );
  });

  it("advances pre-filter watermark on quiet watch-area slot without calling detection upsert", async () => {
    const upsertDetections = vi.fn();
    const recordDelivery = vi.fn().mockResolvedValue(undefined);
    const result = await runMtgFciPushSource(
      makeJob("mtg_fci_push"),
      {
        feedUrl: () => "https://push.eumetsat.example/fci",
        pushToken: () => "secret-push-token",
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mtgFciEmpty), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
        upsertDetections,
        recordDelivery,
      },
      () => Date.parse("2026-08-15T03:13:00Z"),
    );

    expect(result.outcome).toBe("succeeded");
    expect(result.upstreamPublishedAt).toBe("2026-08-15T03:12:40.000Z");
    expect(result.recordsInserted).toBe(0);
    expect(result.qualityChecks).toMatchObject({
      empty_slot: true,
      fallback_contract: "fci",
      sub_5min_target_met: true,
    });
    expect(upsertDetections).not.toHaveBeenCalled();
    expect(recordDelivery).toHaveBeenCalledOnce();
  });

  it("hard rejects L1c EO:EUM:DAT:0665, eumetsat_fci, and PR #31 fields as schema_invalid (permanent)", async () => {
    const res = await runMtgFciPushSource(makeJob("mtg_fci_push"), {
      feedUrl: () => "https://push.eumetsat.example/fci",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mtgFciL1cError), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
      upsertDetections: vi.fn(),
      recordDelivery: vi.fn(),
    });
    expect(res.outcome).toBe("failed");
    expect(res.publicReasonCode).toBe("schema_invalid");
    expect(res.retryDisposition).toBe("permanent");

    expect(() =>
      parseMtgFciPushJson({
        ...mtgFciSample,
        spread_bearing_deg: 145,
      }),
    ).toThrow(/PR #31/i);
    expect(() =>
      parseMtgFciPushJson({
        ...mtgFciSample,
        logistic_calibration: 0.72,
      }),
    ).toThrow(/PR #31/i);
  });

  it("maps HTTP 200 comment-prefixed octet-stream HTML error to upstream_unreachable (transient)", async () => {
    const res = await runMtgFciPushSource(makeJob("mtg_fci_push"), {
      feedUrl: () => "https://push.eumetsat.example/fci",
      fetch: vi.fn().mockResolvedValue(
        new Response(mtgFciHtmlError, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      ),
      upsertDetections: vi.fn(),
      recordDelivery: vi.fn(),
    });
    expect(res.outcome).toBe("failed");
    expect(res.publicReasonCode).toBe("upstream_unreachable");
    expect(res.retryDisposition).toBe("transient");
  });

  it("supports idempotent and out-of-order replay with zero duplicate natural_keys", async () => {
    const stored = new Map<string, MtgFciPushDetectionRow>();
    const deliveries = new Map<string, MtgFciPushDeliveryAudit>();

    const deps = (payload: unknown) => ({
      feedUrl: () => "https://push.eumetsat.example/fci",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
      upsertDetections: async (rows: MtgFciPushDetectionRow[]) => {
        let added = 0;
        for (const r of rows) {
          if (!stored.has(r.natural_key)) {
            stored.set(r.natural_key, r);
            added += 1;
          }
        }
        return added;
      },
      recordDelivery: async (audit: MtgFciPushDeliveryAudit) => {
        deliveries.set(audit.productId, audit);
      },
    });

    // Replay same slot twice
    const replayJob = makeJob("mtg_fci_push", "replay");
    const r1 = await runMtgFciPushSource(replayJob, deps(mtgFciSample));
    const r2 = await runMtgFciPushSource(replayJob, deps(mtgFciSample));
    expect(r1.outcome).toBe("succeeded");
    expect(r2.outcome).toBe("succeeded");
    expect(stored.size).toBe(2);
    expect(deliveries.size).toBe(1);

    // Out-of-order older slot ingested after newer slot
    const olderPayload = {
      ...mtgFciSample,
      product_id: "EO:EUM:DAT:0662:MTG-I1-FCI-L2P-FRP-20260815T131000Z",
      slot_time: "2026-08-15T13:10:00Z",
      published_at: "2026-08-15T13:12:30Z",
      features: mtgFciSample.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          Datetime: "2026-08-15 13:10:42",
          time: "2026-08-15T13:10:00Z",
        },
      })),
    };
    const olderJob = makeJob("mtg_fci_push", "replay", {
      data_from: "2026-08-15T13:05:00Z",
      data_through: "2026-08-15T13:15:00Z",
    });
    const r3 = await runMtgFciPushSource(olderJob, deps(olderPayload));
    expect(r3.outcome).toBe("succeeded");
    expect(stored.size).toBe(4);
    expect(deliveries.size).toBe(2);
  });

  it("always re-throws ArchiveFailure", async () => {
    await expect(
      runMtgFciPushSource(makeJob("mtg_fci_push"), {
        feedUrl: () => "https://push.eumetsat.example/fci",
        fetch: vi.fn().mockRejectedValue(new ArchiveFailure("upload_failed")),
      }),
    ).rejects.toThrow(ArchiveFailure);
  });
});

describe("M4B - MTG Lightning Imager L2 Adapter", () => {
  it("parses L2 flashes across full Algeria (north + Sahara) with isWildfire = false", () => {
    const parsed = parseMtgLightningJson(mtgLightningSample);
    expect(parsed.sourceKey).toBe(MTG_LIGHTNING_SOURCE_KEY);
    expect(parsed.upstreamPublishedAt).toBe("2026-09-18T16:14:20.000Z");
    expect(parsed.flashesSeen).toBe(3);
    expect(parsed.flashesInAlgeria).toBe(2);
    expect(parsed.flashesOutsideAlgeria).toBe(1);
    expect(parsed.observations[0]).toMatchObject({
      observationKind: "lightning_observation",
      isWildfire: false,
      productType: "L2-LFL",
      attribution: MTG_LIGHTNING_ATTRIBUTION,
    });
    expect(parsed.observations[1]).toMatchObject({
      productType: "L2-LGR",
      lat: 22.811,
      lon: 5.512,
    });
  });

  it("advances pre-filter watermark on quiet-in-Algeria slot without upserting", async () => {
    const upsert = vi.fn();
    const res = await runMtgLightningSource(makeJob("mtg_lightning"), {
      feedUrl: () => "https://li.eumetsat.example/l2",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mtgLightningEmpty), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
      communes: async () => sampleCommunes,
      upsert,
    });
    expect(res.outcome).toBe("succeeded");
    expect(res.upstreamPublishedAt).toBe("2026-09-18T05:05:00.000Z");
    expect(res.qualityChecks).toMatchObject({
      is_wildfire: false,
      quiet_slot: true,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects is_wildfire = true as schema_invalid and HTML error as upstream_unreachable", async () => {
    const badSchema = await runMtgLightningSource(makeJob("mtg_lightning"), {
      feedUrl: () => "https://li.eumetsat.example/l2",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mtgLightningSchemaError), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    expect(badSchema.publicReasonCode).toBe("schema_invalid");
    expect(badSchema.retryDisposition).toBe("permanent");

    const htmlErr = await runMtgLightningSource(makeJob("mtg_lightning"), {
      feedUrl: () => "https://li.eumetsat.example/l2",
      fetch: vi.fn().mockResolvedValue(
        new Response(mtgLightningHtmlError, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    });
    expect(htmlErr.publicReasonCode).toBe("upstream_unreachable");
    expect(htmlErr.retryDisposition).toBe("transient");
  });

  it("re-throws ArchiveFailure and resolves communes idempotently on replay", async () => {
    await expect(
      runMtgLightningSource(makeJob("mtg_lightning"), {
        feedUrl: () => "https://li.eumetsat.example/l2",
        fetch: vi.fn().mockRejectedValue(new ArchiveFailure("catalog_failed")),
      }),
    ).rejects.toThrow(ArchiveFailure);

    const rowsByKey = new Map<string, unknown>();
    const replayJob = makeJob("mtg_lightning", "replay", {
      data_from: "2026-09-18T16:10:00Z",
      data_through: "2026-09-18T16:15:00Z",
    });
    const runOnce = () =>
      runMtgLightningSource(replayJob, {
        feedUrl: () => "https://li.eumetsat.example/l2",
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mtgLightningSample), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
        communes: async () => sampleCommunes,
        upsert: async (rows) => {
          for (const r of rows) {
            rowsByKey.set(`${r.source_key}:${r.observed_at}:${r.flash_id}`, r);
          }
          return rows.length;
        },
      });
    const a = await runOnce();
    const b = await runOnce();
    expect(a.outcome).toBe("succeeded");
    expect(b.outcome).toBe("succeeded");
    expect(rowsByKey.size).toBe(2);
  });
});

describe("M4B - GWIS Burned Areas Adapter", () => {
  it("parses Polygon and MultiPolygon perimeters with plain lat/lon centroids and honesty flags", () => {
    const parsed = parseGwisGeoJson(gwisSample);
    expect(parsed.sourceKey).toBe(GWIS_SOURCE_KEY);
    expect(parsed.upstreamPublishedAt).toBe("2026-08-18T18:00:00.000Z");
    expect(parsed.featuresSeen).toBe(3);
    expect(parsed.featuresInAlgeria).toBe(2);
    expect(parsed.featuresOutsideAlgeria).toBe(1);
    expect(parsed.burnedAreas[0]).toMatchObject({
      eventId: "gwis-2026-dz-0142",
      estimationBasis: "firms_derived_estimate",
      isOfficialConfirmation: false,
      isOpticalScar: false,
      licence: GWIS_LICENCE,
      lat: 36.68,
      lon: 4.72,
      attribution: GWIS_ATTRIBUTION,
    });
    expect(parsed.burnedAreas[1]?.perimeterGeojson.type).toBe("MultiPolygon");
  });

  it("rejects Point burn circles, official confirmation claims, optical scar claims, fuel recovery curves, and wrong licence", async () => {
    const badCircle = await runGwisBurnedAreasSource(
      makeJob("gwis_burned_areas"),
      {
        feedUrl: () => "https://gwis.jrc.example/nrt",
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(gwisSchemaError), {
            status: 200,
            headers: { "content-type": "application/geo+json" },
          }),
        ),
      },
    );
    expect(badCircle.publicReasonCode).toBe("schema_invalid");
    expect(badCircle.retryDisposition).toBe("permanent");

    expect(() =>
      parseGwisGeoJson({
        ...gwisSample,
        is_official_confirmation: true,
      }),
    ).toThrow(/official confirmation/i);
    expect(() =>
      parseGwisGeoJson({
        ...gwisSample,
        is_optical_scar: true,
      }),
    ).toThrow(/optical burn scar/i);
    expect(() =>
      parseGwisGeoJson({
        ...gwisSample,
        fuel_recovery_curve: [0.1, 0.4, 0.8],
      }),
    ).toThrow(/PR #31/i);

    const wrongLicence = await runGwisBurnedAreasSource(
      makeJob("gwis_burned_areas"),
      {
        feedUrl: () => "https://gwis.jrc.example/nrt",
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ ...gwisEmpty, licence: "All Rights Reserved" }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        ),
      },
    );
    expect(wrongLicence.publicReasonCode).toBe("licence_invalid");
    expect(wrongLicence.retryDisposition).toBe("permanent");
  });

  it("handles empty winter window, XML OWS error body, and ArchiveFailure cleanly", async () => {
    const upsert = vi.fn();
    const emptyRes = await runGwisBurnedAreasSource(
      makeJob("gwis_burned_areas"),
      {
        feedUrl: () => "https://gwis.jrc.example/nrt",
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(gwisEmpty), {
            status: 200,
            headers: { "content-type": "application/geo+json" },
          }),
        ),
        upsert,
      },
    );
    expect(emptyRes.outcome).toBe("succeeded");
    expect(emptyRes.upstreamPublishedAt).toBe("2026-01-12T12:00:00.000Z");
    expect(upsert).not.toHaveBeenCalled();

    const xmlErr = await runGwisBurnedAreasSource(
      makeJob("gwis_burned_areas"),
      {
        feedUrl: () => "https://gwis.jrc.example/nrt",
        fetch: vi.fn().mockResolvedValue(
          new Response(gwisHtmlError, {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
        ),
      },
    );
    expect(xmlErr.publicReasonCode).toBe("upstream_unreachable");
    expect(xmlErr.retryDisposition).toBe("transient");

    await expect(
      runGwisBurnedAreasSource(makeJob("gwis_burned_areas"), {
        feedUrl: () => "https://gwis.jrc.example/nrt",
        fetch: vi.fn().mockRejectedValue(new ArchiveFailure("size_exceeded")),
      }),
    ).rejects.toThrow(ArchiveFailure);
  });
});

describe("M4B - CLMS Global NDVI v3 / SWI v4 Adapter (JSON + GeoTIFF)", () => {
  it("parses JSON commune summaries, skipping QA-masked and outside-Algeria entries", () => {
    const parsed = parseClmsJson(clmsSample);
    expect(parsed.sourceKey).toBe(CLMS_SOURCE_KEY);
    expect(parsed.upstreamPublishedAt).toBe("2026-10-14T06:00:00.000Z");
    expect(parsed.entriesSkippedQa).toBe(1);
    expect(parsed.entriesOutsideAlgeria).toBe(1);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({
      productVersion: "ndvi_v3_300m",
      isCalibratedFuel: false,
      communeCode: "1501",
      ndviValue: 0.442,
      attribution: CLMS_ATTRIBUTION,
    });
  });

  it("decodes real NDVI Uint8 DN and SWI Float32 GeoTIFF rasters via geotiff fromArrayBuffer", async () => {
    // 2x2 Uint8 NDVI DN: 145 -> 145*0.004-0.08 = 0.50, 254 -> QA/nodata skipped, 120 -> 0.40, 255 -> nodata
    const ndviTiff = await buildGeoTiff(
      new Uint8Array([145, 254, 120, 255]),
      2,
      2,
    );
    const parsedNdvi = await parseClmsGeoTiff(ndviTiff, {
      productVersion: "ndvi_v3_300m",
      observedAt: "2026-10-11",
      publishedAt: "2026-10-14T06:00:00Z",
      communes: sampleCommunes,
    });
    expect(parsedNdvi.entriesSkippedQa).toBe(2);
    expect(parsedNdvi.records.length).toBeGreaterThan(0);
    expect(parsedNdvi.records.every((r) => !r.isCalibratedFuel)).toBe(true);
    expect(
      parsedNdvi.records.every(
        (r) => r.ndviValue !== null && r.ndviValue >= -1 && r.ndviValue <= 1,
      ),
    ).toBe(true);

    // 2x2 Float32 SWI with NaN nodata sentinel (allowed in GeoTIFF, rejected in JSON)
    const swiTiff = await buildGeoTiff(
      new Float32Array([42.5, Number.NaN, 38.0, -9999]),
      2,
      2,
    );
    const parsedSwi = await parseClmsGeoTiff(swiTiff, {
      productVersion: "swi_v4_1km",
      observedAt: "2026-10-21",
      publishedAt: "2026-10-24T06:00:00Z",
      communes: sampleCommunes,
    });
    expect(parsedSwi.entriesSkippedQa).toBe(2);
    expect(parsedSwi.records.length).toBeGreaterThan(0);
    expect(
      parsedSwi.records.every(
        (r) => r.swiValue !== null && r.swiValue >= 0 && r.swiValue <= 100,
      ),
    ).toBe(true);
  });

  it("rejects calibrated-fuel claim, JSON NaN, out-of-range NDVI/SWI, and handles HTML error + empty window", async () => {
    const schemaErr = await runClmsNdviSwiSource(makeJob("clms_ndvi_swi"), {
      feedUrl: () => "https://clms.copernicus.example/odata",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(clmsSchemaError), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    expect(schemaErr.publicReasonCode).toBe("schema_invalid");
    expect(schemaErr.retryDisposition).toBe("permanent");

    expect(() =>
      parseClmsJson({
        product_version: "ndvi_v3_300m",
        observed_at: "2026-10-11",
        published_at: "2026-10-14T06:00:00Z",
        communes: [
          {
            commune_code: "1501",
            wilaya_code: "15",
            lat: 36.71,
            lon: 4.05,
            ndvi_value: Number.NaN,
          },
        ],
      }),
    ).toThrow(/schema invalid/i);

    const upsert = vi.fn();
    const emptyRes = await runClmsNdviSwiSource(makeJob("clms_ndvi_swi"), {
      feedUrl: () => "https://clms.copernicus.example/odata",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(clmsEmpty), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
      upsert,
    });
    expect(emptyRes.outcome).toBe("succeeded");
    expect(emptyRes.upstreamPublishedAt).toBe("2026-10-24T06:00:00.000Z");
    expect(upsert).not.toHaveBeenCalled();

    const htmlErr = await runClmsNdviSwiSource(makeJob("clms_ndvi_swi"), {
      feedUrl: () => "https://clms.copernicus.example/odata",
      fetch: vi.fn().mockResolvedValue(
        new Response(clmsHtmlError, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      ),
    });
    expect(htmlErr.publicReasonCode).toBe("upstream_unreachable");
    expect(htmlErr.retryDisposition).toBe("transient");

    await expect(
      runClmsNdviSwiSource(makeJob("clms_ndvi_swi"), {
        feedUrl: () => "https://clms.copernicus.example/odata",
        fetch: vi.fn().mockRejectedValue(new ArchiveFailure("upload_failed")),
      }),
    ).rejects.toThrow(ArchiveFailure);
  });
});

describe("M4B - GHSL GHS-POP R2023A Adapter (Population-Conserving JSON + GeoTIFF)", () => {
  it("parses population-conserving commune exposure with modeled_residents label", () => {
    const parsed = parseGhslJson(ghslSample);
    expect(parsed.sourceKey).toBe(GHSL_SOURCE_KEY);
    expect(parsed.publishedAt).toBe("2025-01-15T00:00:00.000Z");
    expect(parsed.records).toHaveLength(2);
    expect(parsed.totalSourceResidents).toBe(211650);
    expect(parsed.totalAggregatedResidents).toBe(211650);
    expect(parsed.tileConservationDelta).toBe(0);
    expect(parsed.records[0]).toMatchObject({
      exposureLabel: "modeled_residents",
      communeCode: "1601",
      modeledResidents: 125400,
      conservationDelta: 0,
      attribution: GHSL_ATTRIBUTION,
    });
  });

  it("conserves population exactly across real Float32 GeoTIFF raster cells", async () => {
    // 2x2 Float32 grid: 1500.5, -200 (nodata), 3200.25, NaN (nodata) -> total = 4700.75
    const tiff = await buildGeoTiff(
      new Float32Array([1500.5, -200, 3200.25, Number.NaN]),
      2,
      2,
    );
    const parsed = await parseGhslGeoTiff(tiff, {
      epochYear: 2025,
      resolutionM: 100,
      publishedAt: "2025-01-15T00:00:00Z",
      communes: sampleCommunes,
    });
    expect(parsed.cellsNodata).toBe(2);
    expect(parsed.totalSourceResidents).toBe(4700.75);
    expect(parsed.totalAggregatedResidents).toBe(4700.75);
    expect(parsed.tileConservationDelta).toBe(0);
    expect(
      parsed.records.every((r) => r.exposureLabel === "modeled_residents"),
    ).toBe(true);
  });

  it("rejects all banned occupancy/threatened labels and non-conserving totals", async () => {
    for (const banned of GHSL_BANNED_LABELS) {
      expect(() =>
        parseGhslJson({
          ...ghslSample,
          exposure_label: banned,
        }),
      ).toThrow(/schema invalid/i);
    }

    const schemaErr = await runGhslPopulationSource(
      makeJob("ghsl_population"),
      {
        feedUrl: () => "https://ghsl.jrc.example/tile",
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(ghslSchemaError), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      },
    );
    expect(schemaErr.publicReasonCode).toBe("schema_invalid");
    expect(schemaErr.retryDisposition).toBe("permanent");

    // Non-conserving tile total drift > 0.5%
    expect(() =>
      parseGhslJson({
        ...ghslSample,
        tile_total_residents: 300000,
      }),
    ).toThrow(/population conservation/i);
  });

  it("handles empty tile, HTML error, and ArchiveFailure cleanly", async () => {
    const upsert = vi.fn();
    const emptyRes = await runGhslPopulationSource(makeJob("ghsl_population"), {
      feedUrl: () => "https://ghsl.jrc.example/tile",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(ghslEmpty), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
      upsert,
    });
    expect(emptyRes.outcome).toBe("succeeded");
    expect(emptyRes.publishedAt).toBe("2025-01-15T00:00:00.000Z");
    expect(upsert).not.toHaveBeenCalled();

    const htmlErr = await runGhslPopulationSource(makeJob("ghsl_population"), {
      feedUrl: () => "https://ghsl.jrc.example/tile",
      fetch: vi.fn().mockResolvedValue(
        new Response(ghslHtmlError, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    });
    expect(htmlErr.publicReasonCode).toBe("upstream_unreachable");
    expect(htmlErr.retryDisposition).toBe("transient");

    await expect(
      runGhslPopulationSource(makeJob("ghsl_population"), {
        feedUrl: () => "https://ghsl.jrc.example/tile",
        fetch: vi.fn().mockRejectedValue(new ArchiveFailure("upload_failed")),
      }),
    ).rejects.toThrow(ArchiveFailure);
  });
});

describe("M4B - Iteration 2 Adversarial Regression Guards", () => {
  it("succeeds with empty_slot and advances pre-filter watermark on Europe-only full-disk MTG FCI push slot, while rejecting swapped-axis Algeria coordinates", async () => {
    const upsertDetections = vi.fn();
    const recordDelivery = vi.fn().mockResolvedValue(undefined);
    const europeOnlyPayload = {
      product_id: "EO:EUM:DAT:0662:MTG-I1-FCI-L2P-FRP-20260815T051000Z",
      slot_time: "2026-08-15T05:10:00Z",
      published_at: "2026-08-15T05:12:40Z",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [15.1, 41.2] },
          properties: {
            Datetime: "2026-08-15 05:10:12",
            time: "2026-08-15T05:10:00Z",
            Confidence: 82,
            FRP: 31.4,
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.7, 38.0] },
          properties: {
            Datetime: "2026-08-15 05:10:15",
            time: "2026-08-15T05:10:00Z",
            Confidence: 78,
            FRP: 22.0,
          },
        },
      ],
    };

    const quietRes = await runMtgFciPushSource(
      makeJob("mtg_fci_push"),
      {
        feedUrl: () => "https://push.eumetsat.example/fci",
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(europeOnlyPayload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
        upsertDetections,
        recordDelivery,
      },
      () => Date.parse("2026-08-15T05:13:00Z"),
    );

    expect(quietRes.outcome).toBe("succeeded");
    expect(quietRes.upstreamPublishedAt).toBe("2026-08-15T05:12:40.000Z");
    expect(quietRes.recordsSeen).toBe(2);
    expect(quietRes.recordsInserted).toBe(0);
    expect(quietRes.qualityChecks).toMatchObject({ empty_slot: true });
    expect(upsertDetections).not.toHaveBeenCalled();
    expect(recordDelivery).toHaveBeenCalledOnce();

    const swappedPayload = {
      product_id: "EO:EUM:DAT:0662:MTG-I1-FCI-L2P-FRP-20260815T051500Z",
      slot_time: "2026-08-15T05:15:00Z",
      published_at: "2026-08-15T05:17:40Z",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [36.71234, 4.05123] },
          properties: {
            Datetime: "2026-08-15 05:15:12",
            time: "2026-08-15T05:15:00Z",
            Confidence: 88,
            FRP: 45.0,
          },
        },
      ],
    };

    const swappedRes = await runMtgFciPushSource(makeJob("mtg_fci_push"), {
      feedUrl: () => "https://push.eumetsat.example/fci",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(swappedPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
      upsertDetections: vi.fn(),
      recordDelivery: vi.fn(),
    });
    expect(swappedRes.outcome).toBe("failed");
    expect(swappedRes.publicReasonCode).toBe("schema_invalid");
    expect(swappedRes.retryDisposition).toBe("permanent");
  });

  it("rejects all nested and alternate-key PR #31 0665/L1c/eumetsat_fci variants in MTG FCI push", () => {
    const baseFeature = mtgFciSample.features[0]!;

    expect(() =>
      parseMtgFciPushJson({
        ...mtgFciSample,
        features: [
          {
            ...baseFeature,
            properties: {
              ...baseFeature.properties,
              collection_id: "EO:EUM:DAT:0665",
            },
          },
        ],
      }),
    ).toThrow(/0665|L1c/i);

    expect(() =>
      parseMtgFciPushJson({
        ...mtgFciSample,
        features: [
          {
            ...baseFeature,
            properties: {
              ...baseFeature.properties,
              product_level: "L1c",
            },
          },
        ],
      }),
    ).toThrow(/L1c/i);

    expect(() =>
      parseMtgFciPushJson({
        ...mtgFciSample,
        collection_id: "EO:EUM:DAT:0665",
      }),
    ).toThrow(/0665|L1c/i);

    expect(() =>
      parseMtgFciPushJson({
        ...mtgFciSample,
        features: [
          {
            ...baseFeature,
            source: "eumetsat_fci",
          },
        ],
      }),
    ).toThrow(/eumetsat_fci/i);
  });

  it("classifies OGC <ows:ExceptionReport> (application/vnd.ogc.se_xml and octet-stream) and >512-byte HTML comments as upstream_unreachable (transient)", async () => {
    const owsBody =
      '<ows:ExceptionReport version="2.0.0"><ows:Exception exceptionCode="NoApplicableCode"><ows:ExceptionText>Backend down</ows:ExceptionText></ows:Exception></ows:ExceptionReport>';

    const seXmlRes = await runMtgFciPushSource(makeJob("mtg_fci_push"), {
      feedUrl: () => "https://push.eumetsat.example/fci",
      fetch: vi.fn().mockResolvedValue(
        new Response(owsBody, {
          status: 200,
          headers: { "content-type": "application/vnd.ogc.se_xml" },
        }),
      ),
      upsertDetections: vi.fn(),
      recordDelivery: vi.fn(),
    });
    expect(seXmlRes.publicReasonCode).toBe("upstream_unreachable");
    expect(seXmlRes.retryDisposition).toBe("transient");

    const owsOctetRes = await runGwisBurnedAreasSource(
      makeJob("gwis_burned_areas"),
      {
        feedUrl: () => "https://gwis.jrc.example/nrt",
        fetch: vi.fn().mockResolvedValue(
          new Response(owsBody, {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
        ),
      },
    );
    expect(owsOctetRes.publicReasonCode).toBe("upstream_unreachable");
    expect(owsOctetRes.retryDisposition).toBe("transient");

    const longCommentHtml = `<!-- ${"maintenance-banner-".repeat(40)} --><html><body>503 Maintenance</body></html>`;
    const commentRes = await runMtgFciPushSource(makeJob("mtg_fci_push"), {
      feedUrl: () => "https://push.eumetsat.example/fci",
      fetch: vi.fn().mockResolvedValue(
        new Response(longCommentHtml, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      ),
      upsertDetections: vi.fn(),
      recordDelivery: vi.fn(),
    });
    expect(commentRes.publicReasonCode).toBe("upstream_unreachable");
    expect(commentRes.retryDisposition).toBe("transient");

    const unclosedComment = `<!-- ${"x".repeat(5000)} --><html><body>Maintenance</body></html>`;
    const unclosedRes = await runMtgFciPushSource(makeJob("mtg_fci_push"), {
      feedUrl: () => "https://push.eumetsat.example/fci",
      fetch: vi.fn().mockResolvedValue(
        new Response(unclosedComment, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      ),
      upsertDetections: vi.fn(),
      recordDelivery: vi.fn(),
    });
    expect(unclosedRes.publicReasonCode).toBe("upstream_unreachable");
    expect(unclosedRes.retryDisposition).toBe("transient");
  });

  it("classifies URL-form and keyword-containing wrong GWIS licences as licence_invalid (permanent)", async () => {
    for (const badLicence of [
      "https://creativecommons.org/licenses/by-nc/4.0/",
      "Proprietary (missing CC BY)",
    ]) {
      const res = await runGwisBurnedAreasSource(makeJob("gwis_burned_areas"), {
        feedUrl: () => "https://gwis.jrc.example/nrt",
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ ...gwisEmpty, licence: badLicence }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      });
      expect(res.outcome).toBe("failed");
      expect(res.publicReasonCode).toBe("licence_invalid");
      expect(res.retryDisposition).toBe("permanent");
      expect(res.privateDiagnostic).not.toContain("https://");
    }
  });

  it("rejects impossible calendar dates like 2026-02-30 in GWIS and CLMS as schema_invalid", () => {
    const sampleFeature = (
      gwisSample["features"] as Record<string, unknown>[]
    )[0]!;
    expect(() =>
      parseGwisGeoJson({
        ...gwisSample,
        features: [
          {
            ...sampleFeature,
            properties: {
              ...(sampleFeature["properties"] as Record<string, unknown>),
              burn_start_at: "2026-02-30",
              burn_end_at: "2026-02-30",
            },
          },
        ],
      }),
    ).toThrow(/schema invalid/i);

    expect(() =>
      parseClmsJson({
        ...clmsSample,
        observed_at: "2026-02-30",
      }),
    ).toThrow(/schema invalid/i);
  });

  it("rejects duplicate commune_code in GHSL communes JSON and assigns wilayaCode 00 to unmatched JSON grid cells", async () => {
    const duplicatePayload = {
      ...ghslSample,
      tile_total_residents: 110000,
      communes: [
        {
          commune_code: "1601",
          wilaya_code: "16",
          lat: 36.75,
          lon: 3.05,
          modeled_residents: 50000,
          source_cell_sum: 50000,
          source_cell_count: 100,
        },
        {
          commune_code: "1601",
          wilaya_code: "16",
          lat: 36.75,
          lon: 3.05,
          modeled_residents: 60000,
          source_cell_sum: 60000,
          source_cell_count: 120,
        },
      ],
    };

    expect(() => parseGhslJson(duplicatePayload)).toThrow(
      /duplicate commune_code "1601"/i,
    );

    const dupRes = await runGhslPopulationSource(makeJob("ghsl_population"), {
      feedUrl: () => "https://ghsl.jrc.example/tile",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(duplicatePayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    expect(dupRes.publicReasonCode).toBe("schema_invalid");
    expect(dupRes.retryDisposition).toBe("permanent");

    const unmatchedCells = parseGhslJson({
      epoch_year: 2025,
      resolution_m: 100,
      published_at: "2025-01-15T00:00:00Z",
      cells: [{ lat: 28.12, lon: 1.45, residents: 420 }],
    });
    expect(unmatchedCells.records).toHaveLength(1);
    expect(unmatchedCells.records[0]?.communeCode).toBe("grid:28.12:1.45");
    expect(unmatchedCells.records[0]?.wilayaCode).toBe("00");
  });

  it("classifies truncated 4-byte TIFF headers as schema_invalid (permanent) in CLMS and GHSL", async () => {
    const truncatedTiff = new Uint8Array([0x49, 0x49, 0x2a, 0x00]);

    const clmsRes = await runClmsNdviSwiSource(makeJob("clms_ndvi_swi"), {
      feedUrl: () => "https://clms.copernicus.example/odata",
      fetch: vi.fn().mockResolvedValue(
        new Response(truncatedTiff, {
          status: 200,
          headers: {
            "content-type": "image/tiff",
            "x-observed-at": "2026-10-11T00:00:00Z",
          },
        }),
      ),
      communes: async () => sampleCommunes,
    });
    expect(clmsRes.outcome).toBe("failed");
    expect(clmsRes.publicReasonCode).toBe("schema_invalid");
    expect(clmsRes.retryDisposition).toBe("permanent");

    const ghslRes = await runGhslPopulationSource(makeJob("ghsl_population"), {
      feedUrl: () => "https://ghsl.jrc.example/tile",
      fetch: vi.fn().mockResolvedValue(
        new Response(truncatedTiff, {
          status: 200,
          headers: { "content-type": "image/tiff" },
        }),
      ),
      communes: async () => sampleCommunes,
    });
    expect(ghslRes.outcome).toBe("failed");
    expect(ghslRes.publicReasonCode).toBe("schema_invalid");
    expect(ghslRes.retryDisposition).toBe("permanent");
  });
});
