import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
    children: ReactNode;
    className?: string;
    "aria-label"?: string;
    lang?: string;
    "aria-current"?: AnchorHTMLAttributes<HTMLAnchorElement>["aria-current"];
  }) => {
    const base = params?.["slug"] ? to.replace("$slug", params["slug"]) : to;
    const qs = search
      ? new URLSearchParams(
          Object.entries(search).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ).toString()
      : "";
    return (
      <a href={qs ? `${base}?${qs}` : base} {...rest}>
        {children}
      </a>
    );
  },
  useLoaderData: () => undefined,
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
  useSearch: () => ({}),
}));

import { WilayaPageView } from "@/components/forecast/WilayaPageView";
import { TooltipProvider } from "@/components/ui/tooltip";
import i18n, { type AnyLocale } from "@/i18n";
import type { WilayaSnapshot } from "@/lib/wilaya-data";
import { wilayaBySlug } from "@/lib/wilaya-slugs";

const TINDOUF = wilayaBySlug("tindouf")!;

function makeSnapshot(overrides: Partial<WilayaSnapshot> = {}): WilayaSnapshot {
  return {
    wilaya: TINDOUF,
    dataStatus: "ok",
    fetchedAt: "2026-11-25T12:00:00Z",
    communes: [
      {
        id: "c-3701",
        level: "commune",
        code: "3701",
        name_ar: "تندوف",
        name_fr: "Tindouf",
        name_en: "Tindouf",
        name_kab: "Tinduf",
        parent_id: "w-37",
        lat: 27.6711,
        lon: -8.1474,
        forest_fraction: 0,
        population: 60000,
      },
    ],
    onmWarnings: [
      {
        id: "onm-extreme",
        cap_id: "cap-extreme",
        title: "نشرية خاصة: أمطار رعدية",
        event: "Rain",
        severity: "Extreme",
        urgency: "Immediate",
        certainty: "Observed",
        onset: "2026-11-25T08:00:00Z",
        expires: "2026-11-25T22:00:00Z",
        sent: "2026-11-25T07:00:00Z",
        area_desc: "Tindouf",
        cap_url: null,
        wilaya_id: "w-37",
        headline_fr: "Pluies orageuses",
        superseded_at: null,
        msg_type: "Alert",
        cancelled_at: null,
        superseded_by: null,
      },
      {
        id: "onm-severe",
        cap_id: "cap-severe",
        title: "نشرية خاصة: رياح قوية",
        event: "Wind",
        severity: "Severe",
        urgency: "Expected",
        certainty: "Likely",
        onset: "2026-11-25T09:00:00Z",
        expires: "2026-11-25T20:00:00Z",
        sent: "2026-11-25T07:30:00Z",
        area_desc: "Tindouf",
        cap_url: null,
        wilaya_id: "w-37",
        headline_fr: "Vents violents",
        superseded_at: null,
        msg_type: "Alert",
        cancelled_at: null,
        superseded_by: null,
      },
    ],
    officialIncidents: [
      {
        id: "inc-dgpc",
        wilaya_id: "w-37",
        commune_id: "c-3701",
        kind: "flood",
        status: "ongoing",
        precision: "commune",
        authority_tier: "national",
        place_text: "Tindouf",
        first_reported_at: "2026-11-25T09:00:00Z",
        last_reported_at: "2026-11-25T11:30:00Z",
        as_of: "2026-11-25T11:30:00Z",
        updated_at: "2026-11-25T11:30:00Z",
        unlisted_at: null,
        mention_count: 1,
        evidence: "DGPC flood intervention",
        commune: null,
        wilaya: {
          name_ar: "تندوف",
          name_fr: "Tindouf",
          name_en: "Tindouf",
          name_kab: "Tinduf",
          lat: TINDOUF.lat,
          lon: TINDOUF.lon,
        },
        latest_mention: null,
      },
      {
        id: "inc-ita-media",
        wilaya_id: "w-37",
        commune_id: "c-3701",
        kind: "road",
        status: "ongoing",
        precision: "commune",
        authority_tier: "media",
        place_text: "RN50",
        first_reported_at: "2026-11-25T09:30:00Z",
        last_reported_at: "2026-11-25T11:40:00Z",
        as_of: "2026-11-25T11:40:00Z",
        updated_at: "2026-11-25T11:40:00Z",
        unlisted_at: null,
        mention_count: 1,
        evidence: "ITA_MEDIA_MUST_NOT_APPEAR",
        commune: null,
        wilaya: {
          name_ar: "تندوف",
          name_fr: "Tindouf",
          name_en: "Tindouf",
          name_kab: "Tinduf",
          lat: TINDOUF.lat,
          lon: TINDOUF.lon,
        },
        latest_mention: null,
      },
    ],
    probableFires: [
      {
        id: "fire-valid",
        shortId: "F1",
        level: "probable",
        state: "active",
        lat: 27.5439,
        lon: -6.24,
        communeId: "c-3701",
        detectionCount: 4,
        sources: ["firms"],
        firstDetectedAt: "2026-11-25T08:00:00Z",
        lastDetectedAt: "2026-11-25T11:00:00Z",
        confirmedAt: null,
      },
      {
        id: "fire-nan",
        shortId: "F2",
        level: "probable",
        state: "active",
        lat: Number.NaN,
        lon: Number.NaN,
        communeId: "c-3701",
        detectionCount: 2,
        sources: ["firms"],
        firstDetectedAt: "2026-11-25T08:00:00Z",
        lastDetectedAt: "2026-11-25T11:00:00Z",
        confirmedAt: null,
      },
    ],
    heatSignalCount: 1,
    earthquakes: [
      {
        id: "q-1",
        occurred_at: "2026-11-25T10:30:00Z",
        lat: 27.6,
        lon: -8.1,
        depth_km: 12,
        magnitude: 4.4,
        magnitude_type: "ML",
        region: "Tindouf",
        network: "CRAAG",
        commune_id: "c-3701",
        offshore: false,
        distanceKm: 18,
        attribution: "CRAAG",
      },
    ],
    fireDanger: {
      dangerLevel: 3,
      fwi: 22,
      percentile: 78,
      communeId: "c-3701",
      forecastDate: "2026-11-25",
      fuelLimitedCount: 0,
      totalCount: 1,
      allFuelLimited: false,
    },
    airportWeather: [
      {
        station: "DAOF",
        name: "Tindouf Airport",
        lat: 27.7,
        lon: -8.17,
        observed_at: "2026-11-25T11:00:00Z",
        temp_c: 19,
        wind_kt: 11,
        gust_kt: 18,
        visibility_m: 9000,
        weather: null,
        raw: "METAR DAOF",
        distanceKm: 15,
      },
    ],
    ...overrides,
  };
}

function renderWilaya(
  locale: AnyLocale,
  snapshot: WilayaSnapshot,
  explicitLang?: AnyLocale,
) {
  const instance = i18n.cloneInstance({ lng: locale });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <TooltipProvider>
        <WilayaPageView
          snapshot={snapshot}
          explicitLang={explicitLang}
          onRetry={() => undefined}
        />
      </TooltipProvider>
    </I18nextProvider>,
  );
}

describe("WilayaPageView", () => {
  it("localizes ONM CAP severity badges across ar, fr and kab (never raw English Extreme/Severe)", () => {
    const snapshot = makeSnapshot();

    const htmlAr = renderWilaya("ar", snapshot, "ar");
    expect(htmlAr).toContain("قصوى");
    expect(htmlAr).toContain("شديد");
    expect(htmlAr).not.toMatch(/\bExtreme\b/);
    expect(htmlAr).not.toMatch(/\bSevere\b/);

    const htmlFr = renderWilaya("fr", snapshot, "fr");
    expect(htmlFr).toContain("Extrême");
    expect(htmlFr).toContain("Sévère");
    expect(htmlFr).not.toMatch(/\bExtreme\b/);
    expect(htmlFr).not.toMatch(/\bSevere\b/);

    const htmlKab = renderWilaya("kab", snapshot, "kab");
    expect(htmlKab).toContain("Ameqqran aṭas");
    expect(htmlKab).toContain("Aqessḥan");
    expect(htmlKab).not.toMatch(/\bExtreme\b/);
    expect(htmlKab).not.toMatch(/\bSevere\b/);
  });

  it("never renders authority_tier=media under Official incidents and guards non-finite fire coordinates", () => {
    const html = renderWilaya("fr", makeSnapshot(), "fr");
    expect(html).toContain("DGPC flood intervention");
    expect(html).not.toContain("ITA_MEDIA_MUST_NOT_APPEAR");
    expect(html).not.toContain("Info Trafic");
    expect(html).not.toContain("NaN");
  });

  it("never wraps Arabic translated metric phrases in <bdi dir=ltr> while keeping west-longitude coords, ICAO codes and M4.4 isolated", () => {
    const htmlAr = renderWilaya("ar", makeSnapshot(), "ar");
    const ltrBdis = [
      ...htmlAr.matchAll(/<bdi\b[^>]*dir="ltr"[^>]*>([\s\S]*?)<\/bdi>/g),
    ].map((m) => m[1]!);

    expect(ltrBdis.length).toBeGreaterThanOrEqual(4);
    for (const content of ltrBdis) {
      expect(content).not.toMatch(/[\u0600-\u06FF]/);
    }
    expect(ltrBdis.some((c) => c.includes("-6.240"))).toBe(true);
    expect(ltrBdis.some((c) => c === "DAOF")).toBe(true);
    expect(ltrBdis.some((c) => c === "M4.4")).toBe(true);

    // Arabic phrases still render outside <bdi dir="ltr">
    expect(htmlAr).toContain("مؤشر FWI 22");
    expect(htmlAr).toContain("المئين 78");
    expect(htmlAr).toContain("19°م");
    expect(htmlAr).not.toContain("\u2014");
  });

  it("preserves explicit ?lang=kab across /forecast, offline /forecast, commune and neighbor links", () => {
    const onlineHtml = renderWilaya("kab", makeSnapshot(), "kab");
    expect(onlineHtml).toContain('href="/forecast?commune=3701&amp;lang=kab"');
    expect(onlineHtml).toMatch(/href="\/wilaya\/[a-z0-9-]+\?lang=kab"/);

    const offlineHtml = renderWilaya(
      "kab",
      makeSnapshot({ communes: [], dataStatus: "unavailable" }),
      "kab",
    );
    expect(offlineHtml).toContain('href="/forecast?lang=kab"');
  });
});
