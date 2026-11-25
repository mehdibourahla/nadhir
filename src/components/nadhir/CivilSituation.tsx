import {
  Activity,
  CloudLightning,
  Flame,
  ShieldCheck,
  TriangleAlert,
  Route as Road,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { Locale } from "@/i18n";
import {
  buildAlertProvenance,
  type AlertProvenanceData,
} from "@/lib/alert-provenance";
import type { Situation } from "@/lib/civil-map";
import { relativeTime, unitName, type AdminUnit } from "@/lib/nadhir";
import { isFireKind } from "@/lib/text-sources/merge";
import { AlertProvenance } from "./AlertProvenance";
import { OfficialIncidentDetail } from "./OfficialIncidentDetail";
import { HazardReportDetail } from "./HazardReportDetail";
import { QuakeDetail } from "./QuakeDetail";
import { AirportDetail } from "./AirportDetail";
import { civilPublicationLifecycle } from "@/lib/civil-publication";
import { adviceFor, weatherAdviceQuery } from "@/lib/weather-advice";

function provenanceForSituation(
  item: Situation,
  areaLabel: string | null,
): AlertProvenanceData {
  if (item.source === "onm") {
    const severity = item.data?.severity?.trim().toLowerCase() ?? "";
    const ruleLabelKey =
      severity === "extreme"
        ? "provenance.rule.onmExtreme"
        : severity === "severe"
          ? "provenance.rule.onmSevere"
          : "provenance.rule.onmWarning";
    return buildAlertProvenance({
      triggerKind: "wilaya_warning",
      areaLabel,
      sourceKey: "onm",
      sourceAttribution: "ONM · Météo Algérie",
      ruleLabelKey,
      observedAt: item.data?.sent ?? item.at,
      authorityStatus: "official",
    });
  }
  if (item.source === "official") {
    const isMedia = item.data?.authority_tier === "media";
    const kind = item.data?.kind ?? "vegetation";
    const ruleLabelKey = isMedia
      ? kind === "road"
        ? "provenance.rule.roadDanger"
        : "provenance.rule.civilUpdate"
      : isFireKind(kind)
        ? "provenance.rule.dgpcFire"
        : "provenance.rule.dgpcNonFire";
    return buildAlertProvenance({
      triggerKind: "national_feed",
      areaLabel,
      sourceKey: isMedia ? "ita_facebook" : "dgpc_telegram",
      sourceAttribution: isMedia ? "Info Trafic Algérie" : "DGPC",
      ruleLabelKey,
      observedAt: item.data?.as_of ?? item.data?.last_reported_at ?? item.at,
      authorityStatus: isMedia ? "observed" : "official",
    });
  }
  if (item.source === "satellite") {
    return buildAlertProvenance({
      triggerKind: "national_feed",
      areaLabel,
      sourceKey: "firms",
      sourceAttribution: "NASA FIRMS",
      ruleLabelKey:
        item.level === "confirmed"
          ? "provenance.rule.dgpcFire"
          : item.level === "probable"
            ? "provenance.rule.probableFire"
            : "provenance.rule.civilUpdate",
      observedAt: item.data?.last_detected_at ?? item.at,
      authorityStatus:
        item.level === "confirmed"
          ? "official"
          : item.level === "probable"
            ? "probable"
            : "observed",
    });
  }
  if (item.source === "seismic") {
    const mag = Number(item.data?.magnitude ?? 0);
    const network = item.data?.network?.trim() || "EMSC";
    return buildAlertProvenance({
      triggerKind: "national_feed",
      areaLabel,
      sourceKey: network.toLowerCase().includes("craag") ? "craag" : "emsc",
      sourceAttribution: network,
      ruleLabelKey:
        mag >= 5
          ? "provenance.rule.m5Quake"
          : mag >= 4
            ? "provenance.rule.m4Quake"
            : "provenance.rule.civilUpdate",
      observedAt: item.data?.occurred_at ?? item.at,
      authorityStatus: "observed",
    });
  }
  if (item.source === "civil") {
    const sourceName = item.data?.source_name?.trim() || "Info Trafic Algérie";
    return buildAlertProvenance({
      triggerKind: "national_feed",
      areaLabel,
      sourceKey: sourceName.toLowerCase().includes("tariki")
        ? "tariki_facebook"
        : "ita_facebook",
      sourceAttribution: sourceName,
      ruleLabelKey:
        item.data?.hazard === "road"
          ? "provenance.rule.roadDanger"
          : "provenance.rule.civilUpdate",
      observedAt:
        item.data?.source_published_at ?? item.data?.updated_at ?? item.at,
      authorityStatus: "observed",
    });
  }
  if (item.source === "citizen") {
    return buildAlertProvenance({
      triggerKind: "national_feed",
      areaLabel,
      sourceKey: "citizen_reports",
      sourceAttribution: "Citizen report",
      ruleLabelKey: "provenance.rule.civilUpdate",
      observedAt: item.data?.observed_at ?? item.at,
      authorityStatus: "observed",
    });
  }
  const stationCode = item.data?.station?.trim();
  return buildAlertProvenance({
    triggerKind: "national_feed",
    areaLabel,
    sourceKey: "metar",
    sourceAttribution: stationCode ? `METAR (${stationCode})` : "METAR",
    ruleLabelKey: "provenance.rule.civilUpdate",
    observedAt: item.data?.observed_at ?? item.at,
    authorityStatus: "observed",
  });
}

export const hazardIcons = {
  all: ShieldCheck,
  fire: Flame,
  weather: CloudLightning,
  road: Road,
  earthquake: Activity,
  other: TriangleAlert,
};

export function useSituationLabels(units: AdminUnit[], now: number) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const place = (item: Situation) => {
    const unit = units.find((u) => u.id === (item.areaId ?? item.wilayaId));
    if (unit) return unitName(unit, locale);
    if (item.source === "onm")
      return item.data.area_desc || t("civilMap.unknownLocation");
    if (item.source === "official")
      return unitName(item.data.commune ?? item.data.wilaya, locale);
    if (item.source === "civil" && item.data.area)
      return unitName(item.data.area, locale);
    if (item.source === "station") return item.data.name ?? item.data.station;
    const near =
      (item.source === "citizen" || item.source === "seismic") &&
      units.find((u) => u.id === item.data.commune_id);
    if (near) return t("map.nearPlace", { place: unitName(near, locale) });
    return item.lat !== null && item.lon !== null
      ? `${item.lat.toFixed(3)}, ${item.lon.toFixed(3)}`
      : t("civilMap.unknownLocation");
  };
  const title = (item: Situation) =>
    item.source === "civil"
      ? item.data.summary
      : item.source === "onm"
        ? item.data.headline_fr || item.data.title
        : item.source === "satellite" && item.level === "heat_signal"
          ? `${t("civilMap.heatSignalShort")} · ${place(item)}`
          : item.source === "citizen"
            ? `${t(`reports.hazardName.${item.data.hazard ?? "other"}`)} · ${place(item)}`
            : item.source === "seismic"
              ? `${t("quake.title", { mag: item.data.magnitude.toFixed(1) })} · ${place(item)}`
              : item.source === "station"
                ? t("station.sandstorm", { airport: place(item) })
                : `${t(`civilMap.${item.category}`)} · ${place(item)}`;
  const source = (item: Situation) =>
    t(
      item.source === "official" && item.data.authority_tier === "media"
        ? "civilMap.sourceMedia"
        : (
            {
              satellite: "civilMap.sourceSatellite",
              official: "civilMap.sourceOfficial",
              citizen: "civilMap.sourceCitizen",
              onm: "civilMap.sourceOnm",
              civil: "civilMap.sourceMedia",
              seismic: "civilMap.sourceSeismic",
              station: "civilMap.sourceAirport",
            } as const
          )[item.source],
    );
  const status = (item: Situation) => {
    if (item.source === "civil")
      return t(
        `civilMap.publication${civilPublicationLifecycle(item.data, now)}`,
      );
    if (item.phase === "ended") return t("civilMap.ended");
    if (item.source === "official") {
      const authority = t(`official.statuses.${item.data.status}`);
      return item.phase === "live"
        ? authority
        : t("civilMap.lastKnown", { status: authority });
    }
    if (item.source === "satellite")
      return t(
        item.phase === "archived"
          ? "civilMap.archived"
          : item.phase === "fading"
            ? "civilMap.quiet"
            : item.level === "confirmed"
              ? "stage.confirmed"
              : item.level === "probable"
                ? "civilMap.probable"
                : "civilMap.heatSignal",
      );
    if (item.source === "seismic")
      return t("quake.recordedBy", { network: item.data.network ?? "EMSC" });
    if (item.source === "station")
      return t("station.visibility", { m: item.data.visibility_m });
    if (item.source === "citizen")
      return item.data.witnesses
        ? t("reports.witnessCount", { count: item.data.witnesses })
        : t("map.reportUnverified");
    return t(
      item.data.onset && Date.parse(item.data.onset) > now
        ? "civilMap.upcoming"
        : "civilMap.current",
    );
  };
  return { t, locale, place, title, source, status };
}

export function SituationCard({
  item,
  units,
  now,
  selected,
  onSelect,
}: {
  item: Situation;
  units: AdminUnit[];
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, locale, place, title, source, status } = useSituationLabels(
    units,
    now,
  );
  const Icon = hazardIcons[item.category];
  const areaLabel = place(item);
  const provenance = provenanceForSituation(item, areaLabel);
  return (
    <div
      className={`w-full rounded-xl border p-3 text-start transition-colors lg:rounded-2xl lg:p-4 ${selected ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-muted/50"}`}
    >
      <button
        data-situation-id={item.id}
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="w-full text-start focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span className="flex items-start gap-2.5 lg:gap-3">
          <span
            className={`shrink-0 rounded-lg p-2 lg:rounded-xl lg:p-2.5 ${item.source === "official" || item.source === "onm" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            <Icon aria-hidden className="size-4 lg:size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-muted-foreground">
              {source(item)}
            </span>
            <span
              dir="auto"
              lang={item.source === "civil" ? "fr" : undefined}
              className="mt-0.5 block break-words text-sm font-semibold leading-snug lg:mt-1 lg:text-base"
            >
              {title(item)}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground lg:mt-1">
              {status(item)}
            </span>
          </span>
        </span>
        <span className="mt-2 flex flex-wrap justify-between gap-1 border-t border-border/60 pt-2 text-xs text-muted-foreground lg:mt-3 lg:gap-2 lg:pt-2.5">
          <span dir="auto">{areaLabel}</span>
          <time dateTime={item.at}>{relativeTime(item.at, locale, now)}</time>
        </span>
        {(item.lat === null || item.lon === null) && (
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("civilMap.unknownLocation")}
          </span>
        )}
        {(item.source === "onm" ||
          item.source === "official" ||
          item.source === "civil") &&
          item.lat !== null && (
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("civilMap.areaPrecision")}
            </span>
          )}
      </button>
      <AlertProvenance
        provenance={provenance}
        compact
        now={now}
        className="mt-2"
      />
    </div>
  );
}

export function SituationDetails({
  item,
  units,
  now,
}: {
  item: Situation;
  units: AdminUnit[];
  now: number;
}) {
  const { t, locale, place, title, source, status } = useSituationLabels(
    units,
    now,
  );
  const adviceQuery = useQuery({
    ...weatherAdviceQuery,
    enabled: item.source === "onm",
  });
  const advice =
    item.source === "onm" ? adviceFor(item.data, adviceQuery.data ?? []) : null;
  const areaLabel = place(item);
  const provenance = provenanceForSituation(item, areaLabel);
  const provenanceFooter = (
    <AlertProvenance provenance={provenance} now={now} className="mt-4" />
  );
  if (item.source === "official")
    return (
      <div>
        <p className="mb-4 rounded-xl bg-muted p-3 text-sm">
          {t("civilMap.areaPrecision")}
        </p>
        <OfficialIncidentDetail
          incident={
            item.data.precision === "wilaya"
              ? { ...item.data, commune: null }
              : item.data
          }
          locale={locale}
          now={now}
        />
        {provenanceFooter}
      </div>
    );
  if (item.source === "citizen")
    return (
      <div>
        <HazardReportDetail report={item.data} locale={locale} now={now} />
        {provenanceFooter}
      </div>
    );
  if (item.source === "station")
    return (
      <div>
        <AirportDetail report={item.data} locale={locale} now={now} />
        {provenanceFooter}
      </div>
    );
  if (item.source === "seismic")
    return (
      <div>
        <QuakeDetail
          quake={item.data}
          place={areaLabel}
          locale={locale}
          now={now}
        />
        {provenanceFooter}
      </div>
    );
  if (item.source === "civil")
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">
            {source(item)} · {item.data.source_name}
          </p>
          <h2
            dir="auto"
            lang="fr"
            className="mt-2 break-words text-lg font-semibold"
          >
            {title(item)}
          </h2>
          <p className="mt-2 text-sm font-medium">{status(item)}</p>
        </div>
        <p className="rounded-xl bg-muted p-3 text-sm">
          {t("civilMap.publicationNotice")}
        </p>
        {item.phase !== "live" && (
          <p className="rounded-xl border p-3 text-sm">
            {t("civilMap.publicationHistorical")}
          </p>
        )}
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{t("civilMap.area")}</dt>
            <dd dir="auto">{areaLabel}</dd>
          </div>
          {(
            [
              ["sourcePublishedAt", item.data.source_published_at],
              ["publicationUpdatedAt", item.data.updated_at],
              ["validUntil", item.data.expires_at],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt className="text-muted-foreground">{t(`civilMap.${key}`)}</dt>
              <dd>
                <time dateTime={value}>
                  {new Date(value).toLocaleString(locale)}
                </time>
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          {t("civilMap.areaPrecision")}
        </p>
        {/^https?:\/\//.test(item.data.source_url) && (
          <a
            href={item.data.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold"
          >
            {t("civilMap.openSource")}
          </a>
        )}
        {provenanceFooter}
      </div>
    );
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-primary">{source(item)}</p>
        <h2 dir="auto" className="mt-2 text-xl font-semibold">
          {title(item)}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{status(item)}</p>
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("civilMap.area")}</dt>
          <dd dir="auto" className="mt-1 font-medium">
            {areaLabel}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t(
              item.source === "onm"
                ? "civilMap.issuedAt"
                : "civilMap.observedAt",
            )}
          </dt>
          <dd className="mt-1">
            <time dateTime={item.at}>
              {new Date(item.at).toLocaleString(locale)}
            </time>
          </dd>
        </div>
        {item.source === "onm" && (
          <>
            {(["severity", "certainty", "urgency"] as const).map((field) => (
              <div key={field}>
                <dt className="text-muted-foreground">
                  {t(`civilMap.${field}`)}
                </dt>
                <dd dir="auto">
                  {item.data[field]
                    ? t(`cap.${field}.${item.data[field]}`, {
                        defaultValue: item.data[field],
                      })
                    : t("civilMap.unknown")}
                </dd>
              </div>
            ))}
            {item.data.onset && (
              <div>
                <dt className="text-muted-foreground">{t("civilMap.onset")}</dt>
                <dd>{new Date(item.data.onset).toLocaleString(locale)}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">
                {t("civilMap.validUntil")}
              </dt>
              <dd>
                {item.data.expires
                  ? new Date(item.data.expires).toLocaleString(locale)
                  : t("civilMap.unknown")}
              </dd>
            </div>
          </>
        )}
      </dl>
      {item.source === "onm" ? (
        <>
          <p className="rounded-xl bg-muted p-3 text-sm">
            {t("civilMap.areaPrecision")}
          </p>
          {advice ? (
            <figure className="space-y-1 text-sm">
              <figcaption className="font-medium">
                {t("civilMap.dgpcAdvice")}
              </figcaption>
              <blockquote
                dir="auto"
                className="border-s-2 border-border ps-3 text-muted-foreground"
              >
                {advice.advice}
              </blockquote>
            </figure>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("civilMap.noInstructions")}
            </p>
          )}
          {item.data.cap_url && /^https?:\/\//.test(item.data.cap_url) && (
            <a
              href={item.data.cap_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              {t("civilMap.openSource")}
            </a>
          )}
        </>
      ) : (
        <>
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer py-1 text-sm font-semibold">
              {t("civilMap.technical")}
            </summary>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <dt>{t("fire.detectionCount")}</dt>
              <dd>{item.data.detection_count}</dd>
              <dt>{t("fire.area")}</dt>
              <dd>
                {item.data.est_area_ha == null
                  ? t("common.notRecorded")
                  : `${Math.round(item.data.est_area_ha)} ha`}
              </dd>
              <dt>{t("fire.peakFrp")}</dt>
              <dd>
                {item.data.max_frp_mw == null
                  ? t("common.notRecorded")
                  : `${item.data.max_frp_mw} MW`}
              </dd>
            </dl>
          </details>
          <Link
            to="/fire/$id"
            params={{ id: item.data.short_id }}
            className="flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            {t("civilMap.openDetail")}
          </Link>
        </>
      )}
      {provenanceFooter}
    </div>
  );
}
