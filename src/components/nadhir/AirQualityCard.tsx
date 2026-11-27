import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { Locale } from "@/i18n";
import {
  SMOKE_TINT,
  WHO_PM25_24H,
  airQualityQuery,
  smokeLevel,
} from "@/lib/air-quality";
import { relativeTime } from "@/lib/nadhir";

export function AirQualityCard({
  lat,
  lon,
  locale,
}: {
  lat: number;
  lon: number;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const air = useQuery(airQualityQuery({ lat, lon }));
  if (!air.data) return null;
  const reading = air.data;
  const level = smokeLevel(reading.pm2_5);
  const tint = SMOKE_TINT[level];
  return (
    <section className="card p-4">
      <h2 className="text-base">{t("fire.air")}</h2>
      <dl className="mt-3 flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-muted-foreground">{t("fire.airPm25")}</dt>
          <dd className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="tabular text-base font-semibold">
              {reading.pm2_5.toFixed(1)} µg/m³
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: `var(--risk-tint-${tint})`,
                color: `var(--risk-ink-${tint})`,
              }}
            >
              {t(`survival.smokeLevel.${level}`)}
            </span>
          </dd>
        </div>
        <p className="tabular text-end text-xs text-muted-foreground">
          {t("fire.airWho", {
            ratio: (reading.pm2_5 / WHO_PM25_24H).toFixed(1),
          })}
        </p>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-muted-foreground">{t("fire.airDust")}</dt>
          <dd className="text-end">
            <span className="tabular text-base font-semibold">
              {reading.dust.toFixed(0)} µg/m³
            </span>
            <span className="block text-xs text-muted-foreground">
              {t("fire.airDustNote")}
            </span>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {t("fire.airSource", {
          time: relativeTime(reading.observedAt, locale),
        })}
      </p>
    </section>
  );
}
