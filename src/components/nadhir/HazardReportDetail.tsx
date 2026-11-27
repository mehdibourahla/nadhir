import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/lib/nadhir";
import type { HazardReport } from "@/lib/open-areas";
import {
  blockReportAuthor,
  FLAG_REASONS,
  flagReport,
  isOwnReport,
  ReportMutationError,
  witnessReport,
  type FlagReason,
} from "@/lib/reports";

type Props = { report: HazardReport; locale: Locale; now: number };

export function HazardReportDetail({ report, locale, now }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t("reports.citizenLabel")}
      </p>
      <h2 className="text-lg font-semibold">
        {t(`reports.hazardName.${report.hazard ?? "other"}`)}
      </h2>
      {report.summary ? <p className="text-sm">{report.summary}</p> : null}
      <p className="text-sm">
        <time dateTime={report.observed_at}>
          {t("map.reportObserved", {
            time: relativeTime(report.observed_at, locale, now),
          })}
        </time>
        {report.witnesses
          ? ` · ${t("reports.witnessCount", { count: report.witnesses })}`
          : ""}
      </p>
      <Witness reportId={report.id} />
      <p className="text-xs text-muted-foreground">{t("map.reportNote")}</p>
      <ReportActions reportId={report.id} />
    </div>
  );
}

function ReportActions({ reportId }: { reportId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const here = useLocation({ select: (location) => location.href });
  const own = useQuery({
    queryKey: ["reports", "own", reportId],
    queryFn: () => isOwnReport(reportId),
  });
  const [step, setStep] = useState<
    "idle" | "reasons" | "hide" | "flagged" | "signin"
  >("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (own.data !== false) return null;

  async function open(next: "reasons" | "hide") {
    setError(null);
    const { data } = await supabase.auth.getSession();
    setStep(data.session ? next : "signin");
  }

  async function submit(action: () => Promise<void>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await action();
      return true;
    } catch (failure) {
      setError(
        failure instanceof ReportMutationError ? failure.message : fallback,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function flag(reason: FlagReason) {
    if (await submit(() => flagReport(reportId, reason), "reports.flagFailed"))
      setStep("flagged");
  }

  async function hide() {
    if (
      !(await submit(() => blockReportAuthor(reportId), "reports.hideFailed"))
    )
      return;
    await navigate({
      to: ".",
      search: (prev) => ({ ...prev, event: undefined }),
      replace: true,
    });
    await qc.invalidateQueries({ queryKey: ["hazard_reports"] });
  }

  if (step === "flagged")
    return (
      <p role="status" className="text-sm font-medium">
        {t("reports.flagThanks")}
      </p>
    );
  if (step === "signin")
    return (
      <Link
        to="/auth"
        search={{ returnTo: here }}
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline"
      >
        {t("reports.flagSignIn")}
      </Link>
    );
  if (step === "idle")
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          className="h-11 px-2 text-muted-foreground"
          onClick={() => void open("reasons")}
        >
          {t("reports.flag")}
        </Button>
        <Button
          variant="ghost"
          className="h-11 px-2 text-muted-foreground"
          onClick={() => void open("hide")}
        >
          {t("reports.hide")}
        </Button>
      </div>
    );
  return (
    <div className="space-y-2">
      {step === "reasons" ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">
            {t("reports.flagQuestion")}
          </legend>
          {FLAG_REASONS.map((reason) => (
            <Button
              key={reason}
              variant="outline"
              className="h-11 w-full justify-start"
              disabled={busy}
              onClick={() => void flag(reason)}
            >
              {t(`reports.flagReason.${reason}`)}
            </Button>
          ))}
        </fieldset>
      ) : (
        <>
          <p className="text-sm">{t("reports.hideConfirm")}</p>
          <Button
            variant="destructive"
            className="h-11 w-full"
            disabled={busy}
            onClick={() => void hide()}
          >
            {t("reports.hideAction")}
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      ) : null}
      <Button
        variant="ghost"
        className="h-11 w-full"
        disabled={busy}
        onClick={() => {
          setError(null);
          setStep("idle");
        }}
      >
        {t("common.cancel")}
      </Button>
    </div>
  );
}

function Witness({ reportId }: { reportId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [state, setState] = useState<
    "idle" | "busy" | "seen" | "gone" | "signin"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const here = useLocation({ select: (location) => location.href });

  async function vote(choice: "seen" | "gone") {
    setError(null);
    setState("busy");
    const { data } = await supabase.auth.getSession();
    if (!data.session) return setState("signin");
    if (!navigator.geolocation) {
      setError("reports.witnessLocate");
      return setState("idle");
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await witnessReport(reportId, choice, {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          });
          setState(choice);
          void qc.invalidateQueries({ queryKey: ["hazard_reports"] });
        } catch (failure) {
          setError(
            failure instanceof ReportMutationError
              ? failure.message
              : "reports.witnessFailed",
          );
          setState("idle");
        }
      },
      () => {
        setError("reports.witnessLocate");
        setState("idle");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  if (state === "seen" || state === "gone")
    return (
      <p role="status" className="text-sm font-medium">
        {state === "seen"
          ? t("reports.witnessThanks")
          : t("reports.witnessGoneThanks")}
      </p>
    );
  if (state === "signin")
    return (
      <Link
        to="/auth"
        search={{ returnTo: here }}
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline"
      >
        {t("reports.witnessSignIn")}
      </Link>
    );
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          className="h-11 flex-1"
          disabled={state === "busy"}
          onClick={() => void vote("seen")}
        >
          {t("reports.witnessSeen")}
        </Button>
        <Button
          variant="outline"
          className="h-11 flex-1"
          disabled={state === "busy"}
          onClick={() => void vote("gone")}
        >
          {t("reports.witnessGone")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
