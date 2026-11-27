import { fireStage } from "@/lib/nadhir";

export function visibleMapFires<T extends Parameters<typeof fireStage>[0]>(
  fires: T[],
  showCandidates: boolean,
): T[] {
  return showCandidates
    ? fires
    : fires.filter((fire) => fireStage(fire) !== "candidate");
}
