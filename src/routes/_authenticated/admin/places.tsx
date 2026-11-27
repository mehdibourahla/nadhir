import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";

import {
  OPEN_AREA_PAGE,
  openAreaCountsQuery,
  openAreasQuery,
  verifyOpenArea,
  type OpenArea,
} from "@/lib/admin-places";
import { coordLabel } from "@/lib/nadhir";
import {
  AdminBadge,
  AdminConfirmDialog,
  AdminFilterTabs,
  AdminHeader,
  AdminQueryState,
  AdminWhen,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import { AtlasButton, AtlasInput, AtlasPanel, SafeBdi } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/places")({
  component: PlacesPage,
});

function PlacesPage() {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [verifiedFilter, setVerifiedFilter] = useState<
    "unverified" | "verified"
  >("unverified");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [verifyTarget, setVerifyTarget] = useState<OpenArea | null>(null);

  const countsQ = useQuery(openAreaCountsQuery);
  const areasQ = useQuery(
    openAreasQuery(verifiedFilter === "verified", search, page),
  );

  const verifyMut = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      verifyOpenArea(id, note || null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "places"] });
      toast.success(t("sources.saved"));
      setVerifyTarget(null);
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  const total = countsQ.data?.total ?? 0;
  const verifiedCount = countsQ.data?.verified ?? 0;
  const pct = total > 0 ? Math.round((verifiedCount / total) * 100) : 0;

  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.reference")}
        title={t("places.title")}
        description={t("places.subtitle")}
        metrics={[
          {
            label: t("places.verified"),
            value: <SafeBdi>{verifiedCount}</SafeBdi>,
            tone: "clear",
          },
          {
            label: t("places.filterUnverified"),
            value: <SafeBdi>{Math.max(0, total - verifiedCount)}</SafeBdi>,
            tone: "high",
          },
          {
            label: t("places.filterVerified"),
            value: <SafeBdi>{pct}%</SafeBdi>,
            tone: "signal",
          },
        ]}
      />

      {total > 0 && (
        <AtlasPanel className="mb-5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-secondary">
              {t("places.coverage", { verified: verifiedCount, total })}
            </span>
            <SafeBdi className="font-mono font-semibold text-ink">
              {pct}%
            </SafeBdi>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full bg-hazard-clear transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </AtlasPanel>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <AdminFilterTabs
          value={verifiedFilter}
          onChange={(next) => {
            setVerifiedFilter(next);
            setPage(0);
          }}
          options={[
            { value: "unverified", label: t("places.filterUnverified") },
            { value: "verified", label: t("places.filterVerified") },
          ]}
        />

        <div className="relative flex-1 min-w-52 max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <AtlasInput
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={t("places.search")}
            className="ps-9"
          />
        </div>
      </div>

      <AdminQueryState
        query={areasQ}
        rows={6}
        isEmpty={(rows) => rows.length === 0}
        empty={t("places.empty")}
      >
        {(rows) => (
          <div className="space-y-4">
            <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface">
              {rows.map((area) => {
                const name = area.name?.trim() || t("places.unnamed");
                return (
                  <li
                    key={area.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm text-ink">
                          <SafeBdi dir="auto">{cleanCopy(name)}</SafeBdi>
                        </span>
                        <AdminBadge tone="info">
                          {t(`places.type_${area.area_type}`, {
                            defaultValue: area.area_type,
                          })}
                        </AdminBadge>
                        {area.verified_at && (
                          <AdminBadge tone="ok" dot>
                            {t("places.verified")}
                          </AdminBadge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-secondary">
                        <SafeBdi className="font-mono text-[11px] text-ink-muted">
                          {coordLabel(area.lat, area.lon)}
                        </SafeBdi>
                        <a
                          href={`https://www.openstreetmap.org/?mlat=${area.lat}&mlon=${area.lon}#map=17/${area.lat}/${area.lon}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-signal hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t("places.openMap")}
                        </a>
                        {area.verified_at && (
                          <AdminWhen at={area.verified_at} />
                        )}
                      </div>
                      {area.verified_note && (
                        <p className="text-xs text-ink-muted">
                          {cleanCopy(area.verified_note)}
                        </p>
                      )}
                    </div>

                    {!area.verified_at && (
                      <AtlasButton
                        variant="secondary"
                        size="sm"
                        onClick={() => setVerifyTarget(area)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-hazard-clear" />
                        {t("places.verify")}
                      </AtlasButton>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-end gap-2">
              <AtlasButton
                variant="secondary"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {t("places.previous")}
              </AtlasButton>
              <AtlasButton
                variant="secondary"
                size="sm"
                disabled={rows.length < OPEN_AREA_PAGE}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("places.next")}
              </AtlasButton>
            </div>
          </div>
        )}
      </AdminQueryState>

      <AdminConfirmDialog
        open={verifyTarget !== null}
        onOpenChange={(o) => !o && setVerifyTarget(null)}
        title={t("places.verifyTitle", {
          name: verifyTarget?.name?.trim() || t("places.unnamed"),
        })}
        description={t("places.verifyDescription")}
        confirmLabel={t("places.verify")}
        reasonMode="optional"
        pending={verifyMut.isPending}
        onConfirm={async (note) => {
          if (verifyTarget)
            await verifyMut.mutateAsync({ id: verifyTarget.id, note });
        }}
      />
    </section>
  );
}
