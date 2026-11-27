import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PhoneCall, Save } from "lucide-react";

import type { Locale } from "@/i18n";
import { relativeTime } from "@/lib/nadhir";
import { enqueueSos, loadSosQueue, type SosEntry } from "@/lib/sos-queue";
import {
  AtlasButton,
  AtlasPanel,
  AtlasTextarea,
  SafeBdi,
} from "@/ui/primitives";
import { useSurvivalContext } from "@/ui/survival-context";

export const Route = createFileRoute("/survival/sos")({
  component: SosPage,
});

function SosPage() {
  const { t, i18n } = useTranslation();
  const locale = (
    i18n.language === "fr" || i18n.language === "en" ? i18n.language : "ar"
  ) as Locale;
  const { card, position } = useSurvivalContext();
  const [note, setNote] = useState("");
  const [queue, setQueue] = useState<SosEntry[]>(() =>
    typeof window !== "undefined" ? loadSosQueue(window.localStorage) : [],
  );

  function saveLocalSos() {
    if (typeof window === "undefined") return;
    const entry = enqueueSos(window.localStorage, {
      lat: position?.lat ?? null,
      lon: position?.lon ?? null,
      note: note.trim() || null,
    });
    setQueue((prev) => [entry, ...prev]);
    setNote("");
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <AtlasPanel className="lg:col-span-7 space-y-5">
        <a
          href="tel:14"
          className="flex items-center justify-between rounded-2xl bg-hazard-extreme px-5 py-4 text-white hover:opacity-92 transition-opacity"
        >
          <div>
            <div className="font-display text-2xl font-semibold">
              {t("survival.sosCall")}
            </div>
            <div className="text-xs text-white/90 mt-1">
              {t("survival.sosFree")}
            </div>
          </div>
          <PhoneCall className="h-7 w-7 shrink-0" />
        </a>

        <div className="space-y-2 border-t border-hairline pt-4">
          <h3 className="text-sm font-semibold text-ink">
            {t("survival.sosPosition")}
          </h3>
          {card ? (
            <div className="rounded-xl bg-surface-raised p-4 space-y-1.5 text-sm">
              {card.commune && (
                <div className="font-semibold text-ink">
                  {card.commune}
                  {card.wilaya ? ` · ${card.wilaya}` : ""}
                </div>
              )}
              <SafeBdi className="font-mono text-base font-semibold text-signal">
                {card.coords}
              </SafeBdi>
            </div>
          ) : (
            <p className="text-xs text-ink-secondary">
              {t("survival.noPosition")}
            </p>
          )}
        </div>

        <div className="space-y-3 border-t border-hairline pt-4">
          <p className="text-xs text-ink-secondary">
            {t("survival.sosQueueNote")}
          </p>
          <AtlasTextarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note..."
          />
          <AtlasButton variant="secondary" onClick={saveLocalSos}>
            <Save className="h-4 w-4" />
            Save SOS locally
          </AtlasButton>
        </div>
      </AtlasPanel>

      <AtlasPanel className="lg:col-span-5 space-y-3">
        <h3 className="font-display text-lg font-semibold text-ink">
          Local SOS log ({queue.length})
        </h3>
        {queue.length === 0 ? (
          <p className="text-xs text-ink-secondary">{t("common.none")}</p>
        ) : (
          <div className="divide-y divide-hairline">
            {queue.map((entry) => (
              <div key={entry.id} className="py-2.5 space-y-1 text-xs">
                <div className="font-medium text-ink">
                  {t("survival.sosQueued", {
                    time: relativeTime(entry.created_at, locale),
                  })}
                </div>
                {entry.note && (
                  <p className="text-ink-secondary">{entry.note}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </AtlasPanel>
    </div>
  );
}
