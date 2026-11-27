import { Link, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, ChevronLeft, Share2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useSurvival } from "@/components/survival/survival-context";
import { checkInMessage } from "@/lib/survival";
import { NATIVE } from "@/lib/platform";

export const Route = createFileRoute("/survival/checkin")({
  component: CheckInPage,
});

function CheckInPage() {
  const { t } = useTranslation();
  const { positionCardData: card } = useSurvival();
  const [kind, setKind] = useState<"ok" | "assist">("ok");

  // Built at render AND at send time, so a page left open never sends a stale timestamp.
  const composeMessage = () => {
    const time = new Intl.DateTimeFormat("fr-DZ", {
      timeZone: "Africa/Algiers",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
    return checkInMessage({
      kind,
      name: null,
      card,
      time,
      t: (k, o) => (o ? t(k, o) : t(k)),
    });
  };
  const message = composeMessage();

  const onSend = () => {
    const fresh = composeMessage();
    const sms = () => {
      window.location.href = `sms:?&body=${encodeURIComponent(fresh)}`;
    };
    if (NATIVE) {
      void import("@/lib/native-share")
        .then(({ shareText }) => shareText(fresh))
        .catch(sms);
      return;
    }
    if (navigator.share) {
      void navigator.share({ text: fresh }).catch(() => undefined);
    } else {
      sms();
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          to="/survival"
          className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted"
          aria-label={t("common.back")}
        >
          <ChevronLeft aria-hidden className="size-5 rtl:rotate-180" />
        </Link>
        <h1 className="font-display text-xl">{t("survival.checkinTitle")}</h1>
      </div>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {t("survival.checkinIntro")}
      </p>

      <button
        type="button"
        onClick={() => setKind("ok")}
        aria-pressed={kind === "ok"}
        className="flex min-h-14 items-center gap-3 rounded-xl border p-4 text-start"
        style={
          kind === "ok"
            ? {
                backgroundColor: "var(--accent-tint)",
                borderColor: "var(--accent)",
              }
            : {
                borderColor: "var(--border)",
                backgroundColor: "var(--surface)",
              }
        }
      >
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--surface)", color: "var(--accent)" }}
        >
          <CheckCircle2 aria-hidden className="size-5" />
        </span>
        <span className="flex flex-col gap-0.5">
          <span
            className="text-base font-bold"
            style={kind === "ok" ? { color: "var(--accent)" } : undefined}
          >
            {t("survival.checkinOk")}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("survival.checkinOkSub")}
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => setKind("assist")}
        aria-pressed={kind === "assist"}
        className="flex min-h-14 items-center gap-3 rounded-xl border p-4 text-start"
        style={
          kind === "assist"
            ? {
                backgroundColor: "var(--emergency-surface)",
                borderColor: "var(--emergency)",
              }
            : {
                borderColor: "var(--border)",
                backgroundColor: "var(--surface)",
              }
        }
      >
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full"
          style={{
            backgroundColor: "var(--surface)",
            color: "var(--emergency)",
          }}
        >
          <TriangleAlert aria-hidden className="size-5" />
        </span>
        <span className="flex flex-col gap-0.5">
          <span
            className="text-base font-bold"
            style={
              kind === "assist" ? { color: "var(--emergency-ink)" } : undefined
            }
          >
            {t("survival.checkinAssist")}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("survival.checkinAssistSub")}
          </span>
        </span>
      </button>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-muted-foreground">
          {t("survival.checkinPreview")}
        </h2>
        <p
          dir="auto"
          className="rounded-lg bg-muted px-3.5 py-3 text-sm leading-relaxed"
        >
          {message}
        </p>
        {card?.coords ? (
          <p className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              {t("survival.sosCoords")}
            </span>
            <span dir="ltr" className="tabular font-semibold">
              {card.coords}
            </span>
          </p>
        ) : null}
      </section>

      <div className="mt-auto flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onSend}
          className="flex h-14 items-center justify-center gap-2.5 rounded-xl bg-primary text-base font-bold text-primary-foreground disabled:opacity-50"
        >
          <Share2 aria-hidden className="size-5" />
          {t("survival.checkinSend")}
        </button>
        <p className="px-2 text-center text-xs leading-relaxed text-muted-foreground">
          {t("survival.checkinNote")}
        </p>
      </div>
    </>
  );
}
