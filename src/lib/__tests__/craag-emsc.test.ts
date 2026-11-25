import { readFileSync } from "node:fs";
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
  CRAAG_ATTRIBUTION,
  CRAAG_SOURCE_KEY,
  matchCraagToEmsc,
  parseCraagBulletins,
  parseCraagCoordinate,
  parseCraagMagnitude,
  parseCraagTimestamp,
  type EmscMatchCandidate,
} from "@/lib/ingest/craag";
import {
  ingestCraag,
  runCraagSource,
  type CraagAttributionApplyInput,
} from "@/lib/ingest/craag.server";
import {
  EMSC_MIN_MAGNITUDE,
  extractEmscWatermark,
  parseEmsc,
} from "@/lib/ingest/emsc";
import { ingestEmsc, ingestEmscWithMeta } from "@/lib/ingest/emsc.server";
import { ArchiveFailure } from "@/lib/source-archive.server";
import {
  retryDispositionForReason,
  type ClaimedSourceJob,
} from "@/lib/source-jobs";
import { publicReasonForError } from "@/lib/source-runs";

import emscSample from "./fixtures/emsc-sample.json";

const craagFrHtml = readFileSync(
  new URL("./fixtures/craag-bulletins-fr.html", import.meta.url),
  "utf8",
);
const craagArHtml = readFileSync(
  new URL("./fixtures/craag-bulletins-ar.html", import.meta.url),
  "utf8",
);
const craagEmptyHtml = readFileSync(
  new URL("./fixtures/craag-empty-table.html", import.meta.url),
  "utf8",
);
const craagMaintenanceHtml = readFileSync(
  new URL("./fixtures/craag-maintenance-error.html", import.meta.url),
  "utf8",
);
const craagSchemaErrorHtml = readFileSync(
  new URL("./fixtures/craag-schema-error.html", import.meta.url),
  "utf8",
);

const communes = async () => [
  { id: "setif", lat: 36.19, lon: 5.41 },
  { id: "ghazaouet", lat: 35.1, lon: -1.86 },
  { id: "alger", lat: 36.75, lon: 3.05 },
  { id: "oran", lat: 35.7, lon: -0.63 },
];

function makeCraagJob(): ClaimedSourceJob {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    contract_key: CRAAG_SOURCE_KEY,
    contract_version: 1,
    trigger_kind: "scheduled",
    execution_target: "worker",
    state: "running",
    scheduled_for: "2026-11-24T12:00:00Z",
    started_at: "2026-11-24T12:00:05Z",
    available_at: "2026-11-24T12:00:00Z",
    data_from: "2026-11-24T11:45:00Z",
    data_through: "2026-11-24T12:00:00Z",
    attempt_count: 1,
    max_attempts: 3,
    retry_base_seconds: 60,
    retry_until: "2026-11-24T12:30:00Z",
    dispatched_at: "2026-11-24T12:00:04Z",
    enqueued_by: ["scheduler"],
    finished_at: null,
    gap_id: null,
    idempotency_key: "craag_earthquakes:scheduled:2026-11-24T12:00:00Z",
    last_error_at: null,
    last_public_reason_code: null,
    created_at: "2026-11-24T12:00:00Z",
    updated_at: "2026-11-24T12:00:05Z",
  };
}

describe("F20 - EMSC M2+ Feed & CRAAG Official Earthquake Attribution Matcher", () => {
  it("passes minmagnitude=2 to EMSC FDSN query, enforces M2+ floor on stored Algeria quakes, and records pre-filter watermark", async () => {
    const urls: string[] = [];
    const stored: unknown[] = [];

    const payloadWithLocalM15 = {
      ...emscSample,
      features: [
        ...emscSample.features,
        {
          type: "Feature",
          properties: {
            unid: "20260925_0000999",
            time: "2026-09-25T11:55:00.0Z",
            lat: 36.75,
            lon: 3.05,
            depth: 5,
            mag: 1.8,
            magtype: "ml",
            flynn_region: "NORTHERN ALGERIA",
            auth: "EMSC",
            evtype: "ke",
            lastupdate: "2026-09-25T11:58:00.0Z",
          },
        },
      ],
    };

    const metaRun = await ingestEmscWithMeta(
      {
        fetch: async (url: string) => {
          urls.push(url);
          return new Response(JSON.stringify(payloadWithLocalM15), {
            status: 200,
          });
        },
        communes,
        upsert: async (rows: unknown[]) => {
          stored.push(...rows);
        },
      },
      () => Date.parse("2026-09-25T12:00:00Z"),
    );

    expect(urls[0]).toContain(`minmagnitude=${EMSC_MIN_MAGNITUDE}`);
    // Watermark comes from the outside-Algeria Spain row (2026-09-25T15:58:58.193Z) BEFORE locateEvents filters it out
    expect(metaRun.upstreamPublishedAt).toBe("2026-09-25T15:58:58.193Z");
    // The local M1.8 event must NOT be stored; only the 3 Algeria M2+ events are upserted
    expect(stored).toHaveLength(3);
    expect(
      (stored as { id: string }[]).some((e) => e.id === "20260925_0000999"),
    ).toBe(false);

    // Optional minMagnitude filter on parseEmsc works without breaking default parseEmsc(sample)
    expect(parseEmsc(emscSample, { minMagnitude: 2 })).toHaveLength(3);
    expect(extractEmscWatermark(parseEmsc(emscSample))).toBeTruthy();

    // Raw M1.99 inside Algeria must NEVER round up to 2.0 and pass the M2.0 floor (while raw M2.0 passes)
    const boundaryPayload = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            unid: "emsc-m199",
            time: "2026-11-24T12:00:00.0Z",
            lat: 36.75,
            lon: 3.05,
            depth: 5,
            mag: 1.99,
            magtype: "ml",
            flynn_region: "NORTHERN ALGERIA",
            auth: "EMSC",
            evtype: "ke",
            lastupdate: "2026-11-24T12:01:00.0Z",
          },
        },
        {
          type: "Feature",
          properties: {
            unid: "emsc-m200",
            time: "2026-11-24T12:00:30.0Z",
            lat: 36.75,
            lon: 3.05,
            depth: 5,
            mag: 2.0,
            magtype: "ml",
            flynn_region: "NORTHERN ALGERIA",
            auth: "EMSC",
            evtype: "ke",
            lastupdate: "2026-11-24T12:00:30.0Z",
          },
        },
      ],
    };
    const directParsed = parseEmsc(boundaryPayload, { minMagnitude: 2 });
    expect(directParsed.map((e) => e.id)).toEqual(["emsc-m200"]);

    const boundaryStored: { id: string; magnitude: number }[] = [];
    const boundaryRun = await ingestEmscWithMeta(
      {
        fetch: async () =>
          new Response(JSON.stringify(boundaryPayload), { status: 200 }),
        communes,
        upsert: async (rows: unknown[]) => {
          boundaryStored.push(...(rows as { id: string; magnitude: number }[]));
        },
      },
      () => Date.parse("2026-11-24T12:05:00Z"),
    );
    expect(boundaryRun.fetched).toBe(2);
    expect(boundaryRun.stored).toBe(1);
    expect(boundaryRun.outside).toBe(1);
    expect(boundaryRun.upstreamPublishedAt).toBe("2026-11-24T12:01:00.000Z");
    expect(boundaryStored.map((e) => e.id)).toEqual(["emsc-m200"]);
  });

  it("parses French & Arabic CRAAG HTML tables and structured JSON, recording pre-filter freshness watermark", () => {
    const fr = parseCraagBulletins(craagFrHtml);
    // All 4 rows seen: 2 kept (Setif M4.6 + Alger M3.4), 1 below M2 (Blida M1.7), 1 outside Algeria (Spain)
    expect(fr.allBulletinsCount).toBe(4);
    expect(fr.belowFloorCount).toBe(1);
    expect(fr.outsideCount).toBe(1);
    expect(fr.emptyPage).toBe(false);
    expect(fr.upstreamPublishedAt).toBe("2026-11-24T09:42:15.000Z"); // 10:42:15 GMT+1 -> 09:42:15Z
    expect(fr.bulletins).toHaveLength(2);
    expect(fr.bulletins[0]).toMatchObject({
      bulletinId: "craag-2026-0603-01",
      observedAt: "2026-06-03T14:11:02.000Z",
      lat: 36.21,
      lon: 5.44,
      depthKm: 10,
      magnitude: 4.6,
      magnitudeType: "Ml",
      place: "12 km au nord-est de Setif",
      sourceUrl:
        "https://www.craag.dz/sismologie/bulletin.php?id=craag-2026-0603-01",
      attribution: CRAAG_ATTRIBUTION,
    });

    const ar = parseCraagBulletins(craagArHtml);
    expect(ar.bulletins).toHaveLength(1);
    expect(ar.bulletins[0]).toMatchObject({
      bulletinId: "craag-ar-2026-1124-01",
      observedAt: "2026-11-24T12:20:10.000Z", // 13:20:10 Algiers (+01:00)
      lat: 35.7,
      lon: -0.64,
      depthKm: 10,
      magnitude: 3.8,
      magnitudeType: "Ml",
    });

    // Structured JSON support
    const jsonParsed = parseCraagBulletins({
      bulletins: [
        {
          id: "craag-json-1",
          observed_at: "2026-11-24T11:00:00Z",
          lat: 36.7,
          lon: 3.1,
          depth_km: 9,
          magnitude: 3.2,
          magnitude_type: "Ml",
          place: "Alger",
        },
      ],
    });
    expect(jsonParsed.bulletins).toHaveLength(1);
    expect(jsonParsed.bulletins[0]?.bulletinId).toBe("craag-json-1");

    // Helper parsers edge cases
    expect(parseCraagTimestamp("24/11/2026 10:00:00 UTC")).toBe(
      "2026-11-24T10:00:00.000Z",
    );
    expect(parseCraagCoordinate("0,64 W", "lon")).toBe(-0.64);
    expect(parseCraagMagnitude("Mw 4,5")).toEqual({
      magnitude: 4.5,
      magnitudeType: "Mw",
    });

    // CRAAG raw M1.99 must be rejected below M2.0 floor (NOT rounded up to 2.0), while raw M2.0 is accepted
    const htmlWith199 = `
      <table>
        <thead><tr><th>Date et Heure (GMT+1)</th><th>Latitude</th><th>Longitude</th><th>Magnitude</th><th>Localisation</th></tr></thead>
        <tbody>
          <tr><td>24/11/2026 11:30:00</td><td>36.75 N</td><td>3.05 E</td><td>1.99</td><td>Alger</td></tr>
          <tr><td>24/11/2026 11:35:00</td><td>36.75 N</td><td>3.05 E</td><td>2.0</td><td>Alger</td></tr>
        </tbody>
      </table>
    `;
    const craagBoundaryHtml = parseCraagBulletins(htmlWith199);
    expect(craagBoundaryHtml.allBulletinsCount).toBe(2);
    expect(craagBoundaryHtml.belowFloorCount).toBe(1);
    expect(craagBoundaryHtml.bulletins).toHaveLength(1);
    expect(craagBoundaryHtml.bulletins[0]?.magnitude).toBe(2);

    const craagBoundaryJson = parseCraagBulletins({
      bulletins: [
        {
          id: "craag-199",
          observed_at: "2026-11-24T10:30:00Z",
          lat: 36.75,
          lon: 3.05,
          magnitude: 1.99,
          place: "Alger",
        },
        {
          id: "craag-200",
          observed_at: "2026-11-24T10:35:00Z",
          lat: 36.75,
          lon: 3.05,
          magnitude: 2.0,
          place: "Alger",
        },
      ],
    });
    expect(craagBoundaryJson.belowFloorCount).toBe(1);
    expect(craagBoundaryJson.bulletins.map((b) => b.bulletinId)).toEqual([
      "craag-200",
    ]);
  });

  it("classifies CRAAG maintenance HTML as upstream_unreachable, broken markup as schema_invalid, and empty table as valid 0-match", async () => {
    expect(() => parseCraagBulletins(craagMaintenanceHtml)).toThrow(
      /upstream/i,
    );
    expect(
      publicReasonForError(
        "CRAAG upstream returned maintenance, error, or challenge HTML page (HTTP 200)",
      ),
    ).toBe("upstream_unreachable");

    expect(() => parseCraagBulletins(craagSchemaErrorHtml)).toThrow(/schema/i);
    expect(
      publicReasonForError(
        "CRAAG schema invalid: no recognizable seismic bulletin table in HTML",
      ),
    ).toBe("schema_invalid");

    // Missing-field CRAAG JSON schema errors must classify as schema_invalid (permanent), NOT credentials_missing
    for (const badJson of [
      { bulletins: [{ lat: 36.75, lon: 3.05, magnitude: 3.2 }] },
      { bulletins: [{ observed_at: "2026-11-24T10:00:00Z", magnitude: 3.2 }] },
      {
        bulletins: [
          { observed_at: "2026-11-24T10:00:00Z", lat: 36.75, lon: 3.05 },
        ],
      },
    ]) {
      let caught: Error | null = null;
      try {
        parseCraagBulletins(badJson);
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).toBeInstanceOf(Error);
      const reason = publicReasonForError(caught!.message);
      expect(reason).toBe("schema_invalid");
      expect(retryDispositionForReason(reason)).toBe("permanent");
    }

    const emptyParsed = parseCraagBulletins(craagEmptyHtml);
    expect(emptyParsed.emptyPage).toBe(true);
    expect(emptyParsed.bulletins).toEqual([]);

    const emptyJob = await runCraagSource(makeCraagJob(), {
      fetch: async () => new Response(craagEmptyHtml, { status: 200 }),
    });
    expect(emptyJob.outcome).toBe("succeeded");
    expect(emptyJob.qualityChecks?.["empty_or_static_page"]).toBe(true);
  });

  it("matches CRAAG bulletins to EMSC events within <=120s, <=50 km, <=1.0 mag using haversineKm with deterministic tiebreak", () => {
    const bulletin = parseCraagBulletins(craagFrHtml).bulletins[0]!; // Setif 2026-06-03T14:11:02Z, 36.21, 5.44, M4.6
    const candidates: EmscMatchCandidate[] = [
      {
        id: "emsc_too_far_time",
        occurred_at: "2026-06-03T14:15:00.000Z", // 238s diff > 120s
        lat: 36.21,
        lon: 5.44,
        magnitude: 4.6,
      },
      {
        id: "emsc_too_far_km",
        occurred_at: "2026-06-03T14:11:05.000Z",
        lat: 36.8,
        lon: 5.9, // > 50 km
        magnitude: 4.6,
      },
      {
        id: "emsc_mag_diff",
        occurred_at: "2026-06-03T14:11:05.000Z",
        lat: 36.21,
        lon: 5.44,
        magnitude: 6.0, // 1.4 diff > 1.0
      },
      {
        id: "emsc_b_closer",
        occurred_at: "2026-06-03T14:11:10.000Z",
        lat: 36.2,
        lon: 5.43,
        magnitude: 4.7,
      },
      {
        id: "emsc_a_farther",
        occurred_at: "2026-06-03T14:11:03.000Z",
        lat: 36.35,
        lon: 5.6,
        magnitude: 4.6,
      },
    ];

    const match = matchCraagToEmsc(bulletin, candidates);
    expect(match).not.toBeNull();
    expect(match?.earthquakeId).toBe("emsc_b_closer");
    expect(match!.distanceKm).toBeLessThanOrEqual(50);
    expect(match!.timeDiffSeconds).toBeLessThanOrEqual(120);
    expect(match!.magnitudeDiff).toBeLessThanOrEqual(1.0);

    // Deterministic lexical tiebreak on identical parameters
    const tie = matchCraagToEmsc(bulletin, [
      {
        id: "emsc_z",
        occurred_at: bulletin.observedAt,
        lat: bulletin.lat,
        lon: bulletin.lon,
        magnitude: bulletin.magnitude,
      },
      {
        id: "emsc_a",
        occurred_at: bulletin.observedAt,
        lat: bulletin.lat,
        lon: bulletin.lon,
        magnitude: bulletin.magnitude,
      },
    ]);
    expect(tie?.earthquakeId).toBe("emsc_a");
  });

  it("links matched bulletins without overwriting EMSC fields, inserts unmatched Algeria M2+ as standalone, and NEVER degrades EMSC on CRAAG outage", async () => {
    const applied: CraagAttributionApplyInput[] = [];
    const jobResult = await runCraagSource(makeCraagJob(), {
      fetch: async () => new Response(craagFrHtml, { status: 200 }),
      recentEmscEvents: async () => [
        {
          id: "20260603_0000366",
          occurred_at: "2026-06-03T14:11:12.000Z",
          lat: 36.19,
          lon: 5.41,
          magnitude: 4.7,
          network: "EMSC",
        },
      ],
      communes,
      applyAttribution: async (input) => {
        applied.push(input);
        return {
          mode: input.matchedEarthquakeId ? "matched" : "standalone",
          earthquakeId:
            input.matchedEarthquakeId ?? `craag:${input.bulletin.bulletinId}`,
        };
      },
    });

    expect(jobResult.outcome).toBe("succeeded");
    expect(jobResult.recordsUpdated).toBe(1); // matched Setif EMSC event
    expect(jobResult.recordsInserted).toBe(1); // standalone Alger M3.4
    expect(applied[0]?.matchedEarthquakeId).toBe("20260603_0000366");
    expect(applied[1]?.matchedEarthquakeId).toBeNull();
    expect(applied[1]?.communeId).toBe("alger");

    // CRAAG outage returns failed/transient WITHOUT touching or degrading EMSC ingest
    const outageJob = await runCraagSource(makeCraagJob(), {
      fetch: async () => new Response("down", { status: 503 }),
    });
    expect(outageJob.outcome).toBe("failed");
    expect(outageJob.publicReasonCode).toBe("upstream_unreachable");
    expect(outageJob.retryDisposition).toBe("transient");

    // EMSC continues running independently and cleanly
    const emscStored: unknown[] = [];
    const emscRun = await ingestEmsc(
      {
        fetch: async () =>
          new Response(JSON.stringify(emscSample), { status: 200 }),
        communes,
        upsert: async (rows: unknown[]) => {
          emscStored.push(...rows);
        },
      },
      () => Date.parse("2026-09-25T12:00:00Z"),
    );
    expect(emscRun).toEqual({ fetched: 4, stored: 3, outside: 1 });
    expect(emscStored).toHaveLength(3);

    // ArchiveFailure propagates loudly
    await expect(
      ingestCraag({
        fetch: async () => {
          throw new ArchiveFailure("upload_failed");
        },
      }),
    ).rejects.toThrow(/upload_failed/);
  });

  it("rejects impossible calendar dates in CRAAG timestamps and parses adjacent compass coordinates accurately (T5-03 & T5-04)", () => {
    for (const badTs of [
      "2026-02-30T12:00:00Z",
      "2026-04-31T00:00:00Z",
      "30/02/2026 12:00:00",
      "31/04/2026 09:30:00",
      "2026-02-29 12:00:00",
      "May 2026",
    ]) {
      expect(() => parseCraagTimestamp(badTs), badTs).toThrow(
        /CRAAG schema invalid/i,
      );
    }

    expect(parseCraagCoordinate("1.25W", "lon")).toBe(-1.25);
    expect(parseCraagCoordinate("1.25O", "lon")).toBe(-1.25);
    expect(parseCraagCoordinate("36.75S", "lat")).toBe(-36.75);
    expect(parseCraagCoordinate("36.75N", "lat")).toBe(36.75);
    expect(parseCraagCoordinate("3.05E", "lon")).toBe(3.05);
    expect(parseCraagCoordinate("0.65°W", "lon")).toBe(-0.65);
    expect(parseCraagCoordinate("0.65 W", "lon")).toBe(-0.65);
    expect(parseCraagCoordinate("NORTH 36.75", "lat")).toBe(36.75);
    expect(parseCraagCoordinate("WEST 1.25", "lon")).toBe(1.25);
    expect(parseCraagCoordinate("EST 3.05", "lon")).toBe(3.05);

    const parsed = parseCraagBulletins({
      bulletins: [
        {
          observed_at: "2026-11-25T10:15:00Z",
          lat: "35.69N",
          lon: "1.25W",
          magnitude: 4.3,
          place: "Tlemcen / Oran",
        },
      ],
    });
    expect(parsed.bulletins).toHaveLength(1);
    expect(parsed.bulletins[0]!.lon).toBe(-1.25);
    const matched = matchCraagToEmsc(parsed.bulletins[0]!, [
      {
        id: "20261125_west_dz",
        occurred_at: "2026-11-25T10:15:10Z",
        lat: 35.7,
        lon: -1.24,
        magnitude: 4.2,
      },
    ]);
    expect(matched?.earthquakeId).toBe("20261125_west_dz");
  });
});
