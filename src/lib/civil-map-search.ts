export const HAZARD_CATEGORIES = [
  "all",
  "fire",
  "weather",
  "flood",
  "road",
  "earthquake",
  "other",
] as const;
export type HazardCategory = (typeof HAZARD_CATEGORIES)[number];

export type MapSearch = {
  area?: string | undefined;
  event?: string | undefined;
  hazard: HazardCategory;
  ended: boolean;
  candidates: boolean;
  lightning: boolean;
};

export function parseMapSearch(input: Record<string, unknown>): MapSearch {
  const text = (value: unknown) =>
    typeof value === "string" && value.length > 0 && value.length <= 100
      ? value
      : undefined;
  const area = text(input["area"]);
  const event = text(input["event"]);
  const hazard = HAZARD_CATEGORIES.find((c) => c === input["hazard"]) ?? "all";
  return {
    ...(area ? { area } : {}),
    ...(event ? { event } : {}),
    hazard,
    ended: input["ended"] === true || input["ended"] === "true",
    candidates: input["candidates"] === true || input["candidates"] === "true",
    lightning: input["lightning"] === true || input["lightning"] === "true",
  };
}
