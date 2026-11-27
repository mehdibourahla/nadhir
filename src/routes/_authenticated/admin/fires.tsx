import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, Flame, ShieldOff, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import {
  FIRE_STATE_TONE,
  RESOLUTION_REASONS,
  resolveFire,
  unresolvedFiresQuery,
  usePlace,
  type ResolutionReason,
  type UnresolvedFire,
} from "@/lib/admin-fires";
import { coordLabel } from "@/lib/nadhir";
import { cn } from "@/lib/utils";
import {
  ADMIN_TONE_BAR,
  AdminBadge,
  AdminConfirmDialog,
  AdminHeader,
  AdminQueryState,
  AdminSplitWorkbench,
  AdminWhen,
  type AdminTone,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import { MiniHazardMap } from "@/ui/hazard-map";
import {
  AtlasButton,
  AtlasSelect,
  AtlasTextarea,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/fires")({
  component: FiresPage,
});

function FireInspector({
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
  const [reason, setReason] = useState<ResolutionReason>("flare");
  const [note, setNote] = useState("");
  const [modal, setModal] = useState<"ended" | "false" | null>(null);

  const mut = useMutation({
    mutationFn: async (kind: "ended" | "false") => {
      await resolveFire({
        id: fire.id,
        state: kind === "ended" ? "extinguished" : "false_positive",
        reason: kind === "false" ? reason : null,
        note: note.trim() || null,
        expectedUpdatedAt: fire.updated_at,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "fires"] }),
        qc.invalidateQueries({ queryKey: ["admin", "attention"] }),
      ]);
      toast.success(t("fires.resolved"));
      setModal(null);
      onDone();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg.includes("stale") || msg.includes("conflict")
          ? t("fires.staleWrite")
          : t("sources.actionFailed"),
      );
    },
  });

  const tone = (FIRE_STATE_TONE[fire.state] ?? "neutral") as AdminTone;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AdminBadge tone={tone} dot>
            {t(`fires.state_${fire.state}`, { defaultValue: fire.state })}
          </AdminBadge>
          <SafeBdi className="font-mono text-sm font-semibold text-ink">
            {fire.short_id}
          </SafeBdi>
        </div>
        <Link
          to="/fire/$id"
          params={{ id: fire.short_id }}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-signal hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("fires.openMap")}
        </Link>
      </div>

      <MiniHazardMap lat={fire.lat} lon={fire.lon} zoom={11} className="h-52" />

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl border border-hairline bg-surface-raised/50 p-3.5 text-xs">
        <div>
          <dt className="text-ink-muted">{t("fires.place")}</dt>
          <dd className="mt-0.5 font-medium text-ink">{cleanCopy(place)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("fires.confidence")}</dt>
          <dd className="mt-0.5 font-mono font-semibold text-ink">
            <SafeBdi>
              {fire.confidence !== null
                ? `${Math.round(fire.confidence * 100)}%`
                : "-"}
            </SafeBdi>
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("fires.detections")}</dt>
          <dd className="mt-0.5 font-mono font-semibold text-ink">
            <SafeBdi>{fire.detection_count ?? "-"}</SafeBdi>
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("fires.frp")}</dt>
          <dd className="mt-0.5 font-mono font-semibold text-ink">
            <SafeBdi>
              {fire.max_frp_mw !== null
                ? `${fire.max_frp_mw.toFixed(1)} MW`
                : "-"}
            </SafeBdi>
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("fires.firstSeen")}</dt>
          <dd className="mt-0.5 text-ink">
            <AdminWhen at={fire.first_detected_at} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("fires.lastSeen")}</dt>
          <dd className="mt-0.5 text-ink">
            <AdminWhen at={fire.last_detected_at} />
          </dd>
        </div>
        <div className="col-span-2 sm:col-span-3 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2">
          <span className="text-ink-muted">
            {t("fires.sources")}:{" "}
            <SafeBdi className="font-mono text-ink">
              {(fire.sources ?? []).join(" · ").toUpperCase() || "-"}
            </SafeBdi>
          </span>
          <SafeBdi className="font-mono text-[11px] text-ink-muted">
            {coordLabel(fire.lat, fire.lon)}
          </SafeBdi>
        </div>
      </dl>

      <div className="space-y-3 border-t border-hairline pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-ink-secondary">
              {t("fires.reason")}
            </label>
            <AtlasSelect
              value={reason}
              onChange={(e) => setReason(e.target.value as ResolutionReason)}
            >
              {RESOLUTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`fires.reason_${r}`)}
                </option>
              ))}
            </AtlasSelect>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-ink-secondary">
              {t("fires.note")}
            </label>
            <AtlasTextarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AtlasButton
            variant="primary"
            size="sm"
            onClick={() => setModal("ended")}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("fires.markEnded")}
          </AtlasButton>
          <AtlasButton
            variant="danger"
            size="sm"
            onClick={() => setModal("false")}
          >
            <ShieldOff className="h-3.5 w-3.5" />
            {t("fires.markFalse")}
          </AtlasButton>
        </div>
      </div>

      <AdminConfirmDialog
        open={modal !== null}
        onOpenChange={(o) => !o && setModal(null)}
        title={
          modal === "ended"
            ? t("fires.endedTitle", { id: fire.short_id })
            : t("fires.falseTitle", { id: fire.short_id })
        }
        description={
          modal === "ended"
            ? t("fires.endedDescription")
            : t("fires.falseDescription", {
                reason: t(`fires.reason_${reason}`),
              })
        }
        confirmLabel={
          modal === "ended" ? t("fires.markEnded") : t("fires.markFalse")
        }
        destructive={modal === "false"}
        reasonMode="none"
        pending={mut.isPending}
        onConfirm={async () => {
          if (modal) await mut.mutateAsync(modal);
        }}
      />
    </div>
  );
}

function FiresPage() {
  const { t } = useTranslation("admin");
  const [strongOnly, setStrongOnly] = useState(true);
  const fires = useInfiniteQuery(unresolvedFiresQuery(strongOnly));
  const place = usePlace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = fires.data?.find((f) => f.id === selectedId) ?? null;

  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.review")}
        title={t("fires.title")}
        description={t("fires.subtitle")}
        actions={
          <button
            type="button"
            role="switch"
            aria-checked={strongOnly}
            onClick={() => setStrongOnly((v) => !v)}
            className="inline-flex min-h-11 items-center gap-2.5 rounded-xl border border-hairline bg-surface px-3.5 text-xs font-medium text-ink hover:bg-surface-raised transition-colors cursor-pointer"
          >
            <span
              className={cn(
                "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
                strongOnly
                  ? "bg-signal justify-end"
                  : "bg-hairline-strong justify-start",
              )}
            >
              <span className="h-4 w-4 rounded-full bg-surface shadow-xs" />
            </span>
            <span>{t("fires.strongOnly")}</span>
          </button>
        }
      />

      <AdminQueryState
        query={fires}
        isEmpty={(rows) => rows.length === 0}
        empty={t("fires.empty")}
      >
        {(rows) => (
          <AdminSplitWorkbench
            detailTitle={t("fires.detailTitle")}
            placeholder={t("fires.placeholder")}
            onClose={() => setSelectedId(null)}
            detail={
              selected ? (
                <FireInspector
                  key={selected.id}
                  fire={selected}
                  place={cleanCopy(place(selected))}
                  onDone={() => setSelectedId(null)}
                />
              ) : null
            }
            list={
              <ul className="space-y-2">
                {rows.map((fire) => {
                  const tone = (FIRE_STATE_TONE[fire.state] ??
                    "neutral") as AdminTone;
                  const active = fire.id === selectedId;
                  return (
                    <li key={fire.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(fire.id)}
                        className={cn(
                          "flex w-full items-stretch overflow-hidden rounded-xl border text-start transition-colors cursor-pointer",
                          active
                            ? "border-signal bg-signal-soft/40"
                            : "border-hairline bg-surface hover:border-hairline-strong",
                        )}
                      >
                        <span
                          className={cn("w-1 shrink-0", ADMIN_TONE_BAR[tone])}
                        />
                        <div className="flex-1 px-3.5 py-3 space-y-1.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <Flame className="h-3.5 w-3.5 shrink-0 text-hazard-extreme" />
                            <AdminBadge tone={tone}>
                              {t(`fires.state_${fire.state}`, {
                                defaultValue: fire.state,
                              })}
                            </AdminBadge>
                            <SafeBdi className="font-mono text-xs font-semibold text-ink">
                              {fire.short_id}
                            </SafeBdi>
                            <span className="ms-auto text-[11px] text-ink-muted">
                              <AdminWhen at={fire.last_detected_at} />
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-xs text-ink-secondary">
                            <span className="truncate">
                              {cleanCopy(place(fire))}
                            </span>
                            {fire.confidence !== null && (
                              <SafeBdi className="font-mono font-semibold text-ink shrink-0">
                                {Math.round(fire.confidence * 100)}%
                              </SafeBdi>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            }
          />
        )}
      </AdminQueryState>
    </section>
  );
}
