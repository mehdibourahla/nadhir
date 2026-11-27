import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";

import type { AnyLocale } from "@/i18n";
import {
  HAZARDS,
  allHistoryRecords,
  historyCsv,
  historyRecordsQuery,
  historySummaryQuery,
  type Hazard,
  type HistoryFilters,
} from "@/lib/hazard-history";
import { adminUnitsQuery, algiersTime, unitName } from "@/lib/nadhir";
import { pageMeta } from "@/lib/page-meta";
import { wilayaByCode } from "@/lib/wilaya-slugs";
import { cn } from "@/lib/utils";
import { AtlasPageFooter } from "@/ui/app-shell";
import { cleanCopy, formatNumber } from "@/ui/format";
import {
  AlgiersClock,
  AtlasBadge,
  AtlasButton,
  AtlasEmpty,
  AtlasError,
  AtlasLoading,
  AtlasMasthead,
  AtlasPanel,
  AtlasSelect,
  SafeBdi,
} from "@/ui/primitives";

const ALL: HistoryFilters = { hazard: null, wilayaId: null, year: null };

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: pageMeta("history.metaTitle", "history.metaDescription"),
  }),
  loader: async ({ context }) => {
    await Promise.allSettled([
      context.queryClient.ensureQueryData(historySummaryQuery(ALL)),
      context.queryClient.ensureInfiniteQueryData(historyRecordsQuery(ALL)),
      context.queryClient.ensureQueryData(adminUnitsQuery),
    ]);
  },
  component: HistoryPage,
});

function HistoryPage() {
  const { t, i18n } = useTranslation(["translation", "weather"]);
  const locale = (i18n.language || "ar") as AnyLocale;

  const [hazard, setHazard] = useState<Hazard | null>(null);
  const [wilayaId, setWilayaId] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const filters: HistoryFilters = useMemo(
    () => ({ hazard, wilayaId, year }),
    [hazard, wilayaId, year],
  );

  const summaryQ = useQuery(historySummaryQuery(filters));
  const recordsQ = useInfiniteQuery(historyRecordsQuery(filters));
  const unitsQ = useQuery({ ...adminUnitsQuery, staleTime: 10 * 60_000 });

  const units = unitsQ.data ?? [];
  const wilayas = useMemo(
    () => units.filter((u) => u.level === "wilaya"),
    [units],
  );
  const unitsById = useMemo(
    () => new Map(units.map((u) => [u.id, u])),
    [units],
  );

  const summary = summaryQ.data;
  const records = recordsQ.data ?? [];

  const chartData = useMemo(() => {
    if (!summary?.buckets) return [];
    const fmt = new Intl.DateTimeFormat(
      locale === "ar" ? "ar-DZ" : locale === "fr" ? "fr-DZ" : "en-GB",
      {
        day: "numeric",
        month: "short",
        numberingSystem: "latn",
      },
    );
    return summary.buckets.map((b) => {
      const d = new Date(`${b.start.slice(0, 10)}T12:00:00Z`);
      return {
        ...b,
        label: Number.isNaN(d.getTime()) ? b.start.slice(0, 10) : fmt.format(d),
      };
    });
  }, [summary?.buckets, locale]);

  const maxWilayaTotal = useMemo(() => {
    if (!summary?.ranking?.length) return 1;
    return Math.max(1, ...summary.ranking.map((r) => r.total));
  }, [summary?.ranking]);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const all = await allHistoryRecords(filters);
      const csv = historyCsv(all, units);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nadhir-history-${year ?? "all"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 pb-12">
      {/* NYT Graphics Editorial Header with Giant Hairline-Divided Figures */}
      <AtlasMasthead
        edition={
          <>
            <span>
              {locale === "ar"
                ? "الأرشيف الوطني للمخاطر"
                : locale === "fr"
                  ? "ARCHIVES NATIONALES"
                  : "NATIONAL HAZARD ARCHIVE"}
            </span>
            <span>·</span>
            <AlgiersClock />
          </>
        }
        title={
          locale === "ar"
            ? "سجل المخاطر والإحصاءات"
            : locale === "fr"
              ? "Historique des risques"
              : "Hazard history & statistics"
        }
        subtitle={
          locale === "ar"
            ? "التوزيع الزمني والولائي لنشرات الأرصاد الجوية وحرائق الغابات واضطرابات الطرق في الجزائر."
            : locale === "fr"
              ? "Chronologie officielle des vigilances ONM, incendies détectés et incidents routiers en Algérie."
              : "Verified timeline of ONM advisories, detected wildfires, and road disruptions across Algeria."
        }
        actions={
          <AtlasButton
            variant="secondary"
            size="sm"
            onClick={() => void handleExportCsv()}
            disabled={exporting}
          >
            <Download className="h-4 w-4 text-signal" />
            {exporting ? "..." : "CSV"}
          </AtlasButton>
        }
        metrics={
          summary
            ? [
                {
                  label:
                    locale === "ar"
                      ? "إجمالي السجلات"
                      : locale === "fr"
                        ? "Total des événements"
                        : "Recorded events",
                  value: (
                    <SafeBdi>{formatNumber(summary.total, locale)}</SafeBdi>
                  ),
                  tone: "signal",
                },
                {
                  label:
                    locale === "ar"
                      ? "بؤر الحرائق"
                      : locale === "fr"
                        ? "Foyers d'incendie"
                        : "Fire clusters",
                  value: (
                    <SafeBdi>{formatNumber(summary.fires, locale)}</SafeBdi>
                  ),
                  tone: "extreme",
                },
                {
                  label:
                    locale === "ar"
                      ? "المساحة المقدرة (هكتار)"
                      : locale === "fr"
                        ? "Surface estimée (ha)"
                        : "Estimated area (ha)",
                  value: (
                    <SafeBdi>
                      {formatNumber(Math.round(summary.burnedHa), locale)} ha
                    </SafeBdi>
                  ),
                  tone: "high",
                },
                {
                  label:
                    locale === "ar"
                      ? "تدخلات الحماية المدنية"
                      : locale === "fr"
                        ? "Interventions DGPC"
                        : "DGPC incidents",
                  value: (
                    <SafeBdi>{formatNumber(summary.official, locale)}</SafeBdi>
                  ),
                },
              ]
            : undefined
        }
      />

      {/* Filter Bar */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-xl border border-hairline bg-surface p-1">
          <button
            type="button"
            onClick={() => setHazard(null)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              hazard === null
                ? "bg-signal text-signal-ink"
                : "text-ink-secondary hover:text-ink",
            )}
          >
            {locale === "ar" ? "الكل" : locale === "fr" ? "Tous" : "All"}
          </button>
          {HAZARDS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHazard(h)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                hazard === h
                  ? "bg-signal text-signal-ink"
                  : "text-ink-secondary hover:text-ink",
              )}
            >
              {h === "fire"
                ? locale === "ar"
                  ? "حرائق"
                  : locale === "fr"
                    ? "Incendies"
                    : "Fires"
                : h === "weather"
                  ? locale === "ar"
                    ? "أرصاد"
                    : locale === "fr"
                      ? "Météo ONM"
                      : "Weather"
                  : locale === "ar"
                    ? "طرق"
                    : locale === "fr"
                      ? "Routes"
                      : "Roads"}
            </button>
          ))}
        </div>

        <AtlasSelect
          aria-label="Wilaya filter"
          value={wilayaId ?? ""}
          onChange={(e) => setWilayaId(e.target.value || null)}
          className="w-48 h-9 text-xs"
        >
          <option value="">
            {locale === "ar"
              ? "كل الولايات (69)"
              : locale === "fr"
                ? "Toutes les wilayas (69)"
                : "All 69 wilayas"}
          </option>
          {wilayas.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} · {unitName(w, locale)}
            </option>
          ))}
        </AtlasSelect>

        {summary && summary.years.length > 0 && (
          <AtlasSelect
            aria-label="Year filter"
            value={year ? String(year) : ""}
            onChange={(e) =>
              setYear(e.target.value ? Number(e.target.value) : null)
            }
            className="w-40 h-9 text-xs"
          >
            <option value="">
              {locale === "ar"
                ? "كل السنوات"
                : locale === "fr"
                  ? "Toutes les années"
                  : "All years"}
            </option>
            {summary.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </AtlasSelect>
        )}
      </div>

      {summaryQ.isLoading ? (
        <AtlasLoading />
      ) : summaryQ.isError ? (
        <AtlasError
          title={t("common.error")}
          onRetry={() => void summaryQ.refetch()}
        />
      ) : summary ? (
        <div className="space-y-10">
          {/* Primary Editorial Timeline Visualization + Wilaya Ranking Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <AtlasPanel className="lg:col-span-8 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-xl font-semibold text-ink">
                  {locale === "ar"
                    ? "التطور الزمني للأحداث"
                    : locale === "fr"
                      ? "Évolution chronologique"
                      : "Temporal trend"}
                </h2>
                <div className="flex items-center gap-4 text-xs text-ink-secondary">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-hazard-rain" />
                    ONM
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-hazard-extreme" />
                    {locale === "ar"
                      ? "حرائق"
                      : locale === "fr"
                        ? "Feux"
                        : "Fires"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-hazard-high" />
                    {locale === "ar"
                      ? "طرق"
                      : locale === "fr"
                        ? "Routes"
                        : "Roads"}
                  </span>
                </div>
              </div>

              <div className="h-72 w-full" dir="ltr">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--atlas-hairline)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{
                          fill: "var(--atlas-ink-muted)",
                          fontSize: 11,
                          fontFamily: "JetBrains Mono",
                        }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={24}
                      />
                      <YAxis
                        tick={{
                          fill: "var(--atlas-ink-muted)",
                          fontSize: 11,
                          fontFamily: "JetBrains Mono",
                        }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--atlas-surface)",
                          border: "1px solid var(--atlas-hairline-strong)",
                          borderRadius: "10px",
                          fontSize: "12px",
                          color: "var(--atlas-ink)",
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="weather"
                        stackId="1"
                        stroke="var(--hazard-rain)"
                        fill="var(--hazard-rain)"
                        fillOpacity={0.22}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="fire"
                        stackId="1"
                        stroke="var(--hazard-extreme)"
                        fill="var(--hazard-extreme)"
                        fillOpacity={0.3}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="road"
                        stackId="1"
                        stroke="var(--hazard-high)"
                        fill="var(--hazard-high)"
                        fillOpacity={0.24}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <AtlasEmpty title={t("common.none")} />
                )}
              </div>
            </AtlasPanel>

            {/* Top Wilayas Ranked Bar List */}
            <AtlasPanel className="lg:col-span-4 space-y-4">
              <h2 className="font-display text-xl font-semibold text-ink">
                {locale === "ar"
                  ? "الولايات الأكثر تسجيلاً"
                  : locale === "fr"
                    ? "Wilayas les plus touchées"
                    : "Most affected wilayas"}
              </h2>
              <div className="space-y-3">
                {summary.ranking.slice(0, 8).map((row) => {
                  const w = unitsById.get(row.wilayaId);
                  const slug = w ? wilayaByCode(w.code)?.slug : undefined;
                  const pct = Math.max(
                    6,
                    Math.round((row.total / maxWilayaTotal) * 100),
                  );
                  return (
                    <div key={row.wilayaId} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        {slug && w ? (
                          <Link
                            to="/wilaya/$slug"
                            params={{ slug }}
                            className="font-medium text-ink hover:text-signal truncate"
                          >
                            <SafeBdi className="font-mono text-ink-muted me-1.5">
                              {w.code}
                            </SafeBdi>
                            {unitName(w, locale)}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink truncate">
                            {w ? unitName(w, locale) : row.wilayaId}
                          </span>
                        )}
                        <SafeBdi className="font-mono text-ink-secondary tabular-nums shrink-0 ms-2">
                          {formatNumber(row.total, locale)}
                        </SafeBdi>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
                        <div
                          className="h-full rounded-full bg-signal"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </AtlasPanel>
          </div>

          {/* Archive Ledger */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <h2 className="font-display text-2xl font-semibold text-ink">
                {locale === "ar"
                  ? "سجل الأحداث المفصل"
                  : locale === "fr"
                    ? "Journal des événements"
                    : "Event archive"}
              </h2>
              <SafeBdi className="font-mono text-xs text-ink-muted">
                {formatNumber(records.length, locale)}
              </SafeBdi>
            </div>

            {records.length === 0 ? (
              <AtlasEmpty title={t("common.none")} />
            ) : (
              <div className="divide-y divide-hairline border-y border-hairline bg-surface">
                {records.map((rec) => {
                  const w = rec.wilayaId ? unitsById.get(rec.wilayaId) : null;
                  const tone =
                    rec.hazard === "fire"
                      ? "extreme"
                      : rec.hazard === "weather"
                        ? "rain"
                        : "high";
                  const hazardLabel =
                    rec.hazard === "fire"
                      ? locale === "ar"
                        ? "حريق"
                        : locale === "fr"
                          ? "Incendie"
                          : "Fire"
                      : rec.hazard === "weather"
                        ? locale === "ar"
                          ? "أرصاد"
                          : locale === "fr"
                            ? "Météo"
                            : "Weather"
                        : locale === "ar"
                          ? "طرق"
                          : locale === "fr"
                            ? "Route"
                            : "Road";
                  const sevText = rec.weather
                    ? locale === "fr"
                      ? rec.weather.severity === "Extreme"
                        ? "Extrême"
                        : rec.weather.severity === "Severe"
                          ? "Sévère"
                          : "Modéré"
                      : locale === "ar"
                        ? rec.weather.severity === "Extreme"
                          ? "قصوى"
                          : rec.weather.severity === "Severe"
                            ? "شديد"
                            : "متوسط"
                        : rec.weather.severity
                    : "";
                  return (
                    <div
                      key={rec.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 text-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <AtlasBadge tone={tone}>{hazardLabel}</AtlasBadge>
                        <span className="font-medium text-ink truncate">
                          {w ? unitName(w, locale) : "Algeria"}
                        </span>
                        <span className="text-xs text-ink-secondary truncate">
                          {rec.fire
                            ? `${Math.round(rec.fire.areaHa)} ha · ${rec.fire.state}`
                            : rec.weather
                              ? `${sevText} · ${t(`weather:outlook.event.${rec.weather.event}`, { defaultValue: rec.weather.event })}`
                              : cleanCopy(rec.road?.summary)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {rec.fire?.shortId && (
                          <Link
                            to="/fire/$id"
                            params={{ id: rec.fire.shortId }}
                            className="font-mono text-xs text-signal hover:underline"
                          >
                            {rec.fire.shortId}
                          </Link>
                        )}
                        <SafeBdi className="font-mono text-xs text-ink-muted tabular-nums">
                          {algiersTime(rec.at)}
                        </SafeBdi>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {recordsQ.hasNextPage && (
              <div className="flex justify-center pt-2">
                <AtlasButton
                  variant="secondary"
                  onClick={() => void recordsQ.fetchNextPage()}
                  disabled={recordsQ.isFetchingNextPage}
                >
                  {t("common.loadMore")}
                </AtlasButton>
              </div>
            )}
          </section>
        </div>
      ) : null}

      <AtlasPageFooter />
    </div>
  );
}
