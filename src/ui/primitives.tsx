import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangle, Phone, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { cleanCopy, formatAlgiersClock } from "@/ui/format";

export type HazardTone =
  | "extreme"
  | "high"
  | "moderate"
  | "rain"
  | "seismic"
  | "clear"
  | "neutral"
  | "signal";

const TONE_BADGE: Record<HazardTone, string> = {
  extreme:
    "bg-hazard-extreme-soft text-hazard-extreme-ink border-hazard-extreme/35",
  high: "bg-hazard-high-soft text-hazard-high-ink border-hazard-high/35",
  moderate:
    "bg-hazard-moderate-soft text-hazard-moderate-ink border-hazard-moderate/35",
  rain: "bg-hazard-rain-soft text-hazard-rain-ink border-hazard-rain/35",
  seismic:
    "bg-hazard-seismic-soft text-hazard-seismic-ink border-hazard-seismic/35",
  clear: "bg-hazard-clear-soft text-hazard-clear-ink border-hazard-clear/35",
  signal: "bg-signal-soft text-signal border-signal/35",
  neutral: "bg-surface-raised text-ink-secondary border-hairline-strong",
};

const TONE_DOT: Record<HazardTone, string> = {
  extreme: "bg-hazard-extreme",
  high: "bg-hazard-high",
  moderate: "bg-hazard-moderate",
  rain: "bg-hazard-rain",
  seismic: "bg-hazard-seismic",
  clear: "bg-hazard-clear",
  signal: "bg-signal",
  neutral: "bg-ink-muted",
};

export const TONE_RULE: Record<HazardTone, string> = {
  extreme: "bg-hazard-extreme",
  high: "bg-hazard-high",
  moderate: "bg-hazard-moderate",
  rain: "bg-hazard-rain",
  seismic: "bg-hazard-seismic",
  clear: "bg-hazard-clear",
  signal: "bg-signal",
  neutral: "bg-hairline-strong",
};

export function AtlasBadge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: HazardTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium leading-tight whitespace-nowrap",
        TONE_BADGE[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])}
        />
      )}
      {children}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "emergency";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-signal text-signal-ink hover:opacity-92 border border-transparent font-medium disabled:bg-surface-raised disabled:text-ink-secondary disabled:border-hairline-strong disabled:opacity-100",
  secondary:
    "bg-surface text-ink border border-hairline-strong hover:bg-surface-raised font-medium",
  ghost:
    "bg-transparent text-ink-secondary hover:bg-surface-raised hover:text-ink border border-transparent",
  danger:
    "bg-[#DC2626] text-white hover:bg-[#B91C1C] border border-transparent font-medium",
  emergency:
    "bg-[#DC2626] text-white hover:bg-[#B91C1C] border border-white/15 font-semibold",
};

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-[10px] gap-2",
  lg: "h-11 px-5 text-sm rounded-[10px] gap-2",
  icon: "h-9 w-9 rounded-[10px] p-0 justify-center",
};

export function AtlasButton({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap transition-[background-color,border-color,color,opacity] duration-150 cursor-pointer disabled:opacity-45 disabled:pointer-events-none active:scale-[0.99]",
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        className,
      )}
      {...props}
    />
  );
}

export function SafeBdi({
  children,
  dir = "ltr",
  className,
}: {
  children: ReactNode;
  dir?: "ltr" | "rtl" | "auto";
  className?: string;
}) {
  return (
    <bdi dir={dir} className={className}>
      {children}
    </bdi>
  );
}

export function AlgiersClock({ className }: { className?: string }) {
  const [clock, setClock] = useState(() => formatAlgiersClock());

  useEffect(() => {
    const id = window.setInterval(() => {
      setClock(formatAlgiersClock());
    }, 15_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <SafeBdi
      className={cn(
        "font-mono text-xs tabular-nums text-ink-secondary whitespace-nowrap",
        className,
      )}
    >
      {clock} CET
    </SafeBdi>
  );
}

export type MetricItem = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: HazardTone;
};

/** Hairline-divided Swiss editorial key-metric strip (zero boxes around figures). */
export function AtlasMetricStrip({
  items,
  className,
}: {
  items: MetricItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid border-y border-hairline divide-y sm:divide-y-0 sm:divide-x rtl:sm:divide-x-reverse divide-hairline",
        items.length === 2
          ? "grid-cols-1 sm:grid-cols-2"
          : items.length === 3
            ? "grid-cols-1 sm:grid-cols-3"
            : "grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {items.map((item, idx) => (
        <div
          key={idx}
          className="py-4 sm:px-5 first:sm:ps-0 last:sm:pe-0 flex flex-col gap-1"
        >
          <span className="text-xs font-medium text-ink-secondary">
            {cleanCopy(item.label)}
          </span>
          <span
            className={cn(
              "font-display text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight leading-none",
              item.tone === "extreme"
                ? "text-hazard-extreme"
                : item.tone === "high"
                  ? "text-hazard-high"
                  : item.tone === "rain"
                    ? "text-hazard-rain"
                    : item.tone === "clear"
                      ? "text-hazard-clear"
                      : item.tone === "signal"
                        ? "text-signal"
                        : "text-ink",
            )}
          >
            {item.value}
          </span>
          {item.detail && (
            <span className="text-xs text-ink-muted tabular-nums">
              {item.detail}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Swiss Civic Broadcast editorial masthead. */
export function AtlasMasthead({
  edition,
  title,
  subtitle,
  actions,
  metrics,
  className,
}: {
  edition?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  metrics?: MetricItem[] | undefined;
  className?: string;
}) {
  return (
    <header className={cn("pt-2 pb-6 space-y-5", className)}>
      <div className="border-t-2 border-ink/85 dark:border-hairline-strong pt-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2 min-w-0 max-w-3xl">
          {edition && (
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink-secondary">
              {edition}
            </div>
          )}
          <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.75rem] font-semibold tracking-tight text-ink leading-[1.12] text-balance">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm sm:text-base text-ink-secondary leading-relaxed max-w-2xl">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
      {metrics && metrics.length > 0 && <AtlasMetricStrip items={metrics} />}
    </header>
  );
}

export function AtlasPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-hairline bg-surface p-5 sm:p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AtlasInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-[10px] border border-hairline-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-muted focus:border-signal focus:outline-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function AtlasSelect({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-[10px] border border-hairline-strong bg-surface px-3 text-sm text-ink focus:border-signal focus:outline-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function AtlasTextarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-[10px] border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-signal focus:outline-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function AtlasLoading({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-ink-secondary">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-hairline-strong border-t-signal"
      />
      <span>{label ?? "Loading..."}</span>
    </div>
  );
}

export function AtlasError({
  title,
  body,
  onRetry,
  retryLabel,
}: {
  title: string;
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-hazard-extreme/30 bg-hazard-extreme-soft p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-hazard-extreme shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-ink">{cleanCopy(title)}</p>
          {body && (
            <p className="text-xs text-ink-secondary">{cleanCopy(body)}</p>
          )}
        </div>
      </div>
      {onRetry && (
        <AtlasButton variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          {retryLabel ?? "Try again"}
        </AtlasButton>
      )}
    </div>
  );
}

export function AtlasEmpty({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-hairline-strong bg-surface/60 px-6 py-10 text-center space-y-2.5">
      <p className="text-base font-semibold text-ink">{cleanCopy(title)}</p>
      {body && (
        <p className="text-sm text-ink-secondary max-w-md mx-auto">
          {cleanCopy(body)}
        </p>
      )}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export const ALGERIA_EMERGENCY_NUMBERS = [
  {
    number: "14",
    key: "civil",
    labelAr: "الحماية المدنية",
    labelFr: "Protection Civile",
    labelEn: "Civil Protection",
  },
  {
    number: "1548",
    key: "police",
    labelAr: "الأمن الوطني",
    labelFr: "Police Nationale",
    labelEn: "National Police",
  },
  {
    number: "1055",
    key: "gendarmerie",
    labelAr: "الدرك الوطني",
    labelFr: "Gendarmerie",
    labelEn: "Gendarmerie",
  },
  {
    number: "1070",
    key: "forests",
    labelAr: "الغابات",
    labelFr: "Forêts",
    labelEn: "Forestry",
  },
] as const;

export function EmergencyDialBar({ locale }: { locale: string }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      {ALGERIA_EMERGENCY_NUMBERS.map((entry, idx) => {
        const label =
          locale === "ar"
            ? entry.labelAr
            : locale === "fr"
              ? entry.labelFr
              : entry.labelEn;
        return (
          <a
            key={entry.number}
            href={`tel:${entry.number}`}
            className={cn(
              "group flex items-center justify-between gap-2 rounded-xl border px-3.5 py-3 transition-colors",
              idx === 0
                ? "border-[#DC2626] bg-[#DC2626] text-white hover:bg-[#B91C1C]"
                : "border-hairline-strong bg-surface hover:bg-surface-raised text-ink",
            )}
          >
            <div className="min-w-0">
              <div
                className={cn(
                  "font-mono text-xl font-semibold tabular-nums leading-none",
                  idx === 0 ? "text-white" : "text-ink",
                )}
              >
                <SafeBdi>{entry.number}</SafeBdi>
              </div>
              <div
                className={cn(
                  "mt-1 text-xs truncate",
                  idx === 0 ? "text-white/90" : "text-ink-secondary",
                )}
              >
                {label}
              </div>
            </div>
            <Phone
              className={cn(
                "h-4 w-4 shrink-0",
                idx === 0 ? "text-white" : "text-hazard-extreme",
              )}
            />
          </a>
        );
      })}
    </div>
  );
}
