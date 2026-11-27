import { useTranslation } from "react-i18next";

import type { Locale } from "@/i18n";
import type { AirportWeather } from "@/lib/airport-weather";
import { relativeTime } from "@/lib/nadhir";

type Props = { report: AirportWeather; locale: Locale; now: number };

export function AirportDetail({ report, locale, now }: Props) {
  const { t } = useTranslation();
  const airport = report.name ?? report.station;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t("station.eyebrow")}
      </p>
      <h2 className="text-lg font-semibold">
        {t("station.sandstorm", { airport })}
      </h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t("station.observed")}</dt>
        <dd>
          <time dateTime={report.observed_at}>
            {relativeTime(report.observed_at, locale, now)}
          </time>
        </dd>
        <dt className="text-muted-foreground">
          {t("station.visibilityLabel")}
        </dt>
        <dd className="tabular-nums">
          {t("station.metres", { m: report.visibility_m })}
        </dd>
        {report.wind_kt !== null ? (
          <>
            <dt className="text-muted-foreground">{t("station.wind")}</dt>
            <dd className="tabular-nums">
              {report.gust_kt
                ? t("station.windGusts", {
                    kt: report.wind_kt,
                    gust: report.gust_kt,
                  })
                : t("station.windKt", { kt: report.wind_kt })}
            </dd>
          </>
        ) : null}
      </dl>
      <p
        dir="ltr"
        className="rounded-md bg-muted p-2 font-mono text-xs text-muted-foreground"
      >
        {report.raw}
      </p>
      <p className="text-xs text-muted-foreground">{t("station.note")}</p>
    </div>
  );
}
