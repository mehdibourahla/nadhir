import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";

import { algiersTime } from "@/lib/nadhir";
import { cn } from "@/lib/utils";
import { SafeBdi } from "@/ui/primitives";

export type AlertProvenanceProps = {
  trigger?: string | undefined;
  area?: string | null | undefined;
  rule?: string | null | undefined;
  source?: string | null | undefined;
  observedAt?: string | null | undefined;
  className?: string | undefined;
};

export function AlertProvenance({
  trigger,
  area,
  rule,
  source,
  observedAt,
  className,
}: AlertProvenanceProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const notRecorded = t("common.notRecorded");

  return (
    <div className={cn("pt-1", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-signal hover:bg-signal-soft transition-colors cursor-pointer"
      >
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span>{t("provenance.whySeeing")}</span>
      </button>

      {open && (
        <dl className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-hairline bg-surface-raised/60 p-3 text-xs">
          <div>
            <dt className="text-[11px] text-ink-muted">
              {t("provenance.triggerLabel")}
            </dt>
            <dd className="font-medium text-ink">
              {trigger ?? t("provenance.trigger.watch_zone")}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-muted">
              {t("provenance.areaLabel")}
            </dt>
            <dd className="font-medium text-ink">
              <SafeBdi dir="auto">{area || notRecorded}</SafeBdi>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-muted">
              {t("provenance.ruleLabel")}
            </dt>
            <dd className="font-medium text-ink">
              {rule || t("provenance.rule.generic")}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-muted">
              {t("provenance.sourceLabel")}
            </dt>
            <dd className="font-medium text-ink">
              <SafeBdi dir="auto">{source || notRecorded}</SafeBdi>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-ink-muted">
              {t("provenance.observedLabel")}
            </dt>
            <dd className="font-mono text-ink">
              {observedAt ? (
                <SafeBdi>{algiersTime(observedAt)}</SafeBdi>
              ) : (
                notRecorded
              )}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
