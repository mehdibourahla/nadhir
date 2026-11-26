import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { OutlookGrid } from "@/components/forecast/OutlookGrid";
import i18n from "@/i18n";

const DAYS = ["2026-09-25", "2026-09-26", "2026-09-27"];

function renderGrid(
  locale: "ar" | "fr" | "en" | "kab",
  props: Parameters<typeof OutlookGrid>[0],
) {
  const instance = i18n.cloneInstance({ lng: locale });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <OutlookGrid {...props} />
    </I18nextProvider>,
  );
}

describe("OutlookGrid", () => {
  it("keeps the other rows when one source fails", () => {
    const tWeatherEn = i18n.getFixedT("en", "weather");
    const html = renderGrid("en", {
      days: DAYS,
      place: "Batna",
      onm: {
        status: "ok",
        cells: [
          { state: "warning", level: 3, events: ["storm"] },
          { state: "none" },
          { state: "not_issued" },
        ],
      },
      fire: { status: "error", retry: () => undefined },
      weather: { status: "ok", cells: [null, null, null] },
      air: { status: "loading" },
    });
    expect(html).toContain(tWeatherEn("outlook.onmLevel.3"));
    expect(html).toContain(tWeatherEn("outlook.event.storm"));
    expect(html).toContain(tWeatherEn("outlook.onmNone"));
    expect(html).toContain(tWeatherEn("outlook.onmNotIssued"));
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain(tWeatherEn("outlook.rowError"));
    expect(html).toContain(tWeatherEn("outlook.notPublished"));
    expect(html).toContain('colSpan="3"');
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain("\u2014");
  });

  it("renders winter ONM events, R-06 icons+numerals on ONM/Air, and never wraps translated Arabic phrases in <bdi dir=ltr>", () => {
    const tAr = i18n.getFixedT("ar");
    const tWeatherAr = i18n.getFixedT("ar", "weather");
    const html = renderGrid("ar", {
      days: DAYS,
      place: "تيزي وزو",
      onm: {
        status: "ok",
        cells: [
          { state: "warning", level: 4, events: ["snow", "flood"] },
          { state: "none" },
          { state: "not_issued" },
        ],
      },
      fire: { status: "ok", cells: [null, null, null] },
      weather: {
        status: "ok",
        cells: [{ tempC: 4, windKmh: 45, rainMm: 12.4 }, null, null],
      },
      air: {
        status: "ok",
        cells: [
          {
            state: "ok",
            level: "high",
            pollutant: "pm10",
            pm25: 12,
            pm10: 95,
          },
          { state: "beyond" },
          { state: "beyond" },
        ],
      },
    });

    expect(html).toContain(tAr("track3.forecast.onmEvent.snow"));
    expect(html).toContain(tAr("track3.forecast.onmEvent.flood"));
    expect(html).toContain(tWeatherAr("outlook.airLevel.high"));
    expect(html).toContain(tWeatherAr("outlook.weatherWind", { wind: 45 }));
    expect(html).toContain(tWeatherAr("outlook.weatherRain", { rain: 12.4 }));
    expect(html).toContain("<svg");
    expect(html).not.toContain("\u2014");

    const ltrBdis = [
      ...html.matchAll(/<bdi\b[^>]*dir="ltr"[^>]*>([\s\S]*?)<\/bdi>/g),
    ];
    for (const match of ltrBdis) {
      expect(match[1]).not.toMatch(/[\u0600-\u06FF]/);
    }
    expect(ltrBdis).toHaveLength(0);
  });
});
