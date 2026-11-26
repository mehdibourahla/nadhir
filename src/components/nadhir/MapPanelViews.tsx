import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bookmark, LoaderCircle, RefreshCw, Share2, X } from "lucide-react";
import {
  SituationCard,
  SituationDetails,
  hazardIcons,
} from "@/components/nadhir/CivilSituation";
import { BroadcastBanner } from "@/components/nadhir/BroadcastBanner";
import { SourceHealth } from "@/components/nadhir/SourceHealth";
import { relativeTime, unitName, type AdminUnit } from "@/lib/nadhir";
import { CITIZEN_NEARBY_RADIUS_KM, type Situation } from "@/lib/civil-map";
import { HAZARD_CATEGORIES, type MapSearch } from "@/lib/civil-map-search";
import type { SourceHealth as SourceHealthRow } from "@/lib/source-health";
import type { Locale } from "@/i18n";
import { ShowMore } from "@/components/ShowMore";
import { isShareable } from "@/lib/share-card";

export function PlaceSearchResults({
  query,
  saved,
  allUnits,
  places,
  unitsState,
  locale,
  onChoose,
  onClose,
}: {
  query: string;
  saved: string[];
  allUnits: AdminUnit[];
  places: AdminUnit[];
  unitsState: "pending" | "error" | "success";
  locale: Locale;
  onChoose: (unit: AdminUnit | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div id="map-place-results">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChoose(null)}
          className="min-h-11 text-sm font-semibold"
        >
          {t("civilMap.allAreas")}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="flex size-11 items-center justify-center"
        >
          <X className="size-4" />
        </button>
      </div>
      {!query && saved.length > 0 && (
        <>
          <p className="py-2 text-xs text-muted-foreground">
            {t("civilMap.savedPlaces")}
          </p>
          {allUnits
            .filter((u) => saved.includes(u.id))
            .map((u) => (
              <button
                type="button"
                key={u.id}
                onClick={() => onChoose(u)}
                className="flex min-h-12 w-full items-center gap-2 rounded-xl px-3 text-start text-sm hover:bg-muted"
              >
                <Bookmark className="size-4" />
                {unitName(u, locale)}
              </button>
            ))}
        </>
      )}
      {unitsState === "pending" ? (
        <p>{t("civilMap.loading")}</p>
      ) : unitsState === "error" ? (
        <p role="status">{t("civilMap.error")}</p>
      ) : query && !places.length ? (
        <p className="py-4 text-sm">{t("civilMap.searchEmpty")}</p>
      ) : (
        places.map((u) => (
          <button
            type="button"
            key={u.id}
            onClick={() => onChoose(u)}
            className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-3 text-start text-sm hover:bg-muted"
          >
            <span>{unitName(u, locale)}</span>
            <span className="text-xs text-muted-foreground">{u.code}</span>
          </button>
        ))
      )}
    </div>
  );
}

export function SituationList({
  scoped,
  loading,
  failed,
  officialItems,
  observedItems,
  units,
  now,
  selectedId,
  onSelect,
}: {
  scoped: boolean;
  loading: boolean;
  failed: boolean;
  officialItems: Situation[];
  observedItems: Situation[];
  units: AdminUnit[];
  now: number;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {scoped && (
        <p className="mb-3 text-xs text-muted-foreground">
          {t("civilMap.nearbyScope", { km: CITIZEN_NEARBY_RADIUS_KM })}
        </p>
      )}
      {loading && (
        <p role="status" className="mb-3 flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {t("civilMap.loading")}
        </p>
      )}
      {!loading && !officialItems.length && !observedItems.length && (
        <div className="rounded-2xl bg-muted/40 p-5">
          <h2 className="font-sans text-sm font-medium">
            {t(failed ? "civilMap.error" : "civilMap.noSituations")}
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t("civilMap.noSituationsBody")}
          </p>
        </div>
      )}
      <div className="space-y-5">
        {[
          { key: "officialGroup", items: officialItems },
          { key: "observationsGroup", items: observedItems },
        ]
          .filter((group) => group.items.length)
          .map((group) => (
            <section key={group.key}>
              <h2 className="mb-3 font-sans text-xs font-semibold text-muted-foreground">
                {t(`civilMap.${group.key}`)}
              </h2>
              <ShowMore items={group.items}>
                {(visible) => (
                  <div className="space-y-2 lg:space-y-3">
                    {visible.map((item) => (
                      <SituationCard
                        key={item.id}
                        item={item}
                        units={units}
                        now={now}
                        selected={item.id === selectedId}
                        onSelect={() => onSelect(item.id)}
                      />
                    ))}
                  </div>
                )}
              </ShowMore>
            </section>
          ))}
      </div>
      <div className="mt-4">
        <BroadcastBanner />
      </div>
    </>
  );
}

export function SituationDetailView({
  selected,
  boundaryNote,
  units,
  now,
  fallback,
  onShare,
}: {
  selected: Situation | undefined;
  boundaryNote:
    "civilMap.reportedBoundary" | "civilMap.boundaryUnavailable" | null;
  units: AdminUnit[];
  now: number;
  fallback:
    "civilMap.loading" | "civilMap.error" | "civilMap.detailUnavailable";
  onShare: () => void;
}) {
  const { t } = useTranslation();
  if (!selected) return <p>{t(fallback)}</p>;
  return (
    <>
      {boundaryNote && (
        <p className="mb-4 rounded-xl bg-muted p-3 text-xs leading-relaxed">
          {t(boundaryNote)}
        </p>
      )}
      <SituationDetails item={selected} units={units} now={now} />
      {/* shareable official incidents carry their own share sheet */}
      {selected.source === "official" && isShareable(selected.data) ? null : (
        <button
          type="button"
          onClick={onShare}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm"
        >
          <Share2 className="size-4" />
          {t("civilMap.share")}
        </button>
      )}
    </>
  );
}

export function LayersPanel({
  search,
  onChange,
}: {
  search: MapSearch;
  onChange: (next: Partial<MapSearch>) => void;
}) {
  const { t } = useTranslation();
  const toggles = [
    ["candidates", "civilMap.showCandidates"],
    ["ended", "civilMap.showEnded"],
    ["lightning", "civilMap.showLightning"],
  ] as const;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        {HAZARD_CATEGORIES.map((category) => {
          const Icon = hazardIcons[category];
          return (
            <button
              type="button"
              key={category}
              aria-pressed={search.hazard === category}
              onClick={() => onChange({ hazard: category, event: undefined })}
              className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 text-sm ${search.hazard === category ? "border-primary bg-primary/10" : "bg-surface"}`}
            >
              <Icon className="size-4" />
              {t(`track3.filters.${category}`)}
            </button>
          );
        })}
      </div>
      {toggles.map(([key, label]) => (
        <label key={key} className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={search[key]}
            onChange={(e) => onChange({ [key]: e.target.checked })}
          />
          {t(label)}
        </label>
      ))}
      <div className="space-y-3 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
        {[
          "satelliteLegend",
          "colorLegend",
          "tintLegend",
          "officialLegend",
          "weatherLegend",
          "lightningLegend",
          "citizenLegend",
          "publicationNotice",
        ].map((key) => (
          <p key={key}>{t(`civilMap.${key}`)}</p>
        ))}
      </div>
    </div>
  );
}

export function SourcesPanel({
  sources,
  limited,
  checkedAt,
  now,
  locale,
  refreshing,
  onRefresh,
}: {
  sources: SourceHealthRow[];
  limited: boolean;
  checkedAt: number;
  now: number;
  locale: Locale;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <ul>
        {sources.map((source) => (
          <SourceHealth key={source.key} source={source} locale={locale} />
        ))}
      </ul>
      <p className="text-sm">
        {t(limited ? "civilMap.limited" : "civilMap.sourceTime")}
      </p>
      {Number.isFinite(checkedAt) && (
        <p className="text-xs text-muted-foreground">
          {t("civilMap.updated", {
            time: relativeTime(new Date(checkedAt).toISOString(), locale, now),
          })}
        </p>
      )}
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm"
      >
        <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        {t("civilMap.refresh")}
      </button>
      <Link
        to="/status"
        className="flex min-h-11 items-center text-sm underline"
      >
        {t("civilMap.coverage")}
      </Link>
    </div>
  );
}
