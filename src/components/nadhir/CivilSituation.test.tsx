import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Situation } from "@/lib/civil-map";
import type { FireCluster, OfficialIncident, OnmVigilance } from "@/lib/nadhir";
import type { Phase } from "@/lib/incident-lifecycle";
import type { FireLevel } from "@/lib/fire-confidence";
import { SituationCard, SituationDetails } from "./CivilSituation";

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => ({ data: [] }),
    useMutation: () => ({ mutate: () => {}, isPending: false }),
    useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: { status?: string }) =>
      vars?.status ? `${key}(${vars.status})` : key,
    i18n: { language: "fr" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: () => null,
  useLocation: () => "/",
  useNavigate: () => vi.fn(),
}));

const now = Date.parse("2026-09-22T12:00:00Z");
const base = {
  category: "fire" as const,
  at: "2026-09-21T06:00:00Z",
  lat: 36.7,
  lon: 4.0,
  areaId: null,
  wilayaId: null,
  candidate: false,
};
const card = (item: Situation) =>
  renderToStaticMarkup(
    <SituationCard
      item={item}
      units={[]}
      now={now}
      selected={false}
      onSelect={() => {}}
    />,
  );
const satellite = (
  phase: Phase,
  level: FireLevel = "heat_signal",
): Situation => ({
  ...base,
  id: "fire:f",
  source: "satellite",
  phase,
  confidence: "single",
  data: { state: "extinguished" } as FireCluster,
  level,
});
const official = (phase: Phase, status: string): Situation => ({
  ...base,
  id: "official:i",
  source: "official",
  phase,
  confidence: "official",
  data: {
    id: "i",
    kind: "vegetation",
    status,
    authority_tier: "national",
    first_reported_at: "2026-09-21T06:00:00Z",
    last_reported_at: "2026-09-21T06:00:00Z",
    as_of: "2026-09-21T06:00:00Z",
    commune: null,
    wilaya: {
      name_ar: "بجاية",
      name_fr: "Béjaïa",
      name_en: "Bejaia",
      name_kab: null,
    },
  } as unknown as OfficialIncident,
});

describe("situation status wording", () => {
  it("says no new detections for a fire the satellite stopped seeing, never ended", () => {
    const html = card(satellite("archived"));
    expect(html).toContain("civilMap.archived");
    expect(html).not.toContain("civilMap.ended");
  });

  it("says not seen recently while a fire fades", () => {
    expect(card(satellite("fading"))).toContain("civilMap.quiet");
  });

  it("never titles satellite-only evidence a fire", () => {
    expect(card(satellite("live"))).toContain("civilMap.heatSignalShort");
    expect(card(satellite("live", "probable"))).toContain("civilMap.fire");
  });

  it("names a live satellite fire by its confidence level", () => {
    expect(card(satellite("live"))).toContain("civilMap.heatSignal");
    expect(card(satellite("live", "probable"))).toContain("civilMap.probable");
    expect(card(satellite("live", "confirmed"))).toContain("stage.confirmed");
  });

  it("keeps ended for an operator's closure", () => {
    expect(card(satellite("ended"))).toContain("civilMap.ended");
  });

  it("presents an old authority status as the last one known", () => {
    expect(card(official("fading", "ongoing"))).toContain(
      "civilMap.lastKnown(official.statuses.ongoing)",
    );
    expect(card(official("live", "ongoing"))).toContain(
      "official.statuses.ongoing",
    );
    expect(card(official("live", "ongoing"))).not.toContain(
      "civilMap.lastKnown",
    );
  });

  it("renders AlertProvenance on SituationCard without nesting <button> inside <button> and preserves data-situation-id", () => {
    const html = card(satellite("live", "probable"));
    expect(html).toContain('data-situation-id="fire:f"');
    expect(html).toContain("provenance.whySeeing");
    // Ensure no nested <button> exists inside any <button>...</button>
    const buttonOpenCount = (html.match(/<button\b/g) ?? []).length;
    const buttonCloseCount = (html.match(/<\/button>/g) ?? []).length;
    expect(buttonOpenCount).toBe(2);
    expect(buttonCloseCount).toBe(2);
    const firstClose = html.indexOf("</button>");
    const secondOpen = html.indexOf("<button", html.indexOf("<button") + 1);
    expect(firstClose).toBeLessThan(secondOpen);
  });

  it("renders AlertProvenance on SituationDetails across all 7 source types with M<4 seismic honesty", () => {
    const allSeven: Situation[] = [
      satellite("live", "probable"),
      official("live", "ongoing"),
      {
        ...base,
        id: "weather:onm1",
        category: "weather",
        source: "onm",
        phase: "live",
        confidence: "official",
        data: {
          id: "onm1",
          title: "Rain Extreme",
          headline_fr: "Pluies torrentielles",
          severity: "Extreme",
          certainty: "Likely",
          urgency: "Expected",
          sent: "2026-09-22T10:00:00Z",
          onset: null,
          expires: "2026-09-23T10:00:00Z",
          area_desc: "Alger",
          cap_url: null,
        } as unknown as OnmVigilance,
      },
      {
        ...base,
        id: "quake:q-small",
        category: "earthquake",
        source: "seismic",
        phase: "live",
        confidence: "corroborated",
        data: {
          id: "q-small",
          magnitude: 3.2,
          depth_km: 10,
          occurred_at: "2026-09-22T11:00:00Z",
          network: "EMSC",
          region: "NORTHERN ALGERIA",
          commune_id: null,
          offshore: false,
        } as unknown as Extract<Situation, { source: "seismic" }>["data"],
      },
      {
        ...base,
        id: "civil:c1",
        category: "road",
        source: "civil",
        phase: "live",
        confidence: "single",
        data: {
          id: "c1",
          hazard: "road",
          summary: "RN5 coupée",
          source_name: "Info Trafic Algérie",
          source_url: "https://example.com",
          source_published_at: "2026-09-22T09:00:00Z",
          updated_at: "2026-09-22T10:00:00Z",
          expires_at: "2026-09-23T10:00:00Z",
          area: null,
        } as unknown as Extract<Situation, { source: "civil" }>["data"],
      },
      {
        ...base,
        id: "report:r1",
        category: "weather",
        source: "citizen",
        phase: "live",
        confidence: "single",
        data: {
          id: "r1",
          hazard: "flooding",
          summary: "Eau sur chaussée",
          observed_at: "2026-09-22T11:30:00Z",
          witnesses: 2,
          commune_id: null,
        } as unknown as Extract<Situation, { source: "citizen" }>["data"],
      },
      {
        ...base,
        id: "station:DAAG",
        category: "weather",
        source: "station",
        phase: "live",
        confidence: "corroborated",
        data: {
          station: "DAAG",
          name: "Alger",
          visibility_m: 400,
          observed_at: "2026-09-22T11:45:00Z",
        } as unknown as Extract<Situation, { source: "station" }>["data"],
      },
    ];

    for (const item of allSeven) {
      const html = renderToStaticMarkup(
        <SituationDetails item={item} units={[]} now={now} />,
      );
      expect(html, item.id).toContain("provenance.whySeeing");
      expect(html, item.id).not.toContain("\u2014");
    }
  });
});
