import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";
import { QueryState } from "@/components/admin/kit/QueryState";
import { SplitView } from "@/components/admin/kit/SplitView";
import { StatusBadge, type Tone } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { Button } from "@/components/ui/button";
import type { AnyLocale } from "@/i18n";
import {
  editIncident,
  INCIDENT_STATUSES,
  officialIncidentsQuery,
  type IncidentStatus,
  type OfficialIncident,
  INCIDENT_FILTERS,
  type IncidentFilter,
} from "@/lib/admin-incidents";
import { unitName } from "@/lib/nadhir";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, Tone> = {
  ongoing: "bad",
  contained: "warn",
  monitoring: "warn",
  extinguished: "ok",
  cleared: "ok",
  unknown: "neutral",
};

const place = (
  incident: OfficialIncident,
  locale: AnyLocale,
  unknown: string,
) =>
  [incident.commune, incident.wilaya]
    .map((unit) => (unit ? unitName(unit, locale) : null))
    .filter(Boolean)
    .join(", ") ||
  incident.place_text ||
  unknown;

function Detail({
  incident,
  onDone,
}: {
  incident: OfficialIncident;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation("admin");
  const qc = useQueryClient();
  const [status, setStatus] = useState<IncidentStatus>(
    (INCIDENT_STATUSES as readonly string[]).includes(incident.status)
      ? (incident.status as IncidentStatus)
      : "unknown",
  );
  const url = incident.latest_mention?.document?.url;
  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge tone={STATUS_TONE[incident.status] ?? "neutral"}>
          {t(`incidents.status_${incident.status}`, {
            defaultValue: incident.status,
          })}
        </StatusBadge>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            {t("incidents.openSource")}
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t("incidents.place")}</dt>
        <dd>
          {place(incident, i18n.language as AnyLocale, t("empty.placeUnknown"))}
        </dd>
        <dt className="text-muted-foreground">{t("incidents.authority")}</dt>
        <dd>
          {t(`incidents.tier_${incident.authority_tier}`, {
            defaultValue: incident.authority_tier,
          })}
        </dd>
        <dt className="text-muted-foreground">
          {t("incidents.firstReported")}
        </dt>
        <dd>
          <When at={incident.first_reported_at} />
        </dd>
        <dt className="text-muted-foreground">{t("incidents.lastReported")}</dt>
        <dd>
          <When at={incident.last_reported_at} />
        </dd>
      </dl>
      {incident.evidence ? (
        <blockquote
          dir="auto"
          className="whitespace-pre-wrap rounded-md bg-muted p-3"
        >
          {incident.evidence}
        </blockquote>
      ) : null}
      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
        <label className="text-sm">
          <span className="font-medium">{t("incidents.status")}</span>
          <select
            className="mt-1 block h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as IncidentStatus)
            }
          >
            {INCIDENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`incidents.status_${value}`)}
              </option>
            ))}
          </select>
        </label>
        <ConfirmDialog
          trigger={
            <Button disabled={status === incident.status}>
              {t("incidents.changeStatus")}
            </Button>
          }
          title={t("incidents.changeTitle", {
            status: t(`incidents.status_${status}`),
          })}
          description={t("incidents.changeDescription")}
          confirmLabel={t("incidents.changeStatus")}
          reason="required"
          onConfirm={async (reason) => {
            await editIncident(incident.id, { status }, reason);
            toast.success(t("incidents.saved"));
            await qc.invalidateQueries({ queryKey: ["admin", "incidents"] });
            onDone();
          }}
        />
      </div>
    </div>
  );
}

export function OfficialIncidents() {
  const { t, i18n } = useTranslation("admin");
  const [filter, setFilter] = useState<IncidentFilter>("listed");
  const incidents = useInfiniteQuery(officialIncidentsQuery(filter));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const shown = incidents.data ?? [];
  const selected = shown.find((incident) => incident.id === selectedId) ?? null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {INCIDENT_FILTERS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? "default" : "outline"}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {t(`incidents.filter_${value}`)}
          </Button>
        ))}
      </div>
      <QueryState
        query={incidents}
        isEmpty={() => shown.length === 0}
        empty={t("incidents.empty")}
      >
        {() => (
          <SplitView
            detailTitle={t("incidents.detail")}
            placeholder={t("incidents.placeholder")}
            onClose={() => setSelectedId(null)}
            detail={
              selected ? (
                <Detail
                  key={selected.id}
                  incident={selected}
                  onDone={() => setSelectedId(null)}
                />
              ) : null
            }
            list={
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {shown.map((incident) => (
                  <li key={incident.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(incident.id)}
                      className={cn(
                        "block w-full px-4 py-3 text-start hover:bg-muted",
                        incident.id === selectedId && "bg-muted",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <StatusBadge
                          tone={STATUS_TONE[incident.status] ?? "neutral"}
                        >
                          {t(`incidents.status_${incident.status}`, {
                            defaultValue: incident.status,
                          })}
                        </StatusBadge>
                        <span className="text-sm font-medium">
                          {t(`incidents.kind_${incident.kind}`, {
                            defaultValue: incident.kind,
                          })}
                        </span>
                        {incident.unlisted_at ? (
                          <span className="text-xs text-muted-foreground">
                            · {t("incidents.unlisted")}
                          </span>
                        ) : null}
                        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                          <When at={incident.last_reported_at} />
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {place(
                          incident,
                          i18n.language as AnyLocale,
                          t("empty.placeUnknown"),
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </QueryState>
    </div>
  );
}
