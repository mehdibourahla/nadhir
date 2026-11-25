import { supabaseAdmin } from "@/integrations/supabase/client.server";
import i18n, { type AnyLocale } from "@/i18n";
import {
  formatLocalizedProvenanceDigest,
  provenanceForBroadcast,
  type AlertProvenanceData,
} from "@/lib/alert-provenance";
import {
  NON_FIRE_BROADCAST_KINDS,
  onmWarningIsCurrent,
} from "@/lib/broadcast-rules";

function isAnyLocale(value: string): value is AnyLocale {
  return value === "ar" || value === "fr" || value === "en" || value === "kab";
}

const APP_ORIGIN = "https://nadhir.app";
const DEFAULT_META_GRAPH_BASE = "https://graph.facebook.com/v21.0";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BACKOFF_SECONDS = 900;
const BASE_BACKOFF_SECONDS = 30;
const DEFAULT_BATCH_LIMIT = 20;

const APPROVED_KINDS = new Set(["onm", "official", "earthquake", "fire"]);
const APPROVED_SEVERITIES = new Set(["Severe", "Extreme"]);
const APPROVED_OFFICIAL_HAZARDS = new Set<string>([
  "fire",
  ...NON_FIRE_BROADCAST_KINDS,
]);
const MODEL_SOURCE_KEYS = new Set([
  "open_meteo",
  "openmeteo",
  "openmeteo_weather",
  "openmeteo_wind",
  "local_fwi",
  "effis",
]);

const BANNED_STATUS_PATTERNS = [
  /\ball[\s-]?clear\b/gi,
  /\bsafe\s+(?:zone|area|status|now)\b/gi,
  /\bstatus\s*:\s*safe\b/gi,
  /\bsafe\b/gi,
  /\bsûre?\b/gi,
  /(?<![\p{L}\p{N}])آمنة?(?![\p{L}\p{N}])/gu,
  /\byeɣlel\b/gi,
];

export interface WhatsAppChannelMessageInput {
  channelId: string;
  text: string;
  linkPreview?: boolean;
  idempotencyKey: string;
  locale: AnyLocale;
}

export interface WhatsAppTransportResult {
  providerMessageId: string;
}

export interface WhatsAppChannelTransport {
  sendChannelMessage(
    input: WhatsAppChannelMessageInput,
  ): Promise<WhatsAppTransportResult>;
}

export class WhatsAppHttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly responseBody: string;

  constructor(
    status: number,
    message: string,
    retryAfterSeconds: number | null = null,
    responseBody = "",
  ) {
    super(message);
    this.name = "WhatsAppHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.responseBody = responseBody;
  }
}

export interface DeliveryErrorClassification {
  transient: boolean;
  permanent: boolean;
  retryAfterSeconds: number | null;
  code: string;
  message: string;
}

export interface WhatsAppBroadcastCandidate {
  id: string;
  kind: string;
  phase: "initial" | "update" | "end" | "cancel" | string;
  severity: string | null;
  hazard?: string | null;
  sourceKey?: string | null;
  sourceAttribution?: string | null;
  authorityTier?: string | null;
  authorityStatus?: "official" | "probable" | "observed" | "model" | null;
  corroborated?: boolean | null;
  isHeatSignal?: boolean | null;
  confirmed?: boolean | null;
  magnitude?: number | null;
  msgType?: "Alert" | "Update" | "Cancel" | string | null;
  cancelledAt?: string | null;
  supersededBy?: string | null;
  expiresAt?: string | null;
  onsetAt?: string | null;
  sentAt?: string | null;
  observedAt: string;
  incidentStatus?: string | null;
  unlistedAt?: string | null;
  headline: string;
  summary?: string | null;
  areaLabel?: string | null;
  communeCode?: string | null;
  clusterShortId?: string | null;
  officialIncidentId?: string | null;
  earthquakeId?: string | null;
  /** Intentionally ignored: Nadhir never authors WhatsApp instructions. */
  instruction?: string | null;
  provenance?: AlertProvenanceData | null;
}

export interface WhatsAppEligibilityResult {
  eligible: boolean;
  reason?: string;
}

export interface WhatsAppFormatInput {
  candidate: WhatsAppBroadcastCandidate;
  locale: AnyLocale;
}

export interface FormattedWhatsAppMessage {
  text: string;
  deepLink: string;
  provenance: AlertProvenanceData;
  provenanceFooter: string;
  algiersTimestamp: string;
}

export interface QueuedWhatsAppDelivery {
  id: string;
  broadcast_id: string;
  channel_target: string;
  locale: string;
  dedupe_key: string;
  state: string;
  attempts: number;
  expires_at: string;
  lease_token: string | null;
  last_error: string | null;
  payload: Record<string, unknown>;
}

export interface WhatsAppDeliveryStore {
  isGlobalBroadcastEnabled(): Promise<boolean>;
  isPipelineActive(): Promise<boolean>;
  loadPendingCandidates?(limit: number): Promise<WhatsAppBroadcastCandidate[]>;
  enqueueBroadcast(input: {
    broadcastId: string;
    channelTarget: string;
    locale: AnyLocale;
    dedupeKey: string;
    payload: Record<string, unknown>;
    expiresAt: string | null;
  }): Promise<string | null>;
  claimDeliveries(limit: number): Promise<QueuedWhatsAppDelivery[]>;
  isDeliveryInvalidated?(deliveryId: string): Promise<string | null>;
  finishDelivery(input: {
    id: string;
    leaseToken: string;
    delivered: boolean;
    providerMessageId?: string | null;
    error?: string | null;
    permanent?: boolean;
    retryAfterSeconds?: number | null;
  }): Promise<boolean>;
}

export interface DeliverWhatsAppOptions {
  env?: Record<string, string | undefined>;
  transport?: WhatsAppChannelTransport;
  store?: WhatsAppDeliveryStore;
  candidates?: WhatsAppBroadcastCandidate[];
  channelTarget?: string;
  locales?: AnyLocale[];
  limit?: number;
  now?: Date;
}

export interface WhatsAppDeliverySummary {
  disabled: boolean;
  unconfigured: boolean;
  enqueued: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  errors: string[];
}

function isEnvDisabled(raw: string | undefined): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "false" || normalized === "0" || normalized === "off";
}

/**
 * Formats an ISO timestamp in Africa/Algiers (UTC+1, no DST) using hourCycle "h23"
 * so midnight always renders "00:xx" and never "24:xx".
 */
export function formatAlgiersTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return sanitizeCopyText(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const rawHour = Number(get("hour"));
  const safeHour = Number.isFinite(rawHour)
    ? String(rawHour % 24).padStart(2, "0")
    : "00";
  return `${get("day")}/${get("month")}/${get("year")} ${safeHour}:${get("minute")}`;
}

export function sanitizeCopyText(raw: string): string {
  let cleaned = raw.replace(/\u2014/g, " · ");
  for (const pattern of BANNED_STATUS_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,:;!?])/g, "$1")
    .trim();
}

export function parseRetryAfterHeader(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(MAX_BACKOFF_SECONDS, Math.floor(parsed));
    }
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const deltaSeconds = Math.ceil((dateMs - Date.now()) / 1000);
    if (deltaSeconds > 0) {
      return Math.min(MAX_BACKOFF_SECONDS, deltaSeconds);
    }
  }
  return null;
}

export function computeBackoffSeconds(
  attempt: number,
  retryAfterSeconds?: number | null,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exp = BASE_BACKOFF_SECONDS * 2 ** Math.min(safeAttempt - 1, 6);
  const retryAfter =
    typeof retryAfterSeconds === "number" &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds > 0
      ? Math.floor(retryAfterSeconds)
      : 0;
  return Math.min(MAX_BACKOFF_SECONDS, Math.max(exp, retryAfter));
}

export function classifyDeliveryError(
  error: unknown,
): DeliveryErrorClassification {
  if (error instanceof WhatsAppHttpError) {
    if (error.status === 429) {
      return {
        transient: true,
        permanent: false,
        retryAfterSeconds: error.retryAfterSeconds,
        code: "http_429",
        message: error.message.slice(0, 500),
      };
    }
    if (error.status >= 500 && error.status <= 599) {
      return {
        transient: true,
        permanent: false,
        retryAfterSeconds: error.retryAfterSeconds,
        code: `http_${error.status}`,
        message: error.message.slice(0, 500),
      };
    }
    if (error.status >= 400 && error.status <= 499) {
      return {
        transient: false,
        permanent: true,
        retryAfterSeconds: null,
        code: `http_${error.status}`,
        message: error.message.slice(0, 500),
      };
    }
  }

  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const msg = error.message.slice(0, 500);
    if (
      name === "aborterror" ||
      name === "timeouterror" ||
      name === "typeerror" ||
      /timeout|network|fetch|econn|enotfound|socket/i.test(msg)
    ) {
      return {
        transient: true,
        permanent: false,
        retryAfterSeconds: null,
        code: name === "timeouterror" ? "timeout" : "network_error",
        message: msg,
      };
    }
    return {
      transient: true,
      permanent: false,
      retryAfterSeconds: null,
      code: "delivery_error",
      message: msg,
    };
  }

  return {
    transient: true,
    permanent: false,
    retryAfterSeconds: null,
    code: "unknown_error",
    message: String(error).slice(0, 500),
  };
}

export function createMetaWhatsAppChannelTransport(options: {
  accessToken: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): WhatsAppChannelTransport {
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = (options.apiUrl ?? DEFAULT_META_GRAPH_BASE).replace(
    /\/+$/,
    "",
  );

  return {
    async sendChannelMessage(
      input: WhatsAppChannelMessageInput,
    ): Promise<WhatsAppTransportResult> {
      const endpoint = `${baseUrl}/${encodeURIComponent(input.channelId)}/messages`;
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "newsletter",
          to: input.channelId,
          type: "text",
          text: {
            preview_url: input.linkPreview ?? true,
            body: input.text,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const bodyText = await response.text().catch(() => "");
      if (!response.ok) {
        const retryAfter = parseRetryAfterHeader(
          response.headers.get("retry-after"),
        );
        throw new WhatsAppHttpError(
          response.status,
          `WhatsApp API HTTP ${response.status}: ${bodyText.slice(0, 240)}`,
          retryAfter,
          bodyText,
        );
      }

      let parsed: { messages?: Array<{ id?: string }>; id?: string } = {};
      try {
        parsed = JSON.parse(bodyText) as typeof parsed;
      } catch {
        parsed = {};
      }
      const messageId = parsed.messages?.[0]?.id ?? parsed.id;
      if (!messageId || typeof messageId !== "string") {
        throw new WhatsAppHttpError(
          502,
          "WhatsApp API response missing message id",
          null,
          bodyText,
        );
      }
      return { providerMessageId: messageId };
    },
  };
}

function looksLikeItaAttribution(
  attribution: string | null | undefined,
): boolean {
  if (!attribution) return false;
  const normalized = attribution.normalize("NFKC").toLowerCase();
  return (
    normalized.includes("info trafic") ||
    /\bita\b/.test(normalized) ||
    normalized.includes("info-trafic")
  );
}

export function evaluateWhatsappBroadcastEligibility(
  input: WhatsAppBroadcastCandidate,
  now: Date = new Date(),
): WhatsAppEligibilityResult {
  const kind = input.kind.trim().toLowerCase();
  const sourceKey = (input.sourceKey ?? "").trim().toLowerCase();
  const authorityTier = (input.authorityTier ?? "").trim().toLowerCase();
  const authorityStatus = (input.authorityStatus ?? "").trim().toLowerCase();
  const severity = (input.severity ?? "").trim();
  const phase = (input.phase ?? "").trim().toLowerCase();

  // Hard exclusions (ADR-0002 & official-notification-policy.md)
  if (
    sourceKey.startsWith("ita") ||
    authorityTier === "media" ||
    looksLikeItaAttribution(input.sourceAttribution)
  ) {
    return { eligible: false, reason: "ita_media_excluded" };
  }

  if (authorityStatus === "model" || MODEL_SOURCE_KEYS.has(sourceKey)) {
    return { eligible: false, reason: "model_output_excluded" };
  }

  if (phase === "cancel") {
    return { eligible: false, reason: "cancel_phase_not_broadcast" };
  }

  if (!APPROVED_KINDS.has(kind)) {
    return { eligible: false, reason: "unapproved_broadcast_kind" };
  }

  if (!APPROVED_SEVERITIES.has(severity)) {
    return { eligible: false, reason: "below_severity_threshold" };
  }

  if (kind === "onm") {
    if (
      input.msgType === "Cancel" ||
      input.cancelledAt != null ||
      input.supersededBy != null
    ) {
      return { eligible: false, reason: "onm_cancelled_or_superseded" };
    }
    const sentMs = Date.parse(input.sentAt ?? input.observedAt);
    const onsetMs = input.onsetAt ? Date.parse(input.onsetAt) : null;
    const expiresMs = input.expiresAt ? Date.parse(input.expiresAt) : null;
    const valid = onmWarningIsCurrent(
      {
        id: input.id,
        event: input.hazard ?? "weather",
        severity,
        wilayaId: input.communeCode ?? "dz",
        sentMs,
        onsetMs: onsetMs !== null && Number.isFinite(onsetMs) ? onsetMs : null,
        expiresMs:
          expiresMs !== null && Number.isFinite(expiresMs) ? expiresMs : null,
        cancelledAtMs: null,
        supersededBy: null,
      },
      now.getTime(),
    );
    if (!valid) {
      return { eligible: false, reason: "onm_expired_or_invalid_window" };
    }
    return { eligible: true };
  }

  if (kind === "official") {
    if (sourceKey !== "dgpc_telegram") {
      return { eligible: false, reason: "unapproved_official_source" };
    }
    const hazard = (input.hazard ?? "fire").trim().toLowerCase();
    if (!APPROVED_OFFICIAL_HAZARDS.has(hazard)) {
      return { eligible: false, reason: "unapproved_official_hazard" };
    }
    const status = (input.incidentStatus ?? "").trim().toLowerCase();
    if (
      phase === "initial" &&
      (status === "cleared" ||
        status === "extinguished" ||
        input.unlistedAt != null)
    ) {
      return { eligible: false, reason: "official_incident_cleared" };
    }
    return { eligible: true };
  }

  if (kind === "earthquake") {
    const mag = input.magnitude;
    if (typeof mag !== "number" || !Number.isFinite(mag) || mag < 4.0) {
      return { eligible: false, reason: "earthquake_below_m4" };
    }
    return { eligible: true };
  }

  // kind === "fire"
  if (
    input.isHeatSignal === true ||
    input.corroborated === false ||
    (authorityStatus === "observed" && input.confirmed !== true)
  ) {
    return { eligible: false, reason: "raw_heat_signal_excluded" };
  }
  return { eligible: true };
}

export function buildCanonicalBroadcastLink(
  candidate: WhatsAppBroadcastCandidate,
): string {
  const kind = candidate.kind.trim().toLowerCase();
  if (kind === "fire" && candidate.clusterShortId) {
    return `${APP_ORIGIN}/fire/${encodeURIComponent(candidate.clusterShortId)}`;
  }
  if (kind === "onm") {
    if (candidate.communeCode) {
      return `${APP_ORIGIN}/forecast?commune=${encodeURIComponent(candidate.communeCode)}`;
    }
    return `${APP_ORIGIN}/forecast`;
  }
  if (kind === "official" && candidate.officialIncidentId) {
    return `${APP_ORIGIN}/?event=${encodeURIComponent(`official:${candidate.officialIncidentId}`)}`;
  }
  if (kind === "earthquake" && candidate.earthquakeId) {
    return `${APP_ORIGIN}/?event=${encodeURIComponent(`quake:${candidate.earthquakeId}`)}`;
  }
  return `${APP_ORIGIN}/`;
}

function defaultAttributionForCandidate(
  candidate: WhatsAppBroadcastCandidate,
): string {
  const raw = candidate.sourceAttribution;
  if (typeof raw === "string" && raw.trim().length > 0) {
    // Preserve ONM attribution verbatim (NFC & NFD untouched)
    if (candidate.kind.trim().toLowerCase() === "onm") {
      return raw.trim();
    }
    return sanitizeCopyText(raw);
  }
  const kind = candidate.kind.trim().toLowerCase();
  if (kind === "onm") return "ONM · Météo Algérie";
  if (kind === "official") return "DGPC";
  if (kind === "earthquake") {
    return (candidate.sourceKey ?? "").toLowerCase().includes("craag")
      ? "CRAAG"
      : "EMSC";
  }
  return candidate.confirmed ? "DGPC" : "NASA FIRMS";
}

export function formatWhatsappBroadcastMessage(
  input: WhatsAppFormatInput,
): FormattedWhatsAppMessage {
  const { candidate, locale } = input;
  const t = i18n.getFixedT(locale);
  const attribution = defaultAttributionForCandidate(candidate);
  const deepLink = buildCanonicalBroadcastLink(candidate);
  const algiersTimestamp = formatAlgiersTimestamp(candidate.observedAt);
  const timeLabel = t("whatsapp.algiersTime", { time: algiersTimestamp });

  const provenance =
    candidate.provenance ??
    provenanceForBroadcast({
      kind: candidate.kind,
      severity: candidate.severity,
      hazard: candidate.hazard,
      confirmed: Boolean(candidate.confirmed),
      magnitude: candidate.magnitude,
      sourceKey: candidate.sourceKey,
      sourceAttribution: attribution,
      areaLabel: candidate.areaLabel ?? null,
      observedAt: candidate.observedAt,
    });

  const provenanceFooter = formatLocalizedProvenanceDigest(
    provenance,
    (key, vars) => (vars ? t(key, vars) : t(key)),
    timeLabel,
  );

  const phaseKey =
    candidate.phase === "update"
      ? "whatsapp.phaseUpdate"
      : candidate.phase === "end"
        ? "whatsapp.phaseEnd"
        : "whatsapp.phaseInitial";
  const severityKey =
    candidate.severity === "Extreme"
      ? "whatsapp.severityExtreme"
      : "whatsapp.severitySevere";

  const safeHeadline = sanitizeCopyText(candidate.headline);
  const safeSummary = candidate.summary
    ? sanitizeCopyText(candidate.summary)
    : "";
  const safeArea = candidate.areaLabel
    ? sanitizeCopyText(candidate.areaLabel)
    : "";

  // Attribution-first layout; zero Nadhir-authored instructions, zero em dashes, zero "safe" labels
  const lines: string[] = [
    `${attribution} · ${t(phaseKey)} (${t(severityKey)})`,
    safeHeadline,
  ];
  if (safeSummary) {
    lines.push(safeSummary);
  }
  if (safeArea) {
    lines.push(t("whatsapp.areaLine", { area: safeArea }));
  }
  lines.push(timeLabel);
  lines.push(t("whatsapp.detailsLink", { url: deepLink }));
  lines.push(t("whatsapp.whySeeingPrefix", { line: provenanceFooter }));
  lines.push(t("whatsapp.infoDisclaimer"));

  return {
    text: lines.join("\n"),
    deepLink,
    provenance,
    provenanceFooter,
    algiersTimestamp,
  };
}

export function buildWhatsappDedupeKey(
  broadcastId: string,
  channelTarget: string,
  locale: AnyLocale,
): string {
  return `wa:${broadcastId}:${channelTarget}:${locale}`;
}

export function createSupabaseWhatsAppDeliveryStore(): WhatsAppDeliveryStore {
  return {
    async isGlobalBroadcastEnabled(): Promise<boolean> {
      const { data, error } = await supabaseAdmin
        .from("broadcast_settings")
        .select("enabled")
        .eq("id", true)
        .maybeSingle();
      if (error || !data) return false;
      return data.enabled === true;
    },

    async isPipelineActive(): Promise<boolean> {
      const { data, error } = await supabaseAdmin
        .from("delivery_pipeline_settings")
        .select("enabled, paused")
        .eq("pipeline", "whatsapp_channel")
        .maybeSingle();
      if (error || !data) return false;
      return data.enabled === true && data.paused === false;
    },

    async enqueueBroadcast(input): Promise<string | null> {
      const { data, error } = await supabaseAdmin.rpc(
        "enqueue_whatsapp_broadcast",
        {
          _broadcast_id: input.broadcastId,
          _channel_target: input.channelTarget,
          _locale: input.locale,
          _dedupe_key: input.dedupeKey,
          _payload: input.payload as never,
          _expires_at: input.expiresAt,
        },
      );
      if (error) {
        throw new Error(`enqueue_whatsapp_broadcast: ${error.message}`);
      }
      return data ?? null;
    },

    async claimDeliveries(limit: number): Promise<QueuedWhatsAppDelivery[]> {
      const { data, error } = await supabaseAdmin.rpc(
        "claim_whatsapp_deliveries",
        { _limit: limit },
      );
      if (error) {
        throw new Error(`claim_whatsapp_deliveries: ${error.message}`);
      }
      return (data ?? []).map((row) => ({
        id: row.id,
        broadcast_id: row.broadcast_id,
        channel_target: row.channel_target,
        locale: row.locale,
        dedupe_key: row.dedupe_key,
        state: row.state,
        attempts: row.attempts,
        expires_at: row.expires_at,
        lease_token: row.lease_token,
        last_error: row.last_error,
        payload:
          row.payload &&
          typeof row.payload === "object" &&
          !Array.isArray(row.payload)
            ? (row.payload as Record<string, unknown>)
            : {},
      }));
    },

    async isDeliveryInvalidated(deliveryId: string): Promise<string | null> {
      const { data, error } = await supabaseAdmin
        .from("whatsapp_channel_deliveries")
        .select("state, last_error, expires_at")
        .eq("id", deliveryId)
        .maybeSingle();
      if (error || !data) return null;
      if (
        data.state === "cancelled" ||
        data.last_error === "cap_cancelled" ||
        data.last_error === "official_cleared"
      ) {
        return data.last_error ?? "cap_cancelled";
      }
      return null;
    },

    async finishDelivery(input): Promise<boolean> {
      const { data, error } = await supabaseAdmin.rpc(
        "finish_whatsapp_delivery",
        {
          _id: input.id,
          _lease_token: input.leaseToken,
          _delivered: input.delivered,
          _provider_message_id: input.providerMessageId ?? null,
          _error: input.error ?? null,
          _permanent: input.permanent ?? false,
          _retry_after_seconds: input.retryAfterSeconds ?? null,
        },
      );
      if (error) {
        throw new Error(`finish_whatsapp_delivery: ${error.message}`);
      }
      return data === true;
    },
  };
}

export async function deliverWhatsappChannelBroadcasts(
  options: DeliverWhatsAppOptions = {},
): Promise<WhatsAppDeliverySummary> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const limit = options.limit ?? DEFAULT_BATCH_LIMIT;
  const locales: AnyLocale[] =
    options.locales && options.locales.length > 0 ? options.locales : ["ar"];

  const summary: WhatsAppDeliverySummary = {
    disabled: false,
    unconfigured: false,
    enqueued: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  if (isEnvDisabled(env["WHATSAPP_CHANNEL_ENABLED"])) {
    summary.disabled = true;
    return summary;
  }

  const channelTarget = (
    options.channelTarget ??
    env["WHATSAPP_CHANNEL_ID"] ??
    ""
  ).trim();
  const accessToken = (env["WHATSAPP_ACCESS_TOKEN"] ?? "").trim();

  let transport = options.transport;
  if (!transport) {
    if (!accessToken || !channelTarget) {
      summary.unconfigured = true;
      return summary;
    }
    const apiUrl = env["WHATSAPP_API_URL"];
    transport = createMetaWhatsAppChannelTransport({
      accessToken,
      ...(apiUrl ? { apiUrl } : {}),
    });
  } else if (!channelTarget) {
    summary.unconfigured = true;
    return summary;
  }

  const store = options.store ?? createSupabaseWhatsAppDeliveryStore();

  const [globalEnabled, pipelineActive] = await Promise.all([
    store.isGlobalBroadcastEnabled(),
    store.isPipelineActive(),
  ]);
  if (!globalEnabled || !pipelineActive) {
    summary.disabled = true;
    return summary;
  }

  // 1. Enqueue eligible candidates idempotently
  const candidates =
    options.candidates ??
    (store.loadPendingCandidates
      ? await store.loadPendingCandidates(limit)
      : []);

  for (const candidate of candidates) {
    const eligibility = evaluateWhatsappBroadcastEligibility(candidate, now);
    if (!eligibility.eligible) {
      summary.skipped += 1;
      continue;
    }

    for (const locale of locales) {
      const formatted = formatWhatsappBroadcastMessage({ candidate, locale });
      const dedupeKey = buildWhatsappDedupeKey(
        candidate.id,
        channelTarget,
        locale,
      );
      const enqueuedId = await store.enqueueBroadcast({
        broadcastId: candidate.id,
        channelTarget,
        locale,
        dedupeKey,
        payload: {
          text: formatted.text,
          deepLink: formatted.deepLink,
          provenance: formatted.provenance,
          provenanceFooter: formatted.provenanceFooter,
          algiersTimestamp: formatted.algiersTimestamp,
        },
        expiresAt: candidate.expiresAt ?? null,
      });
      if (enqueuedId) {
        summary.enqueued += 1;
      } else {
        summary.skipped += 1;
      }
    }
  }

  // 2. Claim and deliver leased queue rows
  const claimed = await store.claimDeliveries(limit);
  for (const row of claimed) {
    if (!row.lease_token) {
      summary.skipped += 1;
      continue;
    }

    const locale: AnyLocale = isAnyLocale(row.locale) ? row.locale : "ar";
    const invalidatedReason =
      row.last_error === "cap_cancelled" ||
      row.last_error === "official_cleared"
        ? row.last_error
        : store.isDeliveryInvalidated
          ? await store.isDeliveryInvalidated(row.id)
          : null;

    if (invalidatedReason) {
      await store.finishDelivery({
        id: row.id,
        leaseToken: row.lease_token,
        delivered: false,
        error: invalidatedReason,
        permanent: false,
      });
      summary.skipped += 1;
      continue;
    }

    const text =
      typeof row.payload["text"] === "string" ? row.payload["text"].trim() : "";
    if (!text) {
      await store.finishDelivery({
        id: row.id,
        leaseToken: row.lease_token,
        delivered: false,
        error: "empty_whatsapp_payload",
        permanent: true,
      });
      summary.failed += 1;
      summary.errors.push(`empty payload for ${row.id}`);
      continue;
    }

    try {
      const result = await transport.sendChannelMessage({
        channelId: row.channel_target,
        text,
        linkPreview: true,
        idempotencyKey: row.dedupe_key,
        locale,
      });
      await store.finishDelivery({
        id: row.id,
        leaseToken: row.lease_token,
        delivered: true,
        providerMessageId: result.providerMessageId,
      });
      summary.sent += 1;
    } catch (error) {
      const classified = classifyDeliveryError(error);
      const retryAfter = classified.transient
        ? computeBackoffSeconds(row.attempts, classified.retryAfterSeconds)
        : null;
      await store.finishDelivery({
        id: row.id,
        leaseToken: row.lease_token,
        delivered: false,
        error: `${classified.code}: ${classified.message}`,
        permanent: classified.permanent,
        retryAfterSeconds: retryAfter,
      });
      if (classified.permanent || row.attempts >= 8) {
        summary.failed += 1;
      } else {
        summary.retried += 1;
      }
      summary.errors.push(`${row.id}: ${classified.code}`);
    }
  }

  return summary;
}
