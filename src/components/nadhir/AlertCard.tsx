import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { AnyLocale } from "@/i18n";
import type { Alert } from "@/lib/alerts";
import type { AlertGroup } from "@/lib/alert-groups";
import {
  parseProvenancePayload,
  provenanceForWatchZoneAlert,
} from "@/lib/alert-provenance";
import type { Phase } from "@/lib/incident-lifecycle";
import { relativeTime } from "@/lib/nadhir";
import { AlertProvenance } from "@/components/nadhir/AlertProvenance";
import { RiskChip } from "@/components/nadhir/RiskChip";
import { riskSolid } from "@/components/nadhir/risk-visuals";

const KIND_LABEL: Record<Alert["kind"], string> = {
  fire: "alerts.kindFire",
  risk: "alerts.kindRisk",
  weather: "alerts.kindWeather",
  official: "alerts.kindOfficial",
  road: "alerts.kindRoad",
  citizen: "alerts.kindCitizen",
  earthquake: "alerts.kindEarthquake",
};

export type AlertCardProps = {
  group: AlertGroup;
  phase: Phase;
  locale: AnyLocale;
  zoneName: string;
  zoneRadiusKm?: number | null;
  now?: number;
  onToggleRead: () => void;
  onDelete: () => void;
};

export function AlertCard({
  group,
  phase,
  locale,
  zoneName,
  zoneRadiusKm,
  now,
  onToggleRead,
  onDelete,
}: AlertCardProps) {
  const { t } = useTranslation();
  const alert = group.latest;
  const shortId = alert.payload?.short_id;
  const earlier = group.messages.slice(1);
  const mapEvent = alert.payload?.map_event;
  const state =
    alert.kind === "risk"
      ? phase === "live"
        ? "alerts.stateToday"
        : "alerts.statePastForecast"
      : alert.kind !== "fire"
        ? phase === "live"
          ? "alerts.stateCurrentNotice"
          : "alerts.stateNoticeOver"
        : phase === "live"
          ? "alerts.stateLive"
          : phase === "fading"
            ? "civilMap.quiet"
            : phase === "ended"
              ? "civilMap.ended"
              : "civilMap.archived";

  const provenance =
    parseProvenancePayload(alert.payload) ??
    provenanceForWatchZoneAlert({
      kind: alert.kind,
      sourceTable: alert.source_table,
      severity: alert.payload?.onm_severity ?? alert.severity,
      hazard: alert.payload?.hazard,
      phase: alert.payload?.phase,
      magnitude: alert.payload?.magnitude,
      sourceAttribution: alert.payload?.authority,
      areaLabel: zoneName || null,
      radiusKm: zoneRadiusKm ?? null,
      observedAt:
        alert.payload?.occurred_at ??
        alert.payload?.last_detected_at ??
        alert.created_at,
    });

  return (
    <li
      className={`card p-4 ${group.unread ? "" : "opacity-70"}`}
      style={{
        borderInlineStartWidth: 4,
        borderInlineStartColor:
          phase === "live" ? riskSolid(alert.severity) : "var(--border)",
      }}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <RiskChip level={alert.severity} showName={false} />
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {t(KIND_LABEL[alert.kind])}
        </span>
        <h2 className="font-medium">{alert.title}</h2>
        <span className="ms-auto text-xs text-muted-foreground">
          {relativeTime(alert.created_at, locale, now)}
        </span>
      </div>
      <p className="mt-1 text-sm font-medium">{t(state)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{alert.body}</p>
      {earlier.length ? (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {t("alerts.earlier", { count: earlier.length })}
          </summary>
          <ul className="mt-1 space-y-1">
            {earlier.map((message) => (
              <li key={message.id}>
                <time dateTime={message.created_at}>
                  {relativeTime(message.created_at, locale, now)}
                </time>{" "}
                · {message.title}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        {zoneName ? (
          <span className="text-muted-foreground">{zoneName}</span>
        ) : null}
        {shortId ? (
          <Link
            to="/fire/$id"
            params={{ id: shortId }}
            className="font-medium text-primary"
          >
            {t("alerts.openFire")}
          </Link>
        ) : mapEvent ? (
          <Link
            to="/"
            search={{ event: mapEvent }}
            className="font-medium text-primary"
          >
            {t("alerts.openMap")}
          </Link>
        ) : null}
        <button
          type="button"
          onClick={onToggleRead}
          className="text-muted-foreground hover:text-foreground"
        >
          {t(group.unread ? "alerts.markRead" : "alerts.markUnread")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
        >
          {t("common.delete")}
        </button>
      </div>
      <AlertProvenance provenance={provenance} now={now} className="mt-3" />
    </li>
  );
}
