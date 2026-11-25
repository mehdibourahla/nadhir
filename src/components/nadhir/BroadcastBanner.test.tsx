import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import * as alertProvenance from "@/lib/alert-provenance";
import { BroadcastBanner } from "./BroadcastBanner";

const rows = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "fr" } }),
}));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));
vi.mock("@/lib/push", () => ({
  readSubscription: () => ({ communes: ["1503"] }),
}));
vi.mock("@tanstack/react-query", () => ({
  queryOptions: (options: unknown) => options,
  useQuery: () => ({ data: rows.data }),
}));

const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString();
const fireRow = (id: string, lastSeenHours: number) => ({
  id,
  kind: "fire",
  phase: "initial",
  severity: "Severe",
  commune_codes: ["1503"],
  cluster_id: id,
  created_at: hoursAgo(10),
  cap_alerts: { info: [{ language: "fr", headline: `Feu ${id}` }] },
  fire_clusters: {
    short_id: id,
    state: "active",
    last_detected_at: hoursAgo(lastSeenHours),
    resolved_at: null,
  },
  onm_vigilance: null,
  authority_warnings: null,
});

beforeEach(() => {
  rows.data = [];
});

it("keeps announcing a fire only while it is live", () => {
  rows.data = [fireRow("LIVE1", 1), fireRow("QUIET", 9)];
  const html = renderToStaticMarkup(<BroadcastBanner />);
  expect(html).toContain("Feu LIVE1");
  expect(html).not.toContain("Feu QUIET");
});

it("drops an ONM relay once the warning's own validity ended", () => {
  rows.data = [
    {
      ...fireRow("x", 1),
      id: "onm",
      kind: "onm",
      cluster_id: null,
      fire_clusters: null,
      onm_vigilance: {
        title: "Pluie",
        headline_fr: "Pluies",
        expires: hoursAgo(1),
      },
    },
  ];
  expect(renderToStaticMarkup(<BroadcastBanner />)).toBe("");
});

it("hides explicitly cancelled or superseded ONM banners and lets official end supersede initial", () => {
  rows.data = [
    {
      ...fireRow("x", 1),
      id: "onm-cancelled",
      kind: "onm",
      cluster_id: null,
      fire_clusters: null,
      onm_vigilance: {
        title: "Pluie",
        headline_fr: "Pluies annulées",
        expires: new Date(Date.now() + 3_600_000).toISOString(),
        msg_type: "Alert",
        cancelled_at: hoursAgo(0.5),
        superseded_by: null,
      },
    },
    {
      ...fireRow("x", 1),
      id: "off-end",
      kind: "official",
      phase: "end",
      cluster_id: null,
      official_incident_id: "inc-99",
      fire_clusters: null,
      cap_alerts: { info: [{ language: "fr-DZ", headline: "Fin inondation" }] },
    },
    {
      ...fireRow("x", 1),
      id: "off-initial",
      kind: "official",
      phase: "initial",
      cluster_id: null,
      official_incident_id: "inc-99",
      fire_clusters: null,
      cap_alerts: {
        info: [{ language: "fr-DZ", headline: "Inondation active" }],
      },
    },
  ];
  expect(renderToStaticMarkup(<BroadcastBanner />)).toBe("");
});

it("renders trigger provenance and hazard-aware labels on live fire, ONM, official flood and earthquake banners", () => {
  rows.data = [
    fireRow("LIVE1", 1),
    {
      ...fireRow("x", 1),
      id: "onm-live",
      kind: "onm",
      severity: "Extreme",
      cluster_id: null,
      fire_clusters: null,
      onm_vigilance: {
        title: "Rain Extreme",
        headline_fr: "Pluies torrentielles sur Tizi Ouzou",
        expires: new Date(Date.now() + 3_600_000).toISOString(),
        sent: hoursAgo(0.5),
        area_desc: "Tizi Ouzou",
      },
    },
    {
      ...fireRow("x", 1),
      id: "off-flood",
      kind: "official",
      hazard: "flood",
      source_key: "dgpc_telegram",
      cluster_id: null,
      official_incident_id: "inc-flood-1",
      fire_clusters: null,
      cap_alerts: {
        info: [
          {
            language: "fr-DZ",
            headline: "Intervention inondation Bab El Oued",
            parameter: [
              { valueName: "hazard_kind", value: "flood" },
              { valueName: "source_key", value: "dgpc_telegram" },
              { valueName: "source_attribution", value: "DGPC" },
              { valueName: "area_label", value: "Bab El Oued" },
            ],
          },
        ],
      },
    },
  ];
  const html = renderToStaticMarkup(<BroadcastBanner />);
  expect(html).toContain("Feu LIVE1");
  expect(html).toContain("Pluies torrentielles sur Tizi Ouzou");
  expect(html).toContain("Intervention inondation Bab El Oued");
  expect(html).toContain("civilMap.sourceOfficial");
  expect(html).toContain("provenance.whySeeing");
  expect(html).not.toContain("\u2014");

  rows.data = [
    {
      ...fireRow("x", 1),
      id: "eq-live",
      kind: "earthquake",
      hazard: "earthquake",
      source_key: "emsc",
      cluster_id: null,
      earthquake_id: "eq-1",
      fire_clusters: null,
      cap_alerts: {
        info: [
          {
            language: "fr-DZ",
            headline: "EMSC : séisme M4.5 près d'Azazga",
            parameter: [
              { valueName: "magnitude", value: "4.5" },
              { valueName: "source_attribution", value: "EMSC" },
            ],
          },
        ],
      },
    },
  ];
  const eqHtml = renderToStaticMarkup(<BroadcastBanner />);
  expect(eqHtml).toContain("civilMap.earthquake");
  expect(eqHtml).toContain("provenance.whySeeing");
  expect(eqHtml).not.toContain("\u2014");
});

it("treats empty or whitespace CAP magnitude parameters as null rather than 0 on earthquake banners", () => {
  const spy = vi.spyOn(alertProvenance, "provenanceForBroadcast");
  try {
    for (const emptyMag of ["", "   "]) {
      spy.mockClear();
      rows.data = [
        {
          ...fireRow("x", 1),
          id: "eq-empty-mag",
          kind: "earthquake",
          severity: "Severe",
          hazard: "earthquake",
          source_key: "emsc",
          cluster_id: null,
          earthquake_id: "eq-empty",
          fire_clusters: null,
          cap_alerts: {
            info: [
              {
                language: "fr-DZ",
                headline: "EMSC : séisme ressenti près d'Azazga",
                parameter: [
                  { valueName: "magnitude", value: emptyMag },
                  { valueName: "source_attribution", value: "EMSC" },
                ],
              },
            ],
          },
        },
      ];
      const html = renderToStaticMarkup(<BroadcastBanner />);
      expect(html, `mag=${JSON.stringify(emptyMag)}`).toContain(
        "provenance.whySeeing",
      );
      expect(spy, `mag=${JSON.stringify(emptyMag)}`).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "earthquake",
          magnitude: null,
        }),
      );
      const returned = spy.mock.results[0]?.value as
        alertProvenance.AlertProvenanceData | undefined;
      expect(returned?.ruleLabelKey, `mag=${JSON.stringify(emptyMag)}`).toBe(
        "provenance.rule.m4Quake",
      );
    }
  } finally {
    spy.mockRestore();
  }
});
