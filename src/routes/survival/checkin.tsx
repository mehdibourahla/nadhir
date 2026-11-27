import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Copy, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { checkInMessage } from "@/lib/survival";
import { cn } from "@/lib/utils";
import { formatAlgiersClock } from "@/ui/format";
import { AtlasButton, AtlasInput, AtlasPanel } from "@/ui/primitives";
import { useSurvivalContext } from "@/ui/survival-context";

export const Route = createFileRoute("/survival/checkin")({
  component: CheckInPage,
});

function CheckInPage() {
  const { t } = useTranslation();
  const { card } = useSurvivalContext();
  const [kind, setKind] = useState<"ok" | "assist">("ok");
  const [name, setName] = useState("");

  const message = checkInMessage({
    kind,
    name: name.trim() || null,
    card,
    time: `${formatAlgiersClock()} CET`,
    t: (k, o) => (o ? t(k, o) : t(k)),
  });

  async function handleShare() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ text: message });
        return;
      } catch {
        // user cancelled or unavailable
      }
    }
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(message);
    toast.success("Copied");
  }

  return (
    <AtlasPanel className="max-w-2xl space-y-5">
      <div className="space-y-1">
        <h2 className="font-display text-2xl font-semibold text-ink">
          {t("survival.checkinTitle")}
        </h2>
        <p className="text-sm text-ink-secondary">
          {t("survival.checkinIntro")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setKind("ok")}
          className={cn(
            "flex items-start gap-3 rounded-xl border p-4 text-start transition-colors cursor-pointer",
            kind === "ok"
              ? "border-hazard-clear bg-hazard-clear-soft"
              : "border-hairline bg-surface hover:bg-surface-raised",
          )}
        >
          <CheckCircle2 className="h-5 w-5 text-hazard-clear shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-ink">
              {t("survival.checkinOk")}
            </div>
            <div className="text-xs text-ink-secondary mt-0.5">
              {t("survival.checkinOkSub")}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setKind("assist")}
          className={cn(
            "flex items-start gap-3 rounded-xl border p-4 text-start transition-colors cursor-pointer",
            kind === "assist"
              ? "border-hazard-extreme bg-hazard-extreme-soft"
              : "border-hairline bg-surface hover:bg-surface-raised",
          )}
        >
          <ShieldAlert className="h-5 w-5 text-hazard-extreme shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-ink">
              {t("survival.checkinAssist")}
            </div>
            <div className="text-xs text-ink-secondary mt-0.5">
              {t("survival.checkinAssistSub")}
            </div>
          </div>
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-ink-secondary">
          {t("authKit.name")}
        </label>
        <AtlasInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("authKit.name")}
        />
      </div>

      <div className="space-y-2">
        <div className="text-xs font-mono text-ink-muted">
          {t("survival.checkinPreview")}
        </div>
        <div className="rounded-xl border border-hairline bg-surface-raised/70 p-4 text-sm text-ink leading-relaxed">
          {message}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AtlasButton variant="primary" onClick={() => void handleShare()}>
          <Send className="h-4 w-4" />
          {t("survival.checkinSend")}
        </AtlasButton>
        <AtlasButton variant="secondary" onClick={() => void handleCopy()}>
          <Copy className="h-4 w-4" />
          Copy
        </AtlasButton>
      </div>

      <p className="text-xs text-ink-muted">{t("survival.checkinNote")}</p>
    </AtlasPanel>
  );
}
