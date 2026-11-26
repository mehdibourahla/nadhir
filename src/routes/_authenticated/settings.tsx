import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AccountSecurity } from "@/components/AccountSecurity";
import { OemBatteryGuide } from "@/components/nadhir/OemBatteryGuide";
import { PrivacyControls } from "@/components/nadhir/PrivacyControls";
import { UserPushTest } from "@/components/nadhir/UserPushTest";

import { supabase } from "@/integrations/supabase/client";
import {
  LOCALES,
  LOCALE_LABELS,
  applyLocale,
  isLocale,
  type Locale,
} from "@/i18n";
import {
  profileQuery,
  saveProfileSettings,
  type EmailDigestFrequency,
} from "@/lib/account";
import { titledMeta } from "@/lib/page-meta";
import { DevicePush } from "@/components/DevicePush";
import { Switch } from "@/components/ui/switch";
import { signOutAccount } from "@/lib/sign-out";
import { NATIVE, apiUrl } from "@/lib/platform";
import {
  notificationPermission,
  requestNotificationPermission,
  type PushPermission,
} from "@/lib/push";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: titledMeta("nav.settings"),
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profile = useQuery(profileQuery);
  const [draft, setDraft] = useState({
    display_name: "",
    phone: "",
    locale: "ar",
    alert_email: false,
    email_digest_frequency: "off" as EmailDigestFrequency,
    alert_push: false,
    min_danger_level: 3,
    quiet_hours_start: "",
    quiet_hours_end: "",
  });
  const [saved, setSaved] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const removeAccount = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) throw new Error("account.deleteFailed");
      const response = await fetch(apiUrl("/api/private/account"), {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !result.ok)
        throw new Error(result.error ?? "account.deleteFailed");
    },
    onSuccess: async () => {
      await supabase.auth.signOut({ scope: "local" });
      qc.clear();
      void navigate({ to: "/", replace: true });
    },
    onError: (error: Error) => toast.error(t(error.message)),
  });
  const [pushState, setPushState] = useState<
    PushPermission | "unsupported" | null
  >(null);

  useEffect(() => {
    if (!NATIVE && !("Notification" in window)) {
      setPushState("unsupported");
      return;
    }
    void notificationPermission().then(setPushState);
  }, []);

  useEffect(() => {
    if (!profile.data) return;
    const freq: EmailDigestFrequency =
      profile.data.email_digest_frequency === "immediate" ||
      profile.data.email_digest_frequency === "hourly" ||
      profile.data.email_digest_frequency === "daily"
        ? profile.data.email_digest_frequency
        : "off";
    const emailEnabled = Boolean(profile.data.alert_email);
    setDraft({
      display_name: profile.data.display_name ?? "",
      phone: profile.data.phone ?? "",
      locale: profile.data.locale,
      alert_email: emailEnabled && freq !== "off",
      email_digest_frequency: emailEnabled ? freq : "off",
      alert_push: profile.data.alert_push,
      min_danger_level: profile.data.min_danger_level,
      quiet_hours_start: profile.data.quiet_hours_start?.toString() ?? "",
      quiet_hours_end: profile.data.quiet_hours_end?.toString() ?? "",
    });
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () =>
      saveProfileSettings({
        display_name: draft.display_name || null,
        phone: draft.phone || null,
        locale: draft.locale,
        alert_email:
          draft.alert_email && draft.email_digest_frequency !== "off",
        email_digest_frequency: draft.alert_email
          ? draft.email_digest_frequency
          : "off",
        alert_push: draft.alert_push,
        min_danger_level: draft.min_danger_level,
        quiet_hours_start:
          draft.quiet_hours_start === ""
            ? null
            : Number(draft.quiet_hours_start),
        quiet_hours_end:
          draft.quiet_hours_end === "" ? null : Number(draft.quiet_hours_end),
      }),
    onSuccess: () => {
      setSaved(true);
      applyLocale(draft.locale as Locale);
      void qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (error: Error) => toast.error(t(error.message)),
  });

  async function signOut() {
    setSigningOut(true);
    try {
      const scope = await signOutAccount();
      await qc.cancelQueries();
      qc.clear();
      if (scope === "local") toast.warning(t("authKit.localSignedOut"));
      else toast.success(t("authKit.signedOut"));
      void navigate({ to: "/", replace: true });
    } catch {
      toast.error(t("account.errorUnavailable"));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <h1 className="text-2xl">{t("account.settingsTitle")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("account.settingsSubtitle")}
      </p>

      <AccountSecurity />

      <form
        className="panel mt-5 space-y-4 p-5 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          save.mutate();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-muted-foreground">
            {t("account.displayName")}
          </span>
          <input
            value={draft.display_name}
            onChange={(e) =>
              setDraft({ ...draft, display_name: e.target.value })
            }
            className="min-h-11 w-full rounded-md border border-border bg-background px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-muted-foreground">
            {t("account.phone")}
          </span>
          <input
            inputMode="tel"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            className="tabular min-h-11 w-full rounded-md border border-border bg-background px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-muted-foreground">
            {t("nav.language")}
          </span>
          <select
            value={draft.locale}
            onChange={(e) => setDraft({ ...draft, locale: e.target.value })}
            className="min-h-11 w-full rounded-md border border-border bg-background px-3 py-2"
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-muted-foreground">
            {t("account.minLevel")}
          </span>
          <select
            value={draft.min_danger_level}
            onChange={(e) =>
              setDraft({ ...draft, min_danger_level: Number(e.target.value) })
            }
            className="min-h-11 w-full rounded-md border border-border bg-background px-3 py-2"
          >
            {[1, 2, 3, 4, 5].map((l) => (
              <option key={l} value={l}>
                {l} ·{" "}
                {t(
                  `risk.${["low", "moderate", "high", "very_high", "extreme"][l - 1]}`,
                )}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="space-y-3">
          <legend className="mb-1 text-muted-foreground">
            {t("account.channels")}
          </legend>
          <div className="space-y-2 rounded-md border border-border/70 p-3">
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
              <span>{t("emailDigest.settingsLabel")}</span>
              <Switch
                aria-label={t("emailDigest.settingsLabel")}
                checked={draft.alert_email}
                onCheckedChange={(enabled) => {
                  setDraft({
                    ...draft,
                    alert_email: enabled,
                    email_digest_frequency: enabled
                      ? draft.email_digest_frequency === "off"
                        ? "daily"
                        : draft.email_digest_frequency
                      : "off",
                  });
                }}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">
                {t("emailDigest.frequencyLabel")}
              </span>
              <select
                aria-label={t("emailDigest.frequencyLabel")}
                value={draft.email_digest_frequency}
                onChange={(e) => {
                  const next = e.target.value as EmailDigestFrequency;
                  setDraft({
                    ...draft,
                    email_digest_frequency: next,
                    alert_email: next !== "off",
                  });
                }}
                className="min-h-11 w-full rounded-md border border-border bg-background px-3 py-2"
              >
                <option value="off">{t("emailDigest.frequency.off")}</option>
                <option value="immediate">
                  {t("emailDigest.frequency.immediate")}
                </option>
                <option value="hourly">
                  {t("emailDigest.frequency.hourly")}
                </option>
                <option value="daily">
                  {t("emailDigest.frequency.daily")}
                </option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              {t("emailDigest.settingsHint")}
            </p>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span>{t("account.channelPush")}</span>
            <Switch
              aria-label={t("account.channelPush")}
              checked={draft.alert_push}
              onCheckedChange={(enabled) =>
                setDraft({ ...draft, alert_push: enabled })
              }
            />
          </label>
          {draft.alert_push &&
          pushState !== "granted" &&
          pushState !== "unsupported" ? (
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-border px-3 py-2"
              onClick={async () =>
                setPushState(await requestNotificationPermission())
              }
            >
              {t("account.enableDeviceNotifications")}
            </button>
          ) : null}
          {draft.alert_push &&
          (pushState === "denied" || pushState === "unsupported") ? (
            <p className="text-xs text-destructive">
              {pushState === "unsupported"
                ? t("account.pushUnsupported")
                : t("account.pushDenied")}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {t("account.pushHint")}
          </p>
          <DevicePush />
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-muted-foreground">
              {t("account.quietStart")}
            </span>
            <input
              type="number"
              min={0}
              max={23}
              value={draft.quiet_hours_start}
              onChange={(e) =>
                setDraft({ ...draft, quiet_hours_start: e.target.value })
              }
              className="tabular min-h-11 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">
              {t("account.quietEnd")}
            </span>
            <input
              type="number"
              min={0}
              max={23}
              value={draft.quiet_hours_end}
              onChange={(e) =>
                setDraft({ ...draft, quiet_hours_end: e.target.value })
              }
              className="tabular min-h-11 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("account.quietNote")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={save.isPending}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60"
          >
            {t("account.save")}
          </button>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border px-4 py-2 hover:bg-secondary"
          >
            {t("account.signOut")}
          </button>
          {saved ? (
            <span className="text-xs text-muted-foreground">
              {t("account.saved")}
            </span>
          ) : null}
        </div>
      </form>
      <section className="card mt-5 space-y-4 p-5 text-sm">
        <UserPushTest
          mode="authenticated"
          lang={isLocale(draft.locale) ? draft.locale : undefined}
          onTimeout={() => setGuideOpen(true)}
        />
        <div className="border-t border-border pt-4">
          <OemBatteryGuide open={guideOpen} onOpenChange={setGuideOpen} />
        </div>
      </section>
      <PrivacyControls />
      <details className="panel mt-6 p-5">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-destructive">
          {t("account.deleteAccount")}
        </summary>
        <p className="mt-3 text-sm">{t("account.deleteWarning")}</p>
        <label className="mt-3 block text-sm">
          {t("account.deleteConfirmation")}
          <input
            autoComplete="off"
            value={deleteConfirmation}
            onChange={(e) => setDeleteConfirmation(e.target.value)}
            className="mt-2 block min-h-11 w-full rounded border border-border bg-background px-3 py-2"
          />
        </label>
        <button
          type="button"
          disabled={deleteConfirmation !== "DELETE" || removeAccount.isPending}
          onClick={() => removeAccount.mutate()}
          className="mt-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded bg-destructive px-4 py-2 text-destructive-foreground disabled:opacity-50"
        >
          {t("account.deleteAccount")}
        </button>
      </details>
    </div>
  );
}
