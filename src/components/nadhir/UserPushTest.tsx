import { AlertTriangle, BellRing, CheckCircle2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertProvenance } from "@/components/nadhir/AlertProvenance";
import { isLocale } from "@/i18n";
import {
  isValidObservedAt,
  provenanceForSelfTest,
} from "@/lib/alert-provenance";
import type { FcmLang } from "@/lib/fcm";
import { algiersTime } from "@/lib/nadhir";
import { NATIVE } from "@/lib/platform";
import {
  UserPushTestError,
  notificationPermission,
  pushConfigured,
  pushSupported,
  pushTestArrival,
  sendUserPushTest,
  type PushPermission,
  type UserPushTestErrorCode,
} from "@/lib/push";
import { onTestPushArrival } from "@/lib/push-test-events";

export type UserPushTestState =
  "idle" | "sending" | "waiting" | "received" | "timeout" | "error";

export type UserPushTestProps = {
  mode: "authenticated" | "public";
  lang?: FcmLang | undefined;
  compact?: boolean | undefined;
  timeoutSeconds?: number | undefined;
  onTimeout?: (() => void) | undefined;
  initialState?: UserPushTestState | undefined;
  initialErrorCode?: UserPushTestErrorCode | undefined;
  initialRetryAfter?: number | undefined;
  initialReceivedAt?: string | undefined;
  className?: string | undefined;
};

const DEFAULT_TIMEOUT_SECONDS = 30;
const POLL_INTERVAL_MS = 2000;

export function UserPushTest({
  mode,
  lang,
  compact = false,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  onTimeout,
  initialState = "idle",
  initialErrorCode,
  initialRetryAfter,
  initialReceivedAt,
  className,
}: UserPushTestProps) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<UserPushTestState>(initialState);
  const [testId, setTestId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(timeoutSeconds);
  const [receivedAt, setReceivedAt] = useState<string | null>(
    initialReceivedAt ?? null,
  );
  const [errorCode, setErrorCode] = useState<UserPushTestErrorCode>(
    initialErrorCode ?? "unavailable",
  );
  const [retryAfter, setRetryAfter] = useState<number>(initialRetryAfter ?? 60);
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [supported, setSupported] = useState<boolean>(true);
  const onTimeoutRef = useRef(onTimeout);

  const configured = pushConfigured();
  const resolvedLang: FcmLang =
    lang ?? (isLocale(i18n.language) ? i18n.language : "ar");

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    const isSupported = pushSupported();
    setSupported(isSupported);
    if (!isSupported || !configured) return;
    let active = true;
    void notificationPermission()
      .then((perm) => {
        if (active) setPermission(perm);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [configured]);

  useEffect(() => {
    if (state !== "waiting") return;
    let cancelled = false;
    let remaining = Math.max(1, Math.floor(timeoutSeconds));
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let countdown: ReturnType<typeof setInterval> | null = null;

    const stopTimers = () => {
      if (countdown) {
        clearInterval(countdown);
        countdown = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const markReceived = (timestamp: string) => {
      if (cancelled) return;
      cancelled = true;
      stopTimers();
      setReceivedAt(timestamp);
      setState("received");
    };

    const unsubscribe = onTestPushArrival((event) => {
      if (!testId || !event.testId || event.testId === testId) {
        markReceived(event.receivedAt);
      }
    });

    countdown = setInterval(() => {
      if (cancelled) return;
      remaining -= 1;
      if (remaining <= 0) {
        cancelled = true;
        stopTimers();
        setSecondsLeft(0);
        setState("timeout");
        onTimeoutRef.current?.();
        return;
      }
      setSecondsLeft(remaining);
    }, 1000);

    if (mode === "authenticated" && testId) {
      pollTimer = setInterval(() => {
        void pushTestArrival(testId)
          .then((at) => {
            if (at) markReceived(at);
          })
          .catch(() => undefined);
      }, POLL_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      unsubscribe();
      stopTimers();
    };
  }, [state, testId, mode, timeoutSeconds]);

  const handleSend = async () => {
    setState("sending");
    setTestId(null);
    setReceivedAt(null);
    setSecondsLeft(timeoutSeconds);
    try {
      const result = await sendUserPushTest({ mode, lang: resolvedLang });
      setTestId(result.testId);
      setPermission("granted");
      setState("waiting");
    } catch (err) {
      if (err instanceof UserPushTestError) {
        setErrorCode(err.code);
        if (err.retryAfterSeconds) setRetryAfter(err.retryAfterSeconds);
        if (err.code === "denied") setPermission("denied");
      } else {
        setErrorCode("unavailable");
      }
      setState("error");
    }
  };

  const handleManualConfirm = () => {
    setReceivedAt(new Date().toISOString());
    setState("received");
  };

  const handleNotReceived = () => {
    setSecondsLeft(0);
    setState("timeout");
    onTimeout?.();
  };

  const formattedError =
    errorCode === "rateLimited"
      ? t("pushTest.errors.rateLimited", { seconds: retryAfter })
      : t(`pushTest.errors.${errorCode}`);

  const validReceivedAt =
    receivedAt && isValidObservedAt(receivedAt) ? receivedAt : null;
  const receivedTimeLabel = validReceivedAt
    ? algiersTime(validReceivedAt)
    : t("common.notRecorded");

  const selfTestProvenance = provenanceForSelfTest(
    validReceivedAt ?? new Date().toISOString(),
  );

  const blockedReason =
    state === "idle" && !supported
      ? t("pushTest.unsupported")
      : state === "idle" && !configured
        ? t("pushTest.unconfigured")
        : state === "idle" && permission === "denied"
          ? t("pushTest.permissionDenied")
          : null;

  return (
    <div
      className={
        className ? `space-y-3 text-start ${className}` : "space-y-3 text-start"
      }
    >
      <div className="space-y-1">
        <h2
          className={
            compact
              ? "flex items-center gap-2 text-sm font-semibold text-foreground"
              : "flex items-center gap-2 text-base font-semibold text-foreground"
          }
        >
          <BellRing
            aria-hidden
            className="size-4 shrink-0 text-[var(--accent)]"
          />
          <span>{t("pushTest.title")}</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("pushTest.subtitle")}
        </p>
      </div>

      {state === "idle" && (
        <div className="space-y-2.5">
          {blockedReason ? (
            <p
              role="status"
              className="rounded-lg border border-border bg-muted p-3 text-xs text-foreground"
            >
              {blockedReason}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              <BellRing aria-hidden className="size-4 shrink-0" />
              <span>{t("pushTest.sendButton")}</span>
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            {t("pushTest.channelNote")}
          </p>
          {!NATIVE && (
            <p className="text-xs text-muted-foreground">
              {t("pushTest.webNote")}
            </p>
          )}
        </div>
      )}

      {state === "sending" && (
        <div className="space-y-2" aria-live="polite">
          <button
            type="button"
            disabled
            aria-busy="true"
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-60"
          >
            <RefreshCw aria-hidden className="size-4 shrink-0" />
            <span>{t("pushTest.sending")}</span>
          </button>
        </div>
      )}

      {state === "waiting" && (
        <div
          className="space-y-3 rounded-lg border border-border bg-muted/40 p-3"
          aria-live="polite"
        >
          <p className="tabular text-xs font-medium text-foreground">
            {t("pushTest.waiting", { seconds: secondsLeft })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleManualConfirm}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-[var(--accent-ink)]"
            >
              <CheckCircle2 aria-hidden className="size-4 shrink-0" />
              <span>{t("pushTest.confirmReceived")}</span>
            </button>
            <button
              type="button"
              onClick={handleNotReceived}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-medium text-foreground hover:bg-muted"
            >
              <AlertTriangle aria-hidden className="size-4 shrink-0" />
              <span>{t("pushTest.notReceivedYet")}</span>
            </button>
          </div>
        </div>
      )}

      {state === "received" && (
        <div className="space-y-2.5">
          <div
            role="status"
            className="rounded-lg border border-border p-3 text-xs"
            style={{
              backgroundColor: "var(--risk-tint-1)",
              color: "var(--risk-ink-1)",
            }}
          >
            <p className="flex items-start gap-2 font-medium">
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{t("pushTest.received", { time: receivedTimeLabel })}</span>
            </p>
          </div>
          <AlertProvenance provenance={selfTestProvenance} compact />
          <button
            type="button"
            onClick={() => void handleSend()}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-xs font-medium text-foreground hover:bg-muted"
          >
            <RefreshCw aria-hidden className="size-3.5 shrink-0" />
            <span>{t("pushTest.sendAnother")}</span>
          </button>
        </div>
      )}

      {state === "timeout" && (
        <div className="space-y-2.5">
          <div
            role="status"
            className="space-y-1.5 rounded-lg border border-border p-3 text-xs"
            style={{
              backgroundColor: "var(--risk-tint-3)",
              color: "var(--risk-ink-3)",
            }}
          >
            <p className="flex items-start gap-2 font-semibold">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {t("pushTest.timeoutTitle", { seconds: timeoutSeconds })}
              </span>
            </p>
            <p>{t("pushTest.timeoutBody")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSend()}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-xs font-medium text-foreground hover:bg-muted"
            >
              <RefreshCw aria-hidden className="size-3.5 shrink-0" />
              <span>{t("pushTest.tryAgain")}</span>
            </button>
            {onTimeout && (
              <button
                type="button"
                onClick={onTimeout}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-[var(--accent-tint)] px-3.5 py-2 text-xs font-medium text-[var(--accent)]"
              >
                {t("pushTest.openGuide")}
              </button>
            )}
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="space-y-2.5">
          <div
            role="alert"
            className="rounded-lg border border-border p-3 text-xs font-medium"
            style={{
              backgroundColor: "var(--emergency-surface)",
              color: "var(--emergency-ink)",
            }}
          >
            <p className="flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{formattedError}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSend()}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-xs font-medium text-foreground hover:bg-muted"
          >
            <RefreshCw aria-hidden className="size-3.5 shrink-0" />
            <span>{t("pushTest.tryAgain")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
