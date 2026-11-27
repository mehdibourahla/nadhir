import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellPlus, Flag, Share2, TrendingUp, Wind } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MapCanvas } from "@/components/MapCanvas";
import { AirQualityCard } from "@/components/nadhir/AirQualityCard";
import { DetectionStrip } from "@/components/nadhir/DetectionStrip";
import { FireEvidence } from "@/components/nadhir/FireEvidence";
import { StatCard } from "@/components/nadhir/StatCard";
import { EmptyState, ErrorState, Skeleton } from "@/components/nadhir/states";
import { EmergencyNumbers } from "@/components/SiteChrome";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n";
import { zonesQuery } from "@/lib/account";
import { downwindSettlement } from "@/lib/alerts-rules";
import { firePhase, type Phase } from "@/lib/incident-lifecycle";
import {
  adminUnitsQuery,
  algiersTime,
  bearingBetween,
  bearingLabel,
  clusterDetailQuery,
  fireStage,
  haversineKm,
  placeLabel,
  relativeTime,
  settlementName,
  settlementsQuery,
  unitName,
} from "@/lib/nadhir";
import { cn } from "@/lib/utils";
import { NATIVE, publicUrl } from "@/lib/platform";

function statusKey(phase: Phase, stage: string) {
  if (phase === "ended") return "civilMap.ended";
  if (phase === "archived") return "state.extinguished";
  if (phase === "fading") return "state.contained_guess";
  return `stage.${stage}`;
}

function ShareButton() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = NATIVE
      ? publicUrl(window.location.pathname + window.location.search)
      : window.location.href;
    if (NATIVE) {
      try {
        const { shareText } = await import("@/lib/native-share");
        await shareText(document.title, url);
        return;
      } catch {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        return;
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (failure) {
        if (failure instanceof DOMException && failure.name === "AbortError")
          return;
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  return (
    <Button variant="outline" onClick={() => void share()}>
      <Share2 aria-hidden />
      {copied ? t("fire.linkCopied") : t("fire.share")}
    </Button>
  );
}

export function FireDetailPage({ shortId }: { shortId: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const detail = useQuery(clusterDetailQuery(shortId));
  const units = useQuery(adminUnitsQuery);
  const settlements = useQuery(settlementsQuery);
  const zones = useQuery(zonesQuery);

  if (detail.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (detail.isError) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <ErrorState
          body={t("fire.loadError")}
          onRetry={() => void detail.refetch()}
        />
      </div>
    );
  }

  if (!detail.data) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <EmptyState
          title={t("fire.notFound")}
          action={
            <Link
              to="/"
              className="mt-2 text-sm font-medium text-primary underline"
            >
              {t("nav.map")}
            </Link>
          }
        />
      </div>
    );
  }

  const { cluster, detections, confirmation } = detail.data;
  const phase = firePhase(cluster, Date.now());
  const live = phase === "live" || phase === "upcoming";
  const wilaya = (units.data ?? []).find((u) => u.id === cluster.wilaya_id);
  const place = placeLabel(
    cluster,
    units.data ?? [],
    settlements.data ?? [],
    locale,
  );
  const insideZone = (zones.data ?? []).find(
    (z) => haversineKm(z.lat, z.lon, cluster.lat, cluster.lon) <= z.radius_km,
  );

  // measured from the nearest detection: a fire reaches a village from its front
  const nearby = (settlements.data ?? [])
    .map((s) => ({
      settlement: s,
      km: detections.length
        ? Math.min(
            ...detections.map((d) => haversineKm(d.lat, d.lon, s.lat, s.lon)),
          )
        : haversineKm(cluster.lat, cluster.lon, s.lat, s.lon),
      bearing: bearingBetween(cluster.lat, cluster.lon, s.lat, s.lon),
    }))
    .sort((a, b) => a.km - b.km)
    .slice(0, 5);

  // named only when the wind actually blows toward it: the nearest settlement is
  // frequently upwind, and an emergency banner pointing the wrong way misdirects
  const downwind = downwindSettlement(
    cluster,
    cluster.spread_bearing_deg,
    (settlements.data ?? []).map((s) => ({
      ...s,
      name: settlementName(s, locale),
    })),
  );

  const facts = [
    cluster.est_area_ha == null
      ? null
      : {
          key: "area",
          label: t("fire.area"),
          explain: t("explain.area"),
          value: `${Math.round(cluster.est_area_ha)} ${t("common.ha")}`,
        },
    {
      key: "detections",
      label: t("fire.detectionCount"),
      explain: t("explain.detections"),
      value: String(cluster.detection_count),
    },
    cluster.max_frp_mw == null
      ? null
      : {
          key: "frp",
          label: t("fire.peakFrp"),
          explain: t("explain.frp"),
          value: `${Math.round(cluster.max_frp_mw)} ${t("common.mw")}`,
        },
    {
      key: "sources",
      label: t("map.sources"),
      explain: t("explain.sources"),
      value: cluster.sources.join(", ").toUpperCase(),
    },
  ].filter((fact) => fact !== null);

  const conditions = [
    cluster.wind_speed_kmh == null
      ? null
      : {
          key: "wind",
          label: t("fire.wind"),
          explain: t("explain.wind"),
          value: `${Math.round(cluster.wind_speed_kmh)} ${t("common.kmh")}`,
          sub:
            cluster.wind_gust_kmh == null
              ? bearingLabel(cluster.wind_dir_deg)
              : `${bearingLabel(cluster.wind_dir_deg)} · ${t("fire.gusts", { kmh: Math.round(cluster.wind_gust_kmh) })}`,
        },
    cluster.vpd_kpa == null
      ? null
      : {
          key: "vpd",
          label: t("fire.vpd"),
          explain: t("explain.vpd"),
          value: `${cluster.vpd_kpa.toFixed(1)} kPa`,
        },
    cluster.soil_moisture_m3m3 == null
      ? null
      : {
          key: "soil",
          label: t("fire.soilMoisture"),
          explain: t("explain.soilMoisture"),
          value: `${Math.round(cluster.soil_moisture_m3m3 * 100)} %`,
        },
  ].filter((fact) => fact !== null);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4 px-4 py-5 lg:grid-cols-[1fr_400px]">
      <div className="flex min-w-0 flex-col gap-4">
        <header>
          <Link
            to="/"
            className="text-sm text-muted-foreground underline underline-offset-2"
          >
            ← {t("common.back")}
          </Link>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
                !live && "bg-muted text-muted-foreground",
              )}
              style={
                live
                  ? {
                      backgroundColor: "var(--emergency-surface)",
                      color: "var(--emergency-ink)",
                    }
                  : undefined
              }
            >
              {live ? (
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-current"
                />
              ) : null}
              {t(statusKey(phase, fireStage(cluster)))}
            </span>
            <span className="text-muted-foreground">
              {t("fire.lastSeen")}{" "}
              {relativeTime(cluster.last_detected_at, locale)}
            </span>
          </p>
          <h1 className="mt-2 text-2xl">
            {place.approximate
              ? t("map.nearPlace", { place: place.name })
              : place.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {wilaya ? `${unitName(wilaya, locale)} · ` : ""}
            <span className="tabular text-xs">{cluster.short_id}</span>
          </p>
          <p className="mt-3 text-sm">
            {t("fire.seenBetween", {
              first: algiersTime(cluster.first_detected_at),
              ago: relativeTime(cluster.last_detected_at, locale),
            })}
            {insideZone
              ? ` ${t("fire.insideZone", { name: insideZone.name })}`
              : ""}
          </p>
        </header>

        {cluster.spread_bearing_deg !== null && downwind ? (
          <p
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium"
            style={{
              backgroundColor: "var(--emergency-surface)",
              color: "var(--emergency-ink)",
            }}
          >
            <Wind aria-hidden className="size-4 shrink-0" />
            {t("fire.windToward", {
              bearing: bearingLabel(cluster.spread_bearing_deg),
              settlement: downwind.name,
            })}
          </p>
        ) : null}

        {cluster.fci_growth ? (
          cluster.fci_growth.trend === "growing" ? (
            <p
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium"
              style={{
                backgroundColor: "var(--emergency-surface)",
                color: "var(--emergency-ink)",
              }}
            >
              <TrendingUp aria-hidden className="size-4 shrink-0" />
              {t("fire.growthGrowing", {
                earlier: cluster.fci_growth.earlier,
                recent: cluster.fci_growth.recent,
                time: algiersTime(cluster.fci_growth.since),
              })}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t(
                cluster.fci_growth.trend === "fading"
                  ? "fire.growthFading"
                  : "fire.growthSteady",
                { time: algiersTime(cluster.fci_growth.since) },
              )}
            </p>
          )
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/zones" search={{ lat: cluster.lat, lon: cluster.lon }}>
              <BellPlus aria-hidden />
              {t("fire.alertMe")}
            </Link>
          </Button>
          <ShareButton />
          <Button asChild variant="outline">
            <Link to="/report">
              <Flag aria-hidden />
              {t("fire.reportHere")}
            </Link>
          </Button>
        </div>

        <EmergencyNumbers compact />

        <div className="h-[45vh] overflow-hidden rounded-xl border border-border">
          <MapCanvas
            clusters={[cluster]}
            selectedShortId={cluster.short_id}
            layers={{
              fires: true,
              official: false,
              reports: false,
              unverified: true,
              lightning: false,
            }}
            center={[cluster.lon, cluster.lat]}
            zoom={10}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {facts.map((fact) => (
            <StatCard
              key={fact.key}
              label={fact.label}
              explain={fact.explain}
              value={fact.value}
            />
          ))}
        </div>

        {conditions.length ? (
          <section>
            <h2 className="text-base">{t("fire.conditions")}</h2>
            <div className="mt-2 grid grid-cols-2 gap-2.5 md:grid-cols-3">
              {conditions.map((fact) => (
                <StatCard
                  key={fact.key}
                  label={fact.label}
                  explain={fact.explain}
                  value={fact.value}
                  sub={"sub" in fact ? fact.sub : undefined}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        {detections.length ? (
          <section className="card p-4">
            <h2 className="text-base">{t("fire.timeline")}</h2>
            <DetectionStrip detections={detections} className="mt-3" />
          </section>
        ) : null}

        <FireEvidence
          detections={detections}
          confirmation={confirmation}
          locale={locale}
          now={Date.now()}
        />

        {nearby.length ? (
          <section className="card p-4">
            <h2 className="text-base">{t("fire.nearest")}</h2>
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-start font-normal">
                    {t("fire.settlement")}
                  </th>
                  <th className="text-end font-normal">{t("fire.distance")}</th>
                  <th className="text-end font-normal">{t("fire.bearing")}</th>
                </tr>
              </thead>
              <tbody>
                {nearby.map((n) => (
                  <tr key={n.settlement.id} className="border-t border-border">
                    <td className="py-1.5">
                      <bdi>{settlementName(n.settlement, locale)}</bdi>
                    </td>
                    <td className="py-1.5 text-end tabular">
                      {n.km.toFixed(1)} {t("common.km")}
                    </td>
                    <td className="py-1.5 text-end">
                      {bearingLabel(n.bearing)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <AirQualityCard lat={cluster.lat} lon={cluster.lon} locale={locale} />
      </aside>
    </div>
  );
}
