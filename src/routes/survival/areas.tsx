import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/nadhir/states";
import { OfflineAreaMap } from "@/components/survival/OfflineAreaMap";
import { useSurvival } from "@/components/survival/survival-context";
import { bearingBetween, bearingLabel, haversineKm } from "@/lib/nadhir";
import { type OpenArea } from "@/lib/open-areas";
import { openAreaCriteriaForHazard } from "@/lib/survival";

export const Route = createFileRoute("/survival/areas")({
  component: OpenAreasPage,
});

const LIST_MAX = 12;

function OpenAreasPage() {
  const { t, i18n } = useTranslation();
  const { position, pack, hazard } = useSurvival();

  const areas = pack?.openAreas;
  const origin = useMemo(
    () => position ?? (pack ? { lat: pack.lat, lon: pack.lon } : null),
    [position, pack],
  );

  const rows = useMemo(() => {
    if (!areas) return null;
    const withDistance = areas.map((a: OpenArea) => ({
      area: a,
      km: origin ? haversineKm(origin.lat, origin.lon, a.lat, a.lon) : null,
      bearing: origin
        ? bearingBetween(origin.lat, origin.lon, a.lat, a.lon)
        : null,
    }));
    withDistance.sort((x, y) => (x.km ?? Infinity) - (y.km ?? Infinity));
    return withDistance.slice(0, LIST_MAX);
  }, [areas, origin]);

  const arabic = i18n.language === "ar";
  const criteria = openAreaCriteriaForHazard(hazard);

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          to="/survival"
          className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted"
          aria-label={t("common.back")}
        >
          <ChevronLeft aria-hidden className="size-5 rtl:rotate-180" />
        </Link>
        <h1 className="font-display text-xl">{t("survival.areasTitle")}</h1>
      </div>

      <p className="rounded-lg bg-muted px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
        {t("survival.areasIntro")}
      </p>

      {pack ? <OfflineAreaMap pack={pack} /> : null}
      {!position && origin ? (
        <p className="text-xs text-muted-foreground">
          {t("survival.packOrigin")}: {pack?.zone_name ?? pack?.commune}
        </p>
      ) : null}
      {rows === null ? (
        <EmptyState
          title={t("survival.areasTitle")}
          body={t("survival.areasEmpty")}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("survival.areasTitle")}
          body={t("survival.areasEmpty")}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(({ area, km, bearing }) => (
            <li key={area.id} className="card flex items-center gap-3 p-3.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-semibold">
                  {arabic && area.name_ar ? area.name_ar : area.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`survival.areaType.${area.area_type}`)} ·{" "}
                  {t("survival.areasUnverified")}
                </span>
              </div>
              {km !== null && bearing !== null ? (
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="tabular text-sm font-bold">
                    {km < 10 ? km.toFixed(1) : Math.round(km)} {t("common.km")}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t(`survival.dir.${bearingLabel(bearing).toLowerCase()}`)}
                  </span>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <section className="card mt-auto flex flex-col gap-2.5 p-4 text-start">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <ShieldCheck aria-hidden className="size-4 shrink-0" />
          <span>{t(criteria.titleKey)}</span>
        </span>
        {criteria.warningNoteKey ? (
          <p className="text-[13.5px] leading-relaxed text-foreground">
            {t(criteria.warningNoteKey)}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
            {criteria.items.map((key) => (
              <li key={key}>· {t(key)}</li>
            ))}
          </ul>
        )}
        <p className="border-t border-border pt-2.5 text-xs text-muted-foreground">
          {t("survival.areasRefugeNote")}
        </p>
      </section>
    </>
  );
}
