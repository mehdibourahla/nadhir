import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CivilDecision } from "@/lib/civil-agent";
import {
  CIVIL_PUBLICATION_MAX_AGE_HOURS,
  type CivilPublication,
} from "@/lib/civil-publication";
import {
  publishItaPublication,
  reviseCivilPublication,
} from "@/lib/civil-publication-client";
import { civilDefaultExpiry } from "@/lib/incident-lifecycle";
import { AreaPicker } from "./AreaPicker";

const HAZARDS = ["fire", "weather", "flood", "road", "other"] as const;

function localDate(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function PublicationForm({
  reportId,
  incidentIndex,
  summary: initialSummary,
  publishedAt,
  publication,
  suggestion,
  onDone,
}: {
  reportId: string;
  incidentIndex: number;
  summary: string;
  publishedAt: string;
  publication?: CivilPublication | undefined;
  suggestion?: CivilDecision | null | undefined;
  onDone?: () => void;
}) {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [summary, setSummary] = useState(
    publication?.summary ?? suggestion?.summary ?? initialSummary,
  );
  const [hazard, setHazard] = useState<CivilPublication["hazard"]>(
    publication?.hazard ?? suggestion?.hazard ?? "road",
  );
  const [areaId, setAreaId] = useState(
    publication?.area_id ?? suggestion?.area_id ?? "",
  );
  const maximum =
    Date.parse(publishedAt) + CIVIL_PUBLICATION_MAX_AGE_HOURS * 3_600_000;
  const [expires, setExpires] = useState(() =>
    localDate(
      publication?.expires_at ??
        civilDefaultExpiry(publishedAt, hazard, Date.now()),
    ),
  );
  const [expiresEdited, setExpiresEdited] = useState(false);
  const [reason, setReason] = useState("");

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["civil-publications"] });
    await qc.invalidateQueries({ queryKey: ["admin", "civil-attention"] });
    await qc.invalidateQueries({ queryKey: ["admin", "ita"] });
    await qc.invalidateQueries({ queryKey: ["admin", "attention"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error(t("publication.reasonRequired"));
      const expiresAt = new Date(expires).toISOString();
      if (publication)
        return reviseCivilPublication({
          id: publication.id,
          expectedRevision: publication.revision,
          action: "update",
          patch: { summary, hazard, area_id: areaId, expires_at: expiresAt },
          reason,
        });
      return publishItaPublication({
        reportId,
        incidentIndex,
        hazard,
        summary,
        areaId,
        expiresAt,
        reason,
      });
    },
    onSuccess: async () => {
      toast.success(t("publication.saved"));
      await refresh();
      onDone?.();
    },
  });

  if (publication?.state === "withdrawn")
    return (
      <p className="text-sm text-muted-foreground">
        {t("publication.withdrawnExplanation")}
      </p>
    );

  const tooOld = maximum <= Date.now();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-xs text-muted-foreground">{t("publication.policy")}</p>
      <label className="block text-sm">
        <span className="font-medium">{t("publication.summary")}</span>
        <Textarea
          lang="fr"
          required
          maxLength={2000}
          className="mt-1"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">{t("publication.hazard")}</span>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={hazard}
            onChange={(event) => {
              const next = event.target.value as CivilPublication["hazard"];
              setHazard(next);
              if (!publication && !expiresEdited)
                setExpires(
                  localDate(civilDefaultExpiry(publishedAt, next, Date.now())),
                );
            }}
          >
            {HAZARDS.map((value) => (
              <option key={value} value={value}>
                {t(`publication.hazards.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t("publication.expires")}</span>
          <Input
            className="mt-1"
            type="datetime-local"
            required
            max={localDate(new Date(maximum).toISOString())}
            value={expires}
            onChange={(event) => {
              setExpires(event.target.value);
              setExpiresEdited(true);
            }}
          />
        </label>
      </div>
      <div className="text-sm">
        <span className="font-medium">{t("publication.area")}</span>
        <div className="mt-1">
          <AreaPicker value={areaId} onChange={setAreaId} />
        </div>
      </div>
      <label className="block text-sm">
        <span className="font-medium">{t("publication.reason")}</span>
        <Textarea
          required
          maxLength={1000}
          className="mt-1"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {save.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      ) : null}
      {tooOld ? (
        <p className="text-sm text-muted-foreground">
          {t("publication.tooOld")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending || tooOld || !areaId}>
          {save.isPending
            ? t("kit.working")
            : t(publication ? "publication.save" : "publication.publish")}
        </Button>
        {publication ? (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="outline">
                {t("publication.withdraw")}
              </Button>
            }
            title={t("publication.withdraw")}
            description={t("publication.withdrawConfirm")}
            confirmLabel={t("publication.withdraw")}
            destructive
            reason="required"
            onConfirm={async (why) => {
              await reviseCivilPublication({
                id: publication.id,
                expectedRevision: publication.revision,
                action: "withdraw",
                reason: why ?? "",
              });
              toast.success(t("publication.saved"));
              await refresh();
              onDone?.();
            }}
          />
        ) : null}
      </div>
    </form>
  );
}
