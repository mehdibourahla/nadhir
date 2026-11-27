import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CloudLightning,
  Flame,
  TrafficCone,
  TriangleAlert,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { AnyLocale } from "@/i18n/locales-list";
import { wilayaCommuneGeomsQuery, type OfficialIncident } from "@/lib/nadhir";
import {
  SHARE_FORMATS,
  UNIVERSAL_SHARE_FORMATS,
  incidentCardModel,
  outlinePaths,
  type ShareFormat,
  type UniversalShareFormat,
} from "@/lib/share-card";
import { shareTranslator } from "@/lib/share-translator";
import { isFireKind } from "@/lib/text-sources/merge";

const ICON: Record<string, LucideIcon> = {
  flood: Waves,
  road: TrafficCone,
  structure: Building2,
  storm: CloudLightning,
  other: TriangleAlert,
};
const ACCENT: Record<string, string> = {
  fire: "#f97316",
  flood: "#38bdf8",
  road: "#f59e0b",
  structure: "#e879f9",
  storm: "#a78bfa",
  other: "#a3a3a3",
};

const CLAMP = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
} as const;

type Props = {
  incident: OfficialIncident;
  format: ShareFormat | UniversalShareFormat;
  lang: AnyLocale;
};

export function IncidentCard({ incident, format, lang }: Props) {
  const t = shareTranslator(lang);
  const card = incidentCardModel(incident, t, lang);
  const key = isFireKind(incident.kind) ? "fire" : incident.kind;
  const Icon = key === "fire" ? Flame : (ICON[key] ?? TriangleAlert);
  const accent = ACCENT[key] ?? ACCENT["other"]!;
  const wilayaOnly = incident.precision === "wilaya" || !incident.commune_id;
  const needsMap = format !== "sticker";
  const geoms = useQuery({
    ...wilayaCommuneGeomsQuery(incident.wilaya_id),
    enabled: needsMap && typeof window !== "undefined",
  });
  const [fonts, setFonts] = useState(false);
  useEffect(() => {
    void document.fonts.ready.then(() => setFonts(true));
  }, []);
  // a commune report drawn without its commune would read as wilaya-wide
  const communeMissing =
    needsMap &&
    geoms.isSuccess &&
    !wilayaOnly &&
    !geoms.data.has(incident.commune_id!);
  const ready = fonts && (!needsMap || geoms.isSuccess) && !communeMissing;
  const size =
    format in SHARE_FORMATS
      ? SHARE_FORMATS[format as ShareFormat]
      : UNIVERSAL_SHARE_FORMATS[format as UniversalShareFormat];
  const rtl = lang === "ar";

  const map = (box: number) => {
    const entries = [...(geoms.data ?? new Map<string, never>()).entries()];
    const paths = outlinePaths(
      entries.map(([, geom]) => geom),
      box,
      box,
      box * 0.06,
    );
    const target = wilayaOnly
      ? -1
      : entries.findIndex(([id]) => id === incident.commune_id);
    const tint = wilayaOnly ? accent : "#f5efe6";
    return (
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden>
        <g
          opacity={wilayaOnly ? 0.55 : 0.18}
          fill={tint}
          stroke={tint}
          strokeWidth={2}
          strokeLinejoin="round"
        >
          {paths.map((d, i) => (i === target ? null : <path key={i} d={d} />))}
        </g>
        {target >= 0 ? (
          <path
            d={paths[target]}
            fill={accent}
            fillOpacity={0.85}
            stroke={accent}
            strokeWidth={4}
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
    );
  };

  const text = (
    <>
      <p style={{ fontSize: "1em", opacity: 0.75, ...CLAMP }}>
        {card.eyebrow} · {card.source}
      </p>
      <p
        style={{
          fontSize: "2.6em",
          fontWeight: 600,
          lineHeight: 1.1,
          marginTop: "0.4em",
        }}
      >
        <Icon
          style={{
            display: "inline",
            width: "0.9em",
            height: "0.9em",
            color: accent,
            marginInlineEnd: "0.25em",
            verticalAlign: "-0.1em",
          }}
        />
        {card.hazard}
      </p>
      <p style={{ fontSize: "1.5em", color: accent, fontWeight: 600 }}>
        {card.status}
      </p>
      <p style={{ fontSize: "1.8em", fontWeight: 600, marginTop: "0.6em" }}>
        {card.place}
      </p>
      <p style={{ fontSize: "1.1em", opacity: 0.75, ...CLAMP }}>
        {card.region}
        {card.placeText ? ` · ${card.placeText}` : null}
      </p>
      <p style={{ fontSize: "1.1em", marginTop: "0.6em" }}>{card.time}</p>
    </>
  );
  const brand = (
    <p style={{ fontSize: "1.1em", fontWeight: 600, letterSpacing: "0.02em" }}>
      nadhir.app
    </p>
  );

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      lang={lang}
      data-card-ready={ready ? "" : undefined}
      data-card-error={geoms.isError || communeMissing ? "" : undefined}
      style={{
        width: size.width,
        height: size.height,
        fontFamily: rtl ? "var(--font-arabic)" : "var(--font-sans)",
        color: "#f5efe6",
        background: format === "sticker" ? "transparent" : "#14110f",
        overflow: "hidden",
      }}
    >
      {format === "sticker" ? (
        <style>{"html,body{background:transparent!important}"}</style>
      ) : null}
      {format === "story" ? (
        <div
          style={{
            fontSize: 36,
            padding: "220px 96px",
            height: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {text}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {map(760)}
          </div>
          {brand}
        </div>
      ) : format === "post" ? (
        <div
          style={{
            fontSize: 30,
            padding: 80,
            height: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {text}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {map(520)}
          </div>
          {brand}
        </div>
      ) : format === "og" || format === "whatsapp" || format === "facebook" ? (
        <div
          style={{
            fontSize: format === "whatsapp" ? 20 : 26,
            padding: format === "whatsapp" ? 36 : 56,
            height: "100%",
            display: "flex",
            gap: format === "whatsapp" ? 24 : 40,
            alignItems: "center",
          }}
        >
          <div style={{ flex: 1 }}>
            {text}
            <div style={{ marginTop: "1em" }}>{brand}</div>
          </div>
          {map(format === "whatsapp" ? 300 : 480)}
        </div>
      ) : (
        <div
          style={{
            fontSize: 26,
            padding: 48,
            height: "100%",
            borderRadius: 48,
            background: "#14110ff2",
          }}
        >
          {text}
          <div style={{ marginTop: "0.8em" }}>{brand}</div>
        </div>
      )}
    </div>
  );
}
