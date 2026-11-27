import { createFileRoute } from "@tanstack/react-router";

import { ZonesPage } from "@/components/zones/ZonesPage";
import { titledMeta } from "@/lib/page-meta";

type ZonesSearch = { lat?: number; lon?: number };

const coordinate = (value: unknown, limit: number) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined;
};

export const Route = createFileRoute("/_authenticated/zones")({
  validateSearch: (search: Record<string, unknown>): ZonesSearch => {
    const lat = coordinate(search["lat"], 90);
    const lon = coordinate(search["lon"], 180);
    return lat !== undefined && lon !== undefined ? { lat, lon } : {};
  },
  head: () => ({
    meta: titledMeta("nav.account"),
  }),
  component: ZonesPage,
});
