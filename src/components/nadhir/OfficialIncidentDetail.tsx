import { useTranslation } from "react-i18next";

import type { Locale } from "@/i18n";
import {
  HAZARD_NAME,
  relativeTime,
  unitName,
  type OfficialIncident,
} from "@/lib/nadhir";
import { IncidentShareSheet } from "@/components/share/IncidentShareSheet";
import { isShareable } from "@/lib/share-card";
import { isFireKind } from "@/lib/text-sources/merge";

type Props = {
  incident: OfficialIncident;
  locale: Locale;
  now: number;
};

export function OfficialIncidentDetail({ incident, locale, now }: Props) {
  const { t } = useTranslation();
  const area = incident.commune ?? incident.wilaya;
  const post = incident.latest_mention?.document ?? null;
  const source =
    incident.latest_mention?.source?.label ?? t("official.sourceFallback");
  const fire = isFireKind(incident.kind);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t("official.eyebrow")}
      </p>
      <h2 className="text-lg font-semibold">{unitName(area, locale)}</h2>
      <p className="text-sm text-muted-foreground">
        {incident.commune
          ? t("official.inWilaya", {
              wilaya: unitName(incident.wilaya, locale),
            })
          : t("official.wilayaLevel")}
        {incident.place_text ? ` · ${incident.place_text}` : null}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {fire ? null : (
          <>
            <dt className="text-muted-foreground">{t("official.hazard")}</dt>
            <dd className="font-medium">
              {t(`reports.hazardName.${HAZARD_NAME[incident.kind] ?? "other"}`)}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">{t("official.status")}</dt>
        <dd className="font-medium">
          {t(`official.statuses.${incident.status}`)}
        </dd>
        {incident.unlisted_at ? (
          <>
            <dt className="text-muted-foreground">{t("official.listing")}</dt>
            <dd>
              {t("official.unlisted", {
                when: relativeTime(incident.unlisted_at, locale, now),
              })}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{t("official.asOf")}</dt>
        <dd>
          <time dateTime={incident.as_of}>
            {relativeTime(incident.as_of, locale, now)}
          </time>
        </dd>
        <dt className="text-muted-foreground">{t("official.reports")}</dt>
        <dd>{incident.mention_count}</dd>
        <dt className="text-muted-foreground">{t("official.source")}</dt>
        <dd>{source}</dd>
      </dl>
      <blockquote
        dir="auto"
        className="border-s-2 border-border ps-3 text-sm text-muted-foreground"
      >
        {incident.evidence}
      </blockquote>
      {post ? (
        <a
          href={post.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2"
        >
          {t("official.viewPost")}
        </a>
      ) : null}
      {isShareable(incident) ? (
        <IncidentShareSheet incident={incident} />
      ) : null}
      <p className="text-xs text-muted-foreground">
        {fire
          ? t("official.disclaimer")
          : t("officialSource.disclaimerWithSource", { source })}
      </p>
    </div>
  );
}
