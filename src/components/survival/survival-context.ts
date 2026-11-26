import { createContext, useContext } from "react";

import type { EmergencyHazardKind, PositionCard } from "@/lib/survival";
import type { SurvivalPack } from "@/lib/survival-pack";

export type SurvivalState = {
  online: boolean;
  position: { lat: number; lon: number } | null;
  positionDenied: boolean;
  pack: SurvivalPack | null;
  hazard: EmergencyHazardKind;
  setHazard: (next: EmergencyHazardKind) => void;
  offshoreM5Plus: boolean;
  positionCardData: PositionCard | null;
};

export const SurvivalContext = createContext<SurvivalState | null>(null);

export function useSurvival(): SurvivalState {
  const ctx = useContext(SurvivalContext);
  if (!ctx) throw new Error("useSurvival used outside the /survival layout");
  return ctx;
}
