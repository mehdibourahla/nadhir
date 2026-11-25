import { readRepoJson } from "./env.ts";

export interface AdminWilaya {
  code: string;
  name_ar: string;
  name_fr: string;
  name_en: string;
  name_kab: string | null;
  lat: number;
  lon: number;
}

export interface AdminCommune {
  code: string;
  osm_id: number;
  name_ar: string;
  name_fr: string;
  name_en: string;
  name_kab: string | null;
  lat: number;
  lon: number;
  wilaya_code: string;
}

export interface AlgeriaAdminData {
  source: string;
  licence: string;
  fetched: string;
  wilayas: AdminWilaya[];
  communes: AdminCommune[];
}

export interface Loi2606Wilaya {
  article: string;
  page: number;
  seat: string;
  communes: string[];
}

export interface Loi2606Data {
  source: string;
  total_wilayas: number;
  total_communes: number;
  wilayas: Loi2606Wilaya[];
  name_mappings: Record<string, string>;
  open_items: string[];
}

let cachedAlgeriaAdmin: AlgeriaAdminData | null = null;
let cachedLoi2606: Loi2606Data | null = null;

export function loadAlgeriaAdmin(): AlgeriaAdminData {
  if (!cachedAlgeriaAdmin) {
    cachedAlgeriaAdmin = readRepoJson<AlgeriaAdminData>(
      "data/geo/algeria-admin.json",
    );
  }
  return cachedAlgeriaAdmin;
}

export function loadLoi2606(): Loi2606Data {
  if (!cachedLoi2606) {
    cachedLoi2606 = readRepoJson<Loi2606Data>("data/geo/loi-26-06.json");
  }
  return cachedLoi2606;
}

export function deriveWilayaSlug(nameFr: string): string {
  return nameFr
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019`]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface OnmCapXmlOptions {
  identifier?: string;
  sender?: string;
  sent?: string;
  status?: "Actual" | "Exercise" | "System" | "Test" | "Draft";
  msgType?: "Alert" | "Update" | "Cancel";
  references?: string;
  language?: string;
  category?: string;
  event?: string;
  urgency?: "Immediate" | "Expected" | "Future" | "Past" | "Unknown";
  severity?: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  certainty?: "Observed" | "Likely" | "Possible" | "Unlikely" | "Unknown";
  onset?: string;
  expires?: string | null;
  senderName?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  areaDesc?: string;
  wilayaCodes?: string[];
  polygon?: string;
}

export function buildOnmCapXml(opts: OnmCapXmlOptions = {}): string {
  const identifier = opts.identifier ?? "urn:oid:2.49.0.1.12.0.20261124.001";
  const sender = opts.sender ?? "onm@meteo.dz";
  const sent = opts.sent ?? "2026-11-24T12:00:00+01:00";
  const status = opts.status ?? "Actual";
  const msgType = opts.msgType ?? "Alert";
  const language = opts.language ?? "fr-DZ";
  const category = opts.category ?? "Met";
  const event = opts.event ?? "Pluies et orages";
  const urgency = opts.urgency ?? "Expected";
  const severity = opts.severity ?? "Severe";
  const certainty = opts.certainty ?? "Likely";
  const onset = opts.onset ?? "2026-11-24T14:00:00+01:00";
  const expires =
    opts.expires === undefined ? "2026-11-25T06:00:00+01:00" : opts.expires;
  const senderName =
    opts.senderName ?? "Office National de la Météorologie (ONM)";
  const headline =
    opts.headline ??
    "Bulletin Météorologique Spécial (BMS) Pluies - Niveau 2 (Orange)";
  const description =
    opts.description ??
    "Cumuls de pluie estimés entre 40 mm et 60 mm sur les wilayas côtières du centre.";
  const instruction =
    opts.instruction ??
    "Suivez les consignes de la Protection Civile (14) et évitez les oueds en crue.";
  const areaDesc = opts.areaDesc ?? "Alger, Tipaza, Boumerdès";
  const wilayaCodes = opts.wilayaCodes ?? ["16", "42", "35"];

  const referencesTag = opts.references
    ? `  <references>${escapeXml(opts.references)}</references>\n`
    : "";
  const expiresTag =
    expires !== null ? `    <expires>${escapeXml(expires)}</expires>\n` : "";
  const geocodes = wilayaCodes
    .map(
      (code) =>
        `      <geocode><valueName>DZ-WILAYA</valueName><value>${escapeXml(code)}</value></geocode>`,
    )
    .join("\n");
  const polygonTag = opts.polygon
    ? `\n      <polygon>${escapeXml(opts.polygon)}</polygon>`
    : "";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">',
    `  <identifier>${escapeXml(identifier)}</identifier>`,
    `  <sender>${escapeXml(sender)}</sender>`,
    `  <sent>${escapeXml(sent)}</sent>`,
    `  <status>${escapeXml(status)}</status>`,
    `  <msgType>${escapeXml(msgType)}</msgType>`,
    "  <scope>Public</scope>",
    referencesTag ? referencesTag.trimEnd() : null,
    "  <info>",
    `    <language>${escapeXml(language)}</language>`,
    `    <category>${escapeXml(category)}</category>`,
    `    <event>${escapeXml(event)}</event>`,
    `    <urgency>${escapeXml(urgency)}</urgency>`,
    `    <severity>${escapeXml(severity)}</severity>`,
    `    <certainty>${escapeXml(certainty)}</certainty>`,
    `    <onset>${escapeXml(onset)}</onset>`,
    expiresTag ? expiresTag.trimEnd() : null,
    `    <senderName>${escapeXml(senderName)}</senderName>`,
    `    <headline>${escapeXml(headline)}</headline>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <instruction>${escapeXml(instruction)}</instruction>`,
    "    <area>",
    `      <areaDesc>${escapeXml(areaDesc)}</areaDesc>`,
    geocodes + polygonTag,
    "    </area>",
    "  </info>",
    "</alert>",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export type DgpcPostKind =
  "flood" | "storm" | "road" | "structure" | "retrospective" | "ita_media";

export interface DgpcNonFirePostFixture {
  postId: string;
  sourceKey: "dgpc_telegram" | "ita_facebook";
  kind: DgpcPostKind;
  publishedAt: string;
  textAr: string;
  textFr: string;
  wilayaCode: string;
  communeCode: string;
  communeName: string;
  lat: number;
  lon: number;
  cleared: boolean;
  isRetrospectiveCasualtyReport: boolean;
  sourceAttribution: string;
  sourceUrl: string;
}

export function buildDgpcNonFirePost(
  opts: Partial<DgpcNonFirePostFixture> & { kind?: DgpcPostKind } = {},
): DgpcNonFirePostFixture {
  const kind: DgpcPostKind = opts.kind ?? "flood";
  const defaultsByKind: Record<
    DgpcPostKind,
    Omit<DgpcNonFirePostFixture, "kind">
  > = {
    flood: {
      postId: "dgpc-tg-20261124-flood-01",
      sourceKey: "dgpc_telegram",
      publishedAt: "2026-11-24T15:10:00Z",
      textAr:
        "الحماية المدنية الجزائرية: تدخل متواصل لامتصاص مياه الأمطار وإجلاء محصورين ببلدية باب الوادي ولاية الجزائر.",
      textFr:
        "Protection Civile Algérie : intervention en cours pour pompage des eaux pluviales et secours à Bab El Oued, wilaya d'Alger.",
      wilayaCode: "16",
      communeCode: "1602",
      communeName: "Bab El Oued",
      lat: 36.7905,
      lon: 3.0497,
      cleared: false,
      isRetrospectiveCasualtyReport: false,
      sourceAttribution: "Direction Générale de la Protection Civile (DGPC)",
      sourceUrl: "https://t.me/dgpc_algerie/94001",
    },
    storm: {
      postId: "dgpc-tg-20261124-storm-02",
      sourceKey: "dgpc_telegram",
      publishedAt: "2026-11-24T15:25:00Z",
      textAr:
        "الحماية المدنية: رياح عاتية تتسبب في سقوط أشجار وأعمدة كهربائية ببلدية تيبازة.",
      textFr:
        "Protection Civile : vents violents provoquant la chute d'arbres et de poteaux électriques dans la commune de Tipaza.",
      wilayaCode: "42",
      communeCode: "4201",
      communeName: "Tipaza",
      lat: 36.5897,
      lon: 2.4475,
      cleared: false,
      isRetrospectiveCasualtyReport: false,
      sourceAttribution: "Direction Générale de la Protection Civile (DGPC)",
      sourceUrl: "https://t.me/dgpc_algerie/94002",
    },
    road: {
      postId: "dgpc-tg-20261124-road-03",
      sourceKey: "dgpc_telegram",
      publishedAt: "2026-11-24T15:40:00Z",
      textAr:
        "الحماية المدنية: انهيار صخري يغلق الطريق الوطني رقم 11 ببلدية شرشال ولاية تيبازة.",
      textFr:
        "Protection Civile : éboulement rocheux coupant la RN11 dans la commune de Cherchell, wilaya de Tipaza.",
      wilayaCode: "42",
      communeCode: "4222",
      communeName: "Cherchell",
      lat: 36.605,
      lon: 2.1908,
      cleared: false,
      isRetrospectiveCasualtyReport: false,
      sourceAttribution: "Direction Générale de la Protection Civile (DGPC)",
      sourceUrl: "https://t.me/dgpc_algerie/94003",
    },
    structure: {
      postId: "dgpc-tg-20261124-struct-04",
      sourceKey: "dgpc_telegram",
      publishedAt: "2026-11-24T16:00:00Z",
      textAr:
        "الحماية المدنية: انهيار جزئي لبناية قديمة بحي القصبة الجزائر العاصمة، وحداتنا في عين المكان.",
      textFr:
        "Protection Civile : effondrement partiel d'un immeuble vétuste à la Casbah d'Alger, équipes sur place.",
      wilayaCode: "16",
      communeCode: "1601",
      communeName: "Alger Centre",
      lat: 36.7753,
      lon: 3.0588,
      cleared: false,
      isRetrospectiveCasualtyReport: false,
      sourceAttribution: "Direction Générale de la Protection Civile (DGPC)",
      sourceUrl: "https://t.me/dgpc_algerie/94004",
    },
    retrospective: {
      postId: "dgpc-tg-20261124-bilan-05",
      sourceKey: "dgpc_telegram",
      publishedAt: "2026-11-24T08:00:00Z",
      textAr:
        "الحصيلة اليومية لتدخلات الحماية المدنية خلال الـ 24 ساعة الماضية: تسجيل 142 حادث مرور خلف 4 وفيات و185 جريحا.",
      textFr:
        "Bilan quotidien des interventions de la Protection Civile des dernières 24 heures : 142 accidents de la circulation ayant causé 4 décès et 185 blessés.",
      wilayaCode: "16",
      communeCode: "1601",
      communeName: "Alger Centre",
      lat: 36.7538,
      lon: 3.0588,
      cleared: true,
      isRetrospectiveCasualtyReport: true,
      sourceAttribution: "Direction Générale de la Protection Civile (DGPC)",
      sourceUrl: "https://t.me/dgpc_algerie/94005",
    },
    ita_media: {
      postId: "ita-fb-20261124-media-06",
      sourceKey: "ita_facebook",
      publishedAt: "2026-11-24T16:15:00Z",
      textAr:
        "معلومات مرورية الجزائر: ارتفاع منسوب المياه بنفق واد قريش الجزائر العاصمة، يرجى توخي الحذر.",
      textFr:
        "Info Trafic Algérie : montée des eaux signalée au tunnel Oued Koriche à Alger, prudence recommandée.",
      wilayaCode: "16",
      communeCode: "1602",
      communeName: "Oued Koriche",
      lat: 36.783,
      lon: 3.046,
      cleared: false,
      isRetrospectiveCasualtyReport: false,
      sourceAttribution: "Info Trafic Algérie (média communautaire)",
      sourceUrl: "https://www.facebook.com/InfoTraficAlgerie/posts/100200300",
    },
  };

  return {
    kind,
    ...defaultsByKind[kind],
    ...opts,
  };
}

export type TarikiPostKind =
  | "flood_closure"
  | "snow_closure"
  | "rockfall_closure"
  | "tatweel_hashtag_emoji"
  | "road_works"
  | "convoy"
  | "heavy_trucks_only";

export interface TarikiPostFixture {
  postId: string;
  kind: TarikiPostKind;
  publishedAt: string;
  rawText: string;
  roadCode: string;
  wilayaCode: string;
  wilayaName: string;
  sourceAttribution: string;
  url: string;
  expectedDangerous: boolean;
}

export function buildTarikiPost(
  opts: Partial<TarikiPostFixture> & { kind?: TarikiPostKind } = {},
): TarikiPostFixture {
  const kind: TarikiPostKind = opts.kind ?? "flood_closure";
  const presets: Record<TarikiPostKind, Omit<TarikiPostFixture, "kind">> = {
    flood_closure: {
      postId: "tariki-20261124-01",
      publishedAt: "2026-11-24T15:05:00Z",
      rawText:
        "🌧️🚧 #طريقي #الدرك_الوطني: الطريق الوطني رقم 11 (_RN11_) مغلق بسبب ارتفاع منسوب المياه ببلدية عين البنيان ولاية الجزائر.",
      roadCode: "RN11",
      wilayaCode: "16",
      wilayaName: "Alger",
      sourceAttribution: "Gendarmerie Nationale (Tariki)",
      url: "https://www.facebook.com/tariki.gn/posts/2026112401",
      expectedDangerous: true,
    },
    snow_closure: {
      postId: "tariki-20261124-02",
      publishedAt: "2026-11-24T15:15:00Z",
      rawText:
        "❄️⚠️ #طريقي: الطريق الوطني رقم 15 (_RN15_) الرابط بين ولايتي البويرة وتيزي وزو مغلق بسبب تراكم الثلوج بفج تيروردة.",
      roadCode: "RN15",
      wilayaCode: "15",
      wilayaName: "Tizi Ouzou",
      sourceAttribution: "Gendarmerie Nationale (Tariki)",
      url: "https://www.facebook.com/tariki.gn/posts/2026112402",
      expectedDangerous: true,
    },
    rockfall_closure: {
      postId: "tariki-20261124-03",
      publishedAt: "2026-11-24T15:20:00Z",
      rawText:
        "⚠️🪨 #طريقي: الطريق الولائي رقم 14 (_CW14_) مغلق بسبب انهيار صخري بولاية بجاية.",
      roadCode: "CW14",
      wilayaCode: "06",
      wilayaName: "Béjaïa",
      sourceAttribution: "Gendarmerie Nationale (Tariki)",
      url: "https://www.facebook.com/tariki.gn/posts/2026112403",
      expectedDangerous: true,
    },
    tatweel_hashtag_emoji: {
      postId: "tariki-20261124-04",
      publishedAt: "2026-11-24T15:25:00Z",
      rawText:
        "🚨🌧️ الـطـريـق الـوطـنـي رقم 11 #طـريـقي _RN11_ مغـلق بسبب الفـيـضـان بولاية تيبازة #حذر",
      roadCode: "RN11",
      wilayaCode: "42",
      wilayaName: "Tipaza",
      sourceAttribution: "Gendarmerie Nationale (Tariki)",
      url: "https://www.facebook.com/tariki.gn/posts/2026112404",
      expectedDangerous: true,
    },
    road_works: {
      postId: "tariki-20261124-05",
      publishedAt: "2026-11-24T10:00:00Z",
      rawText:
        "🛠️ #طريقي: أشغال صيانة وتزفيت على مستوى الطريق السيار شرق غرب باتجاه البليدة، حركة المرور بطيئة.",
      roadCode: "A1",
      wilayaCode: "09",
      wilayaName: "Blida",
      sourceAttribution: "Gendarmerie Nationale (Tariki)",
      url: "https://www.facebook.com/tariki.gn/posts/2026112405",
      expectedDangerous: false,
    },
    convoy: {
      postId: "tariki-20261124-06",
      publishedAt: "2026-11-24T10:30:00Z",
      rawText:
        "🚛 #طريقي: مرافقة قافلة استثنائية لنقل معدات صناعية عبر الطريق الوطني رقم 5 بولاية سطيف.",
      roadCode: "RN5",
      wilayaCode: "19",
      wilayaName: "Sétif",
      sourceAttribution: "Gendarmerie Nationale (Tariki)",
      url: "https://www.facebook.com/tariki.gn/posts/2026112406",
      expectedDangerous: false,
    },
    heavy_trucks_only: {
      postId: "tariki-20261124-07",
      publishedAt: "2026-11-24T11:00:00Z",
      rawText:
        "🚚 #طريقي: منع مؤقت لسير شاحنات الوزن الثقيل فقط عبر الطريق الاجتنابي الجنوبي بالجزائر العاصمة خلال أوقات الذروة.",
      roadCode: "RN61",
      wilayaCode: "16",
      wilayaName: "Alger",
      sourceAttribution: "Gendarmerie Nationale (Tariki)",
      url: "https://www.facebook.com/tariki.gn/posts/2026112407",
      expectedDangerous: false,
    },
  };

  return {
    kind,
    ...presets[kind],
    ...opts,
  };
}

export interface EmscGeoJsonFeature {
  type: "Feature";
  id: string;
  geometry: {
    type: "Point";
    coordinates: [number, number, number];
  };
  properties: {
    source_id: string;
    source_catalog: string;
    time: string;
    flynn_region: string;
    lat: number;
    lon: number;
    depth: number;
    mag: number;
    magtype: string;
    auth: string;
    lastupdate: string;
  };
}

export function buildEmscEvent(
  opts: {
    id?: string;
    time?: string;
    lat?: number;
    lon?: number;
    depthKm?: number;
    mag?: number;
    magtype?: string;
    region?: string;
    lastupdate?: string;
  } = {},
): EmscGeoJsonFeature {
  const id = opts.id ?? "20261124_0000046";
  const lat = opts.lat ?? 36.7525;
  const lon = opts.lon ?? 5.0556;
  const depthKm = opts.depthKm ?? 10;
  const mag = opts.mag ?? 4.6;
  const time = opts.time ?? "2026-11-24T13:42:18.4Z";
  return {
    type: "Feature",
    id,
    geometry: {
      type: "Point",
      coordinates: [lon, lat, -depthKm],
    },
    properties: {
      source_id: id,
      source_catalog: "EMSC-RTS",
      time,
      flynn_region: opts.region ?? "NORTHERN ALGERIA",
      lat,
      lon,
      depth: depthKm,
      mag,
      magtype: opts.magtype ?? "ml",
      auth: "EMSC",
      lastupdate: opts.lastupdate ?? "2026-11-24T13:44:05.0Z",
    },
  };
}

export interface CraagBulletinFixture {
  mode: "html" | "error_html" | "empty";
  eventTime: string;
  magnitude: number;
  depthKm: number;
  lat: number;
  lon: number;
  locationFr: string;
  locationAr: string;
  bulletinUrl: string;
  html: string;
}

export const HTTP_200_HTML_ERROR_BODY = [
  "<!DOCTYPE html>",
  '<html lang="en">',
  "<head><title>Service Temporarily Unavailable - MapServer Error</title></head>",
  "<body>",
  "<h1>503 Backend MapServer Error</h1>",
  "<p>The upstream WMS/OGC gateway returned an unexpected HTML maintenance page with HTTP 200.</p>",
  "</body>",
  "</html>",
].join("\n");

export function buildCraagBulletin(
  opts: Partial<Omit<CraagBulletinFixture, "html">> = {},
): CraagBulletinFixture {
  const mode = opts.mode ?? "html";
  const eventTime = opts.eventTime ?? "2026-11-24T13:42:20Z";
  const magnitude = opts.magnitude ?? 4.6;
  const depthKm = opts.depthKm ?? 10;
  const lat = opts.lat ?? 36.751;
  const lon = opts.lon ?? 5.058;
  const locationFr = opts.locationFr ?? "12 km au Nord-Est de Béjaïa";
  const locationAr = opts.locationAr ?? "12 كم شمال شرق بجاية";
  const bulletinUrl =
    opts.bulletinUrl ?? "https://www.craag.dz/communiques/seisme-20261124-01";

  let html: string;
  if (mode === "error_html") {
    html = HTTP_200_HTML_ERROR_BODY;
  } else if (mode === "empty") {
    html =
      '<!DOCTYPE html><html><head><title>CRAAG</title></head><body><section id="bulletins"></section></body></html>';
  } else {
    html = [
      '<!DOCTYPE html><html lang="fr"><head><title>CRAAG - Communiqué Sismique</title></head><body>',
      '<article class="craag-bulletin" data-source="CRAAG">',
      `  <h1>Secousse tellurique de magnitude ${magnitude.toFixed(1)} - ${locationFr}</h1>`,
      `  <p class="ar">${locationAr}</p>`,
      `  <time datetime="${eventTime}">${eventTime}</time>`,
      `  <span class="magnitude">${magnitude.toFixed(1)}</span>`,
      `  <span class="depth">${depthKm} km</span>`,
      `  <span class="coords">${lat.toFixed(4)}, ${lon.toFixed(4)}</span>`,
      `  <a href="${bulletinUrl}">Bulletin officiel CRAAG</a>`,
      "</article>",
      "</body></html>",
    ].join("\n");
  }

  return {
    mode,
    eventTime,
    magnitude,
    depthKm,
    lat,
    lon,
    locationFr,
    locationAr,
    bulletinUrl,
    html,
  };
}

export interface ImergCellFixture {
  lat: number;
  lon: number;
  wilayaCode: string;
  mm30m: number;
  mmPerHour: number;
}

export interface ImergFixture {
  product: "IMERG-Early" | "H-SAF";
  sourceType: "observed_satellite";
  windowStart: string;
  windowEnd: string;
  cells: ImergCellFixture[];
}

export function buildImergFixture(
  opts: Partial<ImergFixture> = {},
): ImergFixture {
  return {
    product: opts.product ?? "IMERG-Early",
    sourceType: "observed_satellite",
    windowStart: opts.windowStart ?? "2026-11-24T14:30:00Z",
    windowEnd: opts.windowEnd ?? "2026-11-24T15:00:00Z",
    cells: opts.cells ?? [
      {
        lat: 36.75,
        lon: 3.05,
        wilayaCode: "16",
        mm30m: 28.4,
        mmPerHour: 56.8,
      },
      {
        lat: 36.59,
        lon: 2.45,
        wilayaCode: "42",
        mm30m: 21.2,
        mmPerHour: 42.4,
      },
    ],
  };
}

export interface MtgFciHotspotFixture {
  id: string;
  lat: number;
  lon: number;
  frpMw: number;
  confidence: number;
  wilayaCode: string | null;
  insideWatchArea: boolean;
}

export interface MtgFciFixture {
  slotTime: string;
  cadenceMinutes: number;
  quietSaharaOnly: boolean;
  hotspots: MtgFciHotspotFixture[];
}

export function buildMtgFciFixture(
  opts: {
    slotTime?: string;
    quietSaharaOnly?: boolean;
    hotspots?: MtgFciHotspotFixture[];
  } = {},
): MtgFciFixture {
  const quietSaharaOnly = opts.quietSaharaOnly ?? false;
  const defaultHotspots: MtgFciHotspotFixture[] = quietSaharaOnly
    ? [
        {
          id: "mtg-fci-sahara-gas-flare-01",
          lat: 28.05,
          lon: 6.25,
          frpMw: 14.5,
          confidence: 0.65,
          wilayaCode: null,
          insideWatchArea: false,
        },
      ]
    : [
        {
          id: "mtg-fci-tizi-01",
          lat: 36.7169,
          lon: 4.0497,
          frpMw: 64.2,
          confidence: 0.91,
          wilayaCode: "15",
          insideWatchArea: true,
        },
      ];

  return {
    slotTime: opts.slotTime ?? "2026-11-24T15:05:00Z",
    cadenceMinutes: 5,
    quietSaharaOnly,
    hotspots: opts.hotspots ?? defaultHotspots,
  };
}

export interface MtgLightningFixture {
  slotTime: string;
  flashes: Array<{
    id: string;
    lat: number;
    lon: number;
    radianceJ: number;
    wilayaCode: string;
  }>;
}

export function buildMtgLightningFixture(
  opts: Partial<MtgLightningFixture> = {},
): MtgLightningFixture {
  return {
    slotTime: opts.slotTime ?? "2026-11-24T15:05:00Z",
    flashes: opts.flashes ?? [
      {
        id: "mtg-li-001",
        lat: 36.74,
        lon: 3.07,
        radianceJ: 1.8e5,
        wilayaCode: "16",
      },
      {
        id: "mtg-li-002",
        lat: 36.61,
        lon: 2.41,
        radianceJ: 2.4e5,
        wilayaCode: "42",
      },
    ],
  };
}

export interface GwisFixture {
  observedAt: string;
  wilayaCode: string;
  fwi: number;
  dangerClass: "low" | "moderate" | "high" | "very_high" | "extreme";
  burnedAreaHa: number;
  polygon: number[][][];
}

export function buildGwisFixture(opts: Partial<GwisFixture> = {}): GwisFixture {
  return {
    observedAt: opts.observedAt ?? "2026-11-24T12:00:00Z",
    wilayaCode: opts.wilayaCode ?? "15",
    fwi: opts.fwi ?? 48.3,
    dangerClass: opts.dangerClass ?? "very_high",
    burnedAreaHa: opts.burnedAreaHa ?? 145.6,
    polygon: opts.polygon ?? [
      [
        [4.02, 36.7],
        [4.08, 36.7],
        [4.08, 36.74],
        [4.02, 36.74],
        [4.02, 36.7],
      ],
    ],
  };
}

export interface ClmsFixture {
  observedAt: string;
  wilayaCode: string;
  lat: number;
  lon: number;
  ndvi: number;
  ndviAnomaly: number;
  swi: number;
}

export function buildClmsFixture(opts: Partial<ClmsFixture> = {}): ClmsFixture {
  return {
    observedAt: opts.observedAt ?? "2026-11-24T00:00:00Z",
    wilayaCode: opts.wilayaCode ?? "15",
    lat: opts.lat ?? 36.7169,
    lon: opts.lon ?? 4.0497,
    ndvi: opts.ndvi ?? 0.34,
    ndviAnomaly: opts.ndviAnomaly ?? -0.18,
    swi: opts.swi ?? 22.5,
  };
}

export interface GhslFixture {
  epoch: number;
  wilayaCode: string;
  communeCode: string;
  lat: number;
  lon: number;
  populationWithin5km: number;
  builtUpShare: number;
}

export function buildGhslFixture(opts: Partial<GhslFixture> = {}): GhslFixture {
  return {
    epoch: opts.epoch ?? 2025,
    wilayaCode: opts.wilayaCode ?? "16",
    communeCode: opts.communeCode ?? "1602",
    lat: opts.lat ?? 36.7905,
    lon: opts.lon ?? 3.0497,
    populationWithin5km: opts.populationWithin5km ?? 148_500,
    builtUpShare: opts.builtUpShare ?? 0.78,
  };
}
