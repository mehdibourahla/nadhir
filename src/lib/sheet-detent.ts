export const SHEET_DETENTS = ["peek", "half", "full"] as const;
export type SheetDetent = (typeof SHEET_DETENTS)[number];

/** Minimum vertical displacement before a fast flick counts as an intentional drag instead of tap jitter. */
export const SHEET_VELOCITY_MIN_DISPLACEMENT_PX = 12;

export interface SheetPointerLikeEvent {
  pointerType: string;
  button: number;
  clientY: number;
  pointerId: number;
  currentTarget: {
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
  };
}

export interface SheetDragState {
  start: { y: number; t: number; pointerId: number } | null;
  dragged: boolean;
}

export function stepSheetDetent(
  current: SheetDetent,
  delta: -1 | 1,
): SheetDetent {
  const index = SHEET_DETENTS.indexOf(current);
  const next = Math.max(0, Math.min(SHEET_DETENTS.length - 1, index + delta));
  return SHEET_DETENTS[next]!;
}

export function nextCycleDetent(current: SheetDetent): SheetDetent {
  if (current === "peek") return "half";
  if (current === "half") return "full";
  return "peek";
}

export function resolveDragDetent(
  current: SheetDetent,
  deltaY: number,
  velocityPxPerMs: number,
): SheetDetent | null {
  if (!Number.isFinite(deltaY) || !Number.isFinite(velocityPxPerMs)) {
    return null;
  }
  const absDelta = Math.abs(deltaY);
  if (absDelta >= 180) {
    return deltaY < 0 ? "full" : "peek";
  }
  if (
    absDelta >= 36 ||
    (absDelta >= SHEET_VELOCITY_MIN_DISPLACEMENT_PX &&
      Math.abs(velocityPxPerMs) >= 0.35)
  ) {
    return stepSheetDetent(current, deltaY < 0 ? 1 : -1);
  }
  return null;
}

export function resolveKeyDetent(
  current: SheetDetent,
  key: string,
): SheetDetent | null {
  if (key === "ArrowUp") return stepSheetDetent(current, 1);
  if (key === "ArrowDown") return stepSheetDetent(current, -1);
  if (key === "Home") return "full";
  if (key === "End") return "peek";
  if (key === "Escape" && current !== "peek") return "peek";
  return null;
}

export function handleSheetPointerDown(
  state: SheetDragState,
  event: SheetPointerLikeEvent,
  now: () => number = () => performance.now(),
): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  state.start = {
    y: event.clientY,
    t: now(),
    pointerId: event.pointerId,
  };
  state.dragged = false;
  try {
    event.currentTarget.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic or already-released pointers can throw NotFoundError.
  }
}

export function handleSheetPointerUp(
  state: SheetDragState,
  detent: SheetDetent,
  event: SheetPointerLikeEvent,
  onDetentChange: (next: SheetDetent) => void,
  now: () => number = () => performance.now(),
): void {
  const start = state.start;
  if (!start || start.pointerId !== event.pointerId) return;
  state.start = null;
  try {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  } catch {
    // Ignore when pointer capture was not active or already released.
  }
  const dy = event.clientY - start.y;
  const dt = Math.max(1, now() - start.t);
  const next = resolveDragDetent(detent, dy, dy / dt);
  if (
    (next !== null && next !== detent) ||
    Math.abs(dy) >= SHEET_VELOCITY_MIN_DISPLACEMENT_PX
  ) {
    state.dragged = true;
    if (next !== null && next !== detent) {
      onDetentChange(next);
    }
  }
}

export function handleSheetPointerCancel(
  state: SheetDragState,
  event: SheetPointerLikeEvent,
): void {
  const start = state.start;
  if (!start || start.pointerId !== event.pointerId) return;
  state.start = null;
  state.dragged = false;
  try {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  } catch {
    // Ignore when pointer capture was not active or already released.
  }
}

export function handleSheetHandleClick(
  state: SheetDragState,
  detent: SheetDetent,
  onDetentChange: (next: SheetDetent) => void,
): void {
  if (state.dragged) {
    state.dragged = false;
    return;
  }
  onDetentChange(nextCycleDetent(detent));
}
