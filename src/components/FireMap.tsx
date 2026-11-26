import * as maplibregl from "maplibre-gl";
import "@/lib/map-worker";
import type { FilterSpecification } from "maplibre-gl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { basemapStyle } from "@/lib/basemap";
import type { FireCluster } from "@/lib/nadhir";
import type { FireLevel } from "@/lib/fire-confidence";
import { fireFeatures } from "./map-fires";
import type { RoadHint } from "@/lib/civil-map";
import { cutSegment, type LonLat } from "@/lib/road-segment";
import {
  DEFAULT_MAP_LAYERS,
  lightningTiles,
  lightningWindow,
  type MapLayers,
} from "./map-layers";
import { visibleMapFires } from "./map-fire-filter";
import {
  badgeImage,
  CONFIDENCES,
  drawBadge,
  pointSymbolLayer,
  prepareSymbols,
  SYMBOLS,
} from "./map-symbols";
import { drawPattern, PATTERNS, patternImage } from "./map-patterns";
export type { MapLayers } from "./map-layers";
export type MapPadding = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};
type Props = {
  clusters: FireCluster[];
  fireLevels?: ReadonlyMap<string, FireLevel>;
  userPosition?: { lat: number; lon: number } | null;
  roadHints?: RoadHint[];
  selectedShortId?: string | null;
  onSelect?: (cluster: FireCluster) => void;
  official?: FeatureCollection;
  selectedOfficialId?: string | null;
  onSelectOfficial?: (id: string) => void;
  reports?: FeatureCollection;
  selectedReportId?: string | null;
  onSelectReport?: (id: string) => void;
  warnings?: FeatureCollection;
  selectedWarningId?: string | null;
  onSelectWarning?: (id: string) => void;
  focus?: { lat: number; lon: number; zoom: number };
  padding?: MapPadding;
  onError?: () => void;
  onReady?: () => void;
  center?: [number, number];
  zoom?: number;
  interactive?: boolean;
  layers?: MapLayers;
};
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const NO_LEVELS: ReadonlyMap<string, FireLevel> = new Map();
const NO_HINTS: RoadHint[] = [];
const ROAD_MIN_ZOOM = 8;

function roadSegments(
  map: maplibregl.Map,
  hints: RoadHint[],
): FeatureCollection {
  if (!hints.length || !map.getSource("carto") || map.getZoom() < ROAD_MIN_ZOOM)
    return EMPTY;
  return {
    type: "FeatureCollection",
    features: hints.flatMap((hint) => {
      const lines = map
        .querySourceFeatures("carto", {
          sourceLayer: "transportation_name",
          filter: ["==", ["get", "ref"], hint.ref],
        })
        .flatMap((feature) =>
          feature.geometry.type === "LineString"
            ? [feature.geometry.coordinates as LonLat[]]
            : feature.geometry.type === "MultiLineString"
              ? (feature.geometry.coordinates as LonLat[][])
              : [],
        );
      const segment = cutSegment(lines, hint.anchor, { toward: hint.toward });
      return segment
        ? [
            {
              type: "Feature" as const,
              geometry: { type: "LineString" as const, coordinates: segment },
              properties: { id: hint.id },
            },
          ]
        : [];
    }),
  };
}
const POINT_LAYERS = [
  "fires-selected",
  "official-selected",
  "reports-selected",
  "warnings-selected",
  "fires-points",
  "fires-minor",
  "official-points",
  "reports-points",
  "warnings-points",
];
const MINOR_MIN_ZOOM = 7;
const ONM_COLOR = [
  "match",
  ["get", "severity"],
  "extreme",
  "#d64541",
  "severe",
  "#f2994a",
  "#f2c94c",
] as const;
const AREA_LAYERS = [
  "road-segments-line",
  "official-fill",
  "warnings-fill",
  "reports-fill",
];
const ZERO_PADDING: MapPadding = { top: 0, bottom: 0, left: 0, right: 0 };
function cameraOffset({
  top,
  bottom,
  left,
  right,
}: MapPadding): [number, number] {
  return [(left - right) / 2, (top - bottom) / 2];
}
function installLayers(map: maplibregl.Map) {
  if (!map.getSource("lightning")) {
    map.addSource("lightning", {
      type: "raster",
      tiles: [lightningTiles(lightningWindow(Date.now()))],
      tileSize: 256,
      attribution: "Lightning: EUMETSAT MTG",
    });
    map.addLayer({
      id: "lightning-raster",
      type: "raster",
      source: "lightning",
      layout: { visibility: "none" },
      paint: { "raster-opacity": 0.85 },
    });
  }
  for (const symbol of SYMBOLS)
    for (const confidence of CONFIDENCES)
      for (const selected of [false, true]) {
        const id = badgeImage(symbol, confidence, selected);
        if (!map.hasImage(id))
          map.addImage(id, drawBadge(symbol, confidence, selected), {
            pixelRatio: 2,
          });
      }
  for (const pattern of PATTERNS)
    if (!map.hasImage(patternImage(pattern)))
      map.addImage(patternImage(pattern), drawPattern(pattern), {
        pixelRatio: 2,
      });
  for (const source of ["official", "warnings", "reports", "fires"]) {
    if (!map.getSource(`${source}-selection`))
      map.addSource(`${source}-selection`, { type: "geojson", data: EMPTY });
    if (!map.getSource(source))
      map.addSource(source, { type: "geojson", data: EMPTY });
  }
  if (!map.getSource("warnings-areas")) {
    map.addSource("warnings-areas", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "warnings-fill",
      source: "warnings-areas",
      type: "fill",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": ONM_COLOR as unknown as string,
        "fill-opacity": [
          "case",
          ["boolean", ["get", "selected"], false],
          0.42,
          ["boolean", ["get", "upcoming"], false],
          0.12,
          0.26,
        ],
      },
    });
    map.addLayer({
      id: "warnings-texture",
      source: "warnings-areas",
      type: "fill",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-pattern": [
          "case",
          ["boolean", ["get", "upcoming"], false],
          patternImage("upcoming"),
          ["concat", "pattern-", ["coalesce", ["get", "event"], "other"]],
        ],
      },
    });
    map.addLayer({
      id: "warnings-outline",
      source: "warnings-areas",
      type: "line",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": ONM_COLOR as unknown as string,
        "line-opacity": 0.9,
        "line-width": ["case", ["boolean", ["get", "selected"], false], 2.5, 1],
      },
    });
  }
  for (const source of ["official", "reports"]) {
    if (!map.getSource(`${source}-areas`))
      map.addSource(`${source}-areas`, { type: "geojson", data: EMPTY });
    if (map.getLayer(`${source}-fill`)) continue;
    const color = source === "official" ? "#b3261e" : "#6b7780";
    map.addLayer({
      id: `${source}-fill`,
      source: `${source}-areas`,
      type: "fill",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": color,
        "fill-opacity": [
          "case",
          ["boolean", ["get", "selected"], false],
          0.12,
          0.04,
        ],
      },
    });
    map.addLayer({
      id: `${source}-outline`,
      source: `${source}-areas`,
      type: "line",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": color,
        "line-opacity": 0.65,
        "line-width": ["case", ["boolean", ["get", "selected"], false], 2.5, 1],
        "line-dasharray": [3, 2],
      },
    });
  }
  if (!map.getSource("road-segments")) {
    map.addSource("road-segments", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "road-segments-casing",
      source: "road-segments",
      type: "line",
      minzoom: ROAD_MIN_ZOOM,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 9 },
    });
    map.addLayer({
      id: "road-segments-line",
      source: "road-segments",
      type: "line",
      minzoom: ROAD_MIN_ZOOM,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#4b5563", "line-width": 5 },
    });
    map.addLayer({
      id: "road-segments-arrows",
      source: "road-segments",
      type: "symbol",
      minzoom: ROAD_MIN_ZOOM,
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 48,
        "text-field": "›",
        "text-font": ["Open Sans Semibold"],
        "text-size": 16,
        "text-keep-upright": false,
        "text-rotation-alignment": "map",
        "text-allow-overlap": true,
      },
      paint: { "text-color": "#ffffff" },
    });
  }
  if (!map.getLayer("fires-pulse"))
    map.addLayer({
      id: "fires-pulse",
      source: "fires",
      type: "circle",
      filter: ["boolean", ["get", "pulse"], false],
      paint: {
        "circle-radius": 18,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#d9730d",
        "circle-stroke-width": 2,
        "circle-stroke-opacity": 0.6,
      },
    });
  for (const source of ["official", "warnings", "reports", "fires"]) {
    if (map.getLayer(`${source}-points`)) continue;
    const layer = pointSymbolLayer(`${source}-points`, source);
    if (source === "fires") {
      layer.filter = [
        "all",
        layer.filter!,
        ["!", ["boolean", ["get", "minor"], false]],
      ] as FilterSpecification;
      const minor = pointSymbolLayer("fires-minor", "fires");
      minor.minzoom = MINOR_MIN_ZOOM;
      minor.filter = [
        "all",
        minor.filter!,
        ["boolean", ["get", "minor"], false],
      ] as FilterSpecification;
      minor.paint = {
        ...minor.paint,
        "icon-opacity": [
          "case",
          ["boolean", ["get", "faded"], false],
          0.45,
          0.85,
        ],
      };
      map.addLayer(minor);
    }
    map.addLayer(layer);
  }
  for (const source of ["official", "warnings", "reports", "fires"]) {
    if (!map.getLayer(`${source}-selected`))
      map.addLayer(
        pointSymbolLayer(`${source}-selected`, `${source}-selection`, true),
      );
  }
}
export default function FireMap({
  clusters,
  fireLevels = NO_LEVELS,
  userPosition,
  roadHints = NO_HINTS,
  selectedShortId,
  onSelect,
  official = EMPTY,
  selectedOfficialId,
  onSelectOfficial,
  reports = EMPTY,
  selectedReportId,
  onSelectReport,
  warnings = EMPTY,
  selectedWarningId,
  onSelectWarning,
  focus,
  padding = ZERO_PADDING,
  onError,
  onReady,
  center = [3.6, 35.8],
  zoom = 5.1,
  interactive = true,
  layers = DEFAULT_MAP_LAYERS,
}: Props) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const visibleClusters = useMemo(
    () => visibleMapFires(clusters, layers.unverified),
    [clusters, layers.unverified],
  );
  const data = useMemo(
    () => ({
      fires: fireFeatures(
        visibleClusters,
        selectedShortId,
        fireLevels,
        userPosition,
      ),
      official: prepareSymbols(official, "official", selectedOfficialId),
      reports: prepareSymbols(reports, "reports", selectedReportId),
      warnings: prepareSymbols(warnings, "warnings", selectedWarningId),
    }),
    [
      visibleClusters,
      selectedShortId,
      fireLevels,
      userPosition,
      official,
      selectedOfficialId,
      reports,
      selectedReportId,
      warnings,
      selectedWarningId,
    ],
  );
  const latest = useRef({
    data,
    roadHints,
    layers,
    visibleClusters,
    onSelect,
    onSelectOfficial,
    onSelectReport,
    onSelectWarning,
    onError,
    onReady,
    padding,
    focus,
  });
  useLayoutEffect(() => {
    latest.current = {
      data,
      roadHints,
      layers,
      visibleClusters,
      onSelect,
      onSelectOfficial,
      onSelectReport,
      onSelectWarning,
      onError,
      onReady,
      padding,
      focus,
    };
  });
  const initRef = useRef({ center, zoom, interactive });
  const syncRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!containerRef.current) return;
    let ready = false;
    let disposed = false;
    const fail = () => {
      setFailed(true);
      latest.current.onError?.();
    };
    let map: maplibregl.Map;
    try {
      const initial = initRef.current;
      const target = latest.current.focus;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyle(),
        center: target ? [target.lon, target.lat] : initial.center,
        zoom: target?.zoom ?? initial.zoom,
        minZoom: 3.5,
        interactive: initial.interactive,
        attributionControl: { compact: true },
      });
    } catch {
      fail();
      return;
    }
    mapRef.current = map;
    if (initRef.current.interactive)
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "bottom-left",
      );
    let lightningShown = lightningWindow(Date.now());
    const sync = () => {
      if (!ready) return;
      const current = latest.current;
      for (const source of [
        "fires",
        "official",
        "reports",
        "warnings",
      ] as const) {
        (
          map.getSource(source) as maplibregl.GeoJSONSource | undefined
        )?.setData({
          ...current.data[source],
          features: current.data[source].features.filter(
            (feature) =>
              feature.geometry.type === "Point" &&
              feature.properties?.["selected"] !== true,
          ),
        });
        (
          map.getSource(`${source}-selection`) as
            maplibregl.GeoJSONSource | undefined
        )?.setData({
          ...current.data[source],
          features: current.data[source].features.filter(
            (feature) =>
              feature.geometry.type === "Point" &&
              feature.properties?.["selected"] === true,
          ),
        });
        (
          map.getSource(`${source}-areas`) as
            maplibregl.GeoJSONSource | undefined
        )?.setData({
          ...current.data[source],
          features: current.data[source].features.filter(
            (feature) =>
              feature.geometry.type === "Polygon" ||
              feature.geometry.type === "MultiPolygon",
          ),
        });
        const visible = source === "warnings" || current.layers[source];
        for (const suffix of [
          "points",
          "minor",
          "pulse",
          "selected",
          "fill",
          "texture",
          "outline",
        ]) {
          const id = `${source}-${suffix}`;
          if (map.getLayer(id))
            map.setLayoutProperty(
              id,
              "visibility",
              visible ? "visible" : "none",
            );
        }
      }
      map.setLayoutProperty(
        "lightning-raster",
        "visibility",
        current.layers.lightning ? "visible" : "none",
      );
      const slot = lightningWindow(Date.now());
      if (current.layers.lightning && slot !== lightningShown) {
        lightningShown = slot;
        (map.getSource("lightning") as maplibregl.RasterTileSource).setTiles([
          lightningTiles(slot),
        ]);
      }
    };
    syncRef.current = sync;
    let drawnRoads = "";
    const drawRoads = () => {
      if (!ready) return;
      const segments = roadSegments(map, latest.current.roadHints);
      const key = JSON.stringify(segments);
      // setData re-renders and fires idle again, so only write real changes
      if (key === drawnRoads) return;
      drawnRoads = key;
      (
        map.getSource("road-segments") as maplibregl.GeoJSONSource | undefined
      )?.setData(segments);
    };
    map.on("idle", drawRoads);
    const timeout = window.setTimeout(() => {
      if (!ready) fail();
    }, 20000);
    map.on("error", (event) => {
      if (event.error?.message?.includes("WebGL")) fail();
    });
    map.on("style.load", () => {
      drawnRoads = "";
      try {
        installLayers(map);
      } catch {
        fail();
        return;
      }
      ready = true;
      sync();
      window.clearTimeout(timeout);
      setFailed(false);
      setLoaded(true);
      latest.current.onReady?.();
    });
    const featuresAt = (point: maplibregl.Point) => {
      const points = map.queryRenderedFeatures(point, {
        layers: POINT_LAYERS.filter((id) => map.getLayer(id)),
      });
      return points.length
        ? points
        : map.queryRenderedFeatures(point, {
            layers: AREA_LAYERS.filter((id) => map.getLayer(id)),
          });
    };
    map.on("click", (event) => {
      if (!ready) return;
      const feature = featuresAt(event.point)[0];
      if (!feature) return;
      const id = feature.properties["id"];
      if (typeof id !== "string") return;
      const current = latest.current;
      const source = feature.source.replace(/-(areas|selection)$/, "");
      if (source === "fires") {
        const fire = current.visibleClusters.find(
          (item) => item.short_id === id,
        );
        if (fire) current.onSelect?.(fire);
      } else if (source === "official") current.onSelectOfficial?.(id);
      else if (source === "reports") current.onSelectReport?.(id);
      else if (source === "warnings") current.onSelectWarning?.(id);
      else if (source === "road-segments") current.onSelectReport?.(id);
    });
    map.on("mousemove", (event) => {
      map.getCanvas().style.cursor =
        ready && featuresAt(event.point).length ? "pointer" : "";
    });
    let style = basemapStyle();
    const observer = new MutationObserver(() => {
      const next = basemapStyle();
      if (next === style) return;
      style = next;
      ready = false;
      map.setStyle(next);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(containerRef.current);
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      observer.disconnect();
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      syncRef.current = () => {};
    };
  }, []);
  useEffect(() => {
    syncRef.current();
  }, [data, layers]);
  const pulsing = data.fires.features.some((f) => f.properties?.["pulse"]);
  useEffect(() => {
    const map = mapRef.current;
    if (
      !loaded ||
      !map ||
      !pulsing ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    let frame = 0;
    const tick = (time: number) => {
      const phase = (time % 1600) / 1600;
      if (map.getLayer("fires-pulse")) {
        map.setPaintProperty("fires-pulse", "circle-radius", 14 + phase * 16);
        map.setPaintProperty(
          "fires-pulse",
          "circle-stroke-opacity",
          0.7 * (1 - phase),
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [loaded, pulsing]);
  const focusLat = focus?.lat;
  const focusLon = focus?.lon;
  const focusZoom = focus?.zoom;
  useEffect(() => {
    if (
      focusLat !== undefined &&
      focusLon !== undefined &&
      focusZoom !== undefined
    )
      mapRef.current?.easeTo({
        center: [focusLon, focusLat],
        zoom: focusZoom,
        offset: cameraOffset(latest.current.padding),
      });
  }, [focusLat, focusLon, focusZoom]);
  useEffect(() => {
    if (latest.current.focus) return;
    const map = mapRef.current;
    const target = latest.current.visibleClusters.find(
      (fire) => fire.short_id === selectedShortId,
    );
    if (map && target)
      map.easeTo({
        center: [target.lon, target.lat],
        zoom: Math.max(map.getZoom(), 8),
        offset: cameraOffset(latest.current.padding),
      });
  }, [selectedShortId]);
  return (
    <div
      className="relative h-full w-full"
      role="region"
      aria-label={t("nav.map")}
    >
      <div ref={containerRef} className="civil-map h-full w-full" />
      {(!loaded || failed) && (
        <p
          role="status"
          className="absolute inset-x-3 top-3 rounded-xl bg-surface p-3 text-sm"
        >
          {t(failed ? "common.error" : "common.loading")}
        </p>
      )}
      <style>{`.civil-map .maplibregl-ctrl-group {
        overflow: hidden; border: 1px solid var(--border); border-radius: 16px;
        background: color-mix(in srgb, var(--surface) 95%, transparent);
        color: var(--ink); box-shadow: 0 1px 3px #00000014; backdrop-filter: blur(12px);
      }
      .civil-map .maplibregl-ctrl-group button {
        width: 44px; height: 44px; background: transparent; color: inherit;
      }
      .civil-map .maplibregl-ctrl-group button + button { border-top: 1px solid var(--border); }
      .civil-map .maplibregl-ctrl-group button:not(:disabled):hover { background: var(--raised); }
      .civil-map .maplibregl-ctrl-group button:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
      .civil-map .maplibregl-ctrl-group button:disabled { opacity: 0.35; cursor: default; }
      .civil-map .maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon,
      .civil-map .maplibregl-ctrl-zoom-out .maplibregl-ctrl-icon { background-image: none; position: relative; }
      .civil-map .maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon::before,
      .civil-map .maplibregl-ctrl-zoom-out .maplibregl-ctrl-icon::before {
        content: ''; position: absolute; width: 14px; height: 2px; border-radius: 1px;
        background: currentColor; top: calc(50% - 1px); left: calc(50% - 7px);
      }
      .civil-map .maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon::after {
        content: ''; position: absolute; width: 2px; height: 14px; border-radius: 1px;
        background: currentColor; top: calc(50% - 7px); left: calc(50% - 1px);
      }
      .civil-map-page .maplibregl-ctrl-bottom-left { top: 220px; bottom: auto; left: auto; right: 12px; }
      .civil-map-page .maplibregl-ctrl-bottom-left .maplibregl-ctrl { margin: 0; }
      [dir="rtl"] .civil-map-page .maplibregl-ctrl-bottom-left { right: auto; left: 12px; }
      [dir="rtl"] .civil-map-page .maplibregl-ctrl-bottom-right { right: auto; left: 0; }
      [dir="rtl"] .civil-map-page .maplibregl-ctrl-bottom-right .maplibregl-ctrl { float: left; margin: 0 0 10px 10px; }
      [dir="rtl"] .civil-map-page .maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib { direction: ltr; }
      @media (min-width: 1024px) {
        .civil-map-page .maplibregl-ctrl-bottom-left { top: 224px; right: 16px; }
        [dir="rtl"] .civil-map-page .maplibregl-ctrl-bottom-left { right: auto; left: 16px; }
      }
      @media (max-height: 500px) and (max-width: 1023px) {
        .civil-map-page .civil-map-controls { flex-direction: row; }
        .civil-map-page .maplibregl-ctrl-bottom-left { top: 64px; }
      }`}</style>
    </div>
  );
}
