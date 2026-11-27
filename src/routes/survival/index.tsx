import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CheckCircle2,
  Compass,
  PhoneCall,
  ShieldAlert,
} from "lucide-react";

import { standingGuidanceForHazard } from "@/lib/survival";
import { cleanCopy } from "@/ui/format";
import { AtlasBadge, AtlasPanel } from "@/ui/primitives";
import { useSurvivalContext } from "@/ui/survival-context";

export const Route = createFileRoute("/survival/")({
  component: SurvivalHub,
});

function SurvivalHub() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "ar";
  const { hazard, offshoreM5, card } = useSurvivalContext();
  const guidance = standingGuidanceForHazard(hazard, {
    offshoreM5Plus: offshoreM5,
  });
  const hazardLabel =
    locale === "ar"
      ? hazard === "general"
        ? "عام"
        : hazard === "fire"
          ? "حريق"
          : hazard === "flood"
            ? "فيضان"
            : hazard === "earthquake"
              ? "زلزال"
              : "عاصفة"
      : locale === "fr"
        ? hazard === "general"
          ? "Général"
          : hazard === "fire"
            ? "Incendie"
            : hazard === "flood"
              ? "Inondation"
              : hazard === "earthquake"
                ? "Séisme"
                : "Orage"
        : hazard.charAt(0).toUpperCase() + hazard.slice(1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <AtlasPanel className="lg:col-span-8 space-y-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-2xl font-semibold text-ink">
            {cleanCopy(t(guidance.titleKey))}
          </h2>
          <AtlasBadge tone="extreme" dot>
            {hazardLabel}
          </AtlasBadge>
        </div>

        <ol className="divide-y divide-hairline border-y border-hairline">
          {guidance.items.map((key, idx) => (
            <li key={key} className="flex items-start gap-4 py-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-signal-soft font-mono text-xs font-semibold text-signal">
                {idx + 1}
              </span>
              <p className="text-sm sm:text-base text-ink leading-relaxed pt-0.5">
                {cleanCopy(t(key))}
              </p>
            </li>
          ))}
        </ol>

        {guidance.coastalTsunamiKey && (
          <div className="rounded-xl border border-hazard-extreme/40 bg-hazard-extreme-soft p-4 text-sm text-ink">
            {cleanCopy(t(guidance.coastalTsunamiKey))}
          </div>
        )}

        <p className="text-xs text-ink-muted leading-relaxed">
          {cleanCopy(t(guidance.noInstructionKey))}
        </p>
      </AtlasPanel>

      <div className="lg:col-span-4 space-y-4">
        <AtlasPanel className="space-y-3">
          <h3 className="text-xs font-mono font-semibold text-ink-secondary">
            {t("survival.sosPosition")}
          </h3>
          {card ? (
            <dl className="divide-y divide-hairline text-sm">
              {card.commune && (
                <div className="flex justify-between py-2">
                  <dt className="text-ink-secondary">
                    {t("survival.sosCommune")}
                  </dt>
                  <dd className="font-medium text-ink">{card.commune}</dd>
                </div>
              )}
              <div className="flex justify-between py-2">
                <dt className="text-ink-secondary">
                  {t("survival.sosCoords")}
                </dt>
                <dd className="font-mono text-xs text-ink" dir="ltr">
                  {card.coords}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-ink-secondary">
              {t("survival.noPosition")}
            </p>
          )}
        </AtlasPanel>

        <div className="space-y-2">
          {[
            {
              to: "/survival/areas" as const,
              Icon: Compass,
              title: t("survival.areasTitle"),
            },
            {
              to: "/survival/checkin" as const,
              Icon: CheckCircle2,
              title: t("survival.checkinTitle"),
            },
            {
              to: "/survival/sos" as const,
              Icon: PhoneCall,
              title: t("survival.sos"),
            },
            {
              to: "/report" as const,
              Icon: ShieldAlert,
              title: t("survival.report"),
            },
          ].map((item) => {
            const Icon = item.Icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center justify-between rounded-xl border border-hairline bg-surface px-4 py-3 text-sm font-medium text-ink hover:border-hairline-strong hover:bg-surface-raised transition-colors"
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 text-signal" />
                  {item.title}
                </span>
                <ArrowRight className="h-4 w-4 text-ink-muted atlas-dir-icon" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
