import { cn } from "@/lib/utils";

/** Geometric compass-beacon emblem for Nadhir Atlas. */
export function NadhirMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("h-8 w-8 shrink-0", className)}
    >
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="8"
        className="fill-ink dark:fill-surface-raised stroke-hairline-strong"
        strokeWidth="1.25"
      />
      <circle
        cx="16"
        cy="16"
        r="8.5"
        className="stroke-signal"
        strokeWidth="1.4"
        strokeDasharray="3.5 2.5"
      />
      <path
        d="M16 7.5L19.4 16L16 24.5L12.6 16L16 7.5Z"
        className="fill-signal"
      />
      <circle cx="16" cy="16" r="2.2" className="fill-white dark:fill-canvas" />
    </svg>
  );
}
