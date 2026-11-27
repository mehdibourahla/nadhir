import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Compass, ExternalLink } from "lucide-react";

import { bearingBetween, bearingLabel, haversineKm } from "@/lib/nadhir";
import { openAreaCriteriaForHazard } from "@/lib/survival";
import { cleanCopy } from "@/ui/format";
import { AtlasBadge, AtlasEmpty, AtlasPanel, SafeBdi } from "@/ui/primitives";
import { useSurvivalContext } from "@/ui/survival-context";

export const Route = createFileRoute("/survival/areas")({
  component: OpenAreasPage,
});

function OpenAreasPage() {
  const { t, i18n } = useTranslation();
  const { hazard, position, pack, openAreas } = useSurvivalContext();
  const criteria = openAreaCriteriaForHazard(hazard);

  const origin = position ?? (pack ? { lat: pack.lat, lon: pack.lon } : null);

  const ranked = useMemo(() => {
    if (!origin)
      return openAreas
        .slice(0, 20)
        .map((a) => ({ area: a, km: null as number | null, dir: "" }));
    return openAreas
      .map((area) => {
        const km = haversineKm(origin.lat, origin.lon, area.lat, area.lon);
        const dir = cleanCopy(
          bearingLabel(
            bearingBetween(origin.lat, origin.lon, area.lat, area.lon),
          ),
        );
        return { area, km, dir };
      })
      .sort((a, b) => (a.km ?? 9999) - (b.km ?? 9999))
      .slice(0, 24);
  }, [openAreas, origin]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-7 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold text-ink">
            {t("survival.areasTitle")}
          </h2>
          <AtlasBadge tone="high">{t("survival.areasUnverified")}</AtlasBadge>
        </div>
        <p className="text-sm text-ink-secondary">{t("survival.areasIntro")}</p>

        {ranked.length === 0 ? (
          <AtlasEmpty title={t("survival.areasEmpty")} />
        ) : (
          <div className="divide-y divide-hairline border-y border-hairline bg-surface">
            {ranked.map(({ area, km, dir }) => (
              <div
                key={area.id}
                className="flex items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-semibold text-ink truncate">
                    <SafeBdi dir="auto">
                      {i18n.language === "ar" && area.name_ar
                        ? area.name_ar
                        : area.name}
                    </SafeBdi>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-secondary">
                    <AtlasBadge tone="neutral">
                      {t(`survival.areaType.${area.area_type}`)}
                    </AtlasBadge>
                    {km !== null && (
                      <SafeBdi className="font-mono text-xs text-ink-muted">
                        {km.toFixed(1)} km · {dir}
                      </SafeBdi>
                    )}
                  </div>
                </div>
                <a
                  href={`https://maps.google.com/?q=${area.lat},${area.lon}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong px-2.5 py-1.5 text-xs font-medium text-signal hover:bg-signal-soft shrink-0"
                >
                  <Compass className="h-3.5 w-3.5" />
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      <AtlasPanel className="lg:col-span-5 space-y-4">
        <h3 className="font-display text-lg font-semibold text-ink">
          {cleanCopy(t(criteria.titleKey))}
        </h3>
        {criteria.items.length > 0 && (
          <ul className="space-y-2.5 text-sm text-ink-secondary">
            {criteria.items.map((key) => (
              <li key={key} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-signal shrink-0" />
                <span>{cleanCopy(t(key))}</span>
              </li>
            ))}
          </ul>
        )}
        {criteria.warningNoteKey && (
          <p className="text-sm text-ink-secondary leading-relaxed">
            {cleanCopy(t(criteria.warningNoteKey))}
          </p>
        )}
        <p className="text-xs text-ink-muted border-t border-hairline pt-3">
          {t("survival.areasRefugeNote")}
        </p>
      </AtlasPanel>
    </div>
  );
}
