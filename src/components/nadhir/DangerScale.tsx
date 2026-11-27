import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { dangerLevelKey } from "@/lib/nadhir";
import { Explain } from "@/components/nadhir/Explain";
import { cn } from "@/lib/utils";

import {
  RISK_ICON,
  clampLevel,
  riskInk,
  riskSolid,
  riskTint,
} from "./risk-visuals";

type Size = "sm" | "md" | "lg";

type Props = {
  level: number;
  fwi?: number | null;
  percentile?: number | null;
  size?: Size;
  guidance?: boolean;
  caption?: string;
  staleCaption?: string | null;
  className?: string;
};

const SIZE = {
  sm: {
    track: "h-1.5",
    dot: 10,
    value: "text-xl",
    name: "text-xs",
    icon: "size-3.5",
  },
  md: {
    track: "h-2",
    dot: 14,
    value: "text-3xl",
    name: "text-sm",
    icon: "size-4",
  },
  lg: {
    track: "h-2.5",
    dot: 18,
    value: "text-5xl",
    name: "text-base",
    icon: "size-5",
  },
} satisfies Record<
  Size,
  { track: string; dot: number; value: string; name: string; icon: string }
>;

export function DangerScale({
  level,
  fwi,
  percentile,
  size = "md",
  guidance = false,
  caption,
  staleCaption,
  className,
}: Props) {
  const { t } = useTranslation();
  const current = clampLevel(level);
  const s = SIZE[size];
  const Icon = RISK_ICON[current];
  const name = t(`risk.${dangerLevelKey(current)}`);
  const position = ((current - 0.5) / 5) * 100;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {staleCaption ? (
        <p
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs leading-relaxed"
          style={{
            backgroundColor: "var(--risk-tint-2)",
            color: "var(--risk-ink-2)",
          }}
        >
          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
          {staleCaption}
        </p>
      ) : null}

      <div className="flex items-baseline gap-2.5">
        <Explain
          text={
            fwi === undefined || fwi === null
              ? t("explain.dangerLevel")
              : t("explain.fwi")
          }
        >
          <span className={cn("font-display tabular leading-none", s.value)}>
            {fwi === undefined || fwi === null ? current : Math.round(fwi)}
          </span>
        </Explain>
        <Explain text={t("explain.dangerLevel")}>
          <span className="flex items-center gap-1.5">
            <Icon
              aria-hidden
              className={s.icon}
              style={{ color: riskSolid(current) }}
            />
            <span className={cn("font-medium", s.name)}>{name}</span>
          </span>
        </Explain>
        {fwi === undefined || fwi === null ? null : (
          <span className="text-xs text-muted-foreground">{t("risk.fwi")}</span>
        )}
      </div>

      <div
        className="relative"
        role="img"
        aria-label={`${t("risk.level")}: ${current}/5, ${name}`}
      >
        <div className={cn("danger-track w-full rounded-full", s.track)} />
        <span
          className="absolute top-1/2 rounded-full border-2 border-[var(--surface)]"
          style={{
            insetInlineStart: `calc(${position}% - ${s.dot / 2}px)`,
            width: s.dot,
            height: s.dot,
            transform: "translateY(-50%)",
            backgroundColor: riskSolid(current),
            boxShadow: "0 0 0 1px var(--mark-ring)",
          }}
        />
      </div>

      {caption ? (
        <p className="text-xs text-muted-foreground">{caption}</p>
      ) : null}

      {percentile === undefined || percentile === null ? null : (
        <Explain text={t("explain.fwiPercentile")}>
          <p className="tabular text-xs text-muted-foreground">
            {t("risk.percentile", { pct: percentile })}
          </p>
        </Explain>
      )}

      {guidance ? (
        <p
          className="mt-1 rounded-lg px-3 py-2.5 text-sm leading-relaxed"
          style={{
            backgroundColor: riskTint(current),
            color: riskInk(current),
          }}
        >
          {t(`risk.guidance.${current}`)}
        </p>
      ) : null}
    </div>
  );
}
