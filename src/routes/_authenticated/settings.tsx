import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bell, LogOut, Save, Settings } from "lucide-react";
import { toast } from "sonner";

import { LOCALES, LOCALE_LABELS, applyLocale, type Locale } from "@/i18n";
import {
  profileQuery,
  saveProfileSettings,
  type EmailDigestFrequency,
} from "@/lib/account";
import { titledMeta } from "@/lib/page-meta";
import { setUserPush, userPushEnabled } from "@/lib/push";
import { signOutAccount } from "@/lib/sign-out";
import { cn } from "@/lib/utils";
import { AtlasPageFooter } from "@/ui/app-shell";
import { AtlasLoading, AtlasMasthead, AtlasPanel } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: titledMeta("nav.settings"),
  }),
  component: SettingsPage,
});

const FIELD_BASE =
  "w-full rounded-lg border border-hairline bg-surface px-3 text-sm text-ink placeholder:text-ink-muted focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/25";

function SettingsPage() {
  const { t, i18n } = useTranslation();
  const uiLocale = i18n.language || "ar";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profileQ = useQuery(profileQuery);

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [locale, setLocale] = useState<Locale>("ar");
  const [alertEmail, setAlertEmail] = useState(true);
  const [alertPush, setAlertPush] = useState(false);
  const [digest, setDigest] = useState<EmailDigestFrequency>("immediate");
  const [digestHour, setDigestHour] = useState(8);
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [minDanger, setMinDanger] = useState(3);

  useEffect(() => {
    const p = profileQ.data;
    if (!p) return;
    setDisplayName(p.display_name ?? "");
    setPhone(p.phone ?? "");
    setLocale(
      (LOCALES as readonly string[]).includes(p.locale)
        ? (p.locale as Locale)
        : "ar",
    );
    setAlertEmail(p.alert_email);
    setAlertPush(p.alert_push || userPushEnabled());
    setDigest(p.email_digest_frequency ?? "immediate");
    setDigestHour(p.email_digest_hour_algiers ?? 8);
    setQuietStart(
      p.quiet_hours_start !== null ? String(p.quiet_hours_start) : "",
    );
    setQuietEnd(p.quiet_hours_end !== null ? String(p.quiet_hours_end) : "");
    setMinDanger(p.min_danger_level);
  }, [profileQ.data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      await saveProfileSettings({
        display_name: displayName.trim() || null,
        phone: phone.trim() || null,
        locale,
        alert_email: alertEmail,
        alert_push: alertPush,
        email_digest_frequency: digest,
        email_digest_hour_algiers: digestHour,
        quiet_hours_start: quietStart === "" ? null : Number(quietStart),
        quiet_hours_end: quietEnd === "" ? null : Number(quietEnd),
        min_danger_level: minDanger,
      });
      applyLocale(locale);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success(
        uiLocale === "ar"
          ? "تم حفظ الإعدادات"
          : uiLocale === "fr"
            ? "Préférences enregistrées"
            : "Settings saved",
      );
    },
    onError: () => toast.error(t("common.error")),
  });

  async function togglePush() {
    try {
      const next = !alertPush;
      await setUserPush(next);
      setAlertPush(next);
      toast.success(
        next
          ? uiLocale === "ar"
            ? "تم تفعيل إشعارات الجهاز"
            : uiLocale === "fr"
              ? "Notifications push activées"
              : "Push enabled"
          : uiLocale === "ar"
            ? "تم إيقاف إشعارات الجهاز"
            : uiLocale === "fr"
              ? "Notifications push désactivées"
              : "Push disabled",
      );
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function handleSignOut() {
    await signOutAccount();
    void navigate({ to: "/" });
  }

  const offLabel =
    uiLocale === "ar" ? "معطّل" : uiLocale === "fr" ? "Désactivé" : "Off";

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <Settings className="h-3.5 w-3.5 text-signal" />
            <span>
              {uiLocale === "ar"
                ? "إعدادات الحساب"
                : uiLocale === "fr"
                  ? "PRÉFÉRENCES DU COMPTE"
                  : "ACCOUNT PREFERENCES"}
            </span>
          </>
        }
        title={t("nav.settings")}
        actions={
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-hairline bg-surface px-3.5 text-sm font-medium text-ink hover:bg-surface-raised transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4 text-hazard-extreme" />
            {uiLocale === "ar"
              ? "تسجيل الخروج"
              : uiLocale === "fr"
                ? "Déconnexion"
                : "Sign out"}
          </button>
        }
      />

      {profileQ.isLoading ? (
        <AtlasLoading />
      ) : (
        <AtlasPanel className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="settings-name"
                className="text-xs font-medium text-ink-secondary"
              >
                {t("authKit.name")}
              </label>
              <input
                id="settings-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={`min-h-11 ${FIELD_BASE}`}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="settings-phone"
                className="text-xs font-medium text-ink-secondary"
              >
                {uiLocale === "ar"
                  ? "رقم الهاتف"
                  : uiLocale === "fr"
                    ? "Téléphone"
                    : "Phone"}
              </label>
              <input
                id="settings-phone"
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={`min-h-11 ${FIELD_BASE}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="settings-locale"
                className="text-xs font-medium text-ink-secondary"
              >
                {uiLocale === "ar"
                  ? "اللغة"
                  : uiLocale === "fr"
                    ? "Langue"
                    : "Language"}
              </label>
              <select
                id="settings-locale"
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                className={`min-h-11 ${FIELD_BASE}`}
              >
                {LOCALES.map((loc) => (
                  <option key={loc} value={loc}>
                    {LOCALE_LABELS[loc]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="settings-danger"
                className="text-xs font-medium text-ink-secondary"
              >
                {uiLocale === "ar"
                  ? "الحد الأدنى لخطر الحرائق"
                  : uiLocale === "fr"
                    ? "Seuil minimal de danger feu"
                    : "Minimum fire danger level"}
              </label>
              <select
                id="settings-danger"
                value={String(minDanger)}
                onChange={(e) => setMinDanger(Number(e.target.value))}
                className={`min-h-11 ${FIELD_BASE}`}
              >
                <option value="2">
                  {uiLocale === "ar"
                    ? "متوسط (+2)"
                    : uiLocale === "fr"
                      ? "Modéré (2+)"
                      : "Moderate (2+)"}
                </option>
                <option value="3">
                  {uiLocale === "ar"
                    ? "مرتفع (+3)"
                    : uiLocale === "fr"
                      ? "Élevé (3+)"
                      : "High (3+)"}
                </option>
                <option value="4">
                  {uiLocale === "ar"
                    ? "مرتفع جدًا (+4)"
                    : uiLocale === "fr"
                      ? "Très élevé (4+)"
                      : "Very High (4+)"}
                </option>
                <option value="5">
                  {uiLocale === "ar"
                    ? "قصوى (5)"
                    : uiLocale === "fr"
                      ? "Extrême (5)"
                      : "Extreme (5)"}
                </option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="settings-digest"
                className="text-xs font-medium text-ink-secondary"
              >
                {uiLocale === "ar"
                  ? "ملخص البريد الإلكتروني"
                  : uiLocale === "fr"
                    ? "Fréquence des e-mails"
                    : "Email digest"}
              </label>
              <select
                id="settings-digest"
                value={digest}
                onChange={(e) =>
                  setDigest(e.target.value as EmailDigestFrequency)
                }
                className={`min-h-11 ${FIELD_BASE}`}
              >
                <option value="immediate">
                  {uiLocale === "ar"
                    ? "فوري"
                    : uiLocale === "fr"
                      ? "Immédiat"
                      : "Immediate"}
                </option>
                <option value="hourly">
                  {uiLocale === "ar"
                    ? "كل ساعة"
                    : uiLocale === "fr"
                      ? "Toutes les heures"
                      : "Hourly"}
                </option>
                <option value="daily">
                  {uiLocale === "ar"
                    ? "يومي"
                    : uiLocale === "fr"
                      ? "Quotidien"
                      : "Daily"}
                </option>
                <option value="off">{offLabel}</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="settings-digest-hour"
                className="text-xs font-medium text-ink-secondary"
              >
                {uiLocale === "ar"
                  ? "ساعة الملخص اليومي (توقيت الجزائر)"
                  : uiLocale === "fr"
                    ? "Heure du résumé quotidien (Alger CET)"
                    : "Daily digest hour (Algiers CET)"}
              </label>
              <select
                id="settings-digest-hour"
                value={String(digestHour)}
                onChange={(e) => setDigestHour(Number(e.target.value))}
                className={`min-h-11 ${FIELD_BASE}`}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={String(h)}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="settings-quiet-start"
                className="text-xs font-medium text-ink-secondary"
              >
                {uiLocale === "ar"
                  ? "بداية ساعات الهدوء"
                  : uiLocale === "fr"
                    ? "Début des heures calmes"
                    : "Quiet hours start"}
              </label>
              <select
                id="settings-quiet-start"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                className={`min-h-11 ${FIELD_BASE}`}
              >
                <option value="">{offLabel}</option>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={String(h)}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="settings-quiet-end"
                className="text-xs font-medium text-ink-secondary"
              >
                {uiLocale === "ar"
                  ? "نهاية ساعات الهدوء"
                  : uiLocale === "fr"
                    ? "Fin des heures calmes"
                    : "Quiet hours end"}
              </label>
              <select
                id="settings-quiet-end"
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                className={`min-h-11 ${FIELD_BASE}`}
              >
                <option value="">{offLabel}</option>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={String(h)}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
            <button
              type="button"
              role="switch"
              aria-checked={alertEmail}
              onClick={() => setAlertEmail((v) => !v)}
              className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-hairline bg-surface px-3.5 text-sm font-medium text-ink hover:bg-surface-raised transition-colors cursor-pointer"
            >
              <span
                className={cn(
                  "h-5 w-9 rounded-full p-0.5 transition-colors flex items-center",
                  alertEmail
                    ? "bg-signal justify-end"
                    : "bg-hairline-strong justify-start",
                )}
              >
                <span className="h-4 w-4 rounded-full bg-surface shadow-xs" />
              </span>
              <span>
                {uiLocale === "ar"
                  ? "تنبيهات البريد الإلكتروني"
                  : uiLocale === "fr"
                    ? "Notifications par e-mail"
                    : "Email notifications"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void togglePush()}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-hairline bg-surface px-3.5 text-sm font-medium text-ink hover:bg-surface-raised transition-colors cursor-pointer"
            >
              <Bell className="h-4 w-4 text-signal" />
              {alertPush
                ? uiLocale === "ar"
                  ? "إشعارات الجهاز مفعّلة"
                  : uiLocale === "fr"
                    ? "Push appareil actif"
                    : "Device push active"
                : uiLocale === "ar"
                  ? "تفعيل إشعارات الجهاز"
                  : uiLocale === "fr"
                    ? "Activer le push appareil"
                    : "Enable device push"}
            </button>
          </div>

          <div className="flex justify-end border-t border-hairline pt-4">
            <button
              type="button"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-signal px-5 text-sm font-medium text-signal-ink hover:opacity-95 disabled:opacity-50 transition-opacity cursor-pointer"
            >
              <Save className="h-4 w-4" />
              {uiLocale === "ar"
                ? "حفظ التغييرات"
                : uiLocale === "fr"
                  ? "Enregistrer"
                  : "Save changes"}
            </button>
          </div>
        </AtlasPanel>
      )}

      <AtlasPageFooter />
    </div>
  );
}
