import { ShieldAlert, Wind } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { riskInk, riskTint } from "@/components/nadhir/risk-visuals";
import { RiskChip } from "@/components/nadhir/RiskChip";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnyLocale } from "@/i18n";
import { SMOKE_TINT } from "@/lib/air-quality";
import type {
  AirCell,
  FireCell,
  OnmCell,
  WeatherCell,
} from "@/lib/forecast-outlook";
import { intlLocale } from "@/lib/nadhir";

export type Row<T> =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ok"; cells: T[] };

const WEATHER_NS_ONM_EVENTS = new Set([
  "rain",
  "storm",
  "sand",
  "wind",
  "heat",
  "other",
]);

function Level({ level, children }: { level: number; children: ReactNode }) {
  return (
    <div
      className="rounded-md px-2 py-1.5 text-sm"
      style={{ backgroundColor: riskTint(level), color: riskInk(level) }}
    >
      {children}
    </div>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => (
  <span className="text-sm text-muted-foreground">{children}</span>
);

export function OutlookGrid({
  days,
  place,
  onm,
  fire,
  weather,
  air,
}: {
  days: string[];
  place: string;
  onm: Row<OnmCell>;
  fire: Row<FireCell>;
  weather: Row<WeatherCell>;
  air: Row<AirCell>;
}) {
  const { t, i18n } = useTranslation("weather");
  const weekday = new Intl.DateTimeFormat(
    intlLocale(i18n.language as AnyLocale),
    {
      weekday: "short",
      day: "numeric",
      timeZone: "UTC",
    },
  );
  const dayLabel = (day: string, i: number) =>
    i === 0
      ? t("translation:risk.today")
      : i === 1
        ? t("outlook.tomorrow")
        : weekday.format(new Date(`${day}T00:00:00Z`));

  const onmEventLabel = (eventKey: string) =>
    WEATHER_NS_ONM_EVENTS.has(eventKey)
      ? t(`outlook.event.${eventKey}`)
      : t(`translation:track3.forecast.onmEvent.${eventKey}`);

  const row = <T,>(
    label: string,
    data: Row<T>,
    render: (cell: T) => ReactNode,
  ) => (
    <tr className="border-t border-border align-top">
      <th
        scope="row"
        className="sticky start-0 z-10 w-32 border-e border-border/60 bg-surface py-3 pe-3 text-start text-sm font-medium"
      >
        {label}
      </th>
      {data.status === "loading" ? (
        days.map((day) => (
          <td key={day} className="p-1.5">
            <Skeleton className="h-10 w-full" />
          </td>
        ))
      ) : data.status === "error" ? (
        <td colSpan={days.length} className="p-1.5">
          <div role="alert" className="flex flex-wrap items-center gap-3 py-2">
            <span className="text-sm">{t("outlook.rowError")}</span>
            <button
              type="button"
              onClick={data.retry}
              className="min-h-11 rounded-md border border-border px-3 text-sm font-medium"
            >
              {t("retry")}
            </button>
          </div>
        </td>
      ) : (
        data.cells.map((cell, i) => (
          <td key={days[i]} className="min-w-32 p-1.5">
            {render(cell)}
          </td>
        ))
      )}
    </tr>
  );

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={t("outlook.caption", { place })}
      className="overflow-x-auto"
    >
      <table className="w-full border-collapse">
        <caption className="pb-3 text-start font-display text-lg">
          {t("outlook.caption", { place })}
        </caption>
        <thead>
          <tr>
            <td className="sticky start-0 z-10 border-e border-border/60 bg-surface" />
            {days.map((day, i) => (
              <th
                key={day}
                scope="col"
                className="p-1.5 text-start text-sm font-medium"
              >
                {dayLabel(day, i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row(t("outlook.rowOnm"), onm, (cell) =>
            cell.state === "warning" ? (
              <Level level={cell.level}>
                <span className="inline-flex items-center gap-1 font-medium">
                  <ShieldAlert aria-hidden className="size-3.5 shrink-0" />
                  <span className="tabular-nums">{cell.level}</span>
                  <span>{t(`outlook.onmLevel.${cell.level}`)}</span>
                </span>
                <span className="block">
                  {cell.events.map(onmEventLabel).join(t("outlook.separator"))}
                </span>
              </Level>
            ) : (
              <Quiet>
                {cell.state === "none"
                  ? t("outlook.onmNone")
                  : t("outlook.onmNotIssued")}
              </Quiet>
            ),
          )}
          {row(t("outlook.rowFire"), fire, (cell) =>
            cell ? (
              <RiskChip level={cell.level} fuelLimited={cell.fuelLimited} />
            ) : (
              <Quiet>{t("outlook.notPublished")}</Quiet>
            ),
          )}
          {row(t("outlook.rowWeather"), weather, (cell) =>
            cell ? (
              <div className="tabular text-sm">
                <span className="block font-medium">
                  {t("outlook.weatherTemp", {
                    temp: Math.round(cell.tempC),
                  })}
                </span>
                <span className="block text-muted-foreground">
                  {t("outlook.weatherWind", {
                    wind: Math.round(cell.windKmh),
                  })}
                </span>
                <span className="block text-muted-foreground">
                  {t("outlook.weatherRain", {
                    rain: Math.round(cell.rainMm * 10) / 10,
                  })}
                </span>
              </div>
            ) : (
              <Quiet>{t("outlook.notPublished")}</Quiet>
            ),
          )}
          {row(t("outlook.rowAir"), air, (cell) =>
            cell.state === "ok" ? (
              <Level level={SMOKE_TINT[cell.level]}>
                <span className="inline-flex items-center gap-1 font-medium">
                  <Wind aria-hidden className="size-3.5 shrink-0" />
                  <span className="tabular-nums">{SMOKE_TINT[cell.level]}</span>
                  <span>{t(`outlook.airLevel.${cell.level}`)}</span>
                </span>
                <span className="block text-xs">
                  {t("outlook.airBy", {
                    pollutant: cell.pollutant === "pm10" ? "PM10" : "PM2.5",
                  })}
                </span>
              </Level>
            ) : (
              <Quiet>{t("outlook.airBeyond")}</Quiet>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
