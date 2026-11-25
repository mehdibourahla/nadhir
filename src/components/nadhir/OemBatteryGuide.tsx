import { BatteryCharging, ChevronDown, Info } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  OEM_BATTERY_FAMILIES,
  OEM_STEP_KEYS,
  type OemBatteryFamily,
} from "@/lib/oem-battery";

export type OemBatteryGuideProps = {
  defaultOpen?: boolean | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  defaultOem?: OemBatteryFamily | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
};

export function OemBatteryGuide({
  defaultOpen = false,
  open,
  onOpenChange,
  defaultOem = "xiaomi",
  compact = false,
  className,
}: OemBatteryGuideProps) {
  const { t, i18n } = useTranslation();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    Boolean(defaultOpen),
  );
  const [activeOem, setActiveOem] = useState<OemBatteryFamily>(defaultOem);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const tabRefs = useRef<Partial<Record<OemBatteryFamily, HTMLButtonElement>>>(
    {},
  );

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const handleContainerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const isRtl = i18n.dir() === "rtl";
    const total = OEM_BATTERY_FAMILIES.length;
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = isRtl ? (index - 1 + total) % total : (index + 1) % total;
    } else if (event.key === "ArrowLeft") {
      nextIndex = isRtl ? (index + 1) % total : (index - 1 + total) % total;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = total - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextFamily = OEM_BATTERY_FAMILIES[nextIndex]!;
    setActiveOem(nextFamily);
    tabRefs.current[nextFamily]?.focus();
  };

  const activeTabId = `${baseId}-tab-${activeOem}`;
  const activePanelId = `${baseId}-tabpanel-${activeOem}`;

  return (
    <div
      className={
        className ? `space-y-3 text-start ${className}` : "space-y-3 text-start"
      }
      onKeyDown={handleContainerKeyDown}
    >
      <button
        type="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setOpen(!isOpen)}
        className="flex min-h-11 min-w-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-start text-foreground transition-colors hover:bg-muted"
      >
        <span className="flex min-w-0 items-center gap-2">
          <BatteryCharging
            aria-hidden
            className="size-4 shrink-0 text-[var(--accent)]"
          />
          <span className="min-w-0">
            <span
              className={
                compact
                  ? "block text-xs font-semibold text-foreground"
                  : "block text-sm font-semibold text-foreground"
              }
            >
              {t("oemBattery.title")}
            </span>
            {!compact && (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t("oemBattery.subtitle")}
              </span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
          <span>
            {t(isOpen ? "oemBattery.toggleHide" : "oemBattery.toggleShow")}
          </span>
          <ChevronDown
            aria-hidden
            className={
              isOpen
                ? "size-4 shrink-0 rotate-180 transition-transform"
                : "size-4 shrink-0 transition-transform"
            }
          />
        </span>
      </button>

      {isOpen && (
        <div
          id={panelId}
          className="space-y-3 rounded-lg border border-border bg-background p-3 text-xs"
        >
          <p className="text-foreground">{t("oemBattery.intro")}</p>
          <p className="text-muted-foreground">
            {t("oemBattery.channelsHint")}
          </p>

          <div
            role="tablist"
            aria-label={t("oemBattery.tabListLabel")}
            className="flex flex-wrap gap-1.5"
          >
            {OEM_BATTERY_FAMILIES.map((family, index) => {
              const selected = activeOem === family;
              const tabId = `${baseId}-tab-${family}`;
              const tabPanelId = `${baseId}-tabpanel-${family}`;
              return (
                <button
                  key={family}
                  ref={(node) => {
                    if (node) tabRefs.current[family] = node;
                  }}
                  id={tabId}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={tabPanelId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveOem(family)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={
                    selected
                      ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-tint)] px-3 py-2 text-xs font-semibold text-[var(--accent)]"
                      : "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {t(`oemBattery.oems.${family}.name`)}
                </button>
              );
            })}
          </div>

          <div
            id={activePanelId}
            role="tabpanel"
            aria-labelledby={activeTabId}
            tabIndex={0}
            className="space-y-3 rounded-lg border border-border bg-muted/30 p-3"
          >
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold text-foreground">
                {t(`oemBattery.oems.${activeOem}.name`)}
              </h3>
              <p className="text-xs font-medium text-muted-foreground">
                {t(`oemBattery.oems.${activeOem}.subtitle`)}
              </p>
            </div>

            <ol className="space-y-2.5">
              {OEM_STEP_KEYS.map((stepKey, idx) => (
                <li
                  key={stepKey}
                  className="flex items-start gap-2.5 text-xs leading-relaxed text-foreground"
                >
                  <span
                    aria-label={t("oemBattery.stepNumber", { n: idx + 1 })}
                    className="tabular mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-tint)] text-xs font-semibold text-[var(--accent)]"
                  >
                    {idx + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    {t(`oemBattery.oems.${activeOem}.steps.${stepKey}`)}
                  </span>
                </li>
              ))}
            </ol>

            {activeOem === "huawei" && (
              <div
                role="note"
                className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-xs"
                style={{
                  backgroundColor: "var(--risk-tint-3)",
                  color: "var(--risk-ink-3)",
                }}
              >
                <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                <p>{t("oemBattery.hmsCaveat")}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
