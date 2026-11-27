import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import type { AnyLocale } from "@/i18n";
import {
  INCIDENT_FILTERS,
  INCIDENT_STATUSES,
  editIncident,
  officialIncidentsQuery,
  type IncidentFilter,
  type IncidentStatus,
  type OfficialIncident,
} from "@/lib/admin-incidents";
import { unitName } from "@/lib/nadhir";
import { cn } from "@/lib/utils";
import {
  ADMIN_TONE_BAR,
  AdminBadge,
  AdminConfirmDialog,
  AdminFilterTabs,
  AdminHeader,
  AdminQueryState,
  AdminSplitWorkbench,
  AdminWhen,
  type AdminTone,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import { AtlasButton, AtlasSelect } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/incidents")({
  component: IncidentsPage,
});

function incidentTone(status: string): AdminTone {
  if (status === "ongoing") return "bad";
  if (status === "contained" || status === "monitoring") return "warn";
  if (status === "extinguished" || status === "cleared") return "ok";
  return "neutral";
}

function incidentPlace(inc: OfficialIncident, locale: AnyLocale): string {
  const parts = [
    inc.commune ? unitName(inc.commune, locale) : null,
    inc.wilaya ? unitName(inc.wilaya, locale) : null,
  ].filter(Boolean);
  return cleanCopy(parts.join(" · ") || inc.place_text || "-");
}

function IncidentInspector({
  incident,
  locale,
}: {
  incident: OfficialIncident;
  locale: AnyLocale;
}) {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [nextStatus, setNextStatus] = useState<IncidentStatus>(
    (INCIDENT_STATUSES as readonly string[]).includes(incident.status)
      ? (incident.status as IncidentStatus)
      : "ongoing",
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mut = useMutation({
    mutationFn: (reason: string) =>
      editIncident(incident.id, { status: nextStatus }, reason || null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "incidents"] });
      toast.success(t("incidents.saved"));
      setConfirmOpen(false);
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  const tone = incidentTone(incident.status);
  const sourceUrl = incident.latest_mention?.document?.url;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <AdminBadge tone={tone} dot>
            {t(`incidents.status_${incident.status}`, {
              defaultValue: incident.status,
            })}
          </AdminBadge>
          <AdminBadge tone="info">
            {t(`incidents.kind_${incident.kind}`, {
              defaultValue: incident.kind,
            })}
          </AdminBadge>
          {incident.unlisted_at && (
            <AdminBadge tone="neutral">{t("incidents.unlisted")}</AdminBadge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link
            to="/incident/$id"
            params={{ id: incident.id }}
            className="inline-flex items-center gap-1 font-medium text-signal hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("publication.view")}
          </Link>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-signal hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("incidents.openSource")}
            </a>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-hairline bg-surface-raised/50 p-3.5 text-xs">
        <div>
          <dt className="text-ink-muted">{t("incidents.place")}</dt>
          <dd className="mt-0.5 font-medium text-ink">
            {incidentPlace(incident, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("incidents.authority")}</dt>
          <dd className="mt-0.5 font-medium text-ink">
            {t(`incidents.tier_${incident.authority_tier}`, {
              defaultValue: incident.authority_tier,
            })}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("incidents.firstReported")}</dt>
          <dd className="mt-0.5 text-ink">
            <AdminWhen at={incident.first_reported_at} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("incidents.lastReported")}</dt>
          <dd className="mt-0.5 text-ink">
            <AdminWhen at={incident.last_reported_at} />
          </dd>
        </div>
      </dl>

      {incident.evidence && (
        <div className="rounded-xl border border-hairline bg-canvas/60 p-3.5 text-sm text-ink leading-relaxed whitespace-pre-wrap">
          {cleanCopy(incident.evidence)}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-hairline pt-4">
        <div className="flex-1 min-w-44 space-y-1.5">
          <label className="text-xs font-medium text-ink-secondary">
            {t("incidents.changeStatus")}
          </label>
          <AtlasSelect
            value={nextStatus}
            onChange={(e) => setNextStatus(e.target.value as IncidentStatus)}
          >
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`incidents.status_${s}`)}
              </option>
            ))}
          </AtlasSelect>
        </div>
        <AtlasButton
          variant="primary"
          size="sm"
          disabled={nextStatus === incident.status}
          onClick={() => setConfirmOpen(true)}
        >
          <ShieldCheck className="h-4 w-4" />
          {t("incidents.changeStatus")}
        </AtlasButton>
      </div>

      <AdminConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("incidents.changeTitle", {
          status: t(`incidents.status_${nextStatus}`),
        })}
        description={t("incidents.changeDescription")}
        confirmLabel={t("incidents.changeStatus")}
        reasonMode="optional"
        pending={mut.isPending}
        onConfirm={async (reason) => {
          await mut.mutateAsync(reason);
        }}
      />
    </div>
  );
}

function IncidentsPage() {
  const { t, i18n } = useTranslation("admin");
  const locale = (i18n.language || "fr") as AnyLocale;
  const [filter, setFilter] = useState<IncidentFilter>("listed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useInfiniteQuery(officialIncidentsQuery(filter));
  const selected = query.data?.find((i) => i.id === selectedId) ?? null;

  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.reference")}
        title={t("incidents.title")}
        description={t("incidents.subtitle")}
      />

      <div className="mb-5">
        <AdminFilterTabs
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setSelectedId(null);
          }}
          options={INCIDENT_FILTERS.map((f) => ({
            value: f,
            label: t(`incidents.filter_${f}`),
          }))}
        />
      </div>

      <AdminQueryState
        query={query}
        isEmpty={(rows) => rows.length === 0}
        empty={t("incidents.empty")}
      >
        {(rows) => (
          <AdminSplitWorkbench
            detailTitle={t("incidents.detail")}
            placeholder={t("incidents.placeholder")}
            onClose={() => setSelectedId(null)}
            detail={
              selected ? (
                <IncidentInspector
                  key={selected.id}
                  incident={selected}
                  locale={locale}
                />
              ) : null
            }
            list={
              <ul className="space-y-2">
                {rows.map((inc) => {
                  const tone = incidentTone(inc.status);
                  const active = inc.id === selectedId;
                  return (
                    <li key={inc.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(inc.id)}
                        className={cn(
                          "flex w-full items-stretch overflow-hidden rounded-xl border text-start transition-colors cursor-pointer",
                          active
                            ? "border-signal bg-signal-soft/40"
                            : "border-hairline bg-surface hover:border-hairline-strong",
                        )}
                      >
                        <span
                          className={cn("w-1 shrink-0", ADMIN_TONE_BAR[tone])}
                        />
                        <div className="flex-1 px-3.5 py-3 space-y-1.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <AdminBadge tone={tone}>
                              {t(`incidents.status_${inc.status}`, {
                                defaultValue: inc.status,
                              })}
                            </AdminBadge>
                            <span className="text-xs font-medium text-ink-secondary">
                              {t(`incidents.kind_${inc.kind}`, {
                                defaultValue: inc.kind,
                              })}
                            </span>
                            <span className="ms-auto text-[11px] text-ink-muted">
                              <AdminWhen at={inc.last_reported_at} />
                            </span>
                          </div>
                          <div className="truncate text-sm font-medium text-ink">
                            {incidentPlace(inc, locale)}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            }
          />
        )}
      </AdminQueryState>
    </section>
  );
}
