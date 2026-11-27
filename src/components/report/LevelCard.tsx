import { useQuery } from "@tanstack/react-query";
import { Award } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ErrorState, SkeletonList } from "@/components/nadhir/states";
import { badgesFor, levelFor, nextBadge } from "@/lib/contribution";
import { contributionQuery } from "@/lib/reports";
import { cn } from "@/lib/utils";

export function LevelCard() {
  const { t } = useTranslation();
  const contribution = useQuery(contributionQuery);

  if (contribution.isPending) return <SkeletonList rows={2} />;
  if (contribution.isError)
    return <ErrorState onRetry={() => void contribution.refetch()} />;

  const c = contribution.data;
  const level = levelFor(c.points);
  const next = nextBadge(c);
  return (
    <section aria-labelledby="level-title" className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="level-title" className="font-display text-xl">
          {t(`reports.level.${level.current}`)}
        </h2>
        <span className="tabular text-sm text-muted-foreground">
          {t("reports.points", { count: c.points })}
        </span>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level.progress * 100)}
        aria-label={t(`reports.level.${level.current}`)}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${level.progress * 100}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {level.next
          ? t("reports.toNext", {
              count: level.toNext,
              level: t(`reports.level.${level.next}`),
            })
          : t("reports.topLevel")}
      </p>

      {next ? (
        <p className="mt-3 text-sm">
          {t("reports.nextBadge", {
            badge: t(`reports.badge.${next.key}`),
            have: next.have,
            need: next.need,
          })}
        </p>
      ) : null}

      <ul className="mt-3 flex flex-wrap gap-2">
        {badgesFor(c).map((b) => (
          <li
            key={b.key}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
              b.earned
                ? "border-transparent bg-primary/10 font-medium"
                : "border-dashed border-border text-muted-foreground",
            )}
          >
            <Award aria-hidden className="size-3.5" />
            {t(`reports.badge.${b.key}`)}
          </li>
        ))}
      </ul>

      <ul className="mt-4 grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["statConfirmed", c.corroborated],
            ["statGiven", c.confirmations],
            ["statAlerted", c.alerted],
          ] as const
        ).map(([key, value]) => (
          <li key={key} className="rounded-lg bg-muted px-2 py-2">
            <span className="tabular block font-display text-lg">{value}</span>
            <span className="text-xs text-muted-foreground">
              {t(`reports.${key}`)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        {t("reports.howPoints")}
      </p>
    </section>
  );
}
