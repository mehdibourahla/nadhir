import { Link } from "@tanstack/react-router";
import {
  Activity,
  CloudLightning,
  Flame,
  MessageSquare,
  Route as Road,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AnyLocale } from "@/i18n";
import type { Alert } from "@/lib/alerts";
import type { AlertGroup } from "@/lib/alert-groups";
import {
  parseProvenancePayload,
  provenanceForWatchZoneAlert,
} from "@/lib/alert-provenance";
import type { Phase } from "@/lib/incident-lifecycle";
import { algiersTime, relativeTime } from "@/lib/nadhir";
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

const KIND_ICON: Record<Alert["kind"], typeof Flame> = {
  fire: Flame,
  risk: TriangleAlert,
  weather: CloudLightning,
  official: ShieldCheck,
  road: Road,
  citizen: MessageSquare,
  earthquake: Activity,
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

  const KindIcon = KIND_ICON[alert.kind] ?? TriangleAlert;
  const algiersClock = algiersTime(alert.created_at);

  return (
    <li
      className="card p-4 text-start"
      style={{
        borderInlineStartWidth: 4,
        borderInlineStartColor: group.unread
          ? phase === "live"
            ? riskSolid(alert.severity)
            : "var(--accent)"
          : "var(--border)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <RiskChip level={alert.severity} showName />
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
          <KindIcon aria-hidden className="size-3.5 shrink-0" />
          <span>{t(KIND_LABEL[alert.kind])}</span>
        </span>
        {group.unread ? (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{
              backgroundColor: "var(--accent-tint)",
              color: "var(--accent)",
            }}
          >
            {t("track3.ui.unreadBadge")}
          </span>
        ) : null}
        <time
          dateTime={alert.created_at}
          className="ms-auto tabular-nums text-xs text-muted-foreground"
        >
          {algiersClock ? `${algiersClock} · ` : ""}
          {relativeTime(alert.created_at, locale, now)}
        </time>
      </div>

      <h2
        dir="auto"
        className="mt-2 break-words text-base font-semibold leading-snug text-foreground"
      >
        {alert.title}
      </h2>

      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        {zoneName ? (
          <>
            <span dir="auto" className="font-medium text-foreground">
              {zoneName}
            </span>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <span dir="auto" className="font-medium text-foreground">
          {provenance.sourceAttribution}
        </span>
        <span aria-hidden>·</span>
        <span>{t(state)}</span>
      </p>

      <p dir="auto" className="mt-1.5 text-sm text-muted-foreground">
        {alert.body}
      </p>

      {earlier.length ? (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-foreground">
            {t("alerts.earlier", { count: earlier.length })}
          </summary>
          <ul className="mt-1 space-y-1">
            {earlier.map((message) => (
              <li key={message.id}>
                <time dateTime={message.created_at} className="tabular-nums">
                  {relativeTime(message.created_at, locale, now)}
                </time>{" "}
                · <span dir="auto">{message.title}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {shortId ? (
          <Link
            to="/fire/$id"
            params={{ id: shortId }}
            className="inline-flex min-h-11 items-center rounded-md px-2.5 font-medium text-primary hover:bg-muted"
          >
            {t("alerts.openFire")}
          </Link>
        ) : mapEvent ? (
          <Link
            to="/"
            search={{ event: mapEvent }}
            className="inline-flex min-h-11 items-center rounded-md px-2.5 font-medium text-primary hover:bg-muted"
          >
            {t("alerts.openMap")}
          </Link>
        ) : null}
        <button
          type="button"
          onClick={onToggleRead}
          className="inline-flex min-h-11 items-center rounded-md px-2.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {t(group.unread ? "alerts.markRead" : "alerts.markUnread")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex min-h-11 items-center rounded-md px-2.5 font-medium text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          {t("common.delete")}
        </button>
      </div>
      <AlertProvenance provenance={provenance} now={now} className="mt-3" />
    </li>
  );
}
