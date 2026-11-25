import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { ForecastHazardContext } from "@/components/forecast/ForecastHazardContext";
import i18n from "@/i18n";
import type { AirportWeather } from "@/lib/airport-weather";
import type { Earthquake } from "@/lib/earthquakes";
import type { AdminUnit, OfficialIncident } from "@/lib/nadhir";

const COMMUNE: AdminUnit = {
  id: "c-1601",
  level: "commune",
  code: "1601",
  name_ar: "الجزائر الوسطى",
  name_fr: "Alger Centre",
  name_en: "Algiers Centre",
  name_kab: "Dzayer",
  parent_id: "w-16",
  lat: 36.75,
  lon: 3.05,
  forest_fraction: 0.05,
  population: 100000,
};

describe("ForecastHazardContext", () => {
  it("excludes authority_tier=media from Official incidents and never wraps Arabic station phrases in <bdi dir=ltr>", () => {
    const nowIso = new Date().toISOString();
    const incidents: OfficialIncident[] = [
      {
        id: "inc-dgpc",
        wilaya_id: "w-16",
        commune_id: "c-1601",
        kind: "flood",
        status: "ongoing",
        precision: "commune",
        authority_tier: "national",
        place_text: "Bab El Oued",
        first_reported_at: nowIso,
        last_reported_at: nowIso,
        as_of: nowIso,
        updated_at: nowIso,
        unlisted_at: null,
        mention_count: 1,
        evidence: "DGPC flood response",
        commune: null,
        wilaya: {
          name_ar: "الجزائر",
          name_fr: "Alger",
          name_en: "Algiers",
          name_kab: "Dzayer",
          lat: 36.75,
          lon: 3.05,
        },
        latest_mention: null,
      },
      {
        id: "inc-media",
        wilaya_id: "w-16",
        commune_id: "c-1601",
        kind: "road",
        status: "ongoing",
        precision: "commune",
        authority_tier: "media",
        place_text: "RN5_MEDIA_ONLY",
        first_reported_at: nowIso,
        last_reported_at: nowIso,
        as_of: nowIso,
        updated_at: nowIso,
        unlisted_at: null,
        mention_count: 1,
        evidence: "Info Trafic post",
        commune: null,
        wilaya: {
          name_ar: "الجزائر",
          name_fr: "Alger",
          name_en: "Algiers",
          name_kab: "Dzayer",
          lat: 36.75,
          lon: 3.05,
        },
        latest_mention: null,
      },
    ];

    const quakes: Earthquake[] = [
      {
        id: "q-1",
        occurred_at: nowIso,
        lat: 36.75,
        lon: 3.05,
        depth_km: 10,
        magnitude: 4.2,
        magnitude_type: "ML",
        region: "Algiers",
        network: "CRAAG",
        commune_id: "c-1601",
        offshore: false,
      },
    ];

    const stations: AirportWeather[] = [
      {
        station: "DAAG",
        name: "Houari Boumediene",
        lat: 36.691,
        lon: 3.215,
        observed_at: nowIso,
        temp_c: 19,
        wind_kt: 11,
        gust_kt: 18,
        visibility_m: 9000,
        weather: null,
        raw: "METAR DAAG",
      },
    ];

    const instance = i18n.cloneInstance({ lng: "ar" });
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={instance}>
        <ForecastHazardContext
          place="الجزائر الوسطى"
          selected={COMMUNE}
          incidents={{
            data: incidents,
            isPending: false,
            isError: false,
            refetch: () => undefined,
          }}
          earthquakes={{
            data: quakes,
            isPending: false,
            isError: false,
            refetch: () => undefined,
          }}
          airportWeather={{
            data: stations,
            isPending: false,
            isError: false,
            refetch: () => undefined,
          }}
        />
      </I18nextProvider>,
    );

    expect(html).toContain("Bab El Oued");
    expect(html).not.toContain("RN5_MEDIA_ONLY");
    expect(html).not.toContain("Info Trafic");

    const ltrBdis = [
      ...html.matchAll(/<bdi\b[^>]*dir="ltr"[^>]*>([\s\S]*?)<\/bdi>/g),
    ].map((m) => m[1]!);
    expect(ltrBdis).toContain("DAAG");
    expect(ltrBdis).toContain("M4.2");
    for (const content of ltrBdis) {
      expect(content).not.toMatch(/[\u0600-\u06FF]/);
    }

    expect(html).toContain("19°م");
    expect(html).toContain("الرؤية 9 كلم");
    expect(html).not.toContain("\u2014");
  });
});
