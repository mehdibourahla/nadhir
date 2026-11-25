import type { ReactNode } from "react";

import { Explain } from "@/components/nadhir/Explain";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  explain?: string;
  tone?: "default" | "emergency";
  className?: string;
};

export function StatCard({
  label,
  value,
  sub,
  explain,
  tone = "default",
  className,
}: Props) {
  const emergency = tone === "emergency";
  return (
    <Explain text={explain}>
      <div
        className={cn("card flex flex-col gap-1 p-3.5", className)}
        style={
          emergency
            ? {
                backgroundColor: "var(--emergency-surface)",
                borderColor: "var(--emergency)",
              }
            : undefined
        }
      >
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <span
          className="font-display tabular text-2xl leading-tight"
          style={emergency ? { color: "var(--emergency-ink)" } : undefined}
        >
          {value}
        </span>
        {sub ? (
          <span className="text-xs text-muted-foreground">{sub}</span>
        ) : null}
      </div>
    </Explain>
  );
}
