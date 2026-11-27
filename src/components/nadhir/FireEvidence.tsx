import { useTranslation } from "react-i18next";

import type { Locale } from "@/i18n";
import { evidenceBySensor } from "@/lib/looks";
import {
  algiersTime,
  relativeTime,
  type Detection,
  type FireConfirmation,
} from "@/lib/nadhir";

type Props = {
  detections: Detection[];
  confirmation: FireConfirmation | null;
  locale: Locale;
  now: number;
};

export function FireEvidence({ detections, confirmation, locale, now }: Props) {
  const { t } = useTranslation();
  const rows = evidenceBySensor(detections);
  if (!rows.length && !confirmation) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{t("evidence.title")}</h2>
      <ul className="flex flex-col gap-2">
        {confirmation ? (
          <li className="card flex flex-col gap-1 p-2.5">
            <p className="text-sm font-medium">
              {confirmation.source?.label ?? t("official.sourceFallback")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("evidence.official", {
                status: t(`official.statuses.${confirmation.status}`),
                when: algiersTime(confirmation.as_of),
              })}
            </p>
            <blockquote
              dir="auto"
              className="border-s-2 border-border ps-2 text-xs text-muted-foreground"
            >
              {confirmation.evidence}
            </blockquote>
            {confirmation.document ? (
              <a
                href={confirmation.document.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs font-medium text-primary underline"
              >
                {t("official.viewPost")}
              </a>
            ) : null}
          </li>
        ) : null}
        {rows.map((row) => (
          <li
            key={row.sensor}
            className="card flex items-baseline justify-between gap-3 p-2.5"
          >
            <span className="text-sm font-medium">{row.sensor}</span>
            <span className="text-xs text-muted-foreground">
              {t("evidence.looks", { count: row.looks })} ·{" "}
              {algiersTime(row.firstAt)} →{" "}
              {relativeTime(row.lastAt, locale, now)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("evidence.note")}</p>
    </section>
  );
}
