import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "bad" | "neutral";

const TONES: Record<Tone, string> = {
  ok: "border-risk-1/40 bg-risk-1/10 text-foreground",
  warn: "border-risk-2/50 bg-risk-2/15 text-foreground",
  bad: "border-emergency/50 bg-emergency/10 text-emergency",
  neutral: "border-border bg-muted text-muted-foreground",
};

const DOTS: Record<Tone, string> = {
  ok: "bg-risk-1",
  warn: "bg-risk-2",
  bad: "bg-emergency",
  neutral: "bg-faint",
};

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOTS[tone])} />
      {children}
    </span>
  );
}
