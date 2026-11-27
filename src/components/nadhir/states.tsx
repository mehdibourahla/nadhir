import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      aria-hidden
    />
  );
}

export function SkeletonList({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      role="status"
      aria-busy="true"
    >
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      {body ? (
        <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      ) : null}
      {action}
    </div>
  );
}

export function ErrorState({
  body,
  onRetry,
  className,
}: {
  body?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-2 rounded-xl px-4 py-3",
        className,
      )}
      style={{
        backgroundColor: "var(--emergency-surface)",
        color: "var(--emergency-ink)",
      }}
    >
      <p className="text-sm font-medium">{t("common.error")}</p>
      {body ? <p className="text-sm">{body}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-8 rounded-md border border-current px-3 py-1 text-sm font-medium pointer-coarse:min-h-11"
        >
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}
