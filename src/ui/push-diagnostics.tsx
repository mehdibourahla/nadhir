import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellRing, CheckCircle2, Smartphone } from "lucide-react";

import type { FcmLang } from "@/lib/fcm";
import { algiersTime } from "@/lib/nadhir";
import {
  UserPushTestError,
  pushTestArrival,
  sendUserPushTest,
} from "@/lib/push";
import { onTestPushArrival } from "@/lib/push-test-events";
import { cn } from "@/lib/utils";
import { AtlasPanel, SafeBdi } from "@/ui/primitives";

const TEST_TIMEOUT_SECONDS = 60;

type PushTestPhase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "waiting"; testId: string; remaining: number }
  | { kind: "received"; time: string }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

export function UserPushTest({
  mode = "authenticated",
}: {
  mode?: "authenticated" | "public";
}) {
  const { t, i18n } = useTranslation();
  const [phase, setPhase] = useState<PushTestPhase>({ kind: "idle" });

  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const { testId } = phase;
    let settled = false;

    const unsub = onTestPushArrival((ev) => {
      if (settled || ev.testId !== testId) return;
      settled = true;
      setPhase({ kind: "received", time: algiersTime(ev.receivedAt) });
    });

    const interval = window.setInterval(() => {
      void pushTestArrival(testId).then((at) => {
        if (settled || !at) return;
        settled = true;
        setPhase({ kind: "received", time: algiersTime(at) });
      });
      setPhase((prev) => {
        if (prev.kind !== "waiting") return prev;
        if (prev.remaining <= 1) return { kind: "timeout" };
        return { ...prev, remaining: prev.remaining - 1 };
      });
    }, 1000);

    return () => {
      unsub();
      window.clearInterval(interval);
    };
  }, [phase.kind]);

  async function runTest() {
    setPhase({ kind: "sending" });
    try {
      const lang = (
        ["ar", "fr", "en", "kab"].includes(i18n.language) ? i18n.language : "fr"
      ) as FcmLang;
      const result = await sendUserPushTest({ mode, lang });
      setPhase({
        kind: "waiting",
        testId: result.testId,
        remaining: TEST_TIMEOUT_SECONDS,
      });
    } catch (err) {
      if (err instanceof UserPushTestError) {
        const messageByCode: Record<string, string> = {
          unsupported: t("pushTest.errors.unsupported"),
          unconfigured: t("pushTest.errors.unconfigured"),
          denied: t("pushTest.errors.denied"),
          signIn: t("pushTest.errors.signIn"),
          deviceNotRegistered: t("pushTest.errors.deviceNotRegistered"),
          rateLimited: t("pushTest.errors.rateLimited", {
            seconds: err.retryAfterSeconds ?? TEST_TIMEOUT_SECONDS,
          }),
          invalid: t("pushTest.errors.invalid"),
          providerFailed: t("pushTest.errors.providerFailed"),
          unavailable: t("pushTest.errors.unavailable"),
        };
        setPhase({
          kind: "error",
          message: messageByCode[err.code] ?? t("pushTest.errors.unavailable"),
        });
      } else {
        setPhase({ kind: "error", message: t("pushTest.errors.unavailable") });
      }
    }
  }

  return (
    <AtlasPanel className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <BellRing className="h-4 w-4 text-signal" />
            {t("pushTest.title")}
          </h2>
          <p className="text-xs text-ink-secondary leading-relaxed">
            {t("pushTest.subtitle")}
          </p>
        </div>
        <button
          type="button"
          disabled={phase.kind === "sending" || phase.kind === "waiting"}
          onClick={() => void runTest()}
          className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg border border-hairline bg-surface-raised px-4 text-sm font-medium text-ink hover:border-signal/50 disabled:opacity-50 transition-colors cursor-pointer"
        >
          {phase.kind === "sending"
            ? t("pushTest.sending")
            : phase.kind === "received"
              ? t("pushTest.sendAnother")
              : t("pushTest.sendButton")}
        </button>
      </div>

      {phase.kind === "waiting" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-signal/35 bg-signal-soft/50 px-3.5 py-2.5 text-xs text-ink">
          <span>{t("pushTest.waiting", { seconds: phase.remaining })}</span>
          <button
            type="button"
            onClick={() =>
              setPhase({
                kind: "received",
                time: algiersTime(new Date().toISOString()),
              })
            }
            className="inline-flex min-h-11 items-center rounded-lg bg-signal px-3 text-xs font-medium text-signal-ink cursor-pointer"
          >
            {t("pushTest.confirmReceived")}
          </button>
        </div>
      )}

      {phase.kind === "received" && (
        <div className="flex items-center gap-2 rounded-xl border border-hazard-clear/40 bg-hazard-clear-soft px-3.5 py-2.5 text-xs font-medium text-hazard-clear-ink">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <SafeBdi>{t("pushTest.received", { time: phase.time })}</SafeBdi>
        </div>
      )}

      {phase.kind === "timeout" && (
        <div className="rounded-xl border border-hazard-high/40 bg-hazard-high-soft px-3.5 py-2.5 text-xs text-hazard-high-ink space-y-1">
          <div className="font-semibold">
            {t("pushTest.timeoutTitle", { seconds: TEST_TIMEOUT_SECONDS })}
          </div>
          <div>{t("pushTest.timeoutBody")}</div>
        </div>
      )}

      {phase.kind === "error" && (
        <div
          role="alert"
          className="rounded-xl border border-hazard-extreme/40 bg-hazard-extreme-soft px-3.5 py-2.5 text-xs font-medium text-hazard-extreme-ink"
        >
          {phase.message}
        </div>
      )}

      <p className="text-[11px] text-ink-muted">{t("pushTest.channelNote")}</p>
    </AtlasPanel>
  );
}

const OEM_KEYS = ["xiaomi", "samsung", "huawei", "oppo", "tecno"] as const;
type OemKey = (typeof OEM_KEYS)[number];

export function OemBatteryGuide() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<OemKey>("xiaomi");

  const oems: Record<
    OemKey,
    { name: string; subtitle: string; steps: [string, string, string, string] }
  > = {
    xiaomi: {
      name: t("oemBattery.oems.xiaomi.name"),
      subtitle: t("oemBattery.oems.xiaomi.subtitle"),
      steps: [
        t("oemBattery.oems.xiaomi.steps.s1"),
        t("oemBattery.oems.xiaomi.steps.s2"),
        t("oemBattery.oems.xiaomi.steps.s3"),
        t("oemBattery.oems.xiaomi.steps.s4"),
      ],
    },
    samsung: {
      name: t("oemBattery.oems.samsung.name"),
      subtitle: t("oemBattery.oems.samsung.subtitle"),
      steps: [
        t("oemBattery.oems.samsung.steps.s1"),
        t("oemBattery.oems.samsung.steps.s2"),
        t("oemBattery.oems.samsung.steps.s3"),
        t("oemBattery.oems.samsung.steps.s4"),
      ],
    },
    huawei: {
      name: t("oemBattery.oems.huawei.name"),
      subtitle: t("oemBattery.oems.huawei.subtitle"),
      steps: [
        t("oemBattery.oems.huawei.steps.s1"),
        t("oemBattery.oems.huawei.steps.s2"),
        t("oemBattery.oems.huawei.steps.s3"),
        t("oemBattery.oems.huawei.steps.s4"),
      ],
    },
    oppo: {
      name: t("oemBattery.oems.oppo.name"),
      subtitle: t("oemBattery.oems.oppo.subtitle"),
      steps: [
        t("oemBattery.oems.oppo.steps.s1"),
        t("oemBattery.oems.oppo.steps.s2"),
        t("oemBattery.oems.oppo.steps.s3"),
        t("oemBattery.oems.oppo.steps.s4"),
      ],
    },
    tecno: {
      name: t("oemBattery.oems.tecno.name"),
      subtitle: t("oemBattery.oems.tecno.subtitle"),
      steps: [
        t("oemBattery.oems.tecno.steps.s1"),
        t("oemBattery.oems.tecno.steps.s2"),
        t("oemBattery.oems.tecno.steps.s3"),
        t("oemBattery.oems.tecno.steps.s4"),
      ],
    },
  };

  return (
    <AtlasPanel className="space-y-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <Smartphone className="h-4 w-4 text-signal" />
          {t("oemBattery.title")}
        </h2>
        <p className="text-xs text-ink-secondary leading-relaxed">
          {t("oemBattery.subtitle")}
        </p>
      </div>

      <div
        role="tablist"
        aria-label={t("oemBattery.tabListLabel")}
        className="flex flex-wrap gap-1.5"
      >
        {OEM_KEYS.map((key) => {
          const active = selected === key;
          const entry = oems[key];
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(key)}
              className={cn(
                "flex min-h-11 flex-col items-start justify-center rounded-xl border px-3 py-1.5 text-start transition-colors cursor-pointer",
                active
                  ? "border-signal bg-signal text-signal-ink"
                  : "border-hairline bg-surface-raised text-ink hover:border-hairline-strong",
              )}
            >
              <span className="text-xs font-semibold leading-tight">
                {entry.name}
              </span>
              <span
                className={cn(
                  "text-[10px] leading-tight",
                  active ? "text-signal-ink/80" : "text-ink-muted",
                )}
              >
                {entry.subtitle}
              </span>
            </button>
          );
        })}
      </div>

      <ol className="space-y-2 text-xs text-ink-secondary">
        {oems[selected].steps.map((text, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2.5 rounded-xl border border-hairline bg-surface-raised/50 p-3"
          >
            <SafeBdi className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal-soft font-mono text-[11px] font-semibold text-signal">
              {idx + 1}
            </SafeBdi>
            <span className="leading-relaxed text-ink">{text}</span>
          </li>
        ))}
      </ol>

      {selected === "huawei" && (
        <p className="rounded-xl border border-hazard-high/35 bg-hazard-high-soft/50 px-3 py-2 text-xs text-hazard-high-ink">
          {t("oemBattery.hmsCaveat")}
        </p>
      )}

      <p className="text-[11px] text-ink-muted">
        {t("oemBattery.channelsHint")}
      </p>
    </AtlasPanel>
  );
}
