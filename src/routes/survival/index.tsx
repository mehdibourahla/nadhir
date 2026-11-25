import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  CheckCircle2,
  Clock,
  CloudLightning,
  Flame,
  MapPin,
  Phone,
  Waves,
  Wind,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmergencyDialBar } from "@/components/survival/EmergencyDialBar";
import { PositionCardBlock } from "@/components/survival/PositionCardBlock";
import { StandingGuidanceCard } from "@/components/survival/StandingGuidanceCard";
import { useSurvival } from "@/components/survival/survival-context";
import type { Locale } from "@/i18n";
import { earthquakesQuery } from "@/lib/earthquakes";
import {
  adminUnitsQuery,
  bearingLabel,
  clustersQuery,
  haversineKm,
  officialIncidentsQuery,
  onmVigilanceQuery,
  relativeTime,
} from "@/lib/nadhir";
import { hazardReportsQuery } from "@/lib/open-areas";
import type { ReportKind } from "@/lib/reports";
import {
  SURVIVAL_ACTIVE_KEY,
  SURVIVAL_LAST_CHECK_KEY,
  nearestThreat,
  selectEmergencyThreat,
  type EmergencyHazardKind,
} from "@/lib/survival";
import {
  deviceStorage,
  persistSurvivalFlag,
  readSurvivalFlag,
} from "@/lib/survival-pack";

export const Route = createFileRoute("/survival/")({
  component: SurvivalHub,
});

const REPORT_SHORTCUTS: ReadonlyArray<{ kind: ReportKind; key: string }> = [
  { kind: "sighting", key: "survival.reportFire" },
  { kind: "flooding", key: "track3.emergency.report.flood" },
  { kind: "storm_damage", key: "track3.emergency.report.storm" },
  { kind: "earthquake", key: "track3.emergency.report.earthquake" },
  { kind: "road_blocked", key: "survival.reportRoadBlocked" },
  { kind: "person_trapped", key: "survival.reportPersonTrapped" },
];

function dirWord(t: (k: string) => string, deg: number) {
  return t(`survival.dir.${bearingLabel(deg).toLowerCase()}`);
}

function SurvivalHub() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const {
    online,
    position,
    positionDenied,
    pack,
    hazard,
    setHazard,
    offshoreM5Plus,
    positionCardData,
  } = useSurvival();

  const [lastCheck] = useState(() =>
    readSurvivalFlag(deviceStorage, SURVIVAL_LAST_CHECK_KEY),
  );
  const [userPickedHazard, setUserPickedHazard] = useState(
    () => hazard !== "general",
  );
  const [storageFailed, setStorageFailed] = useState(false);

  const clusters = useQuery({
    ...clustersQuery,
    enabled: online,
    retry: online ? 2 : false,
  });
  const official = useQuery({
    ...officialIncidentsQuery,
    enabled: online,
    retry: online ? 2 : false,
  });
  const warnings = useQuery({
    ...onmVigilanceQuery,
    enabled: online,
    retry: online ? 2 : false,
  });
  const earthquakes = useQuery({
    ...earthquakesQuery,
    enabled: online,
    retry: online ? 2 : false,
  });
  const units = useQuery({
    ...adminUnitsQuery,
    enabled: online,
    retry: online ? 2 : false,
  });
  const hazards = useQuery({
    ...hazardReportsQuery,
    enabled: online,
    retry: online ? 2 : false,
  });

  useEffect(() => {
    const nowIso = new Date().toISOString();
    const okActive = persistSurvivalFlag(
      deviceStorage,
      SURVIVAL_ACTIVE_KEY,
      nowIso,
    );
    const okCheck = persistSurvivalFlag(
      deviceStorage,
      SURVIVAL_LAST_CHECK_KEY,
      nowIso,
    );
    if (!okActive || !okCheck) setStorageFailed(true);
  }, []);

  const fireThreat = useMemo(
    () =>
      position && clusters.data
        ? nearestThreat(position.lat, position.lon, clusters.data)
        : null,
    [position, clusters.data],
  );

  const detectedThreat = useMemo(
    () =>
      position
        ? selectEmergencyThreat(position.lat, position.lon, {
            fires: clusters.data ?? [],
            official: official.data ?? [],
            warnings: warnings.data ?? [],
            earthquakes: earthquakes.data ?? [],
            units: units.data ?? [],
          })
        : null,
    [
      position,
      clusters.data,
      official.data,
      warnings.data,
      earthquakes.data,
      units.data,
    ],
  );

  useEffect(() => {
    if (!userPickedHazard && hazard === "general" && detectedThreat) {
      setHazard(detectedThreat.hazard);
    }
  }, [userPickedHazard, hazard, detectedThreat, setHazard]);

  const effectiveOffshoreM5 =
    offshoreM5Plus || Boolean(detectedThreat?.offshoreM5Plus);

  const changes = useMemo(() => {
    if (!lastCheck) return null;
    const fires = (clusters.data ?? []).filter(
      (c) => c.last_detected_at > lastCheck,
    ).length;
    const reports = (hazards.data ?? []).filter(
      (r) => r.created_at > lastCheck,
    ).length;
    if (fires === 0 && reports === 0) return null;
    return { fires, reports };
  }, [lastCheck, clusters.data, hazards.data]);

  // Saved offline fire threat is only shown when live data is unavailable and user is nearby.
  const offlineThreat = useMemo(() => {
    const saved = pack?.threats[0];
    if (fireThreat || !saved || clusters.data || !position) return null;
    if (
      position &&
      pack &&
      haversineKm(position.lat, position.lon, pack.lat, pack.lon) > 2
    )
      return null;
    return saved;
  }, [fireThreat, pack, clusters.data, position]);

  const handleSelectHazard = (next: EmergencyHazardKind) => {
    setUserPickedHazard(true);
    setHazard(next);
  };

  return (
    <>
      {storageFailed ? (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm">
          {t("survival.packStorageFailed")}
        </p>
      ) : null}

      {/* Section 1: Universal Emergency Tools (all hazards, works offline) */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl leading-tight">
            {t("track3.emergency.sheetTitle")}
          </h1>
          <p className="text-xs font-medium text-muted-foreground">
            {t("track3.emergency.universalSection")}
          </p>
        </div>

        <EmergencyDialBar />

        <PositionCardBlock
          card={positionCardData}
          online={online}
          positionDenied={positionDenied}
          compact
        />

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Link
            to="/survival/sos"
            className="card flex min-h-12 items-center justify-center gap-2 px-3 text-sm font-semibold hover:bg-muted"
          >
            <Phone aria-hidden className="size-4 shrink-0" />
            <span>
              {t("survival.sos")} ·{" "}
              <span dir="ltr" className="tabular-nums">
                14
              </span>
            </span>
          </Link>
          <Link
            to="/survival/checkin"
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold"
            style={{
              backgroundColor: "var(--accent-tint)",
              color: "var(--accent)",
            }}
          >
            <CheckCircle2 aria-hidden className="size-4 shrink-0" />
            <span>{t("survival.checkinTitle")}</span>
          </Link>
          <Link
            to="/survival/areas"
            className="card flex min-h-12 items-center justify-center gap-2 px-3 text-sm font-semibold hover:bg-muted"
          >
            <MapPin aria-hidden className="size-4 shrink-0" />
            <span>{t("survival.areasTitle")}</span>
          </Link>
        </div>
      </section>

      {/* Section 2: Hazard-Specific Standing Guidance (strictly isolated per hazard) */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-muted-foreground">
          {t("track3.emergency.guidanceSection")}
        </h2>
        <StandingGuidanceCard
          hazard={hazard}
          offshoreM5Plus={effectiveOffshoreM5}
          online={online}
          onSelectHazard={handleSelectHazard}
        />
      </section>

      {/* Section 3: Hazard-Aware Observations with age & attribution */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-muted-foreground">
          {online ? t("survival.knows") : t("survival.lastKnown")}
        </h2>

        {detectedThreat && detectedThreat.hazard !== "fire" ? (
          <FactRow
            icon={
              detectedThreat.hazard === "flood" ? (
                <Waves aria-hidden className="size-4.5" />
              ) : detectedThreat.hazard === "earthquake" ? (
                <Activity aria-hidden className="size-4.5" />
              ) : (
                <CloudLightning aria-hidden className="size-4.5" />
              )
            }
            tint
            title={
              detectedThreat.hazard === "earthquake"
                ? t("track3.emergency.observations.quakeNear", {
                    magnitude: (detectedThreat.magnitude ?? 4).toFixed(1),
                    km: (detectedThreat.km ?? 0).toFixed(1),
                  })
                : detectedThreat.hazard === "flood" && detectedThreat.km
                  ? t("track3.emergency.observations.floodNear", {
                      km: detectedThreat.km.toFixed(1),
                    })
                  : t("track3.emergency.observations.stormNear", {
                      area:
                        detectedThreat.areaLabel ??
                        positionCardData?.wilaya ??
                        t("civilMap.national"),
                    })
            }
          >
            <span
              className="tabular rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: "var(--risk-tint-4)",
                color: "var(--risk-ink-4)",
              }}
            >
              {t("survival.seenAgo", {
                time: relativeTime(detectedThreat.observedAt, locale),
              })}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t(detectedThreat.sourceKey)}
            </span>
          </FactRow>
        ) : fireThreat ? (
          <FactRow
            icon={<Flame aria-hidden className="size-4.5" />}
            tint
            title={t("survival.fireObserved", {
              km: fireThreat.km.toFixed(1),
              bearing: dirWord(t, fireThreat.bearing),
            })}
          >
            <span
              className="tabular rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: "var(--risk-tint-4)",
                color: "var(--risk-ink-4)",
              }}
            >
              {t("survival.seenAgo", {
                time: relativeTime(fireThreat.cluster.last_detected_at, locale),
              })}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t("survival.bySatellite")}
              {fireThreat.closing ? ` · ${t("survival.closer")}` : ""}
            </span>
          </FactRow>
        ) : offlineThreat ? (
          <FactRow
            icon={<Flame aria-hidden className="size-4.5" />}
            tint
            title={t("survival.fireObserved", {
              km: offlineThreat.km.toFixed(1),
              bearing: dirWord(t, offlineThreat.bearing),
            })}
          >
            <span
              className="tabular rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: "var(--risk-tint-2)",
                color: "var(--risk-ink-2)",
              }}
            >
              {t("survival.seenAgo", {
                time: relativeTime(offlineThreat.last_detected_at, locale),
              })}
            </span>
          </FactRow>
        ) : (
          <p className="card p-3 text-[13px] leading-relaxed text-muted-foreground">
            {positionDenied
              ? t("survival.noPosition")
              : t("survival.noFreshData")}
          </p>
        )}

        {hazard === "fire" &&
        fireThreat?.cluster.wind_speed_kmh != null &&
        fireThreat.cluster.wind_dir_deg != null ? (
          <FactRow
            icon={<Wind aria-hidden className="size-4.5" />}
            title={
              t("survival.wind", {
                kmh: Math.round(fireThreat.cluster.wind_speed_kmh),
                bearing: dirWord(t, fireThreat.cluster.wind_dir_deg),
              }) +
              (fireThreat.cluster.wind_gust_kmh == null
                ? ""
                : ` · ${t("survival.gusts", { kmh: Math.round(fireThreat.cluster.wind_gust_kmh) })}`)
            }
          >
            {fireThreat.closing ? (
              <span className="text-[11px] text-muted-foreground">
                {t("survival.windToward")}
              </span>
            ) : null}
          </FactRow>
        ) : null}

        {hazard === "fire" ? (
          <p className="text-xs text-muted-foreground">
            {t("survival.smokeUnavailable")}
          </p>
        ) : null}

        {changes && lastCheck ? (
          <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Clock aria-hidden className="size-3.5 shrink-0" />
            {t("survival.sinceCheck", {
              time: relativeTime(lastCheck, locale),
              fires: changes.fires,
              reports: changes.reports,
            })}
          </p>
        ) : null}
      </section>

      {/* Section 4: Report Shortcuts (>= 44px touch targets) */}
      <section className="mt-auto flex flex-col gap-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {t("survival.report")}
        </span>
        <div className="map-scroll flex items-center gap-2 overflow-x-auto pb-1">
          {REPORT_SHORTCUTS.map((c) => (
            <Link
              key={c.kind}
              to="/report"
              search={{ kind: c.kind }}
              className="card inline-flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-xs font-semibold hover:bg-muted"
            >
              {t(c.key)}
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

function FactRow({
  icon,
  title,
  tint = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tint?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="card flex items-center gap-3 p-3">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
        style={
          tint
            ? {
                backgroundColor: "var(--risk-tint-4)",
                color: "var(--risk-ink-4)",
              }
            : { backgroundColor: "var(--raised)", color: "var(--ink-soft)" }
        }
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex flex-wrap items-center gap-1.5">{children}</span>
      </div>
    </div>
  );
}
