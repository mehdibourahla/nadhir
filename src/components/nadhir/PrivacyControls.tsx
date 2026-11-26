import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { apiUrl } from "@/lib/platform";

const CONSENT_TYPES = [
  "privacy_policy",
  "citizen_reports",
  "zone_alerts",
  "email_digest",
  "push_alerts",
  "on_device_commune",
] as const;

type ConsentType = (typeof CONSENT_TYPES)[number];
type ConsentStatus = "granted" | "withdrawn";

interface ConsentItem {
  consent_type: ConsentType;
  policy_version: string;
  status: ConsentStatus;
  granted_at: string | null;
  withdrawn_at: string | null;
  updated_at: string;
}

interface ConsentListResponse {
  policy_version: string;
  consents: ConsentItem[];
}

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(parsed));
  } catch {
    return iso.slice(0, 10);
  }
}

export function PrivacyControls() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [policyVersion, setPolicyVersion] = useState("2026-11-25");
  const [consents, setConsents] = useState<
    Partial<Record<ConsentType, ConsentItem>>
  >({});
  const [savingType, setSavingType] = useState<ConsentType | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadConsents = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (error || !token) {
        setLoadError(true);
        return;
      }
      const res = await fetch(apiUrl("/api/private/privacy-consent"), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const payload = (await res.json()) as ConsentListResponse;
      if (payload.policy_version) setPolicyVersion(payload.policy_version);
      const map: Partial<Record<ConsentType, ConsentItem>> = {};
      for (const item of payload.consents ?? []) {
        map[item.consent_type] = item;
      }
      setConsents(map);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConsents();
  }, [loadConsents]);

  async function toggleConsent(type: ConsentType, nextStatus: ConsentStatus) {
    setSavingType(type);
    try {
      const { data, error } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (error || !token) throw new Error("unauthorized");

      const locale = ["ar", "fr", "en", "kab"].includes(i18n.language)
        ? i18n.language
        : "ar";
      const res = await fetch(apiUrl("/api/private/privacy-consent"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          consent_type: type,
          status: nextStatus,
          policy_version: policyVersion,
          locale,
          source_surface: "settings",
        }),
      });
      if (!res.ok) throw new Error("save_failed");
      const payload = (await res.json()) as {
        ok?: boolean;
        consent?: ConsentItem;
      };
      if (!payload.ok || !payload.consent) throw new Error("save_failed");
      setConsents((prev) => ({ ...prev, [type]: payload.consent }));
      toast.success(t("privacyCompliance.settings.saveSuccess"));
    } catch {
      toast.error(t("privacyCompliance.settings.saveError"));
    } finally {
      setSavingType(null);
    }
  }

  async function downloadExport() {
    setExporting(true);
    setExportError(null);
    try {
      const { data, error } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (error || !token) throw new Error("unauthorized");

      const res = await fetch(apiUrl("/api/private/privacy-export"), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("export_failed");
      const text = await res.text();
      const blob = new Blob([text], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "nadhir-personal-data-export.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(t("privacyCompliance.settings.exportSuccess"));
    } catch {
      const message = t("privacyCompliance.settings.exportError");
      setExportError(message);
      toast.error(message);
    } finally {
      setExporting(false);
    }
  }

  const versionSentinel = "\u0000POLICY_VERSION\u0000";
  const versionTemplate = t("privacyCompliance.policyVersionLabel", {
    version: versionSentinel,
  });
  const versionIdx = versionTemplate.indexOf(versionSentinel);

  return (
    <section
      id="privacy"
      aria-labelledby="privacy-settings-title"
      className="panel mt-5 space-y-5 p-5 text-sm"
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="privacy-settings-title" className="text-base font-semibold">
            {t("privacyCompliance.settings.title")}
          </h2>
          <span className="text-xs text-muted-foreground">
            {versionIdx !== -1 ? (
              <>
                {versionTemplate.slice(0, versionIdx)}
                <bdi dir="ltr" className="tabular-nums">
                  {policyVersion}
                </bdi>
                {versionTemplate.slice(versionIdx + versionSentinel.length)}
              </>
            ) : (
              <bdi dir="ltr" className="tabular-nums">
                {policyVersion}
              </bdi>
            )}
          </span>
        </div>
        <p className="text-muted-foreground">
          {t("privacyCompliance.settings.subtitle")}
        </p>
        <div>
          <Link
            to="/privacy"
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
          >
            {t("privacyCompliance.settings.readFullPolicy")}
          </Link>
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <h3 className="font-semibold">
            {t("privacyCompliance.settings.consentsTitle")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("privacyCompliance.settings.consentsHint")}
          </p>
        </div>

        {loading ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t("privacyCompliance.settings.loading")}
          </p>
        ) : loadError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <span>{t("privacyCompliance.settings.loadError")}</span>
            <button
              type="button"
              onClick={() => void loadConsents()}
              className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
            >
              {t("privacyCompliance.settings.retry")}
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {CONSENT_TYPES.map((type) => {
              const record = consents[type];
              const isGranted = record?.status === "granted";
              const isWithdrawn = record?.status === "withdrawn";
              const statusLabel = isGranted
                ? t("privacyCompliance.settings.granted")
                : isWithdrawn
                  ? t("privacyCompliance.settings.withdrawn")
                  : t("privacyCompliance.settings.notRecorded");
              const updatedLabel = formatDate(
                record?.updated_at ??
                  record?.withdrawn_at ??
                  record?.granted_at,
                i18n.language,
              );
              const busy = savingType === type;

              return (
                <li
                  key={type}
                  className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {t(`privacyCompliance.settings.purposes.${type}.label`)}
                      </span>
                      <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                        {statusLabel}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        `privacyCompliance.settings.purposes.${type}.description`,
                      )}
                    </p>
                    {updatedLabel ? (
                      <p className="text-xs text-muted-foreground">
                        {t("privacyCompliance.settings.updatedAt", {
                          date: updatedLabel,
                        })}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void toggleConsent(
                        type,
                        isGranted ? "withdrawn" : "granted",
                      )
                    }
                    className="min-h-11 shrink-0 rounded-md border border-border bg-background px-4 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
                  >
                    {isGranted
                      ? t("privacyCompliance.settings.withdrawAction")
                      : t("privacyCompliance.settings.grantAction")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="font-semibold">
          {t("privacyCompliance.settings.exportTitle")}
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("privacyCompliance.settings.exportDescription")}
        </p>
        {exportError ? (
          <p role="alert" className="text-xs text-destructive">
            {exportError}
          </p>
        ) : null}
        <button
          type="button"
          disabled={exporting}
          onClick={() => void downloadExport()}
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {exporting
            ? t("privacyCompliance.settings.exporting")
            : t("privacyCompliance.settings.exportButton")}
        </button>
      </div>
    </section>
  );
}
