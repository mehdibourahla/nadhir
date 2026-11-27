import { ClientOnly } from "@tanstack/react-router";
import { Suspense, lazy, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { MapBoundary, MapSkeleton } from "./MapCanvas";

const LocationPickerMap = lazy(() => import("./LocationPickerMap"));

export type { PickerTarget } from "./LocationPickerMap";

export function LocationPicker(
  props: ComponentProps<typeof LocationPickerMap>,
) {
  const { t } = useTranslation();
  return (
    <MapBoundary
      onError={undefined}
      fallback={
        <p role="status" className="p-4">
          {t("common.error")}
        </p>
      }
    >
      <ClientOnly fallback={<MapSkeleton />}>
        <Suspense fallback={<MapSkeleton />}>
          <LocationPickerMap {...props} />
        </Suspense>
      </ClientOnly>
    </MapBoundary>
  );
}
