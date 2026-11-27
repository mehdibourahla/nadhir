import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Switch } from "@/components/ui/switch";
import {
  notificationPermission,
  pushConfigured,
  pushSupported,
  setUserPush,
  userPushEnabled,
} from "@/lib/push";

type Availability = "checking" | "unsupported" | "denied" | "ready";

export function DevicePush() {
  const { t } = useTranslation();
  const [availability, setAvailability] = useState<Availability>("checking");
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pushConfigured() || !pushSupported()) {
      setAvailability("unsupported");
      return;
    }
    let live = true;
    void notificationPermission().then((state) => {
      if (!live) return;
      setAvailability(state === "denied" ? "denied" : "ready");
      setEnabled(userPushEnabled() && state === "granted");
    });
    return () => {
      live = false;
    };
  }, []);

  const toggle = async (next: boolean) => {
    setPending(true);
    setError(null);
    try {
      await setUserPush(next);
      setEnabled(next);
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : String(failure);
      if (message === "permission_denied") setAvailability("denied");
      else setError(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-1 border-t border-border pt-3">
      <label className="flex items-center justify-between gap-3">
        <span className="font-medium">{t("account.devicePush")}</span>
        <Switch
          checked={enabled}
          disabled={availability !== "ready" || pending}
          onCheckedChange={(next) => void toggle(next)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {t("account.devicePushHint")}
      </p>
      {availability === "unsupported" || availability === "denied" ? (
        <p className="text-xs text-destructive">
          {t(
            availability === "unsupported"
              ? "account.pushUnsupported"
              : "account.pushDenied",
          )}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
