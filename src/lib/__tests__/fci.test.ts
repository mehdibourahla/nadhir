import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  S3_SLSTR,
  parseFciFeatures,
  parseWfsFireFeatures,
} from "@/lib/ingest/fci.server";

const sample = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "fci-wfs-sample.json"), "utf8"),
) as Parameters<typeof parseFciFeatures>[0];

/* The captured slot is entirely In Amenas gas flaring, so every mapping
 * assertion needs a feature moved onto burnable ground first. */
function overKabylie() {
  const moved = structuredClone(sample);
  moved.features[0]!.geometry.coordinates = [3.5087, 36.5124];
  return moved;
}

describe("parseFciFeatures", () => {
  it("maps a live WFS response onto detection rows", () => {
    const { rows, outside, latestSlot } = parseFciFeatures(overKabylie());
    expect(outside).toBe(0);
    expect(latestSlot).toBe("2026-08-30T16:40:00Z");
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.source).toBe("fci");
    expect(r.sensor).toBe("FCI");
    expect(r.lat).toBeCloseTo(36.5124);
    expect(r.lon).toBeCloseTo(3.5087);
    expect(r.frp_mw).toBeCloseTo(8.87);
    expect(r.confidence_raw).toBeCloseTo(0.88);
    expect(r.detected_at).toBe("2026-08-30T16:47:43.000Z");
    expect(r.daynight).toBe("D");
    expect(r.natural_key).toBe("fci:FCI:36.51240:3.50870:2026-08-30T16:40:00Z");
  });

  it("falls back to the slot time when the pixel Datetime is unparsable", () => {
    const broken = overKabylie();
    broken.features[0]!.properties.Datetime = "garbage";
    const { rows } = parseFciFeatures(broken);
    expect(rows[0]!.detected_at).toBe("2026-08-30T16:40:00.000Z");
  });

  it("counts features outside the watch box instead of ingesting them", () => {
    const shifted = overKabylie();
    shifted.features[1]!.geometry.coordinates = [30.0, 10.0];
    const { rows, outside } = parseFciFeatures(shifted);
    expect(rows).toHaveLength(1);
    expect(outside).toBe(1);
  });

  it("marks night detections from the solar zenith angle", () => {
    const night = overKabylie();
    night.features[0]!.properties.SZA = 112.4;
    const { rows } = parseFciFeatures(night);
    expect(rows[0]!.daynight).toBe("N");
  });

  it("drops Saharan heat sources that fall outside the watch polygon", () => {
    const { rows, filtered, outside } = parseFciFeatures(sample);
    expect(rows).toHaveLength(0);
    expect(filtered).toBe(4);
    expect(outside).toBe(0);
  });

  it("keeps the axis-order sentinel separate from watch-area filtering", () => {
    const { outside, filtered } = parseFciFeatures(sample);
    expect(outside).toBe(0);
    expect(filtered).toBeGreaterThan(0);
  });

  // freshness must track what EUMETSAT published, not whether anything burned:
  // a quiet night would otherwise age a healthy source into "stale"
  it("reports the newest slot even when every feature is filtered out", () => {
    const { rows, latestSlot } = parseFciFeatures(sample);
    expect(rows).toHaveLength(0);
    expect(latestSlot).toBe("2026-08-30T16:40:00Z");
  });

  it("ignores out-of-box features when reporting the newest slot", () => {
    const flipped = structuredClone(sample);
    for (const feature of flipped.features)
      feature.geometry.coordinates = [30.0, 10.0];
    const { latestSlot, outside } = parseFciFeatures(flipped);
    expect(outside).toBe(4);
    expect(latestSlot).toBeNull();
  });

  it("handles null, undefined, primitive, and malformed feature collections without throwing", () => {
    const malformedInputs: unknown[] = [
      null,
      undefined,
      "bad",
      42,
      {},
      { features: null },
      { features: "not-an-array" },
      { features: [] },
      { features: [null, undefined, {}, { geometry: null, properties: null }] },
    ];
    for (const bad of malformedInputs) {
      expect(
        parseFciFeatures(bad as Parameters<typeof parseFciFeatures>[0]),
      ).toEqual({
        rows: [],
        outside: 0,
        filtered: 0,
        latestSlot: null,
      });
    }
  });

  it("never lets an unparseable time poison latestSlot", () => {
    const res = parseFciFeatures({
      features: [
        {
          geometry: { coordinates: [3.05, 36.75] },
          properties: {
            time: "2026-11-24T12:00:00Z",
            FRP: 15,
            Confidence: 80,
            SZA: 45,
          },
        },
        {
          geometry: { coordinates: [3.05, 36.75] },
          properties: {
            time: "invalid-date",
            FRP: 15,
            Confidence: 80,
            SZA: 45,
          },
        },
        {
          geometry: { coordinates: [3.05, 36.75] },
          properties: {
            time: "2026-02-30T12:00:00Z",
            FRP: 15,
            Confidence: 80,
            SZA: 45,
          },
        },
      ],
    });
    expect(res.latestSlot).toBe("2026-11-24T12:00:00Z");
    expect(res.rows).toHaveLength(1);
    expect(res.outside).toBe(0);
  });

  it("drops impossible WGS84 coordinates without incrementing outside", () => {
    const res = parseFciFeatures({
      features: [
        {
          geometry: { coordinates: [3.0, 95.0] },
          properties: { time: "2026-11-24T12:00:00Z" },
        },
        {
          geometry: { coordinates: [200.0, 36.0] },
          properties: { time: "2026-11-24T12:00:00Z" },
        },
        {
          geometry: { coordinates: [-181.0, 36.0] },
          properties: { time: "2026-11-24T12:00:00Z" },
        },
        {
          geometry: { coordinates: [3.0, -91.0] },
          properties: { time: "2026-11-24T12:00:00Z" },
        },
      ],
    });
    expect(res.rows).toHaveLength(0);
    expect(res.outside).toBe(0);
    expect(res.filtered).toBe(0);
    expect(res.latestSlot).toBeNull();
  });

  it("guards non-finite or non-numeric Confidence, SZA, and FRP values", () => {
    const res = parseFciFeatures({
      features: [
        {
          geometry: { coordinates: [3.5087, 36.5124] },
          properties: {
            time: "2026-11-24T12:00:00Z",
            Confidence: Number.NaN,
            SZA: null as unknown as number,
            FRP: Number.POSITIVE_INFINITY,
          },
        },
        {
          geometry: { coordinates: [3.5088, 36.5125] },
          properties: {
            time: "2026-11-24T12:00:00Z",
            Confidence: "high" as unknown as number,
            SZA: "bad" as unknown as number,
            FRP: Number.NaN,
          },
        },
        {
          geometry: { coordinates: [3.5089, 36.5126] },
          properties: {
            time: "2026-11-24T12:00:00Z",
            Confidence: null as unknown as number,
            SZA: Number.NaN,
            FRP: "15" as unknown as number,
          },
        },
      ],
    });
    expect(res.rows).toHaveLength(3);
    for (const row of res.rows) {
      expect(Number.isFinite(row.confidence_raw)).toBe(true);
      expect(row.confidence_raw).toBe(0.5);
      expect(row.daynight).toBeNull();
      expect(row.frp_mw).toBeNull();
    }
  });
});

describe("parseWfsFireFeatures for Sentinel-3 SLSTR", () => {
  const s3 = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "s3-wfs-sample.json"), "utf8"),
  ) as Parameters<typeof parseWfsFireFeatures>[0];

  it("maps SLSTR pixels onto detection rows keyed by satellite", () => {
    const { rows, latestSlot } = parseWfsFireFeatures(s3, S3_SLSTR);
    expect(latestSlot).toBe("2026-08-31T21:16:00Z");
    const day = rows.find((r) => r.daynight === "D")!;
    expect(day.source).toBe("s3");
    expect(day.sensor).toBe("SLSTR-S3A");
    expect(day.detected_at).toBe("2026-08-31T10:09:59.000Z");
    expect(day.frp_mw).toBeCloseTo(23.74, 2);
    expect(day.confidence_raw).toBeCloseTo(0.898);
    expect(day.natural_key).toBe(
      "s3:SLSTR-S3A:36.61530:8.00950:2026-08-31T09:29:00Z",
    );
  });

  it("still applies the burnable-ground gate to SLSTR", () => {
    const { rows, filtered } = parseWfsFireFeatures(s3, S3_SLSTR);
    expect(rows.length + filtered).toBe(2);
  });
});
