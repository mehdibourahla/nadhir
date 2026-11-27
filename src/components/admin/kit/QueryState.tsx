import type {
  UseInfiniteQueryResult,
  UseQueryResult,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { LoadMore } from "@/components/LoadMore";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function QueryState<T>({
  query,
  isEmpty,
  empty,
  rows = 3,
  children,
}: {
  query: UseQueryResult<T> | UseInfiniteQueryResult<T>;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  rows?: number;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation("admin");
  if (query.isPending)
    return (
      <div className="space-y-2" aria-busy="true" aria-label={t("kit.loading")}>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  if (query.isError)
    return (
      <div
        role="alert"
        className="rounded-md border border-emergency/40 bg-emergency/5 p-3 text-sm"
      >
        <p className="font-medium">{t("kit.error")}</p>
        <p className="mt-1 break-words text-muted-foreground">
          {query.error.message}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => void query.refetch()}
        >
          {t("kit.retry")}
        </Button>
      </div>
    );
  if (isEmpty?.(query.data))
    return (
      <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {empty ?? t("kit.empty")}
      </p>
    );
  return (
    <>
      {children(query.data)}
      {"fetchNextPage" in query ? <LoadMore query={query} /> : null}
    </>
  );
}
