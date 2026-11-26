import { describe, expect, it } from "vitest";

import { algiersTime, relativeTime, type OfficialIncident } from "@/lib/nadhir";
import {
  CARD_REVISION,
  algiersDateTime,
  incidentCardModel,
  isShareable,
  linkTargets,
  outlinePaths,
  shareImagePath,
  shareLocale,
} from "@/lib/share-card";

const t = (key: string, vars?: Record<string, string>) =>
  vars ? `${key}${JSON.stringify(vars)}` : key;

const unit = (name: string) => ({
  name_ar: `${name}-ar`,
  name_fr: `${name}-fr`,
  name_en: `${name}-en`,
  name_kab: null,
  lat: 36,
  lon: 4,
});

const incident = (over: Partial<OfficialIncident> = {}): OfficialIncident => ({
  id: "0b5c1f2e-8f4a-4c55-9a51-3f1c2f0c9b10",
  wilaya_id: "w",
  commune_id: "c",
  kind: "vegetation",
  status: "ongoing",
  precision: "commune",
  authority_tier: "national",
  place_text: null,
  first_reported_at: "2026-09-27T10:00:00Z",
  last_reported_at: "2026-09-27T13:32:00Z",
  as_of: "2026-09-27T13:32:00Z",
  updated_at: "2026-09-27T13:40:00Z",
  unlisted_at: null,
  mention_count: 1,
  evidence: "…",
  commune: unit("Azazga"),
  wilaya: unit("Tizi Ouzou"),
  latest_mention: {
    document: { url: "https://t.me/x/1", published_at: "2026-09-27T13:32:00Z" },
    source: { label: "Protection Civile" },
  },
  ...over,
});

describe("incidentCardModel", () => {
  it("puts the authority first, falling back when the source is unnamed", () => {
    expect(incidentCardModel(incident(), t, "en")).toMatchObject({
      eyebrow: "official.eyebrow",
      source: "Protection Civile",
    });
    expect(
      incidentCardModel(incident({ latest_mention: null }), t, "en").source,
    ).toBe("official.sourceFallback");
  });

  it("names the hazard and status in the authority's vocabulary", () => {
    expect(incidentCardModel(incident(), t, "en")).toMatchObject({
      fire: true,
      hazard: "civilMap.fire",
      status: "official.statuses.ongoing",
    });
    expect(
      incidentCardModel(
        incident({ kind: "flood", status: "monitoring" }),
        t,
        "en",
      ),
    ).toMatchObject({
      fire: false,
      hazard: "reports.hazardName.flooding",
      status: "official.statuses.monitoring",
    });
  });

  it("falls back to the wilaya when the report is only wilaya-precise", () => {
    expect(
      incidentCardModel(incident({ precision: "wilaya" }), t, "fr"),
    ).toMatchObject({ place: "Tizi Ouzou-fr", region: "official.wilayaLevel" });
    expect(incidentCardModel(incident(), t, "fr")).toMatchObject({
      place: "Azazga-fr",
      region: 'official.inWilaya{"wilaya":"Tizi Ouzou-fr"}',
    });
  });

  it("stamps an absolute Algiers time, never a relative one", () => {
    expect(algiersDateTime("2026-09-27T13:32:00Z", "en")).toMatch(/14:32/);
    expect(algiersDateTime("2026-09-27T13:32:00Z", "fr")).toContain("2026");
    expect(incidentCardModel(incident(), t, "en").time).toContain("14:32");
  });

  it("returns empty string without throwing on invalid, null, or NaN dates (T5-09)", () => {
    for (const bad of [
      "",
      "   ",
      "not-a-date",
      "2026-99-99",
      null as unknown as string,
      undefined as unknown as string,
    ]) {
      expect(algiersTime(bad)).toBe("");
      expect(relativeTime(bad, "fr")).toBe("");
      expect(algiersDateTime(bad, "ar")).toBe("");
    }
    expect(relativeTime("2026-09-27T13:32:00Z", "fr", Number.NaN)).toBe("");
  });
});

describe("share helpers", () => {
  it("refuses media-tier incidents", () => {
    expect(isShareable(incident())).toBe(true);
    expect(isShareable(incident({ authority_tier: "media" }))).toBe(false);
  });

  it("versions image URLs by card revision and updated_at", () => {
    expect(shareImagePath("abc", "og", "fr", "2026-09-27T13:40:00Z")).toBe(
      `/api/public/share/incident/abc/og?lang=fr&v=${CARD_REVISION}.${Date.parse("2026-09-27T13:40:00Z")}`,
    );
  });

  it("accepts only picker locales", () => {
    expect(shareLocale("fr")).toBe("fr");
    expect(shareLocale("kab")).toBe("ar");
    expect(shareLocale(null)).toBe("ar");
  });

  it("encodes the link for WhatsApp and Facebook", () => {
    expect(linkTargets("https://nadhir.app/incident/a?lang=fr")).toEqual({
      whatsapp:
        "https://wa.me/?text=https%3A%2F%2Fnadhir.app%2Fincident%2Fa%3Flang%3Dfr",
      facebook:
        "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fnadhir.app%2Fincident%2Fa%3Flang%3Dfr",
    });
  });
});

describe("outlinePaths", () => {
  const square = (x: number, y: number, s: number) => ({
    type: "Polygon" as const,
    coordinates: [
      [
        [x, y],
        [x + s, y],
        [x + s, y + s],
        [x, y + s],
        [x, y],
      ],
    ],
  });

  it("fits every shape inside the padded box, one path per shape", () => {
    const paths = outlinePaths(
      [square(4, 36, 1), square(4.2, 36.2, 0.2)],
      400,
      400,
      20,
    );
    expect(paths).toHaveLength(2);
    const numbers = paths
      .join(" ")
      .match(/-?\d+(\.\d+)?/g)!
      .map(Number);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(380);
  });

  it("draws north up", () => {
    const [path] = outlinePaths([square(4, 36, 1)], 400, 400, 0);
    const [, firstY] = path!
      .match(/M(-?[\d.]+) (-?[\d.]+)/)!
      .slice(1)
      .map(Number);
    expect(firstY).toBeGreaterThan(200);
  });
});
