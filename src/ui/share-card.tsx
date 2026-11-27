import { Flame, ShieldCheck, AlertTriangle } from "lucide-react";

import type { Locale } from "@/i18n";
import type { OfficialIncident } from "@/lib/nadhir";
import {
  SHARE_FORMATS,
  incidentCardModel,
  type ShareFormat,
  type Translate,
} from "@/lib/share-card";
import { NadhirMark } from "@/ui/brand";
import { cleanCopy } from "@/ui/format";

export function AtlasIncidentShareCard({
  incident,
  format,
  lang,
  t,
}: {
  incident: OfficialIncident;
  format: ShareFormat;
  lang: Locale;
  t: Translate;
}) {
  const { width, height } = SHARE_FORMATS[format];
  const model = incidentCardModel(incident, t, lang);
  const rtl = lang === "ar";
  const compact = format === "sticker" || format === "og";
  const accent = model.fire ? "#DC2626" : "#EA580C";
  const accentSoft = model.fire
    ? "rgba(220, 38, 38, 0.22)"
    : "rgba(234, 88, 12, 0.22)";
  const accentInk = model.fire ? "#FECDD3" : "#FED7AA";

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      data-share-card="incident"
      data-format={format}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: "#070D17",
        color: "#EDF3FA",
        fontFamily: rtl
          ? '"Cairo", "Plus Jakarta Sans", system-ui, sans-serif'
          : '"Plus Jakarta Sans", system-ui, sans-serif',
      }}
      className="relative flex flex-col justify-between overflow-hidden select-none"
    >
      {/* Subtle cartographic coordinate grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(56,189,248,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.14) 1px, transparent 1px)",
          backgroundSize: compact ? "48px 48px" : "64px 64px",
        }}
      />

      {/* Top civic masthead stripe */}
      <div
        aria-hidden="true"
        className="relative z-10 h-2.5 w-full shrink-0"
        style={{ backgroundColor: accent }}
      />

      {/* Main editorial broadcast frame */}
      <div
        className={
          compact
            ? "relative z-10 flex flex-1 flex-col justify-between px-12 py-10"
            : "relative z-10 flex flex-1 flex-col justify-between px-16 py-16"
        }
      >
        {/* Header: Official attribution + status pill */}
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-3.5 min-w-0">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{
                backgroundColor: "rgba(56, 189, 248, 0.16)",
                color: "#38BDF8",
              }}
            >
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <div
                className="text-xs font-semibold uppercase tracking-widest"
                style={{
                  color: "#38BDF8",
                  letterSpacing: rtl ? "0" : "0.14em",
                }}
              >
                {cleanCopy(model.eyebrow)}
              </div>
              <div
                className={
                  compact
                    ? "truncate text-xl font-semibold text-white"
                    : "truncate text-2xl font-semibold text-white"
                }
              >
                {cleanCopy(model.source)}
              </div>
            </div>
          </div>

          <span
            className="inline-flex shrink-0 items-center gap-2.5 rounded-full px-5 py-2.5 font-semibold"
            style={{
              backgroundColor: accentSoft,
              color: accentInk,
              border: `1px solid ${accent}`,
              fontSize: compact ? "18px" : "22px",
            }}
          >
            {model.fire ? (
              <Flame className="h-5 w-5" />
            ) : (
              <AlertTriangle className="h-5 w-5" />
            )}
            <span>{cleanCopy(model.status)}</span>
          </span>
        </div>

        {/* Center civic bulletin card with vertical severity bar */}
        <div
          className={
            compact
              ? "my-auto flex items-stretch overflow-hidden rounded-2xl"
              : "my-auto flex items-stretch overflow-hidden rounded-3xl"
          }
          style={{
            backgroundColor: "#0D1626",
            border: "1px solid rgba(148, 179, 219, 0.22)",
          }}
        >
          <div
            aria-hidden="true"
            className="w-2.5 shrink-0"
            style={{ backgroundColor: accent }}
          />
          <div
            className={
              compact
                ? "flex flex-1 flex-col gap-3 px-10 py-8"
                : "flex flex-1 flex-col gap-6 px-12 py-12"
            }
          >
            <div
              className="font-semibold"
              style={{
                color: accentInk,
                fontSize: compact ? "22px" : "30px",
              }}
            >
              {cleanCopy(model.hazard)}
            </div>

            <h1
              className="font-bold tracking-tight text-white"
              style={{
                fontFamily: rtl
                  ? '"Cairo", system-ui, sans-serif'
                  : '"Fraunces", Georgia, serif',
                fontSize: compact
                  ? "46px"
                  : format === "story"
                    ? "76px"
                    : "64px",
                lineHeight: rtl ? 1.25 : 1.08,
              }}
            >
              {cleanCopy(model.place)}
            </h1>

            <div
              className="font-medium"
              style={{
                color: "#A8BDD8",
                fontSize: compact ? "24px" : "34px",
              }}
            >
              {cleanCopy(model.region)}
            </div>

            {model.placeText && (
              <p
                className="border-t pt-4"
                style={{
                  borderColor: "rgba(148, 179, 219, 0.16)",
                  color: "#CBD5E1",
                  fontSize: compact ? "20px" : "26px",
                  lineHeight: 1.45,
                }}
              >
                {cleanCopy(model.placeText)}
              </p>
            )}
          </div>
        </div>

        {/* Footer: Algiers timestamp + Nadhir broadcast mark */}
        <div
          className="flex items-center justify-between gap-6 border-t pt-6"
          style={{ borderColor: "rgba(148, 179, 219, 0.2)" }}
        >
          <div
            className="font-medium"
            style={{
              color: "#A8BDD8",
              fontSize: compact ? "18px" : "24px",
            }}
          >
            {cleanCopy(model.time)}
          </div>

          <div className="flex items-center gap-3.5 shrink-0" dir="ltr">
            <NadhirMark className={compact ? "h-9 w-9" : "h-11 w-11"} />
            <div className="text-left">
              <div
                className="font-bold tracking-tight text-white"
                style={{
                  fontFamily: '"Fraunces", Georgia, serif',
                  fontSize: compact ? "22px" : "28px",
                  lineHeight: 1,
                }}
              >
                Nadhir
              </div>
              <div
                className="font-mono"
                style={{
                  color: "#38BDF8",
                  fontSize: compact ? "14px" : "18px",
                }}
              >
                nadhir.app
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
