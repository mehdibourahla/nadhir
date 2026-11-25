import { useId, useState, type KeyboardEvent } from "react";
import { ChevronDown, Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AnyLocale } from "@/i18n";
import {
  isAlertTriggerKind,
  isAuthorityStatus,
  isValidObservedAt,
  isValidRadiusKm,
  normalizeAreaLabel,
  type AlertProvenanceData,
} from "@/lib/alert-provenance";
import { algiersTime, relativeTime } from "@/lib/nadhir";

const BLANK_OR_EM_DASH_ONLY = /^[\s\u2014]+$/;
const UNINTERPOLATED_TOKEN = /\{\{[^{}]+\}\}/;

function normalizeLocale(language: string | undefined): AnyLocale {
  const prefix = (language ?? "ar").trim().toLowerCase().split(/[-_]/)[0];
  if (
    prefix === "ar" ||
    prefix === "fr" ||
    prefix === "en" ||
    prefix === "kab"
  ) {
    return prefix;
  }
  return "ar";
}

export type AlertProvenanceProps = {
  provenance: AlertProvenanceData;
  compact?: boolean | undefined;
  defaultExpanded?: boolean | undefined;
  now?: number | undefined;
  className?: string | undefined;
};

export function AlertProvenance({
  provenance,
  compact = false,
  defaultExpanded = false,
  now,
  className,
}: AlertProvenanceProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(Boolean(defaultExpanded));
  const panelId = useId();
  const locale = normalizeLocale(i18n.language);
  const notRecorded = t("common.notRecorded");

  const safeTriggerKind = isAlertTriggerKind(provenance.triggerKind)
    ? provenance.triggerKind
    : "national_feed";
  const triggerText = t(`provenance.trigger.${safeTriggerKind}`);

  const rawRuleKey =
    typeof provenance.ruleLabelKey === "string"
      ? provenance.ruleLabelKey.trim()
      : "";
  const resolvedRule: unknown =
    rawRuleKey.length > 0
      ? t(rawRuleKey, { returnObjects: true, defaultValue: "" })
      : "";
  const ruleText =
    typeof resolvedRule === "string" &&
    resolvedRule.trim().length > 0 &&
    !UNINTERPOLATED_TOKEN.test(resolvedRule)
      ? resolvedRule
      : t("provenance.rule.generic");

  const authorityText = isAuthorityStatus(provenance.authorityStatus)
    ? t(`provenance.authority.${provenance.authorityStatus}`)
    : null;

  const safeAreaLabel = normalizeAreaLabel(provenance.areaLabel);
  const safeSourceAttribution =
    typeof provenance.sourceAttribution === "string" &&
    provenance.sourceAttribution.trim().length > 0 &&
    !BLANK_OR_EM_DASH_ONLY.test(provenance.sourceAttribution)
      ? provenance.sourceAttribution.trim()
      : notRecorded;
  const safeObservedAt =
    typeof provenance.observedAt === "string"
      ? provenance.observedAt.trim()
      : "";
  const hasValidTime = isValidObservedAt(safeObservedAt);
  const hasValidRadius = isValidRadiusKm(provenance.radiusKm);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div
      className={
        className
          ? `border-t border-border/70 pt-2 text-start ${className}`
          : "border-t border-border/70 pt-2 text-start"
      }
      onKeyDown={handleKeyDown}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!compact && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground" dir="auto">
              {safeSourceAttribution}
            </span>
            <span aria-hidden>·</span>
            <span>{triggerText}</span>
            <span aria-hidden>·</span>
            {hasValidTime ? (
              <time dateTime={safeObservedAt}>
                {relativeTime(safeObservedAt, locale, now)}
              </time>
            ) : (
              <span>{notRecorded}</span>
            )}
          </p>
        )}

        <button
          type="button"
          tabIndex={0}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((prev) => !prev)}
          onKeyDown={handleKeyDown}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-start text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <Info aria-hidden className="size-3.5 shrink-0" />
          <span>{t("provenance.whySeeing")}</span>
          <ChevronDown
            aria-hidden
            className={
              open
                ? "size-3.5 shrink-0 rotate-180 transition-transform"
                : "size-3.5 shrink-0 transition-transform"
            }
          />
        </button>
      </div>

      {open && (
        <div
          id={panelId}
          className="mt-1.5 rounded-md border border-border/70 bg-muted/40 p-3 text-xs text-muted-foreground"
          onKeyDown={handleKeyDown}
        >
          <dl className="grid grid-cols-1 gap-y-1.5 sm:grid-cols-[auto_1fr] sm:gap-x-3">
            <dt className="font-medium text-foreground">
              {t("provenance.triggerLabel")}
            </dt>
            <dd className="text-muted-foreground">{triggerText}</dd>

            <dt className="font-medium text-foreground">
              {t("provenance.areaLabel")}
            </dt>
            <dd className="text-muted-foreground">
              {safeAreaLabel ? (
                <span dir="auto">{safeAreaLabel}</span>
              ) : (
                <span>{notRecorded}</span>
              )}
              {safeTriggerKind === "watch_zone" && hasValidRadius && (
                <>
                  <span aria-hidden> · </span>
                  <span>
                    {t("provenance.radiusKm", { km: provenance.radiusKm })}
                  </span>
                </>
              )}
            </dd>

            <dt className="font-medium text-foreground">
              {t("provenance.ruleLabel")}
            </dt>
            <dd className="text-muted-foreground">{ruleText}</dd>

            <dt className="font-medium text-foreground">
              {t("provenance.sourceLabel")}
            </dt>
            <dd className="text-muted-foreground">
              <span className="font-medium text-foreground" dir="auto">
                {safeSourceAttribution}
              </span>
              {authorityText && (
                <>
                  <span aria-hidden> · </span>
                  <span>{authorityText}</span>
                </>
              )}
            </dd>

            <dt className="font-medium text-foreground">
              {t("provenance.observedLabel")}
            </dt>
            <dd className="text-muted-foreground">
              {hasValidTime ? (
                <time dateTime={safeObservedAt}>
                  {algiersTime(safeObservedAt)} ·{" "}
                  {relativeTime(safeObservedAt, locale, now)}
                </time>
              ) : (
                <span>{notRecorded}</span>
              )}
            </dd>
          </dl>
        </div>
      )}
    </div>
  );
}
