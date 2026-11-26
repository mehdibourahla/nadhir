import { expect, it } from "vitest";
import { HAZARD_CATEGORIES, parseMapSearch } from "../civil-map-search";

it("includes flood in the 7 hazard filter categories and accepts ?hazard=flood", () => {
  expect(HAZARD_CATEGORIES).toEqual([
    "all",
    "fire",
    "weather",
    "flood",
    "road",
    "earthquake",
    "other",
  ]);
  expect(parseMapSearch({ hazard: "flood" }).hazard).toBe("flood");
});

it("preserves shareable place, record and supported filters", () => {
  expect(
    parseMapSearch({
      area: "commune-1",
      event: "weather:warning-1",
      hazard: "weather",
      ended: true,
      candidates: "true",
    }),
  ).toEqual({
    area: "commune-1",
    event: "weather:warning-1",
    hazard: "weather",
    ended: true,
    candidates: true,
    lightning: false,
  });
});
it("discards invalid search types and rejects truthy false strings", () => {
  expect(
    parseMapSearch({
      area: [],
      event: {},
      hazard: "invented",
      ended: "false",
      candidates: 1,
    }),
  ).toEqual({
    hazard: "all",
    ended: false,
    candidates: false,
    lightning: false,
  });
});

it("preserves civil publication links while keeping historical items hidden by default", () => {
  expect(
    parseMapSearch({ event: "civil:12345678-1234-1234-1234-123456789abc" }),
  ).toEqual({
    event: "civil:12345678-1234-1234-1234-123456789abc",
    hazard: "all",
    ended: false,
    candidates: false,
    lightning: false,
  });
});
