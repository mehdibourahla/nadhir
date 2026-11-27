import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";
import { PageHeader } from "@/components/admin/kit/PageHeader";
import { QueryState } from "@/components/admin/kit/QueryState";
import { StatusBadge } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import {
  applyBroadcastTransition,
  BroadcastAdminError,
  getBroadcastAudit,
  hasConfirmedBroadcastSettings,
  setBroadcastEnabled,
  submitAuthorityWarning,
} from "@/lib/broadcast-admin";
import { adminUnitsQuery, unitName } from "@/lib/nadhir";
import { myRolesQuery } from "@/lib/reports";
import { membersQuery } from "@/lib/roles";

const settingsQuery = queryOptions({
  queryKey: ["broadcast_settings"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("broadcast_settings")
      .select("enabled, updated_at")
      .eq("id", true)
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  refetchInterval: 30_000,
});

const zonePushesQuery = queryOptions({
  queryKey: ["admin", "push-delivery"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("admin_push_delivery", {
      _days: 7,
    });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
});

const auditQuery = queryOptions({
  queryKey: ["broadcast_audit"],
  queryFn: getBroadcastAudit,
  refetchInterval: 30_000,
});

const warningsQuery = queryOptions({
  queryKey: ["authority_warnings"],
  queryFn: async () => {
    const { data: warnings, error } = await supabase
      .from("authority_warnings")
      .select("id, source, body, severity, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    const ids = (warnings ?? []).map((w) => w.id);
    const relayed = ids.length
      ? await supabase
          .from("broadcasts")
          .select("authority_warning_id")
          .in("authority_warning_id", ids)
      : { data: [], error: null };
    if (relayed.error) throw new Error(relayed.error.message);
    const done = new Set(
      (relayed.data ?? []).map((b) => b.authority_warning_id),
    );
    return (warnings ?? []).map((w) => ({ ...w, relayed: done.has(w.id) }));
  },
});

const message = (t: (key: string) => string, error: unknown) =>
  new Error(
    t(
      error instanceof BroadcastAdminError
        ? error.message
        : "broadcastAdmin.toggleFailed",
    ),
  );

function KillSwitch() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useQuery(settingsQuery);
  const confirmed = hasConfirmedBroadcastSettings(
    settings.data,
    settings.isError,
  )
    ? settings.data
    : null;
  const enabled = confirmed?.enabled ?? null;
  const toggle = useMutation({
    mutationFn: (input: { enabled: boolean; note: string | null }) =>
      setBroadcastEnabled(input.enabled, input.note),
    onSuccess: async (transition) => {
      await applyBroadcastTransition(qc, transition);
      await qc.invalidateQueries({ queryKey: ["admin", "attention"] });
    },
  });
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="font-medium">{t("broadcastAdmin.killTitle")}</h2>
        <div className="mt-1.5">
          {enabled === null ? (
            <StatusBadge tone="neutral">
              {settings.isPending
                ? t("common.loading")
                : t("broadcastAdmin.toggleFailed")}
            </StatusBadge>
          ) : (
            <StatusBadge tone={enabled ? "ok" : "bad"}>
              {enabled
                ? t("broadcastAdmin.killOn")
                : t("broadcastAdmin.killOff")}
            </StatusBadge>
          )}
        </div>
      </div>
      {enabled !== null ? (
        <ConfirmDialog
          trigger={
            <Button variant={enabled ? "destructive" : "default"}>
              {enabled
                ? t("broadcastAdmin.killStop")
                : t("broadcastAdmin.killResume")}
            </Button>
          }
          title={
            enabled
              ? t("broadcastAdmin.stopTitle")
              : t("broadcastAdmin.resumeTitle")
          }
          description={
            enabled
              ? t("broadcastAdmin.stopDescription")
              : t("broadcastAdmin.resumeDescription")
          }
          confirmLabel={
            enabled
              ? t("broadcastAdmin.killStop")
              : t("broadcastAdmin.killResume")
          }
          destructive={enabled}
          reason={enabled ? "required" : "optional"}
          onConfirm={async (note) => {
            try {
              await toggle.mutateAsync({ enabled: !enabled, note });
            } catch (error) {
              throw message(t, error);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function Relay() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const qc = useQueryClient();
  const units = useQuery(adminUnitsQuery);
  const warnings = useQuery(warningsQuery);
  const wilayas = (units.data ?? []).filter((unit) => unit.level === "wilaya");
  const empty = {
    source: "",
    received_via: "phone",
    body: "",
    severity: "Severe",
    wilaya_id: "",
  };
  const [form, setForm] = useState(empty);
  const wilaya = wilayas.find((unit) => unit.id === form.wilaya_id);
  const ready = !!form.source.trim() && !!form.body.trim() && !!wilaya;
  const field = "mt-1 block w-full";
  const select =
    "mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm pointer-coarse:h-11";

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="font-medium">{t("broadcastAdmin.relayTitle")}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("broadcastAdmin.relayNote")}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium">{t("broadcastAdmin.source")}</span>
          <Input
            className={field}
            value={form.source}
            placeholder={t("broadcastAdmin.sourcePlaceholder")}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium">{t("broadcastAdmin.receivedVia")}</span>
          <select
            className={select}
            value={form.received_via}
            onChange={(e) => setForm({ ...form, received_via: e.target.value })}
          >
            {["phone", "fax", "email", "in_person"].map((value) => (
              <option key={value} value={value}>
                {t(`broadcastAdmin.via.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">{t("broadcastAdmin.body")}</span>
          <Textarea
            className={field}
            rows={3}
            maxLength={1500}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium">{t("broadcastAdmin.wilaya")}</span>
          <select
            className={select}
            value={form.wilaya_id}
            onChange={(e) => setForm({ ...form, wilaya_id: e.target.value })}
          >
            <option value="">{t("broadcastAdmin.chooseWilaya")}</option>
            {wilayas.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unitName(unit, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium">{t("broadcastAdmin.severity")}</span>
          <select
            className={select}
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value })}
          >
            <option value="Severe">{t("cap.severity.Severe")}</option>
            <option value="Extreme">{t("cap.severity.Extreme")}</option>
          </select>
        </label>
      </div>
      <ConfirmDialog
        trigger={
          <Button disabled={!ready}>{t("broadcastAdmin.submit")}</Button>
        }
        title={t("broadcastAdmin.relayConfirmTitle", {
          wilaya: wilaya ? unitName(wilaya, locale) : "",
        })}
        description={t("broadcastAdmin.relayConfirmDescription", {
          source: form.source.trim(),
        })}
        confirmLabel={t("broadcastAdmin.submit")}
        destructive
        onConfirm={async () => {
          try {
            await submitAuthorityWarning(form);
          } catch (error) {
            throw message(t, error);
          }
          toast.success(t("broadcastAdmin.relayedOk"));
          setForm(empty);
          await qc.invalidateQueries({ queryKey: ["authority_warnings"] });
        }}
      />
      <div>
        <h3 className="text-sm font-medium">
          {t("broadcastAdmin.recentWarnings")}
        </h3>
        <QueryState query={warnings} rows={2}>
          {(rows) => (
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-md border border-border">
              {rows.map((warning) => (
                <li key={warning.id} className="px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={warning.relayed ? "ok" : "warn"}>
                      {warning.relayed
                        ? t("broadcastAdmin.relayed")
                        : t("broadcastAdmin.pendingRelay")}
                    </StatusBadge>
                    <span className="font-medium">{warning.source}</span>
                    <span className="text-xs text-muted-foreground">
                      {warning.severity}
                    </span>
                    <span className="ms-auto text-xs text-muted-foreground">
                      <When at={warning.created_at} />
                    </span>
                  </span>
                  <span
                    dir="auto"
                    className="mt-1 line-clamp-2 text-muted-foreground"
                  >
                    {warning.body}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </div>
    </section>
  );
}

function Audit() {
  const { t } = useTranslation();
  const audit = useQuery(auditQuery);
  const members = useQuery(membersQuery);
  const names = useMemo(
    () =>
      new Map(
        (members.data ?? []).map((m) => [m.id, m.display_name ?? m.email]),
      ),
    [members.data],
  );
  return (
    <section>
      <h2 className="mb-3 font-medium">{t("broadcastAdmin.auditTitle")}</h2>
      <QueryState
        query={audit}
        isEmpty={(rows) => rows.length === 0}
        empty={t("broadcastAdmin.auditEmpty")}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("broadcastAdmin.colTime")}</TableHead>
                  <TableHead>{t("broadcastAdmin.colAction")}</TableHead>
                  <TableHead>{t("broadcastAdmin.colReason")}</TableHead>
                  <TableHead>{t("broadcastAdmin.colActor")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const note =
                    row.payload &&
                    typeof row.payload === "object" &&
                    !Array.isArray(row.payload)
                      ? (row.payload["note"] as string | undefined)
                      : undefined;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        <When at={row.at} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={
                            row.action === "disabled" ||
                            row.action === "suppressed"
                              ? "warn"
                              : "ok"
                          }
                        >
                          {t(`broadcastAdmin.action.${row.action}`, {
                            defaultValue: row.action,
                          })}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {note ?? (
                          <span className="font-mono text-xs text-muted-foreground">
                            {row.reason}
                            {row.kind ? ` · ${row.kind}` : ""}
                            {row.severity ? ` · ${row.severity}` : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.actor_id
                          ? (names.get(row.actor_id) ??
                            t("admin:empty.unknown"))
                          : t("broadcastAdmin.systemActor")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>
    </section>
  );
}

function ZonePushes() {
  const { t } = useTranslation();
  const days = useQuery(zonePushesQuery);
  return (
    <section>
      <h2 className="font-medium">{t("broadcastAdmin.pushTitle")}</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("broadcastAdmin.pushNote")}
      </p>
      <QueryState
        query={days}
        isEmpty={(rows) => rows.length === 0}
        empty={t("broadcastAdmin.pushEmpty")}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("broadcastAdmin.pushDay")}</TableHead>
                  <TableHead>{t("broadcastAdmin.pushSent")}</TableHead>
                  <TableHead>{t("broadcastAdmin.pushReceived")}</TableHead>
                  <TableHead>{t("broadcastAdmin.pushNoDevice")}</TableHead>
                  <TableHead>{t("broadcastAdmin.pushFailed")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.day}>
                    <TableCell className="tabular-nums">{row.day}</TableCell>
                    <TableCell className="tabular-nums">{row.sent}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.received}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.no_device}
                    </TableCell>
                    <TableCell className="tabular-nums">{row.failed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>
    </section>
  );
}

export function BroadcastConsole() {
  const { t } = useTranslation();
  const roles = useQuery(myRolesQuery);
  if (roles.isPending) return null;
  if (!(roles.data ?? []).includes("admin"))
    return (
      <p className="text-sm text-muted-foreground">
        {t("broadcastAdmin.forbidden")}
      </p>
    );
  return (
    <section className="space-y-6">
      <PageHeader
        title={t("broadcastAdmin.title")}
        description={t("broadcastAdmin.subtitle")}
      />
      <KillSwitch />
      <Relay />
      <ZonePushes />
      <Audit />
    </section>
  );
}
