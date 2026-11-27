import { describe, expect, it } from "vitest";
import type { FireCluster } from "@/lib/nadhir";
import type { FireLevel } from "@/lib/fire-confidence";
import { fireFeatures } from "./map-fires";

const now = Date.parse("2026-09-22T12:00:00Z");
const fire = (id: string, hoursAgo: number, lat = 36.7): FireCluster =>
  ({
    id,
    short_id: id.toUpperCase(),
    state: "active",
    lat,
    lon: 4,
    first_detected_at: new Date(now - (hoursAgo + 1) * 3_600_000).toISOString(),
    last_detected_at: new Date(now - hoursAgo * 3_600_000).toISOString(),
    resolved_at: null,
  }) as FireCluster;
const props = (
  clusters: FireCluster[],
  levels: [string, FireLevel][],
  position: { lat: number; lon: number } | null = null,
) =>
  fireFeatures(clusters, null, new Map(levels), position, now).features.map(
    (f) => f.properties,
  );

describe("fire features", () => {
  it("colors a fire by its level and keeps heat signals minor", () => {
    expect(
      props(
        [fire("a", 1), fire("b", 1), fire("c", 1)],
        [
          ["a", "confirmed"],
          ["b", "probable"],
        ],
      ),
    ).toEqual([
      expect.objectContaining({ icon: "fire-official", minor: false }),
      expect.objectContaining({ icon: "fire-corroborated", minor: false }),
      expect.objectContaining({ icon: "fire-single", minor: true }),
    ]);
  });

  it("makes a fire past its lease minor and faded whatever its level", () => {
    expect(props([fire("a", 8)], [["a", "probable"]])[0]).toMatchObject({
      faded: true,
      minor: true,
    });
  });

  it("pulses only a live probable or confirmed fire near a known position", () => {
    const near = { lat: 36.75, lon: 4 };
    expect(
      props(
        [fire("a", 1), fire("b", 1), fire("c", 8), fire("d", 1, 37.2)],
        [
          ["a", "probable"],
          ["c", "probable"],
          ["d", "confirmed"],
        ],
        near,
      ).map((p) => p?.["pulse"]),
    ).toEqual([true, false, false, false]);
    expect(props([fire("a", 1)], [["a", "probable"]])[0]?.["pulse"]).toBe(
      false,
    );
  });
});
