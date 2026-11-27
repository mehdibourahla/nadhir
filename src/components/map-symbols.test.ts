import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
  BADGE_SIZE,
  pointSymbolLayer,
  prepareSymbols,
  symbolFor,
} from "./map-symbols";

describe("civil map symbol contracts", () => {
  it("colors a badge by who reports it, defaulting to a single source", () => {
    const icons = (confidence?: string) =>
      prepareSymbols(
        {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [3, 36] },
              properties: { id: "r", kind: "road_blocked", confidence },
            },
          ],
        },
        "reports",
        null,
      ).features[0]?.properties?.["icon"];
    expect(icons("corroborated")).toBe("road-corroborated");
    expect(icons()).toBe("road-single");
    expect(icons("red")).toBe("road-single");
  });

  it("uses the reviewed civil hazard without giving media reports an official badge", () => {
    for (const [category, expected] of [
      ["road", "road"],
      ["weather", "weather"],
      ["flood", "weather"],
      ["fire", "fire"],
      ["other", "observation"],
    ])
      expect(symbolFor("reports", { source: "civil", category })).toBe(
        expected,
      );
  });
  it("draws a citizen report by its classified category, a fire sighting staying an observation", () => {
    expect(symbolFor("reports", { source: "citizen", category: "road" })).toBe(
      "road",
    );
    expect(symbolFor("reports", { source: "citizen", category: "fire" })).toBe(
      "observation",
    );
    expect(
      symbolFor("reports", { source: "citizen", category: "weather" }),
    ).toBe("observation");
  });
  it("distinguishes citizen observations, road obstruction and rescue from official fire", () => {
    expect(symbolFor("reports", { kind: "sighting", sighting: "flames" })).toBe(
      "observation",
    );
    expect(symbolFor("reports", { kind: "road_blocked" })).toBe("road");
    expect(symbolFor("reports", { kind: "person_trapped" })).toBe("rescue");
    expect(symbolFor("official", {})).toBe("official");
    expect(symbolFor("warnings", {})).toBe("weather");
  });

  it("selects both parts of an area record without replacing its geometry or identity", () => {
    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "warning:point",
          geometry: { type: "Point", coordinates: [3, 36] },
          properties: {
            id: "warning",
            selected: true,
            label: "Algiers",
            confidence: "official",
          },
        },
        {
          type: "Feature",
          id: "warning:area",
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [3, 36],
                  [4, 36],
                  [4, 37],
                  [3, 36],
                ],
              ],
            ],
          },
          properties: { id: "warning", selected: true, confidence: "official" },
        },
      ],
    };
    const selected = prepareSymbols(data, "warnings", "warning");
    expect(
      selected.features.map((feature) => feature.properties?.["icon"]),
    ).toEqual(["weather-official-selected", "weather-official-selected"]);
    expect(selected.features.map((feature) => feature.id)).toEqual([
      "warning:point",
      "warning:area",
    ]);
    expect(selected.features[1]?.geometry).toEqual(data.features[1]?.geometry);
    expect(
      prepareSymbols(data, "warnings", null).features.every(
        (feature) => feature.properties?.["selected"] === false,
      ),
    ).toBe(true);
    expect(data.features[0]?.properties?.["selected"]).toBe(true);
  });

  it("uses valid collision-aware symbols at fixed screen size and labels only at local zoom", () => {
    const layer = pointSymbolLayer("reports-points", "reports");
    expect(
      validateStyleMin({
        version: 8,
        glyphs: "https://example.com/{fontstack}/{range}.pbf",
        sources: {
          reports: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
        },
        layers: [layer],
      }),
    ).toEqual([]);
    expect(layer.layout?.["icon-size"]).toBe(1);
    expect(layer.layout?.["icon-allow-overlap"]).toBe(false);
    expect(
      pointSymbolLayer("reports-selected", "reports", true).layout?.[
        "icon-allow-overlap"
      ],
    ).toBe(true);
    expect(layer.layout?.["text-field"]).toEqual([
      "step",
      ["zoom"],
      "",
      10,
      ["slice", ["coalesce", ["get", "label"], ""], 0, 26],
    ]);
    expect(BADGE_SIZE).toBeLessThanOrEqual(36);
  });
});
