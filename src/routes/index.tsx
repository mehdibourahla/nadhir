import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  createFileRoute,
  useNavigate,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CloudRain,
  CloudSun,
  ExternalLink,
  Flame,
  Layers,
  MapPin,
  Plane,
  Search,
  SlidersHorizontal,
  TrafficCone,
  X,
} from "lucide-react";

import type { AnyLocale } from "@/i18n";
import { airportWeatherQuery } from "@/lib/airport-weather";
import {
  buildSituations,
  countSituationsByHazard,
  filterSituations,
  selectedSituation,
  situationSummary,
  type Situation,
} from "@/lib/civil-map";
import { civilMapGeoJSON, situationAreaId } from "@/lib/civil-map-geometry";
import {
  parseMapSearch,
  type HazardCategory,
  type MapSearch,
} from "@/lib/civil-map-search";
import { civilPublicationsQuery } from "@/lib/civil-publication-client";
import { earthquakesQuery } from "@/lib/earthquakes";
import { classifyOnmEvent } from "@/lib/forecast-outlook";
import { useGrantedPosition } from "@/lib/granted-position";
import {
  adminUnitsQuery,
  algiersTime,
  clustersQuery,
  communeGeomsQuery,
  coordLabel,
  officialIncidentsQuery,
  onmOutlinesQuery,
  onmVigilanceQuery,
  relativeTime,
  todayRiskForecastsQuery,
  unitName,
  type AdminUnit,
} from "@/lib/nadhir";
import { hazardReportsQuery } from "@/lib/open-areas";
import { pageMeta } from "@/lib/page-meta";
import { wilayaByCode } from "@/lib/wilaya-slugs";
import { cn } from "@/lib/utils";
import { defaultBasemapForTheme, type AtlasBasemap } from "@/ui/basemaps";
import { cleanCopy, formatNumber } from "@/ui/format";
import { AtlasHazardMap } from "@/ui/hazard-map";
import { PlaceSearchDialog } from "@/ui/place-search";
import {
  AlgiersClock,
  AtlasBadge,
  AtlasButton,
  SafeBdi,
  TONE_RULE,
  type HazardTone,
} from "@/ui/primitives";

export const Route = createFileRoute("/")({
  head: () => ({ meta: pageMeta("map.metaTitle", "map.metaDescription") }),
  validateSearch: (search: SearchSchemaInput & Partial<MapSearch>) =>
    parseMapSearch(search),
  component: LiveMapPage,
});

const SEVERITY_RANK: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
};

function onmTone(severity: string): HazardTone {
  const s = severity.toLowerCase();
  if (s === "extreme") return "extreme";
  if (s === "severe") return "high";
  if (s === "moderate") return "moderate";
  return "rain";
}

function situationTone(item: Situation): HazardTone {
  if (item.source === "onm") return onmTone(item.data.severity);
  if (item.source === "satellite")
    return item.level === "confirmed" ? "extreme" : "high";
  if (item.source === "seismic") return "seismic";
  if (item.category === "flood") return "rain";
  if (item.category === "road") return "high";
  if (item.category === "fire") return "extreme";
  return "signal";
}

type WilayaOnmGroup = {
  wilayaId: string;
  wilaya: AdminUnit | null;
  slug: string | null;
  code: string;
  maxSeverity: string;
  items: Extract<Situation, { source: "onm" }>[];
  events: string[];
};

function LiveMapPage() {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const grantedPos = useGrantedPosition();

  const [basemap, setBasemap] = useState<AtlasBasemap>("terrain");
  const [manualSatellite, setManualSatellite] = useState(false);
  const [showStations, setShowStations] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expandedWilayas, setExpandedWilayas] = useState<Set<string>>(
    () => new Set(),
  );
  const [focusTarget, setFocusTarget] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    key: number;
  } | null>(null);

  useEffect(() => {
    const syncBasemap = () => {
      if (manualSatellite) return;
      setBasemap(defaultBasemapForTheme());
    };
    syncBasemap();
    const obs = new MutationObserver(syncBasemap);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, [manualSatellite]);

  const unitsQ = useQuery({ ...adminUnitsQuery, staleTime: 10 * 60_000 });
  const firesQ = useQuery({ ...clustersQuery, refetchInterval: 60_000 });
  const officialQ = useQuery({
    ...officialIncidentsQuery,
    refetchInterval: 60_000,
  });
  const onmQ = useQuery({ ...onmVigilanceQuery, refetchInterval: 120_000 });
  const reportsQ = useQuery({
    ...hazardReportsQuery,
    refetchInterval: 60_000,
  });
  const pubQ = useQuery(civilPublicationsQuery(false));
  const quakesQ = useQuery(earthquakesQuery);
  const stationsQ = useQuery(airportWeatherQuery);
  const riskQ = useQuery({ ...todayRiskForecastsQuery, staleTime: 5 * 60_000 });

  const units = unitsQ.data ?? [];
  const unitsById = useMemo(
    () => new Map(units.map((u) => [u.id, u])),
    [units],
  );

  const dangerByCommune = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of riskQ.data ?? []) {
      if (!r.fuel_limited) map.set(r.commune_id, r.danger_level);
    }
    return map;
  }, [riskQ.data]);

  const now = Date.now();

  const allSituations = useMemo(
    () =>
      buildSituations({
        fires: firesQ.data ?? [],
        official: officialQ.data ?? [],
        reports: reportsQ.data ?? [],
        warnings: onmQ.data ?? [],
        publications: pubQ.data ?? [],
        earthquakes: quakesQ.data ?? [],
        stations: stationsQ.data ?? [],
        danger: dangerByCommune,
        units,
        now,
      }),
    [
      firesQ.data,
      officialQ.data,
      reportsQ.data,
      onmQ.data,
      pubQ.data,
      quakesQ.data,
      stationsQ.data,
      dangerByCommune,
      units,
    ],
  );

  const selectedArea = useMemo(
    () => (search.area ? (unitsById.get(search.area) ?? null) : null),
    [search.area, unitsById],
  );

  const baseFiltered = useMemo(
    () =>
      filterSituations(
        allSituations,
        {
          category: "all",
          area: selectedArea,
          showEnded: search.ended,
          showCandidates: search.candidates,
        },
        units,
      ),
    [allSituations, selectedArea, search.ended, search.candidates, units],
  );

  const counts = useMemo(
    () => countSituationsByHazard(baseFiltered),
    [baseFiltered],
  );

  const visible = useMemo(
    () =>
      filterSituations(
        allSituations,
        {
          category: search.hazard,
          area: selectedArea,
          showEnded: search.ended,
          showCandidates: search.candidates,
        },
        units,
      ),
    [
      allSituations,
      search.hazard,
      selectedArea,
      search.ended,
      search.candidates,
      units,
    ],
  );

  const summary = useMemo(
    () => situationSummary(allSituations),
    [allSituations],
  );

  const selected = useMemo(
    () => selectedSituation(allSituations, visible, search.event),
    [allSituations, visible, search.event],
  );

  const onmWilayaIds = useMemo(
    () =>
      visible
        .filter(
          (s): s is Extract<Situation, { source: "onm" }> => s.source === "onm",
        )
        .map((s) => s.data.wilaya_id)
        .filter((id): id is string => Boolean(id)),
    [visible],
  );

  const outlinesQ = useQuery(onmOutlinesQuery(onmWilayaIds));

  const selectedAreaIds = useMemo(() => {
    if (!selected) return [];
    const aid = situationAreaId(selected);
    return aid ? [aid] : [];
  }, [selected]);

  const geomsQ = useQuery(communeGeomsQuery(selectedAreaIds));

  const geoData = useMemo(
    () =>
      civilMapGeoJSON(
        visible,
        geomsQ.data ?? new Map(),
        (item) => {
          if (item.source === "onm")
            return cleanCopy(item.data.headline_fr || item.data.title);
          if (item.source === "seismic")
            return `M${item.data.magnitude.toFixed(1)}`;
          if (item.source === "official")
            return unitName(item.data.wilaya, locale);
          return item.category;
        },
        selected?.id,
        outlinesQ.data ?? new Map(),
      ),
    [visible, geomsQ.data, selected?.id, outlinesQ.data, locale],
  );

  const satelliteFires = useMemo(
    () =>
      visible.filter(
        (s): s is Extract<Situation, { source: "satellite" }> =>
          s.source === "satellite",
      ),
    [visible],
  );

  /** Group ONM alerts by Wilaya so users never scroll 50 repetitive rows. */
  const groupedOnm = useMemo<WilayaOnmGroup[]>(() => {
    const map = new Map<string, Extract<Situation, { source: "onm" }>[]>();
    for (const item of visible) {
      if (item.source !== "onm") continue;
      const key = item.data.wilaya_id ?? item.data.area_desc ?? "unknown";
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()]
      .map(([wilayaId, items]) => {
        const wilaya = unitsById.get(wilayaId) ?? null;
        const entry = wilaya ? wilayaByCode(wilaya.code) : undefined;
        let maxSev = "Minor";
        const eventSet = new Set<string>();
        for (const it of items) {
          if (
            (SEVERITY_RANK[it.data.severity] ?? 0) >
            (SEVERITY_RANK[maxSev] ?? 0)
          ) {
            maxSev = it.data.severity;
          }
          eventSet.add(
            classifyOnmEvent(it.data.event, it.data.title, it.data.headline_fr),
          );
        }
        return {
          wilayaId,
          wilaya,
          slug: entry?.slug ?? null,
          code: wilaya?.code ?? "--",
          maxSeverity: maxSev,
          items,
          events: [...eventSet],
        };
      })
      .sort(
        (a, b) =>
          (SEVERITY_RANK[b.maxSeverity] ?? 0) -
            (SEVERITY_RANK[a.maxSeverity] ?? 0) ||
          b.items.length - a.items.length ||
          a.code.localeCompare(b.code),
      );
  }, [visible, unitsById]);

  const nonOnmItems = useMemo(
    () => visible.filter((s) => s.source !== "onm"),
    [visible],
  );

  function setHazardFilter(hazard: HazardCategory) {
    void navigate({
      search: (prev) => ({ ...prev, hazard, event: undefined }),
      replace: true,
    });
  }

  function selectEvent(id: string | undefined) {
    void navigate({
      search: (prev) => ({ ...prev, event: id }),
      replace: true,
    });
    if (id) {
      const found = allSituations.find((s) => s.id === id);
      if (found && found.lat !== null && found.lon !== null) {
        setFocusTarget({
          lat: found.lat,
          lon: found.lon,
          zoom: found.source === "onm" ? 7.4 : 9.5,
          key: Date.now(),
        });
      }
    }
  }

  function handleLocate() {
    if (grantedPos) {
      setFocusTarget({
        lat: grantedPos.lat,
        lon: grantedPos.lon,
        zoom: 10,
        key: Date.now(),
      });
      return;
    }
    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setFocusTarget({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            zoom: 10,
            key: Date.now(),
          });
        },
        () => {},
      );
    }
  }

  function switchBasemap(mode: AtlasBasemap) {
    setManualSatellite(mode === "satellite");
    setBasemap(mode);
  }

  const eventLabel = (cat: string) =>
    t(`weather:outlook.event.${cat}`, {
      defaultValue: t(`track3.forecast.onmEvent.${cat}`, { defaultValue: cat }),
    });

  const activeHeadline =
    locale === "ar"
      ? `${formatNumber(visible.length, locale)} نشط · ${formatNumber(summary.warningWilayas, locale)} ولاية أرصاد`
      : locale === "fr"
        ? `${formatNumber(visible.length, locale)} actifs · ${formatNumber(summary.warningWilayas, locale)} wilayas ONM`
        : `${formatNumber(visible.length, locale)} active · ${formatNumber(summary.warningWilayas, locale)} ONM wilayas`;

  const layerFilters: Array<{
    key: HazardCategory;
    label: string;
    count: number;
    Icon: typeof Layers;
  }> = [
    {
      key: "all",
      label: locale === "ar" ? "الكل" : locale === "fr" ? "Tous" : "All",
      count: counts.all,
      Icon: Layers,
    },
    {
      key: "fire",
      label: locale === "ar" ? "حرائق" : locale === "fr" ? "Feux" : "Fires",
      count: counts.fire,
      Icon: Flame,
    },
    {
      key: "weather",
      label: locale === "ar" ? "أرصاد" : locale === "fr" ? "Météo" : "ONM",
      count: counts.weather,
      Icon: CloudSun,
    },
    {
      key: "flood",
      label: locale === "ar" ? "أمطار" : locale === "fr" ? "Pluie" : "Rain",
      count: counts.flood,
      Icon: CloudRain,
    },
    {
      key: "road",
      label: locale === "ar" ? "طرق" : locale === "fr" ? "Routes" : "Roads",
      count: counts.road,
      Icon: TrafficCone,
    },
    {
      key: "earthquake",
      label: locale === "ar" ? "زلازل" : locale === "fr" ? "Séismes" : "Quakes",
      count: counts.earthquake,
      Icon: Activity,
    },
  ];

  const situationListContent = (
    <div className="space-y-3">
      {/* Non-ONM Priority Events (Fires, Official, Roads, Quakes) */}
      {nonOnmItems.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1 text-xs font-medium text-ink-muted">
            <span>
              {locale === "ar"
                ? "أحداث ميدانية ورصد"
                : locale === "fr"
                  ? "Incidents & détections"
                  : "Live detections & incidents"}
            </span>
            <SafeBdi className="font-mono">{nonOnmItems.length}</SafeBdi>
          </div>
          {nonOnmItems.slice(0, 20).map((item) => {
            const tone = situationTone(item);
            const active = selected?.id === item.id;
            const title =
              item.source === "satellite"
                ? `${
                    item.areaId && unitsById.get(item.areaId)
                      ? unitName(unitsById.get(item.areaId)!, locale)
                      : item.lat !== null && item.lon !== null
                        ? coordLabel(item.lat, item.lon)
                        : "Fire"
                  }`
                : item.source === "seismic"
                  ? `M${item.data.magnitude.toFixed(1)} · ${cleanCopy(item.data.region) || "Algeria"}`
                  : item.source === "official"
                    ? unitName(item.data.commune ?? item.data.wilaya, locale)
                    : item.source === "civil"
                      ? cleanCopy(item.data.summary)
                      : item.source === "station"
                        ? `${item.data.station} · ${item.data.name ?? ""}`
                        : cleanCopy(
                            item.data.summary ||
                              item.data.hazard ||
                              item.category,
                          );
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectEvent(item.id)}
                className={cn(
                  "flex w-full items-stretch gap-3 rounded-xl border p-2.5 text-start transition-colors cursor-pointer",
                  active
                    ? "border-signal bg-signal-soft"
                    : "border-hairline bg-surface hover:bg-surface-raised",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("w-1 shrink-0 rounded-full", TONE_RULE[tone])}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink truncate">
                      {title}
                    </span>
                    <span className="text-[11px] text-ink-muted shrink-0">
                      {relativeTime(item.at, locale)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AtlasBadge tone={tone}>
                      {item.source === "satellite"
                        ? item.level === "confirmed"
                          ? locale === "ar"
                            ? "حريق مؤكد"
                            : locale === "fr"
                              ? "Feu confirmé"
                              : "Confirmed fire"
                          : locale === "ar"
                            ? "حريق محتمل"
                            : locale === "fr"
                              ? "Feu probable"
                              : "Probable fire"
                        : item.source === "seismic"
                          ? `${item.data.depth_km ?? 10} km`
                          : item.category}
                    </AtlasBadge>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Grouped ONM Wilaya Alert Cards */}
      {groupedOnm.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1 text-xs font-medium text-ink-muted">
            <span>
              {locale === "ar"
                ? "نشرات الأرصاد الجوية حسب الولاية"
                : locale === "fr"
                  ? "Vigilances ONM par wilaya"
                  : "ONM advisories by wilaya"}
            </span>
            <SafeBdi className="font-mono">{groupedOnm.length}</SafeBdi>
          </div>

          {groupedOnm.map((group) => {
            const tone = onmTone(group.maxSeverity);
            const isExpanded = expandedWilayas.has(group.wilayaId);
            const isSelected = group.items.some((i) => i.id === selected?.id);
            const name = group.wilaya
              ? unitName(group.wilaya, locale)
              : cleanCopy(group.items[0]?.data.area_desc || group.wilayaId);
            return (
              <div
                key={group.wilayaId}
                className={cn(
                  "overflow-hidden rounded-xl border transition-colors",
                  isSelected
                    ? "border-signal bg-signal-soft/60"
                    : "border-hairline bg-surface",
                )}
              >
                <div className="flex items-stretch">
                  <span
                    aria-hidden="true"
                    className={cn("w-1 shrink-0", TONE_RULE[tone])}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const lead = group.items[0];
                      if (lead) selectEvent(lead.id);
                      setExpandedWilayas((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.wilayaId))
                          next.delete(group.wilayaId);
                        else next.add(group.wilayaId);
                        return next;
                      });
                    }}
                    className="flex flex-1 items-center justify-between gap-2 px-3 py-2.5 text-start hover:bg-surface-raised/60 transition-colors cursor-pointer min-w-0"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <SafeBdi className="font-mono text-[11px] text-ink-muted">
                          {group.code}
                        </SafeBdi>
                        <span className="text-sm font-semibold text-ink truncate">
                          {name}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {group.events.slice(0, 3).map((ev) => (
                          <AtlasBadge key={ev} tone={tone}>
                            {eventLabel(ev)}
                          </AtlasBadge>
                        ))}
                        <span className="text-[11px] text-ink-muted tabular-nums">
                          <SafeBdi className="font-mono">
                            {group.items.length}
                          </SafeBdi>{" "}
                          {locale === "ar"
                            ? "نشرات"
                            : locale === "fr"
                              ? group.items.length > 1
                                ? "bulletins"
                                : "bulletin"
                              : group.items.length > 1
                                ? "alerts"
                                : "alert"}
                        </span>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-ink-muted shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-ink-muted shrink-0" />
                    )}
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-hairline bg-surface-raised/40 px-3 py-2.5 space-y-2">
                    {group.items.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => selectEvent(w.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start text-xs hover:bg-surface cursor-pointer"
                      >
                        <span className="text-ink truncate">
                          {cleanCopy(
                            locale === "ar"
                              ? w.data.title || w.data.headline_fr
                              : w.data.headline_fr || w.data.title,
                          )}
                        </span>
                        <SafeBdi className="font-mono text-[10px] text-ink-muted shrink-0">
                          {w.data.expires ? algiersTime(w.data.expires) : ""}
                        </SafeBdi>
                      </button>
                    ))}
                    {group.slug && (
                      <Link
                        to="/wilaya/$slug"
                        params={{ slug: group.slug }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-signal hover:underline pt-0.5"
                      >
                        {locale === "ar"
                          ? "ملف الولاية الكامل"
                          : locale === "fr"
                            ? "Dossier complet de la wilaya"
                            : "Open wilaya dossier"}
                        <ChevronRight className="h-3.5 w-3.5 atlas-dir-icon" />
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {visible.length === 0 && (
        <div className="rounded-xl border border-hairline bg-surface p-5 text-center space-y-1">
          <p className="text-sm font-medium text-ink">
            {locale === "ar"
              ? "لا توجد أحداث نشطة في هذا الفلتر"
              : locale === "fr"
                ? "Aucun événement actif pour ce filtre"
                : "No active events in this filter"}
          </p>
          <p className="text-xs text-ink-secondary">
            {locale === "ar"
              ? "جرب تبديل طبقة المخاطر أو عرض جميع الولايات"
              : locale === "fr"
                ? "Essayez une autre catégorie ou affichez toutes les wilayas"
                : "Switch hazard filter or inspect forecast advisories"}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      {/* 100% Edge-to-Edge Interactive MapLibre GL Canvas */}
      <AtlasHazardMap
        basemap={basemap}
        warningsGeo={geoData.warnings}
        officialGeo={geoData.official}
        reportsGeo={geoData.reports}
        fires={satelliteFires}
        stations={stationsQ.data ?? []}
        showStations={showStations}
        selectedId={selected?.id}
        focusTarget={focusTarget}
        onSelectSituation={selectEvent}
        onLocate={handleLocate}
      />

      {/* Top-Start Floating Briefing Capsule */}
      <div className="pointer-events-none absolute top-3 sm:top-4 start-3 sm:start-4 end-14 md:end-auto z-20 flex flex-col gap-2.5 md:w-[368px]">
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-hairline-strong bg-surface-hud backdrop-blur-md p-2 shadow-xl">
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Toggle situation drawer"
            className="hidden md:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-ink hover:text-signal transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex flex-1 items-center gap-2.5 rounded-xl bg-surface-raised/80 px-3 h-9 text-start hover:bg-surface-raised transition-colors min-w-0 cursor-pointer"
          >
            <Search className="h-4 w-4 text-ink-secondary shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="hidden md:flex items-center gap-1.5 text-xs font-semibold text-ink truncate">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    visible.length > 0 ? "bg-hazard-high" : "bg-hazard-clear",
                  )}
                />
                <span className="truncate">{activeHeadline}</span>
              </div>
              <div className="md:hidden text-xs font-medium text-ink-secondary truncate">
                {locale === "ar"
                  ? "ابحث عن ولاية أو بلدية..."
                  : locale === "fr"
                    ? "Rechercher wilaya, commune..."
                    : "Search wilaya, commune..."}
              </div>
            </div>
            <SafeBdi className="hidden sm:inline-flex rounded border border-hairline bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              ⌘K
            </SafeBdi>
          </button>
        </div>

        {/* Desktop Collapsible Tactical Situation Panel (368px wide) */}
        {drawerOpen && (
          <div className="pointer-events-auto hidden md:flex max-h-[calc(100dvh-164px)] flex-col overflow-hidden rounded-2xl border border-hairline-strong bg-surface-hud backdrop-blur-md shadow-2xl">
            <div className="flex items-center justify-between border-b border-hairline px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink">
                  {locale === "ar"
                    ? "الوضع الوطني المباشر"
                    : locale === "fr"
                      ? "Situation nationale"
                      : "National situation"}
                </span>
                {selectedArea && (
                  <button
                    type="button"
                    onClick={() =>
                      void navigate({
                        search: (prev) => ({ ...prev, area: undefined }),
                        replace: true,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md bg-signal-soft px-2 py-0.5 text-[11px] font-medium text-signal cursor-pointer"
                  >
                    {unitName(selectedArea, locale)}
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label={t("common.close")}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-raised hover:text-ink cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="relative flex-1 overflow-y-auto p-3 pb-6 [mask-image:linear-gradient(to_bottom,black_92%,transparent_100%)]">
              {situationListContent}
            </div>
          </div>
        )}
      </div>

      {/* Selected Event Inspector Drawer (End-Edge on Desktop, Sheet on Mobile) */}
      {selected && (
        <div className="pointer-events-auto absolute bottom-24 md:bottom-20 end-3 sm:end-4 start-3 md:start-auto md:w-[360px] z-30 overflow-hidden rounded-2xl border border-hairline-strong bg-surface shadow-2xl">
          <div className="flex items-stretch">
            <span
              aria-hidden="true"
              className={cn(
                "w-1.5 shrink-0",
                TONE_RULE[situationTone(selected)],
              )}
            />
            <div className="flex-1 p-4 space-y-3 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <AtlasBadge tone={situationTone(selected)} dot>
                    {selected.source === "onm"
                      ? `ONM · ${selected.data.severity}`
                      : selected.source === "satellite"
                        ? `Satellite · ${selected.level}`
                        : selected.source === "seismic"
                          ? `M${selected.data.magnitude.toFixed(1)} Seismic`
                          : selected.category}
                  </AtlasBadge>
                  <h2 className="font-display text-lg font-semibold text-ink leading-snug">
                    {selected.source === "onm"
                      ? cleanCopy(
                          locale === "ar"
                            ? selected.data.title || selected.data.headline_fr
                            : selected.data.headline_fr || selected.data.title,
                        )
                      : selected.source === "official"
                        ? unitName(
                            selected.data.commune ?? selected.data.wilaya,
                            locale,
                          )
                        : selected.source === "seismic"
                          ? cleanCopy(selected.data.region) || "Algeria"
                          : selected.source === "satellite"
                            ? selected.areaId && unitsById.get(selected.areaId)
                              ? unitName(
                                  unitsById.get(selected.areaId)!,
                                  locale,
                                )
                              : selected.data.short_id
                            : selected.source === "civil"
                              ? cleanCopy(selected.data.summary)
                              : selected.source === "station"
                                ? `${selected.data.station} ${selected.data.name ?? ""}`
                                : cleanCopy(
                                    selected.data.summary || selected.category,
                                  )}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => selectEvent(undefined)}
                  aria-label={t("common.close")}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-raised cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-secondary">
                <span>{relativeTime(selected.at, locale)}</span>
                {selected.lat !== null && selected.lon !== null && (
                  <SafeBdi className="font-mono text-[11px] text-ink-muted">
                    {coordLabel(selected.lat, selected.lon)}
                  </SafeBdi>
                )}
                {selected.source === "onm" && selected.data.expires && (
                  <SafeBdi className="font-mono text-[11px]">
                    → {algiersTime(selected.data.expires)}
                  </SafeBdi>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {selected.source === "satellite" && (
                  <Link to="/fire/$id" params={{ id: selected.data.short_id }}>
                    <AtlasButton variant="primary" size="sm">
                      {locale === "ar"
                        ? "تفاصيل الحريق"
                        : locale === "fr"
                          ? "Détails du feu"
                          : "Fire dossier"}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </AtlasButton>
                  </Link>
                )}
                {selected.source === "official" && (
                  <Link to="/incident/$id" params={{ id: selected.data.id }}>
                    <AtlasButton variant="primary" size="sm">
                      {locale === "ar"
                        ? "النشرة الرسمية"
                        : locale === "fr"
                          ? "Dossier officiel"
                          : "Official dossier"}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </AtlasButton>
                  </Link>
                )}
                {selected.wilayaId &&
                  unitsById.get(selected.wilayaId) &&
                  wilayaByCode(unitsById.get(selected.wilayaId)!.code) && (
                    <Link
                      to="/wilaya/$slug"
                      params={{
                        slug: wilayaByCode(
                          unitsById.get(selected.wilayaId)!.code,
                        )!.slug,
                      }}
                    >
                      <AtlasButton variant="secondary" size="sm">
                        <MapPin className="h-3.5 w-3.5" />
                        {unitName(unitsById.get(selected.wilayaId)!, locale)}
                      </AtlasButton>
                    </Link>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Compact Peek Sheet (>72% unobstructed map when collapsed) */}
      <div className="md:hidden pointer-events-auto fixed bottom-[76px] inset-x-3 z-20 mx-auto max-w-md overflow-hidden rounded-2xl border border-hairline-strong bg-surface-hud backdrop-blur-md shadow-xl">
        <button
          type="button"
          onClick={() => setMobileSheetExpanded((v) => !v)}
          className="flex w-full items-center justify-between px-3.5 py-2.5 text-start cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                "h-2 w-2 rounded-full shrink-0",
                visible.length > 0 ? "bg-hazard-high" : "bg-hazard-clear",
              )}
            />
            <span className="text-xs font-semibold text-ink truncate">
              {activeHeadline}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center rounded-xl border border-hairline bg-surface-raised p-0.5 text-xs font-mono">
              {(["terrain", "satellite", "night"] as AtlasBasemap[]).map(
                (mode) => (
                  <span
                    key={mode}
                    onClick={(e) => {
                      e.stopPropagation();
                      switchBasemap(mode);
                    }}
                    className={cn(
                      "inline-flex h-8 min-w-[32px] items-center justify-center rounded-lg px-2",
                      basemap === mode
                        ? "bg-signal text-signal-ink font-semibold"
                        : "text-ink-secondary",
                    )}
                  >
                    {mode === "terrain"
                      ? "T"
                      : mode === "satellite"
                        ? "S"
                        : "N"}
                  </span>
                ),
              )}
            </div>
            {mobileSheetExpanded ? (
              <ChevronDown className="h-4 w-4 text-ink-secondary" />
            ) : (
              <ChevronUp className="h-4 w-4 text-ink-secondary" />
            )}
          </div>
        </button>

        {mobileSheetExpanded && (
          <div className="max-h-[46dvh] overflow-y-auto border-t border-hairline p-3 space-y-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {layerFilters.map((f) => {
                const active = search.hazard === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setHazardFilter(f.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium whitespace-nowrap cursor-pointer",
                      active
                        ? "border-signal bg-signal text-signal-ink"
                        : "border-hairline bg-surface text-ink-secondary",
                    )}
                  >
                    <span>{f.label}</span>
                    <SafeBdi className="font-mono text-[10px] opacity-80">
                      {f.count}
                    </SafeBdi>
                  </button>
                );
              })}
            </div>
            {situationListContent}
          </div>
        )}
      </div>

      {/* Desktop Bottom-Center Floating Tactical Layer & Basemap Dock */}
      <div className="hidden md:flex pointer-events-none fixed bottom-9 start-[68px] end-0 z-20 justify-center px-6">
        <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-hairline-strong bg-surface-hud backdrop-blur-md px-2 py-1.5 shadow-2xl max-w-[calc(100vw-280px)] overflow-x-auto">
          {/* Layer Filter Pills */}
          <div className="flex items-center gap-1">
            {layerFilters.map((item) => {
              const Icon = item.Icon;
              const active = search.hazard === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setHazardFilter(item.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                    active
                      ? "bg-signal text-signal-ink"
                      : "text-ink-secondary hover:bg-surface-raised hover:text-ink",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{item.label}</span>
                  <SafeBdi
                    className={cn(
                      "font-mono text-[11px] tabular-nums",
                      active ? "text-signal-ink/90" : "text-ink-muted",
                    )}
                  >
                    {item.count}
                  </SafeBdi>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setShowStations((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                showStations
                  ? "bg-signal-soft text-signal border border-signal/30"
                  : "text-ink-secondary hover:bg-surface-raised hover:text-ink",
              )}
            >
              <Plane className="h-3.5 w-3.5 shrink-0" />
              <span>METAR</span>
            </button>
          </div>

          <div className="mx-1 h-5 w-px bg-hairline-strong shrink-0" />

          {/* 3-Mode Basemap Switcher */}
          <div
            role="group"
            aria-label="Basemap mode"
            className="flex items-center rounded-xl bg-surface-raised p-0.5 shrink-0"
          >
            {(
              [
                {
                  id: "terrain",
                  label:
                    locale === "ar"
                      ? "تضاريس"
                      : locale === "fr"
                        ? "Relief"
                        : "Terrain",
                },
                {
                  id: "satellite",
                  label:
                    locale === "ar"
                      ? "قمر صناعي"
                      : locale === "fr"
                        ? "Satellite"
                        : "Satellite",
                },
                {
                  id: "night",
                  label:
                    locale === "ar"
                      ? "ليلي"
                      : locale === "fr"
                        ? "Nuit"
                        : "Night",
                },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => switchBasemap(mode.id)}
                aria-pressed={basemap === mode.id}
                className={cn(
                  "rounded-[9px] px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                  basemap === mode.id
                    ? "bg-surface text-ink shadow-xs"
                    : "text-ink-secondary hover:text-ink",
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="mx-1 h-5 w-px bg-hairline-strong shrink-0" />

          {/* Live Algiers Clock */}
          <div className="px-1.5 shrink-0">
            <AlgiersClock />
          </div>
        </div>
      </div>

      <PlaceSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
