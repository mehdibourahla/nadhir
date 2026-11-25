import { useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Clock, ShieldAlert, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmergencyNumbers } from "@/components/SiteChrome";
import {
  SurvivalContext,
  type SurvivalState,
} from "@/components/survival/survival-context";
import type { Locale } from "@/i18n";
import {
  adminUnitsQuery,
  haversineKm,
  relativeTime,
  settlementsQuery,
} from "@/lib/nadhir";
import {
  SURVIVAL_ACTIVE_KEY,
  formatCoords,
  parseEmergencyHazard,
  positionCard,
  type EmergencyHazardKind,
  type PositionCard,
} from "@/lib/survival";
import {
  deviceStorage,
  loadPack,
  type SurvivalPack,
} from "@/lib/survival-pack";
import { titledMeta } from "@/lib/page-meta";

type SurvivalSearch = {
  hazard?: EmergencyHazardKind;
  offshoreM5?: boolean;
};

export const Route = createFileRoute("/survival")({
  ssr: false,
  validateSearch: (raw: Record<string, unknown>): SurvivalSearch => {
    const hazard =
      typeof raw["hazard"] === "string"
        ? parseEmergencyHazard(raw["hazard"])
        : undefined;
    const offshoreM5 =
      raw["offshoreM5"] === true || raw["offshoreM5"] === "true"
        ? true
        : undefined;
    return {
      ...(hazard ? { hazard } : {}),
      ...(offshoreM5 ? { offshoreM5 } : {}),
    };
  },
  head: () => ({
    meta: titledMeta("survival.mode"),
  }),
  component: SurvivalLayout,
});

function SurvivalLayout() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [online, setOnline] = useState(() => navigator.onLine);
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(
    null,
  );
  const [positionDenied, setPositionDenied] = useState(false);
  const [pack] = useState<SurvivalPack | null>(() => loadPack(deviceStorage));
  const [confirmExit, setConfirmExit] = useState(false);
  const [hazard, setHazard] = useState<EmergencyHazardKind>(
    () => search.hazard ?? "general",
  );

  useEffect(() => {
    if (search.hazard) setHazard(search.hazard);
  }, [search.hazard]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setPositionDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setPositionDenied(true),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }, []);

  // Static public admin units and settlements resolved strictly on-device (ADR-0006).
  const units = useQuery({
    ...adminUnitsQuery,
    enabled: online && position !== null,
    retry: online ? 2 : false,
  });
  const settlements = useQuery({
    ...settlementsQuery,
    enabled: online && position !== null,
    retry: online ? 2 : false,
  });

  const positionCardData = useMemo<PositionCard | null>(() => {
    if (!position) return null;
    if (units.data && settlements.data) {
      return positionCard(
        position.lat,
        position.lon,
        units.data,
        settlements.data,
        locale,
      );
    }
    // Offline fallback uses nearby saved pack metadata without ever substituting pack coords for GPS.
    const packDist = pack
      ? haversineKm(position.lat, position.lon, pack.lat, pack.lon)
      : Infinity;
    const nearby = pack && packDist < 2;
    return {
      commune: nearby ? pack.commune : null,
      wilaya: nearby ? pack.wilaya : null,
      nearest: nearby && packDist < 0.5 ? pack.nearest : null,
      coords: formatCoords(position.lat, position.lon),
    };
  }, [position, units.data, settlements.data, pack, locale]);

  const offshoreM5Plus = Boolean(search.offshoreM5);

  const state = useMemo<SurvivalState>(
    () => ({
      online,
      position,
      positionDenied,
      pack,
      hazard,
      setHazard,
      offshoreM5Plus,
      positionCardData,
    }),
    [
      online,
      position,
      positionDenied,
      pack,
      hazard,
      offshoreM5Plus,
      positionCardData,
    ],
  );

  return (
    <SurvivalContext.Provider value={state}>
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col bg-background">
        <header className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <ShieldAlert
              aria-hidden
              className="size-4 shrink-0"
              style={{ color: "var(--emergency-ink)" }}
            />
            <span className="truncate text-sm font-semibold text-foreground">
              {t("track3.emergency.sheetTitle")}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span
              className="flex items-center gap-1.5 text-xs"
              style={online ? undefined : { color: "var(--risk-ink-2)" }}
            >
              {online ? null : <WifiOff aria-hidden className="size-3.5" />}
              {online ? (
                <span className="text-muted-foreground">
                  {t("survival.online")}
                </span>
              ) : (
                <span className="font-semibold">{t("survival.offline")}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setConfirmExit(true)}
              className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
              <span>{t("survival.exit")}</span>
            </button>
          </span>
        </header>

        {online ? null : (
          <p
            role="status"
            className="flex items-center gap-2 px-4 py-2 text-xs"
            style={{
              backgroundColor: "var(--risk-tint-2)",
              color: "var(--risk-ink-2)",
            }}
          >
            <Clock aria-hidden className="size-3.5 shrink-0" />
            {t("survival.offlineBanner", {
              time: pack
                ? relativeTime(pack.saved_at, locale)
                : t("track3.emergency.noPackSaved"),
            })}
          </p>
        )}

        <div className="flex flex-1 flex-col gap-4 p-4">
          <Outlet />
        </div>

        <div className="p-4 pt-0">
          <EmergencyNumbers compact showSheetLink={false} />
        </div>

        {confirmExit ? (
          <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 sm:items-center">
            <div className="card-raised w-full max-w-sm p-5">
              <h2 className="font-display text-xl">
                {t("survival.exitTitle")}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("survival.exitBody")}
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      localStorage.removeItem(SURVIVAL_ACTIVE_KEY);
                    } catch {
                      // Storage denial must not block leaving Survival Mode.
                    }
                    void navigate({ to: "/" });
                  }}
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  {t("survival.exitYes")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmExit(false)}
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium"
                >
                  {t("survival.enterCancel")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </SurvivalContext.Provider>
  );
}
