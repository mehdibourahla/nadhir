import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";
import { QueryState } from "@/components/admin/kit/QueryState";
import { StatusBadge } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  OPEN_AREA_PAGE,
  openAreaCountsQuery,
  openAreasQuery,
  verifyOpenArea,
} from "@/lib/admin-places";

export function OpenAreas() {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [verified, setVerified] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const counts = useQuery(openAreaCountsQuery);
  const areas = useQuery(openAreasQuery(verified, search, page));

  return (
    <div className="space-y-4">
      {counts.data ? (
        <p className="text-sm text-muted-foreground">
          {t("places.coverage", counts.data)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {[false, true].map((value) => (
          <Button
            key={String(value)}
            size="sm"
            variant={verified === value ? "default" : "outline"}
            aria-pressed={verified === value}
            onClick={() => {
              setVerified(value);
              setPage(0);
            }}
          >
            {value ? t("places.filterVerified") : t("places.filterUnverified")}
          </Button>
        ))}
        <form
          className="ms-auto"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(draft);
            setPage(0);
          }}
        >
          <Input
            type="search"
            className="h-8 w-56"
            placeholder={t("places.search")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
      </div>
      <QueryState
        query={areas}
        isEmpty={(rows) => rows.length === 0 && page === 0}
        empty={t("places.empty")}
      >
        {(rows) => (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {rows.map((area) => (
                <li
                  key={area.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {area.name ?? t("places.unnamed")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(`places.type_${area.area_type}`, {
                        defaultValue: area.area_type,
                      })}
                      {area.verified_note ? ` · ${area.verified_note}` : ""}
                    </span>
                  </span>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${area.lat}&mlon=${area.lon}#map=17/${area.lat}/${area.lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs underline"
                  >
                    {t("places.openMap")}
                    <ExternalLink aria-hidden className="size-3" />
                  </a>
                  {area.verified_at ? (
                    <StatusBadge tone="ok">
                      {t("places.verified")} · <When at={area.verified_at} />
                    </StatusBadge>
                  ) : (
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="outline">
                          {t("places.verify")}
                        </Button>
                      }
                      title={t("places.verifyTitle", {
                        name: area.name ?? t("places.unnamed"),
                      })}
                      description={t("places.verifyDescription")}
                      confirmLabel={t("places.verify")}
                      reason="optional"
                      onConfirm={async (note) => {
                        await verifyOpenArea(area.id, note);
                        toast.success(t("places.verified"));
                        await qc.invalidateQueries({
                          queryKey: ["admin", "places"],
                        });
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 text-sm">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                {t("places.previous")}
              </Button>
              <span className="tabular-nums">{page + 1}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={rows.length < OPEN_AREA_PAGE}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("places.next")}
              </Button>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
