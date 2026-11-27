import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  CloudRain,
  Flame,
  MapPin,
  Plane,
  Search,
  Wind,
} from "lucide-react";

import { headTranslator, readActiveLocale, type AnyLocale } from "@/i18n";
import { parseAnyLocaleParam } from "@/i18n/locale-cookie";
import { zonesQuery } from "@/lib/account";
import { airForecastQuery } from "@/lib/air-quality";
import {
  airportWeatherQuery,
  STATION_FRESH_HOURS,
} from "@/lib/airport-weather";
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
  communeRiskForecastsQuery,
  dangerLevelKey,
  officialIncidentsQuery,
  onmVigilanceQuery,
  relativeTime,
  todayRiskForecastsQuery,
  unitName,
} from "@/lib/nadhir";
import { bilingualSeoHead } from "@/lib/page-meta";
import { SITE_URL, wilayaByCode } from "@/lib/wilaya-slugs";
import { cn } from "@/lib/utils";
import { AtlasPageFooter } from "@/ui/app-shell";
import { cleanCopy, formatNumber, formatShortDay } from "@/ui/format";
import {
  AlgiersClock,
  AtlasBadge,
  AtlasButton,
  AtlasEmpty,
  AtlasError,
  AtlasLoading,
  AtlasMasthead,
  AtlasPanel,
  SafeBdi,
  TONE_RULE,
  type HazardTone,
} from "@/ui/primitives";

type ForecastSearch = {
  commune?: string;
  lang?: AnyLocale;
};

export const Route = createFileRoute("/forecast")({
  validateSearch: (search: Record<string, unknown>): ForecastSearch => {
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

function dangerTone(level: number): HazardTone {
  if (level >= 5) return "extreme";
  if (level >= 4) return "extreme";
  if (level >= 3) return "high";
  if (level >= 2) return "moderate";
  return "clear";
}

function ForecastPage() {
  const { t, i18n } = useTranslation(["translation", "weather"]);
  const locale = (i18n.language || "ar") as AnyLocale;
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const [placeFilter, setPlaceFilter] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showAllMetar, setShowAllMetar] = useState(false);

  const unitsQ = useQuery({ ...adminUnitsQuery, staleTime: 10 * 60_000 });
  const zonesQ = useQuery({ ...zonesQuery, retry: false });
  const onmQ = useQuery(onmVigilanceQuery);
  const todayRiskQ = useQuery(todayRiskForecastsQuery);
  const officialQ = useQuery(officialIncidentsQuery);
  const quakesQ = useQuery(earthquakesQuery);
  const stationsQ = useQuery(airportWeatherQuery);

  const units = unitsQ.data ?? [];
  const communes = useMemo(
    () => units.filter((u) => u.level === "commune"),
    [units],
  );
  const wilayas = useMemo(
    () => units.filter((u) => u.level === "wilaya"),
    [units],
  );
  const wilayasById = useMemo(
    () => new Map(wilayas.map((w) => [w.id, w])),
    [wilayas],
  );

  const storedCommune =
    typeof window !== "undefined"
      ? window.localStorage.getItem("nadhir.forecast.commune")
      : null;

  const selectedCommune = useMemo(() => {
    const picked = defaultCommune(
      communes,
      search.commune,
      zonesQ.data ?? [],
      storedCommune,
    );
    if (picked) return picked;
    // Default gracefully to Alger Centre / first commune of wilaya 16 so the hero briefing is immediately alive
    const algerWilaya = wilayas.find((w) => w.code === "16");
    return (
      communes.find(
        (c) => c.parent_id === algerWilaya?.id && /alger/i.test(c.name_fr),
      ) ??
      communes.find((c) => c.parent_id === algerWilaya?.id) ??
      communes[0] ??
      null
    );
  }, [communes, wilayas, search.commune, zonesQ.data, storedCommune]);

  const selectedWilaya = selectedCommune?.parent_id
    ? (wilayasById.get(selectedCommune.parent_id) ?? null)
    : null;
  const wilayaSlug = selectedWilaya
    ? wilayaByCode(selectedWilaya.code)?.slug
    : undefined;

  const communeRiskQ = useQuery({
    ...communeRiskForecastsQuery(selectedCommune?.id ?? ""),
    enabled: Boolean(selectedCommune?.id),
  });

  const airQ = useQuery(
    airForecastQuery(
      selectedCommune
        ? { lat: selectedCommune.lat, lon: selectedCommune.lon }
        : null,
    ),
  );

  const days = useMemo(() => outlookDays(Date.now()), []);

  const weatherRow = useMemo(
    () => weatherCells(communeRiskQ.data ?? [], days),
    [communeRiskQ.data, days],
  );
  const fireRow = useMemo(
    () => fireCells(communeRiskQ.data ?? [], days),
    [communeRiskQ.data, days],
  );
  const onmRow = useMemo(
    () =>
      selectedWilaya
        ? onmCells(onmQ.data ?? [], selectedWilaya.id, days)
        : days.map(() => ({ state: "none" as const })),
    [onmQ.data, selectedWilaya, days],
  );
  const airRow = useMemo(
    () =>
      airQ.data
        ? airCells(airQ.data, days)
        : days.map(() => ({ state: "beyond" as const })),
    [airQ.data, days],
  );

  const tempBounds = useMemo(() => {
    const temps = weatherRow
      .map((w) => w?.tempC)
      .filter((v): v is number => typeof v === "number");
    if (!temps.length) return { min: 10, max: 35 };
    const min = Math.min(...temps) - 4;
    const max = Math.max(...temps) + 4;
    return { min, max: Math.max(max, min + 6) };
  }, [weatherRow]);

  const maxRain = useMemo(() => {
    const vals = weatherRow.map((w) => w?.rainMm ?? 0);
    return Math.max(10, ...vals);
  }, [weatherRow]);

  const ranking = useMemo(
    () =>
      nationalRanking(
        units,
        todayRiskQ.data ?? [],
        onmQ.data ?? [],
        days,
        officialQ.data ?? [],
        quakesQ.data ?? [],
      ),
    [units, todayRiskQ.data, onmQ.data, days, officialQ.data, quakesQ.data],
  );

  const groupedRanking = useMemo(() => {
    const severe = ranking.filter((r) => r.level >= 4);
    const elevated = ranking.filter((r) => r.level === 3);
    const watch = ranking.filter((r) => r.level <= 2);
    return { severe, elevated, watch };
  }, [ranking]);

  const allFreshStations = useMemo(() => {
    const cutoff = Date.now() - STATION_FRESH_HOURS * 3_600_000;
    return (stationsQ.data ?? []).filter(
      (s) => Date.parse(s.observed_at) >= cutoff,
    );
  }, [stationsQ.data]);

  const freshStations = useMemo(
    () => (showAllMetar ? allFreshStations : allFreshStations.slice(0, 8)),
    [allFreshStations, showAllMetar],
  );

  const filteredCommunes = useMemo(() => {
    const q = placeFilter.trim().toLowerCase();
    if (!q) return communes.slice(0, 12);
    return communes
      .filter((c) =>
        [c.name_ar, c.name_fr, c.name_en, c.code].some((v) =>
          v.toLowerCase().includes(q),
        ),
      )
      .slice(0, 14);
  }, [communes, placeFilter]);

  function pickCommune(c: { id: string; code: string }) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("nadhir.forecast.commune", c.id);
    }
    setPickerOpen(false);
    setPlaceFilter("");
    void navigate({ search: (prev) => ({ ...prev, commune: c.code }) });
  }

  const todayWeather = weatherRow[0] ?? null;
  const todayFire = fireRow[0] ?? null;
  const todayAir = airRow[0] ?? null;
  const todayOnm = onmRow[0] ?? null;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <span>
              {locale === "ar"
                ? "النشرة الوطنية للتوقعات"
                : locale === "fr"
                  ? "BULLETIN MÉTÉO & RISQUES"
                  : "NATIONAL FORECAST BULLETIN"}
            </span>
            <span>·</span>
            <AlgiersClock />
          </>
        }
        title={t("weather:pageTitle")}
        subtitle={t("weather:outlook.nationalBody")}
        actions={
          <div className="relative">
            <AtlasButton
              variant="secondary"
              onClick={() => setPickerOpen((v) => !v)}
            >
              <MapPin className="h-4 w-4 text-signal" />
              <span>
                {selectedCommune
                  ? unitName(selectedCommune, locale)
                  : t("weather:outlook.choosePlace")}
              </span>
            </AtlasButton>
            {pickerOpen && (
              <div className="absolute end-0 top-12 z-30 w-72 overflow-hidden rounded-2xl border border-hairline-strong bg-surface shadow-2xl">
                <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
                  <Search className="h-4 w-4 text-ink-muted shrink-0" />
                  <input
                    type="search"
                    value={placeFilter}
                    onChange={(e) => setPlaceFilter(e.target.value)}
                    placeholder={t("weather:outlook.searchPlace")}
                    autoFocus
                    className="h-8 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto p-1.5">
                  {filteredCommunes.map((c) => {
                    const w = c.parent_id ? wilayasById.get(c.parent_id) : null;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => pickCommune(c)}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-start text-sm hover:bg-surface-raised cursor-pointer"
                      >
                        <span className="font-medium text-ink truncate">
                          {unitName(c, locale)}
                        </span>
                        <span className="text-xs text-ink-muted shrink-0 ms-2">
                          {w ? unitName(w, locale) : c.code}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        }
      />

      {unitsQ.isLoading ? (
        <AtlasLoading label={t("weather:loading")} />
      ) : unitsQ.isError ? (
        <AtlasError
          title={t("weather:outlook.placesError")}
          onRetry={() => void unitsQ.refetch()}
          retryLabel={t("weather:retry")}
        />
      ) : (
        <div className="space-y-10">
          {/* Asymmetric Consumer Weather + MeteoSwiss Editorial Hero */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left Column (5 cols): Giant Display Briefing */}
            <AtlasPanel className="lg:col-span-5 flex flex-col justify-between gap-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-mono text-ink-muted">
                    {selectedWilaya && <SafeBdi>{selectedWilaya.code}</SafeBdi>}
                    {selectedWilaya && (
                      <span>{unitName(selectedWilaya, locale)}</span>
                    )}
                  </div>
                  <h2 className="font-display text-2xl sm:text-3xl font-semibold text-ink mt-1 truncate">
                    {selectedCommune
                      ? unitName(selectedCommune, locale)
                      : t("weather:outlook.choosePlace")}
                  </h2>
                </div>
                {wilayaSlug && (
                  <Link
                    to="/wilaya/$slug"
                    params={{ slug: wilayaSlug }}
                    className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong px-2.5 py-1.5 text-xs font-medium text-signal hover:bg-signal-soft transition-colors shrink-0"
                  >
                    <span>
                      {locale === "ar"
                        ? "ملف الولاية"
                        : locale === "fr"
                          ? "Dossier"
                          : "Wilaya brief"}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 atlas-dir-icon" />
                  </Link>
                )}
              </div>

              {/* Giant Consumer Weather Temperature Reading */}
              <div className="flex items-end justify-between gap-4 border-y border-hairline py-5">
                <div>
                  <div className="font-display text-6xl sm:text-7xl font-semibold tracking-tight tabular-nums leading-none text-ink">
                    {todayWeather ? (
                      <SafeBdi>{Math.round(todayWeather.tempC)}°</SafeBdi>
                    ) : (
                      <SafeBdi>--°</SafeBdi>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-ink-secondary">
                    {t("weather:outlook.rowWeather")}
                  </div>
                </div>

                <div className="space-y-2 text-end">
                  <div className="flex items-center justify-end gap-2 text-sm text-ink">
                    <Wind className="h-4 w-4 text-signal" />
                    <SafeBdi className="font-mono tabular-nums">
                      {todayWeather
                        ? `${Math.round(todayWeather.windKmh)} km/h`
                        : "-"}
                    </SafeBdi>
                  </div>
                  <div className="flex items-center justify-end gap-2 text-sm text-ink">
                    <CloudRain className="h-4 w-4 text-hazard-rain" />
                    <SafeBdi className="font-mono tabular-nums">
                      {todayWeather
                        ? `${todayWeather.rainMm.toFixed(1)} mm`
                        : "-"}
                    </SafeBdi>
                  </div>
                </div>
              </div>

              {/* ONM Vigilance Status */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-secondary">
                  {t("weather:outlook.rowOnm")}
                </span>
                {todayOnm?.state === "warning" ? (
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {todayOnm.events.map((ev) => (
                      <AtlasBadge
                        key={ev}
                        tone={dangerTone(todayOnm.level)}
                        dot
                      >
                        {t(`weather:outlook.event.${ev}`, { defaultValue: ev })}
                      </AtlasBadge>
                    ))}
                  </div>
                ) : (
                  <AtlasBadge tone="clear" dot>
                    {t("weather:outlook.onmNone")}
                  </AtlasBadge>
                )}
              </div>

              {/* Tactile FWI Fire Danger Meter */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-ink-secondary">
                    <Flame className="h-3.5 w-3.5 text-hazard-high" />
                    {t("weather:outlook.fireToday")}
                  </span>
                  <span className="font-mono font-semibold text-ink tabular-nums">
                    {todayFire ? (
                      todayFire.fuelLimited ? (
                        t("weather:outlook.onmNone")
                      ) : (
                        <SafeBdi>
                          FWI {todayFire.fwi.toFixed(1)} ·{" "}
                          {dangerLevelKey(todayFire.level)}
                        </SafeBdi>
                      )
                    ) : (
                      t("weather:outlook.notPublished")
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1 h-2">
                  {[1, 2, 3, 4, 5].map((tier) => {
                    const active =
                      todayFire && !todayFire.fuelLimited
                        ? todayFire.level >= tier
                        : false;
                    return (
                      <div
                        key={tier}
                        className={cn(
                          "rounded-full transition-colors",
                          active
                            ? tier >= 4
                              ? "bg-hazard-extreme"
                              : tier === 3
                                ? "bg-hazard-high"
                                : tier === 2
                                  ? "bg-hazard-moderate"
                                  : "bg-hazard-clear"
                            : "bg-surface-raised",
                        )}
                      />
                    );
                  })}
                </div>
              </div>

              {/* WHO Air Quality Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-ink-secondary">
                    {t("weather:outlook.rowAir")}
                  </span>
                  {todayAir?.state === "ok" ? (
                    <AtlasBadge
                      tone={
                        todayAir.level === "severe" || todayAir.level === "high"
                          ? "extreme"
                          : todayAir.level === "elevated"
                            ? "high"
                            : "clear"
                      }
                    >
                      {t(`weather:outlook.airLevel.${todayAir.level}`)} ·{" "}
                      <SafeBdi className="font-mono">
                        PM2.5 {Math.round(todayAir.pm25)}
                      </SafeBdi>
                    </AtlasBadge>
                  ) : (
                    <span className="text-xs text-ink-muted">
                      {t("weather:outlook.airBeyond")}
                    </span>
                  )}
                </div>
                {todayAir?.state === "ok" && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        todayAir.level === "severe" || todayAir.level === "high"
                          ? "bg-hazard-extreme"
                          : todayAir.level === "elevated"
                            ? "bg-hazard-high"
                            : "bg-hazard-clear",
                      )}
                      style={{
                        width: `${Math.min(100, Math.max(8, (todayAir.pm25 / 75) * 100))}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            </AtlasPanel>

            {/* Right Column (7 cols): 6-Day Visual Apple Weather Range Strip */}
            <AtlasPanel className="lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-xl font-semibold text-ink">
                  {selectedCommune
                    ? cleanCopy(
                        t("weather:outlook.caption", {
                          place: unitName(selectedCommune, locale),
                        }),
                      )
                    : t("weather:pageTitle")}
                </h3>
                <span className="font-mono text-xs text-ink-muted">
                  {locale === "ar" ? "6 أيام" : locale === "fr" ? "6J" : "6D"}
                </span>
              </div>

              <div className="divide-y divide-hairline">
                {days.map((day, idx) => {
                  const { weekday, dayNum } = formatShortDay(day, locale);
                  const w = weatherRow[idx];
                  const f = fireRow[idx];
                  const o = onmRow[idx];

                  const tempSpan = tempBounds.max - tempBounds.min;
                  const lowEst = w ? w.tempC - 5 : tempBounds.min;
                  const highEst = w ? w.tempC : tempBounds.min;
                  const startPct = w
                    ? Math.max(0, ((lowEst - tempBounds.min) / tempSpan) * 100)
                    : 0;
                  const widthPct = w
                    ? Math.max(14, ((highEst - lowEst) / tempSpan) * 100)
                    : 0;
                  const rainPct = w
                    ? Math.min(100, (w.rainMm / maxRain) * 100)
                    : 0;

                  return (
                    <div
                      key={day}
                      className="grid grid-cols-12 items-center gap-3 py-3.5"
                    >
                      {/* Day + Date */}
                      <div className="col-span-4 sm:col-span-3 min-w-0">
                        <div className="text-sm font-semibold text-ink truncate">
                          {idx === 0
                            ? locale === "ar"
                              ? "اليوم"
                              : locale === "fr"
                                ? "Aujourd'hui"
                                : "Today"
                            : idx === 1
                              ? t("weather:outlook.tomorrow")
                              : weekday}
                        </div>
                        <div className="font-mono text-[11px] text-ink-muted">
                          {dayNum}
                        </div>
                      </div>

                      {/* ONM & FWI Signal */}
                      <div className="col-span-4 sm:col-span-3 flex flex-wrap items-center gap-1.5">
                        {o?.state === "warning" ? (
                          <AtlasBadge tone={dangerTone(o.level)} dot>
                            {o.events[0]
                              ? t(`weather:outlook.event.${o.events[0]}`, {
                                  defaultValue: o.events[0],
                                })
                              : "ONM"}
                          </AtlasBadge>
                        ) : f && !f.fuelLimited && f.level >= 3 ? (
                          <AtlasBadge tone={dangerTone(f.level)}>
                            FWI {Math.round(f.fwi)}
                          </AtlasBadge>
                        ) : (
                          <span className="text-xs text-ink-muted">
                            {o?.state === "not_issued"
                              ? t("weather:outlook.onmNotIssued")
                              : t("weather:outlook.onmNone")}
                          </span>
                        )}
                      </div>

                      {/* Proportional Temperature Bar (Apple Weather style) */}
                      <div className="col-span-4 sm:col-span-4 flex items-center gap-2">
                        <SafeBdi className="font-mono text-xs text-ink-secondary tabular-nums w-7 text-end">
                          {w ? `${Math.round(lowEst)}°` : "-"}
                        </SafeBdi>
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
                          {w && (
                            <div
                              className="absolute inset-y-0 rounded-full bg-signal"
                              style={{
                                insetInlineStart: `${startPct}%`,
                                width: `${Math.min(100 - startPct, widthPct)}%`,
                              }}
                            />
                          )}
                        </div>
                        <SafeBdi className="font-mono text-xs font-semibold text-ink tabular-nums w-7">
                          {w ? `${Math.round(highEst)}°` : "-"}
                        </SafeBdi>
                      </div>

                      {/* Rain Accumulation Bar */}
                      <div className="hidden sm:flex col-span-2 flex-col items-end gap-1">
                        <SafeBdi className="font-mono text-xs text-hazard-rain tabular-nums">
                          {w
                            ? w.rainMm > 0
                              ? `${w.rainMm.toFixed(1)} mm`
                              : "0 mm"
                            : "-"}
                        </SafeBdi>
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-raised">
                          {w && (
                            <div
                              className="h-full rounded-full bg-hazard-rain"
                              style={{ width: `${rainPct}%` }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-ink-muted pt-1 leading-relaxed">
                {cleanCopy(t("weather:outlook.notes"))}
              </p>
            </AtlasPanel>
          </section>

          {/* Aviation EFB METAR Telemetry Strip */}
          {freshStations.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between border-t border-hairline pt-6">
                <div className="flex items-center gap-2.5">
                  <Plane className="h-4 w-4 text-signal" />
                  <h2 className="font-display text-2xl font-semibold text-ink">
                    {locale === "ar"
                      ? "رصد المطارات المباشر (METAR)"
                      : locale === "fr"
                        ? "Observations aéronautiques METAR"
                        : "Aviation METAR observations"}
                  </h2>
                </div>
                <div className="flex items-center gap-3">
                  <SafeBdi className="font-mono text-xs text-ink-muted">
                    {locale === "fr" ? "OACI · DIRECT" : "ICAO · LIVE"}
                  </SafeBdi>
                  {allFreshStations.length > 8 && (
                    <button
                      type="button"
                      onClick={() => setShowAllMetar((v) => !v)}
                      className="text-xs font-medium text-signal hover:underline cursor-pointer"
                    >
                      {showAllMetar
                        ? locale === "fr"
                          ? "Réduire"
                          : locale === "ar"
                            ? "عرض أقل"
                            : "Show fewer"
                        : locale === "fr"
                          ? `Tout afficher (${allFreshStations.length})`
                          : locale === "ar"
                            ? `عرض الكل (${allFreshStations.length})`
                            : `View all (${allFreshStations.length})`}
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {freshStations.map((st) => (
                  <div
                    key={st.station}
                    className="rounded-xl border border-hairline bg-surface p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <SafeBdi className="font-mono text-sm font-semibold text-signal">
                        {st.station}
                      </SafeBdi>
                      <span className="font-mono text-[11px] text-ink-muted">
                        {relativeTime(st.observed_at, locale)}
                      </span>
                    </div>
                    <div className="text-xs text-ink-secondary truncate">
                      {cleanCopy(st.name) || st.station}
                    </div>
                    <div className="flex items-baseline justify-between border-t border-hairline pt-2">
                      <SafeBdi className="font-display text-2xl font-semibold text-ink tabular-nums">
                        {st.temp_c !== null ? `${Math.round(st.temp_c)}°` : "-"}
                      </SafeBdi>
                      <div className="text-end font-mono text-[11px] text-ink-secondary tabular-nums">
                        <div>
                          <SafeBdi>
                            {st.wind_kt !== null ? `${st.wind_kt} kt` : "-"}
                          </SafeBdi>
                        </div>
                        <div className="text-ink-muted">
                          <SafeBdi>
                            {st.visibility_m !== null
                              ? `${(st.visibility_m / 1000).toFixed(1)} km`
                              : "-"}
                          </SafeBdi>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* National Wilaya Watchlist Grouped by Severity Tier */}
          <section className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-t border-hairline pt-6">
              <div>
                <h2 className="font-display text-2xl sm:text-3xl font-semibold text-ink">
                  {t("weather:outlook.nationalTitle")}
                </h2>
                <p className="text-sm text-ink-secondary mt-1">
                  {t("weather:outlook.nationalBody")}
                </p>
              </div>
              <SafeBdi className="font-mono text-xs text-ink-muted">
                {formatNumber(ranking.length, locale)} / 69
              </SafeBdi>
            </div>

            {ranking.length === 0 ? (
              <AtlasEmpty
                title={t("weather:outlook.nationalEmpty")}
                body={t("weather:warningsNone")}
              />
            ) : (
              <div className="space-y-6">
                {(
                  [
                    {
                      key: "severe",
                      tone: "extreme" as HazardTone,
                      label:
                        locale === "ar"
                          ? "مستوى مرتفع جدًا"
                          : locale === "fr"
                            ? "Niveau sévère"
                            : "Severe tier",
                      items: groupedRanking.severe,
                    },
                    {
                      key: "elevated",
                      tone: "high" as HazardTone,
                      label:
                        locale === "ar"
                          ? "مستوى مرتفع"
                          : locale === "fr"
                            ? "Niveau élevé"
                            : "Elevated tier",
                      items: groupedRanking.elevated,
                    },
                    {
                      key: "watch",
                      tone: "moderate" as HazardTone,
                      label:
                        locale === "ar"
                          ? "مراقبة ويقظة"
                          : locale === "fr"
                            ? "Vigilance"
                            : "Watch tier",
                      items: groupedRanking.watch,
                    },
                  ] as const
                )
                  .filter((tier) => tier.items.length > 0)
                  .map((tier) => (
                    <div key={tier.key} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "h-2 w-2 rounded-full",
                            TONE_RULE[tier.tone],
                          )}
                        />
                        <h3 className="text-xs font-mono font-semibold text-ink-secondary">
                          {tier.label} ({tier.items.length})
                        </h3>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {tier.items.map((row) => {
                          const slug = wilayaByCode(row.wilaya.code)?.slug;
                          return (
                            <div
                              key={row.wilaya.id}
                              className="flex items-stretch overflow-hidden rounded-xl border border-hairline bg-surface hover:border-hairline-strong transition-colors"
                            >
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "w-1 shrink-0",
                                  TONE_RULE[tier.tone],
                                )}
                              />
                              <div className="flex-1 p-3.5 space-y-2.5 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <SafeBdi className="font-mono text-xs text-ink-muted">
                                      {row.wilaya.code}
                                    </SafeBdi>
                                    {slug ? (
                                      <Link
                                        to="/wilaya/$slug"
                                        params={{ slug }}
                                        className="font-display text-base font-semibold text-ink hover:text-signal truncate"
                                      >
                                        {unitName(row.wilaya, locale)}
                                      </Link>
                                    ) : (
                                      <span className="font-display text-base font-semibold text-ink truncate">
                                        {unitName(row.wilaya, locale)}
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const c = communes.find(
                                        (x) => x.id === row.targetCommuneId,
                                      );
                                      if (c) pickCommune(c);
                                    }}
                                    className="text-xs font-medium text-signal hover:underline shrink-0 cursor-pointer"
                                  >
                                    {locale === "ar"
                                      ? "6 أيام"
                                      : locale === "fr"
                                        ? "6J"
                                        : "6D"}
                                  </button>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5">
                                  {row.weather?.events.map((ev) => (
                                    <AtlasBadge key={ev} tone={tier.tone}>
                                      {t(`weather:outlook.event.${ev}`, {
                                        defaultValue: ev,
                                      })}
                                    </AtlasBadge>
                                  ))}
                                  {row.fire !== null && (
                                    <AtlasBadge tone={dangerTone(row.fire)}>
                                      {t("weather:outlook.nationalFire", {
                                        level: dangerLevelKey(row.fire),
                                      })}
                                    </AtlasBadge>
                                  )}
                                  {row.quake && (
                                    <AtlasBadge tone="seismic">
                                      <SafeBdi>
                                        M{row.quake.magnitude.toFixed(1)}
                                      </SafeBdi>
                                    </AtlasBadge>
                                  )}
                                  {row.incidents > 0 && (
                                    <AtlasBadge tone="extreme">
                                      {row.incidents} DGPC
                                    </AtlasBadge>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>
        </div>
      )}

      <AtlasPageFooter />
    </div>
  );
}
