import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { EmergencyDialBar } from "@/components/survival/EmergencyDialBar";
import { PositionCardBlock } from "@/components/survival/PositionCardBlock";
import { useSurvival } from "@/components/survival/survival-context";
import type { Locale } from "@/i18n";
import { relativeTime } from "@/lib/nadhir";
import { enqueueSos, loadSosQueue, type SosEntry } from "@/lib/sos-queue";

export const Route = createFileRoute("/survival/sos")({
  component: SosPage,
});

function SosPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const { online, position, positionDenied, positionCardData } = useSurvival();
  const [storageFailed, setStorageFailed] = useState(false);

  const [queue, setQueue] = useState<SosEntry[]>(() =>
    (() => {
      try {
        return loadSosQueue(localStorage);
      } catch {
        return [];
      }
    })(),
  );

  const saveOfflineNote = () => {
    try {
      enqueueSos(localStorage, {
        lat: position?.lat ?? null,
        lon: position?.lon ?? null,
        note: null,
      });
      setQueue(loadSosQueue(localStorage));
    } catch {
      setStorageFailed(true);
    }
  };

  const onCall = () => {
    if (!online) {
      saveOfflineNote();
    }
  };

  return (
    <>
      {storageFailed ? (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm">
          {t("survival.packStorageFailed")}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Link
          to="/survival"
          className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted"
          aria-label={t("common.back")}
        >
          <ChevronLeft aria-hidden className="size-5 rtl:rotate-180" />
        </Link>
        <h1 className="font-display text-xl">{t("survival.sos")}</h1>
      </div>

      <PositionCardBlock
        card={positionCardData}
        online={online}
        positionDenied={positionDenied}
      />

      <section className="mt-auto flex flex-col gap-2.5">
        <EmergencyDialBar onCall14={onCall} />

        <button
          type="button"
          onClick={saveOfflineNote}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted"
        >
          {t("track3.emergency.sosSaveOfflineNote")}
        </button>

        {queue.filter((e) => !e.sent).length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {queue
              .filter((e) => !e.sent)
              .map((e) => (
                <li
                  key={e.id}
                  className="tabular rounded-lg px-3 py-2 text-xs font-medium"
                  style={{
                    backgroundColor: "var(--risk-tint-2)",
                    color: "var(--risk-ink-2)",
                  }}
                >
                  {t("survival.sosQueued", {
                    time: relativeTime(e.created_at, locale),
                  })}
                </li>
              ))}
          </ul>
        ) : null}

        <p
          className="flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-[13px] leading-relaxed"
          style={{
            backgroundColor: "var(--risk-tint-2)",
            color: "var(--risk-ink-2)",
          }}
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("survival.sosQueueNote")}
        </p>
      </section>
    </>
  );
}
