import { createContext, useContext } from "react";
import type { OpenArea } from "@/lib/open-areas";
import type { EmergencyHazardKind, PositionCard } from "@/lib/survival";
import type { SurvivalPack } from "@/lib/survival-pack";

export type SurvivalContextValue = {
  online: boolean;
  hazard: EmergencyHazardKind;
  offshoreM5: boolean;
  setHazard: (hazard: EmergencyHazardKind) => void;
  position: { lat: number; lon: number } | null;
  positionDenied: boolean;
  requestPosition: () => void;
  card: PositionCard | null;
  pack: SurvivalPack | null;
  openAreas: OpenArea[];
};

export const SurvivalContext = createContext<SurvivalContextValue | null>(null);

export function useSurvivalContext(): SurvivalContextValue {
  const ctx = useContext(SurvivalContext);
  if (!ctx) throw new Error("useSurvivalContext must be used inside /survival");
  return ctx;
}
