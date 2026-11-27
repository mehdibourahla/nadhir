import { describe, expect, it } from "vitest";

import {
  buildGwisBurnedGeoJSON,
  buildGwisCentroidGeoJSON,
  buildLightningGeoJSON,
  buildSatelliteRainfallGeoJSON,
  latestRainfallSnapshotBySource,
  type GwisBurnedArea,
  type LightningObservation,
  type SatelliteRainfallCell,
} from "@/lib/satellite-layers";

describe("satellite-layers pure builders", () => {
  it("keeps only the freshest valid_time snapshot per rainfall source_key", () => {
    const rows: SatelliteRainfallCell[] = [
      {
        source_key: "hsaf_rainfall",
        valid_time: "2026-11-27T01:15:00+00:00",
        lat: 36.7,
        lon: 3.05,
        rate_mm_h: 2.5,
        accum_mm_30m: 1.25,
        wilaya_code: "16",
      },
      {
        source_key: "hsaf_rainfall",
        valid_time: "2026-11-27T00:45:00+00:00",
        lat: 36.7,
        lon: 3.05,
        rate_mm_h: 0.9,
        accum_mm_30m: 0.45,
        wilaya_code: "16",
      },
      {
        source_key: "imerg_rainfall",
        valid_time: "2026-11-27T01:00:00+00:00",
        lat: 36.8,
        lon: 5.1,
        rate_mm_h: 4.1,
        accum_mm_30m: 2.05,
        wilaya_code: "06",
      },
    ];
    const latest = latestRainfallSnapshotBySource(rows);
    expect(latest).toHaveLength(2);
    expect(latest.map((r) => `${r.source_key}@${r.valid_time}`)).toEqual([
      "hsaf_rainfall@2026-11-27T01:15:00+00:00",
      "imerg_rainfall@2026-11-27T01:00:00+00:00",
    ]);
  });

  it("builds valid GeoJSON for rainfall, lightning, and GWIS burned polygons", () => {
    const rainGeo = buildSatelliteRainfallGeoJSON([
      {
        source_key: "hsaf_rainfall",
        valid_time: "2026-11-27T01:15:00Z",
        lat: 36.7,
        lon: 3.05,
        rate_mm_h: 3.2,
        accum_mm_30m: 1.6,
        wilaya_code: "16",
      },
      {
        source_key: "hsaf_rainfall",
        valid_time: "2026-11-27T01:15:00Z",
        lat: 36.7,
        lon: 3.1,
        rate_mm_h: 0,
        accum_mm_30m: 0,
        wilaya_code: "16",
      },
    ]);
    expect(rainGeo.features).toHaveLength(1);
    expect(rainGeo.features[0]?.properties?.["rate_mm_h"]).toBe(3.2);

    const nowMs = Date.parse("2026-11-27T02:00:00Z");
    const bolts: LightningObservation[] = [
      {
        source_key: "mtg_lightning",
        observed_at: "2026-11-27T01:45:00Z",
        lat: 37.1,
        lon: 4.2,
        product_type: "L2-AF",
        wilaya_code: "15",
      },
    ];
    const lightningGeo = buildLightningGeoJSON(bolts, nowMs);
    expect(lightningGeo.features).toHaveLength(1);
    expect(lightningGeo.features[0]?.properties?.["age_minutes"]).toBe(15);

    const areas: GwisBurnedArea[] = [
      {
        event_id: "871581",
        burn_start_at: "2026-11-21",
        burn_end_at: "2026-11-25",
        area_ha: 51,
        lat: 36.78,
        lon: 5.01,
        wilaya_code: "06",
        estimation_basis: "firms_derived_estimate",
        is_optical_scar: false,
        perimeter_geojson: {
          type: "Polygon",
          coordinates: [
            [
              [5.0, 36.77],
              [5.02, 36.77],
              [5.02, 36.79],
              [5.0, 36.79],
              [5.0, 36.77],
            ],
          ],
        },
      },
    ];
    const gwisGeo = buildGwisBurnedGeoJSON(areas, "871581");
    expect(gwisGeo.features).toHaveLength(1);
    expect(gwisGeo.features[0]?.properties?.["selected"]).toBe(true);
    expect(gwisGeo.features[0]?.properties?.["gwisEventId"]).toBe("871581");

    const centroids = buildGwisCentroidGeoJSON(areas, "871581");
    expect(centroids.features).toHaveLength(1);
    expect(centroids.features[0]?.geometry.coordinates).toEqual([5.01, 36.78]);
  });
});
