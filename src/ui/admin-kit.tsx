import { useEffect, useState, type ReactNode } from "react";
import type {
  UseInfiniteQueryResult,
  UseQueryResult,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown, RefreshCw, X } from "lucide-react";

import type { AnyLocale, Locale } from "@/i18n";
import { absoluteTime } from "@/lib/admin-format";
import { relativeTime } from "@/lib/nadhir";
import { cn } from "@/lib/utils";
import { cleanCopy } from "@/ui/format";
import {
  AlgiersClock,
  AtlasBadge,
  AtlasButton,
  AtlasEmpty,
  AtlasError,
  AtlasInput,
  AtlasMasthead,
  AtlasPanel,
  AtlasTextarea,
  SafeBdi,
  type HazardTone,
} from "@/ui/primitives";

export type AdminTone = "ok" | "warn" | "bad" | "neutral" | "info";

export type AdminMetric = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: HazardTone;
};

export function adminToneToAtlas(tone: AdminTone): HazardTone {
  switch (tone) {
    case "ok":
      return "clear";
    case "warn":
      return "high";
    case "bad":
      return "extreme";
    case "info":
      return "rain";
    default:
      return "neutral";
  }
}

export const ADMIN_TONE_BAR: Record<AdminTone, string> = {
  ok: "bg-hazard-clear",
  warn: "bg-hazard-high",
  bad: "bg-hazard-extreme",
  info: "bg-hazard-rain",
  neutral: "bg-hairline-strong",
};

export function AdminBadge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: AdminTone;
  dot?: boolean;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <AtlasBadge
      tone={adminToneToAtlas(tone)}
      dot={dot}
      {...(className ? { className } : {})}
    >
      {children}
    </AtlasBadge>
  );
}

export function AdminHeader({
  eyebrow,
  title,
  description,
  actions,
  metrics,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: string | undefined;
  actions?: ReactNode;
  metrics?: AdminMetric[] | undefined;
}) {
  const { t } = useTranslation("admin");
  return (
    <AtlasMasthead
      edition={
        <>
          <span>{eyebrow ?? t("shell.title")}</span>
          <span>·</span>
          <AlgiersClock />
        </>
      }
      title={cleanCopy(title)}
      {...(description ? { subtitle: cleanCopy(description) } : {})}
      {...(actions ? { actions } : {})}
      {...(metrics ? { metrics } : {})}
      className="mb-6"
    />
  );
}

export function AdminSection({
  title,
  help,
  actions,
  className,
  children,
}: {
  title: string;
  help?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("mt-8 space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-2.5">
        <div className="space-y-0.5 min-w-0">
          <h2 className="font-display text-xl font-semibold text-ink">
            {cleanCopy(title)}
          </h2>
          {help && (
            <p className="text-xs text-ink-secondary max-w-2xl leading-relaxed">
              {cleanCopy(help)}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function AdminWhen({
  at,
  className,
}: {
  at: string | null | undefined;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const locale = (i18n.language || "en") as AnyLocale;
  if (!at) return <span className={cn("text-ink-muted", className)}>-</span>;
  const safeLocale: Locale =
    locale === "ar" || locale === "fr" || locale === "en" ? locale : "fr";
  let title: string;
  try {
    title = absoluteTime(at, safeLocale);
  } catch {
    title = at;
  }
  return (
    <SafeBdi className={cn("font-mono tabular-nums", className)}>
      <time dateTime={at} title={title}>
        {relativeTime(at, locale)}
      </time>
    </SafeBdi>
  );
}

export function AdminFilterTabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string; count?: number | undefined }[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-xl border border-hairline bg-surface p-1",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              active
                ? "bg-signal text-signal-ink"
                : "text-ink-secondary hover:bg-surface-raised hover:text-ink",
            )}
          >
            <span>{cleanCopy(opt.label)}</span>
            {opt.count !== undefined && (
              <SafeBdi
                className={cn(
                  "rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                  active
                    ? "bg-signal-ink/15 text-signal-ink"
                    : "bg-surface-raised text-ink-muted",
                )}
              >
                {opt.count}
              </SafeBdi>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function AdminQueryState<T>({
  query,
  rows = 4,
  isEmpty,
  empty,
  children,
}: {
  query: UseQueryResult<T, Error> | UseInfiniteQueryResult<T, Error>;
  rows?: number;
  isEmpty?: (data: T) => boolean;
  empty?: string;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation("admin");
  const isInfinite = "fetchNextPage" in query;

  if (query.isPending) {
    return (
      <div className="space-y-2.5" aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="h-16 rounded-xl border border-hairline bg-surface animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <AtlasError
        title={t("kit.error")}
        {...(query.error?.message ? { body: query.error.message } : {})}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const data = query.data;
  if (data === undefined || (isEmpty && isEmpty(data))) {
    return (
      <AtlasEmpty
        title={cleanCopy(empty ?? t("kit.empty"))}
        action={
          <AtlasButton
            variant="secondary"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("kit.retry")}
          </AtlasButton>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {children(data)}
      {isInfinite && query.hasNextPage && (
        <div className="flex justify-center pt-2">
          <AtlasButton
            variant="secondary"
            size="sm"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            <ChevronDown className="h-4 w-4" />
            {query.isFetchingNextPage ? t("kit.working") : t("places.next")}
          </AtlasButton>
        </div>
      )}
    </div>
  );
}

export function AdminSplitWorkbench({
  list,
  detail,
  detailTitle,
  placeholder,
  onClose,
}: {
  list: ReactNode;
  detail: ReactNode | null;
  detailTitle: string;
  placeholder: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("admin");
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, onClose]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <div className="lg:col-span-5 min-w-0">{list}</div>

      {/* Desktop sticky inspector */}
      <div className="hidden lg:block lg:col-span-7 sticky top-6 min-w-0">
        {detail ? (
          <AtlasPanel className="space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-hairline pb-3">
              <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                {cleanCopy(detailTitle)}
              </h3>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("kit.cancel")}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-raised hover:text-ink cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {detail}
          </AtlasPanel>
        ) : (
          <div className="rounded-xl border border-dashed border-hairline-strong bg-surface/60 px-6 py-16 text-center text-sm text-ink-muted">
            {cleanCopy(placeholder)}
          </div>
        )}
      </div>

      {/* Mobile / tablet slide-over sheet when an item is selected */}
      {detail && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={cleanCopy(detailTitle)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 lg:hidden"
          onClick={onClose}
        >
          <div
            className="w-full sm:max-w-2xl max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-hairline-strong bg-surface p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-hairline pb-3">
              <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                {cleanCopy(detailTitle)}
              </h3>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("kit.cancel")}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-raised hover:text-ink cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {detail}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  reasonMode = "optional",
  reasonLabel,
  reasonPlaceholder,
  confirmTextToType,
  confirmTextHint,
  pending = false,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  confirmLabel: string;
  destructive?: boolean | undefined;
  reasonMode?: "none" | "optional" | "required" | undefined;
  reasonLabel?: string | undefined;
  reasonPlaceholder?: string | undefined;
  confirmTextToType?: string | undefined;
  confirmTextHint?: string | undefined;
  pending?: boolean | undefined;
  children?: ReactNode;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const { t } = useTranslation("admin");
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) {
      setReason("");
      setTyped("");
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onOpenChange]);

  if (!open) return null;

  const reasonOk = reasonMode !== "required" || reason.trim().length > 0;
  const typedOk =
    !confirmTextToType ||
    typed.trim().toLowerCase() === confirmTextToType.trim().toLowerCase();

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={() => !pending && onOpenChange(false)}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-hairline-strong bg-surface p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {destructive && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-hazard-extreme-soft text-hazard-extreme-ink">
              <AlertTriangle className="h-4 w-4" />
            </span>
          )}
          <div className="space-y-1 min-w-0 flex-1">
            <h3 className="font-display text-lg font-semibold text-ink">
              {cleanCopy(title)}
            </h3>
            {description && (
              <p className="text-xs text-ink-secondary leading-relaxed">
                {cleanCopy(description)}
              </p>
            )}
          </div>
        </div>

        {children}

        {reasonMode !== "none" && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-ink-secondary">
              {cleanCopy(reasonLabel ?? t("kit.reason"))}
              {reasonMode === "required" ? " *" : ""}
            </label>
            <AtlasTextarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={cleanCopy(reasonPlaceholder ?? t("kit.reasonHint"))}
            />
          </div>
        )}

        {confirmTextToType && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-ink-secondary">
              {cleanCopy(confirmTextHint ?? confirmTextToType)}
            </label>
            <AtlasInput
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmTextToType}
              autoComplete="off"
              dir="ltr"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-hairline pt-3">
          <AtlasButton
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t("kit.cancel")}
          </AtlasButton>
          <AtlasButton
            variant={destructive ? "danger" : "primary"}
            size="sm"
            disabled={pending || !reasonOk || !typedOk}
            onClick={() => void onConfirm(reason.trim())}
          >
            {pending ? t("kit.working") : cleanCopy(confirmLabel)}
          </AtlasButton>
        </div>
      </div>
    </div>
  );
}
