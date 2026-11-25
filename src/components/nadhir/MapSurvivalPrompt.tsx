import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Activity, CloudLightning, Flame, Waves } from "lucide-react";
import {
  relativeTime,
  type AdminUnit,
  type FireCluster,
  type OfficialIncident,
  type OnmVigilance,
} from "@/lib/nadhir";
import type { Earthquake } from "@/lib/earthquakes";
import type { Locale } from "@/i18n";
import {
  SURVIVAL_ACTIVE_KEY,
  SURVIVAL_DISMISS_KEY,
  selectEmergencyThreat,
  type EmergencyThreat,
} from "@/lib/survival";

const THREAT_ICON = {
  fire: Flame,
  flood: Waves,
  earthquake: Activity,
  storm: CloudLightning,
} as const;

export function MapSurvivalPrompt({
  fires,
  official = [],
  warnings = [],
  earthquakes = [],
  units = [],
  now,
}: {
  fires: FireCluster[];
  official?: OfficialIncident[];
  warnings?: OnmVigilance[];
  earthquakes?: Earthquake[];
  units?: AdminUnit[];
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const navigate = useNavigate();
  const returnFocus = useRef<HTMLElement | null>(null);
  const [interstitial, setInterstitial] = useState<EmergencyThreat | null>(
    null,
  );

  useEffect(() => {
    const suppressed = () =>
      localStorage.getItem(SURVIVAL_ACTIVE_KEY) ||
      sessionStorage.getItem(SURVIVAL_DISMISS_KEY);
    const hasPotentialThreat =
      fires.some((fire) => fire.state === "active") ||
      official.some(
        (inc) => inc.status === "ongoing" && inc.authority_tier !== "media",
      ) ||
      warnings.some(
        (w) =>
          !w.cancelled_at &&
          !w.superseded_by &&
          w.msg_type !== "Cancel" &&
          (w.severity === "Extreme" || w.severity === "Severe"),
      ) ||
      earthquakes.some((q) => q.magnitude >= 4.0);

    if (
      !hasPotentialThreat ||
      typeof navigator === "undefined" ||
      !("permissions" in navigator) ||
      !("geolocation" in navigator) ||
      suppressed()
    ) {
      setInterstitial(null);
      return;
    }
    let cancelled = false;
    // Only an already-granted permission is used: the map never prompts for location.
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (cancelled) return;
        if (status.state !== "granted" || suppressed()) {
          setInterstitial(null);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (cancelled) return;
            if (suppressed()) {
              setInterstitial(null);
              return;
            }
            const threat = selectEmergencyThreat(
              pos.coords.latitude,
              pos.coords.longitude,
              {
                fires,
                official,
                warnings,
                earthquakes,
                units,
                now,
              },
            );
            setInterstitial(threat);
          },
          () => {
            if (!cancelled) setInterstitial(null);
          },
          { timeout: 10000, maximumAge: 300000 },
        );
      })
      .catch(() => {
        if (!cancelled) setInterstitial(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fires, official, warnings, earthquakes, units, now]);

  const dismiss = () => {
    sessionStorage.setItem(SURVIVAL_DISMISS_KEY, "1");
    setInterstitial(null);
  };

  const ThreatIcon = interstitial ? THREAT_ICON[interstitial.hazard] : Flame;
  const kmText = (
    typeof interstitial?.km === "number" && Number.isFinite(interstitial.km)
      ? interstitial.km
      : 0
  ).toFixed(1);
  const magText = (
    typeof interstitial?.magnitude === "number" &&
    Number.isFinite(interstitial.magnitude)
      ? interstitial.magnitude
      : 4
  ).toFixed(1);

  return (
    <Dialog.Root
      open={interstitial !== null}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      {interstitial ? (
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-surface" />
          <Dialog.Content
            className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-surface"
            onOpenAutoFocus={() => {
              returnFocus.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null;
            }}
            onCloseAutoFocus={(event) => {
              if (returnFocus.current?.isConnected) {
                event.preventDefault();
                returnFocus.current.focus();
              }
            }}
          >
            <div
              className="h-1.5"
              style={{ backgroundColor: "var(--emergency)" }}
            />
            <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6">
              <span
                className="flex size-16 items-center justify-center rounded-full"
                style={{ backgroundColor: "var(--emergency-surface)" }}
              >
                <ThreatIcon
                  aria-hidden
                  className="size-8"
                  style={{ color: "var(--emergency-ink)" }}
                />
              </span>
              <Dialog.Title className="font-display text-3xl leading-tight">
                {t(interstitial.titleKey, {
                  km: kmText,
                  magnitude: magText,
                })}
              </Dialog.Title>
              <Dialog.Description className="text-[15px] leading-relaxed">
                {t(interstitial.bodyKey, {
                  km: kmText,
                  magnitude: magText,
                })}
              </Dialog.Description>
              {interstitial.offshoreM5Plus ? (
                <p
                  role="alert"
                  className="rounded-xl border px-3.5 py-2.5 text-sm font-medium"
                  style={{
                    backgroundColor: "var(--emergency-surface)",
                    borderColor: "var(--emergency)",
                    color: "var(--emergency-ink)",
                  }}
                >
                  {t("track3.emergency.prompt.offshoreQuakeNote")}
                </p>
              ) : null}
              <dl className="card flex flex-col gap-1.5 p-3 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("survival.interBasedOn")}
                  </dt>
                  <dd className="font-semibold">
                    {t("survival.interPosition")}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("survival.interObservation")}
                  </dt>
                  <dd className="font-semibold">
                    {interstitial.hazard === "fire" &&
                    interstitial.sourceKey === "survival.interSatellite"
                      ? t("survival.interSatellite", {
                          time: relativeTime(
                            interstitial.observedAt,
                            locale,
                            now,
                          ),
                        })
                      : `${t(interstitial.sourceKey)} · ${relativeTime(
                          interstitial.observedAt,
                          locale,
                          now,
                        )}`}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="mx-auto flex w-full max-w-md flex-col gap-2.5 px-6 pb-8">
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem(
                    SURVIVAL_ACTIVE_KEY,
                    new Date().toISOString(),
                  );
                  void navigate({
                    to: "/survival",
                    search: {
                      hazard: interstitial.hazard,
                      ...(interstitial.offshoreM5Plus
                        ? { offshoreM5: true }
                        : {}),
                    },
                  });
                }}
                className="flex h-14 items-center justify-center gap-2 rounded-xl text-base font-bold"
                style={{
                  backgroundColor: "var(--emergency)",
                  color: "var(--surface)",
                }}
              >
                {t("track3.emergency.prompt.openEmergencyTools")}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="flex h-12 items-center justify-center rounded-xl border border-border text-sm font-semibold text-muted-foreground"
              >
                {t("survival.interNotHere")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  );
}
