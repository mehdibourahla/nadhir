import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { FireCluster } from "@/lib/nadhir";
import { Route } from "@/routes/fire.$id";
import { TooltipProvider } from "@/components/ui/tooltip";

const { candidate } = vi.hoisted(() => ({
  candidate: {
    id: "candidate-id",
    short_id: "CANDIDATE",
    state: "unconfirmed",
    confirmed_at: null,
    confirmed_mention_id: null,
    first_detected_at: "2026-09-15T12:00:00Z",
    last_detected_at: "2026-09-15T12:00:00Z",
    lat: 36.5,
    lon: 3.5,
    detection_count: 1,
    sources: ["firms"],
    max_frp_mw: 5,
    confidence: 70,
    est_area_ha: null,
    fci_growth: null,
    wind_speed_kmh: null,
    wind_dir_deg: null,
    spread_bearing_deg: null,
    wind_gust_kmh: null,
    vpd_kpa: null,
    soil_moisture_m3m3: null,
    commune_id: null,
    wilaya_id: null,
    nearest_settlement_id: null,
    nearest_settlement_km: null,
    resolved_at: null,
  } satisfies FireCluster,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "cluster")
      return {
        data: {
          cluster: candidate,
          detections: [],
          events: [],
          confirmation: null,
        },
        isLoading: false,
      };
    if (["admin_units", "settlements", "zones"].includes(queryKey[0] ?? ""))
      return { data: [], isLoading: false };
    throw new Error(`Unexpected query: ${queryKey.join("/")}`);
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useParams: () => ({ id: "CANDIDATE" }),
  }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  notFound: () => new Error("Not found"),
}));
vi.mock("@/components/MapCanvas", async () => {
  const { visibleMapFires } = await import("./map-fire-filter");
  const { DEFAULT_MAP_LAYERS } = await import("./map-layers");
  return {
    MapCanvas: ({
      clusters,
      layers = DEFAULT_MAP_LAYERS,
    }: {
      clusters: FireCluster[];
      layers?: typeof DEFAULT_MAP_LAYERS;
    }) => (
      <div data-map>
        {visibleMapFires(clusters, layers.unverified).map((fire) => (
          <span key={fire.id} data-map-fire={fire.short_id} />
        ))}
      </div>
    ),
  };
});
vi.mock("@/components/SiteChrome", () => ({ EmergencyNumbers: () => null }));
vi.mock("@/components/nadhir/AirQualityCard", () => ({
  AirQualityCard: () => null,
}));

it("keeps a candidate visible on its own detail map", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      {createElement(Route.options.component as ComponentType)}
    </TooltipProvider>,
  );
  expect(html).toContain('data-map-fire="CANDIDATE"');
});
