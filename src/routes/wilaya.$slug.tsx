import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Bell,
  CloudSun,
  ExternalLink,
  Flame,
  Map as MapIcon,
  Plane,
  ShieldCheck,
} from "lucide-react";

import { headTranslator, readActiveLocale, type AnyLocale } from "@/i18n";
import { parseAnyLocaleParam } from "@/i18n/locale-cookie";
import { classifyOnmEvent } from "@/lib/forecast-outlook";
import {
  algiersTime,
  coordLabel,
  dangerLevelKey,
  relativeTime,
  unitName,
} from "@/lib/nadhir";
import { bilingualSeoHead } from "@/lib/page-meta";
import { fetchWilayaSnapshot } from "@/lib/wilaya-data";
import {
  SITE_URL,
  WILAYA_REGISTRY,
  applyFrenchElision,
  wilayaBySlug,
  wilayaCanonicalUrl,
  wilayaName,
  wilayaShareImageUrl,
} from "@/lib/wilaya-slugs";
import { cn } from "@/lib/utils";
import { AtlasPageFooter } from "@/ui/app-shell";
import { cleanCopy, formatNumber } from "@/ui/format";
import {
  AlgiersClock,
  AtlasBadge,
  AtlasButton,
  AtlasEmpty,
  AtlasMetricStrip,
  AtlasPanel,
  SafeBdi,
  TONE_RULE,
  type HazardTone,
} from "@/ui/primitives";

type WilayaSearch = {
  lang?: AnyLocale;
};

export const Route = createFileRoute("/wilaya/$slug")({
  validateSearch: (search: Record<string, unknown>): WilayaSearch => {
    const raw = search["lang"];
    const lang = typeof raw === "string" ? parseAnyLocaleParam(raw) : null;
    return lang ? { lang } : {};
  },
  loader: async ({ params }) => {
    const wilaya = wilayaBySlug(params.slug);
    if (!wilaya) throw notFound();
    return fetchWilayaSnapshot(wilaya);
  },
  head: ({ loaderData, match }) => {
    if (!loaderData) {
      return { meta: [{ name: "robots", content: "noindex" }] };
    }
    const explicitLang = match.search.lang;
    const lang: AnyLocale = explicitLang ?? readActiveLocale();
    const t = headTranslator(lang);
    const localizedName = wilayaName(loaderData.wilaya, lang);
    const slug = loaderData.wilaya.slug;
    const rawTitle = t("track3.wilaya.metaTitle", {
      wilaya: localizedName,
      code: loaderData.wilaya.code,
    });
    const rawDescription = t("track3.wilaya.metaDescription", {
      wilaya: localizedName,
      code: loaderData.wilaya.code,
    });
    const rawOgImageAlt = t("track3.wilaya.ogImageAlt", {
      wilaya: localizedName,
    });
    const title = lang === "fr" ? applyFrenchElision(rawTitle) : rawTitle;
    const description =
      lang === "fr" ? applyFrenchElision(rawDescription) : rawDescription;
    const ogImageAlt =
      lang === "fr" ? applyFrenchElision(rawOgImageAlt) : rawOgImageAlt;
    return bilingualSeoHead({
      title,
      description,
      canonicalUrl: explicitLang
        ? wilayaCanonicalUrl(slug, explicitLang)
        : wilayaCanonicalUrl(slug),
      arUrl: wilayaCanonicalUrl(slug, "ar"),
      frUrl: wilayaCanonicalUrl(slug, "fr"),
      defaultUrl: wilayaCanonicalUrl(slug),
      locale: lang,
      ogImageUrl: `${SITE_URL}${wilayaShareImageUrl(slug, lang, "whatsapp")}`,
      ogImageAlt,
      robots: "index, follow",
    });
  },
  component: WilayaDossierPage,
});

function severityTone(sev: string): HazardTone {
  const s = sev.toLowerCase();
  if (s === "extreme" || s === "severe") return "extreme";
  if (s === "moderate") return "high";
  return "rain";
}

function validityState(
  onset: string | null,
  expires: string | null,
): { pct: number; upcomingHours: number | null } {
  if (!onset || !expires) return { pct: 40, upcomingHours: null };
  const start = Date.parse(onset);
  const end = Date.parse(expires);
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return { pct: 40, upcomingHours: null };
  if (now < start) {
    return {
      pct: 0,
      upcomingHours: Math.max(1, Math.round((start - now) / 3_600_000)),
    };
  }
  return {
    pct: Math.max(4, Math.min(100, ((now - start) / (end - start)) * 100)),
    upcomingHours: null,
  };
}

function WilayaDossierPage() {
  const snapshot = Route.useLoaderData();
  const { t, i18n } = useTranslation(["translation", "weather"]);
  const locale = (i18n.language || "ar") as AnyLocale;
  const { wilaya } = snapshot;

  const primaryName = wilayaName(wilaya, locale);
  const secondaryName = locale === "ar" ? wilaya.nameFr : wilaya.nameAr;

  const totalAlerts =
    snapshot.onmWarnings.length +
    snapshot.officialIncidents.length +
    snapshot.probableFires.length;

  const overallTone: HazardTone =
    snapshot.onmWarnings.some((w) => w.severity === "Extreme") ||
    snapshot.probableFires.some((f) => f.level === "confirmed")
      ? "extreme"
      : totalAlerts > 0
        ? "high"
        : "clear";

  const verdictLabel =
    overallTone === "extreme"
      ? locale === "ar"
        ? "تنبيه عالي المستوى"
        : locale === "fr"
          ? "Vigilance maximale"
          : "High alert active"
      : overallTone === "high"
        ? locale === "ar"
          ? "نشرات سارية"
          : locale === "fr"
            ? "Bulletins actifs"
            : "Active advisories"
        : locale === "ar"
          ? "الوضع هادئ حاليًا"
          : locale === "fr"
            ? "Situation calme"
            : "No active advisories";

  const firstCommune = snapshot.communes[0];

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 pb-12">
      {/* Editorial Swiss Civic Broadcast Masthead */}
      <header className="border-t-2 border-ink/85 dark:border-hairline-strong pt-5 pb-6 space-y-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-start gap-4 sm:gap-6 min-w-0">
            <SafeBdi className="font-mono text-5xl sm:text-6xl font-semibold tracking-tight leading-none text-signal tabular-nums shrink-0 pt-1">
              {wilaya.code}
            </SafeBdi>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink-secondary">
                <span>
                  {locale === "ar"
                    ? "النشرة الولائية الرسمية"
                    : locale === "fr"
                      ? "BULLETIN DE WILAYA"
                      : "WILAYA DOSSIER"}
                </span>
                <span>·</span>
                <SafeBdi className="font-mono">
                  {coordLabel(wilaya.lat, wilaya.lon)}
                </SafeBdi>
                <span>·</span>
                <AlgiersClock />
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="font-display text-3xl sm:text-5xl font-semibold tracking-tight text-ink leading-tight">
                  {primaryName}
                </h1>
                <span className="font-display text-xl sm:text-2xl text-ink-secondary">
                  {secondaryName}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <AtlasBadge tone={overallTone} dot>
                  {verdictLabel}
                </AtlasBadge>
                <span className="text-xs text-ink-muted">
                  {formatNumber(wilaya.communeCount, locale)}{" "}
                  {locale === "ar"
                    ? "بلدية"
                    : locale === "fr"
                      ? "communes"
                      : "communes"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link to="/">
              <AtlasButton variant="secondary" size="sm">
                <MapIcon className="h-4 w-4 text-signal" />
                {locale === "ar"
                  ? "فتح الخريطة"
                  : locale === "fr"
                    ? "Voir sur la carte"
                    : "Open on map"}
              </AtlasButton>
            </Link>
            {firstCommune && (
              <Link to="/forecast" search={{ commune: firstCommune.code }}>
                <AtlasButton variant="secondary" size="sm">
                  <CloudSun className="h-4 w-4 text-signal" />
                  {locale === "ar"
                    ? "توقعات 6 أيام"
                    : locale === "fr"
                      ? "Prévisions 6j"
                      : "6-day forecast"}
                </AtlasButton>
              </Link>
            )}
            <Link to="/zones" search={{ lat: wilaya.lat, lon: wilaya.lon }}>
              <AtlasButton variant="primary" size="sm">
                <Bell className="h-4 w-4" />
                {locale === "ar"
                  ? "متابعة التنبيهات"
                  : locale === "fr"
                    ? "Suivre cette wilaya"
                    : "Subscribe alerts"}
              </AtlasButton>
            </Link>
          </div>
        </div>

        <AtlasMetricStrip
          items={[
            {
              label: t("weather:outlook.rowOnm"),
              value: formatNumber(snapshot.onmWarnings.length, locale),
              tone: snapshot.onmWarnings.length > 0 ? "high" : "clear",
              detail:
                snapshot.onmWarnings.length > 0
                  ? "ONM CAP"
                  : t("weather:outlook.onmNone"),
            },
            {
              label:
                locale === "ar"
                  ? "حرائق مؤكدة / محتملة"
                  : locale === "fr"
                    ? "Feux probables / confirmés"
                    : "Active probable fires",
              value: formatNumber(snapshot.probableFires.length, locale),
              tone: snapshot.probableFires.length > 0 ? "extreme" : "clear",
              detail:
                snapshot.heatSignalCount > 0
                  ? `+${snapshot.heatSignalCount} thermal`
                  : locale === "ar"
                    ? "آخر 72 ساعة"
                    : locale === "fr"
                      ? "Fenêtre 72h"
                      : "72h window",
            },
            {
              label: t("weather:outlook.fireToday"),
              value: snapshot.fireDanger
                ? snapshot.fireDanger.allFuelLimited
                  ? "N/A"
                  : `FWI ${snapshot.fireDanger.fwi.toFixed(1)}`
                : "-",
              tone:
                snapshot.fireDanger &&
                !snapshot.fireDanger.allFuelLimited &&
                snapshot.fireDanger.dangerLevel >= 3
                  ? "high"
                  : "neutral",
              detail: snapshot.fireDanger
                ? snapshot.fireDanger.allFuelLimited
                  ? locale === "ar"
                    ? "وقود نباتي محدود"
                    : "Fuel limited"
                  : locale === "ar"
                    ? snapshot.fireDanger.dangerLevel >= 5
                      ? "قصوى"
                      : snapshot.fireDanger.dangerLevel === 4
                        ? "مرتفع جدًا"
                        : snapshot.fireDanger.dangerLevel === 3
                          ? "مرتفع"
                          : snapshot.fireDanger.dangerLevel === 2
                            ? "متوسط"
                            : "منخفض"
                    : locale === "fr"
                      ? snapshot.fireDanger.dangerLevel >= 5
                        ? "Extrême"
                        : snapshot.fireDanger.dangerLevel === 4
                          ? "Très élevé"
                          : snapshot.fireDanger.dangerLevel === 3
                            ? "Élevé"
                            : snapshot.fireDanger.dangerLevel === 2
                              ? "Modéré"
                              : "Faible"
                      : dangerLevelKey(snapshot.fireDanger.dangerLevel)
                : undefined,
            },
            {
              label:
                locale === "ar"
                  ? "رصد زلزالي (72 سا)"
                  : locale === "fr"
                    ? "Activité sismique (72h)"
                    : "Seismic watch (72h)",
              value: formatNumber(snapshot.earthquakes.length, locale),
              tone: snapshot.earthquakes.length > 0 ? "seismic" : "neutral",
              detail: snapshot.earthquakes[0]
                ? `M${snapshot.earthquakes[0].magnitude.toFixed(1)} · ${snapshot.earthquakes[0].distanceKm} km`
                : locale === "ar"
                  ? "نطاق 100 كم"
                  : locale === "fr"
                    ? "Rayon 100 km"
                    : "100 km radius",
            },
          ]}
        />
      </header>

      {/* Main Editorial Bulletin + Telemetry Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Editorial Column (8 cols): Official ONM Bulletins & Active Incidents */}
        <div className="lg:col-span-8 space-y-8">
          {/* Official ONM Vigilance Bulletins with 4px Start-Edge Vertical Severity Rules */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <h2 className="font-display text-2xl font-semibold text-ink">
                {t("weather:warnings")}
              </h2>
              <AtlasBadge tone="signal">
                <SafeBdi dir="ltr">ONM · CAP</SafeBdi>
              </AtlasBadge>
            </div>

            {snapshot.onmWarnings.length === 0 ? (
              <AtlasEmpty
                title={t("weather:outlook.onmNone")}
                body={t("weather:warningsNone")}
              />
            ) : (
              <div className="divide-y divide-hairline border-y border-hairline bg-surface">
                {snapshot.onmWarnings.map((w) => {
                  const tone = severityTone(w.severity);
                  const cat = classifyOnmEvent(w.event, w.title, w.headline_fr);
                  const { pct, upcomingHours } = validityState(
                    w.onset,
                    w.expires,
                  );
                  const capSuffix = w.cap_id.split(".").slice(-2).join(".");
                  const sevLabel =
                    locale === "ar"
                      ? w.severity === "Extreme"
                        ? "قصوى"
                        : w.severity === "Severe"
                          ? "شديد"
                          : "متوسط"
                      : locale === "fr"
                        ? w.severity === "Extreme"
                          ? "Extrême"
                          : w.severity === "Severe"
                            ? "Sévère"
                            : "Modéré"
                        : w.severity;
                  const evText = t(`weather:outlook.event.${cat}`, {
                    defaultValue: w.event,
                  });
                  const headline = cleanCopy(
                    locale === "ar"
                      ? `تنبيه ${evText} (${sevLabel}) · ولاية ${primaryName}`
                      : w.headline_fr || w.title || w.event,
                  );

                  return (
                    <article
                      key={w.id}
                      className="flex items-stretch gap-4 p-4 sm:p-5"
                    >
                      <span
                        aria-hidden="true"
                        className={cn("w-1 shrink-0", TONE_RULE[tone])}
                      />
                      <div className="flex-1 space-y-3 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <AtlasBadge tone={tone} dot>
                              {sevLabel} · {evText}
                            </AtlasBadge>
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-muted">
                              <ShieldCheck className="h-3.5 w-3.5 text-signal" />
                              ONM
                            </span>
                          </div>
                          <SafeBdi className="font-mono text-xs text-ink-muted">
                            CAP #{capSuffix}
                          </SafeBdi>
                        </div>

                        <h3 className="font-display text-xl font-semibold text-ink leading-snug">
                          {headline}
                        </h3>

                        {locale === "ar" && w.headline_fr && (
                          <p className="text-xs text-ink-secondary">
                            <SafeBdi>{cleanCopy(w.headline_fr)}</SafeBdi>
                          </p>
                        )}

                        {/* Validity Window Bar */}
                        <div className="space-y-1.5 pt-1">
                          <div className="flex items-center justify-between text-[11px] text-ink-secondary tabular-nums">
                            <SafeBdi className="font-mono">
                              {w.onset
                                ? algiersTime(w.onset)
                                : algiersTime(w.sent)}
                            </SafeBdi>
                            {upcomingHours !== null && (
                              <span className="font-medium text-ink-secondary">
                                {locale === "ar"
                                  ? `تبدأ بعد ${upcomingHours} سا`
                                  : locale === "fr"
                                    ? `Début dans ${upcomingHours} h`
                                    : `Starts in ${upcomingHours}h`}
                              </span>
                            )}
                            <SafeBdi className="font-mono">
                              {w.expires ? algiersTime(w.expires) : "-"}
                            </SafeBdi>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
                            {pct > 0 && (
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  TONE_RULE[tone],
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            )}
                          </div>
                        </div>

                        {w.cap_url && (
                          <div className="pt-1">
                            <a
                              href={w.cap_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium text-signal hover:underline"
                            >
                              {t("weather:officialSource")}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Active Probable & Confirmed Fires (Strict ADR-0002 Separation) */}
          <section className="space-y-4">
            <div className="flex items-center gap-2.5 border-b border-hairline pb-3">
              <Flame className="h-5 w-5 text-hazard-extreme shrink-0" />
              <h2 className="font-display text-2xl font-semibold text-ink">
                {locale === "ar"
                  ? "الحرائق النشطة والمحتملة"
                  : locale === "fr"
                    ? "Feux actifs et probables"
                    : "Active probable & confirmed fires"}
              </h2>
            </div>

            {snapshot.probableFires.length === 0 ? (
              <p className="text-sm text-ink-secondary py-2">
                {locale === "ar"
                  ? "لم يتم تسجيل أي حريق مؤكد أو محتمل في هذه الولاية خلال الساعات الـ 72 الماضية."
                  : locale === "fr"
                    ? "Aucun feu confirmé ou probable relevé dans cette wilaya sur les dernières 72 heures."
                    : "No confirmed or probable fires detected in this wilaya over the last 72 hours."}
              </p>
            ) : (
              <div className="divide-y divide-hairline border-y border-hairline bg-surface">
                {snapshot.probableFires.map((fire) => {
                  const commune = snapshot.communes.find(
                    (c) => c.id === fire.communeId,
                  );
                  return (
                    <Link
                      key={fire.id}
                      to="/fire/$id"
                      params={{ id: fire.shortId }}
                      className="flex items-center justify-between gap-4 p-4 hover:bg-surface-raised/60 transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <AtlasBadge
                            tone={
                              fire.level === "confirmed" ? "extreme" : "high"
                            }
                            dot
                          >
                            {fire.level}
                          </AtlasBadge>
                          <span className="font-semibold text-sm text-ink truncate">
                            {commune
                              ? unitName(commune, locale)
                              : coordLabel(fire.lat, fire.lon)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 font-mono text-xs text-ink-muted">
                          <SafeBdi>{coordLabel(fire.lat, fire.lon)}</SafeBdi>
                          <span>{fire.detectionCount} detections</span>
                        </div>
                      </div>
                      <span className="font-mono text-xs text-ink-secondary shrink-0">
                        {relativeTime(fire.lastDetectedAt, locale)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}

            {snapshot.heatSignalCount > 0 && (
              <p className="text-xs text-ink-muted">
                {locale === "ar"
                  ? `ملاحظة: توجد ${snapshot.heatSignalCount} إشارة حرارية غير مؤكدة من الأقمار الصناعية لا تُصنف كحرائق.`
                  : locale === "fr"
                    ? `Note : ${snapshot.heatSignalCount} signal(aux) thermique(s) non corroboré(s) exclu(s) des feux actifs.`
                    : `Note: ${snapshot.heatSignalCount} uncorroborated satellite heat signal(s) are excluded from probable fires.`}
              </p>
            )}
          </section>

          {/* Official DGPC Incidents */}
          {snapshot.officialIncidents.length > 0 && (
            <section className="space-y-4">
              <div className="border-b border-hairline pb-3">
                <h2 className="font-display text-2xl font-semibold text-ink">
                  {locale === "ar"
                    ? "تدخلات الحماية المدنية الرسمية"
                    : locale === "fr"
                      ? "Interventions officielles DGPC"
                      : "Official civil protection incidents"}
                </h2>
              </div>
              <div className="divide-y divide-hairline border-y border-hairline bg-surface">
                {snapshot.officialIncidents.map((inc) => (
                  <Link
                    key={inc.id}
                    to="/incident/$id"
                    params={{ id: inc.id }}
                    className="flex items-center justify-between gap-4 p-4 hover:bg-surface-raised/60 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <AtlasBadge tone="extreme" dot>
                          {inc.kind} · {inc.status}
                        </AtlasBadge>
                        <span className="text-sm font-semibold text-ink truncate">
                          {unitName(inc.commune ?? inc.wilaya, locale)}
                        </span>
                      </div>
                      {inc.place_text && (
                        <p className="text-xs text-ink-secondary truncate">
                          {cleanCopy(inc.place_text)}
                        </p>
                      )}
                    </div>
                    <span className="font-mono text-xs text-ink-muted shrink-0">
                      {relativeTime(inc.last_reported_at, locale)}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Telemetry Column (4 cols) */}
        <aside className="lg:col-span-4 space-y-5">
          {/* Nearest Aviation METAR EFB Tile */}
          <AtlasPanel className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-mono font-semibold text-ink-secondary">
                <Plane className="h-3.5 w-3.5 text-signal" />
                METAR
              </span>
              <span className="text-[11px] text-ink-muted">
                {locale === "ar" ? "100 كم" : "100 km"}
              </span>
            </div>

            {snapshot.airportWeather.length === 0 ? (
              <p className="text-xs text-ink-secondary">
                {locale === "ar"
                  ? "لا توجد محطة مطار قريبة برصد حديث."
                  : locale === "fr"
                    ? "Aucune observation METAR récente à proximité."
                    : "No recent METAR observation within 100 km."}
              </p>
            ) : (
              <div className="divide-y divide-hairline">
                {snapshot.airportWeather.map((st) => (
                  <div
                    key={st.station}
                    className="py-2.5 first:pt-0 last:pb-0 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <SafeBdi className="font-mono text-sm font-semibold text-signal">
                        {st.station}
                      </SafeBdi>
                      <span className="text-xs text-ink-muted tabular-nums">
                        <SafeBdi className="font-mono">{st.distanceKm}</SafeBdi>{" "}
                        {locale === "ar" ? "كم" : "km"}
                      </span>
                    </div>
                    <div className="text-xs text-ink-secondary">
                      <SafeBdi>{cleanCopy(st.name)}</SafeBdi>
                    </div>
                    <div className="flex items-center justify-between text-xs text-ink tabular-nums pt-0.5">
                      <SafeBdi className="font-mono">
                        {st.temp_c !== null
                          ? `${Math.round(st.temp_c)}°C`
                          : "-"}
                      </SafeBdi>
                      <span>
                        <SafeBdi className="font-mono">
                          {st.wind_kt !== null ? `${st.wind_kt}` : "-"}
                        </SafeBdi>{" "}
                        {st.wind_kt !== null
                          ? locale === "ar"
                            ? "عقدة"
                            : "kt"
                          : ""}
                      </span>
                      <span>
                        <SafeBdi className="font-mono">
                          {st.visibility_m !== null
                            ? `${(st.visibility_m / 1000).toFixed(1)}`
                            : "-"}
                        </SafeBdi>{" "}
                        {st.visibility_m !== null
                          ? locale === "ar"
                            ? "كم"
                            : "km"
                          : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AtlasPanel>

          {/* 72h Seismic Radius Watch */}
          <AtlasPanel className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-semibold text-ink-secondary">
                <Activity className="h-3.5 w-3.5 text-hazard-seismic" />
                {locale === "ar"
                  ? "النشاط الزلزالي"
                  : locale === "fr"
                    ? "Séismes (72h)"
                    : "Seismic watch (72h)"}
              </span>
              <SafeBdi className="font-mono text-xs text-ink-muted">
                {snapshot.earthquakes.length}
              </SafeBdi>
            </div>
            {snapshot.earthquakes.length === 0 ? (
              <p className="text-xs text-ink-secondary">
                {locale === "ar"
                  ? "لا هزات أرضية مسجلة في محيط 100 كم خلال 72 ساعة."
                  : locale === "fr"
                    ? "Aucun séisme enregistré dans un rayon de 100 km sur 72h."
                    : "No earthquakes recorded within 100 km over the past 72h."}
              </p>
            ) : (
              <div className="divide-y divide-hairline">
                {snapshot.earthquakes.slice(0, 5).map((q) => (
                  <div
                    key={q.id}
                    className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <AtlasBadge tone="seismic">
                          <SafeBdi>M{q.magnitude.toFixed(1)}</SafeBdi>
                        </AtlasBadge>
                        <span className="text-xs font-medium text-ink truncate">
                          {cleanCopy(q.region) || primaryName}
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-ink-muted">
                        <SafeBdi>
                          {q.distanceKm} km · {q.attribution}
                        </SafeBdi>
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-ink-secondary shrink-0">
                      {relativeTime(q.occurred_at, locale)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </AtlasPanel>

          {/* Neighboring / Quick Wilaya Switcher */}
          <AtlasPanel className="space-y-3">
            <h3 className="text-xs font-semibold text-ink-secondary">
              {locale === "ar"
                ? "ولايات أخرى"
                : locale === "fr"
                  ? "Autres wilayas"
                  : "Jump to wilaya"}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {WILAYA_REGISTRY.filter((w) =>
                [
                  "16",
                  "31",
                  "25",
                  "06",
                  "15",
                  "09",
                  "19",
                  "23",
                  "13",
                  "35",
                ].includes(w.code),
              ).map((w) => (
                <Link
                  key={w.code}
                  to="/wilaya/$slug"
                  params={{ slug: w.slug }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors",
                    w.slug === wilaya.slug
                      ? "border-signal bg-signal-soft text-signal font-semibold"
                      : "border-hairline bg-surface-raised/60 text-ink hover:border-hairline-strong",
                  )}
                >
                  <SafeBdi className="font-mono text-[10px] opacity-70">
                    {w.code}
                  </SafeBdi>
                  <span>{wilayaName(w, locale)}</span>
                </Link>
              ))}
            </div>
          </AtlasPanel>
        </aside>
      </div>

      <AtlasPageFooter />
    </div>
  );
}
