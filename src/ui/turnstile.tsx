import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  readConfiguredTurnstileSiteKey,
  turnstileLanguage,
} from "@/lib/turnstile";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string;
          language?: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      remove?: (widgetId: string) => void;
    };
  }
}

export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey?: string;
  onToken?: (token: string) => void;
}) {
  const { i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [token, setToken] = useState("");
  const resolvedKey = readConfiguredTurnstileSiteKey(siteKey);

  useEffect(() => {
    if (!resolvedKey || !containerRef.current) return;
    let widgetId: string | undefined;

    const mount = () => {
      if (!containerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: resolvedKey,
        language: turnstileLanguage(i18n.language || "fr"),
        callback: (nextToken: string) => {
          setToken(nextToken);
          onToken?.(nextToken);
        },
        "expired-callback": () => {
          setToken("");
          onToken?.("");
        },
        "error-callback": () => {
          setToken("");
          onToken?.("");
        },
      });
    };

    if (window.turnstile) {
      mount();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-turnstile="true"]',
      );
      if (existing) {
        existing.addEventListener("load", mount, { once: true });
      } else {
        const script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset["turnstile"] = "true";
        script.addEventListener("load", mount, { once: true });
        document.head.appendChild(script);
      }
    }

    return () => {
      if (widgetId) window.turnstile?.remove?.(widgetId);
    };
  }, [resolvedKey, i18n.language, onToken]);

  if (!resolvedKey) return null;

  return (
    <div className="space-y-2">
      <div ref={containerRef} />
      <input type="hidden" name="cf-turnstile-response" value={token} />
    </div>
  );
}
