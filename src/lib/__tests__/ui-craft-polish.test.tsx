import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  useLocation: () => ({ pathname: "/", href: "/", searchStr: "" }),
  useNavigate: () => vi.fn(),
  useLoaderData: () => undefined,
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
  useSearch: () => ({}),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => ({ data: null }),
    useQueryClient: () => ({}),
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { AccountMenu } from "@/components/AccountMenu";
import { WilayaPageView } from "@/components/forecast/WilayaPageView";
import { AlertCard } from "@/components/nadhir/AlertCard";
import { OemBatteryGuide } from "@/components/nadhir/OemBatteryGuide";
import { StandingGuidanceCard } from "@/components/survival/StandingGuidanceCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import i18n, { type AnyLocale } from "@/i18n";
import type { Alert } from "@/lib/alerts";
import { algiersTime } from "@/lib/nadhir";
import type { WilayaSnapshot } from "@/lib/wilaya-data";
import { applyFrenchElision, wilayaBySlug } from "@/lib/wilaya-slugs";

const ROOT = process.cwd();

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "alert-rtl-1",
    zone_id: "z-1",
    kind: "weather",
    severity: 4,
    cluster_id: null,
    commune_id: "c-1601",
    source_table: "onm_vigilance",
    source_id: "onm-1",
    title: "BMS Pluies torrentielles sur Alger",
    body: "Cumuls estimés entre 40 et 60 mm selon ONM.",
    distance_km: null,
    payload: {
      onm_severity: "Extreme",
      map_event: "weather:onm-1",
    },
    read_at: null,
    created_at: "2026-11-25T18:35:00Z",
    ...overrides,
  };
}

function renderAlertCard(locale: AnyLocale, alert: Alert): string {
  const instance = i18n.cloneInstance({ lng: locale });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <TooltipProvider>
        <ul>
          <AlertCard
            group={{
              key: alert.id,
              latest: alert,
              messages: [alert],
              unread: alert.read_at ? 0 : 1,
            }}
            phase="live"
            locale={locale}
            zoneName="Alger"
            zoneRadiusKm={15}
            now={Date.parse("2026-11-25T19:00:00Z")}
            onToggleRead={() => {}}
            onDelete={() => {}}
          />
        </ul>
      </TooltipProvider>
    </I18nextProvider>,
  );
}

describe("M6.4 UI/Craft visual polish & RTL/BiDi guarantees", () => {
  it("formats algiersTime() strictly in 24-hour Africa/Algiers time with zero AM/PM", () => {
    const evening = algiersTime("2026-11-25T18:35:00Z");
    expect(evening).toContain("25/11");
    expect(evening).toContain("19:35");
    expect(evening).not.toMatch(/\b(?:AM|PM)\b/i);

    const midnight = algiersTime("2026-11-25T23:15:00Z");
    expect(midnight).toContain("26/11");
    expect(midnight).toContain("00:15");
    expect(midnight).not.toContain("24:15");
    expect(midnight).not.toMatch(/\b(?:AM|PM)\b/i);

    const morning = algiersTime("2026-11-25T07:05:00Z");
    expect(morning).toContain("25/11");
    expect(morning).toContain("08:05");
    expect(morning).not.toMatch(/\b(?:AM|PM)\b/i);
  });

  it("keeps Arabic RTL AlertCard block alignment on text-start via <bdi dir=auto> and isolates 24h timestamp in <bdi dir=ltr>", () => {
    const html = renderAlertCard("ar", makeAlert());

    // Block <h2> and body <p> must NOT carry dir="auto" directly (prevents left-edge zig-zag in RTL)
    expect(html).not.toMatch(/<h2\b[^>]*\bdir="auto"/);
    expect(html).not.toMatch(/<p\b[^>]*\bdir="auto"/);

    // Inline <bdi dir="auto"> isolates mixed Latin/Arabic text inside aligned blocks
    expect(html).toContain(
      '<bdi dir="auto">BMS Pluies torrentielles sur Alger</bdi>',
    );
    expect(html).toContain(
      '<bdi dir="auto">Cumuls estimés entre 40 et 60 mm selon ONM.</bdi>',
    );

    // 24-hour timestamp wrapped in <bdi dir="ltr"> without AM/PM
    expect(html).toMatch(/<bdi dir="ltr">[^<]*25\/11[^<]*19:35<\/bdi>/);
    expect(html).not.toMatch(/\b(?:AM|PM)\b/i);
  });

  it("avoids Flame icon on severity-4 non-fire weather alerts while retaining it for fire alerts", () => {
    const weatherHtml = renderAlertCard("fr", makeAlert({ kind: "weather" }));
    expect(weatherHtml).not.toContain("lucide-flame");
    expect(weatherHtml).toContain("lucide-shield-alert");

    const fireHtml = renderAlertCard("fr", makeAlert({ kind: "fire" }));
    expect(fireHtml).toContain("lucide-flame");
  });

  it("wraps StandingGuidanceCard hazard pills cleanly and places the 'below' notice above the numbered steps", () => {
    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const instance = i18n.cloneInstance({ lng: locale });
      const html = renderToStaticMarkup(
        <I18nextProvider i18n={instance}>
          <StandingGuidanceCard
            hazard="general"
            online={true}
            onSelectHazard={() => {}}
          />
        </I18nextProvider>,
      );
      expect(html, locale).toContain("flex-wrap");
      expect(html, locale).not.toContain("overflow-x-auto");

      const notice = instance.t("track3.emergency.noInstructionNotice");
      const escapedNotice = notice
        .replace(/&/g, "&amp;")
        .replace(/'/g, "&#x27;");
      const noticeIdx = html.indexOf(escapedNotice);
      const olIdx = html.indexOf("<ol");
      expect(noticeIdx, locale).toBeGreaterThan(-1);
      expect(olIdx, locale).toBeGreaterThan(noticeIdx);
    }
  });

  it("stacks WilayaPageView hero header on mobile, isolates 24h timestamp in <bdi dir=ltr>, and applies French elision for Alger", () => {
    const alger = wilayaBySlug("alger")!;
    const snapshot: WilayaSnapshot = {
      wilaya: alger,
      dataStatus: "ok",
      fetchedAt: "2026-11-25T18:35:00Z",
      communes: [],
      onmWarnings: [],
      officialIncidents: [],
      probableFires: [],
      heatSignalCount: 0,
      earthquakes: [],
      fireDanger: null,
      airportWeather: [],
    };

    const instanceFr = i18n.cloneInstance({ lng: "fr" });
    const htmlFr = renderToStaticMarkup(
      <I18nextProvider i18n={instanceFr}>
        <TooltipProvider>
          <WilayaPageView
            snapshot={snapshot}
            explicitLang="fr"
            onRetry={() => undefined}
          />
        </TooltipProvider>
      </I18nextProvider>,
    );
    expect(htmlFr).toContain("flex-col gap-4 sm:flex-row");
    expect(htmlFr).toContain("Wilaya d&#x27;Alger");
    expect(htmlFr).not.toContain("Wilaya de Alger");
    expect(htmlFr).toMatch(
      /<bdi dir="ltr" class="tabular-nums">[^<]*25\/11[^<]*19:35<\/bdi>/,
    );
    expect(htmlFr).not.toMatch(/\b(?:AM|PM)\b/i);

    expect(applyFrenchElision("Wilaya de Alger")).toBe("Wilaya d'Alger");
    expect(applyFrenchElision("Wilaya de Oran")).toBe("Wilaya d'Oran");
    expect(applyFrenchElision("Wilaya de Tindouf")).toBe("Wilaya de Tindouf");
  });

  it("renders signed-out AccountMenu CTA without max-w-[74px] clipping and OemBatteryGuide with stacked subtitle layout", () => {
    const instanceFr = i18n.cloneInstance({ lng: "fr" });
    const menuHtml = renderToStaticMarkup(
      <I18nextProvider i18n={instanceFr}>
        <AccountMenu user={null} hasPanelAccess={false} />
      </I18nextProvider>,
    );
    expect(menuHtml).toContain("min-h-11");
    expect(menuHtml).toContain("min-w-11");
    expect(menuHtml).toContain("whitespace-nowrap");
    expect(menuHtml).not.toContain("max-w-[74px]");

    const guideHtml = renderToStaticMarkup(
      <I18nextProvider i18n={instanceFr}>
        <OemBatteryGuide />
      </I18nextProvider>,
    );
    expect(guideHtml).toContain("flex-col");
    expect(guideHtml).toContain("min-h-11");
  });

  it("handles French alerts.unread singular/plural cleanly and preserves 4-locale parity", () => {
    const tFr = i18n.getFixedT("fr");
    expect(tFr("alerts.unread", { count: 1 })).toBe("1 non lue");
    expect(tFr("alerts.unread", { count: 3 })).toBe("3 non lues");

    const tAr = i18n.getFixedT("ar");
    expect(tAr("alerts.unread", { count: 1 })).toBe("1 غير مقروءة");
    expect(tAr("alerts.unread", { count: 3 })).toBe("3 غير مقروءة");
  });

  it("enforces layout/RTL/BiDi structural guards across home, survival, header, map, privacy, and security components", () => {
    const home = readSource("src/routes/index.tsx");
    expect(home).toContain("lg:flex-col");
    expect(home).toContain("sm:hidden");

    const survival = readSource("src/routes/survival/index.tsx");
    expect(survival).toContain('className="flex flex-wrap items-center gap-2"');
    expect(survival).not.toContain(
      "map-scroll flex items-center gap-2 overflow-x-auto",
    );

    const chrome = readSource("src/components/SiteChrome.tsx");
    expect(chrome).toContain('<ThemeToggle className="hidden sm:flex" />');
    expect(chrome).toContain("<ThemeToggle showLabel />");

    const fireMap = readSource("src/components/FireMap.tsx");
    expect(fireMap).toContain(
      '[dir="rtl"] .civil-map-page .maplibregl-ctrl-bottom-right',
    );
    expect(fireMap).toContain("right: auto; left: 0;");

    const privacy = readSource("src/routes/privacy.tsx");
    const privacyControls = readSource(
      "src/components/nadhir/PrivacyControls.tsx",
    );
    expect(privacy).toContain('<bdi dir="ltr" className="tabular-nums">');
    expect(privacyControls).toContain(
      '<bdi dir="ltr" className="tabular-nums">',
    );

    const accountSecurity = readSource("src/components/AccountSecurity.tsx");
    expect(accountSecurity).toContain("break-words");
    expect(accountSecurity).not.toContain("break-all");
  });
});
