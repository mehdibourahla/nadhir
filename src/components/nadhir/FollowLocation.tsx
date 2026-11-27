import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Switch } from "@/components/ui/switch";
import type { Locale } from "@/i18n";
import {
  CurrentCommune,
  type CurrentCommuneStatus,
} from "@/lib/current-commune";
import { unitName, type AdminUnit } from "@/lib/nadhir";
import { readSubscription, requestNotificationPermission } from "@/lib/push";

export function FollowLocation({
  lang,
  communes,
  locale,
}: {
  lang: string;
  communes: AdminUnit[];
  locale: Locale;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CurrentCommuneStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [denied, setDenied] = useState(false);
  const [silenced, setSilenced] = useState(false);

  useEffect(() => {
    void CurrentCommune.status().then(setStatus);
  }, []);

  // the first fix arrives after the switch is on, possibly seconds later
  useEffect(() => {
    if (!status?.enabled || status.commune) return;
    const timer = setInterval(
      () => void CurrentCommune.status().then(setStatus),
      5000,
    );
    return () => clearInterval(timer);
  }, [status]);

  const toggle = async (next: boolean) => {
    setPending(true);
    setDenied(false);
    setSilenced(false);
    try {
      // following a commune is useless if its alerts cannot be shown
      if (next && (await requestNotificationPermission()) !== "granted") {
        setSilenced(true);
        return;
      }
      setStatus(
        next
          ? await CurrentCommune.start({
              lang,
              pinned: readSubscription()?.communes ?? [],
            })
          : await CurrentCommune.stop(),
      );
    } catch (failure) {
      if (failure instanceof Error && failure.message === "location_denied")
        setDenied(true);
      else throw failure;
    } finally {
      setPending(false);
    }
  };

  const followed = status?.commune
    ? communes.find((c) => c.code === status.commune)
    : undefined;

  return (
    <section className="space-y-1.5">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t("push.followTitle")}</span>
        <Switch
          checked={!!status?.enabled}
          disabled={!status || pending}
          onCheckedChange={(next) => void toggle(next)}
        />
      </label>
      <p className="text-xs text-muted-foreground">{t("push.followBody")}</p>
      {status?.enabled && !status.commune ? (
        <p className="text-xs text-[var(--accent)]">
          {t("push.followWaiting")}
        </p>
      ) : null}
      {status?.enabled && followed ? (
        <p className="text-xs text-[var(--accent)]">
          {t("push.followCurrent", { name: unitName(followed, locale) })}
        </p>
      ) : null}
      {status?.enabled && !status.background ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {t("push.followForeground")}
          </p>
          <button
            type="button"
            onClick={() =>
              void CurrentCommune.requestBackground().then(setStatus)
            }
            className="min-h-11 rounded-md border border-border px-3 text-sm"
          >
            {t("push.followAllowBackground")}
          </button>
        </div>
      ) : null}
      {silenced ? (
        <p role="alert" className="text-xs text-destructive">
          {t("push.denied")}
        </p>
      ) : null}
      {denied ? (
        <p role="alert" className="text-xs text-destructive">
          {t("push.followDenied")}
        </p>
      ) : null}
    </section>
  );
}
