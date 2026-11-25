import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Locale } from "@/i18n";
import {
  deviceStorage,
  loadPack,
  shouldAutoPreparePack,
} from "@/lib/survival-pack";
import { prepareZonePack, type PackZone } from "@/lib/survival-pack-prepare";

export function PackPreparation({
  zone,
  auto = false,
}: {
  zone: PackZone;
  auto?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [pack, setPack] = useState(() =>
    typeof window === "undefined" ? null : loadPack(deviceStorage),
  );
  const [status, setStatus] = useState<"idle" | "pending" | "failed">("idle");
  const ready =
    pack?.shell_ready && pack.lat === zone.lat && pack.lon === zone.lon;
  async function prepare() {
    setStatus("pending");
    try {
      setPack(await prepareZonePack(qc, zone, i18n.language as Locale));
      window.dispatchEvent(new Event("nadhir:pack-saved"));
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  }
  useEffect(() => {
    if (auto && shouldAutoPreparePack(loadPack(deviceStorage), zone))
      void prepare();
    // One attempt per mounted zone; failures wait for an explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const changed = () => setPack(loadPack(deviceStorage));
    window.addEventListener("nadhir:pack-saved", changed);
    return () => window.removeEventListener("nadhir:pack-saved", changed);
  }, []);
  return (
    <section className="mt-3 rounded-md border border-border p-3 text-sm">
      <h4 className="font-medium">{t("survival.packTitle")}</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("survival.packScope")}
      </p>
      <p role="status" className="mt-2">
        {status === "pending"
          ? t("survival.packPreparing")
          : ready
            ? t("survival.packReady", {
                zone: pack.zone_name ?? zone.name,
                time: pack.saved_at,
              })
            : t("survival.packMissing")}
      </p>
      {status === "failed" ? (
        <p role="alert" className="mt-2 text-destructive">
          {t("survival.packFailed")}
        </p>
      ) : null}
      <button
        type="button"
        disabled={status === "pending"}
        onClick={() => void prepare()}
        className="mt-2 inline-flex min-h-11 items-center rounded border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {t("survival.packPrepare")}
      </button>
    </section>
  );
}
