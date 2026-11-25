import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "fr" } }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
    className?: string;
    "aria-label"?: string;
  }) => (
    <a
      href={params?.["slug"] ? to.replace("$slug", params["slug"]) : to}
      {...rest}
    >
      {children}
    </a>
  ),
}));

import { NationalOutlook } from "@/components/forecast/NationalOutlook";
import type { WilayaOutlook } from "@/lib/forecast-outlook";

const SAMPLE_ROW: WilayaOutlook = {
  wilaya: {
    id: "w-16",
    level: "wilaya",
    code: "16",
    name_ar: "الجزائر",
    name_fr: "Alger",
    name_en: "Algiers",
    name_kab: "Dzayer",
    parent_id: null,
    lat: 36.7,
    lon: 3.03,
    forest_fraction: 0.1,
    population: 3000000,
  },
  level: 4,
  weather: { level: 3, events: ["snow"] },
  fire: null,
  incidents: 2,
  quake: { magnitude: 4.5 },
  targetCommuneId: "c-1601",
};

describe("NationalOutlook", () => {
  it("renders sibling /wilaya/$slug link outside button and shows multi-hazard summary", () => {
    const html = renderToStaticMarkup(
      <NationalOutlook
        rows={[SAMPLE_ROW]}
        loading={false}
        failed={false}
        onRetry={() => undefined}
        onPick={() => undefined}
      />,
    );

    expect(html).toContain('href="/wilaya/alger"');
    expect(html).toContain("translation:track3.forecast.onmEvent.snow");
    expect(html).toContain("translation:track3.forecast.nationalIncidents");
    expect(html).toContain("translation:track3.forecast.nationalQuake");
    // Ensure link is NEVER nested inside <button>
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<a\b/);
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("\u2014");
    expect(html.toLowerCase()).not.toMatch(/\bsafe\b/);
  });
});
