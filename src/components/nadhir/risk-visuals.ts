import {
  AlertTriangle,
  Flame,
  Info,
  OctagonAlert,
  ShieldCheck,
} from "lucide-react";

export const RISK_LEVELS = [1, 2, 3, 4, 5] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export function clampLevel(level: number): RiskLevel {
  const n = Math.round(level);
  if (n <= 1) return 1;
  if (n >= 5) return 5;
  return n as RiskLevel;
}

/** Icon per level so a danger level is never communicated by colour alone (spec 15). */
export const RISK_ICON = {
  1: ShieldCheck,
  2: Info,
  3: AlertTriangle,
  4: Flame,
  5: OctagonAlert,
} as const;

export const riskSolid = (level: number) => `var(--risk-${clampLevel(level)})`;
export const riskTint = (level: number) =>
  `var(--risk-tint-${clampLevel(level)})`;
export const riskInk = (level: number) =>
  `var(--risk-ink-${clampLevel(level)})`;
