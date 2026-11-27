import { ClientOnly } from "@tanstack/react-router";
import { Component, Suspense, lazy, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { FeatureCollection } from "geojson";

import type { MapLayers, MapPadding } from "./FireMap";
import type { FireCluster } from "@/lib/nadhir";
import type { FireLevel } from "@/lib/fire-confidence";
import type { RoadHint } from "@/lib/civil-map";

const FireMap = lazy(() => import("./FireMap"));

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

export function MapSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t("common.loading")}
      className="h-full w-full animate-pulse bg-muted"
    />
  );
}

export class MapBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    onError: (() => void) | undefined;
  },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError?.();
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function MapCanvas(props: Props) {
  const { t } = useTranslation();
  return (
    <MapBoundary
      onError={props.onError}
      fallback={
        <p role="status" className="p-4">
          {t("common.error")}
        </p>
      }
    >
      <ClientOnly fallback={<MapSkeleton />}>
        <Suspense fallback={<MapSkeleton />}>
          <FireMap {...props} />
        </Suspense>
      </ClientOnly>
    </MapBoundary>
  );
}
