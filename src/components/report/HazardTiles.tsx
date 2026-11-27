import { useTranslation } from "react-i18next";

import type { ReportKind } from "@/lib/reports";
import { TILES } from "@/lib/report-tiles";
import { cn } from "@/lib/utils";

export function HazardTiles({
  onPick,
}: {
  onPick: (kind: ReportKind) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="grid grid-cols-2 gap-3">
      {TILES.map(({ kind, Icon }) => {
        const urgent = kind === "person_trapped";
        return (
          <li key={kind} className={kind === "other" ? "col-span-2" : ""}>
            <button
              type="button"
              onClick={() => onPick(kind)}
              className={cn(
                "flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center text-base font-medium transition-colors",
                urgent
                  ? "border-transparent"
                  : "border-border bg-surface hover:bg-muted",
                kind === "other" && "min-h-16 flex-row",
              )}
              style={
                urgent
                  ? {
                      backgroundColor: "var(--emergency-surface)",
                      color: "var(--emergency-ink)",
                    }
                  : undefined
              }
            >
              <Icon aria-hidden className="size-7 shrink-0" />
              {t(`reports.tile.${kind}`)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
