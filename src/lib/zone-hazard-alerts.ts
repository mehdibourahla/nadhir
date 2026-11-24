import { ar } from "@/i18n/locales/ar";
import { en, type Translation } from "@/i18n/locales/en";
import { fr } from "@/i18n/locales/fr";
import { kab } from "@/i18n/locales/kab";
import {
  EARTHQUAKE_BROADCAST_MIN_MAGNITUDE,
  EARTHQUAKE_BROADCAST_RADIUS_KM,
} from "@/lib/broadcast-rules";
import { haversineKm } from "@/lib/nadhir";
import {
  authorityConcernsZone,
  officialConcernsZone,
  ONM_SEVERITY,
  roadConcernsZone,
  weatherConcernsZone,
  type ZoneArea,
} from "@/lib/zone-hazards";

export type HazardZone = {
  id: string;
  user_id: string;
  name: string;
  lat: number;
  lon: number;
  radius_km: number;
  commune_id: string | null;
  min_danger_level: number;
  notify_weather: boolean;
  notify_official: boolean;
  notify_road: boolean;
  notify_citizen: boolean;
  notify_earthquake: boolean;
};

export type HazardContext = {
  communes: Map<string, { code: string; wilayaId: string | null }>;
  weather: {
    id: string;
    severity: string;
    event: string;
    onset: string | null;
    title: string;
    headline_fr: string | null;
    polygon: [number, number][] | null;
    wilaya_id: string | null;
    expires: string;
    alert_key: string;
    advice: string | null;
    msg_type?: string | null;
    cancelled_at?: string | null;
    superseded_by?: string | null;
  }[];
  official: {
    id: string;
    kind: string;
    commune_id: string | null;
    wilaya_id: string | null;
    place_text: string | null;
    last_reported_at: string;
  }[];
  authority: {
    id: string;
    source: string;
    body: string;
    severity: string;
    wilaya_id: string | null;
    commune_codes: string[] | null;
    created_at: string;
  }[];
  road: {
    id: string;
    summary: string;
    area_id: string;
    source_name: string;
    expires_at: string;
  }[];
  citizen: {
    id: string;
    reporter: string;
    hazard: string | null;
    summary: string | null;
    lat: number;
    lon: number;
    expires_at: string;
    witnesses: string[];
  }[];
  earthquakes: {
    id: string;
    occurred_at: string;
    lat: number;
    lon: number;
    magnitude: number;
    network: string | null;
    offshore: boolean;
  }[];
};

export type HazardAlertRow = {
  user_id: string;
  zone_id: string;
  kind: "weather" | "official" | "road" | "citizen" | "earthquake";
  severity: number;
  commune_id: string | null;
  dedupe_key: string;
  title: string;
  body: string;
  // an EMSC event id is not a uuid, so earthquakes keep their identity in the key and payload
  source_table: string | null;
  source_id: string | null;
  payload: Record<string, unknown>;
};

type Copy = Record<
  | "weatherTitle"
  | "weatherBody"
  | "weatherAdvice"
  | "officialTitle"
  | "officialBody"
  | "authorityTitle"
  | "authorityBody"
  | "roadTitle"
  | "roadBody"
  | "citizenTitle"
  | "citizenQuote"
  | "citizenBodyOne"
  | "citizenBodyMany"
  | "quakeTitle"
  | "quakeBody",
  string
>;

const FR: Copy = {
  weatherTitle: "Vigilance ONM pour {{zone}}",
  weatherBody: "ONM : « {{text}} »",
  weatherAdvice: " Protection civile : « {{advice}} »",
  officialTitle: "Signalement de la Protection civile pour {{zone}}",
  officialBody: "Signalement de la Protection civile, {{place}} : {{hazard}}.",
  authorityTitle: "Avertissement officiel pour {{zone}}",
  authorityBody: "{{source}} : « {{text}} »",
  roadTitle: "Incident routier près de {{zone}}",
  roadBody:
    "« {{text}} » — signalé par {{source}}, vérifié par Nadhir. Information, pas une consigne officielle.",
  citizenTitle: "Signalement citoyen près de {{zone}} : {{hazard}}",
  citizenQuote: "« {{summary}} » ",
  citizenBodyOne:
    "{{quote}}Confirmé par une personne sur place. Non vérifié par les autorités.",
  citizenBodyMany:
    "{{quote}}Confirmé par {{count}} personnes sur place. Non vérifié par les autorités.",
  quakeTitle: "Séisme M{{mag}} près de {{zone}}",
  quakeBody:
    "Enregistré par le réseau sismique EMSC ({{network}}), à {{km}} km de {{zone}}. Si vous l'avez ressenti, éloignez-vous des bâtiments endommagés et appelez le 14 pour tout blessé.",
};

const COPY: Record<string, Copy> = {
  en: {
    weatherTitle: "ONM warning for {{zone}}",
    weatherBody: "ONM: “{{text}}”",
    weatherAdvice: " Protection Civile: “{{advice}}”",
    officialTitle: "Protection Civile report for {{zone}}",
    officialBody: "Protection Civile report, {{place}}: {{hazard}}.",
    authorityTitle: "Official warning for {{zone}}",
    authorityBody: "{{source}}: “{{text}}”",
    roadTitle: "Road incident near {{zone}}",
    roadBody:
      "“{{text}}” — reported by {{source}}, reviewed by Nadhir. Information, not an official order.",
    citizenTitle: "Citizen report near {{zone}}: {{hazard}}",
    citizenQuote: "“{{summary}}” ",
    citizenBodyOne:
      "{{quote}}Confirmed by one person nearby. Not verified by authorities.",
    citizenBodyMany:
      "{{quote}}Confirmed by {{count}} people nearby. Not verified by authorities.",
    quakeTitle: "Earthquake M{{mag}} near {{zone}}",
    quakeBody:
      "Recorded by the EMSC seismic network ({{network}}), {{km}} km from {{zone}}. If you felt it, keep away from damaged buildings and call 14 for anyone injured.",
  },
  fr: FR,
  kab: FR,
  ar: {
    weatherTitle: "تحذير الديوان الوطني للأرصاد الجوية لـ {{zone}}",
    weatherBody: "الديوان الوطني للأرصاد الجوية: «{{text}}»",
    weatherAdvice: " الحماية المدنية: «{{advice}}»",
    officialTitle: "بلاغ الحماية المدنية بخصوص {{zone}}",
    officialBody: "بلاغ الحماية المدنية، {{place}}: {{hazard}}.",
    authorityTitle: "تحذير رسمي بخصوص {{zone}}",
    authorityBody: "{{source}}: «{{text}}»",
    roadTitle: "حادث مروري قرب {{zone}}",
    roadBody:
      "«{{text}}» — أبلغ عنه {{source}} وراجعه نذير. معلومة وليست أمرًا رسميًا.",
    citizenTitle: "بلاغ مواطن قرب {{zone}}: {{hazard}}",
    citizenQuote: "«{{summary}}» ",
    citizenBodyOne: "{{quote}}أكّده شخص واحد في المكان. لم تتحقق منه السلطات.",
    citizenBodyMany:
      "{{quote}}أكّده {{count}} أشخاص في المكان. لم تتحقق منه السلطات.",
    quakeTitle: "زلزال بقوة {{mag}} قرب {{zone}}",
    quakeBody:
      "سجّلته شبكة الرصد الزلزالي EMSC ({{network}}) على بعد {{km}} كم من {{zone}}. إن شعرت به، ابتعد عن المباني المتضررة واتصل بالرقم 14 لأي مصاب.",
  },
};

const HAZARD_NAMES: Record<string, Translation["reports"]["hazardName"]> = {
  ar: ar.reports.hazardName,
  en: en.reports.hazardName,
  fr: fr.reports.hazardName,
  kab: kab.reports.hazardName,
};

const OFFICIAL_HAZARD_NAME: Partial<
  Record<string, keyof Translation["reports"]["hazardName"]>
> = {
  flood: "flooding",
  road: "road_blocked",
  structure: "structural",
  storm: "storm_damage",
  other: "other",
};

export const QUAKE_ALERT_MAGNITUDE = EARTHQUAKE_BROADCAST_MIN_MAGNITUDE;
const QUAKE_ALERT_KM = EARTHQUAKE_BROADCAST_RADIUS_KM;

const AUTHORITY_SEVERITY: Record<string, number> = { Severe: 4, Extreme: 5 };

const HOUR = 3_600_000;
const later = (at: string, hours: number) =>
  new Date(Date.parse(at) + hours * HOUR).toISOString();

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");

export function hazardAlerts(
  zones: HazardZone[],
  context: HazardContext,
  profileOf: (userId: string) => {
    locale: string;
    quiet: boolean;
    minLevel: number;
  },
) {
  const rows: HazardAlertRow[] = [];
  const raised = new Set<string>();
  let suppressed = 0;

  for (const zone of zones) {
    const { locale, quiet, minLevel } = profileOf(zone.user_id);
    const threshold = Math.max(zone.min_danger_level, minLevel);
    const copy = COPY[locale] ?? COPY["ar"]!;
    const hazardNames = HAZARD_NAMES[locale] ?? HAZARD_NAMES["ar"]!;
    const commune = zone.commune_id
      ? context.communes.get(zone.commune_id)
      : undefined;
    const area: ZoneArea = {
      lat: zone.lat,
      lon: zone.lon,
      radius_km: zone.radius_km,
      commune_id: zone.commune_id,
      communeCode: commune?.code ?? null,
      wilayaId: commune?.wilayaId ?? null,
    };
    const add = (
      row: Omit<HazardAlertRow, "user_id" | "zone_id" | "commune_id">,
      breaksThrough: boolean,
    ) => {
      // a hazard covered by several of one person's zones is one alert for that person
      const once = `${zone.user_id}|${row.dedupe_key}`;
      if (raised.has(once)) return;
      if (quiet && !breaksThrough) {
        suppressed += 1;
        return;
      }
      raised.add(once);
      rows.push({
        ...row,
        user_id: zone.user_id,
        zone_id: zone.id,
        commune_id: zone.commune_id,
      });
    };

    if (zone.notify_weather)
      for (const warning of context.weather) {
        if (
          warning.cancelled_at ||
          warning.superseded_by ||
          warning.msg_type === "Cancel"
        )
          continue;
        if (!weatherConcernsZone(area, warning)) continue;
        const severity = ONM_SEVERITY[warning.severity] ?? 2;
        if (severity < threshold) continue;
        add(
          {
            kind: "weather",
            severity,
            dedupe_key: warning.alert_key,
            title: fill(copy.weatherTitle, { zone: zone.name }),
            body:
              fill(copy.weatherBody, {
                text: warning.headline_fr ?? warning.title,
              }) +
              (warning.advice
                ? fill(copy.weatherAdvice, { advice: warning.advice })
                : ""),
            source_table: "onm_vigilance",
            source_id: warning.id,
            payload: {
              onm_severity: warning.severity,
              expires_at: warning.expires,
              map_event: `weather:${warning.id}`,
            },
          },
          warning.severity === "Extreme",
        );
      }

    if (zone.notify_official) {
      for (const incident of context.official) {
        if (!officialConcernsZone(area, incident)) continue;
        add(
          {
            kind: "official",
            severity: 4,
            dedupe_key: `official:${incident.id}`,
            title: fill(copy.officialTitle, { zone: zone.name }),
            body: fill(copy.officialBody, {
              place: incident.place_text ?? zone.name,
              hazard:
                hazardNames[OFFICIAL_HAZARD_NAME[incident.kind] ?? "fire"],
            }),
            source_table: "official_incidents",
            source_id: incident.id,
            payload: {
              expires_at: later(incident.last_reported_at, 72),
              map_event: `official:${incident.id}`,
            },
          },
          true,
        );
      }
      for (const warning of context.authority) {
        if (!authorityConcernsZone(area, warning)) continue;
        add(
          {
            kind: "official",
            severity: AUTHORITY_SEVERITY[warning.severity] ?? 4,
            dedupe_key: `official:${warning.id}`,
            title: fill(copy.authorityTitle, { zone: zone.name }),
            body: fill(copy.authorityBody, {
              source: warning.source,
              text: warning.body,
            }),
            source_table: "authority_warnings",
            source_id: warning.id,
            payload: {
              authority: warning.source,
              expires_at: later(warning.created_at, 24),
            },
          },
          true,
        );
      }
    }

    if (zone.notify_road)
      for (const publication of context.road) {
        if (!roadConcernsZone(area, publication)) continue;
        add(
          {
            kind: "road",
            severity: 2,
            dedupe_key: `road:${publication.id}`,
            title: fill(copy.roadTitle, { zone: zone.name }),
            body: fill(copy.roadBody, {
              text: publication.summary,
              source: publication.source_name,
            }),
            source_table: "civil_publications",
            source_id: publication.id,
            payload: {
              expires_at: publication.expires_at,
              map_event: `civil:${publication.id}`,
            },
          },
          false,
        );
      }

    if (zone.notify_citizen)
      for (const report of context.citizen) {
        if (
          !report.witnesses.length ||
          report.reporter === zone.user_id ||
          report.witnesses.includes(zone.user_id) ||
          haversineKm(zone.lat, zone.lon, report.lat, report.lon) >
            zone.radius_km
        )
          continue;
        const count = report.witnesses.length;
        add(
          {
            kind: "citizen",
            severity: 2,
            dedupe_key: `citizen:${report.id}`,
            title: fill(copy.citizenTitle, {
              zone: zone.name,
              hazard:
                hazardNames[
                  (report.hazard ?? "other") as keyof typeof hazardNames
                ] ?? hazardNames.other,
            }),
            body: fill(
              count === 1 ? copy.citizenBodyOne : copy.citizenBodyMany,
              {
                quote: report.summary
                  ? fill(copy.citizenQuote, { summary: report.summary })
                  : "",
                count: String(count),
              },
            ),
            source_table: "citizen_reports",
            source_id: report.id,
            payload: {
              witnesses: count,
              expires_at: report.expires_at,
              map_event: `report:${report.id}`,
            },
          },
          false,
        );
      }

    if (zone.notify_earthquake)
      for (const quake of context.earthquakes) {
        if (quake.magnitude < QUAKE_ALERT_MAGNITUDE) continue;
        const km = haversineKm(zone.lat, zone.lon, quake.lat, quake.lon);
        if (km > QUAKE_ALERT_KM) continue;
        const vars = {
          mag: quake.magnitude.toFixed(1),
          zone: zone.name,
          km: km.toFixed(0),
          network: quake.network ?? "EMSC",
        };
        add(
          {
            kind: "earthquake",
            severity: quake.magnitude >= 5 ? 4 : 3,
            dedupe_key: `earthquake:${quake.id}`,
            title: fill(copy.quakeTitle, vars),
            body: fill(copy.quakeBody, vars),
            source_table: null,
            source_id: null,
            payload: {
              magnitude: quake.magnitude,
              occurred_at: quake.occurred_at,
              offshore: quake.offshore,
              expires_at: new Date(
                Date.parse(quake.occurred_at) + 72 * HOUR,
              ).toISOString(),
              map_event: `quake:${quake.id}`,
            },
          },
          quake.magnitude >= 5,
        );
      }
  }

  return { rows, suppressed };
}
