import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import i18n, { type AnyLocale } from "@/i18n";
import {
  MapWorkspacePanel,
  SHEET_DETENTS,
  nextCycleDetent,
  resolveDragDetent,
  resolveKeyDetent,
  stepSheetDetent,
  type SheetDetent,
} from "./MapWorkspacePanel";

function renderPanel(locale: AnyLocale, detent: SheetDetent) {
  const instance = i18n.cloneInstance({ lng: locale });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <MapWorkspacePanel
        detent={detent}
        onDetentChange={() => {}}
        header={<div data-slot="header">Header</div>}
        filterBar={<div data-slot="filters">Filters</div>}
      >
        <div data-slot="body">List body</div>
      </MapWorkspacePanel>
    </I18nextProvider>,
  );
}

describe("MapWorkspacePanel 3-detent sheet", () => {
  it("supports all 3 detents (peek, half, full) with data-detent, aria-expanded, >=44px controls and reduced-motion rules", () => {
    expect(SHEET_DETENTS).toEqual(["peek", "half", "full"]);

    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      for (const detent of SHEET_DETENTS) {
        const html = renderPanel(locale, detent);
        expect(html, `${locale}/${detent}`).toContain(
          `data-detent="${detent}"`,
        );
        expect(html, `${locale}/${detent}`).toContain(
          `aria-expanded="${detent !== "peek"}"`,
        );
        expect(html, `${locale}/${detent}`).toContain('data-slot="header"');
        expect(html, `${locale}/${detent}`).toContain('data-slot="filters"');
        expect(html, `${locale}/${detent}`).toContain("min-h-11");
        expect(html, `${locale}/${detent}`).toContain("prefers-reduced-motion");
        expect(html, `${locale}/${detent}`).toContain(
          `data-detent-trigger="${detent}"`,
        );
        expect(html, `${locale}/${detent}`).toContain(
          t(`track3.sheet.${detent}`),
        );
        expect(html, `${locale}/${detent}`).not.toContain("\u2014");
      }
    }
  });

  it("hides mobile list body only in peek while keeping header and filter bar visible", () => {
    const peekHtml = renderPanel("en", "peek");
    const halfHtml = renderPanel("en", "half");
    const fullHtml = renderPanel("en", "full");
    expect(peekHtml).toContain(
      "map-workspace-body min-h-0 flex-1 flex-col hidden lg:flex",
    );
    expect(halfHtml).toContain(
      "map-workspace-body min-h-0 flex-1 flex-col flex",
    );
    expect(fullHtml).toContain(
      "map-workspace-body min-h-0 flex-1 flex-col flex",
    );
  });

  it("steps, cycles, snaps drag gestures, and handles keyboard controls accurately", () => {
    expect(stepSheetDetent("peek", 1)).toBe("half");
    expect(stepSheetDetent("half", 1)).toBe("full");
    expect(stepSheetDetent("full", 1)).toBe("full");
    expect(stepSheetDetent("full", -1)).toBe("half");
    expect(stepSheetDetent("half", -1)).toBe("peek");
    expect(stepSheetDetent("peek", -1)).toBe("peek");

    expect(nextCycleDetent("peek")).toBe("half");
    expect(nextCycleDetent("half")).toBe("full");
    expect(nextCycleDetent("full")).toBe("peek");

    // Swipe gestures
    expect(resolveDragDetent("peek", -200, -0.5)).toBe("full");
    expect(resolveDragDetent("full", 200, 0.5)).toBe("peek");
    expect(resolveDragDetent("peek", -50, -0.2)).toBe("half");
    expect(resolveDragDetent("half", 50, 0.2)).toBe("peek");
    expect(resolveDragDetent("peek", -10, -0.45)).toBe("half");
    expect(resolveDragDetent("peek", -8, -0.05)).toBeNull();

    // Keyboard navigation
    expect(resolveKeyDetent("peek", "ArrowUp")).toBe("half");
    expect(resolveKeyDetent("half", "ArrowUp")).toBe("full");
    expect(resolveKeyDetent("full", "ArrowDown")).toBe("half");
    expect(resolveKeyDetent("peek", "Home")).toBe("full");
    expect(resolveKeyDetent("full", "End")).toBe("peek");
    expect(resolveKeyDetent("half", "Escape")).toBe("peek");
    expect(resolveKeyDetent("peek", "Escape")).toBeNull();
    expect(resolveKeyDetent("half", "Tab")).toBeNull();
  });
});
