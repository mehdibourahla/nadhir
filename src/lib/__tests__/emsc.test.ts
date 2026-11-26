import { describe, expect, it } from "vitest";

import { locateEvents, parseEmsc } from "@/lib/ingest/emsc";
import sample from "./fixtures/emsc-sample.json";

const communes = [
  { id: "setif", lat: 36.19, lon: 5.41 },
  { id: "ghazaouet", lat: 35.1, lon: -1.86 },
  { id: "alger", lat: 36.75, lon: 3.05 },
];

describe("parseEmsc", () => {
  it("keeps earthquakes and drops events of unknown type", () => {
    const events = parseEmsc(sample);
    expect(events.map((e) => e.id)).toEqual([
      "20260603_0000366",
      "20260917_0000204",
      "20260925_0000204",
      "20260915_0000006",
    ]);
    expect(events[0]).toMatchObject({
      magnitude: 4.7,
      network: expect.any(String),
      region: "NORTHERN ALGERIA",
    });
  });

  it("reads an empty poll as no events and a malformed one as an error", () => {
    expect(parseEmsc(null)).toEqual([]);
    expect(() => parseEmsc({ features: "x" })).toThrow(/unexpected/);
  });

  it("rejects out-of-range WGS84 coordinates, implausible magnitudes, invalid timestamps, and null features while keeping valid boundary values", () => {
    const valid = {
      properties: {
        unid: "emsc-valid-edge",
        time: "2026-11-25T10:00:00Z",
        lat: -90,
        lon: 180,
        mag: 2.0,
        evtype: "ke",
        lastupdate: "not-a-date",
      },
    };
    const validNorthWest = {
      properties: {
        unid: "emsc-valid-nw",
        time: "2026-11-25T10:05:00Z",
        lat: 90,
        lon: -180,
        mag: 10.0,
        evtype: "se",
      },
    };
    const invalid = [
      null,
      {
        properties: {
          unid: "emsc-lat-neg999",
          time: "2026-11-25T10:00:00Z",
          lat: -999,
          lon: 3.0,
          mag: 4.1,
        },
      },
      {
        properties: {
          unid: "emsc-lat-91",
          time: "2026-11-25T10:00:00Z",
          lat: 91,
          lon: 3.0,
          mag: 4.1,
        },
      },
      {
        properties: {
          unid: "emsc-lon-181",
          time: "2026-11-25T10:00:00Z",
          lat: 36.7,
          lon: 181,
          mag: 4.1,
        },
      },
      {
        properties: {
          unid: "emsc-mag-nan",
          time: "2026-11-25T10:00:00Z",
          lat: 36.7,
          lon: 3.0,
          mag: Number.NaN,
        },
      },
      {
        properties: {
          unid: "emsc-mag-inf",
          time: "2026-11-25T10:00:00Z",
          lat: 36.7,
          lon: 3.0,
          mag: Number.POSITIVE_INFINITY,
        },
      },
      {
        properties: {
          unid: "emsc-mag-12",
          time: "2026-11-25T10:00:00Z",
          lat: 36.7,
          lon: 3.0,
          mag: 12,
        },
      },
      {
        properties: {
          unid: "emsc-bad-time",
          time: "not-a-date",
          lat: 36.7,
          lon: 3.0,
          mag: 3.4,
        },
      },
    ];

    const parsed = parseEmsc({ features: [valid, validNorthWest, ...invalid] });
    expect(parsed.map((e) => e.id)).toEqual([
      "emsc-valid-edge",
      "emsc-valid-nw",
    ]);
    expect(parsed[0]!.updated_at).toBe("2026-11-25T10:00:00Z");
  });

  it("rejects empty/whitespace unid, numeric/non-ISO timestamps, and calendar rollovers while accepting valid leap-day timestamps", () => {
    const parsed = parseEmsc({
      features: [
        {
          properties: {
            unid: "",
            time: "2026-11-25T10:00:00Z",
            lat: 36.7,
            lon: 3.0,
            mag: 3.5,
          },
        },
        {
          properties: {
            unid: "   ",
            time: "2026-11-25T10:00:00Z",
            lat: 36.7,
            lon: 3.0,
            mag: 3.5,
          },
        },
        {
          properties: {
            unid: "emsc-time-zero",
            time: "0",
            lat: 36.7,
            lon: 3.0,
            mag: 3.5,
          },
        },
        {
          properties: {
            unid: "emsc-feb-30",
            time: "2026-02-30T00:00:00Z",
            lat: 36.7,
            lon: 3.0,
            mag: 3.5,
          },
        },
        {
          properties: {
            unid: "emsc-leap-day",
            time: "2024-02-29T12:00:00Z",
            lastupdate: "2026-02-30T00:00:00Z",
            lat: 36.7,
            lon: 3.0,
            mag: 3.5,
          },
        },
      ],
    });
    expect(parsed.map((e) => e.id)).toEqual(["emsc-leap-day"]);
    expect(parsed[0]!.occurred_at).toBe("2024-02-29T12:00:00Z");
    expect(parsed[0]!.updated_at).toBe("2024-02-29T12:00:00Z");
  });
});

describe("locateEvents", () => {
  it("keeps what is within 100 km of an Algerian commune and names that commune", () => {
    const located = locateEvents(parseEmsc(sample), communes);
    expect(located.map((e) => [e.id, e.commune_id, e.offshore])).toEqual([
      ["20260603_0000366", "setif", false],
      ["20260917_0000204", "ghazaouet", false],
      ["20260915_0000006", "alger", true],
    ]);
  });
});
