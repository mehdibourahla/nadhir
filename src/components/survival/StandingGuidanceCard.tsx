import {
  Activity,
  CloudLightning,
  Flame,
  ShieldCheck,
  TriangleAlert,
  Waves,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  EMERGENCY_HAZARDS,
  standingGuidanceForHazard,
  type EmergencyHazardKind,
} from "@/lib/survival";

const HAZARD_ICON: Record<EmergencyHazardKind, typeof ShieldCheck> = {
  general: ShieldCheck,
  fire: Flame,
  flood: Waves,
  earthquake: Activity,
  storm: CloudLightning,
};

type Props = {
  hazard: EmergencyHazardKind;
  offshoreM5Plus?: boolean;
  online: boolean;
  onSelectHazard: (next: EmergencyHazardKind) => void;
};

export function StandingGuidanceCard({
  hazard,
  offshoreM5Plus = false,
  online,
  onSelectHazard,
}: Props) {
  const { t } = useTranslation();
  const spec = standingGuidanceForHazard(hazard, { offshoreM5Plus });

  return (
    <section
      data-standing-guidance={spec.hazard}
      className="card-raised flex flex-col gap-3 p-4 text-start"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <ShieldCheck aria-hidden className="size-4 shrink-0" />
          <span>
            {online ? t("survival.guidanceLabel") : t("survival.guidanceSaved")}
          </span>
        </span>
      </div>

      <div
        role="group"
        aria-label={t("track3.emergency.selectHazard")}
        className="map-scroll flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto overscroll-x-contain pb-1"
      >
        {EMERGENCY_HAZARDS.map((kind) => {
          const Icon = HAZARD_ICON[kind];
          const active = hazard === kind;
          return (
            <button
              key={kind}
              type="button"
              data-emergency-hazard={kind}
              aria-pressed={active}
              onClick={() => onSelectHazard(kind)}
              className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]"
                  : "border-border bg-surface text-foreground hover:bg-muted"
              }`}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              <span>{t(`track3.emergency.hazards.${kind}`)}</span>
            </button>
          );
        })}
      </div>

      <h2 className="font-display text-2xl leading-tight">
        {t(spec.titleKey)}
      </h2>

      <ol className="space-y-2 text-[15px] leading-relaxed">
        {spec.items.map((key, index) => (
          <li key={key} className="flex items-start gap-2.5">
            <span
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground tabular-nums"
              aria-hidden
            >
              {index + 1}
            </span>
            <span>{t(key)}</span>
          </li>
        ))}
      </ol>

      {spec.coastalTsunamiKey ? (
        <div
          role="alert"
          data-coastal-tsunami="true"
          className="flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-medium leading-relaxed"
          style={{
            backgroundColor: "var(--emergency-surface)",
            borderColor: "var(--emergency)",
            color: "var(--emergency-ink)",
          }}
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{t(spec.coastalTsunamiKey)}</span>
        </div>
      ) : null}

      <p className="border-t border-border pt-2.5 text-xs leading-relaxed text-muted-foreground">
        {t(spec.noInstructionKey)}
      </p>
    </section>
  );
}
