import { useTranslation } from "react-i18next";

import type { Detection } from "@/lib/nadhir";
import { cn } from "@/lib/utils";

/** FCI is geostationary (dense), FIRMS polar-orbiting (sparse) — the legend explains the difference. */
const SOURCE_STYLE: Record<string, { color: string; shape: string }> = {
  fci: { color: "var(--accent)", shape: "rounded-full" },
  firms: { color: "var(--risk-4)", shape: "rounded-[2px]" },
};

export function DetectionStrip({
  detections,
  className,
}: {
  detections: Detection[];
  className?: string;
}) {
  const { t } = useTranslation();
  if (!detections.length) return null;

  const times = detections.map((d) => Date.parse(d.detected_at));
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(1, max - min);
  const sources = [...new Set(detections.map((d) => d.source))];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative h-9 rounded-lg bg-muted px-2">
        {detections.map((d) => {
          const style = SOURCE_STYLE[d.source] ?? SOURCE_STYLE["firms"]!;
          const pct = ((Date.parse(d.detected_at) - min) / span) * 100;
          return (
            <span
              key={d.id}
              title={`${d.sensor} · ${new Date(d.detected_at).toISOString().slice(11, 16)}`}
              className={cn(
                "absolute top-1/2 size-2 -translate-y-1/2",
                style.shape,
              )}
              style={{
                insetInlineStart: `calc(${pct}% - 4px)`,
                backgroundColor: style.color,
                boxShadow: "0 0 0 1.5px var(--mark-ring)",
              }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {sources.map((source) => (
          <span key={source} className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-2",
                (SOURCE_STYLE[source] ?? SOURCE_STYLE["firms"]!).shape,
              )}
              style={{
                backgroundColor: (
                  SOURCE_STYLE[source] ?? SOURCE_STYLE["firms"]!
                ).color,
              }}
            />
            {source.toUpperCase()}
          </span>
        ))}
        <span className="tabular ms-auto">
          {t("fire.detectionCount")}: {detections.length}
        </span>
      </div>
    </div>
  );
}
