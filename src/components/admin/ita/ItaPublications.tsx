import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { QueryState } from "@/components/admin/kit/QueryState";
import { SplitView } from "@/components/admin/kit/SplitView";
import { StatusBadge, type Tone } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { Button } from "@/components/ui/button";
import {
  civilPublicationLifecycle,
  type CivilPublication,
} from "@/lib/civil-publication";
import { civilPublicationsQuery } from "@/lib/civil-publication-client";
import { cn } from "@/lib/utils";
import { PublicationForm } from "./PublicationForm";

const TONES: Record<ReturnType<typeof civilPublicationLifecycle>, Tone> = {
  active: "ok",
  expired: "neutral",
  withdrawn: "bad",
};

function Detail({
  publication,
  onDone,
}: {
  publication: CivilPublication;
  onDone: () => void;
}) {
  const { t } = useTranslation("admin");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <StatusBadge tone={TONES[civilPublicationLifecycle(publication)]}>
          {t(`publication.${civilPublicationLifecycle(publication)}`)}
        </StatusBadge>
        <a
          className="inline-flex items-center gap-1 underline"
          href={`/?event=civil%3A${publication.id}`}
        >
          <MapPin aria-hidden className="size-3.5" />
          {t("publication.view")}
        </a>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("ita.published")}</dt>
        <dd>
          <When at={publication.source_published_at} />
        </dd>
        <dt className="text-muted-foreground">{t("ita.expires")}</dt>
        <dd>
          <When at={publication.expires_at} />
        </dd>
      </dl>
      <PublicationForm
        key={`${publication.id}:${publication.revision}`}
        reportId={publication.ita_report_id}
        incidentIndex={publication.incident_index}
        summary={publication.summary}
        publishedAt={publication.source_published_at}
        publication={publication}
        onDone={onDone}
      />
    </div>
  );
}

export function ItaPublications() {
  const { t } = useTranslation("admin");
  const [page, setPage] = useState(0);
  const publications = useQuery(civilPublicationsQuery(true, page));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    publications.data?.find((item) => item.id === selectedId) ?? null;
  return (
    <QueryState
      query={publications}
      isEmpty={(rows) => rows.length === 0 && page === 0}
      empty={t("ita.publicationsEmpty")}
    >
      {(rows) => (
        <SplitView
          detailTitle={t("ita.detail")}
          placeholder={t("ita.placeholder")}
          onClose={() => setSelectedId(null)}
          detail={
            selected ? (
              <Detail
                publication={selected}
                onDone={() => setSelectedId(null)}
              />
            ) : null
          }
          list={
            <div>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {rows.map((item) => {
                  const lifecycle = civilPublicationLifecycle(item);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className={cn(
                          "block w-full px-4 py-3 text-start hover:bg-muted",
                          item.id === selectedId && "bg-muted",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <StatusBadge tone={TONES[lifecycle]}>
                            {t(`publication.${lifecycle}`)}
                          </StatusBadge>
                          <span className="truncate text-xs text-muted-foreground">
                            {t(`publication.hazards.${item.hazard}`)}
                            {item.area ? ` · ${item.area.name_fr}` : ""}
                          </span>
                          <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                            <When at={item.source_published_at} />
                          </span>
                        </span>
                        <span lang="fr" className="mt-1.5 line-clamp-2 text-sm">
                          {item.summary}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t("publication.previous")}
                </Button>
                <span className="tabular-nums">{page + 1}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rows.length < 500}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("publication.next")}
                </Button>
              </div>
            </div>
          }
        />
      )}
    </QueryState>
  );
}
