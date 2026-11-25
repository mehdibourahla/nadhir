import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Bookmark,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  CloudSun,
  Info,
  Crosshair,
  Layers,
  LoaderCircle,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  TriangleAlert,
  X,
  Megaphone,
} from "lucide-react";
import { MapCanvas } from "@/components/MapCanvas";
import { useGrantedPosition } from "@/lib/granted-position";
import { MapWorkspacePanel } from "@/components/nadhir/MapWorkspacePanel";
import type { SheetDetent } from "@/lib/sheet-detent";
import {
  SituationCard,
  SituationDetails,
  hazardIcons,
  useSituationLabels,
} from "@/components/nadhir/CivilSituation";
import {
  LayersPanel,
  PlaceSearchResults,
  SituationDetailView,
  SituationList,
  SourcesPanel,
} from "@/components/nadhir/MapPanelViews";
import { MapSurvivalPrompt } from "@/components/nadhir/MapSurvivalPrompt";
import { WeatherForecast } from "@/components/nadhir/WeatherForecast";
import { SubscribeSheet } from "@/components/nadhir/SubscribeSheet";
import { BroadcastBanner } from "@/components/nadhir/BroadcastBanner";
import { SourceHealth } from "@/components/nadhir/SourceHealth";
import { EmergencyNumbers } from "@/components/SiteChrome";
import {
  adminUnitsQuery,
  clustersQuery,
  communeGeomsQuery,
  officialIncidentsQuery,
  onmOutlinesQuery,
  onmVigilanceQuery,
  todayRiskForecastsQuery,
  sourceHealthQuery,
  unitName,
  relativeTime,
  type AdminUnit,
} from "@/lib/nadhir";
import { hazardReportsQuery } from "@/lib/open-areas";
import {
  civilPublicationsQuery,
  civilPublicationQuery,
} from "@/lib/civil-publication-client";
import { civilMapGeoJSON, situationAreaId } from "@/lib/civil-map-geometry";
import {
  buildSituations,
  countSituationsByHazard,
  filterSituations,
  roadHints,
  findPlaces,
  nearestPlace,
  selectedSituation,
  CITIZEN_NEARBY_RADIUS_KM,
  situationSummary,
} from "@/lib/civil-map";
import { earthquakesQuery } from "@/lib/earthquakes";
import { airportWeatherQuery } from "@/lib/airport-weather";
import {
  HAZARD_CATEGORIES,
  parseMapSearch,
  type MapSearch,
} from "@/lib/civil-map-search";
import { readSubscription } from "@/lib/push";
import { pageMeta } from "@/lib/page-meta";
import type { Locale } from "@/i18n";
import { NATIVE, publicUrl } from "@/lib/platform";

export const Route = createFileRoute("/")({
  head: () => ({ meta: pageMeta("map.metaTitle", "map.metaDescription") }),
  validateSearch: (search: SearchSchemaInput & Partial<MapSearch>) =>
    parseMapSearch(search),
  component: LiveMapPage,
});

const REFRESH = {
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
  refetchOnReconnect: true,
  retry: 1,
} as const;
const SAVED_KEY = "nadhir.map.saved-places";

function LiveMapPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const update = (next: Partial<MapSearch>, replace = false) =>
    void navigate({
      search: (prev) => ({ ...prev, ...next }),
      replace,
      resetScroll: false,
    });
  const units = useQuery(adminUnitsQuery);
  const fires = useQuery({ ...clustersQuery, ...REFRESH });
  const official = useQuery({ ...officialIncidentsQuery, ...REFRESH });
  const earthquakes = useQuery({ ...earthquakesQuery, ...REFRESH });
  const stations = useQuery({ ...airportWeatherQuery, ...REFRESH });
  const reports = useQuery({ ...hazardReportsQuery, ...REFRESH });
  const warnings = useQuery({ ...onmVigilanceQuery, ...REFRESH });
  const danger = useQuery({ ...todayRiskForecastsQuery, ...REFRESH });
  const publications = useQuery({
    ...civilPublicationsQuery(search.ended),
    ...REFRESH,
  });
  const selectedCivilId = /^civil:[0-9a-f-]{36}$/i.test(search.event ?? "")
    ? search.event!.slice(6)
    : "";
  const selectedPublication = useQuery({
    ...civilPublicationQuery(selectedCivilId),
    ...REFRESH,
    enabled: !!selectedCivilId,
  });
  const health = useQuery({ ...sourceHealthQuery, ...REFRESH });
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [detent, setDetent] = useState<SheetDetent>("peek");
  const [panel, setPanel] = useState<
    "list" | "layers" | "sources" | "forecast" | "help"
  >("list");
  const [panelHidden, setPanelHidden] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [mapHeight, setMapHeight] = useState(600);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const [offline, setOffline] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [subscribed, setSubscribed] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const listOffset = useRef(0);
  const lastSelection = useRef<string | undefined>(undefined);
  const panelView = search.event ? "detail" : panel;
  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setMapHeight(element.clientHeight),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = window.matchMedia(
      "(min-width: 1024px), (min-width: 640px) and (max-height: 500px)",
    );
    const sync = () => {
      setDesktop(media.matches);
      if (!media.matches) setPanelHidden(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (search.event) {
      setDetent((current) => (current === "peek" ? "half" : current));
      setPanelHidden(false);
    }
  }, [search.event]);
  useEffect(() => {
    if (searchOpen && panelView === "list" && detent !== "peek")
      searchRef.current?.focus();
  }, [searchOpen, panelView, detent]);
  useEffect(() => {
    if (contentRef.current)
      contentRef.current.scrollTop =
        panelView === "list" ? listOffset.current : 0;
    if (panelView !== "list") backRef.current?.focus({ preventScroll: true });
    else if (lastSelection.current) {
      document
        .querySelector<HTMLButtonElement>(
          `[data-situation-id="${CSS.escape(lastSelection.current)}"]`,
        )
        ?.focus({ preventScroll: true });
      lastSelection.current = undefined;
    }
  }, [panelView]);
  const openPanel = (next: typeof panel) => {
    if (panelView === "list")
      listOffset.current = contentRef.current?.scrollTop ?? 0;
    update({ event: undefined }, true);
    setPanel(next);
    setPanelHidden(false);
    setDetent("full");
    setSearchOpen(false);
  };
  const backToList = () => {
    lastSelection.current = search.event;
    update({ event: undefined }, true);
    setPanel("list");
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"][data-state="open"]')
      )
        return;
      if (searchOpen) setSearchOpen(false);
      else if (panelView !== "list") backToList();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const connection = () => setOffline(!navigator.onLine);
    connection();
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(SAVED_KEY) ?? "[]",
      );
      if (Array.isArray(value))
        setSaved(
          value.filter((s): s is string => typeof s === "string").slice(0, 12),
        );
    } catch {
      setMessage("civilMap.savedUnavailable");
    }
    setSubscribed(readSubscription()?.communes ?? []);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, []);
  const allUnits = useMemo(() => units.data ?? [], [units.data]);
  const area = allUnits.find((u) => u.id === search.area) ?? null;
  const places = useMemo(
    () => findPlaces(allUnits, query, locale),
    [allUnits, query, locale],
  );
  const items = useMemo(
    () =>
      buildSituations({
        fires: fires.data ?? [],
        official: official.data ?? [],
        reports: reports.data ?? [],
        warnings: warnings.data ?? [],
        earthquakes: earthquakes.data ?? [],
        stations: stations.data ?? [],
        publications: selectedPublication.data
          ? [
              ...(publications.data ?? []).filter(
                (p) => p.id !== selectedPublication.data?.id,
              ),
              selectedPublication.data,
            ]
          : (publications.data ?? []),
        danger: new Map(
          (danger.data ?? []).map((f) => [f.commune_id, f.danger_level]),
        ),
        units: allUnits,
        now,
      }),
    [
      danger.data,
      fires.data,
      official.data,
      reports.data,
      warnings.data,
      publications.data,
      selectedPublication.data,
      earthquakes.data,
      stations.data,
      allUnits,
      now,
    ],
  );
  const survivalFires = useMemo(
    () =>
      items.flatMap((item) => (item.source === "satellite" ? [item.data] : [])),
    [items],
  );
  const hazardCounts = useMemo(
    () =>
      countSituationsByHazard(
        filterSituations(
          items,
          {
            category: "all",
            area,
            showEnded: search.ended,
            showCandidates: search.candidates,
          },
          allUnits,
        ),
      ),
    [items, area, search.ended, search.candidates, allUnits],
  );
  const visible = useMemo(
    () =>
      filterSituations(
        items,
        {
          category: search.hazard,
          area,
          showEnded: search.ended,
          showCandidates: search.candidates,
        },
        allUnits,
      ),
    [items, search.hazard, area, search.ended, search.candidates, allUnits],
  );
  const selected = selectedSituation(items, visible, search.event);
  const officialItems = visible.filter(
    (item) =>
      item.source === "onm" ||
      (item.source === "official" && item.data.authority_tier !== "media"),
  );
  const observedItems = visible.filter((item) => !officialItems.includes(item));
  const labels = useSituationLabels(allUnits, now);
  const mapFires = visible.flatMap((i) =>
    i.source === "satellite" && i.lat !== null && i.lon !== null
      ? [i.data]
      : [],
  );
  const selectedAreaId = selected ? situationAreaId(selected) : null;
  const boundaries = useQuery(
    communeGeomsQuery(selectedAreaId ? [selectedAreaId] : []),
  );
  const fireLevels = useMemo(
    () =>
      new Map(
        items.flatMap((item) =>
          item.source === "satellite"
            ? [[item.data.id, item.level] as const]
            : [],
        ),
      ),
    [items],
  );
  const outlines = useQuery(
    onmOutlinesQuery(
      items.flatMap((item) =>
        item.source === "onm" && item.data.wilaya_id
          ? [item.data.wilaya_id]
          : [],
      ),
    ),
  );
  const userPosition = useGrantedPosition();
  const summary = situationSummary(visible);
  const summaryLine =
    (
      [
        "confirmedFires",
        "probableFires",
        "heatSignals",
        "warningWilayas",
        "roads",
        "reports",
      ] as const
    )
      .filter((key) => summary[key] > 0)
      .map((key) => t(`civilMap.summary.${key}`, { count: summary[key] }))
      .join(" · ") || t("civilMap.summaryNone");
  const {
    official: mapOfficial,
    warnings: mapWarnings,
    reports: mapReports,
  } = civilMapGeoJSON(
    visible,
    boundaries.data ?? new Map(),
    labels.title,
    selected?.id,
    outlines.data,
  );
  const queries = [fires, official, reports, warnings, publications];
  const loading = queries.some((q) => q.isPending);
  const refreshing = queries.some((q) => q.isFetching) || health.isFetching;
  const relevantKeys = new Set([
    "firms",
    "fci",
    "fusion",
    "dgpc_telegram",
    "onm",
    "ita_website",
  ]);
  const limited =
    offline ||
    queries.some((q) => q.isError) ||
    health.isError ||
    health.isPending ||
    (health.data ?? []).some(
      (s) => relevantKeys.has(s.key) && s.state !== "healthy",
    );
  const checkedAt = Math.min(
    ...queries.map((q) => q.dataUpdatedAt).filter(Boolean),
  );
  const [focus, setFocus] = useState({ lat: 35.8, lon: 2.6, zoom: 5.1 });
  const cameraArea = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const areaChanged = cameraArea.current !== (area?.id ?? null);
    cameraArea.current = area?.id ?? null;
    if (selected && selected.lat !== null && selected.lon !== null)
      setFocus({
        lat: selected.lat,
        lon: selected.lon,
        zoom:
          selected.source === "onm" ||
          (selected.source === "civil" &&
            selected.data.area?.level === "wilaya") ||
          (selected.source === "official" &&
            (selected.data.precision === "wilaya" || !selected.data.commune_id))
            ? 7
            : 10,
      });
    else if (areaChanged)
      setFocus(
        area
          ? {
              lat: area.lat,
              lon: area.lon,
              zoom: area.level === "wilaya" ? 7 : 10,
            }
          : { lat: 35.8, lon: 2.6, zoom: 5.1 },
      );
  }, [area, selected]);
  const following = !!area && subscribed.includes(area.code);
  const chooseArea = (unit: AdminUnit | null) => {
    setMessage("");
    update({ area: unit?.id, event: undefined });
    setQuery("");
    setSearchOpen(false);
    setPanel("list");
  };
  const locate = () => {
    setMessage("");
    if (!navigator.geolocation) {
      setMessage("civilMap.locationDenied");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const unit = nearestPlace(
          allUnits,
          position.coords.latitude,
          position.coords.longitude,
        );
        if (unit) {
          chooseArea(unit);
          setMessage("civilMap.nearby");
        } else setMessage("civilMap.outsideCoverage");
      },
      () => {
        setLocating(false);
        setMessage("civilMap.locationDenied");
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  };
  const savePlace = () => {
    if (!area) return;
    const next = saved.includes(area.id)
      ? saved.filter((id) => id !== area.id)
      : [area.id, ...saved].slice(0, 12);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      setSaved(next);
    } catch {
      setMessage("civilMap.savedUnavailable");
    }
  };
  const select = (id: string) => {
    if (panelView === "list")
      listOffset.current = contentRef.current?.scrollTop ?? 0;
    update({ event: id });
    setPanel("list");
    setPanelHidden(false);
    setDetent((current) => (current === "peek" ? "half" : current));
    setSearchOpen(false);
  };
  const refresh = () => {
    for (const q of [...queries, health]) void q.refetch();
    if (selectedCivilId) void selectedPublication.refetch();
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(
        NATIVE
          ? publicUrl(window.location.pathname + window.location.search)
          : window.location.href,
      );
      setMessage("civilMap.copied");
    } catch {
      setMessage("civilMap.shareFailed");
    }
  };

  const requestPlace = (feedback: string) => {
    openPanel("list");
    setMessage(feedback);
    setSearchOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };
  const follow = () => {
    if (area?.level === "commune") setSubscriptionOpen(true);
    else requestPlace("civilMap.communeOnly");
  };
  const panelTitle =
    panelView === "detail"
      ? selected
        ? labels.title(selected)
        : t(
            loading || (!!selectedCivilId && selectedPublication.isPending)
              ? "civilMap.loading"
              : "civilMap.detailUnavailable",
          )
      : t(
          (
            {
              list: "civilMap.title",
              layers: "civilMap.filters",
              sources: "civilMap.coverage",
              forecast: "civilMap.forecast",
              help: "civilMap.help",
            } as const
          )[panel],
        );
  const buttonStyle =
    "flex size-11 items-center justify-center rounded-2xl border border-border bg-surface/95 text-foreground shadow-sm backdrop-blur hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary";
  const isRtl = i18n.dir() === "rtl";
  const padding = desktop
    ? {
        top: 24,
        bottom: 24,
        left: !panelHidden && !isRtl ? 416 : 24,
        right: !panelHidden && isRtl ? 416 : 80,
      }
    : {
        top: detent === "peek" ? 64 : 12,
        bottom:
          detent === "full"
            ? Math.round(mapHeight * 0.86) + 20
            : detent === "half"
              ? Math.round(mapHeight * 0.52) + 20
              : 188,
        left: isRtl ? 64 : 24,
        right: isRtl ? 24 : 64,
      };

  return (
    <div
      ref={workspaceRef}
      className="civil-map-page relative h-full min-h-0 w-full overflow-hidden bg-muted"
    >
      <section aria-label={t("civilMap.mapTitle")} className="absolute inset-0">
        <MapCanvas
          clusters={mapFires}
          fireLevels={fireLevels}
          userPosition={userPosition}
          roadHints={roadHints(visible, allUnits)}
          official={mapOfficial}
          warnings={mapWarnings}
          reports={mapReports}
          focus={focus}
          padding={padding}
          layers={{
            fires: true,
            official: true,
            reports: true,
            unverified: search.candidates,
            lightning: search.lightning,
          }}
          selectedShortId={
            selected?.source === "satellite" ? selected.data.short_id : null
          }
          selectedOfficialId={
            selected?.source === "official" ? selected.data.id : null
          }
          selectedWarningId={
            selected?.source === "onm" ? selected.data.id : null
          }
          selectedReportId={
            selected?.source === "civil" ||
            selected?.source === "seismic" ||
            selected?.source === "station"
              ? selected.id
              : selected?.source === "citizen"
                ? selected.data.id
                : null
          }
          onSelect={(c) => select(`fire:${c.id}`)}
          onSelectOfficial={(id) => select(`official:${id}`)}
          onSelectReport={(id) =>
            select(
              id.startsWith("civil:") ||
                id.startsWith("quake:") ||
                id.startsWith("station:")
                ? id
                : `report:${id}`,
            )
          }
          onSelectWarning={(id) => select(`weather:${id}`)}
          onError={() => setMapFailed(true)}
          onReady={() => setMapFailed(false)}
        />
      </section>

      <div
        className="civil-map-controls absolute end-3 top-3 z-10 flex flex-col gap-2 lg:end-4 lg:top-4"
        aria-label={t("civilMap.filters")}
      >
        <button
          type="button"
          className={buttonStyle}
          onClick={locate}
          disabled={locating || !allUnits.length}
          aria-label={t("civilMap.locate")}
          title={t("civilMap.locate")}
        >
          {locating ? (
            <LoaderCircle className="size-5 animate-spin" />
          ) : (
            <Crosshair className="size-5" />
          )}
        </button>
        <button
          type="button"
          className={buttonStyle}
          onClick={() => openPanel("layers")}
          aria-label={t("civilMap.filters")}
          title={t("civilMap.filters")}
        >
          <Layers className="size-5" />
        </button>
        <button
          type="button"
          className={buttonStyle}
          onClick={() => openPanel("forecast")}
          aria-label={t("civilMap.forecast")}
          title={t("civilMap.forecast")}
        >
          <CloudSun className="size-5" />
        </button>
        <button
          type="button"
          className={buttonStyle}
          onClick={() => openPanel("help")}
          aria-label={t("civilMap.help")}
          title={t("civilMap.help")}
        >
          <Info className="size-5" />
        </button>
      </div>

      {!desktop && (
        <button
          type="button"
          onClick={() => requestPlace("")}
          className={`absolute start-3 top-3 z-10 ${buttonStyle} lg:hidden`}
          aria-label={t("civilMap.search")}
        >
          <Search className="size-5" />
        </button>
      )}
      {panelHidden && (
        <button
          type="button"
          className={`absolute start-4 top-4 z-10 ${buttonStyle}`}
          onClick={() => setPanelHidden(false)}
          aria-label={t("civilMap.expand")}
        >
          <PanelLeftOpen className="size-5 rtl:rotate-180" />
        </button>
      )}

      {!panelHidden && (
        <MapWorkspacePanel
          detent={detent}
          onDetentChange={setDetent}
          header={
            <div
              className={`flex shrink-0 items-center gap-1.5 px-3 py-2 lg:gap-2 lg:px-4 lg:pb-3 ${desktop ? "pt-4" : ""}`}
            >
              {panelView !== "list" && (
                <button
                  ref={backRef}
                  type="button"
                  onClick={backToList}
                  aria-label={t("common.back")}
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-muted"
                >
                  <ArrowLeft className="size-5 rtl:rotate-180" />
                </button>
              )}
              <div
                className={`min-w-0 flex-1 ${!desktop && panelView === "list" ? "flex flex-wrap items-baseline gap-x-2" : ""}`}
              >
                <h1
                  className="max-w-full truncate font-sans text-sm font-semibold lg:text-base"
                  dir="auto"
                >
                  {panelView === "list"
                    ? area
                      ? unitName(area, locale)
                      : t("civilMap.national")
                    : panelTitle}
                </h1>
                <p
                  className={`line-clamp-2 text-xs text-muted-foreground ${desktop ? "mt-0.5" : ""}`}
                >
                  {panelView !== "list"
                    ? t("civilMap.title")
                    : loading || units.isPending || danger.isPending
                      ? t("common.loading")
                      : summaryLine}
                </p>
              </div>
              {panelView === "list" && (
                <Link
                  to="/survival"
                  aria-label={t("track3.emergency.headerChipLabel")}
                  title={t("track3.emergency.openSheet")}
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl border text-xs font-bold"
                  style={{
                    backgroundColor: "var(--emergency-surface)",
                    borderColor: "var(--emergency)",
                    color: "var(--emergency-ink)",
                  }}
                >
                  <span dir="ltr" className="tabular-nums">
                    {t("track3.emergency.headerChip")}
                  </span>
                </Link>
              )}
              {panelView === "list" && (
                <Link
                  to="/report"
                  aria-label={t("reports.reportButton")}
                  className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border px-2.5 text-xs font-medium hover:bg-muted sm:px-3 sm:text-sm"
                >
                  <Megaphone aria-hidden className="size-4 shrink-0" />
                  <span className="max-[359px]:hidden">
                    {t("reports.reportButton")}
                  </span>
                </Link>
              )}
              {panelView === "list" && (
                <button
                  type="button"
                  onClick={follow}
                  aria-label={t(
                    following ? "civilMap.following" : "civilMap.follow",
                  )}
                  title={t(
                    following ? "civilMap.following" : "civilMap.follow",
                  )}
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
                >
                  <Bell className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setPanelHidden(true)}
                aria-label={t("civilMap.collapse")}
                className={`${desktop ? "flex" : "hidden"} size-11 shrink-0 items-center justify-center rounded-xl hover:bg-muted`}
              >
                <PanelLeftClose className="size-5 rtl:rotate-180" />
              </button>
            </div>
          }
          filterBar={
            panelView === "list" && !searchOpen ? (
              <div
                role="group"
                aria-label={t("track3.filters.ariaLabel")}
                className="map-scroll flex min-w-0 max-w-full shrink-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-border/60 px-3 pb-2 lg:px-4"
              >
                {HAZARD_CATEGORIES.map((category) => {
                  const Icon = hazardIcons[category];
                  const active = search.hazard === category;
                  return (
                    <button
                      key={category}
                      type="button"
                      data-hazard-filter={category}
                      aria-pressed={active}
                      onClick={() =>
                        update({ hazard: category, event: undefined })
                      }
                      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                        active
                          ? "border-[var(--accent)] bg-[var(--accent-tint)] font-semibold text-[var(--accent)]"
                          : "border-border bg-surface font-medium text-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      <span>{t(`track3.filters.${category}`)}</span>
                      <span
                        className={`tabular-nums rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                          active
                            ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {t("track3.filters.count", {
                          count: hazardCounts[category],
                        })}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null
          }
        >
          <div className="flex min-h-0 flex-1 flex-col">
            {panelView === "list" && (
              <div className="shrink-0 border-b px-3 py-2 lg:px-4 lg:py-3">
                <div className="relative flex items-center gap-2">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute start-3 top-3 size-5 text-muted-foreground"
                  />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSearchOpen(true);
                    }}
                    onFocus={() => {
                      setSearchOpen(true);
                      setDetent("full");
                    }}
                    aria-label={t("civilMap.search")}
                    aria-expanded={searchOpen}
                    aria-controls="map-place-results"
                    placeholder={t("civilMap.search")}
                    className="h-11 min-w-0 flex-1 rounded-xl border bg-muted/40 pe-3 ps-10 text-sm focus:outline-2 focus:outline-primary"
                  />
                  {area && (
                    <button
                      type="button"
                      onClick={savePlace}
                      aria-label={t(
                        saved.includes(area.id)
                          ? "civilMap.unsavePlace"
                          : "civilMap.savePlace",
                      )}
                      aria-pressed={saved.includes(area.id)}
                      className="flex size-11 shrink-0 items-center justify-center rounded-xl border"
                    >
                      <Bookmark
                        className={`size-4 ${saved.includes(area.id) ? "fill-primary text-primary" : ""}`}
                      />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div
              ref={contentRef}
              className="map-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-2 lg:px-4 lg:py-3"
            >
              {message && (
                <div
                  role="status"
                  className="mb-3 flex items-center gap-2 rounded-xl bg-muted p-2 text-xs"
                >
                  <span className="flex-1">{t(message)}</span>
                  <button
                    type="button"
                    onClick={() => setMessage("")}
                    aria-label={t("common.close")}
                    className="flex size-11 shrink-0 items-center justify-center"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )}
              {mapFailed && (
                <p
                  role="status"
                  className="mb-3 rounded-xl p-3 text-sm"
                  style={{
                    backgroundColor: "var(--risk-tint-2)",
                    color: "var(--risk-ink-2)",
                  }}
                >
                  {t("civilMap.mapUnavailable")}
                </p>
              )}
              {offline && (
                <p
                  role="status"
                  className="mb-3 rounded-xl p-3 text-sm"
                  style={{
                    backgroundColor: "var(--risk-tint-2)",
                    color: "var(--risk-ink-2)",
                  }}
                >
                  {t("civilMap.offline")}
                </p>
              )}

              {panelView === "list" &&
                (searchOpen ? (
                  <PlaceSearchResults
                    query={query}
                    saved={saved}
                    allUnits={allUnits}
                    places={places}
                    unitsState={units.status}
                    locale={locale}
                    onChoose={chooseArea}
                    onClose={() => setSearchOpen(false)}
                  />
                ) : (
                  <SituationList
                    scoped={!!area}
                    loading={loading}
                    failed={queries.every((q) => q.isError)}
                    officialItems={officialItems}
                    observedItems={observedItems}
                    units={allUnits}
                    now={now}
                    selectedId={search.event}
                    onSelect={select}
                  />
                ))}

              {panelView === "detail" && (
                <SituationDetailView
                  selected={selected}
                  boundaryNote={
                    !selectedAreaId
                      ? null
                      : [
                            ...mapOfficial.features,
                            ...mapWarnings.features,
                            ...mapReports.features,
                          ].some(
                            (feature) => feature.properties?.["area"] === true,
                          )
                        ? "civilMap.reportedBoundary"
                        : "civilMap.boundaryUnavailable"
                  }
                  units={allUnits}
                  now={now}
                  fallback={
                    loading ||
                    (!!selectedCivilId && selectedPublication.isPending)
                      ? "civilMap.loading"
                      : selectedCivilId && selectedPublication.isError
                        ? "civilMap.error"
                        : "civilMap.detailUnavailable"
                  }
                  onShare={() => void share()}
                />
              )}

              {panelView === "layers" && (
                <LayersPanel
                  search={search}
                  onChange={(next) => update(next)}
                />
              )}

              {panelView === "sources" && (
                <SourcesPanel
                  sources={(health.data ?? []).filter((source) =>
                    relevantKeys.has(source.key),
                  )}
                  limited={limited}
                  checkedAt={checkedAt}
                  now={now}
                  locale={locale}
                  refreshing={refreshing}
                  onRefresh={refresh}
                />
              )}

              {panelView === "forecast" && (
                <>
                  {area?.level === "commune" ? (
                    <WeatherForecast communeId={area.id} />
                  ) : (
                    <>
                      <p className="text-sm">
                        {t("civilMap.selectCommuneWeather")}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          requestPlace("civilMap.selectCommuneWeather")
                        }
                        className="mt-4 min-h-11 w-full rounded-xl bg-primary px-3 text-sm text-primary-foreground"
                      >
                        {t("civilMap.search")}
                      </button>
                    </>
                  )}
                  <p className="mt-4 text-xs text-muted-foreground">
                    {t("civilMap.forecastsNotWarnings")}
                  </p>
                </>
              )}

              {panelView === "help" && (
                <>
                  <EmergencyNumbers showSheetLink={false} />
                  <Link
                    to="/survival"
                    className="mt-4 flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold"
                    style={{
                      backgroundColor: "var(--emergency-surface)",
                      borderColor: "var(--emergency)",
                      color: "var(--emergency-ink)",
                    }}
                  >
                    {t("track3.emergency.openSheet")}
                  </Link>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => openPanel("sources")}
              className="flex min-h-11 shrink-0 items-center gap-2 border-t px-3 py-2 text-start text-xs text-muted-foreground lg:px-4"
            >
              {limited ? (
                <TriangleAlert
                  className="size-4 shrink-0"
                  style={{ color: "var(--risk-ink-3)" }}
                />
              ) : (
                <ShieldCheck className="size-4 shrink-0 text-primary" />
              )}
              <span className="truncate">
                {t(limited ? "civilMap.limited" : "civilMap.coverage")}
              </span>
            </button>
          </div>
        </MapWorkspacePanel>
      )}
      {subscriptionOpen && area?.level === "commune" && (
        <SubscribeSheet
          key={area.code}
          open
          initialCommuneCode={area.code}
          onClose={() => {
            setSubscriptionOpen(false);
            setSubscribed(readSubscription()?.communes ?? []);
          }}
        />
      )}
      <MapSurvivalPrompt
        fires={survivalFires}
        official={official.data ?? []}
        warnings={warnings.data ?? []}
        earthquakes={earthquakes.data ?? []}
        units={allUnits}
        now={now}
      />
    </div>
  );
}
