import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";
import { StatusBadge } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  resolveFire,
  RESOLUTION_REASONS,
  type ResolutionReason,
  type UnresolvedFire,
  FIRE_STATE_TONE,
} from "@/lib/admin-fires";

export function FireDetail({
  fire,
  place,
  onDone,
}: {
  fire: UnresolvedFire;
  place: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [reason, setReason] = useState<ResolutionReason | null>(null);
  const [note, setNote] = useState("");
  const resolve = useMutation({
    mutationFn: (state: "extinguished" | "false_positive") =>
      resolveFire({
        id: fire.id,
        state,
        reason: state === "false_positive" ? reason : null,
        note: note.trim() || null,
        expectedUpdatedAt: fire.updated_at,
      }),
    onSuccess: async () => {
      toast.success(t("fires.resolved"));
      await qc.invalidateQueries({ queryKey: ["admin"] });
      onDone();
    },
  });
  const failure = (error: Error) =>
    error.message.includes("stale_write")
      ? new Error(t("fires.staleWrite"))
      : error;

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge tone={FIRE_STATE_TONE[fire.state] ?? "neutral"}>
          {t(`fires.state_${fire.state}`)}
        </StatusBadge>
        <a
          className="inline-flex items-center gap-1 underline"
          href={`/?event=fire%3A${fire.id}`}
        >
          <MapPin aria-hidden className="size-3.5" />
          {t("fires.openMap")}
        </a>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t("fires.place")}</dt>
        <dd>{place}</dd>
        <dt className="text-muted-foreground">{t("fires.firstSeen")}</dt>
        <dd>
          <When at={fire.first_detected_at} />
        </dd>
        <dt className="text-muted-foreground">{t("fires.lastSeen")}</dt>
        <dd>
          <When at={fire.last_detected_at} />
        </dd>
        <dt className="text-muted-foreground">{t("fires.detections")}</dt>
        <dd className="tabular-nums">
          {fire.detection_count ?? t("empty.unknown")}
        </dd>
        <dt className="text-muted-foreground">{t("fires.confidence")}</dt>
        <dd className="tabular-nums">
          {fire.confidence === null
            ? t("empty.unknown")
            : `${Math.round(fire.confidence * 100)} %`}
        </dd>
        <dt className="text-muted-foreground">{t("fires.frp")}</dt>
        <dd className="tabular-nums">
          {fire.max_frp_mw === null
            ? t("empty.unknown")
            : `${fire.max_frp_mw.toFixed(1)} MW`}
        </dd>
        <dt className="text-muted-foreground">{t("fires.sources")}</dt>
        <dd>{fire.sources?.join(", ") || t("empty.unknown")}</dd>
      </dl>
      <label className="block">
        <span className="font-medium">{t("fires.note")}</span>
        <Input
          className="mt-1"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          trigger={<Button>{t("fires.markEnded")}</Button>}
          title={t("fires.endedTitle", { id: fire.short_id })}
          description={t("fires.endedDescription")}
          confirmLabel={t("fires.markEnded")}
          onConfirm={async () => {
            try {
              await resolve.mutateAsync("extinguished");
            } catch (error) {
              throw failure(error as Error);
            }
          }}
        />
      </div>
      <fieldset className="space-y-2 border-t border-border pt-4">
        <legend className="pt-4 font-medium">{t("fires.markFalse")}</legend>
        <div className="grid grid-cols-2 gap-1">
          {RESOLUTION_REASONS.map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name={`reason-${fire.id}`}
                checked={reason === value}
                onChange={() => setReason(value)}
              />
              {t(`fires.reason_${value}`)}
            </label>
          ))}
        </div>
        <ConfirmDialog
          trigger={
            <Button variant="outline" disabled={!reason}>
              {t("fires.markFalse")}
            </Button>
          }
          title={t("fires.falseTitle", { id: fire.short_id })}
          description={
            reason
              ? t("fires.falseDescription", {
                  reason: t(`fires.reason_${reason}`),
                })
              : ""
          }
          confirmLabel={t("fires.markFalse")}
          destructive
          onConfirm={async () => {
            try {
              await resolve.mutateAsync("false_positive");
            } catch (error) {
              throw failure(error as Error);
            }
          }}
        />
      </fieldset>
    </div>
  );
}
