import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import i18n, { type AnyLocale } from "@/i18n";
import {
  SHEET_DETENTS,
  handleSheetHandleClick,
  handleSheetPointerCancel,
  handleSheetPointerDown,
  handleSheetPointerUp,
  nextCycleDetent,
  resolveDragDetent,
  resolveKeyDetent,
  stepSheetDetent,
  type SheetDetent,
  type SheetDragState,
} from "@/lib/sheet-detent";
import { MapWorkspacePanel } from "./MapWorkspacePanel";

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
        expect(html, `${locale}/${detent}`).toContain("min-w-11");
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
    expect(resolveDragDetent("peek", -16, -0.45)).toBe("half");
    expect(resolveDragDetent("peek", -8, -0.05)).toBeNull();
    // Sub-12px fast-tap micro-jitter must never trigger a velocity flick
    expect(resolveDragDetent("peek", 1, 1.0)).toBeNull();
    expect(resolveDragDetent("peek", -10, -0.45)).toBeNull();
    expect(resolveDragDetent("peek", Number.NaN, 1.0)).toBeNull();

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

  it("ignores non-primary mouse buttons, catches setPointerCapture errors, tracks pointerId, and never swallows 1px fast-tap clicks", () => {
    const onDetentChange = vi.fn();
    const setPointerCapture = vi.fn(() => {
      throw new DOMException(
        "No active pointer with the given id is found.",
        "NotFoundError",
      );
    });
    const releasePointerCapture = vi.fn(() => {
      throw new DOMException(
        "No active pointer with the given id is found.",
        "NotFoundError",
      );
    });
    const target = { setPointerCapture, releasePointerCapture };

    // 1. Right-click (button: 2) is ignored completely
    const state: SheetDragState = { start: null, dragged: false };
    handleSheetPointerDown(state, {
      pointerType: "mouse",
      button: 2,
      clientY: 500,
      pointerId: 1,
      currentTarget: target,
    });
    expect(state.start).toBeNull();
    expect(setPointerCapture).not.toHaveBeenCalled();

    // 2. 1px fast-tap micro-jitter catches NotFoundError and still cycles on click
    let clock = 1000;
    expect(() =>
      handleSheetPointerDown(
        state,
        {
          pointerType: "touch",
          button: 0,
          clientY: 500,
          pointerId: 7,
          currentTarget: target,
        },
        () => clock,
      ),
    ).not.toThrow();
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    // Mismatched pointerId is ignored
    handleSheetPointerUp(
      state,
      "peek",
      {
        pointerType: "touch",
        button: 0,
        clientY: 300,
        pointerId: 99,
        currentTarget: target,
      },
      onDetentChange,
      () => clock + 5,
    );
    expect(state.start?.pointerId).toBe(7);
    expect(onDetentChange).not.toHaveBeenCalled();

    // Matching pointerId with +1px jitter over 1ms must NOT suppress click-to-expand
    clock += 1;
    expect(() =>
      handleSheetPointerUp(
        state,
        "peek",
        {
          pointerType: "touch",
          button: 0,
          clientY: 501,
          pointerId: 7,
          currentTarget: target,
        },
        onDetentChange,
        () => clock,
      ),
    ).not.toThrow();
    expect(state.dragged).toBe(false);
    handleSheetHandleClick(state, "peek", onDetentChange);
    expect(onDetentChange).toHaveBeenCalledTimes(1);
    expect(onDetentChange).toHaveBeenLastCalledWith("half");

    // 3. Pointer cancel with matching pointerId clears drag state cleanly
    handleSheetPointerDown(
      state,
      {
        pointerType: "touch",
        button: 0,
        clientY: 400,
        pointerId: 11,
        currentTarget: target,
      },
      () => 2000,
    );
    expect(() =>
      handleSheetPointerCancel(state, {
        pointerType: "touch",
        button: 0,
        clientY: 400,
        pointerId: 11,
        currentTarget: target,
      }),
    ).not.toThrow();
    expect(state.start).toBeNull();
    expect(state.dragged).toBe(false);
  });
});
