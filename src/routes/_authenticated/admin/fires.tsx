import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FireDetail } from "@/components/admin/FireDetail";
import { PageHeader } from "@/components/admin/kit/PageHeader";
import { QueryState } from "@/components/admin/kit/QueryState";
import { SplitView } from "@/components/admin/kit/SplitView";
import { StatusBadge } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FIRE_STATE_TONE,
  unresolvedFiresQuery,
  usePlace,
} from "@/lib/admin-fires";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/fires")({
  component: FiresPage,
});

function FiresPage() {
  const { t } = useTranslation("admin");
  const [strongOnly, setStrongOnly] = useState(true);
  const fires = useInfiniteQuery(unresolvedFiresQuery(strongOnly));
  const place = usePlace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = fires.data?.find((fire) => fire.id === selectedId) ?? null;

  return (
    <section>
      <PageHeader title={t("fires.title")} description={t("fires.subtitle")} />
      <label className="mb-4 flex items-center gap-2 text-sm">
        <Checkbox
          checked={strongOnly}
          onCheckedChange={(value) => setStrongOnly(value === true)}
        />
        {t("fires.strongOnly")}
      </label>
      <QueryState
        query={fires}
        isEmpty={(rows) => rows.length === 0}
        empty={t("fires.empty")}
      >
        {(rows) => (
          <SplitView
            detailTitle={t("fires.detailTitle")}
            placeholder={t("fires.placeholder")}
            onClose={() => setSelectedId(null)}
            detail={
              selected ? (
                <FireDetail
                  key={selected.id}
                  fire={selected}
                  place={place(selected)}
                  onDone={() => setSelectedId(null)}
                />
              ) : null
            }
            list={
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {rows.map((fire) => (
                  <li key={fire.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(fire.id)}
                      className={cn(
                        "block w-full px-4 py-3 text-start hover:bg-muted",
                        fire.id === selectedId && "bg-muted",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <StatusBadge
                          tone={FIRE_STATE_TONE[fire.state] ?? "neutral"}
                        >
                          {t(`fires.state_${fire.state}`)}
                        </StatusBadge>
                        <span className="font-mono text-xs">
                          {fire.short_id}
                        </span>
                        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                          <When at={fire.last_detected_at} />
                        </span>
                      </span>
                      <span className="mt-1 flex gap-2 text-xs text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">
                          {place(fire)}
                        </span>
                        <span className="tabular-nums">
                          {fire.confidence === null
                            ? ""
                            : `${Math.round(fire.confidence * 100)} %`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </QueryState>
    </section>
  );
}
