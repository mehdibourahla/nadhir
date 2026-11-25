import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Explain } from "@/components/nadhir/Explain";
import { dangerLevelKey } from "@/lib/nadhir";
import { cn } from "@/lib/utils";

import { RISK_ICON, clampLevel, riskInk, riskTint } from "./risk-visuals";

type Props = {
  level: number;
  showName?: boolean;
  fuelLimited?: boolean;
  nonFire?: boolean;
  className?: string;
};

export function RiskChip({
  level,
  showName = true,
  fuelLimited = false,
  nonFire = false,
  className,
}: Props) {
  const { t } = useTranslation();
  const current = clampLevel(level);
  const Icon = current === 4 && nonFire ? ShieldAlert : RISK_ICON[current];
  const name = t(`risk.${dangerLevelKey(current)}`);

  if (fuelLimited)
    return (
      <Explain text={t("explain.notRated")}>
        <span
          className={cn(
            "inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground",
            className,
          )}
        >
          {t("risk.fuelLimited")}
        </span>
      </Explain>
    );

  return (
    <Explain text={t("explain.dangerLevel")}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          className,
        )}
        style={{ backgroundColor: riskTint(current), color: riskInk(current) }}
      >
        <Icon aria-hidden className="size-3.5" />
        <span className="tabular">{current}</span>
        {showName ? (
          <span>{name}</span>
        ) : (
          <span className="sr-only">{name}</span>
        )}
      </span>
    </Explain>
  );
}
