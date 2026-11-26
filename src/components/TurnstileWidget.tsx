import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  readConfiguredTurnstileSiteKey,
  turnstileLanguage,
} from "@/lib/turnstile";

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      language?: string;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "compact";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstileScript(): Promise<TurnstileApi> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("turnstile_ssr"));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
    );
    const finish = () => {
      if (window.turnstile) resolve(window.turnstile);
      else {
        scriptPromise = null;
        reject(new Error("turnstile_unavailable"));
      }
    };
    const fail = () => {
      scriptPromise = null;
      reject(new Error("turnstile_load_failed"));
    };

    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", fail, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export interface TurnstileWidgetProps {
  action: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  siteKey?: string;
  theme?: "auto" | "light" | "dark";
  compact?: boolean;
  resetKey?: number;
  className?: string;
}

export function TurnstileWidget({
  action,
  onVerify,
  onExpire,
  onError,
  siteKey,
  theme = "auto",
  compact = false,
  resetKey = 0,
  className,
}: TurnstileWidgetProps) {
  const { t, i18n } = useTranslation();
  const resolvedSiteKey = readConfiguredTurnstileSiteKey(siteKey);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onVerify, onExpire, onError });
  callbacksRef.current = { onVerify, onExpire, onError };

  const [status, setStatus] = useState<
    "loading" | "ready" | "verified" | "expired" | "error"
  >("loading");
  const [attempt, setAttempt] = useState(0);

  const language = turnstileLanguage(i18n.language || "en");

  useEffect(() => {
    if (!resolvedSiteKey || typeof window === "undefined") return;
    let cancelled = false;
    setStatus("loading");

    void loadTurnstileScript()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        const resolvedTheme =
          theme === "auto"
            ? document.documentElement.classList.contains("dark")
              ? "dark"
              : "light"
            : theme;
        const widgetId = api.render(containerRef.current, {
          sitekey: resolvedSiteKey,
          action,
          language,
          theme: resolvedTheme,
          size: compact ? "compact" : "normal",
          callback: (token) => {
            if (cancelled) return;
            setStatus("verified");
            callbacksRef.current.onVerify(token);
          },
          "expired-callback": () => {
            if (cancelled) return;
            setStatus("expired");
            callbacksRef.current.onExpire?.();
          },
          "error-callback": () => {
            if (cancelled) return;
            setStatus("error");
            callbacksRef.current.onError?.();
          },
        });
        widgetIdRef.current = widgetId;
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        callbacksRef.current.onError?.();
      });

    return () => {
      cancelled = true;
      const widgetId = widgetIdRef.current;
      widgetIdRef.current = null;
      if (widgetId && typeof window !== "undefined" && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // ignore cleanup errors if widget DOM was detached
        }
      }
    };
  }, [resolvedSiteKey, action, language, theme, compact, resetKey, attempt]);

  if (!resolvedSiteKey) return null;

  return (
    <div
      className={className ? `space-y-2 ${className}` : "space-y-2"}
      aria-label={t("turnstile.label")}
    >
      <div ref={containerRef} />
      {status === "loading" ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("turnstile.verifying")}
        </p>
      ) : null}
      {status === "expired" || status === "error" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <span>
            {status === "expired"
              ? t("turnstile.expired")
              : t("turnstile.failed")}
          </span>
          <button
            type="button"
            onClick={() => setAttempt((prev) => prev + 1)}
            className="min-h-11 min-w-11 rounded-md border border-destructive/40 bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
          >
            {t("turnstile.retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
