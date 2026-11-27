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
import { EMPTY_FC } from "@/lib/satellite-layers";
import { cn } from "@/lib/utils";
import { resolveMapStyle, type AtlasBasemap } from "@/ui/basemaps";

export type AtlasHazardMapProps = {
  basemap: AtlasBasemap;
  warningsGeo: FeatureCollection;
  officialGeo: FeatureCollection;
  reportsGeo: FeatureCollection;
  fires: Extract<Situation, { source: "satellite" }>[];
  rainfallGeo?: FeatureCollection;
  lightningGeo?: FeatureCollection;
  gwisGeo?: FeatureCollection;
  gwisCentroidsGeo?: FeatureCollection;
  stations?: AirportWeather[];
  showStations?: boolean;
  selectedId?: string | undefined;
  focusTarget?: { lat: number; lon: number; zoom?: number; key: number } | null;
  onSelectSituation: (id: string | undefined) => void;
  onSelectGwis?: (eventId: string | undefined) => void;
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
  rainfallGeo = EMPTY_FC,
  lightningGeo = EMPTY_FC,
  gwisGeo = EMPTY_FC,
  gwisCentroidsGeo = EMPTY_FC,
  stations = [],
  showStations = false,
  selectedId,
  focusTarget,
  onSelectSituation,
  onSelectGwis,
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
    rainfallGeo,
    lightningGeo,
    gwisGeo,
    gwisCentroidsGeo,
    stations,
    showStations,
    selectedId,
  });
  latestDataRef.current = {
    warningsGeo,
    officialGeo,
    reportsGeo,
    fires,
    rainfallGeo,
    lightningGeo,
    gwisGeo,
    gwisCentroidsGeo,
    stations,
    showStations,
    selectedId,
  };

  const onSelectRef = useRef(onSelectSituation);
  onSelectRef.current = onSelectSituation;
  const onSelectGwisRef = useRef(onSelectGwis);
  onSelectGwisRef.current = onSelectGwis;

  function attachSourcesAndLayers(map: MapLibreMap) {
    const data = latestDataRef.current;
    const firesGeo = buildFiresGeo(data.fires, data.selectedId);
    const stationsGeo = buildStationsGeo(
      data.showStations ? data.stations : [],
    );

    const setOrAddSource = (id: string, fc: FeatureCollection) => {
      const existing = map.getSource(id) as GeoJSONSource | undefined;
      if (!existing) {
        map.addSource(id, { type: "geojson", data: fc });
      } else {
        existing.setData(fc);
      }
    };

    setOrAddSource("atlas-warnings", data.warningsGeo);
    setOrAddSource("atlas-rainfall", data.rainfallGeo);
    setOrAddSource("atlas-gwis", data.gwisGeo);
    setOrAddSource("atlas-gwis-centroids", data.gwisCentroidsGeo);
    setOrAddSource("atlas-lightning", data.lightningGeo);
    setOrAddSource("atlas-official", data.officialGeo);
    setOrAddSource("atlas-reports", data.reportsGeo);
    setOrAddSource("atlas-fires", firesGeo);
    setOrAddSource("atlas-stations", stationsGeo);

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

    // EUMETSAT H-SAF / NASA IMERG satellite rainfall observation field
    if (!map.getLayer("atlas-rainfall-halo")) {
      map.addLayer({
        id: "atlas-rainfall-halo",
        type: "circle",
        source: "atlas-rainfall",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            9,
            7,
            18,
            10,
            28,
          ],
          "circle-blur": 0.75,
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "rate_mm_h"],
            0.2,
            "#38BDF8",
            1.5,
            "#0EA5E9",
            4.0,
            "#2563EB",
            8.0,
            "#4F46E5",
            15.0,
            "#7C3AED",
          ],
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["get", "rate_mm_h"],
            0.1,
            0.22,
            1.5,
            0.38,
            6.0,
            0.55,
          ],
        },
      });
    }

    if (!map.getLayer("atlas-rainfall-cell")) {
      map.addLayer({
        id: "atlas-rainfall-cell",
        type: "circle",
        source: "atlas-rainfall",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            2.6,
            7,
            5.5,
            10,
            9,
          ],
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "rate_mm_h"],
            0.2,
            "#7DD3FC",
            1.5,
            "#38BDF8",
            4.0,
            "#3B82F6",
            8.0,
            "#6366F1",
            15.0,
            "#A855F7",
          ],
          "circle-opacity": 0.85,
        },
      });
    }

    // Copernicus EMS GWIS / EFFIS FIRMS-derived burned area perimeters (CC BY 4.0)
    if (!map.getLayer("atlas-gwis-fill")) {
      map.addLayer({
        id: "atlas-gwis-fill",
        type: "fill",
        source: "atlas-gwis",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#F43F5E",
            "#E11D48",
          ],
          "fill-opacity": [
            "case",
            ["==", ["get", "selected"], true],
            0.48,
            0.28,
          ],
        },
      });
    }

    if (!map.getLayer("atlas-gwis-outline")) {
      map.addLayer({
        id: "atlas-gwis-outline",
        type: "line",
        source: "atlas-gwis",
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#FFE4E6",
            "#FB7185",
          ],
          "line-width": ["case", ["==", ["get", "selected"], true], 3, 1.8],
          "line-opacity": 0.96,
        },
      });
    }

    if (!map.getLayer("atlas-gwis-centroid")) {
      map.addLayer({
        id: "atlas-gwis-centroid",
        type: "circle",
        source: "atlas-gwis-centroids",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            ["case", ["==", ["get", "selected"], true], 8, 4.5],
            9,
            ["case", ["==", ["get", "selected"], true], 10, 6],
            12,
            0,
          ],
          "circle-color": "rgba(225, 29, 72, 0.25)",
          "circle-stroke-width": [
            "case",
            ["==", ["get", "selected"], true],
            2.5,
            1.6,
          ],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#FFE4E6",
            "#FB7185",
          ],
        },
      });
    }

    // EUMETSAT MTG Lightning Imager L2 observations (distinct from wildfire)
    if (!map.getLayer("atlas-lightning-glow")) {
      map.addLayer({
        id: "atlas-lightning-glow",
        type: "circle",
        source: "atlas-lightning",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            7,
            8,
            11,
            11,
            15,
          ],
          "circle-blur": 0.65,
          "circle-color": "#FACC15",
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["get", "age_minutes"],
            0,
            0.52,
            45,
            0.34,
            120,
            0.18,
          ],
        },
      });
    }

    if (!map.getLayer("atlas-lightning-flash")) {
      map.addLayer({
        id: "atlas-lightning-flash",
        type: "circle",
        source: "atlas-lightning",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            2.5,
            8,
            3.8,
            11,
            5,
          ],
          "circle-color": "#FEF9C3",
          "circle-stroke-width": 1.4,
          "circle-stroke-color": "#F59E0B",
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["get", "age_minutes"],
            0,
            0.98,
            60,
            0.8,
            120,
            0.55,
          ],
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
      "atlas-gwis-centroid",
      "atlas-gwis-fill",
      "atlas-gwis-outline",
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
      const gwisId = top?.properties?.["gwisEventId"];
      if (typeof gwisId === "string" && gwisId.length > 0) {
        onSelectRef.current(undefined);
        onSelectGwisRef.current?.(gwisId);
        return;
      }
      const sid = top?.properties?.["situationId"];
      if (typeof sid === "string" && sid.length > 0) {
        onSelectGwisRef.current?.(undefined);
        onSelectRef.current(sid);
      } else {
        onSelectGwisRef.current?.(undefined);
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
    rainfallGeo,
    lightningGeo,
    gwisGeo,
    gwisCentroidsGeo,
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
