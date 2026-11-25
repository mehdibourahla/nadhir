import { Check, Copy, MapPin } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { bearingLabel } from "@/lib/nadhir";
import type { PositionCard } from "@/lib/survival";

type Props = {
  card: PositionCard | null;
  online: boolean;
  positionDenied: boolean;
  compact?: boolean;
};

export function PositionCardBlock({
  card,
  online,
  positionDenied,
  compact = false,
}: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const fallbackPlace = !card
    ? positionDenied
      ? t("survival.positionUnknown")
      : t("track3.emergency.gpsWaiting")
    : online
      ? t("track3.emergency.notAvailable")
      : t("track3.emergency.notAvailableOffline");

  const communeLabel = card?.commune
    ? card.wilaya
      ? `${card.commune}, ${card.wilaya}`
      : card.commune
    : fallbackPlace;

  const nearestLabel = card?.nearest
    ? `${t("survival.sosNearestValue", {
        km: card.nearest.km.toFixed(1),
        place: card.nearest.name,
      })} (${t(`survival.dir.${bearingLabel(card.nearest.bearing).toLowerCase()}`)})`
    : fallbackPlace;

  const copyCoords = async () => {
    if (
      !card?.coords ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    )
      return;
    try {
      await navigator.clipboard.writeText(card.coords);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      data-position-card="true"
      className="card-raised flex flex-col overflow-hidden text-start"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <MapPin aria-hidden className="size-3.5 shrink-0" />
          <span>{t("survival.sosPosition")}</span>
        </h2>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
          {card
            ? t("track3.emergency.gpsActive")
            : positionDenied
              ? t("survival.positionUnknown")
              : t("track3.emergency.gpsWaiting")}
        </span>
      </div>

      <dl>
        <div className="flex items-baseline justify-between gap-3 border-t border-border px-4 py-3">
          <dt className="shrink-0 text-xs text-muted-foreground">
            {t("survival.sosCommune")}
          </dt>
          <dd
            dir="auto"
            className="text-end text-sm font-semibold sm:text-base"
          >
            {communeLabel}
          </dd>
        </div>

        {!compact && (
          <div className="flex items-baseline justify-between gap-3 border-t border-border px-4 py-3">
            <dt className="shrink-0 text-xs text-muted-foreground">
              {t("survival.sosNearest")}
            </dt>
            <dd
              dir="auto"
              className="text-end text-sm font-semibold sm:text-base"
            >
              {nearestLabel}
            </dd>
          </div>
        )}

        <div className="flex items-baseline justify-between gap-3 border-t border-border px-4 py-3">
          <dt className="shrink-0 text-xs text-muted-foreground">
            {t("survival.sosCoords")}
          </dt>
          <dd
            dir="ltr"
            className="tabular text-end text-sm font-semibold sm:text-base"
          >
            {card?.coords ??
              (positionDenied
                ? t("survival.positionUnknown")
                : t("track3.emergency.gpsWaiting"))}
          </dd>
        </div>
      </dl>

      {card?.coords ? (
        <div className="border-t border-border px-4 py-2">
          <button
            type="button"
            onClick={() => void copyCoords()}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            {copied ? (
              <Check aria-hidden className="size-4 shrink-0" />
            ) : (
              <Copy aria-hidden className="size-4 shrink-0" />
            )}
            <span>
              {copied
                ? t("track3.emergency.coordsCopied")
                : t("track3.emergency.copyCoords")}
            </span>
          </button>
          <span role="status" className="sr-only">
            {copied ? t("track3.emergency.coordsCopied") : ""}
          </span>
        </div>
      ) : null}
    </section>
  );
}
