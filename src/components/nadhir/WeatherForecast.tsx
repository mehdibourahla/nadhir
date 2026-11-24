import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Locale } from "@/i18n";
import { adminUnitsQuery, unitName, type OnmVigilance } from "@/lib/nadhir";
import { weatherIsStale, type WeatherResponse } from "@/lib/weather-evidence";
import { weatherOnmQuery } from "@/lib/weather-onm";

export function WeatherForecast({ communeId }: { communeId?: string } = {}) {
  const { t, i18n } = useTranslation("weather");
  const locale = i18n.language === "kab" ? "fr" : i18n.language;
  const [selectedId, setSelectedId] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const units = useQuery(adminUnitsQuery);
  const communes = useMemo(
    () =>
      (units.data ?? [])
        .filter((unit) => unit.level === "commune")
        .sort((a, b) =>
          unitName(a, locale as Locale).localeCompare(
            unitName(b, locale as Locale),
            locale,
          ),
        ),
    [units.data, locale],
  );
  const selected =
    communeId !== undefined
      ? communes.find((unit) => unit.id === communeId)
      : (communes.find((unit) => unit.id === selectedId) ?? communes[0]);
  const onm = useQuery(weatherOnmQuery(selected?.parent_id));
  const weather = useQuery({
    queryKey: ["weather", selected?.code],
    enabled: !!selected,
    retry: false,
    refetchInterval: 300_000,
    queryFn: async ({ signal }): Promise<WeatherResponse> => {
      const response = await fetch(
        `/api/public/v1/weather?commune=${encodeURIComponent(selected!.code)}`,
        { signal },
      );
      if (!response.ok)
        throw new Error(`Weather request failed: ${response.status}`);
      return response.json();
    },
  });
  const snapshot = weather.data?.snapshot;
  const staleModel =
    !!snapshot &&
    (weather.data?.stale || weather.isError || weatherIsStale(snapshot, now));
  const warningCoverage = (warning: OnmVigilance) => {
    if (!snapshot) return "comparisonMissing";
    if (staleModel) return "comparisonStale";
    const start = Date.parse(warning.onset ?? "");
    const end = Date.parse(warning.expires ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return "comparisonUnknownValidity";
    const intervals = snapshot.hours
      .map((hour) => {
        const hourEnd = Date.parse(hour.time);
        return {
          start: Math.max(start, hourEnd - 3600_000),
          end: Math.min(end, hourEnd),
        };
      })
      .filter((interval) => interval.end > interval.start)
      .sort((a, b) => a.start - b.start);
    if (!intervals.length) return "comparisonNoOverlap";
    let coveredUntil = start;
    for (const interval of intervals) {
      if (interval.start > coveredUntil) return "comparisonPartial";
      coveredUntil = Math.max(coveredUntil, interval.end);
    }
    return coveredUntil >= end ? "comparisonFull" : "comparisonPartial";
  };
  const nextHours = (snapshot?.hours ?? []).filter(
    (hour) =>
      Date.parse(hour.time) > now &&
      Date.parse(hour.time) <= now + 24 * 3600_000,
  );
  const rainTotal =
    nextHours.length === 24 && nextHours.every((hour) => hour.rainMm !== null)
      ? nextHours.reduce((total, hour) => total + hour.rainMm!, 0)
      : null;
  const probabilities = nextHours.flatMap((hour) =>
    hour.probabilityPercent === null ? [] : [hour.probabilityPercent],
  );
  const peakProbability = probabilities.length
    ? Math.max(...probabilities)
    : null;
  const stormHours = nextHours.filter(
    (hour) =>
      hour.weatherCode !== null && [95, 96, 99].includes(hour.weatherCode),
  );
  const warnings = useMemo(() => {
    const isLiveWarning = (warning: OnmVigilance) =>
      !warning.superseded_at &&
      !warning.cancelled_at &&
      !warning.superseded_by &&
      warning.msg_type !== "Cancel" &&
      (!warning.expires || Date.parse(warning.expires) > now);
    const visible = (onm.data?.warnings ?? []).filter(
      (warning) =>
        warning.wilaya_id === selected?.parent_id &&
        !warning.cancelled_at &&
        warning.msg_type !== "Cancel",
    );
    const groups: {
      event: string;
      area: string;
      start: number;
      end: number;
      bulletins: OnmVigilance[];
    }[] = [];
    for (const warning of visible.sort(
      (a, b) =>
        (Date.parse(a.onset ?? "") || Infinity) -
        (Date.parse(b.onset ?? "") || Infinity),
    )) {
      const start = Date.parse(warning.onset ?? "");
      const end = Date.parse(warning.expires ?? "");
      const group =
        Number.isFinite(start) && Number.isFinite(end) && end > start
          ? groups.find(
              (candidate) =>
                candidate.event === warning.event &&
                candidate.area === warning.area_desc &&
                start < candidate.end &&
                end > candidate.start,
            )
          : undefined;
      if (group) {
        group.end = Math.max(group.end, end);
        group.bulletins.push(warning);
      } else {
        groups.push({
          event: warning.event,
          area: warning.area_desc,
          start,
          end,
          bulletins: [warning],
        });
      }
    }
    return groups
      .filter((group) => group.bulletins.some(isLiveWarning))
      .map((group) =>
        group.bulletins.sort(
          (a, b) =>
            Number(isLiveWarning(b)) - Number(isLiveWarning(a)) ||
            Date.parse(b.sent) - Date.parse(a.sent),
        ),
      )
      .sort((a, b) => Date.parse(b[0]!.sent) - Date.parse(a[0]!.sent));
  }, [onm.data, selected?.parent_id, now]);
  const date = (value: string | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          timeZone: "Africa/Algiers",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(value))
      : t("unknown");
  const number = (value: number | null) =>
    value === null
      ? t("unknown")
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
          value,
        );
  const condition = (code: number | null) => {
    if (code === null) return "unknown";
    if ([0, 1].includes(code)) return "clear";
    if ([2, 3].includes(code)) return "cloudy";
    if ([45, 48].includes(code)) return "fog";
    if ([51, 53, 55].includes(code)) return "drizzle";
    if ([56, 57, 66, 67].includes(code)) return "freezing";
    if ([61, 63, 65, 80, 81, 82].includes(code)) return "rainfall";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
    if ([95, 96, 99].includes(code)) return "thunderstorm";
    return "unknown";
  };
  const retry = (action: () => unknown) => (
    <button
      type="button"
      onClick={action}
      className="mt-2 min-h-11 rounded border border-border px-3 py-2 text-base underline"
    >
      {t("retry")}
    </button>
  );

  return (
    <section aria-labelledby="weather-title" className="card mt-5 p-4 sm:p-5">
      <h2 id="weather-title" className="text-xl">
        {t("title")}
      </h2>
      {communeId === undefined ? (
        <>
          <label
            htmlFor="weather-commune"
            className="mt-4 block text-sm font-medium"
          >
            {t("location")}
          </label>
          <select
            id="weather-commune"
            value={selected?.id ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={!communes.length}
            className="mt-2 min-h-11 w-full max-w-md rounded-lg border border-border bg-surface p-2 text-base focus:ring-2 focus:ring-ring"
          >
            {!communes.length && <option value="">{t("choose")}</option>}
            {communes.map((commune) => (
              <option key={commune.id} value={commune.id}>
                {unitName(commune, locale as Locale)} · {commune.code}
              </option>
            ))}
          </select>
        </>
      ) : selected ? (
        <p className="mt-4 text-sm font-medium">
          {unitName(selected, locale as Locale)}
        </p>
      ) : null}
      <div
        className="mt-4"
        aria-live="polite"
        aria-busy={units.isLoading || weather.isFetching}
      >
        {units.isLoading ? (
          <p>{t("loading")}</p>
        ) : units.isError ? (
          <>
            <p>{t("locationsError")}</p>
            {retry(() => units.refetch())}
          </>
        ) : !communes.length ? (
          <p>{t("locationsEmpty")}</p>
        ) : communeId !== undefined && !selected ? (
          <p>{t("unavailable")}</p>
        ) : null}
        {selected &&
          (weather.isPending ? (
            <p>{t("loading")}</p>
          ) : weather.isError ? (
            <>
              <p>{t("error")}</p>
              {retry(() => weather.refetch())}
            </>
          ) : !snapshot ? (
            <>
              <p>{t("unavailable")}</p>
              {retry(() => weather.refetch())}
            </>
          ) : null)}
        {snapshot && (
          <>
            {staleModel && (
              <p
                role="status"
                className="mb-3 rounded border border-border p-3 font-medium"
              >
                {t("stale")}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {t("fetched")}: {date(snapshot.fetchedAt)} · {t("valid")}:{" "}
              {date(snapshot.hours[0]?.time)} –{" "}
              {date(snapshot.hours.at(-1)?.time)}
            </p>
            <div className="mt-4 rounded-lg bg-muted p-3">
              <h3 className="font-medium">{t("nextDay")}</h3>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t("rainTotal")}
                  </dt>
                  <dd className="text-xl tabular-nums">
                    {number(rainTotal)}
                    {rainTotal !== null && " mm"}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t("peakProbability")}
                  </dt>
                  <dd className="text-xl tabular-nums">
                    {number(peakProbability)}
                    {peakProbability !== null && " %"}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("summaryCoverage", {
                  rainCount: nextHours.filter((hour) => hour.rainMm !== null)
                    .length,
                  probabilityCount: probabilities.length,
                })}
              </p>
              <p className="mt-3 text-sm font-medium">{t("stormHours")}</p>
              <p className="mt-1 text-sm">
                {stormHours.length
                  ? stormHours.map((hour) => date(hour.time)).join(" · ")
                  : nextHours.length === 24 &&
                      nextHours.every((hour) => hour.weatherCode !== null)
                    ? t("stormsNone")
                    : t("unknown")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("stormCoverage", {
                  count: nextHours.filter((hour) => hour.weatherCode !== null)
                    .length,
                })}
              </p>
            </div>
            <details className="mt-4">
              <summary className="min-h-11 cursor-pointer py-3 text-base font-medium">
                {t("hourlyDetails")}
              </summary>
              <div
                className="mt-4 max-h-[32rem] overflow-auto rounded border border-border"
                tabIndex={0}
                role="region"
                aria-label={t("title")}
              >
                <table className="w-full min-w-[820px] text-start text-sm">
                  <caption className="sr-only">
                    {t("title")}:{" "}
                    {selected && unitName(selected, locale as Locale)}
                  </caption>
                  <thead className="sticky top-0 bg-surface">
                    <tr>
                      {[
                        "time",
                        "condition",
                        "precipitation",
                        "rain",
                        "probability",
                        "gusts",
                      ].map((key) => (
                        <th
                          key={key}
                          scope="col"
                          className="p-3 text-start font-medium"
                        >
                          {t(key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.hours.map((hour) => (
                      <tr key={hour.time} className="border-t border-border">
                        <th
                          scope="row"
                          className="whitespace-nowrap p-3 text-start font-normal"
                        >
                          {date(hour.time)}
                        </th>
                        <td className="p-3">
                          {t(condition(hour.weatherCode))}
                        </td>
                        {[
                          hour.precipitationMm,
                          hour.rainMm,
                          hour.probabilityPercent,
                          hour.gustKmh,
                        ].map((value, index) => (
                          <td key={index} className="p-3 tabular-nums">
                            {number(value)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("interval")}
              </p>
            </details>
          </>
        )}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{t("limitation")}</p>
      <a
        href="https://open-meteo.com/"
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block text-sm underline"
      >
        Open-Meteo
      </a>
      {selected && (
        <section
          aria-labelledby="weather-onm-title"
          className="mt-5 border-t border-border pt-4"
        >
          <h3 id="weather-onm-title" className="font-medium">
            {t("warnings")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("warningScope")}
          </p>
          {onm.isLoading ? (
            <p className="mt-2 text-sm">{t("warningsLoading")}</p>
          ) : onm.isError ? (
            <>
              <p className="mt-2 text-sm">{t("warningsError")}</p>
              {retry(() => onm.refetch())}
            </>
          ) : warnings.length === 0 ? (
            <p className="mt-2 text-sm">{t("warningsNone")}</p>
          ) : null}
          {onm.data?.historyUnavailable && (
            <p className="mt-2 text-sm" role="status">
              {t("historyUnavailable")}
            </p>
          )}
          {warnings.map((group) => {
            const bulletins = group.map((warning) => (
              <article
                key={warning.id}
                className="mt-3 rounded border border-border p-3"
              >
                <p className="mb-1 text-sm font-medium">
                  {t(
                    warning.expires && Date.parse(warning.expires) <= now
                      ? "expired"
                      : warning.onset && Date.parse(warning.onset) > now
                        ? "upcoming"
                        : "active",
                  )}
                </p>
                <p className="font-medium">
                  {locale === "fr" && warning.headline_fr
                    ? warning.headline_fr
                    : warning.title}
                </p>
                <p className="mt-1 text-sm">{warning.area_desc}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("warningPeriod")}: {date(warning.onset)} –{" "}
                  {date(warning.expires)} · {t("issued")}: {date(warning.sent)}
                </p>
                <p className="mt-2 text-sm">{t(warningCoverage(warning))}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("comparisonScope")}
                </p>
                {warning.cap_url && /^https?:\/\//i.test(warning.cap_url) && (
                  <a
                    href={warning.cap_url}
                    rel="noreferrer"
                    target="_blank"
                    className="mt-2 inline-block text-sm underline"
                  >
                    {t("officialSource")}
                  </a>
                )}
              </article>
            ));
            return (
              <div key={group[0]!.id}>
                {bulletins[0]}
                {bulletins.length > 1 && (
                  <details className="mt-2 rounded border border-border px-3">
                    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
                      {t("earlierBulletins")} ({bulletins.length - 1})
                    </summary>
                    <p className="text-xs text-muted-foreground">
                      {t("bulletinGrouping")}
                    </p>
                    <div className="pb-3">{bulletins.slice(1)}</div>
                  </details>
                )}
              </div>
            );
          })}
        </section>
      )}
    </section>
  );
}
