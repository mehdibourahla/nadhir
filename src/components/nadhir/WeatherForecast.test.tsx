import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeatherForecast } from "./WeatherForecast";

const state = vi.hoisted(() => ({
  weather: {} as Record<string, unknown>,
  onm: {} as Record<string, unknown>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/lib/nadhir", () => ({
  adminUnitsQuery: { queryKey: ["units"] },
  unitName: (unit: { name_en: string }) => unit.name_en,
}));
vi.mock("@/lib/weather-onm", () => ({
  weatherOnmQuery: () => ({ queryKey: ["onm"] }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "units")
      return {
        data: [
          {
            id: "commune",
            code: "1701",
            level: "commune",
            name_en: "Djelfa",
            parent_id: "wilaya",
          },
          {
            id: "second-commune",
            code: "1702",
            level: "commune",
            name_en: "Moudjbara",
            parent_id: "wilaya",
          },
        ],
      };
    if (queryKey[0] === "onm")
      return {
        ...state.onm,
        data: state.onm["data"]
          ? {
              warnings: state.onm["data"],
              historyUnavailable: !!state.onm["historyUnavailable"],
            }
          : undefined,
      };
    if (queryKey[0] === "weather") return state.weather;
    throw new Error("Unexpected fire-data dependency");
  },
}));

describe("independent weather evidence", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-15T09:00:00Z"));
    state.onm = { data: [] };
    state.weather = { data: { snapshot: null, stale: false } };
  });
  afterEach(() => vi.restoreAllMocks());

  it("uses the provided commune instead of the default selection", () => {
    const html = renderToStaticMarkup(
      <WeatherForecast communeId="second-commune" />,
    );
    expect(html).toContain("Moudjbara");
    expect(html).not.toContain("Djelfa");
    expect(html).not.toContain("<select");
  });

  it("shows unavailable for an invalid provided commune without a fallback", () => {
    const html = renderToStaticMarkup(<WeatherForecast communeId="missing" />);
    expect(html).toContain("unavailable");
    expect(html).not.toContain("Djelfa");
    expect(html).not.toContain("warningsNone");
  });

  it("offers communes without fire forecasts or ONM availability", () => {
    state.onm = { isError: true };
    const html = renderToStaticMarkup(<WeatherForecast />);
    expect(html).toContain("Djelfa");
    expect(html).toContain("unavailable");
    expect(html).toContain("warningsError");
    expect(html).toContain('id="weather-commune"');
  });

  it("retains the newest official warning while model loading fails", () => {
    state.weather = { isError: true };
    const warning = {
      id: "new",
      cap_id: "new",
      wilaya_id: "wilaya",
      event: "Thunderstorm",
      area_desc: "Djelfa",
      onset: "2026-09-15T10:00:00Z",
      expires: "2026-09-16T10:00:00Z",
      sent: "2026-09-15T09:00:00Z",
      title: "Newest official warning",
    };
    state.onm = {
      historyUnavailable: true,
      data: [
        {
          ...warning,
          id: "old",
          sent: "2026-09-15T08:00:00Z",
          title: "Earlier warning",
        },
        warning,
      ],
    };
    const html = renderToStaticMarkup(<WeatherForecast />);
    expect(html).toContain("Newest official warning");
    expect(html).toContain("Earlier warning");
    expect(html).toContain("earlierBulletins");
    expect(html.indexOf("Newest official warning")).toBeLessThan(
      html.indexOf("Earlier warning"),
    );
    expect(html).toContain("error");
    expect(html).toContain("historyUnavailable");
  });

  it("keeps null values unknown and thunderstorm codes forecast-only", () => {
    state.weather = {
      data: {
        stale: true,
        snapshot: {
          fetchedAt: "2026-09-15T09:00:00Z",
          hours: [95, 96, 99].map((weatherCode, index) => ({
            time: `2026-09-15T${10 + index}:00:00Z`,
            precipitationMm: null,
            rainMm: null,
            probabilityPercent: null,
            weatherCode,
            gustKmh: null,
            cape: null,
          })),
        },
      },
    };
    const html = renderToStaticMarkup(<WeatherForecast />);
    expect(html.match(/>unknown</g)).toHaveLength(14);
    expect(html.match(/>thunderstorm</g)).toHaveLength(3);
    expect(html).toContain("stale");
    expect(html).not.toContain("hail");
  });

  it("withholds the 24-hour rain total if one hour is missing", () => {
    const snapshot = {
      fetchedAt: "2026-09-15T00:00:00Z",
      hours: Array.from({ length: 48 }, (_, index) => ({
        time: new Date(Date.now() + (index + 1) * 3600_000).toISOString(),
        precipitationMm: 2,
        rainMm: index === 4 ? null : 2,
        probabilityPercent: index === 3 ? null : 60,
        weatherCode: 3,
        gustKmh: 10,
        cape: null,
      })),
    };
    state.weather = { data: { stale: false, snapshot } };
    let html = renderToStaticMarkup(<WeatherForecast />);
    expect(html).toMatch(/rainTotal<\/dt><dd[^>]*>unknown<\/dd>/);
    expect(html).toMatch(/peakProbability<\/dt><dd[^>]*>60 %<\/dd>/);
    expect(html).toContain("stale");
    expect(html).toContain("summaryCoverage");
    expect(html).toContain("<details");
    expect(html).not.toContain("cape");
    snapshot.hours[4]!.rainMm = 2;
    html = renderToStaticMarkup(<WeatherForecast />);
    expect(html).toMatch(/rainTotal<\/dt><dd[^>]*>48 mm<\/dd>/);
  });

  it("hides expired warnings and labels future onset as upcoming", () => {
    const warning = {
      id: "future",
      wilaya_id: "wilaya",
      event: "Rain",
      area_desc: "Djelfa",
      onset: "2026-09-15T12:00:00Z",
      expires: "2026-09-16T00:00:00Z",
      sent: "2026-09-15T08:00:00Z",
      title: "Future warning",
    };
    state.onm = {
      data: [
        warning,
        {
          ...warning,
          id: "expired",
          onset: "2026-09-14T12:00:00Z",
          expires: "2026-09-15T08:00:00Z",
          title: "Expired warning",
        },
      ],
    };
    const html = renderToStaticMarkup(<WeatherForecast />);
    expect(html).toContain("Future warning");
    expect(html).toContain(">upcoming<");
    expect(html).not.toContain("Expired warning");
    expect(html).not.toContain(">active<");
  });

  it("drops a warning ONM replaced even before its own expiry", () => {
    state.onm = {
      data: [
        {
          id: "replaced",
          wilaya_id: "wilaya",
          event: "Rain",
          area_desc: "Djelfa",
          onset: "2026-09-15T08:00:00Z",
          expires: "2026-09-15T20:00:00Z",
          sent: "2026-09-15T05:00:00Z",
          superseded_at: "2026-09-15T08:30:00Z",
          title: "Replaced warning",
        },
      ],
    };
    const html = renderToStaticMarkup(<WeatherForecast />);
    expect(html).not.toContain("Replaced warning");
    expect(html).toContain("warningsNone");
  });

  it("never resurfaces cancelled, Cancel-type, or superseded_by warnings alongside an active warning in the same wilaya", () => {
    state.onm = {
      data: [
        {
          id: "active-rain",
          wilaya_id: "wilaya",
          event: "Rain",
          area_desc: "Djelfa",
          onset: "2026-09-15T08:00:00Z",
          expires: "2026-09-15T20:00:00Z",
          sent: "2026-09-15T08:30:00Z",
          title: "Active rain warning",
        },
        {
          id: "cancelled-wind",
          wilaya_id: "wilaya",
          event: "Wind",
          area_desc: "Djelfa",
          onset: "2026-09-15T08:00:00Z",
          expires: "2026-09-15T20:00:00Z",
          sent: "2026-09-15T08:45:00Z",
          cancelled_at: "2026-09-15T08:50:00Z",
          title: "Cancelled extreme wind warning",
        },
        {
          id: "cancel-control",
          wilaya_id: "wilaya",
          event: "Snow",
          area_desc: "Djelfa",
          onset: "2026-09-15T08:00:00Z",
          expires: "2026-09-15T20:00:00Z",
          sent: "2026-09-15T08:55:00Z",
          msg_type: "Cancel",
          title: "Cancel control record",
        },
        {
          id: "superseded-by-other",
          wilaya_id: "wilaya",
          event: "Heat",
          area_desc: "Djelfa",
          onset: "2026-09-15T08:00:00Z",
          expires: "2026-09-15T20:00:00Z",
          sent: "2026-09-15T08:15:00Z",
          superseded_by: "newer-heat-id",
          title: "Superseded heat warning",
        },
      ],
    };
    const html = renderToStaticMarkup(<WeatherForecast />);
    expect(html).toContain("Active rain warning");
    expect(html).not.toContain("Cancelled extreme wind warning");
    expect(html).not.toContain("Cancel control record");
    expect(html).not.toContain("Superseded heat warning");
  });

  it("groups overlapping changed validity transitively while preserving every original", () => {
    const base = {
      wilaya_id: "wilaya",
      event: "Rain",
      area_desc: "Djelfa",
      sent: "2026-09-15T08:00:00Z",
    };
    const bulletin = (
      id: string,
      start: string | null,
      end: string,
      sent = base.sent,
    ) => ({
      ...base,
      id,
      title: id,
      onset: start && `2026-09-15T${start}:00Z`,
      expires: `2026-09-15T${end}:00Z`,
      sent,
    });
    state.onm = {
      data: [
        bulletin("first-original", "08:00", "10:00"),
        bulletin("latest-extension", "11:00", "13:00", "2026-09-15T09:00:00Z"),
        bulletin("bridge-original", "09:30", "11:30"),
        bulletin("separate-period", "13:00", "15:00"),
        bulletin("unknown-period", null, "15:00"),
        { ...bulletin("different-event", "09:00", "12:00"), event: "Wind" },
      ],
    };
    const html = renderToStaticMarkup(<WeatherForecast />);
    expect(html.match(/earlierBulletins/g)).toHaveLength(1);
    expect(html).toContain("earlierBulletins (2)");
    for (const title of [
      "first-original",
      "bridge-original",
      "separate-period",
      "unknown-period",
      "different-event",
    ])
      expect(html).toContain(title);
    expect(html.indexOf("latest-extension")).toBeLessThan(
      html.indexOf("first-original"),
    );
    const earlier = html.slice(
      html.indexOf("earlierBulletins"),
      html.indexOf("</details>"),
    );
    expect(earlier).toContain("first-original");
    expect(earlier).toContain("bridge-original");
    expect(earlier).not.toContain("separate-period");
    expect(earlier).not.toContain("unknown-period");
    expect(earlier).not.toContain("different-event");
  });

  it.each([
    [
      "2026-09-15T09:15:00Z",
      "2026-09-15T10:30:00Z",
      [10, 11],
      "comparisonFull",
    ],
    [
      "2026-09-15T08:30:00Z",
      "2026-09-15T10:30:00Z",
      [10, 11],
      "comparisonPartial",
    ],
    [
      "2026-09-15T11:00:00Z",
      "2026-09-15T12:00:00Z",
      [10, 11],
      "comparisonNoOverlap",
    ],
    [
      "2026-09-15T09:00:00Z",
      "2026-09-15T12:00:00Z",
      [10, 12],
      "comparisonPartial",
    ],
    [null, "2026-09-15T12:00:00Z", [10, 11], "comparisonUnknownValidity"],
  ])(
    "compares preceding-hour intervals for warning %s to %s",
    (onset, expires, endpoints, expected) => {
      state.onm = {
        data: [
          {
            id: "warning",
            wilaya_id: "wilaya",
            event: "Rain",
            area_desc: "Djelfa",
            onset,
            expires,
            sent: "2026-09-15T08:00:00Z",
            title: "Retained ONM warning",
          },
        ],
      };
      const snapshot = {
        fetchedAt: "2026-09-15T09:00:00Z",
        hours: endpoints.map((hour) => ({
          time: `2026-09-15T${hour}:00:00Z`,
          precipitationMm: 0,
          rainMm: 0,
          probabilityPercent: 0,
          weatherCode: 0,
          gustKmh: 0,
          cape: null,
        })),
      };
      state.weather = { data: { stale: false, snapshot } };
      let html = renderToStaticMarkup(<WeatherForecast />);
      expect(html).toContain(`>${expected}<`);
      expect(html).toContain("Retained ONM warning");
      expect(html).toContain("comparisonScope");
      state.weather = { data: { stale: true, snapshot } };
      html = renderToStaticMarkup(<WeatherForecast />);
      expect(html).toContain(">comparisonStale<");
      expect(html).toContain("Retained ONM warning");
      state.weather = { isError: true };
      html = renderToStaticMarkup(<WeatherForecast />);
      expect(html).toContain(">comparisonMissing<");
      expect(html).toContain("Retained ONM warning");
    },
  );
});
