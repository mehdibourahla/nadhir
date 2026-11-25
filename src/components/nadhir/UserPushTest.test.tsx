import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import i18n, { type AnyLocale } from "@/i18n";
import { BANNED_STATUS_LABELS } from "@/lib/alert-provenance";
import { UserPushTest, type UserPushTestProps } from "./UserPushTest";

function renderInLocale(locale: AnyLocale, props: UserPushTestProps) {
  const instance = i18n.cloneInstance({ lng: locale });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <UserPushTest {...props} />
    </I18nextProvider>,
  );
}

const LOCALES: readonly AnyLocale[] = ["ar", "fr", "en", "kab"];

describe("UserPushTest component (SSR)", () => {
  it("renders all 6 states cleanly across ar, fr, en and kab with antislop invariants", () => {
    const states: UserPushTestProps[] = [
      { mode: "authenticated", initialState: "idle" },
      { mode: "public", compact: true, initialState: "idle" },
      { mode: "authenticated", initialState: "sending" },
      { mode: "authenticated", initialState: "waiting", timeoutSeconds: 30 },
      {
        mode: "authenticated",
        initialState: "received",
        initialReceivedAt: "2026-11-25T11:45:00Z",
      },
      {
        mode: "public",
        initialState: "timeout",
        timeoutSeconds: 30,
        onTimeout: () => {},
      },
      {
        mode: "authenticated",
        initialState: "error",
        initialErrorCode: "deviceNotRegistered",
      },
      {
        mode: "public",
        initialState: "error",
        initialErrorCode: "rateLimited",
        initialRetryAfter: 60,
      },
    ];

    for (const locale of LOCALES) {
      const t = i18n.getFixedT(locale);
      for (const props of states) {
        const html = renderInLocale(locale, props);
        expect(html, `${locale}:${props.initialState}`).toContain(
          t("pushTest.title"),
        );
        expect(html, `${locale}:${props.initialState}`).not.toContain("\u2014");
        expect(html, `${locale}:${props.initialState}`).not.toContain(
          "text-faint",
        );
        expect(html, `${locale}:${props.initialState}`).not.toContain(
          "tracking-widest",
        );
        expect(html, `${locale}:${props.initialState}`).not.toContain(
          "animate-pulse",
        );
        expect(html, `${locale}:${props.initialState}`).toContain("text-start");

        // Every rendered button has type="button" and >=44px min-h-11
        const buttons = html.match(/<button\b[^>]*>/g) ?? [];
        for (const button of buttons) {
          expect(button, `${locale}:${props.initialState}`).toContain(
            'type="button"',
          );
          expect(button, `${locale}:${props.initialState}`).toContain(
            "min-h-11",
          );
        }

        // Banned status labels never appear as standalone text
        const textOnly = html.replace(/<[^>]+>/g, " ").toLowerCase();
        for (const banned of BANNED_STATUS_LABELS) {
          if (banned === "safe" || banned === "sûr" || banned === "آمن") {
            expect(
              textOnly,
              `${locale}:${props.initialState}:${banned}`,
            ).not.toMatch(new RegExp(`\\b${banned}\\b`, "i"));
          }
        }
      }
    }
  });

  it("exposes aria-live on waiting, AlertProvenance on received, and role=alert with Retry-After on rate-limited error", () => {
    const waitingHtml = renderInLocale("en", {
      mode: "authenticated",
      initialState: "waiting",
      timeoutSeconds: 30,
    });
    expect(waitingHtml).toContain('aria-live="polite"');
    expect(waitingHtml).toContain("I received it");
    expect(waitingHtml).toContain("Not received yet");

    const receivedHtml = renderInLocale("en", {
      mode: "authenticated",
      initialState: "received",
      initialReceivedAt: "2026-11-25T11:45:00Z",
    });
    expect(receivedHtml).toContain("Why am I seeing this?");
    expect(receivedHtml).toContain("Send another test");

    const rateLimitedHtml = renderInLocale("en", {
      mode: "public",
      initialState: "error",
      initialErrorCode: "rateLimited",
      initialRetryAfter: 120,
    });
    expect(rateLimitedHtml).toContain('role="alert"');
    expect(rateLimitedHtml).toContain("120");
    expect(rateLimitedHtml).toContain("Try again");

    const deviceNotOwnedHtml = renderInLocale("fr", {
      mode: "authenticated",
      initialState: "error",
      initialErrorCode: "deviceNotRegistered",
    });
    expect(deviceNotOwnedHtml).toContain('role="alert"');
    expect(deviceNotOwnedHtml).toContain("Activez d&#x27;abord");
  });
});
