import {
  Link,
  useLoaderData,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import {
  Activity,
  CloudLightning,
  Compass,
  Flame,
  MapPin,
  Radio,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertProvenance } from "@/components/nadhir/AlertProvenance";
import { RiskChip } from "@/components/nadhir/RiskChip";
import { riskInk, riskTint } from "@/components/nadhir/risk-visuals";
import type { AnyLocale } from "@/i18n";
import { provenanceForBroadcast } from "@/lib/alert-provenance";
import { algiersTime, relativeTime, unitName } from "@/lib/nadhir";
import type { WilayaSnapshot } from "@/lib/wilaya-data";
import {
  WILAYA_REGISTRY,
  wilayaName,
  type WilayaSlugEntry,
} from "@/lib/wilaya-slugs";
import { ONM_SEVERITY } from "@/lib/zone-hazards";

const LANG_OPTIONS: readonly { code: AnyLocale; label: string }[] = [
  { code: "ar", label: "العربية" },
  { code: "fr", label: "Français" },
  { code: "en", label: "EN" },
  { code: "kab", label: "KAB" },
];

const INITIAL_COMMUNES = 20;

const KNOWN_INCIDENT_KINDS = new Set([
  "forest_fire",
  "brush_fire",
  "crop_fire",
  "urban_fire",
  "flood",
  "storm",
  "road",
  "structure",
  "other",
]);

function neighboringWilayas(current: WilayaSlugEntry): WilayaSlugEntry[] {
  const index = WILAYA_REGISTRY.findIndex((w) => w.code === current.code);
  if (index === -1) return [];
  const total = WILAYA_REGISTRY.length;
  const offsets = [-3, -2, -1, 1, 2, 3];
  return offsets.map(
    (offset) => WILAYA_REGISTRY[(index + offset + total) % total]!,
  );
}

export function WilayaNotFound() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="font-display text-2xl font-semibold">
        {t("track3.wilaya.notFoundTitle")}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("track3.wilaya.notFoundBody")}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/forecast"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("track3.wilaya.notFoundBackForecast")}
        </Link>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          {t("track3.wilaya.notFoundBackMap")}
        </Link>
      </div>
    </div>
  );
}

export function WilayaPageView({
  snapshot,
  explicitLang,
  onRetry,
}: {
  snapshot: WilayaSnapshot;
  explicitLang?: AnyLocale | undefined;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [showAllCommunes, setShowAllCommunes] = useState(false);

  const locale: AnyLocale =
    explicitLang ??
    (i18n.language === "ar" ||
    i18n.language === "fr" ||
    i18n.language === "en" ||
    i18n.language === "kab"
      ? i18n.language
      : "ar");

  const localizedName = wilayaName(snapshot.wilaya, locale);
  const communeCount =
    snapshot.communes.length > 0
      ? snapshot.communes.length
      : snapshot.wilaya.communeCount;
  const visibleCommunes = showAllCommunes
    ? snapshot.communes
    : snapshot.communes.slice(0, INITIAL_COMMUNES);

  const hasActiveHazards =
    snapshot.onmWarnings.length > 0 ||
    snapshot.officialIncidents.length > 0 ||
    snapshot.probableFires.length > 0 ||
    snapshot.earthquakes.length > 0;

  const neighbors = neighboringWilayas(snapshot.wilaya);
  const communeNameById = new Map(
    snapshot.communes.map((c) => [c.id, unitName(c, locale)]),
  );

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6">
      <header className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 font-medium text-foreground">
                {t("track3.wilaya.codeBadge", { code: snapshot.wilaya.code })}
              </span>
              <span>
                {t("track3.wilaya.communesStat", { count: communeCount })}
              </span>
              <span aria-hidden>·</span>
              <span>
                {t("track3.wilaya.coordsLabel")}:{" "}
                <bdi dir="ltr" className="tabular-nums font-mono">
                  {snapshot.wilaya.lat.toFixed(4)},{" "}
                  {snapshot.wilaya.lon.toFixed(4)}
                </bdi>
              </span>
            </div>
            <h1 className="mt-2 font-display text-2xl font-semibold sm:text-3xl">
              {t("track3.wilaya.heading", { wilaya: localizedName })}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              <time dateTime={snapshot.fetchedAt}>
                {t("track3.wilaya.updatedAt", {
                  time: algiersTime(snapshot.fetchedAt),
                })}
              </time>
            </p>
          </div>

          <nav
            aria-label={t("track3.wilaya.languageSwitcherLabel")}
            className="flex flex-wrap items-center gap-1.5"
          >
            {LANG_OPTIONS.map((opt) => {
              const active = locale === opt.code;
              return (
                <Link
                  key={opt.code}
                  to="/wilaya/$slug"
                  params={{ slug: snapshot.wilaya.slug }}
                  search={{ lang: opt.code }}
                  lang={opt.code}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--accent-tint)] px-3 text-sm font-semibold text-[var(--accent)]"
                      : "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  }
                >
                  {opt.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <MapPin aria-hidden className="size-4 shrink-0" />
            <span>{t("track3.wilaya.backToMap")}</span>
          </Link>
          <Link
            to="/forecast"
            search={
              snapshot.communes[0] ? { commune: snapshot.communes[0].code } : {}
            }
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Compass aria-hidden className="size-4 shrink-0" />
            <span>{t("track3.wilaya.openForecast")}</span>
          </Link>
          <Link
            to="/survival"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold"
            style={{
              backgroundColor: "var(--emergency-surface)",
              borderColor: "var(--emergency)",
              color: "var(--emergency-ink)",
            }}
          >
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            <span>{t("track3.wilaya.openEmergency")}</span>
          </Link>
        </div>
      </header>

      {snapshot.dataStatus === "unavailable" ? (
        <section
          role="status"
          className="mt-5 rounded-xl border border-border bg-muted/40 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">
                {t("track3.wilaya.dataUnavailableTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("track3.wilaya.dataUnavailableBody", {
                  wilaya: localizedName,
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              <RefreshCw aria-hidden className="size-4 shrink-0" />
              <span>{t("track3.wilaya.retryLoad")}</span>
            </button>
          </div>
        </section>
      ) : snapshot.dataStatus === "partial" ? (
        <div
          role="status"
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
        >
          <span>{t("track3.wilaya.dataPartialNote")}</span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            <RefreshCw aria-hidden className="size-4 shrink-0" />
            <span>{t("track3.wilaya.retryLoad")}</span>
          </button>
        </div>
      ) : null}

      <section aria-labelledby="wilaya-hazards-title" className="mt-6">
        <h2
          id="wilaya-hazards-title"
          className="font-display text-xl font-semibold"
        >
          {t("track3.wilaya.hazardsTitle")}
        </h2>

        {!hasActiveHazards && snapshot.dataStatus !== "unavailable" ? (
          <div className="card mt-3 p-5">
            <h3 className="text-base font-medium">
              {t("track3.wilaya.honestEmptyTitle")}
            </h3>
            <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
              {t("track3.wilaya.honestEmptyBody", { wilaya: localizedName })}
            </p>
          </div>
        ) : null}

        {snapshot.onmWarnings.length > 0 ? (
          <div className="mt-4 space-y-3">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <CloudLightning aria-hidden className="size-4 shrink-0" />
              <span>{t("track3.wilaya.onmSectionTitle")}</span>
            </h3>
            {snapshot.onmWarnings.map((warning) => {
              const level = ONM_SEVERITY[warning.severity] ?? 2;
              const headline =
                locale === "fr" && warning.headline_fr
                  ? warning.headline_fr
                  : warning.title;
              return (
                <article key={warning.id} className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold"
                      style={{
                        backgroundColor: riskTint(level),
                        color: riskInk(level),
                      }}
                    >
                      <ShieldAlert aria-hidden className="size-3.5 shrink-0" />
                      <span className="tabular-nums">{level}</span>
                      <span>{warning.severity}</span>
                    </span>
                    <span className="text-xs font-medium text-foreground">
                      {t("track3.wilaya.onmAttribution")}
                    </span>
                  </div>
                  <p className="mt-2 font-medium" dir="auto">
                    {headline}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground" dir="auto">
                    {warning.area_desc}
                  </p>
                  {warning.onset && warning.expires ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("track3.wilaya.onmValidWindow", {
                        from: algiersTime(warning.onset),
                        to: algiersTime(warning.expires),
                      })}
                    </p>
                  ) : null}
                  <AlertProvenance
                    className="mt-3"
                    provenance={provenanceForBroadcast({
                      kind: "onm",
                      severity: warning.severity,
                      sourceKey: "onm",
                      sourceAttribution: "ONM · Météo Algérie",
                      areaLabel: localizedName,
                      observedAt: warning.sent,
                    })}
                  />
                </article>
              );
            })}
          </div>
        ) : null}

        {snapshot.officialIncidents.length > 0 ? (
          <div className="mt-5 space-y-3">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <ShieldAlert aria-hidden className="size-4 shrink-0" />
              <span>{t("track3.wilaya.incidentsSectionTitle")}</span>
            </h3>
            {snapshot.officialIncidents.map((incident) => {
              const kindKey = KNOWN_INCIDENT_KINDS.has(incident.kind)
                ? incident.kind
                : "other";
              const placeText = incident.commune
                ? unitName(incident.commune, locale)
                : (incident.place_text ?? localizedName);
              const sourceLabel =
                incident.latest_mention?.source?.label?.trim() ||
                (incident.authority_tier === "media"
                  ? "Info Trafic Algérie"
                  : "DGPC");
              return (
                <article key={incident.id} className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
                      {t(`track3.wilaya.kind.${kindKey}`)}
                    </span>
                    <time
                      dateTime={incident.last_reported_at}
                      className="text-xs text-muted-foreground"
                    >
                      {algiersTime(incident.last_reported_at)} ·{" "}
                      {relativeTime(incident.last_reported_at, locale)}
                    </time>
                  </div>
                  <p className="mt-2 font-medium" dir="auto">
                    {placeText}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground" dir="auto">
                    {incident.evidence}
                  </p>
                  <AlertProvenance
                    className="mt-3"
                    provenance={provenanceForBroadcast({
                      kind: "official",
                      hazard: incident.kind,
                      sourceKey:
                        incident.authority_tier === "media"
                          ? "ita_facebook"
                          : "dgpc_telegram",
                      sourceAttribution: sourceLabel,
                      areaLabel: placeText,
                      observedAt: incident.last_reported_at,
                    })}
                  />
                </article>
              );
            })}
          </div>
        ) : null}

        {snapshot.probableFires.length > 0 ? (
          <div className="mt-5 space-y-3">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Flame aria-hidden className="size-4 shrink-0" />
              <span>{t("track3.wilaya.firesSectionTitle")}</span>
            </h3>
            {snapshot.probableFires.map((fire) => {
              const communeLabel = fire.communeId
                ? (communeNameById.get(fire.communeId) ?? localizedName)
                : localizedName;
              const level = fire.level === "confirmed" ? 5 : 4;
              return (
                <article key={fire.id} className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold"
                      style={{
                        backgroundColor: riskTint(level),
                        color: riskInk(level),
                      }}
                    >
                      <Flame aria-hidden className="size-3.5 shrink-0" />
                      <span>
                        {fire.level === "confirmed"
                          ? t("track3.wilaya.firesConfirmedBadge")
                          : t("track3.wilaya.firesProbableBadge")}
                      </span>
                    </span>
                    <time
                      dateTime={fire.lastDetectedAt}
                      className="text-xs text-muted-foreground"
                    >
                      {algiersTime(fire.lastDetectedAt)} ·{" "}
                      {relativeTime(fire.lastDetectedAt, locale)}
                    </time>
                  </div>
                  <p className="mt-2 font-medium" dir="auto">
                    {communeLabel}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("track3.wilaya.firesDetections", {
                      count: fire.detectionCount,
                    })}{" "}
                    ·{" "}
                    <bdi dir="ltr" className="tabular-nums font-mono">
                      {fire.lat.toFixed(3)}, {fire.lon.toFixed(3)}
                    </bdi>
                  </p>
                  <AlertProvenance
                    className="mt-3"
                    provenance={provenanceForBroadcast({
                      kind: "fire",
                      confirmed: fire.level === "confirmed",
                      sourceKey: "firms",
                      sourceAttribution:
                        fire.level === "confirmed"
                          ? "DGPC · NASA FIRMS"
                          : "NASA FIRMS",
                      areaLabel: communeLabel,
                      observedAt: fire.lastDetectedAt,
                    })}
                  />
                </article>
              );
            })}
          </div>
        ) : null}

        {snapshot.heatSignalCount > 0 ? (
          <p className="mt-3 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground">
            {t("track3.wilaya.heatSignalsNote", {
              count: snapshot.heatSignalCount,
            })}
          </p>
        ) : null}

        {snapshot.earthquakes.length > 0 ? (
          <div className="mt-5 space-y-3">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Activity aria-hidden className="size-4 shrink-0" />
              <span>{t("track3.wilaya.quakesSectionTitle")}</span>
            </h3>
            {snapshot.earthquakes.map((quake) => {
              const level =
                quake.magnitude >= 5 ? 5 : quake.magnitude >= 4 ? 4 : 2;
              return (
                <article key={quake.id} className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums"
                      style={{
                        backgroundColor: riskTint(level),
                        color: riskInk(level),
                      }}
                    >
                      <Activity aria-hidden className="size-3.5 shrink-0" />
                      <bdi dir="ltr">M{quake.magnitude.toFixed(1)}</bdi>
                    </span>
                    <span className="text-xs font-medium text-foreground">
                      {quake.attribution}
                    </span>
                  </div>
                  <p className="mt-2 font-medium" dir="auto">
                    {quake.region || localizedName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("track3.forecast.quakeDistance", {
                      km: quake.distanceKm,
                    })}
                    {quake.depth_km !== null &&
                    Number.isFinite(quake.depth_km) ? (
                      <>
                        {" · "}
                        {t("track3.wilaya.quakeDepth", {
                          km: Math.round(quake.depth_km),
                        })}
                      </>
                    ) : null}
                  </p>
                  <AlertProvenance
                    className="mt-3"
                    provenance={provenanceForBroadcast({
                      kind: "earthquake",
                      magnitude: quake.magnitude,
                      sourceAttribution: quake.attribution,
                      areaLabel: quake.region || localizedName,
                      observedAt: quake.occurred_at,
                    })}
                  />
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      {snapshot.fireDanger || snapshot.airportWeather.length > 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {snapshot.fireDanger ? (
            <section className="card p-4 sm:p-5">
              <h2 className="font-display text-lg font-semibold">
                {t("track3.wilaya.fireDangerSectionTitle")}
              </h2>
              {snapshot.fireDanger.allFuelLimited ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("track3.wilaya.fireDangerAllFuelLimited")}
                </p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <RiskChip level={snapshot.fireDanger.dangerLevel} />
                    <span className="text-sm font-medium tabular-nums">
                      <bdi dir="ltr">
                        {t("track3.wilaya.fireDangerFwi", {
                          fwi: Math.round(snapshot.fireDanger.fwi),
                        })}
                      </bdi>
                    </span>
                    {snapshot.fireDanger.percentile !== null ? (
                      <span className="text-sm text-muted-foreground tabular-nums">
                        <bdi dir="ltr">
                          {t("track3.wilaya.fireDangerPercentile", {
                            percentile: Math.round(
                              snapshot.fireDanger.percentile,
                            ),
                          })}
                        </bdi>
                      </span>
                    ) : null}
                  </div>
                  {snapshot.fireDanger.fuelLimitedCount > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("track3.wilaya.fireDangerFuelLimited", {
                        count: snapshot.fireDanger.fuelLimitedCount,
                      })}
                    </p>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          {snapshot.airportWeather.length > 0 ? (
            <section className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                  <Radio aria-hidden className="size-4 shrink-0" />
                  <span>{t("track3.wilaya.stationSectionTitle")}</span>
                </h2>
                <span className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium">
                  {t("track3.wilaya.stationObservedLabel")}
                </span>
              </div>
              <ul className="mt-3 space-y-2.5">
                {snapshot.airportWeather.map((station) => {
                  const windKmh =
                    station.wind_kt !== null && Number.isFinite(station.wind_kt)
                      ? Math.round(station.wind_kt * 1.852)
                      : null;
                  const gustKmh =
                    station.gust_kt !== null && Number.isFinite(station.gust_kt)
                      ? Math.round(station.gust_kt * 1.852)
                      : null;
                  return (
                    <li
                      key={station.station}
                      className="rounded-lg border border-border/70 p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium" dir="auto">
                          {station.name} (<bdi dir="ltr">{station.station}</bdi>
                          )
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t("track3.forecast.quakeDistance", {
                            km: station.distanceKm,
                          })}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {station.temp_c !== null &&
                        Number.isFinite(station.temp_c) ? (
                          <bdi
                            dir="ltr"
                            className="font-medium text-foreground"
                          >
                            {t("track3.forecast.stationTemp", {
                              temp: Math.round(station.temp_c),
                            })}
                          </bdi>
                        ) : null}
                        {windKmh !== null ? (
                          <bdi dir="ltr">
                            {t("track3.forecast.stationWind", {
                              wind: windKmh,
                            })}
                          </bdi>
                        ) : null}
                        {gustKmh !== null ? (
                          <bdi dir="ltr">
                            {t("track3.forecast.stationGust", {
                              gust: gustKmh,
                            })}
                          </bdi>
                        ) : null}
                        <time dateTime={station.observed_at}>
                          {algiersTime(station.observed_at)}
                        </time>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <section
        aria-labelledby="wilaya-communes-title"
        className="card mt-6 p-4 sm:p-5"
      >
        <h2
          id="wilaya-communes-title"
          className="font-display text-xl font-semibold"
        >
          {t("track3.wilaya.communesSectionTitle", { wilaya: localizedName })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("track3.wilaya.communesSectionBody")}
        </p>

        {snapshot.communes.length === 0 ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("track3.wilaya.communesOfflineNote", {
                wilaya: localizedName,
                count: snapshot.wilaya.communeCount,
              })}
            </p>
            <Link
              to="/forecast"
              className="inline-flex min-h-11 items-center rounded-lg border border-border px-3.5 text-sm font-medium hover:bg-muted"
            >
              {t("track3.wilaya.openForecast")}
            </Link>
          </div>
        ) : (
          <>
            <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {visibleCommunes.map((commune) => (
                <li key={commune.id}>
                  <Link
                    to="/forecast"
                    search={{ commune: commune.code }}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border/80 px-3 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <span className="truncate font-medium" dir="auto">
                      {unitName(commune, locale)}
                    </span>
                    <span
                      dir="ltr"
                      className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                    >
                      {commune.code}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {snapshot.communes.length > INITIAL_COMMUNES ? (
              <button
                type="button"
                onClick={() => setShowAllCommunes((prev) => !prev)}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-3.5 text-sm font-medium hover:bg-muted"
              >
                {showAllCommunes
                  ? t("track3.wilaya.showFewerCommunes")
                  : t("track3.wilaya.showAllCommunes", {
                      count: snapshot.communes.length,
                    })}
              </button>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="wilaya-neighbors-title" className="mt-6">
        <h2
          id="wilaya-neighbors-title"
          className="font-display text-lg font-semibold"
        >
          {t("track3.wilaya.neighboringTitle")}
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {neighbors.map((neighbor) => (
            <li key={neighbor.code}>
              <Link
                to="/wilaya/$slug"
                params={{ slug: neighbor.slug }}
                search={explicitLang ? { lang: explicitLang } : {}}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition-colors hover:bg-muted"
              >
                <span
                  dir="ltr"
                  className="font-mono text-xs text-muted-foreground tabular-nums"
                >
                  {neighbor.code}
                </span>
                <span>{wilayaName(neighbor, locale)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function WilayaRoutePage() {
  const snapshot = useLoaderData({ from: "/wilaya/$slug" });
  const search = useSearch({ from: "/wilaya/$slug" });
  const router = useRouter();
  return (
    <WilayaPageView
      snapshot={snapshot}
      explicitLang={search.lang}
      onRetry={() => void router.invalidate()}
    />
  );
}
