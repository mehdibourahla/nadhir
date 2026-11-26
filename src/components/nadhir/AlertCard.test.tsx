import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ Link: () => null }));

import { TooltipProvider } from "@/components/ui/tooltip";
import i18n, { type AnyLocale } from "@/i18n";
import type { AlertGroup } from "@/lib/alert-groups";
import {
  provenanceForWatchZoneAlert,
  toProvenancePayload,
} from "@/lib/alert-provenance";
import type { Alert } from "@/lib/alerts";
import { AlertCard } from "./AlertCard";

const FIXED_NOW = Date.parse("2026-11-25T12:00:00Z");

function makeGroup(alert: Alert): AlertGroup {
  return {
    key: alert.id,
    latest: alert,
    messages: [alert],
    unread: alert.read_at ? 0 : 1,
  };
}

function renderCard(
  locale: AnyLocale,
  alert: Alert,
  zoneName = "Azazga",
  zoneRadiusKm: number | null = 15,
) {
  const instance = i18n.cloneInstance({ lng: locale });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <TooltipProvider>
        <ul>
          <AlertCard
            group={makeGroup(alert)}
            phase="live"
            locale={locale}
            zoneName={zoneName}
            zoneRadiusKm={zoneRadiusKm}
            now={FIXED_NOW}
            onToggleRead={() => {}}
            onDelete={() => {}}
          />
        </ul>
      </TooltipProvider>
    </I18nextProvider>,
  );
}

describe("AlertCard provenance rendering (SSR)", () => {
  const enrichedAlert: Alert = {
    id: "alert-enriched-1",
    zone_id: "z-1",
    kind: "weather",
    severity: 4,
    cluster_id: null,
    commune_id: "c-1",
    source_table: "onm_vigilance",
    source_id: "onm-1",
    title: "ONM warning for Azazga",
    body: "ONM: Pluies torrentielles",
    distance_km: null,
    payload: {
      onm_severity: "Extreme",
      map_event: "weather:onm-1",
      ...toProvenancePayload(
        provenanceForWatchZoneAlert({
          kind: "weather",
          sourceTable: "onm_vigilance",
          severity: "Extreme",
          areaLabel: "Azazga",
          radiusKm: 15,
          observedAt: "2026-11-25T11:30:00Z",
        }),
      ),
    },
    read_at: null,
    created_at: "2026-11-25T11:35:00Z",
  };

  const legacyAlert: Alert = {
    id: "alert-legacy-1",
    zone_id: "z-1",
    kind: "official",
    severity: 4,
    cluster_id: null,
    commune_id: "c-1",
    source_table: "official_incidents",
    source_id: "inc-1",
    title: "Protection Civile report for Azazga",
    body: "Flooding reported in Azazga",
    distance_km: null,
    payload: {
      hazard: "flood",
      map_event: "official:inc-1",
    },
    read_at: null,
    created_at: "2026-11-25T11:00:00Z",
  };

  it("renders AlertProvenance on provenance-enriched alert cards across ar, fr, en and kab", () => {
    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      const html = renderCard(locale, enrichedAlert);
      expect(html, locale).toContain(t("provenance.whySeeing"));
      expect(html, locale).toContain("ONM · Météo Algérie");
      expect(html, locale).toContain(t("provenance.trigger.watch_zone"));
      expect(html, locale).toContain("min-h-11");
      expect(html, locale).not.toContain("\u2014");
    }
  });

  it("renders honest fallback AlertProvenance for legacy pre-M2B alert rows without provenance_* keys", () => {
    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      const html = renderCard(locale, legacyAlert);
      expect(html, locale).toContain(t("provenance.whySeeing"));
      expect(html, locale).toContain("DGPC");
      expect(html, locale).toContain(t("provenance.trigger.watch_zone"));
      expect(html, locale).not.toContain("\u2014");
    }
  });

  it("preserves full contrast on read cards (no opacity-70), shows severity name, Algiers clock time, dir=auto title, and >=44px action targets", () => {
    const readAlert: Alert = {
      ...enrichedAlert,
      id: "alert-read-1",
      read_at: "2026-11-25T11:45:00Z",
    };
    const html = renderCard("ar", readAlert);
    expect(html).not.toContain("opacity-70");
    expect(html).toContain('dir="auto"');
    expect(html).toContain("12:35"); // 11:35Z in Africa/Algiers (UTC+1)
    expect(html).toContain("min-h-11");
    expect(html).toContain("ONM · Météo Algérie");
    expect(html).not.toContain("\u2014");
  });
});
