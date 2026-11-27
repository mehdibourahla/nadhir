import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

import type { AnyLocale } from "@/i18n";
import { sourceHealthQuery } from "@/lib/nadhir";
import { pageMeta } from "@/lib/page-meta";
import {
  summariseSourceHealth,
  type SourceHealth,
  type SourceHealthState,
} from "@/lib/source-health";
import { cn } from "@/lib/utils";
import { AtlasPageFooter } from "@/ui/app-shell";
import { cleanCopy, formatAgeMinutes, formatNumber } from "@/ui/format";
import {
  AlgiersClock,
  AtlasBadge,
  AtlasButton,
  AtlasError,
  AtlasLoading,
  AtlasMasthead,
  AtlasPanel,
  SafeBdi,
  type HazardTone,
} from "@/ui/primitives";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: pageMeta("status.metaTitle", "status.metaDescription"),
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(sourceHealthQuery),
  component: StatusPage,
});

function stateTone(state: SourceHealthState): HazardTone {
  if (state === "healthy") return "clear";
  if (state === "delayed" || state === "backfilling") return "high";
  if (state === "paused") return "neutral";
  return "extreme";
}

function tickColor(state: SourceHealthState): string {
  if (state === "healthy") return "bg-hazard-clear";
  if (state === "delayed" || state === "backfilling") return "bg-hazard-high";
  if (state === "paused") return "bg-ink-muted";
  return "bg-hazard-extreme";
}

function humanizeKey(raw: string): string {
  return raw
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function familyLabel(family: string, locale: AnyLocale): string {
  const map: Record<string, { en: string; fr: string; ar: string }> = {
    broadcast_delivery: {
      en: "Broadcast & delivery",
      fr: "Diffusion et alertes",
      ar: "بث وإرسال التنبيهات",
    },
    civil_information: {
      en: "Civil & road information",
      fr: "Information civile et routes",
      ar: "المعلومات المدنية والطرق",
    },
    fire_detection: {
      en: "Satellite fire detection",
      fr: "Détection satellitaire des feux",
      ar: "رصد الحرائق بالأقمار الصناعية",
    },
    fire_risk: {
      en: "Fire danger & FWI",
      fr: "Danger d'incendie et FWI",
      ar: "خطر الحرائق ومؤشر FWI",
    },
    reference_enrichment: {
      en: "Reference & enrichment",
      fr: "Données de référence",
      ar: "بيانات مرجعية مساعدة",
    },
    weather: {
      en: "Weather & ONM",
      fr: "Météo et ONM",
      ar: "الأرصاد الجوية",
    },
    seismic: {
      en: "Seismic monitoring",
      fr: "Suivi sismique",
      ar: "الرصد الزلزالي",
    },
  };
  const hit = map[family];
  if (!hit) return humanizeKey(family);
  return locale === "ar" ? hit.ar : locale === "fr" ? hit.fr : hit.en;
}

function StatusPage() {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;
  const healthQ = useQuery({ ...sourceHealthQuery, refetchInterval: 60_000 });
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const sources = healthQ.data ?? [];
  const summary = useMemo(() => summariseSourceHealth(sources), [sources]);

  const affected = useMemo(
    () => sources.filter((s) => s.state !== "healthy"),
    [sources],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, SourceHealth[]>();
    for (const s of sources) {
      const fam = s.family || "other";
      const list = map.get(fam);
      if (list) list.push(s);
      else map.set(fam, [s]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sources]);

  const hovered = sources.find((s) => s.key === hoveredKey) ?? null;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <span>
              {locale === "ar"
                ? "مراقبة مصادر البيانات"
                : locale === "fr"
                  ? "TÉLÉMÉTRIE DES SOURCES"
                  : "DATA PIPELINE TELEMETRY"}
            </span>
            <span>·</span>
            <AlgiersClock />
          </>
        }
        title={
          summary.allHealthy
            ? locale === "ar"
              ? "جميع مصادر البيانات تعمل بشكل طبيعي"
              : locale === "fr"
                ? "Toutes les sources sont opérationnelles"
                : "All data pipelines operational"
            : locale === "ar"
              ? `${formatNumber(summary.affected, locale)} مصادر متأثرة حاليًا`
              : locale === "fr"
                ? summary.affected === 1
                  ? "1 source perturbée"
                  : `${formatNumber(summary.affected, locale)} sources perturbées`
                : summary.affected === 1
                  ? "1 data source affected"
                  : `${formatNumber(summary.affected, locale)} data sources affected`
        }
        subtitle={
          locale === "ar"
            ? "حالة التحديث الحي لكل طبقة رصد جوي وزلزالي وأقمار صناعية تغذي خريطة نذير."
            : locale === "fr"
              ? "Fraîcheur en temps réel de chaque flux satellitaire, météorologique, sismique et officiel alimentant Nadhir."
              : "Live freshness and ingestion status of every satellite, meteorological, seismic, and official feed powering Nadhir."
        }
        actions={
          <AtlasButton
            variant="secondary"
            size="sm"
            onClick={() => void healthQ.refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {locale === "ar"
              ? "تحديث"
              : locale === "fr"
                ? "Actualiser"
                : "Refresh"}
          </AtlasButton>
        }
        metrics={[
          {
            label:
              locale === "ar"
                ? "إجمالي المصادر"
                : locale === "fr"
                  ? "Sources suivies"
                  : "Monitored layers",
            value: <SafeBdi>{formatNumber(sources.length, locale)}</SafeBdi>,
          },
          {
            label:
              locale === "ar"
                ? "سليمة"
                : locale === "fr"
                  ? "Opérationnelles"
                  : "Healthy",
            value: (
              <SafeBdi>
                {formatNumber(sources.length - summary.affected, locale)}
              </SafeBdi>
            ),
            tone: "clear",
          },
          {
            label:
              locale === "ar"
                ? "متأثرة"
                : locale === "fr"
                  ? "Affectées"
                  : "Affected",
            value: <SafeBdi>{formatNumber(summary.affected, locale)}</SafeBdi>,
            tone: summary.affected > 0 ? "high" : "clear",
          },
          {
            label:
              locale === "ar"
                ? "حرجة متأثرة"
                : locale === "fr"
                  ? "Critiques affectées"
                  : "Critical impacted",
            value: (
              <SafeBdi>
                {formatNumber(summary.criticalAffected, locale)}
              </SafeBdi>
            ),
            tone: summary.criticalAffected > 0 ? "extreme" : "clear",
          },
        ]}
      />

      {healthQ.isLoading ? (
        <AtlasLoading />
      ) : healthQ.isError ? (
        <AtlasError
          title={t("common.error")}
          onRetry={() => void healthQ.refetch()}
        />
      ) : (
        <div className="space-y-8">
          {/* Signature 28-Tick Visual Uptime Bar (1 tick per live data layer) */}
          <AtlasPanel className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {summary.allHealthy ? (
                  <CheckCircle2 className="h-4 w-4 text-hazard-clear" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-hazard-high" />
                )}
                <span className="text-sm font-semibold text-ink">
                  {locale === "ar"
                    ? `شريط الحالة اللحظي (${sources.length} طبقة)`
                    : locale === "fr"
                      ? `Barre de télémétrie en direct (${sources.length} flux)`
                      : `Live layer status bar (${sources.length} feeds)`}
                </span>
              </div>
              <div className="min-h-[20px] text-xs font-mono text-ink-secondary">
                {hovered ? (
                  <span>
                    {cleanCopy(hovered.label)} · {hovered.state} ·{" "}
                    <SafeBdi>
                      {formatAgeMinutes(hovered.age_minutes, locale)}
                    </SafeBdi>
                  </span>
                ) : (
                  <span>
                    {formatNumber(
                      sources.length
                        ? Math.round(
                            ((sources.length - summary.affected) /
                              sources.length) *
                              100,
                          )
                        : 100,
                      locale,
                    )}
                    % operational
                  </span>
                )}
              </div>
            </div>

            <div
              className="flex items-stretch gap-1 sm:gap-1.5 h-10"
              role="list"
              aria-label="Source health ticks"
            >
              {sources.map((src) => (
                <button
                  key={src.key}
                  type="button"
                  role="listitem"
                  onMouseEnter={() => setHoveredKey(src.key)}
                  onFocus={() => setHoveredKey(src.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  aria-label={`${src.label}: ${src.state}`}
                  className={cn(
                    "flex-1 rounded-[4px] transition-opacity cursor-pointer min-w-[4px]",
                    tickColor(src.state),
                    hoveredKey && hoveredKey !== src.key
                      ? "opacity-45"
                      : "opacity-95 hover:opacity-100",
                  )}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-ink-muted">
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-hazard-clear" />
                  Healthy
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-hazard-high" />
                  Delayed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-hazard-extreme" />
                  Degraded / Stale
                </span>
              </div>
              <SafeBdi>{sources.length} ticks</SafeBdi>
            </div>
          </AtlasPanel>

          {/* Affected Sources Pinned Above the Fold */}
          {affected.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-xl font-semibold text-ink">
                {locale === "ar"
                  ? "المصادر المتأثرة حاليًا"
                  : locale === "fr"
                    ? "Sources affectées"
                    : "Affected sources"}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {affected.map((src) => {
                  const tone = stateTone(src.state);
                  const isSevere = tone === "extreme";
                  return (
                    <div
                      key={src.key}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-xl border px-4 py-3",
                        isSevere
                          ? "border-hazard-extreme/40 bg-hazard-extreme-soft/45"
                          : "border-hazard-high/40 bg-hazard-high-soft/45",
                      )}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <AtlasBadge tone={tone} dot>
                            {humanizeKey(src.state)}
                          </AtlasBadge>
                          <span className="text-sm font-semibold text-ink truncate">
                            {cleanCopy(src.label)}
                          </span>
                        </div>
                        <div className="text-xs text-ink-secondary">
                          {familyLabel(src.family, locale)} ·{" "}
                          {humanizeKey(src.criticality)}
                          {src.public_reason_code
                            ? ` · ${humanizeKey(src.public_reason_code)}`
                            : ""}
                        </div>
                      </div>
                      <SafeBdi className="font-mono text-xs font-semibold text-ink tabular-nums shrink-0">
                        {formatAgeMinutes(src.age_minutes, locale)}
                      </SafeBdi>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Compact 2-Column Dense Source Telemetry List Grouped by Family */}
          <section className="space-y-6">
            <h2 className="font-display text-2xl font-semibold text-ink border-b border-hairline pb-3">
              {locale === "ar"
                ? "تفاصيل جميع طبقات الرصد"
                : locale === "fr"
                  ? "Toutes les sources par famille"
                  : "All sources by family"}
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {grouped.map(([family, rows]) => (
                <div
                  key={family}
                  className="overflow-hidden rounded-2xl border border-hairline bg-surface"
                >
                  <div className="flex items-center justify-between border-b border-hairline bg-surface-raised/60 px-4 py-2.5">
                    <span className="text-xs font-semibold text-ink">
                      {familyLabel(family, locale)}
                    </span>
                    <SafeBdi className="font-mono text-[11px] text-ink-muted">
                      {rows.filter((r) => r.state === "healthy").length}/
                      {rows.length}
                    </SafeBdi>
                  </div>
                  <div className="divide-y divide-hairline">
                    {rows.map((src) => (
                      <div
                        key={src.key}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "h-2 w-2 rounded-full shrink-0",
                              tickColor(src.state),
                            )}
                          />
                          <span className="truncate font-medium text-ink">
                            {cleanCopy(src.label)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 font-mono text-xs tabular-nums">
                          <span className="text-ink-muted">
                            <SafeBdi>
                              {formatAgeMinutes(src.age_minutes, locale)}
                            </SafeBdi>
                          </span>
                          <AtlasBadge tone={stateTone(src.state)}>
                            {src.state}
                          </AtlasBadge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <AtlasPageFooter />
    </div>
  );
}
