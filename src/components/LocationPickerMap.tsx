import * as maplibregl from "maplibre-gl";
import "@/lib/map-worker";
import { MapPin } from "lucide-react";
import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

import { basemapStyle } from "@/lib/basemap";
import { radiusCircle } from "@/lib/zone-geometry";

export type PickerTarget = {
  lat: number;
  lon: number;
  zoom?: number;
  key: number;
};

type Props = {
  target: PickerTarget;
  radiusKm: number | null;
  label: string;
  onMove: (point: { lat: number; lon: number }, byUser: boolean) => void;
};

const accent = () =>
  getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim() || "#03332c";

function paintArea(map: maplibregl.Map, lat: number, lon: number, km: number) {
  const data = radiusCircle(lat, lon, km);
  const source = map.getSource("area") as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource("area", { type: "geojson", data });
  map.addLayer({
    id: "area-fill",
    type: "fill",
    source: "area",
    paint: { "fill-color": accent(), "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: "area-line",
    type: "line",
    source: "area",
    paint: { "line-color": accent(), "line-width": 2 },
  });
}

export default function LocationPickerMap({
  target,
  radiusKm,
  label,
  onMove,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const radius = useRef(radiusKm);
  const move = useRef(onMove);
  const place = useRef(target);
  radius.current = radiusKm;
  move.current = onMove;
  place.current = target;

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: basemapStyle(),
      center: [place.current.lon, place.current.lat],
      zoom: place.current.zoom ?? 9,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    const draw = () => {
      if (radius.current === null) return;
      const c = map.getCenter();
      paintArea(map, c.lat, c.lng, radius.current);
    };
    map.on("load", draw);
    map.on("style.load", draw);
    map.on("move", () => {
      if (map.isStyleLoaded()) draw();
    });
    map.on("moveend", (event) => {
      const c = map.getCenter();
      move.current({ lat: c.lat, lon: c.lng }, !!event.originalEvent);
    });
    let style = basemapStyle();
    const observer = new MutationObserver(() => {
      const next = basemapStyle();
      if (next === style) return;
      style = next;
      map.setStyle(next);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { lat, lon, zoom } = place.current;
    map.jumpTo({ center: [lon, lat], ...(zoom === undefined ? {} : { zoom }) });
  }, [target.key]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || radiusKm === null || !map.isStyleLoaded()) return;
    const c = map.getCenter();
    paintArea(map, c.lat, c.lng, radiusKm);
    const bounds = new maplibregl.LngLatBounds();
    for (const [lon, lat] of radiusCircle(c.lat, c.lng, radiusKm)
      .coordinates[0]!)
      bounds.extend([lon!, lat!]);
    map.fitBounds(bounds, { padding: 32, duration: 200 });
  }, [radiusKm]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        role="application"
        aria-label={label}
        className="h-full w-full"
      />
      <MapPin
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 size-9 -translate-x-1/2 -translate-y-full fill-(--accent) text-(--accent-ink) drop-shadow"
        strokeWidth={1.5}
      />
    </div>
  );
}
