import { Activity, Info, Radio, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { riskInk, riskTint } from "@/components/nadhir/risk-visuals";
import { ErrorState, SkeletonList } from "@/components/nadhir/states";
import type { AnyLocale } from "@/i18n";
import type { AirportWeather } from "@/lib/airport-weather";
import type { Earthquake } from "@/lib/earthquakes";
import {
  algiersTime,
  relativeTime,
  unitName,
  type AdminUnit,
  type OfficialIncident,
} from "@/lib/nadhir";
import {
  filterActiveOfficialIncidents,
  filterWilayaEarthquakes,
  selectNearbyAirportWeather,
} from "@/lib/wilaya-data";

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

const STATION_LOCAL_RADIUS_KM = 50;

export function AuthorityModelBanner() {
  const { t } = useTranslation();
  return (
    <aside
      aria-labelledby="authority-model-banner-title"
      className="mb-4 rounded-xl border border-border bg-muted/40 p-3.5 text-sm"
    >
      <div className="flex items-start gap-2.5">
        <Info
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <h3
            id="authority-model-banner-title"
            className="font-medium text-foreground"
          >
            {t("track3.forecast.authorityBannerTitle")}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
            {t("track3.forecast.authorityBannerBody")}
          </p>
        </div>
      </div>
    </aside>
  );
}

interface AsyncSlice<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

export function ForecastHazardContext({
  place,
  selected,
  incidents,
  earthquakes,
  airportWeather,
}: {
  place: string;
  selected: AdminUnit;
  incidents: AsyncSlice<OfficialIncident[]>;
  earthquakes: AsyncSlice<Earthquake[]>;
  airportWeather: AsyncSlice<AirportWeather[]>;
}) {
  const { t, i18n } = useTranslation();
  const locale = (
    i18n.language === "ar" ||
    i18n.language === "fr" ||
    i18n.language === "en" ||
    i18n.language === "kab"
      ? i18n.language
      : "ar"
  ) as AnyLocale;

  const wilayaIncidents = incidents.data
    ? filterActiveOfficialIncidents(
        incidents.data.filter(
          (item) =>
            item.wilaya_id === selected.parent_id ||
            item.commune_id === selected.id,
        ),
      ).slice(0, 5)
    : [];

  const nearbyQuakes = earthquakes.data
    ? filterWilayaEarthquakes(
        earthquakes.data,
        { lat: selected.lat, lon: selected.lon },
        new Set([selected.id]),
      ).slice(0, 5)
    : [];

  const nearestStation = airportWeather.data
    ? (selectNearbyAirportWeather(
        airportWeather.data,
        { lat: selected.lat, lon: selected.lon },
        Date.now(),
        STATION_LOCAL_RADIUS_KM,
        1,
      )[0] ?? null)
    : null;

  return (
    <section
      aria-labelledby="local-context-title"
      className="mt-6 border-t border-border pt-5"
    >
      <h3 id="local-context-title" className="font-display text-lg">
        {t("track3.forecast.localContextTitle", { place })}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("track3.forecast.localContextBody")}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert aria-hidden className="size-4 shrink-0" />
            <span>{t("track3.forecast.incidentsTitle")}</span>
          </h4>
          {incidents.isPending ? (
            <SkeletonList rows={2} className="mt-3" />
          ) : incidents.isError ? (
            <ErrorState
              body={t("track3.forecast.incidentsError")}
              onRetry={() => void incidents.refetch()}
              className="mt-3"
            />
          ) : wilayaIncidents.length === 0 ? (
            <p className="mt-2.5 text-sm text-muted-foreground">
              {t("track3.forecast.incidentsEmpty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {wilayaIncidents.map((item) => {
                const kindKey = KNOWN_INCIDENT_KINDS.has(item.kind)
                  ? item.kind
                  : "other";
                const area = item.commune
                  ? unitName(item.commune, locale)
                  : (item.place_text ?? unitName(item.wilaya, locale));
                const source =
                  item.latest_mention?.source?.label?.trim() ||
                  (item.authority_tier === "media"
                    ? "Info Trafic Algérie"
                    : "DGPC");
                return (
                  <li
                    key={item.id}
                    className="rounded-lg border border-border/70 p-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="font-semibold text-foreground">
                        {t(`track3.wilaya.kind.${kindKey}`)}
                      </span>
                      <span className="text-muted-foreground">{source}</span>
                    </div>
                    <p className="mt-1 font-medium text-foreground" dir="auto">
                      {area}
                    </p>
                    <time
                      dateTime={item.last_reported_at}
                      className="mt-1 block text-muted-foreground"
                    >
                      {algiersTime(item.last_reported_at)} ·{" "}
                      {relativeTime(item.last_reported_at, locale)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Activity aria-hidden className="size-4 shrink-0" />
            <span>{t("track3.forecast.quakesTitle")}</span>
          </h4>
          {earthquakes.isPending ? (
            <SkeletonList rows={2} className="mt-3" />
          ) : earthquakes.isError ? (
            <ErrorState
              body={t("track3.forecast.quakesError")}
              onRetry={() => void earthquakes.refetch()}
              className="mt-3"
            />
          ) : nearbyQuakes.length === 0 ? (
            <p className="mt-2.5 text-sm text-muted-foreground">
              {t("track3.forecast.quakesEmpty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {nearbyQuakes.map((q) => {
                const level = q.magnitude >= 5 ? 5 : q.magnitude >= 4 ? 4 : 2;
                return (
                  <li
                    key={q.id}
                    className="rounded-lg border border-border/70 p-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold tabular-nums"
                        style={{
                          backgroundColor: riskTint(level),
                          color: riskInk(level),
                        }}
                      >
                        <Activity aria-hidden className="size-3 shrink-0" />
                        <bdi dir="ltr">M{q.magnitude.toFixed(1)}</bdi>
                      </span>
                      <span className="font-medium text-foreground">
                        {q.attribution}
                      </span>
                    </div>
                    <p className="mt-1 text-foreground" dir="auto">
                      {q.region || place}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      {t("track3.forecast.quakeDistance", {
                        km: q.distanceKm,
                      })}{" "}
                      ·{" "}
                      <time dateTime={q.occurred_at}>
                        {algiersTime(q.occurred_at)}
                      </time>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <Radio aria-hidden className="size-4 shrink-0" />
              <span>{t("track3.forecast.stationTitle")}</span>
            </h4>
            <span className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium">
              {t("track3.forecast.stationObservedBadge")}
            </span>
          </div>
          {airportWeather.isPending ? (
            <SkeletonList rows={2} className="mt-3" />
          ) : airportWeather.isError ? (
            <ErrorState
              body={t("track3.forecast.stationError")}
              onRetry={() => void airportWeather.refetch()}
              className="mt-3"
            />
          ) : !nearestStation ? (
            <p className="mt-2.5 text-sm text-muted-foreground">
              {t("track3.forecast.stationEmpty")}
            </p>
          ) : (
            <div className="mt-3 rounded-lg border border-border/70 p-3 text-xs">
              <p className="font-medium text-foreground" dir="auto">
                {nearestStation.name} (
                <bdi dir="ltr">{nearestStation.station}</bdi>)
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                {nearestStation.temp_c !== null &&
                Number.isFinite(nearestStation.temp_c) ? (
                  <bdi dir="ltr" className="font-semibold text-foreground">
                    {t("track3.forecast.stationTemp", {
                      temp: Math.round(nearestStation.temp_c),
                    })}
                  </bdi>
                ) : null}
                {nearestStation.wind_kt !== null &&
                Number.isFinite(nearestStation.wind_kt) ? (
                  <bdi dir="ltr">
                    {t("track3.forecast.stationWind", {
                      wind: Math.round(nearestStation.wind_kt * 1.852),
                    })}
                  </bdi>
                ) : null}
                {nearestStation.gust_kt !== null &&
                Number.isFinite(nearestStation.gust_kt) ? (
                  <bdi dir="ltr">
                    {t("track3.forecast.stationGust", {
                      gust: Math.round(nearestStation.gust_kt * 1.852),
                    })}
                  </bdi>
                ) : null}
                {nearestStation.visibility_m !== null &&
                Number.isFinite(nearestStation.visibility_m) ? (
                  <bdi dir="ltr">
                    {t("track3.forecast.stationVisibility", {
                      km:
                        Math.round((nearestStation.visibility_m / 1000) * 10) /
                        10,
                    })}
                  </bdi>
                ) : null}
              </div>
              <p className="mt-2 text-muted-foreground">
                {t("track3.forecast.stationModelNote", {
                  station: nearestStation.station,
                  km: nearestStation.distanceKm,
                })}{" "}
                ·{" "}
                <time dateTime={nearestStation.observed_at}>
                  {algiersTime(nearestStation.observed_at)}
                </time>
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
