import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Locale } from "@/i18n";
import { relativeTime } from "@/lib/nadhir";
import type { SourceHealth as SourceHealthModel } from "@/lib/source-health";

const STATUS = {
  healthy: {
    ink: "var(--risk-ink-1)",
    tint: "var(--risk-tint-1)",
    Icon: CircleCheck,
  },
  delayed: {
    ink: "var(--risk-ink-3)",
    tint: "var(--risk-tint-3)",
    Icon: CircleAlert,
  },
  degraded: {
    ink: "var(--risk-ink-3)",
    tint: "var(--risk-tint-3)",
    Icon: CircleAlert,
  },
  stale: {
    ink: "var(--risk-ink-4)",
    tint: "var(--risk-tint-4)",
    Icon: CircleX,
  },
  unavailable: {
    ink: "var(--risk-ink-5)",
    tint: "var(--risk-tint-5)",
    Icon: CircleX,
  },
  backfilling: {
    ink: "var(--risk-ink-2)",
    tint: "var(--risk-tint-2)",
    Icon: CircleAlert,
  },
  paused: {
    ink: "var(--muted-foreground)",
    tint: "var(--muted)",
    Icon: CircleAlert,
  },
} as const;

export function SourceHealth({
  source,
  locale,
}: {
  source: SourceHealthModel;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const status = STATUS[source.state] ?? STATUS.degraded;
  const { Icon } = status;

  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b border-border px-4 py-3 last:border-b-0">
      <span className="flex min-w-44 items-center gap-2 font-medium">
        <Icon
          aria-hidden
          className="size-4 shrink-0"
          style={{ color: status.ink }}
        />
        {source.label}
      </span>
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
        style={{ backgroundColor: status.tint, color: status.ink }}
      >
        {source.processing_only
          ? t("status.processingDegraded")
          : t(`status.state.${source.state}`)}
      </span>
      <span className="tabular text-sm text-muted-foreground">
        {source.valid_at
          ? t("status.validAge", {
              time: relativeTime(source.valid_at, locale),
            })
          : t("status.noValidData")}
      </span>
      <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">
        {source.last_success_at
          ? t("status.lastSuccessAt", {
              time: relativeTime(source.last_success_at, locale),
            })
          : t("status.neverValidated")}
        {source.records_expected != null
          ? ` · ${t("status.coverage", {
              accepted: source.records_accepted,
              expected: source.records_expected,
            })}`
          : ""}
        {source.fallback_contract_key
          ? ` · ${t("status.fallback", {
              source: source.fallback_contract_key,
            })}`
          : ""}
        {source.public_reason_code
          ? ` · ${t(`status.reason.${source.public_reason_code}`)}`
          : ""}
      </span>
      {source.processing && (
        <span className="w-full text-sm text-muted-foreground">
          {t("status.collectionAt", {
            time: source.processing.collection_at
              ? relativeTime(source.processing.collection_at, locale)
              : t("status.noValidData"),
          })}
          {" · "}
          {t("status.processingBacklog", {
            pending: source.processing.pending,
            quarantined: source.processing.quarantined,
          })}
        </span>
      )}
    </li>
  );
}
