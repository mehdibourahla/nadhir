import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { riskInk, riskTint } from "@/components/nadhir/risk-visuals";
import { ErrorState, SkeletonList } from "@/components/nadhir/states";
import type { AnyLocale } from "@/i18n";
import type { WilayaOutlook } from "@/lib/forecast-outlook";
import { dangerLevelKey, unitName } from "@/lib/nadhir";
import { wilayaByCode } from "@/lib/wilaya-slugs";

const FIRST = 8;

const WEATHER_NS_ONM_EVENTS = new Set([
  "rain",
  "storm",
  "sand",
  "wind",
  "heat",
  "other",
]);

export function NationalOutlook({
  rows,
  loading,
  failed,
  partialFailure = false,
  lang,
  onRetry,
  onPick,
}: {
  rows: WilayaOutlook[];
  loading: boolean;
  failed: boolean;
  partialFailure?: boolean;
  lang?: AnyLocale | undefined;
  onRetry: () => void;
  onPick: (row: WilayaOutlook) => void;
}) {
  const { t, i18n } = useTranslation("weather");
  const locale = i18n.language as AnyLocale;
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FIRST);

  const onmEventLabel = (eventKey: string) =>
    WEATHER_NS_ONM_EVENTS.has(eventKey)
      ? t(`outlook.event.${eventKey}`)
      : t(`translation:track3.forecast.onmEvent.${eventKey}`);

  return (
    <section aria-labelledby="national-title" className="mt-12">
      <h2 id="national-title" className="text-xl">
        {t("outlook.nationalTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("outlook.nationalBody")}
      </p>
      {loading ? (
        <SkeletonList rows={4} className="mt-4" />
      ) : failed ? (
        <ErrorState
          body={t("outlook.nationalError")}
          onRetry={onRetry}
          className="mt-4"
        />
      ) : (
        <>
          {partialFailure ? (
            <div
              role="status"
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
            >
              <span>
                {t("translation:track3.forecast.nationalPartialError")}
              </span>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {t("translation:track3.forecast.retryAction")}
              </button>
            </div>
          ) : null}
          {rows.length === 0 ? (
            <p className="mt-4 text-sm">{t("outlook.nationalEmpty")}</p>
          ) : (
            <>
              <ul className="mt-4 divide-y divide-border border-y border-border">
                {shown.map((row) => {
                  const slugEntry = wilayaByCode(row.wilaya.code);
                  const wilayaLabel = unitName(row.wilaya, locale);
                  return (
                    <li
                      key={row.wilaya.id}
                      className="flex flex-wrap items-center gap-2 py-1"
                    >
                      <button
                        type="button"
                        onClick={() => onPick(row)}
                        className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-2 text-start transition-colors hover:bg-muted"
                      >
                        <span
                          aria-hidden
                          className="tabular inline-flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold"
                          style={{
                            backgroundColor: riskTint(row.level),
                            color: riskInk(row.level),
                          }}
                        >
                          {row.level}
                        </span>
                        <span className="min-w-28 flex-1 font-medium">
                          {wilayaLabel}
                        </span>
                        <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                          {row.weather ? (
                            <span>
                              {t(`outlook.onmLevel.${row.weather.level}`)}:{" "}
                              {row.weather.events
                                .map(onmEventLabel)
                                .join(t("outlook.separator"))}
                            </span>
                          ) : null}
                          {row.fire != null ? (
                            <span>
                              {t("outlook.nationalFire", {
                                level: t(
                                  `translation:risk.${dangerLevelKey(row.fire)}`,
                                ),
                              })}
                            </span>
                          ) : null}
                          {row.incidents > 0 ? (
                            <span>
                              {t(
                                "translation:track3.forecast.nationalIncidents",
                                {
                                  count: row.incidents,
                                },
                              )}
                            </span>
                          ) : null}
                          {row.quake ? (
                            <span>
                              {t("translation:track3.forecast.nationalQuake", {
                                magnitude: row.quake.magnitude.toFixed(1),
                              })}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      {slugEntry ? (
                        <Link
                          to="/wilaya/$slug"
                          params={{ slug: slugEntry.slug }}
                          search={lang ? { lang } : {}}
                          aria-label={t(
                            "translation:track3.forecast.viewWilayaPage",
                            { wilaya: wilayaLabel },
                          )}
                          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                        >
                          <span>
                            {t("translation:track3.forecast.openWilayaLink")}
                          </span>
                          <ChevronRight
                            aria-hidden
                            className="size-3.5 shrink-0 rtl:rotate-180"
                          />
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {rows.length > FIRST && !all ? (
                <button
                  type="button"
                  onClick={() => setAll(true)}
                  className="mt-3 min-h-11 text-sm font-medium text-primary underline"
                >
                  {t("outlook.nationalMore", { count: rows.length })}
                </button>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}
