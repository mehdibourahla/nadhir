import type { FeatureCollection } from "geojson";
import { fireConfidence, type FireLevel } from "@/lib/fire-confidence";
import { firePhase, isVisibleByDefault } from "@/lib/incident-lifecycle";
import { haversineKm, type FireCluster } from "@/lib/nadhir";
import { badgeImage } from "./map-symbols";

const PULSE_KM = 20;

export function fireFeatures(
  clusters: FireCluster[],
  selectedShortId: string | null | undefined,
  levels: ReadonlyMap<string, FireLevel>,
  userPosition: { lat: number; lon: number } | null | undefined,
  now = Date.now(),
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: clusters.map((fire) => {
      const selected = fire.short_id === selectedShortId;
      const level = levels.get(fire.id) ?? "heat_signal";
      const faded =
        fire.state === "false_positive" ||
        !isVisibleByDefault(firePhase(fire, now));
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [fire.lon, fire.lat] },
        properties: {
          id: fire.short_id,
          label: fire.short_id,
          selected,
          level,
          icon: badgeImage("fire", fireConfidence(level), selected),
          faded,
          minor: faded || level === "heat_signal",
          pulse:
            !faded &&
            level !== "heat_signal" &&
            !!userPosition &&
            haversineKm(
              userPosition.lat,
              userPosition.lon,
              fire.lat,
              fire.lon,
            ) <= PULSE_KM,
        },
      };
    }),
  };
}
