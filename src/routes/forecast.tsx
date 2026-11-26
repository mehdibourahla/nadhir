import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { CommunePicker } from "@/components/forecast/CommunePicker";
import {
  AuthorityModelBanner,
  ForecastHazardContext,
} from "@/components/forecast/ForecastHazardContext";
import { NationalOutlook } from "@/components/forecast/NationalOutlook";
import { OutlookGrid, type Row } from "@/components/forecast/OutlookGrid";
import { LazyDetails } from "@/components/LazyDetails";
import { DangerScale } from "@/components/nadhir/DangerScale";
import {
  EmptyState,
  ErrorState,
  SkeletonList,
} from "@/components/nadhir/states";
import { WeatherForecast } from "@/components/nadhir/WeatherForecast";
import { RiskLegend } from "@/components/SiteChrome";
import { headTranslator, readActiveLocale, type AnyLocale } from "@/i18n";
import { parseAnyLocaleParam } from "@/i18n/locale-cookie";
import { zonesQuery } from "@/lib/account";
import { airForecastQuery } from "@/lib/air-quality";
import { airportWeatherQuery } from "@/lib/airport-weather";
import { earthquakesQuery } from "@/lib/earthquakes";
import {
  airCells,
  defaultCommune,
  fireCells,
  nationalRanking,
  onmCells,
  outlookDays,
  weatherCells,
} from "@/lib/forecast-outlook";
import {
  adminUnitsQuery,
  communeEffisDangerQuery,
  communeRiskForecastsQuery,
  isStaleForecastDate,
  officialIncidentsQuery,
  onmVigilanceQuery,
  relativeTime,
  todayRiskForecastsQuery,
  unitName,
  type AdminUnit,
} from "@/lib/nadhir";
import { bilingualSeoHead } from "@/lib/page-meta";
import {
  SITE_URL,
  WILAYA_REGISTRY,
  wilayaByCode,
  wilayaName,
} from "@/lib/wilaya-slugs";

type ForecastSearch = {
  commune?: string | undefined;
  lang?: AnyLocale | undefined;
};

const STORED_COMMUNE = "nadhir.forecast.commune";

function storedCommune(): string | null {
  try {
    return localStorage.getItem(STORED_COMMUNE);
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/forecast")({
  validateSearch: (search: Record<string, unknown>): ForecastSearch => {
    // the router JSON-parses search values, so a plain ?commune=1503 arrives as a number
    const raw = search["commune"];
    const commune = Number.isInteger(raw) ? String(raw) : raw;
    const validCommune =
      typeof commune === "string" && /^[0-9A-Za-z-]{1,12}$/.test(commune)
        ? commune
        : undefined;
    const rawLang = search["lang"];
    const validLang =
      typeof rawLang === "string"
        ? (parseAnyLocaleParam(rawLang) ?? undefined)
        : undefined;
    return {
      ...(validCommune ? { commune: validCommune } : {}),
      ...(validLang ? { lang: validLang } : {}),
    };
  },
  head: ({ match }) => {
    const explicitLang = match.search.lang;
    const lang: AnyLocale = explicitLang ?? readActiveLocale();
    const t = headTranslator(lang);
    const baseUrl = `${SITE_URL}/forecast`;
    return bilingualSeoHead({
      title: t("translation:track3.forecast.metaTitle"),
      description: t("translation:track3.forecast.metaDescription"),
      canonicalUrl: explicitLang ? `${baseUrl}?lang=${explicitLang}` : baseUrl,
      arUrl: `${baseUrl}?lang=ar`,
      frUrl: `${baseUrl}?lang=fr`,
      defaultUrl: baseUrl,
      locale: lang,
      robots: "index, follow",
    });
  },
  component: ForecastPage,
});

function rowOf<T, D>(
  query: {
    isPending: boolean;
    isError: boolean;
    data: D | undefined;
    refetch: () => unknown;
  },
  cells: (data: D) => T[],
): Row<T> {
  if (query.isError) return { status: "error", retry: () => query.refetch() };
  if (query.isPending || query.data === undefined) return { status: "loading" };
  return { status: "ok", cells: cells(query.data) };
}

function ForecastPage() {
  const { t, i18n } = useTranslation("weather");
  const locale = i18n.language as AnyLocale;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const gridRef = useRef<HTMLHeadingElement>(null);
  const [days] = useState(() => outlookDays(Date.now()));
  const [showDirectory, setShowDirectory] = useState(false);

  const units = useQuery(adminUnitsQuery);
  const zones = useQuery(zonesQuery);
  const onm = useQuery({ ...onmVigilanceQuery, retry: false });
  const today = useQuery({ ...todayRiskForecastsQuery, retry: false });
  const incidents = useQuery({ ...officialIncidentsQuery, retry: false });
  const earthquakes = useQuery({ ...earthquakesQuery, retry: false });
  const airportWeather = useQuery({ ...airportWeatherQuery, retry: false });

  const communes = useMemo(
    () => (units.data ?? []).filter((u) => u.level === "commune"),
    [units.data],
  );
  const selected = useMemo(
    () =>
      defaultCommune(
        communes,
        search.commune,
        zones.data ?? [],
        storedCommune(),
      ),
    [communes, search.commune, zones.data],
  );

  const risk = useQuery({
    ...communeRiskForecastsQuery(selected?.id ?? ""),
    enabled: !!selected,
  });
  const effis = useQuery(communeEffisDangerQuery(selected?.id ?? ""));
  const air = useQuery(
    airForecastQuery(
      selected ? { lat: selected.lat, lon: selected.lon } : null,
    ),
  );

  const pick = (commune: AdminUnit) => {
    try {
      localStorage.setItem(STORED_COMMUNE, commune.id);
    } catch {
      // storage can be unavailable (private mode); the URL still carries the choice
    }
    void navigate({
      search: (prev) => ({
        ...(prev.lang ? { lang: prev.lang } : {}),
        commune: commune.code,
      }),
      replace: true,
    });
  };

  const ranking = useMemo(
    () =>
      nationalRanking(
        units.data ?? [],
        today.data ?? [],
        onm.data ?? [],
        days,
        incidents.data ?? [],
        earthquakes.data ?? [],
      ),
    [units.data, today.data, onm.data, days, incidents.data, earthquakes.data],
  );

  const wilaya = selected?.parent_id
    ? units.data?.find((u) => u.id === selected.parent_id)
    : null;
  const wilayaSlugEntry = wilaya ? wilayaByCode(wilaya.code) : undefined;
  const place = selected
    ? wilaya
      ? `${unitName(selected, locale)}${t("outlook.separator")}${unitName(wilaya, locale)}`
      : unitName(selected, locale)
    : "";
  const fireToday = risk.data?.find((r) => r.forecast_date === days[0]);
  const effisToday = effis.data ?? undefined;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">{t("pageTitle")}</h1>
        {wilaya && wilayaSlugEntry ? (
          <Link
            to="/wilaya/$slug"
            params={{ slug: wilayaSlugEntry.slug }}
            search={search.lang ? { lang: search.lang } : {}}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <span>
              {t("translation:track3.forecast.viewWilayaPage", {
                wilaya: unitName(wilaya, locale),
              })}
            </span>
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 rtl:rotate-180"
            />
          </Link>
        ) : null}
      </div>

      <div className="mt-5">
        {units.isPending ? (
          <SkeletonList rows={1} />
        ) : (
          <CommunePicker
            units={units.data ?? []}
            selected={selected}
            onPick={pick}
          />
        )}
      </div>

      <section className="card mt-5 p-4 sm:p-5">
        <h2 ref={gridRef} tabIndex={-1} className="sr-only">
          {place || t("outlook.choosePlace")}
        </h2>
        <AuthorityModelBanner />
        {units.isPending ? (
          <SkeletonList rows={4} />
        ) : units.isError ? (
          <ErrorState
            body={t("outlook.placesError")}
            onRetry={() => void units.refetch()}
          />
        ) : !selected ? (
          <EmptyState
            title={t("outlook.emptyTitle")}
            body={t("outlook.emptyBody")}
          />
        ) : (
          <>
            <OutlookGrid
              days={days}
              place={place}
              onm={rowOf(onm, (data) =>
                onmCells(data, selected.parent_id ?? "", days),
              )}
              fire={rowOf(risk, (data) => fireCells(data, days))}
              weather={rowOf(risk, (data) => weatherCells(data, days))}
              air={rowOf(air, (data) => airCells(data, days))}
            />
            <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
              {t("outlook.notes")}
            </p>

            <ForecastHazardContext
              place={place}
              selected={selected}
              incidents={incidents}
              earthquakes={earthquakes}
              airportWeather={airportWeather}
            />

            {fireToday ? (
              <div className="mt-6 border-t border-border pt-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <h3 className="font-display text-lg">
                    {t("outlook.fireToday")}
                  </h3>
                  <RiskLegend className="max-w-xs" />
                </div>
                <DangerScale
                  level={fireToday.danger_level}
                  fwi={fireToday.fwi}
                  percentile={fireToday.fwi_percentile}
                  staleCaption={
                    isStaleForecastDate(fireToday.forecast_date)
                      ? t("translation:risk.staleAsOf", {
                          time: relativeTime(
                            `${fireToday.forecast_date}T00:00:00Z`,
                            locale,
                          ),
                        })
                      : null
                  }
                  guidance
                  className="mt-4"
                />
                {fireToday.fuel_limited ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("translation:risk.fuelLimited")}
                  </p>
                ) : null}
                <p className="mt-3 text-sm text-muted-foreground">
                  {effisToday
                    ? effisToday.danger_class === "masked"
                      ? t("translation:risk.effisMasked")
                      : t("translation:risk.effis", {
                          class: t(
                            `translation:risk.effisClass.${effisToday.danger_class}`,
                          ),
                        })
                    : t("translation:risk.effisNone")}
                </p>
              </div>
            ) : null}

            <LazyDetails
              key={selected.id}
              className="mt-6 border-t border-border pt-4"
              summaryClassName="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden"
              summary={
                <>
                  <ChevronDown aria-hidden className="size-4 shrink-0" />
                  {t("outlook.hourly")}
                </>
              }
            >
              <WeatherForecast communeId={selected.id} />
            </LazyDetails>
          </>
        )}
      </section>

      <NationalOutlook
        rows={ranking}
        loading={
          units.isPending ||
          (onm.isPending &&
            today.isPending &&
            incidents.isPending &&
            earthquakes.isPending)
        }
        failed={
          units.isError ||
          (today.isError &&
            onm.isError &&
            incidents.isError &&
            earthquakes.isError)
        }
        partialFailure={
          !(
            units.isError ||
            (today.isError &&
              onm.isError &&
              incidents.isError &&
              earthquakes.isError)
          ) &&
          (today.isError ||
            onm.isError ||
            incidents.isError ||
            earthquakes.isError)
        }
        lang={search.lang}
        onRetry={() => {
          void units.refetch();
          void today.refetch();
          void onm.refetch();
          void incidents.refetch();
          void earthquakes.refetch();
        }}
        onPick={(row) => {
          const commune = communes.find((c) => c.id === row.targetCommuneId);
          if (!commune) return;
          pick(commune);
          gridRef.current?.scrollIntoView({ block: "start" });
          gridRef.current?.focus({ preventScroll: true });
        }}
      />

      <section aria-labelledby="wilaya-directory-title" className="mt-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="wilaya-directory-title" className="text-xl">
              {t("translation:track3.forecast.wilayaDirectoryTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {(() => {
                const lawCode = "26-06";
                const body = t(
                  "translation:track3.forecast.wilayaDirectoryBody",
                );
                const idx = body.indexOf(lawCode);
                if (idx === -1) return body;
                return (
                  <>
                    {body.slice(0, idx)}
                    <bdi dir="ltr" className="tabular-nums">
                      {lawCode}
                    </bdi>
                    {body.slice(idx + lawCode.length)}
                  </>
                );
              })()}
            </p>
          </div>
          <button
            type="button"
            aria-expanded={showDirectory}
            onClick={() => setShowDirectory((prev) => !prev)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <span>
              {showDirectory
                ? t("translation:track3.forecast.wilayaDirectoryHide")
                : t("translation:track3.forecast.wilayaDirectoryToggle")}
            </span>
            <ChevronDown
              aria-hidden
              className={
                showDirectory
                  ? "size-4 shrink-0 rotate-180 transition-transform"
                  : "size-4 shrink-0 transition-transform"
              }
            />
          </button>
        </div>
        {showDirectory ? (
          <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {WILAYA_REGISTRY.map((entry) => (
              <li key={entry.code}>
                <Link
                  to="/wilaya/$slug"
                  params={{ slug: entry.slug }}
                  search={search.lang ? { lang: search.lang } : {}}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <span className="truncate font-medium">
                    {wilayaName(entry, locale)}
                  </span>
                  <span
                    dir="ltr"
                    className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                  >
                    {entry.code}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
