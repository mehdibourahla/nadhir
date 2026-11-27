import { expect, it } from "vitest";
import { visibleMapFires } from "./map-fire-filter";

const candidate = { state: "unconfirmed", confirmed_at: null };
const detected = { state: "active", confirmed_at: null };
const confirmed = {
  state: "unconfirmed",
  confirmed_at: "2026-09-15T12:00:00Z",
};

it("excludes candidates before clustering while retaining officially confirmed fires", () => {
  expect(visibleMapFires([candidate, detected, confirmed], false)).toEqual([
    detected,
    confirmed,
  ]);
});

it("includes candidates when enabled and preserves the input", () => {
  const input = [candidate, detected];
  expect(visibleMapFires(input, true)).toEqual(input);
  visibleMapFires(input, false);
  expect(input).toEqual([candidate, detected]);
});
