import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Compass,
  MapPin,
  PhoneCall,
  ShieldAlert,
  Wifi,
  WifiOff,
} from "lucide-react";

import type { Locale } from "@/i18n";
import { adminUnitsQuery, settlementsQuery } from "@/lib/nadhir";
import { openAreasQuery } from "@/lib/open-areas";
import { titledMeta } from "@/lib/page-meta";
import {
  EMERGENCY_HAZARDS,
  parseEmergencyHazard,
  positionCard,
  type EmergencyHazardKind,
} from "@/lib/survival";
import {
  deviceStorage,
  loadPack,
  type SurvivalPack,
} from "@/lib/survival-pack";
import { cn } from "@/lib/utils";
import { AtlasPageFooter } from "@/ui/app-shell";
import {
  AlgiersClock,
  AtlasBadge,
  AtlasButton,
  AtlasMasthead,
  EmergencyDialBar,
  SafeBdi,
} from "@/ui/primitives";
import { SurvivalContext } from "@/ui/survival-context";

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
  const locale = (
    i18n.language === "fr" || i18n.language === "en" ? i18n.language : "ar"
  ) as Locale;
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const location = useLocation();

  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(
    null,
  );
  const [positionDenied, setPositionDenied] = useState(false);
  const [pack] = useState<SurvivalPack | null>(() =>
    typeof window !== "undefined" ? loadPack(deviceStorage) : null,
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  function requestPosition() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator))
      return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPositionDenied(false);
        setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => setPositionDenied(true),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const unitsQ = useQuery({ ...adminUnitsQuery, enabled: online });
  const settlementsQ = useQuery({ ...settlementsQuery, enabled: online });
  const openAreasQ = useQuery({ ...openAreasQuery, enabled: online });

  const card = useMemo(() => {
    if (position && unitsQ.data && settlementsQ.data) {
      return positionCard(
        position.lat,
        position.lon,
        unitsQ.data,
        settlementsQ.data,
        locale,
      );
    }
    if (pack) {
      return {
        commune: pack.commune,
        wilaya: pack.wilaya,
        nearest: pack.nearest,
        coords: pack.coords,
      };
    }
    return null;
  }, [position, unitsQ.data, settlementsQ.data, locale, pack]);

  const hazard: EmergencyHazardKind = search.hazard ?? "general";

  function setHazard(next: EmergencyHazardKind) {
    void navigate({
      search: (prev) => {
        if (next === "general") {
          const { hazard: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, hazard: next };
      },
      replace: true,
    });
  }

  const tabs = [
    {
      to: "/survival" as const,
      label:
        locale === "ar"
          ? "الإرشادات"
          : locale === "fr"
            ? "Protocoles"
            : "Protocols",
      Icon: ShieldAlert,
      active:
        location.pathname === "/survival" || location.pathname === "/survival/",
    },
    {
      to: "/survival/areas" as const,
      label: t("survival.areasTitle"),
      Icon: Compass,
      active: location.pathname.startsWith("/survival/areas"),
    },
    {
      to: "/survival/checkin" as const,
      label: t("survival.checkinTitle"),
      Icon: CheckCircle2,
      active: location.pathname.startsWith("/survival/checkin"),
    },
    {
      to: "/survival/sos" as const,
      label: t("survival.sos"),
      Icon: PhoneCall,
      active: location.pathname.startsWith("/survival/sos"),
    },
  ];

  return (
    <SurvivalContext.Provider
      value={{
        online,
        hazard,
        offshoreM5: Boolean(search.offshoreM5),
        setHazard,
        position,
        positionDenied,
        requestPosition,
        card,
        pack,
        openAreas: openAreasQ.data ?? pack?.openAreas ?? [],
      }}
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-5 pb-12 space-y-6">
        <AtlasMasthead
          edition={
            <>
              <AtlasBadge tone={online ? "clear" : "extreme"} dot>
                {online ? (
                  <>
                    <Wifi className="h-3 w-3" />
                    {t("survival.online")}
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3 w-3" />
                    Offline
                  </>
                )}
              </AtlasBadge>
              <span>·</span>
              <AlgiersClock />
            </>
          }
          title={t("survival.mode")}
          subtitle={
            card
              ? `${card.commune ?? card.coords}${card.wilaya ? ` · ${card.wilaya}` : ""}`
              : t("survival.noPosition")
          }
          actions={
            <AtlasButton
              variant="secondary"
              size="sm"
              onClick={requestPosition}
            >
              <MapPin className="h-4 w-4 text-signal" />
              {position
                ? locale === "ar"
                  ? "تحديث الموقع"
                  : locale === "fr"
                    ? "Actualiser GPS"
                    : "Refresh GPS"
                : locale === "ar"
                  ? "تحديد موقعي"
                  : locale === "fr"
                    ? "Localiser"
                    : "Locate me"}
            </AtlasButton>
          }
        />

        {/* Immediate 1-Tap Algerian Official Emergency Dial Bar */}
        <EmergencyDialBar locale={locale} />

        {/* Sub-route Navigation + Hazard Selector */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-y border-hairline py-3.5">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5">
            {tabs.map((tab) => {
              const Icon = tab.Icon;
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={cn(
                    "inline-flex items-center justify-center sm:justify-start gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
                    tab.active
                      ? "bg-signal text-signal-ink"
                      : "bg-surface border border-hairline text-ink-secondary hover:text-ink",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1 border-t border-hairline pt-2.5 lg:border-t-0 lg:pt-0">
            {EMERGENCY_HAZARDS.map((h) => {
              const label =
                locale === "ar"
                  ? h === "general"
                    ? "عام"
                    : h === "fire"
                      ? "حريق"
                      : h === "flood"
                        ? "فيضان"
                        : h === "earthquake"
                          ? "زلزال"
                          : "عاصفة"
                  : locale === "fr"
                    ? h === "general"
                      ? "Général"
                      : h === "fire"
                        ? "Incendie"
                        : h === "flood"
                          ? "Inondation"
                          : h === "earthquake"
                            ? "Séisme"
                            : "Orage"
                    : h.charAt(0).toUpperCase() + h.slice(1);
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHazard(h)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                    hazard === h
                      ? "bg-hazard-extreme-soft text-hazard-extreme border border-hazard-extreme/30"
                      : "text-ink-secondary hover:bg-surface-raised",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {pack && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hazard-clear/30 bg-hazard-clear-soft px-4 py-2.5 text-xs text-ink">
            <span>
              {t("survival.packSaved", { time: pack.saved_at.slice(0, 16) })}
            </span>
            <SafeBdi className="font-mono text-ink-secondary">
              {pack.openAreas.length} areas
            </SafeBdi>
          </div>
        )}

        <Outlet />
        <AtlasPageFooter />
      </div>
    </SurvivalContext.Provider>
  );
}
