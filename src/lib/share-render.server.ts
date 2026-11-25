import type { Earthquake } from "@/lib/earthquakes";
import {
  hasSightingNear,
  singleCandidateLinks,
  type FireContext,
} from "@/lib/fire-confidence";
import {
  fetchOfficialIncident,
  publishedRiskSnapshot,
  unitName,
  type AdminUnit,
  type OfficialIncident,
  type OnmVigilance,
  type RiskForecast,
} from "@/lib/nadhir";
import {
  CARD_REVISION,
  MAX_SHARE_CARD_BYTES,
  OFFICIAL_AUTHORITY_TIERS,
  SHARE_FORMATS,
  UNIVERSAL_SHARE_FORMATS,
  cardVersion,
  codecContentType,
  effectiveFireConfirmedAt,
  fireCardModel,
  isEligibleEarthquake,
  isEligibleOfficialIncident,
  isEligibleOnmWarning,
  isEligibleProbableFire,
  isShareFormat,
  isShareable,
  onmCardModel,
  quakeCardModel,
  shareCardPath,
  shareLocale,
  universalIncidentCardModel,
  wilayaCardModel,
  type EligibleFireClusterInput,
  type ParsedUniversalShareRequest,
  type ShareFormat,
  type ShareImageCodec,
  type ShareKind,
  type UniversalShareCardModel,
  type UniversalShareFormat,
} from "@/lib/share-card";
import { renderUniversalShareCardHtml } from "@/lib/share-card-html";
import {
  getLocalShareBrowser,
  isCloudflareWorkersRuntime,
  type CaptureAttempt,
} from "@/lib/share-cdp.server";
import { quantizePngToIndexed } from "@/lib/share-png-quantize.server";
import { shareTranslator } from "@/lib/share-translator";
import { FIRE_KINDS } from "@/lib/text-sources/merge";
import { fetchWilayaSnapshot, isSupabaseConfigured } from "@/lib/wilaya-data";
import { wilayaByCode, wilayaBySlug } from "@/lib/wilaya-slugs";
import type { AnyLocale } from "@/i18n/locales-list";

export type Screenshotter = (
  url: string,
  format: ShareFormat,
) => Promise<Uint8Array<ArrayBuffer>>;
type CacheLike = Pick<Cache, "match" | "put">;

export type ShareDeps = {
  load: (id: string) => Promise<OfficialIncident | null>;
  screenshot: Screenshotter | null;
  cache: CacheLike | null;
  limit: () => Promise<Response | null>;
};

type Input = {
  id: string;
  format: string;
  lang: string | null;
  v: string | null;
  origin: string;
};

const IMMUTABLE = "public, max-age=31536000, immutable";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Legacy incident screenshot handler preserved for existing tests & callers. */
export async function handleShareImage(input: Input, deps: ShareDeps) {
  if (!isShareFormat(input.format))
    return new Response("unknown format", { status: 400 });
  const format = input.format;
  const incident = await deps.load(input.id);
  if (!incident || !isShareable(incident))
    return new Response("not found", { status: 404 });
  const lang = shareLocale(input.lang);
  const version = cardVersion(incident.updated_at);
  const type =
    SHARE_FORMATS[format].type === "jpeg" ? "image/jpeg" : "image/png";
  const headers = {
    "content-type": type,
    "cache-control": input.v === version ? IMMUTABLE : "public, max-age=60",
  };
  const key = new Request(
    `${input.origin}/__share/${incident.id}/${format}/${lang}/${version}`,
  );
  const hit = await deps.cache?.match(key);
  if (hit) return new Response(hit.body, { headers });
  if (!deps.screenshot)
    return new Response("browser rendering unavailable here", { status: 501 });
  const limited = await deps.limit();
  if (limited) return limited;
  let image: Uint8Array<ArrayBuffer>;
  try {
    image = await deps.screenshot(
      `${input.origin}${shareCardPath(incident.id, format, lang)}`,
      format,
    );
  } catch (failure) {
    console.error("share card render failed", incident.id, format, failure);
    return new Response("render failed", {
      status: 503,
      headers: { "retry-after": "30" },
    });
  }
  await deps.cache?.put(
    key,
    new Response(image, {
      headers: { "content-type": type, "cache-control": IMMUTABLE },
    }),
  );
  return new Response(image, { headers });
}

export async function browserScreenshotter(): Promise<Screenshotter | null> {
  let binding: unknown;
  try {
    binding = (await import("cloudflare:workers")).env["BROWSER"];
  } catch {
    return null;
  }
  if (!binding) return null;
  const { default: puppeteer } = await import("@cloudflare/puppeteer");
  return async (url, format) => {
    const { width, height, type } = SHARE_FORMATS[format];
    const browser = await puppeteer.launch(
      binding as Parameters<typeof puppeteer.launch>[0],
    );
    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: "networkidle0", timeout: 15_000 });
      const card = await page.waitForSelector(
        "[data-card-ready],[data-card-error]",
        { timeout: 15_000 },
      );
      if (await card?.evaluate((el) => el.hasAttribute("data-card-error")))
        throw new Error("card reported an error");
      return (await page.screenshot(
        type === "jpeg"
          ? { type: "jpeg", quality: 80 }
          : { type: "png", omitBackground: format === "sticker" },
      )) as Uint8Array<ArrayBuffer>;
    } finally {
      await browser.close();
    }
  };
}

/* ---------- Universal Adaptive Compression & Dual-Driver Renderer ---------- */

const WEBP_STEPS: readonly CaptureAttempt[] = [
  { codec: "webp", quality: 80, scale: 1 },
  { codec: "webp", quality: 68, scale: 1 },
  { codec: "webp", quality: 54, scale: 1 },
  { codec: "webp", quality: 40, scale: 1 },
  { codec: "webp", quality: 62, scale: 0.75 },
  { codec: "webp", quality: 45, scale: 0.75 },
  { codec: "webp", quality: 32, scale: 0.75 },
  { codec: "webp", quality: 32, scale: 0.6 },
];

const JPEG_STEPS: readonly CaptureAttempt[] = [
  { codec: "jpeg", quality: 78, scale: 1 },
  { codec: "jpeg", quality: 64, scale: 1 },
  { codec: "jpeg", quality: 52, scale: 1 },
  { codec: "jpeg", quality: 40, scale: 1 },
  { codec: "jpeg", quality: 58, scale: 0.75 },
  { codec: "jpeg", quality: 42, scale: 0.75 },
  { codec: "jpeg", quality: 30, scale: 0.75 },
  { codec: "jpeg", quality: 30, scale: 0.6 },
];

export async function applyCompressionLadder(
  codec: ShareImageCodec,
  maxBytes: number,
  capture: (attempt: CaptureAttempt) => Promise<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (codec === "webp" || codec === "jpeg") {
    const steps = codec === "webp" ? WEBP_STEPS : JPEG_STEPS;
    let smallest: Uint8Array<ArrayBuffer> | null = null;
    for (const step of steps) {
      const bytes = await capture(step);
      if (!smallest || bytes.byteLength < smallest.byteLength) {
        smallest = bytes;
      }
      if (bytes.byteLength <= maxBytes) {
        return bytes;
      }
    }
    return smallest!;
  }

  // PNG ladder: raw -> indexed-32 -> indexed-16 -> scale 0.75 indexed-16 -> scale 0.6 indexed-16
  const rawFull = await capture({ codec: "png", scale: 1 });
  let smallest = rawFull;
  if (rawFull.byteLength <= maxBytes) return rawFull;

  const q32 = quantizePngToIndexed(rawFull, 32);
  if (q32.byteLength < smallest.byteLength) smallest = q32;
  if (q32.byteLength <= maxBytes) return q32;

  const q16 = quantizePngToIndexed(rawFull, 16);
  if (q16.byteLength < smallest.byteLength) smallest = q16;
  if (q16.byteLength <= maxBytes) return q16;

  for (const scale of [0.75, 0.6]) {
    const rawScaled = await capture({ codec: "png", scale });
    if (rawScaled.byteLength < smallest.byteLength) smallest = rawScaled;
    if (rawScaled.byteLength <= maxBytes) return rawScaled;

    const scaledQ16 = quantizePngToIndexed(rawScaled, 16);
    if (scaledQ16.byteLength < smallest.byteLength) smallest = scaledQ16;
    if (scaledQ16.byteLength <= maxBytes) return scaledQ16;
  }

  return smallest;
}

export interface RenderHtmlOptions {
  format: UniversalShareFormat;
  codec: ShareImageCodec;
  maxBytes?: number;
}

async function renderViaCloudflareBrowser(
  html: string,
  opts: RenderHtmlOptions,
): Promise<Uint8Array<ArrayBuffer> | null> {
  let binding: unknown;
  try {
    binding = (await import("cloudflare:workers")).env["BROWSER"];
  } catch {
    return null;
  }
  if (!binding) return null;

  const { default: puppeteer } = await import("@cloudflare/puppeteer");
  const spec = UNIVERSAL_SHARE_FORMATS[opts.format];
  const maxBytes = opts.maxBytes ?? MAX_SHARE_CARD_BYTES;
  const browser = await puppeteer.launch(
    binding as Parameters<typeof puppeteer.launch>[0],
  );
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: spec.width,
      height: spec.height,
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    await page
      .evaluate(() =>
        document.fonts && document.fonts.ready ? document.fonts.ready : true,
      )
      .catch(() => {});

    let currentScale = 1;
    return await applyCompressionLadder(
      opts.codec,
      maxBytes,
      async (attempt) => {
        if (attempt.scale !== currentScale) {
          await page.setViewport({
            width: spec.width,
            height: spec.height,
            deviceScaleFactor: attempt.scale,
          });
          currentScale = attempt.scale;
        }
        const raw = await page.screenshot(
          attempt.codec === "png"
            ? { type: "png", omitBackground: spec.omitBackground }
            : {
                type: attempt.codec,
                quality: attempt.quality ?? 78,
                omitBackground: spec.omitBackground,
              },
        );
        const bytes = raw as Uint8Array;
        const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
        out.set(bytes);
        return out;
      },
    );
  } finally {
    await browser.close();
  }
}

export async function renderHtmlToShareImage(
  html: string,
  opts: RenderHtmlOptions,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const cfResult = await renderViaCloudflareBrowser(html, opts);
  if (cfResult) return cfResult;

  if (isCloudflareWorkersRuntime()) {
    return null;
  }

  const localBrowser = await getLocalShareBrowser();
  if (!localBrowser) return null;

  const spec = UNIVERSAL_SHARE_FORMATS[opts.format];
  const maxBytes = opts.maxBytes ?? MAX_SHARE_CARD_BYTES;
  return localBrowser.captureWithLadder(
    html,
    {
      width: spec.width,
      height: spec.height,
      omitBackground: spec.omitBackground,
    },
    (capture) => applyCompressionLadder(opts.codec, maxBytes, capture),
  );
}

export async function renderUniversalShareCard(
  model: UniversalShareCardModel,
  opts: RenderHtmlOptions,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const html = renderUniversalShareCardHtml(model, opts.format);
  return renderHtmlToShareImage(html, opts);
}

/* ---------- Universal 5-Entity Offline-Safe Data Loader ---------- */

const ADMIN_NAME_COLS =
  "id, level, code, name_ar, name_fr, name_en, name_kab, parent_id, forest_fraction";
const ONM_COLS =
  "id, cap_id, title, event, severity, urgency, certainty, onset, expires, sent, area_desc, cap_url, wilaya_id, headline_fr, superseded_at, msg_type, cap_references, superseded_by, cancelled_at";
const FIRE_COLS =
  "id, short_id, state, first_detected_at, last_detected_at, updated_at, lat, lon, detection_count, sources, max_frp_mw, confidence, est_area_ha, commune_id, wilaya_id, confirmed_at, resolved_at, confirmed_mention_id, suspected_persistent_source";
const QUAKE_COLS =
  "id, occurred_at, lat, lon, depth_km, magnitude, magnitude_type, region, network, commune_id, offshore, updated_at";

async function loadOnmModel(
  id: string,
  lang: AnyLocale,
  nowMs: number,
): Promise<UniversalShareCardModel | null> {
  if (!isSupabaseConfigured()) return null;
  const { publicSupabase } = await import("@/lib/public-api.server");
  const client = publicSupabase();

  const query = UUID_RE.test(id)
    ? client.from("onm_vigilance").select(ONM_COLS).eq("id", id).maybeSingle()
    : client
        .from("onm_vigilance")
        .select(ONM_COLS)
        .eq("cap_id", id)
        .order("sent", { ascending: false })
        .limit(1)
        .maybeSingle();

  const { data, error } = await query;
  if (error || !data) return null;
  const warning = data as unknown as OnmVigilance;
  if (!isEligibleOnmWarning(warning, nowMs)) return null;

  let wilayaLabel: string | null = null;
  if (warning.wilaya_id) {
    const { data: unitData } = await client
      .from("admin_units")
      .select(ADMIN_NAME_COLS)
      .eq("id", warning.wilaya_id)
      .maybeSingle();
    if (unitData) {
      wilayaLabel = unitName(unitData as unknown as AdminUnit, lang);
    }
  }

  return onmCardModel(warning, wilayaLabel, shareTranslator(lang), lang);
}

const LINK_BEFORE_MS = 24 * 3_600_000;
const LINK_AFTER_MS = 6 * 3_600_000;

type PublicSupabaseClient = ReturnType<
  typeof import("@/lib/public-api.server").publicSupabase
>;

export async function loadFireModel(
  id: string,
  lang: AnyLocale,
  nowMs: number,
  injectedClient?: PublicSupabaseClient,
): Promise<UniversalShareCardModel | null> {
  if (!injectedClient && !isSupabaseConfigured()) return null;
  const isUuid = UUID_RE.test(id);
  if (!isUuid && !SHORT_ID_RE.test(id)) return null;

  const client =
    injectedClient ??
    (await import("@/lib/public-api.server")).publicSupabase();

  const { data, error } = isUuid
    ? await client
        .from("fire_clusters")
        .select(FIRE_COLS)
        .eq("id", id)
        .maybeSingle()
    : await client
        .from("fire_clusters")
        .select(FIRE_COLS)
        .eq("short_id", id)
        .maybeSingle();

  if (error || !data) return null;
  const cluster = data as unknown as EligibleFireClusterInput & {
    commune_id: string | null;
    wilaya_id: string | null;
    confirmed_mention_id: string | null;
  };

  // Verify confirmation mention tier strictly against official authority tiers (fail closed)
  let confirmedMentionTier: string | null = null;
  let confirmedSourceLabel: string | null = null;
  if (cluster.confirmed_mention_id) {
    const { data: mentionData, error: mentionError } = await client
      .from("incident_mentions")
      .select("source:text_sources(authority_tier, label)")
      .eq("id", cluster.confirmed_mention_id)
      .maybeSingle();
    const source = mentionError
      ? null
      : (
          mentionData as {
            source?: {
              authority_tier?: string | null;
              label?: string | null;
            } | null;
          } | null
        )?.source;
    const tier = source?.authority_tier ?? null;
    if (tier && OFFICIAL_AUTHORITY_TIERS.has(tier)) {
      confirmedMentionTier = tier;
      confirmedSourceLabel = source?.label ?? null;
    } else {
      confirmedMentionTier = "unknown";
    }
  }

  // Load commune/wilaya context, fire danger, nearby sightings, and wilaya-level fire incidents
  const unitIds = [cluster.commune_id, cluster.wilaya_id].filter(
    (v): v is string => Boolean(v),
  );
  const lastDetectedMs = Date.parse(cluster.last_detected_at);
  const [unitsRes, checkpointRes, reportsRes, incidentsRes] = await Promise.all(
    [
      unitIds.length > 0
        ? client.from("admin_units").select(ADMIN_NAME_COLS).in("id", unitIds)
        : Promise.resolve({ data: [], error: null }),
      client
        .from("risk_publication_checkpoint")
        .select("coverage_status, snapshot_id, base_date, published_at")
        .eq("key", "local_fwi")
        .maybeSingle(),
      client
        .from("hazard_reports")
        .select("kind, lat, lon, observed_at, status")
        .eq("kind", "sighting")
        .gte("observed_at", new Date(nowMs - 72 * 3_600_000).toISOString())
        .limit(200),
      cluster.wilaya_id && Number.isFinite(lastDetectedMs)
        ? client
            .from("official_incidents")
            .select("wilaya_id, commune_id, authority_tier, first_reported_at")
            .eq("wilaya_id", cluster.wilaya_id)
            .in("kind", [...FIRE_KINDS])
            .is("commune_id", null)
            .neq("authority_tier", "media")
            .gte(
              "first_reported_at",
              new Date(lastDetectedMs - LINK_AFTER_MS).toISOString(),
            )
            .lte(
              "first_reported_at",
              new Date(lastDetectedMs + LINK_BEFORE_MS).toISOString(),
            )
            .order("first_reported_at", { ascending: true })
            .limit(50)
        : Promise.resolve({ data: [], error: null }),
    ],
  );

  const units = (unitsRes.data ?? []) as unknown as AdminUnit[];
  const commune = units.find((u) => u.id === cluster.commune_id) ?? null;
  const wilaya = units.find((u) => u.id === cluster.wilaya_id) ?? null;

  let dangerLevel: number | null = null;
  const publication = publishedRiskSnapshot(checkpointRes.data ?? null);
  if (publication && cluster.commune_id) {
    const { data: riskRow } = await client
      .rpc("current_risk_forecasts")
      .select("commune_id, danger_level, fuel_limited")
      .eq("source", "local_fwi")
      .eq("snapshot_id", publication.snapshotId)
      .eq("horizon_days", 0)
      .eq("forecast_date", publication.base)
      .eq("commune_id", cluster.commune_id)
      .maybeSingle();
    const r = riskRow as unknown as Pick<
      RiskForecast,
      "danger_level" | "fuel_limited"
    > | null;
    if (r && !r.fuel_limited && Number.isFinite(r.danger_level)) {
      dangerLevel = r.danger_level;
    }
  }

  const reports = (reportsRes.data ?? []) as unknown as {
    kind: string;
    lat: number;
    lon: number;
    observed_at: string;
    status: string;
  }[];
  const nearbySighting = hasSightingNear(cluster, reports);

  const officialIncidents = incidentsRes.error
    ? []
    : ((incidentsRes.data ?? []) as unknown as {
        wilaya_id: string;
        commune_id: string | null;
        authority_tier: string;
        first_reported_at: string;
      }[]);

  const effectiveConfirmedAt = effectiveFireConfirmedAt(
    cluster.confirmed_at,
    confirmedMentionTier,
  );

  let officialMention = false;
  if (officialIncidents.length > 0 && cluster.wilaya_id) {
    const reported = officialIncidents
      .map((incident) => Date.parse(incident.first_reported_at))
      .filter(Number.isFinite);
    if (reported.length > 0) {
      const SIBLING_LIMIT = 200;
      const { data: siblingRows, error: siblingError } = await client
        .from("fire_clusters")
        .select("id, wilaya_id, state, confirmed_at, last_detected_at")
        .eq("wilaya_id", cluster.wilaya_id)
        .neq("state", "false_positive")
        .gte(
          "last_detected_at",
          new Date(Math.min(...reported) - LINK_BEFORE_MS).toISOString(),
        )
        .lte(
          "last_detected_at",
          new Date(Math.max(...reported) + LINK_AFTER_MS).toISOString(),
        )
        .order("id", { ascending: true })
        .limit(SIBLING_LIMIT);

      if (!siblingError && (siblingRows?.length ?? 0) < SIBLING_LIMIT) {
        type LinkCandidate = {
          id: string;
          wilaya_id: string | null;
          state: string;
          confirmed_at: string | null;
          last_detected_at: string;
        };
        const candidateMap = new Map<string, LinkCandidate>();
        for (const row of (siblingRows ?? []) as unknown as LinkCandidate[]) {
          candidateMap.set(row.id, row);
        }
        candidateMap.set(cluster.id, {
          id: cluster.id,
          wilaya_id: cluster.wilaya_id,
          state: cluster.state,
          confirmed_at: effectiveConfirmedAt,
          last_detected_at: cluster.last_detected_at,
        });
        const linked = singleCandidateLinks(officialIncidents, [
          ...candidateMap.values(),
        ]);
        officialMention = linked.has(cluster.id);
      }
    }
  }

  const ctx: FireContext = {
    forestFraction: commune?.forest_fraction ?? null,
    dangerLevel,
    nearbySighting,
    officialMention,
  };

  const level = isEligibleProbableFire(cluster, ctx, confirmedMentionTier);
  if (!level) return null;

  const placeParts: string[] = [];
  if (commune) placeParts.push(unitName(commune, lang));
  if (wilaya) {
    const wName = unitName(wilaya, lang);
    if (!placeParts.includes(wName)) placeParts.push(wName);
  }
  const placeLabel = placeParts.length > 0 ? placeParts.join(" · ") : null;

  return fireCardModel(
    cluster,
    level,
    placeLabel,
    shareTranslator(lang),
    lang,
    confirmedSourceLabel,
  );
}

async function loadQuakeModel(
  id: string,
  lang: AnyLocale,
): Promise<UniversalShareCardModel | null> {
  if (!isSupabaseConfigured()) return null;
  const { publicSupabase } = await import("@/lib/public-api.server");
  const client = publicSupabase();

  const { data, error } = await client
    .from("earthquakes")
    .select(QUAKE_COLS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  const quake = {
    ...(data as unknown as Earthquake & { updated_at?: string | null }),
    magnitude: Number((data as { magnitude: unknown }).magnitude),
  };
  if (!isEligibleEarthquake(quake)) return null;

  let placeLabel: string | null = null;
  if (quake.commune_id) {
    const { data: communeData } = await client
      .from("admin_units")
      .select(ADMIN_NAME_COLS)
      .eq("id", quake.commune_id)
      .maybeSingle();
    if (communeData) {
      const commune = communeData as unknown as AdminUnit;
      const parts = [unitName(commune, lang)];
      if (commune.parent_id) {
        const { data: wilayaData } = await client
          .from("admin_units")
          .select(ADMIN_NAME_COLS)
          .eq("id", commune.parent_id)
          .maybeSingle();
        if (wilayaData) {
          parts.push(unitName(wilayaData as unknown as AdminUnit, lang));
        }
      }
      placeLabel = parts.join(" · ");
    }
  }

  return quakeCardModel(quake, placeLabel, shareTranslator(lang), lang);
}

async function loadIncidentModel(
  id: string,
  lang: AnyLocale,
): Promise<UniversalShareCardModel | null> {
  if (!isSupabaseConfigured()) return null;
  const { publicSupabase } = await import("@/lib/public-api.server");
  const incident = await fetchOfficialIncident(publicSupabase(), id);
  if (!incident || !isEligibleOfficialIncident(incident)) return null;
  return universalIncidentCardModel(incident, shareTranslator(lang), lang);
}

async function loadWilayaModel(
  id: string,
  lang: AnyLocale,
  nowMs: number,
): Promise<UniversalShareCardModel | null> {
  const entry = wilayaBySlug(id) ?? wilayaByCode(id);
  if (!entry) return null;
  const snapshot = await fetchWilayaSnapshot(entry, { nowMs });
  return wilayaCardModel(snapshot, shareTranslator(lang), lang);
}

export async function loadUniversalShareModel(
  kind: ShareKind,
  id: string,
  lang: AnyLocale,
  nowMs: number = Date.now(),
): Promise<UniversalShareCardModel | null> {
  switch (kind) {
    case "wilaya":
      return loadWilayaModel(id, lang, nowMs);
    case "onm":
      return loadOnmModel(id, lang, nowMs);
    case "fire":
      return loadFireModel(id, lang, nowMs);
    case "quake":
      return loadQuakeModel(id, lang);
    case "incident":
      return loadIncidentModel(id, lang);
  }
}

/* ---------- Universal HTTP Request Handler (GET & HEAD) ---------- */

export type UniversalShareRenderer = (
  model: UniversalShareCardModel,
  opts: {
    format: UniversalShareFormat;
    codec: ShareImageCodec;
    maxBytes: number;
  },
) => Promise<Uint8Array<ArrayBuffer> | null>;

export interface UniversalShareDeps {
  loadModel: (
    kind: ShareKind,
    id: string,
    lang: AnyLocale,
    nowMs: number,
  ) => Promise<UniversalShareCardModel | null>;
  render: UniversalShareRenderer;
  cache: CacheLike | null;
  limit: () => Promise<Response | null>;
  now?: () => number;
}

export async function safeEnforceRateLimit(
  request: Request,
): Promise<Response | null> {
  try {
    const { enforceRateLimit } = await import("@/lib/public-api.server");
    return await enforceRateLimit(request);
  } catch {
    return null;
  }
}

export function defaultShareCache(): CacheLike | null {
  if (typeof caches === "undefined") return null;
  const candidate = (caches as unknown as { default?: Cache }).default;
  return candidate ?? null;
}

export async function handleUniversalShareRequest(
  request: Request,
  parsed: ParsedUniversalShareRequest,
  deps?: Partial<UniversalShareDeps>,
): Promise<Response> {
  const isHead = request.method.toUpperCase() === "HEAD";
  const nowMs = deps?.now ? deps.now() : Date.now();
  const loadModel = deps?.loadModel ?? loadUniversalShareModel;
  const render = deps?.render ?? renderUniversalShareCard;
  const cache =
    deps && "cache" in deps ? (deps.cache ?? null) : defaultShareCache();
  const limit = deps?.limit ?? (() => safeEnforceRateLimit(request));

  let model: UniversalShareCardModel | null;
  try {
    model = await loadModel(parsed.kind, parsed.id, parsed.lang, nowMs);
  } catch (failure) {
    console.error(
      "universal share card model load failed",
      parsed.kind,
      parsed.id,
      failure,
    );
    return new Response(isHead ? null : "upstream unavailable", {
      status: 503,
      headers: {
        "retry-after": "30",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (!model) {
    return new Response(isHead ? null : "not found", {
      status: 404,
      headers: {
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const contentType = codecContentType(parsed.codec);
  const cacheControl =
    parsed.v === model.version ||
    (parsed.kind === "incident" &&
      parsed.v === `${CARD_REVISION}.${model.version.split(".")[1]}`)
      ? IMMUTABLE
      : "public, max-age=60";

  const origin = new URL(request.url).origin;
  const cacheKey = new Request(
    `${origin}/__share/v2/${parsed.kind}/${encodeURIComponent(model.id)}/${parsed.format}.${parsed.codec}/${parsed.lang}/${model.version}`,
  );

  const baseHeaders = (byteLength?: number): Record<string, string> => ({
    "content-type": contentType,
    "cache-control": cacheControl,
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
    ...(typeof byteLength === "number"
      ? { "content-length": String(byteLength) }
      : {}),
  });

  const cached = await cache?.match(cacheKey);
  if (cached) {
    const cachedLen = cached.headers.get("content-length");
    const headers = baseHeaders(cachedLen ? Number(cachedLen) : undefined);
    return new Response(isHead ? null : cached.body, { status: 200, headers });
  }

  const limited = await limit();
  if (limited) {
    limited.headers.set("access-control-allow-origin", "*");
    return isHead
      ? new Response(null, { status: limited.status, headers: limited.headers })
      : limited;
  }

  let image: Uint8Array<ArrayBuffer> | null;
  try {
    image = await render(model, {
      format: parsed.format,
      codec: parsed.codec,
      maxBytes: MAX_SHARE_CARD_BYTES,
    });
  } catch (failure) {
    console.error(
      "universal share card render failed",
      parsed.kind,
      parsed.id,
      parsed.format,
      failure,
    );
    return new Response(isHead ? null : "render failed", {
      status: 503,
      headers: {
        "retry-after": "30",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (!image) {
    return new Response(isHead ? null : "browser rendering unavailable here", {
      status: 501,
      headers: {
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const headers = baseHeaders(image.byteLength);
  await cache?.put(
    cacheKey,
    new Response(image, {
      headers: {
        "content-type": contentType,
        "content-length": String(image.byteLength),
        "cache-control": IMMUTABLE,
      },
    }),
  );

  return new Response(isHead ? null : image, { status: 200, headers });
}
