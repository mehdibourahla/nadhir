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
  ALGERIA_RAINFALL_BBOX,
  IMERG_ATTRIBUTION,
  IMERG_SOURCE_KEY,
  parseImergGeoTiff,
  parseImergJson,
  parseImergPayload,
} from "@/lib/ingest/imerg";
import { ingestImerg, runImergSource } from "@/lib/ingest/imerg.server";
import {
  HSAF_ATTRIBUTION,
  HSAF_SOURCE_KEY,
  parseHsafGeoTiff,
  parseHsafJson,
  parseHsafPayload,
} from "@/lib/ingest/hsaf";
import { ingestHsaf, runHsafSource } from "@/lib/ingest/hsaf.server";
import { ArchiveFailure } from "@/lib/source-archive.server";
import {
  retryDispositionForReason,
  type ClaimedSourceJob,
} from "@/lib/source-jobs";
import { publicReasonForError } from "@/lib/source-runs";

import imergSample from "./fixtures/imerg-sample.json";
import imergDrySlot from "./fixtures/imerg-dry-slot.json";
import imergSchemaError from "./fixtures/imerg-schema-error.json";
import hsafSample from "./fixtures/hsaf-sample.json";
import hsafDrySlot from "./fixtures/hsaf-dry-slot.json";
import hsafSchemaError from "./fixtures/hsaf-schema-error.json";

const imergHtmlError = readFileSync(
  new URL("./fixtures/imerg-upstream-html-error.html", import.meta.url),
  "utf8",
);
const hsafHtmlError = readFileSync(
  new URL("./fixtures/hsaf-upstream-html-error.html", import.meta.url),
  "utf8",
);

const sampleCommunes = async () => [
  { id: "c-alger", code: "1601", lat: 36.75, lon: 3.05 },
  { id: "c-tam", code: "1101", lat: 22.79, lon: 5.52 },
  { id: "c-ghardaia", code: "4701", lat: 32.49, lon: 3.67 },
];

function makeJob(
  contractKey: "imerg_rainfall" | "hsaf_rainfall",
  trigger: "scheduled" | "replay" = "scheduled",
): ClaimedSourceJob {
  return {
    id: "00000000-0000-4000-8000-000000000018",
    contract_key: contractKey,
    contract_version: 1,
    trigger_kind: trigger,
    execution_target: "worker",
    state: "running",
    scheduled_for: "2026-11-24T12:00:00Z",
    started_at: "2026-11-24T12:00:05Z",
    available_at: "2026-11-24T12:00:00Z",
    data_from: "2026-11-24T11:30:00Z",
    data_through: "2026-11-24T12:00:00Z",
    attempt_count: 1,
    max_attempts: 3,
    retry_base_seconds: 60,
    retry_until: "2026-11-24T12:30:00Z",
    dispatched_at: "2026-11-24T12:00:04Z",
    enqueued_by: ["scheduler"],
    finished_at: null,
    gap_id: null,
    idempotency_key: `${contractKey}:scheduled:2026-11-24T12:00:00Z`,
    last_error_at: null,
    last_public_reason_code: null,
    created_at: "2026-11-24T12:00:00Z",
    updated_at: "2026-11-24T12:00:05Z",
  };
}

async function buildSampleGeoTiff(
  values: Uint16Array | Float32Array,
  width: number,
  height: number,
): Promise<ArrayBuffer> {
  // Real GeoTIFF (uint16 for NASA PPS IMERG, float32 for H-SAF);
  // BBox covers Algeria: west=2.0, north=37.0, pixel scale 1.0 deg -> east=2+width, south=37-height
  return writeArrayBuffer(values, {
    width,
    height,
    ModelPixelScale: [1.0, 1.0, 0],
    ModelTiepoint: [0, 0, 0, 2.0, 37.0, 0],
    GTModelTypeGeoKey: 2,
    GeographicTypeGeoKey: 4326,
  });
}

describe("F18 - IMERG & H-SAF Observed 30-Min Satellite Rainfall", () => {
  it("parses IMERG 0.1 mm/h scaled JSON across full Algeria including Saharan cells, skipping nodata/dry/outside", () => {
    const parsed = parseImergJson(imergSample);
    expect(parsed.sourceKey).toBe(IMERG_SOURCE_KEY);
    expect(parsed.validTime).toBe("2026-11-24T12:00:00.000Z");
    expect(parsed.upstreamPublishedAt).toBe("2026-11-24T15:52:00.000Z");
    expect(parsed.cellsSeen).toBe(5);
    expect(parsed.cellsNodata).toBe(1);
    expect(parsed.cellsOutsideAlgeria).toBe(1);
    expect(parsed.cellsDry).toBe(1);
    expect(parsed.drySlot).toBe(false);
    expect(parsed.observations).toHaveLength(2);

    // Northern cell (Algiers) and Saharan cell (Tamanrasset, lat 22.79 < 33.2) both preserved!
    expect(parsed.observations[0]).toMatchObject({
      sourceKey: "imerg_rainfall",
      observationKind: "satellite_observed",
      isModel: false,
      windowMinutes: 30,
      lat: 36.75,
      lon: 3.05,
      rateMmH: 24.6,
      accumMm30m: 12.3,
      attribution: IMERG_ATTRIBUTION,
    });
    expect(parsed.observations[1]).toMatchObject({
      lat: 22.79,
      lon: 5.52,
      rateMmH: 18.4,
      accumMm30m: 9.2,
    });
    expect(ALGERIA_RAINFALL_BBOX.south).toBeLessThan(22.79);
  });

  it("parses real GeoTIFF binaries via geotiff fromArrayBuffer for IMERG and H-SAF", async () => {
    // 2x2 uint16 grid: (36.5, 2.5)=120 -> 12.0 mm/h, (36.5, 3.5)=29999 (nodata), (35.5, 2.5)=0 (dry), (35.5, 3.5)=64 -> 6.4 mm/h
    const imergTiff = await buildSampleGeoTiff(
      new Uint16Array([120, 29999, 0, 64]),
      2,
      2,
    );
    const parsedImerg = await parseImergGeoTiff(imergTiff, {
      validTime: "2026-11-24T12:00:00Z",
      publishedTime: "2026-11-24T15:50:00Z",
      snapshotId: "imerg-tiff-1",
    });
    expect(parsedImerg.observations).toHaveLength(2);
    expect(parsedImerg.observations[0]).toMatchObject({
      rateMmH: 12,
      accumMm30m: 6,
      observationKind: "satellite_observed",
      isModel: false,
    });
    expect(parsedImerg.observations[1]).toMatchObject({
      rateMmH: 6.4,
      accumMm30m: 3.2,
    });
    expect(parsedImerg.cellsNodata).toBe(1);
    expect(parsedImerg.cellsDry).toBe(1);

    // H-SAF float32 GeoTIFF in mm/30m unit converts to rate_mm_h = accum * 2
    const hsafTiff = await buildSampleGeoTiff(
      new Float32Array([10, -9999, 0, 5]),
      2,
      2,
    );
    const parsedHsaf = await parseHsafGeoTiff(hsafTiff, {
      validTime: "2026-11-24T12:00:00Z",
      publishedTime: "2026-11-24T12:15:00Z",
      valueUnit: "mm_30m",
    });
    expect(parsedHsaf.observations).toHaveLength(2);
    expect(parsedHsaf.observations[0]).toMatchObject({
      sourceKey: HSAF_SOURCE_KEY,
      accumMm30m: 10,
      rateMmH: 20,
      attribution: HSAF_ATTRIBUTION,
    });
  });

  it("parses H-SAF mm/30m JSON and computes rate_mm_h accurately while skipping nodata and outside-Algeria cells", () => {
    const parsed = parseHsafJson(hsafSample);
    expect(parsed.sourceKey).toBe("hsaf_rainfall");
    expect(parsed.upstreamPublishedAt).toBe("2026-11-24T12:18:00.000Z");
    expect(parsed.observations).toHaveLength(2);
    expect(parsed.observations[0]).toMatchObject({
      lat: 36.75,
      lon: 3.05,
      accumMm30m: 14.2,
      rateMmH: 28.4,
      isModel: false,
      observationKind: "satellite_observed",
    });
    expect(parsed.observations[1]).toMatchObject({
      lat: 32.49,
      lon: 3.67,
      accumMm30m: 8.5,
      rateMmH: 17.0,
    });
    expect(parsed.cellsNodata).toBe(1);
    expect(parsed.cellsOutsideAlgeria).toBe(1);
  });

  it("advances pre-filter freshness watermark on dry Algeria 30-min slots (GAPS.md:656-663)", async () => {
    const imergParsed = parseImergJson(imergDrySlot);
    expect(imergParsed.drySlot).toBe(true);
    expect(imergParsed.observations).toEqual([]);
    expect(imergParsed.upstreamPublishedAt).toBe("2026-11-24T16:22:00.000Z");

    const hsafParsed = parseHsafJson(hsafDrySlot);
    expect(hsafParsed.drySlot).toBe(true);
    expect(hsafParsed.observations).toEqual([]);
    expect(hsafParsed.upstreamPublishedAt).toBe("2026-11-24T12:48:00.000Z");

    const upsert = vi.fn(async () => 0);
    const result = await runImergSource(makeJob("imerg_rainfall"), {
      feedUrl: () => "https://pps.example.org/imerg",
      fetch: async () =>
        new Response(JSON.stringify(imergDrySlot), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      communes: sampleCommunes,
      upsert,
    });
    expect(result.outcome).toBe("succeeded");
    expect(result.upstreamPublishedAt).toBe("2026-11-24T16:22:00.000Z");
    expect(result.qualityChecks?.["dry_slot"]).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("classifies HTTP 200 HTML error pages strictly as upstream_unreachable (transient) for both IMERG and H-SAF", async () => {
    await expect(
      parseImergPayload(imergHtmlError, { contentType: "text/html" }),
    ).rejects.toThrow(/upstream/i);
    await expect(
      parseHsafPayload(hsafHtmlError, { contentType: "text/html" }),
    ).rejects.toThrow(/upstream/i);

    const imergJobResult = await runImergSource(makeJob("imerg_rainfall"), {
      feedUrl: () => "https://pps.example.org/imerg",
      fetch: async () =>
        new Response(imergHtmlError, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      communes: sampleCommunes,
    });
    expect(imergJobResult.outcome).toBe("failed");
    expect(imergJobResult.publicReasonCode).toBe("upstream_unreachable");
    expect(imergJobResult.retryDisposition).toBe("transient");

    const hsafJobResult = await runHsafSource(makeJob("hsaf_rainfall"), {
      feedUrl: () => "https://hsaf.example.org/precip",
      fetch: async () =>
        new Response(hsafHtmlError, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      communes: sampleCommunes,
    });
    expect(hsafJobResult.outcome).toBe("failed");
    expect(hsafJobResult.publicReasonCode).toBe("upstream_unreachable");
    expect(hsafJobResult.retryDisposition).toBe("transient");

    // Comment-prefixed HTML served as application/octet-stream still maps to upstream_unreachable (transient)
    const commentPrefixedHtml =
      "<!-- proxy error -->\n<!DOCTYPE html><html><body>502 Bad Gateway</body></html>";
    const commentImergJob = await runImergSource(makeJob("imerg_rainfall"), {
      feedUrl: () => "https://pps.example.org/imerg",
      fetch: async () =>
        new Response(commentPrefixedHtml, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      communes: sampleCommunes,
    });
    expect(commentImergJob.outcome).toBe("failed");
    expect(commentImergJob.publicReasonCode).toBe("upstream_unreachable");
    expect(commentImergJob.retryDisposition).toBe("transient");

    const commentHsafJob = await runHsafSource(makeJob("hsaf_rainfall"), {
      feedUrl: () => "https://hsaf.example.org/precip",
      fetch: async () =>
        new Response(commentPrefixedHtml, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      communes: sampleCommunes,
    });
    expect(commentHsafJob.outcome).toBe("failed");
    expect(commentHsafJob.publicReasonCode).toBe("upstream_unreachable");
    expect(commentHsafJob.retryDisposition).toBe("transient");

    // Malformed feed URL returns structured error instead of throwing unhandled TypeError
    const badImergUrlRun = await ingestImerg({
      feedUrl: () => "not-a-valid-url",
    });
    expect(badImergUrlRun.error).toMatch(/invalid feed URL/i);
    expect(badImergUrlRun.stored).toBe(0);
    expect(publicReasonForError(badImergUrlRun.error!)).toBe(
      "credentials_missing",
    );

    const badHsafUrlRun = await ingestHsaf({
      feedUrl: () => "://bad-url",
    });
    expect(badHsafUrlRun.error).toMatch(/invalid feed URL/i);
    expect(badHsafUrlRun.stored).toBe(0);
    expect(publicReasonForError(badHsafUrlRun.error!)).toBe(
      "credentials_missing",
    );
  });

  it("rejects schema/unit/bounds/NaN/negative/swapped-axis violations as schema_invalid (permanent)", async () => {
    const cases: Array<() => unknown> = [
      () => parseImergJson(imergSchemaError),
      () =>
        parseImergJson({
          valid_time: "2026-11-24T12:00:00Z",
          cells: [{ lat: 36.75, lon: 3.05, rate_mm_h: -1.5 }],
        }),
      () =>
        parseImergJson({
          valid_time: "2026-11-24T12:00:00Z",
          cells: [{ lat: 95, lon: 3.05, rate_mm_h: 5 }],
        }),
      () =>
        parseImergJson({
          valid_time: "not-a-date",
          cells: [],
        }),
      () =>
        parseImergJson({
          valid_time: "2026-11-24T12:00:00Z",
          is_model: true,
          cells: [],
        }),
      () => parseHsafJson(hsafSchemaError),
      () =>
        parseHsafJson({
          valid_time: "2026-11-24T12:00:00Z",
          cells: [{ lat: 36.75, lon: 3.05, rate_mm_h: 10, accum_mm_30m: 20 }],
        }),
      // Missing-field schema errors must classify as schema_invalid (NOT credentials_missing)
      () => parseImergJson({ cells: [] }),
      () => parseImergJson({ valid_time: "2026-11-24T12:00:00Z" }),
      () =>
        parseImergJson({
          valid_time: "2026-11-24T12:00:00Z",
          cells: [{ lat: 36.75, lon: 3.05 }],
        }),
      () => parseHsafJson({ valid_time: "2026-11-24T12:00:00Z" }),
      () =>
        parseHsafJson({
          valid_time: "2026-11-24T12:00:00Z",
          cells: [{ lat: 36.75, lon: 3.05 }],
        }),
      // NaN in JSON payloads must reject as schema_invalid (NEVER silently swallowed as nodata)
      () =>
        parseImergJson({
          valid_time: "2026-11-24T12:00:00Z",
          cells: [{ lat: 36.75, lon: 3.05, rate_mm_h: Number.NaN }],
        }),
      () =>
        parseImergJson({
          valid_time: "2026-11-24T12:00:00Z",
          cells: [{ lat: 36.75, lon: 3.05, scaled_rate: Number.NaN }],
        }),
      () =>
        parseHsafJson({
          valid_time: "2026-11-24T12:00:00Z",
          cells: [{ lat: 36.75, lon: 3.05, rate_mm_h: Number.NaN }],
        }),
      () =>
        parseHsafJson({
          valid_time: "2026-11-24T12:00:00Z",
          cells: [{ lat: 36.75, lon: 3.05, accum_mm_30m: Number.NaN }],
        }),
      () =>
        parseHsafJson({
          valid_time: "2026-11-24T12:00:00Z",
          cells: [{ lat: 36.75, lon: 3.05, value: Number.NaN }],
        }),
    ];

    for (const runCase of cases) {
      let caught: Error | null = null;
      try {
        runCase();
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).toBeInstanceOf(Error);
      const reason = publicReasonForError(caught!.message);
      expect(reason).toBe("schema_invalid");
      expect(retryDispositionForReason(reason)).toBe("permanent");
    }

    // Genuine missing credentials/env config still maps to credentials_missing (permanent)
    expect(
      publicReasonForError(
        "IMERG feed URL not configured (IMERG_FEED_URL missing)",
      ),
    ).toBe("credentials_missing");
    expect(
      publicReasonForError(
        "H-SAF feed URL not configured (HSAF_FEED_URL missing)",
      ),
    ).toBe("credentials_missing");
    expect(publicReasonForError("missing API key")).toBe("credentials_missing");
  });

  it("supports idempotent replay and out-of-order slot ingestion without touching weather_snapshots", async () => {
    const storedByKey = new Map<string, Record<string, unknown>>();
    const upsert = vi.fn(async (rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        const key = `${String(row["source_key"])}|${String(row["valid_time"])}|${String(row["grid_cell_key"])}`;
        storedByKey.set(key, row);
      }
      return rows.length;
    });

    const deps = {
      feedUrl: () => "https://pps.example.org/imerg",
      fetch: async () =>
        new Response(JSON.stringify(imergSample), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      communes: sampleCommunes,
      upsert,
    };

    const first = await runImergSource(
      makeJob("imerg_rainfall", "replay"),
      deps,
    );
    const replay = await runImergSource(
      makeJob("imerg_rainfall", "replay"),
      deps,
    );
    expect(first.outcome).toBe("succeeded");
    expect(replay.outcome).toBe("succeeded");
    expect(storedByKey.size).toBe(2);

    // Out-of-order older slot stored independently alongside newer slot
    const olderSlot = {
      ...imergSample,
      valid_time: "2026-11-24T11:30:00Z",
      published_time: "2026-11-24T15:22:00Z",
    };
    const outOfOrder = await ingestImerg({
      ...deps,
      fetch: async () =>
        new Response(JSON.stringify(olderSlot), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(outOfOrder.stored).toBe(2);
    expect(storedByKey.size).toBe(4);
    for (const row of storedByKey.values()) {
      expect(row["observation_kind"]).toBe("satellite_observed");
      expect(row["is_model"]).toBe(false);
    }
  });

  it("re-throws ArchiveFailure loudly and keeps IMERG/H-SAF sources pure Web Standard", async () => {
    await expect(
      ingestImerg({
        feedUrl: () => "https://pps.example.org/imerg",
        fetch: async () => {
          throw new ArchiveFailure("upload_failed");
        },
      }),
    ).rejects.toThrow(/upload_failed/);

    await expect(
      ingestHsaf({
        feedUrl: () => "https://hsaf.example.org/precip",
        fetch: async () => {
          throw new ArchiveFailure("upload_failed");
        },
      }),
    ).rejects.toThrow(/upload_failed/);

    for (const file of [
      "../ingest/imerg.ts",
      "../ingest/imerg.server.ts",
      "../ingest/hsaf.ts",
      "../ingest/hsaf.server.ts",
    ]) {
      const code = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(code).not.toMatch(/\bnode:/);
      expect(code).not.toMatch(/\bBuffer\./);
      expect(code).not.toMatch(/weather_snapshots|risk_forecasts/);
    }
  });

  it("rejects impossible calendar dates, non-ISO timestamps, long HTML comments, and unclosed comments (T5-03 & T5-11)", async () => {
    for (const badTs of [
      "2026-02-30T12:00:00Z",
      "2026-04-31T00:00:00Z",
      "2026-02-29T12:00:00Z",
      "1",
      "May 2026",
      "2026-11-24T25:00:00Z",
    ]) {
      await expect(
        parseImergPayload({
          valid_time: badTs,
          window_minutes: 30,
          cells: [],
        }),
      ).rejects.toThrow(/schema invalid/i);
      await expect(
        parseHsafPayload({
          valid_time: badTs,
          window_minutes: 30,
          cells: [],
        }),
      ).rejects.toThrow(/schema invalid/i);
    }

    const longCommentHtml = `<!-- ${"A".repeat(600)} --><html><body>502 Bad Gateway</body></html>`;
    const unclosedComment = `<!-- ${"B".repeat(5000)}`;
    await expect(
      parseImergPayload(longCommentHtml, {
        contentType: "application/octet-stream",
      }),
    ).rejects.toThrow(/HTML\/XML error page/i);
    await expect(
      parseHsafPayload(longCommentHtml, {
        contentType: "application/octet-stream",
      }),
    ).rejects.toThrow(/HTML\/XML error page/i);
    await expect(
      parseImergPayload(unclosedComment, {
        contentType: "application/octet-stream",
      }),
    ).rejects.toThrow(/HTML\/XML error page/i);
    await expect(
      parseImergPayload("<ServiceExceptionReport/>", {
        contentType: "application/vnd.ogc.se_xml",
      }),
    ).rejects.toThrow(/error content-type/i);
    await expect(
      parseImergPayload("<!-- ok --> 502 Bad Gateway", {
        contentType: "application/octet-stream",
      }),
    ).rejects.toThrow(/plain-text error response/i);
  });
});
