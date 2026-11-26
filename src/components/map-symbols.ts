import type { FeatureCollection } from "geojson";
import type { SymbolLayerSpecification } from "maplibre-gl";
import type { Confidence } from "@/lib/fire-confidence";

export const BADGE_SIZE = 32;
export const SYMBOLS = [
  "fire",
  "official",
  "road",
  "rescue",
  "observation",
  "weather",
  "quake",
] as const;
export type MapSymbol = (typeof SYMBOLS)[number];
export const CONFIDENCES = ["official", "corroborated", "single"] as const;

const paths: Record<MapSymbol, string> = {
  fire: "M12 3C13 7 18 8 18 14a6 6 0 0 1-12 0c0-3 2-5 4-7 0 3 1 4 2 4 2-2 1-5 0-8Z",
  official:
    "M12 2 21 6v6c0 6-9 10-9 10S3 18 3 12V6Z M12 7c1 3 4 3 4 6a4 4 0 0 1-8 0c0-2 2-3 2-3 0 2 1 2 2-3Z",
  road: "M7 3 4 21M17 3l3 18M12 3v4m0 3v4m0 3v4M3 11h18",
  rescue: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z",
  observation:
    "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  weather:
    "M7 16H6a4 4 0 0 1-1-8 6 6 0 0 1 11-2 5 5 0 0 1 2 10h-1M13 11l-4 7h5l-3 5",
  quake: "M2 12h4l2-6 4 12 3-9 2 3h5",
};
// only an authority is red; Nadhir's own evidence tops out at orange
const colors: Record<Confidence, string> = {
  official: "#b3261e",
  corroborated: "#d9730d",
  single: "#6b7780",
};

export const badgeImage = (
  symbol: MapSymbol,
  confidence: Confidence,
  selected: boolean,
) => `${symbol}-${confidence}${selected ? "-selected" : ""}`;

export function symbolFor(
  kind: "official" | "reports" | "warnings",
  properties: Record<string, unknown>,
): MapSymbol {
  if (kind === "official") return "official";
  if (kind === "warnings") return "weather";
  if (properties["source"] === "seismic") return "quake";
  if (properties["source"] === "station") return "weather";
  // citizen features carry the classifier's category, not the tapped kind
  if (properties["source"] === "citizen")
    return properties["category"] === "road" ? "road" : "observation";
  if (properties["source"] === "civil") {
    const category = properties["category"];
    if (category === "flood") return "weather";
    return category === "fire" || category === "road" || category === "weather"
      ? category
      : "observation";
  }
  const hazard = String(
    properties["kind"] ?? properties["hazard_type"] ?? properties["type"] ?? "",
  );
  if (hazard === "road_blocked" || hazard === "blocked_road") return "road";
  if (hazard === "person_trapped" || hazard === "trapped") return "rescue";
  if (hazard === "fire") return "fire";
  return "observation";
}

export function prepareSymbols(
  data: FeatureCollection,
  kind: "official" | "reports" | "warnings",
  selectedId?: string | null,
): FeatureCollection {
  return {
    ...data,
    features: data.features.map((feature) => {
      const properties = feature.properties ?? {};
      const selected =
        selectedId === undefined
          ? properties["selected"] === true
          : properties["id"] === selectedId;
      const confidence = (CONFIDENCES as readonly unknown[]).includes(
        properties["confidence"],
      )
        ? (properties["confidence"] as Confidence)
        : "single";
      return {
        ...feature,
        properties: {
          ...properties,
          selected,
          icon: badgeImage(symbolFor(kind, properties), confidence, selected),
        },
      };
    }),
  };
}

export function pointSymbolLayer(
  id: string,
  source: string,
  selected = false,
): SymbolLayerSpecification {
  return {
    id,
    source,
    type: "symbol",
    filter: [
      "all",
      ["==", ["geometry-type"], "Point"],
      ["!", ["has", "point_count"]],
      ["==", ["boolean", ["get", "selected"], false], selected],
    ],
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": 1,
      "icon-padding": 4,
      "icon-allow-overlap": selected,
      "symbol-sort-key": [
        "case",
        ["boolean", ["get", "selected"], false],
        -1,
        0,
      ],
      "text-field": [
        "step",
        ["zoom"],
        "",
        10,
        ["slice", ["coalesce", ["get", "label"], ""], 0, 26],
      ],
      "text-size": 11,
      "text-font": ["Open Sans Semibold"],
      "text-offset": [0, 2.2],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": "#263b49",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2,
    },
  };
}

export function drawBadge(
  symbol: MapSymbol,
  confidence: Confidence,
  selected: boolean,
): ImageData {
  const size = BADGE_SIZE;
  const color = colors[confidence];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Map icon canvas unavailable");
  context.scale(2, 2);
  context.beginPath();
  context.roundRect(2, 2, size - 4, size - 4, 8);
  context.fillStyle = selected ? color : "#ffffff";
  context.fill();
  context.strokeStyle = selected ? "#ffffff" : color;
  context.lineWidth = selected ? 3 : 1.5;
  context.stroke();
  context.translate(6, 6);
  context.scale(20 / 24, 20 / 24);
  context.strokeStyle = selected ? "#ffffff" : color;
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke(new Path2D(paths[symbol]));
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
