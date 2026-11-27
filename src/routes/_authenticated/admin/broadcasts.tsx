import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Power, Radio, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import type { AnyLocale } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import {
  applyBroadcastTransition,
  getBroadcastAudit,
  hasConfirmedBroadcastSettings,
  setBroadcastEnabled,
  submitAuthorityWarning,
} from "@/lib/broadcast-admin";
import { adminUnitsQuery, unitName } from "@/lib/nadhir";
import { titledMeta } from "@/lib/page-meta";
import { cn } from "@/lib/utils";
import {
  ADMIN_TONE_BAR,
  AdminBadge,
  AdminConfirmDialog,
  AdminHeader,
  AdminQueryState,
  AdminSection,
  AdminWhen,
  type AdminTone,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import {
  AtlasButton,
  AtlasInput,
  AtlasPanel,
  AtlasSelect,
  AtlasTextarea,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/broadcasts")({
  head: () => ({
    meta: titledMeta("broadcastAdmin.title", "broadcastAdmin.subtitle"),
  }),
  component: BroadcastConsolePage,
});

function BroadcastConsolePage() {
  const { t, i18n } = useTranslation();
  const { t: tAdmin } = useTranslation("admin");
  const locale = (i18n.language || "fr") as AnyLocale;
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ["broadcast_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("broadcast_settings")
        .select("enabled, updated_at")
        .eq("id", true)
        .single();
      if (error) throw new Error(error.message);
      return data as { enabled: boolean; updated_at: string };
    },
    staleTime: 15_000,
  });

  const auditQ = useQuery({
    queryKey: ["broadcast_audit"],
    queryFn: getBroadcastAudit,
    staleTime: 30_000,
  });

  const unitsQ = useQuery(adminUnitsQuery);
  const wilayas = useMemo(
    () =>
      (unitsQ.data ?? [])
        .filter((u) => u.level === "wilaya")
        .sort((a, b) => a.code.localeCompare(b.code)),
    [unitsQ.data],
  );

  const [toggleOpen, setToggleOpen] = useState(false);
  const [source, setSource] = useState("");
  const [receivedVia, setReceivedVia] = useState("telegram");
  const [wilayaId, setWilayaId] = useState("");
  const [severity, setSeverity] = useState("severe");
  const [body, setBody] = useState("");
  const [relayOpen, setRelayOpen] = useState(false);

  const confirmed = hasConfirmedBroadcastSettings(
    settingsQ.data,
    settingsQ.isError,
  );
  const enabled = confirmed ? (settingsQ.data?.enabled ?? false) : false;

  const toggleMut = useMutation({
    mutationFn: (note: string) => setBroadcastEnabled(!enabled, note || null),
    onSuccess: async (transition) => {
      await applyBroadcastTransition(qc, transition);
      await qc.invalidateQueries({ queryKey: ["admin", "attention"] });
      toast.success(tAdmin("sources.saved"));
      setToggleOpen(false);
    },
    onError: (err) => {
      toast.error(
        t(err instanceof Error ? err.message : "broadcastAdmin.toggleFailed"),
      );
    },
  });

  const relayMut = useMutation({
    mutationFn: () =>
      submitAuthorityWarning({
        source,
        received_via: receivedVia,
        body,
        severity,
        wilaya_id: wilayaId,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["broadcast_audit"] });
      toast.success(tAdmin("sources.saved"));
      setSource("");
      setBody("");
      setRelayOpen(false);
    },
    onError: (err) => {
      toast.error(
        t(err instanceof Error ? err.message : "broadcastAdmin.warningFailed"),
      );
    },
  });

  return (
    <section>
      <AdminHeader
        eyebrow={tAdmin("groups.operations")}
        title={t("broadcastAdmin.title", {
          defaultValue: tAdmin("nav.broadcasts"),
        })}
        description={t("broadcastAdmin.subtitle", { defaultValue: "" })}
      />

      {/* Global Kill Switch */}
      <AtlasPanel
        className={cn(
          "flex flex-wrap items-center justify-between gap-4 border-2",
          !confirmed
            ? "border-hairline"
            : enabled
              ? "border-hazard-clear/45"
              : "border-hazard-extreme/60 bg-hazard-extreme-soft/30",
        )}
      >
        <div className="flex items-start gap-3.5 min-w-0">
          <span
            className={cn(
              "mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              enabled
                ? "bg-hazard-clear-soft text-hazard-clear-ink"
                : "bg-hazard-extreme-soft text-hazard-extreme-ink",
            )}
          >
            {enabled ? (
              <Radio className="h-5 w-5" />
            ) : (
              <ShieldAlert className="h-5 w-5" />
            )}
          </span>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-ink">
                {t("broadcastAdmin.killTitle")}
              </h2>
              {confirmed && (
                <AdminBadge tone={enabled ? "ok" : "bad"} dot>
                  {enabled
                    ? tAdmin("sources.running")
                    : tAdmin("sources.paused")}
                </AdminBadge>
              )}
            </div>
            <p className="text-xs text-ink-secondary">
              {settingsQ.data?.updated_at ? (
                <>
                  {tAdmin("overview.checked")}:{" "}
                  <AdminWhen at={settingsQ.data.updated_at} />
                </>
              ) : (
                tAdmin("kit.loading")
              )}
            </p>
          </div>
        </div>

        <AtlasButton
          variant={enabled ? "danger" : "primary"}
          size="md"
          disabled={!confirmed}
          onClick={() => setToggleOpen(true)}
        >
          <Power className="h-4 w-4" />
          {enabled
            ? tAdmin("audit.action.broadcast_disabled")
            : tAdmin("audit.action.broadcast_enabled")}
        </AtlasButton>
      </AtlasPanel>

      {/* Manual Authority Warning Relay */}
      <AdminSection
        title={t("broadcastAdmin.relayTitle", {
          defaultValue: tAdmin("audit.action.authority_warning_relay"),
        })}
      >
        <AtlasPanel className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-secondary">
                {t("broadcastAdmin.source", { defaultValue: "Authority" })} *
              </label>
              <AtlasInput
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="DGPC / Wilaya"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-secondary">
                {t("broadcastAdmin.receivedVia", {
                  defaultValue: "Received via",
                })}
              </label>
              <AtlasSelect
                value={receivedVia}
                onChange={(e) => setReceivedVia(e.target.value)}
              >
                <option value="telegram">
                  {tAdmin("sources.channel_telegram")}
                </option>
                <option value="facebook">Facebook</option>
                <option value="radio">
                  {locale === "ar"
                    ? "إذاعة"
                    : locale === "fr"
                      ? "Radio"
                      : "Radio"}
                </option>
                <option value="phone">
                  {locale === "ar"
                    ? "هاتف"
                    : locale === "fr"
                      ? "Téléphone"
                      : "Phone"}
                </option>
                <option value="press">
                  {locale === "ar"
                    ? "صحافة"
                    : locale === "fr"
                      ? "Presse"
                      : "Press"}
                </option>
              </AtlasSelect>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-secondary">
                {tAdmin("ita.wilaya")} *
              </label>
              <AtlasSelect
                value={wilayaId}
                onChange={(e) => setWilayaId(e.target.value)}
              >
                <option value="">{tAdmin("publication.chooseArea")}</option>
                {wilayas.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {unitName(w, locale)}
                  </option>
                ))}
              </AtlasSelect>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-secondary">
                {t("broadcastAdmin.severity", {
                  defaultValue:
                    locale === "ar"
                      ? "الخطورة"
                      : locale === "fr"
                        ? "Gravité"
                        : "Severity",
                })}
              </label>
              <AtlasSelect
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                <option value="moderate">
                  {locale === "ar"
                    ? "متوسط"
                    : locale === "fr"
                      ? "Modéré"
                      : "Moderate"}
                </option>
                <option value="severe">
                  {locale === "ar"
                    ? "شديد"
                    : locale === "fr"
                      ? "Sévère"
                      : "Severe"}
                </option>
                <option value="extreme">
                  {locale === "ar"
                    ? "قصوى"
                    : locale === "fr"
                      ? "Extrême"
                      : "Extreme"}
                </option>
              </AtlasSelect>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-ink-secondary">
              {t("broadcastAdmin.body", { defaultValue: "Official text" })} *
            </label>
            <AtlasTextarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div className="flex justify-end">
            <AtlasButton
              variant="primary"
              size="sm"
              disabled={!source.trim() || !body.trim() || !wilayaId}
              onClick={() => setRelayOpen(true)}
            >
              <Send className="h-3.5 w-3.5" />
              {t("broadcastAdmin.submit")}
            </AtlasButton>
          </div>
        </AtlasPanel>
      </AdminSection>

      {/* Broadcast Audit Log */}
      <AdminSection title={tAdmin("audit.title")}>
        <AdminQueryState
          query={auditQ}
          rows={5}
          isEmpty={(rows) => rows.length === 0}
          empty={tAdmin("audit.empty")}
        >
          {(rows) => (
            <ul className="space-y-2">
              {rows.map((entry) => {
                const tone: AdminTone =
                  entry.action === "disabled" || entry.action === "suppressed"
                    ? "warn"
                    : entry.action === "published" || entry.action === "enabled"
                      ? "ok"
                      : "info";
                const actionLabel =
                  entry.action === "published"
                    ? t("broadcastAdmin.action.published")
                    : entry.action === "suppressed"
                      ? t("broadcastAdmin.action.suppressed")
                      : entry.action === "enabled"
                        ? t("broadcastAdmin.action.enabled")
                        : entry.action === "disabled"
                          ? t("broadcastAdmin.action.disabled")
                          : entry.action;
                return (
                  <li
                    key={entry.id}
                    className="flex items-stretch overflow-hidden rounded-xl border border-hairline bg-surface"
                  >
                    <span
                      className={cn("w-1 shrink-0", ADMIN_TONE_BAR[tone])}
                    />
                    <div className="flex flex-1 flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <AdminBadge tone={tone}>{actionLabel}</AdminBadge>
                          {entry.kind && (
                            <span className="font-mono text-ink">
                              {entry.kind}
                            </span>
                          )}
                          {entry.severity && (
                            <AdminBadge tone="neutral">
                              {entry.severity}
                            </AdminBadge>
                          )}
                          {entry.phase && (
                            <span className="text-ink-muted">
                              {entry.phase}
                            </span>
                          )}
                        </div>
                        {entry.reason && (
                          <div className="text-ink-secondary">
                            {cleanCopy(entry.reason)}
                          </div>
                        )}
                      </div>
                      <SafeBdi className="text-[11px] text-ink-muted">
                        <AdminWhen at={entry.at} />
                      </SafeBdi>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </AdminQueryState>
      </AdminSection>

      <AdminConfirmDialog
        open={toggleOpen}
        onOpenChange={setToggleOpen}
        title={
          enabled
            ? tAdmin("audit.action.broadcast_disabled")
            : tAdmin("audit.action.broadcast_enabled")
        }
        confirmLabel={
          enabled ? tAdmin("sources.pause") : tAdmin("sources.resume")
        }
        destructive={enabled}
        reasonMode="optional"
        pending={toggleMut.isPending}
        onConfirm={async (note) => {
          await toggleMut.mutateAsync(note);
        }}
      />

      <AdminConfirmDialog
        open={relayOpen}
        onOpenChange={setRelayOpen}
        title={tAdmin("audit.action.authority_warning_relay")}
        description={cleanCopy(body)}
        confirmLabel={tAdmin("publication.publish")}
        reasonMode="none"
        pending={relayMut.isPending}
        onConfirm={async () => {
          await relayMut.mutateAsync();
        }}
      />
    </section>
  );
}
