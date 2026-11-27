import { useEffect, useRef, useState } from "react";
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapMouseEvent,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { Compass, Crosshair, Minus, Plus } from "lucide-react";

import "@/lib/map-worker";
import type { AirportWeather } from "@/lib/airport-weather";
import type { Situation } from "@/lib/civil-map";
import { cn } from "@/lib/utils";
import { resolveMapStyle, type AtlasBasemap } from "@/ui/basemaps";

export type AtlasHazardMapProps = {
  basemap: AtlasBasemap;
  warningsGeo: FeatureCollection;
  officialGeo: FeatureCollection;
  reportsGeo: FeatureCollection;
  fires: Extract<Situation, { source: "satellite" }>[];
  stations?: AirportWeather[];
  showStations?: boolean;
  selectedId?: string | undefined;
  focusTarget?: { lat: number; lon: number; zoom?: number; key: number } | null;
  onSelectSituation: (id: string | undefined) => void;
  onLocate?: () => void;
  className?: string;
};

const ALGERIA_CENTER: [number, number] = [2.6, 32.4];
const ALGERIA_ZOOM = 4.9;

function buildFiresGeo(
  fires: Extract<Situation, { source: "satellite" }>[],
  selectedId?: string,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: fires
      .filter((f) => f.lat !== null && f.lon !== null)
      .map((f) => ({
        type: "Feature",
        id: f.id,
        geometry: { type: "Point", coordinates: [f.lon!, f.lat!] },
        properties: {
          situationId: f.id,
          level: f.level,
          frp: f.data.max_frp_mw ?? 10,
          selected: f.id === selectedId,
        },
      })),
  };
}

function buildStationsGeo(stations: AirportWeather[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stations
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s) => ({
        type: "Feature",
        id: s.station,
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: {
          station: s.station,
          label:
            s.temp_c !== null
              ? `${s.station} ${Math.round(s.temp_c)}°`
              : s.station,
        },
      })),
  };
}

export function AtlasHazardMap({
  basemap,
  warningsGeo,
  officialGeo,
  reportsGeo,
  fires,
  stations = [],
  showStations = false,
  selectedId,
  focusTarget,
  onSelectSituation,
  onLocate,
  className,
}: AtlasHazardMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleAppliedRef = useRef<AtlasBasemap>(basemap);
  const [ready, setReady] = useState(false);

  const latestDataRef = useRef({
    warningsGeo,
    officialGeo,
    reportsGeo,
    fires,
    stations,
    showStations,
    selectedId,
  });
  latestDataRef.current = {
    warningsGeo,
    officialGeo,
    reportsGeo,
    fires,
    stations,
    showStations,
    selectedId,
  };

  const onSelectRef = useRef(onSelectSituation);
  onSelectRef.current = onSelectSituation;

  function attachSourcesAndLayers(map: MapLibreMap) {
    const data = latestDataRef.current;
    const firesGeo = buildFiresGeo(data.fires, data.selectedId);
    const stationsGeo = buildStationsGeo(
      data.showStations ? data.stations : [],
    );

    if (!map.getSource("atlas-warnings")) {
      map.addSource("atlas-warnings", {
        type: "geojson",
        data: data.warningsGeo,
      });
    } else {
      (map.getSource("atlas-warnings") as GeoJSONSource).setData(
        data.warningsGeo,
      );
    }

    if (!map.getSource("atlas-official")) {
      map.addSource("atlas-official", {
        type: "geojson",
        data: data.officialGeo,
      });
    } else {
      (map.getSource("atlas-official") as GeoJSONSource).setData(
        data.officialGeo,
      );
    }

    if (!map.getSource("atlas-reports")) {
      map.addSource("atlas-reports", {
        type: "geojson",
        data: data.reportsGeo,
      });
    } else {
      (map.getSource("atlas-reports") as GeoJSONSource).setData(
        data.reportsGeo,
      );
    }

    if (!map.getSource("atlas-fires")) {
      map.addSource("atlas-fires", {
        type: "geojson",
        data: firesGeo,
      });
    } else {
      (map.getSource("atlas-fires") as GeoJSONSource).setData(firesGeo);
    }

    if (!map.getSource("atlas-stations")) {
      map.addSource("atlas-stations", {
        type: "geojson",
        data: stationsGeo,
      });
    } else {
      (map.getSource("atlas-stations") as GeoJSONSource).setData(stationsGeo);
    }

    if (!map.getLayer("atlas-warnings-fill")) {
      map.addLayer({
        id: "atlas-warnings-fill",
        type: "fill",
        source: "atlas-warnings",
        filter: ["==", ["get", "area"], true],
        paint: {
          "fill-color": [
            "match",
            ["get", "severity"],
            "extreme",
            "#E11D48",
            "severe",
            "#D97706",
            "moderate",
            "#CA8A04",
            "#0284C7",
          ],
          "fill-opacity": [
            "case",
            ["==", ["get", "selected"], true],
            0.4,
            ["==", ["get", "upcoming"], true],
            0.16,
            0.24,
          ],
        },
      });
    }

    if (!map.getLayer("atlas-warnings-casing")) {
      map.addLayer({
        id: "atlas-warnings-casing",
        type: "line",
        source: "atlas-warnings",
        filter: ["==", ["get", "area"], true],
        paint: {
          "line-color": "rgba(10, 22, 40, 0.55)",
          "line-width": 3.2,
          "line-opacity": 0.65,
        },
      });
    }

    if (!map.getLayer("atlas-warnings-line")) {
      map.addLayer({
        id: "atlas-warnings-line",
        type: "line",
        source: "atlas-warnings",
        filter: ["==", ["get", "area"], true],
        paint: {
          "line-color": [
            "match",
            ["get", "severity"],
            "extreme",
            "#FB7185",
            "severe",
            "#EA580C",
            "moderate",
            "#F59E0B",
            "#38BDF8",
          ],
          "line-width": ["case", ["==", ["get", "selected"], true], 2.8, 1.6],
          "line-opacity": 0.95,
        },
      });
    }

    if (!map.getLayer("atlas-warnings-points")) {
      map.addLayer({
        id: "atlas-warnings-points",
        type: "circle",
        source: "atlas-warnings",
        filter: ["==", ["get", "area"], false],
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 9, 6.5],
          "circle-color": [
            "match",
            ["get", "status"],
            "Extreme",
            "#E11D48",
            "Severe",
            "#D97706",
            "#CA8A04",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#FFFFFF",
        },
      });
    }

    if (!map.getLayer("atlas-official-points")) {
      map.addLayer({
        id: "atlas-official-points",
        type: "circle",
        source: "atlas-official",
        filter: ["==", ["get", "area"], false],
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 10, 7],
          "circle-color": [
            "match",
            ["get", "category"],
            "fire",
            "#E11D48",
            "flood",
            "#0284C7",
            "road",
            "#D97706",
            "#0A58FF",
          ],
          "circle-stroke-width": 2.2,
          "circle-stroke-color": "#FFFFFF",
        },
      });
    }

    if (!map.getLayer("atlas-seismic-ring")) {
      map.addLayer({
        id: "atlas-seismic-ring",
        type: "circle",
        source: "atlas-reports",
        filter: ["==", ["get", "source"], "seismic"],
        paint: {
          "circle-radius": 16,
          "circle-color": "rgba(124, 58, 237, 0.16)",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#A78BFA",
        },
      });
    }

    if (!map.getLayer("atlas-reports-points")) {
      map.addLayer({
        id: "atlas-reports-points",
        type: "circle",
        source: "atlas-reports",
        filter: ["==", ["get", "area"], false],
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "selected"], true],
            9.5,
            6.5,
          ],
          "circle-color": [
            "match",
            ["get", "source"],
            "seismic",
            "#7C3AED",
            "station",
            "#0284C7",
            "civil",
            "#D97706",
            "#38BDF8",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#FFFFFF",
        },
      });
    }

    if (!map.getLayer("atlas-fires-ring")) {
      map.addLayer({
        id: "atlas-fires-ring",
        type: "circle",
        source: "atlas-fires",
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "selected"], true],
            22,
            ["==", ["get", "level"], "confirmed"],
            17,
            13,
          ],
          "circle-color": "rgba(225, 29, 72, 0.14)",
          "circle-stroke-width": 1.6,
          "circle-stroke-color": [
            "match",
            ["get", "level"],
            "confirmed",
            "#FB7185",
            "probable",
            "#FBBF24",
            "#94A3B8",
          ],
        },
      });
    }

    if (!map.getLayer("atlas-fires-core")) {
      map.addLayer({
        id: "atlas-fires-core",
        type: "circle",
        source: "atlas-fires",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 8.5, 6],
          "circle-color": [
            "match",
            ["get", "level"],
            "confirmed",
            "#E11D48",
            "probable",
            "#D97706",
            "#64748B",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#FFFFFF",
        },
      });
    }

    if (!map.getLayer("atlas-stations-dot")) {
      map.addLayer({
        id: "atlas-stations-dot",
        type: "circle",
        source: "atlas-stations",
        paint: {
          "circle-radius": 5,
          "circle-color": "#0A58FF",
          "circle-stroke-width": 1.75,
          "circle-stroke-color": "#FFFFFF",
        },
      });
    }
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: resolveMapStyle(basemap),
      center: ALGERIA_CENTER,
      zoom: ALGERIA_ZOOM,
      minZoom: 4,
      maxZoom: 17,
      attributionControl: false,
    });
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");

    mapRef.current = map;
    styleAppliedRef.current = basemap;

    const interactiveLayers = [
      "atlas-fires-core",
      "atlas-fires-ring",
      "atlas-official-points",
      "atlas-reports-points",
      "atlas-warnings-points",
      "atlas-warnings-fill",
    ];

    map.on("load", () => {
      attachSourcesAndLayers(map);
      setReady(true);
    });

    map.on("click", (e: MapLayerMouseEvent) => {
      const existing = interactiveLayers.filter((id) => map.getLayer(id));
      if (!existing.length) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: existing });
      const top = hits[0];
      const sid = top?.properties?.["situationId"];
      if (typeof sid === "string" && sid.length > 0) {
        onSelectRef.current(sid);
      } else {
        onSelectRef.current(undefined);
      }
    });

    map.on("mousemove", (e: MapLayerMouseEvent) => {
      const existing = interactiveLayers.filter((id) => map.getLayer(id));
      if (!existing.length) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: existing });
      map.getCanvas().style.cursor = hits.length > 0 ? "pointer" : "";
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleAppliedRef.current === basemap) return;
    styleAppliedRef.current = basemap;
    const reattach = () => {
      try {
        attachSourcesAndLayers(map);
      } catch {
        // style not parsed yet
      }
    };
    map.once("style.load", reattach);
    map.setStyle(resolveMapStyle(basemap));
    const timer = window.setTimeout(reattach, 350);
    return () => {
      window.clearTimeout(timer);
      map.off("style.load", reattach);
    };
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      if (map.getStyle()) attachSourcesAndLayers(map);
    } catch {
      // style transition in flight
    }
  }, [
    ready,
    warningsGeo,
    officialGeo,
    reportsGeo,
    fires,
    stations,
    showStations,
    selectedId,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusTarget) return;
    map.flyTo({
      center: [focusTarget.lon, focusTarget.lat],
      zoom: focusTarget.zoom ?? 9,
      duration: 650,
    });
  }, [focusTarget]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <div ref={containerRef} className="h-full w-full" />

      {/* End-edge Tactical Zoom, Compass & Locate Stack */}
      <div className="pointer-events-auto absolute end-3 sm:end-4 top-16 md:top-5 z-20 flex flex-col gap-1.5">
        <div className="flex flex-col overflow-hidden rounded-xl border border-hairline-strong bg-surface-hud backdrop-blur-md shadow-lg">
          <button
            type="button"
            onClick={() => mapRef.current?.zoomIn({ duration: 220 })}
            aria-label="Zoom in"
            className="flex h-9 w-9 items-center justify-center text-ink hover:bg-surface-raised transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
          </button>
          <div className="h-px bg-hairline" />
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut({ duration: 220 })}
            aria-label="Zoom out"
            className="flex h-9 w-9 items-center justify-center text-ink hover:bg-surface-raised transition-colors cursor-pointer"
          >
            <Minus className="h-4 w-4" />
          </button>
          <div className="h-px bg-hairline" />
          <button
            type="button"
            onClick={() =>
              mapRef.current?.flyTo({
                center: ALGERIA_CENTER,
                zoom: ALGERIA_ZOOM,
                bearing: 0,
                pitch: 0,
                duration: 500,
              })
            }
            aria-label="Reset view to Algeria"
            className="flex h-9 w-9 items-center justify-center text-ink-secondary hover:bg-surface-raised hover:text-ink transition-colors cursor-pointer"
          >
            <Compass className="h-4 w-4" />
          </button>
        </div>

        {onLocate && (
          <button
            type="button"
            onClick={onLocate}
            aria-label="Locate my position"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-hairline-strong bg-surface-hud backdrop-blur-md text-signal hover:bg-surface-raised shadow-lg transition-colors cursor-pointer"
          >
            <Crosshair className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Compact embedded interactive map for dossier, fire detail, report, and zone pickers. */
export function MiniHazardMap({
  lat,
  lon,
  zoom = 10,
  radiusKm,
  interactive = false,
  markerColor = "#DC2626",
  basemap,
  onPick,
  className,
}: {
  lat: number;
  lon: number;
  zoom?: number;
  radiusKm?: number;
  interactive?: boolean;
  markerColor?: string;
  basemap?: AtlasBasemap;
  onPick?: (coords: { lat: number; lon: number }) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const isDark = document.documentElement.classList.contains("dark");
    const initialMode: AtlasBasemap = basemap ?? (isDark ? "night" : "terrain");
    const map = new MapLibreMap({
      container: containerRef.current,
      style: resolveMapStyle(initialMode),
      center: [lon, lat],
      zoom,
      attributionControl: { compact: true },
      interactive: true,
    });
    mapRef.current = map;

    const resize = () => map.resize();
    map.on("load", resize);
    const raf = requestAnimationFrame(resize);
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(containerRef.current);

    const pinEl = document.createElement("div");
    pinEl.style.width = "20px";
    pinEl.style.height = "20px";
    pinEl.style.borderRadius = "9999px";
    pinEl.style.backgroundColor = markerColor;
    pinEl.style.border = "3px solid #ffffff";
    pinEl.style.boxShadow = `0 0 0 6px ${markerColor}38, 0 4px 12px rgba(0,0,0,0.45)`;

    const marker = new Marker({
      element: pinEl,
      draggable: interactive,
    })
      .setLngLat([lon, lat])
      .addTo(map);
    markerRef.current = marker;

    if (interactive) {
      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        onPickRef.current?.({
          lat: Number(pos.lat.toFixed(5)),
          lon: Number(pos.lng.toFixed(5)),
        });
      });
      map.on("click", (e: MapMouseEvent) => {
        marker.setLngLat(e.lngLat);
        onPickRef.current?.({
          lat: Number(e.lngLat.lat.toFixed(5)),
          lon: Number(e.lngLat.lng.toFixed(5)),
        });
      });
    }

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    markerRef.current.setLngLat([lon, lat]);
    mapRef.current.easeTo({ center: [lon, lat], duration: 350 });
  }, [lat, lon, radiusKm]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-hairline bg-surface-raised h-64 w-full",
        className,
      )}
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
