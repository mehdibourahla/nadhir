import type { StyleSpecification } from "maplibre-gl";

export type AtlasBasemap = "terrain" | "satellite" | "night";

export const DARK_MATTER_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Real shaded-relief topographic cartography (Atlas mountains, Sahara relief, coastlines). */
export function terrainStyleSpec(): StyleSpecification {
  return {
    version: 8,
    name: "Nadhir Atlas Terrain",
    sources: {
      "esri-topo": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 18,
        attribution: "Esri, HERE, Garmin, OpenStreetMap",
      },
    },
    layers: [
      {
        id: "terrain-base",
        type: "raster",
        source: "esri-topo",
        paint: {
          "raster-saturation": -0.1,
          "raster-contrast": 0.06,
        },
      },
    ],
  };
}

export function satelliteStyleSpec(): StyleSpecification {
  return {
    version: 8,
    name: "Nadhir Atlas Satellite",
    sources: {
      "esri-imagery": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 18,
        attribution: "Esri, Maxar, Earthstar Geographics",
      },
      "esri-labels": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 18,
      },
    },
    layers: [
      {
        id: "satellite-base",
        type: "raster",
        source: "esri-imagery",
        paint: {
          "raster-saturation": -0.06,
          "raster-contrast": 0.1,
        },
      },
      {
        id: "satellite-boundaries-labels",
        type: "raster",
        source: "esri-labels",
        paint: {
          "raster-opacity": 0.88,
        },
      },
    ],
  };
}

export function resolveMapStyle(
  basemap: AtlasBasemap,
): string | StyleSpecification {
  if (basemap === "satellite") return satelliteStyleSpec();
  if (basemap === "night") return DARK_MATTER_STYLE_URL;
  return terrainStyleSpec();
}

export function defaultBasemapForTheme(): AtlasBasemap {
  if (typeof document === "undefined") return "terrain";
  return document.documentElement.classList.contains("dark")
    ? "night"
    : "terrain";
}
