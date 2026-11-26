import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  SHEET_DETENTS,
  handleSheetHandleClick,
  handleSheetPointerCancel,
  handleSheetPointerDown,
  handleSheetPointerUp,
  resolveKeyDetent,
  type SheetDetent,
  type SheetDragState,
} from "@/lib/sheet-detent";

const DETENT_HEIGHT_CLASS: Record<SheetDetent, string> = {
  peek: "h-[176px]",
  half: "h-[52%]",
  full: "h-[86%]",
};

function handleActionLabelKey(detent: SheetDetent): string {
  if (detent === "peek") return "track3.sheet.expandToHalf";
  if (detent === "half") return "track3.sheet.expandToFull";
  return "track3.sheet.collapseToPeek";
}

export function MapWorkspacePanel({
  detent,
  onDetentChange,
  header,
  filterBar,
  children,
}: {
  detent: SheetDetent;
  onDetentChange: (next: SheetDetent) => void;
  header?: ReactNode;
  filterBar?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const dragState = useRef<SheetDragState>({ start: null, dragged: false });

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = resolveKeyDetent(detent, event.key);
    if (next && next !== detent) {
      event.preventDefault();
      onDetentChange(next);
    }
  };

  return (
    <section
      data-detent={detent}
      aria-label={t("civilMap.list")}
      className={`map-workspace-panel absolute inset-x-3 bottom-3 z-10 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-xl backdrop-blur lg:inset-y-4 lg:start-4 lg:end-auto lg:h-auto lg:w-[392px] lg:rounded-3xl ${DETENT_HEIGHT_CLASS[detent]}`}
    >
      <div className="map-workspace-bar flex shrink-0 items-center gap-1 border-b border-border/60 px-2 lg:hidden">
        <button
          type="button"
          data-sheet-handle
          aria-label={t(handleActionLabelKey(detent))}
          aria-expanded={detent !== "peek"}
          className="map-workspace-handle flex min-h-11 min-w-11 flex-1 touch-none items-center justify-center focus-visible:outline-2 focus-visible:outline-primary"
          onPointerDown={(event) =>
            handleSheetPointerDown(dragState.current, event)
          }
          onPointerUp={(event) =>
            handleSheetPointerUp(
              dragState.current,
              detent,
              event,
              onDetentChange,
            )
          }
          onPointerCancel={(event) =>
            handleSheetPointerCancel(dragState.current, event)
          }
          onKeyDown={handleKeyDown}
          onClick={() =>
            handleSheetHandleClick(dragState.current, detent, onDetentChange)
          }
        >
          <span className="h-1.5 w-10 rounded-full bg-border" />
        </button>

        <div
          role="group"
          aria-label={t("track3.sheet.heightGroup")}
          className="flex shrink-0 items-center gap-0.5"
        >
          {SHEET_DETENTS.map((level) => {
            const active = detent === level;
            return (
              <button
                key={level}
                type="button"
                data-detent-trigger={level}
                aria-pressed={active}
                onClick={() => onDetentChange(level)}
                className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                  active
                    ? "bg-[var(--accent-tint)] font-semibold text-[var(--accent)]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {t(`track3.sheet.${level}`)}
              </button>
            );
          })}
        </div>
      </div>

      {header}
      {filterBar}
      <div
        className={`map-workspace-body min-h-0 flex-1 flex-col ${detent === "peek" ? "hidden lg:flex" : "flex"}`}
      >
        {children}
      </div>

      <style>{`.map-workspace-panel {
        transition: height 280ms cubic-bezier(.22, 1, .36, 1), box-shadow 280ms ease;
        animation: map-panel-enter 220ms cubic-bezier(.22, 1, .36, 1);
      }
      .map-workspace-handle span { transition: width 180ms ease, background-color 180ms ease; }
      .map-workspace-handle:hover span, .map-workspace-handle:focus-visible span { width: 48px; background: var(--ink-soft); }
      @keyframes map-panel-enter { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      @media (prefers-reduced-motion: reduce) {
        .map-workspace-panel, .map-workspace-handle span { transition: none; animation: none; }
      }
      @media (min-width: 640px) and (max-height: 500px) {
        .map-workspace-panel { inset-block: 12px; inset-inline-start: 12px; inset-inline-end: auto; width: 380px; height: auto; }
        .map-workspace-bar { display: none; }
        .map-workspace-body { display: flex !important; }
      }`}</style>
    </section>
  );
}
