import { supabaseAdmin } from "@/integrations/supabase/client.server";
import i18n, { type AnyLocale } from "@/i18n";
import type { EmailDigestFrequency } from "@/lib/account";
import {
  formatLocalizedProvenanceDigest,
  parseProvenancePayload,
  provenanceForWatchZoneAlert,
  type AlertProvenanceData,
} from "@/lib/alert-provenance";
import { SEVERITY } from "@/lib/alerts-rules";
import { algiersToday } from "@/lib/ingest/algiers-date";

import {
  computeBackoffSeconds,
  formatAlgiersTimestamp,
  parseRetryAfterHeader,
  sanitizeCopyText,
} from "./whatsapp-channel.server";

function isAnyLocale(value: string): value is AnyLocale {
  return value === "ar" || value === "fr" || value === "en" || value === "kab";
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

const APP_ORIGIN = "https://nadhir.app";
const DEFAULT_RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM_EMAIL = "Nadhir <no-reply@nadhir.app>";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_LIMIT = 100;
const DEFAULT_ALERTS_PER_USER = 50;
const DEFAULT_MAX_PAGES = 20;

export interface ResendEmailInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  headers?: Record<string, string>;
}

export interface ResendSendResult {
  providerMessageId: string;
}

export interface ResendEmailTransport {
  sendEmail(input: ResendEmailInput): Promise<ResendSendResult>;
}

export class ResendHttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly errorName: string | null;
  readonly bounced: boolean;
  readonly responseBody: string;

  constructor(
    status: number,
    message: string,
    options?: {
      retryAfterSeconds?: number | null;
      errorName?: string | null;
      bounced?: boolean;
      responseBody?: string;
    },
  ) {
    super(message);
    this.name = "ResendHttpError";
    this.status = status;
    this.retryAfterSeconds = options?.retryAfterSeconds ?? null;
    this.errorName = options?.errorName ?? null;
    this.bounced = options?.bounced ?? false;
    this.responseBody = options?.responseBody ?? "";
  }
}

export interface ResendErrorClassification {
  transient: boolean;
  permanent: boolean;
  bounced: boolean;
  retryAfterSeconds: number | null;
  code: string;
  message: string;
}

export interface PendingEmailDigestUser {
  user_id: string;
  email: string;
  display_name: string | null;
  locale: string;
  email_digest_frequency: EmailDigestFrequency;
  email_digest_hour_algiers: number;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  last_sent_at: string | null;
}

export interface DigestAlertItem {
  id: string;
  kind: string;
  severity: number;
  title: string;
  body: string;
  created_at: string;
  zone_id?: string | null;
  zone_name?: string | null;
  distance_km?: number | null;
  source_table?: string | null;
  source_id?: string | null;
  payload?: Record<string, unknown> | null;
  deep_link?: string | null;
  /** Intentionally ignored: Nadhir never authors email instructions. */
  instruction?: string | null;
}

export interface ZoneDigestRenderInput {
  locale: AnyLocale;
  recipientName?: string | null;
  alerts: readonly DigestAlertItem[];
  urgentBypass: boolean;
  manageUrl?: string;
}

export interface RenderedZoneDigestEmail {
  subject: string;
  html: string;
  text: string;
  dir: "rtl" | "ltr";
  locale: AnyLocale;
  urgentBypass: boolean;
  provenanceLines: string[];
}

export interface ClaimedEmailDigestRow {
  id: string;
  lease_token: string;
  attempts: number;
}

export interface EmailDigestStore {
  isPipelineActive(): Promise<boolean>;
  isEmailConsentWithdrawn?(userId: string): Promise<boolean>;
  listPendingUsers(
    limit: number,
    afterUserId?: string | null,
  ): Promise<PendingEmailDigestUser[]>;
  loadUndeliveredAlerts(
    userId: string,
    limit: number,
  ): Promise<DigestAlertItem[]>;
  claimDigestDelivery(input: {
    userId: string;
    digestKind: Exclude<EmailDigestFrequency, "off">;
    windowKey: string;
    dedupeKey: string;
    locale: AnyLocale;
    alertIds: string[];
    urgentBypass: boolean;
    subject: string;
  }): Promise<ClaimedEmailDigestRow | null>;
  finishDigestDelivery(input: {
    id: string;
    leaseToken: string;
    sent: boolean;
    providerMessageId?: string | null;
    error?: string | null;
    permanent?: boolean;
    bounced?: boolean;
    retryAfterSeconds?: number | null;
  }): Promise<boolean>;
}

export interface DeliverEmailDigestsOptions {
  env?: Record<string, string | undefined>;
  transport?: ResendEmailTransport;
  store?: EmailDigestStore;
  fromEmail?: string;
  limit?: number;
  maxPages?: number;
  maxDeliveriesPerRun?: number;
  now?: Date;
}

export interface EmailDigestRunSummary {
  disabled: boolean;
  unconfigured: boolean;
  usersChecked: number;
  sent: number;
  deferredQuietHours: number;
  deferredSchedule: number;
  retried: number;
  failed: number;
  bounced: number;
  skipped: number;
  errors: string[];
}

function isEnvDisabled(raw: string | undefined): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "false" || normalized === "0" || normalized === "off";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Strictly validates that any href rendered into digest HTML stays on https://nadhir.app/...
 * Neutralizes javascript:, data:, foreign origins, and control characters.
 */
export function sanitizeNadhirUrl(
  rawUrl: string | null | undefined,
  fallbackPath = "/alerts",
): string {
  const fallback = `${APP_ORIGIN}${fallbackPath}`;
  if (!rawUrl || typeof rawUrl !== "string") return fallback;
  const trimmed = rawUrl.trim();
  if (!trimmed || hasControlChar(trimmed)) return fallback;
  try {
    const parsed = trimmed.startsWith("/")
      ? new URL(trimmed, APP_ORIGIN)
      : new URL(trimmed);
    if (
      parsed.origin !== APP_ORIGIN ||
      parsed.port !== "" ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

/**
 * Current hour (0..23) in Africa/Algiers using hourCycle "h23" + modulo 24 guard
 * so midnight is always 0 and never 24 on any ICU build.
 */
export function getAlgiersHour(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Algiers",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const raw = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return Number.isFinite(raw) ? ((Math.floor(raw) % 24) + 24) % 24 : 0;
}

export function isInAlgiersQuietHours(
  start: number | null,
  end: number | null,
  now: Date = new Date(),
): boolean {
  if (
    start === null ||
    end === null ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > 23 ||
    end < 0 ||
    end > 23 ||
    start === end
  ) {
    return false;
  }
  const hour = getAlgiersHour(now);
  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

function payloadString(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!payload || !Object.hasOwn(payload, key)) return null;
  const val = payload[key];
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : null;
}

function payloadNumber(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  if (!payload || !Object.hasOwn(payload, key)) return null;
  const val = payload[key];
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim().length > 0) {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function isUrgentDigestAlert(alert: DigestAlertItem): boolean {
  const kind = alert.kind.trim().toLowerCase();
  const payload = alert.payload ?? null;

  if (kind === "fire") {
    const phase = (payloadString(payload, "phase") ?? "").toLowerCase();
    return alert.severity >= SEVERITY.emergency || phase === "urgent";
  }

  if (kind === "weather" || kind === "onm") {
    const onmSeverity = (
      payloadString(payload, "onm_severity") ??
      payloadString(payload, "severity") ??
      ""
    ).toLowerCase();
    if (onmSeverity) {
      return onmSeverity === "extreme" || alert.severity >= SEVERITY.emergency;
    }
    return alert.severity >= 4;
  }

  if (kind === "official") {
    const status = (
      payloadString(payload, "status") ??
      payloadString(payload, "incident_status") ??
      ""
    ).toLowerCase();
    const phase = (
      payloadString(payload, "phase") ??
      payloadString(payload, "broadcast_phase") ??
      ""
    ).toLowerCase();
    if (status === "cleared" || status === "extinguished" || phase === "end") {
      return false;
    }
    const officialSeverity = (
      payloadString(payload, "severity") ?? ""
    ).toLowerCase();
    return officialSeverity === "extreme" || alert.severity >= 4;
  }

  if (kind === "earthquake") {
    if (payload && Object.hasOwn(payload, "magnitude")) {
      const mag = payloadNumber(payload, "magnitude");
      if (mag === null) return false;
      return mag >= 5.0;
    }
    return alert.severity >= SEVERITY.emergency;
  }

  return false;
}

export function shouldDeferForQuietHours(args: {
  alerts: readonly DigestAlertItem[];
  quietStart: number | null;
  quietEnd: number | null;
  now?: Date;
}): boolean {
  if (args.alerts.length === 0) return false;
  if (!isInAlgiersQuietHours(args.quietStart, args.quietEnd, args.now)) {
    return false;
  }
  return !args.alerts.some((alert) => isUrgentDigestAlert(alert));
}

function deterministicHexHash(input: string): string {
  // Dual 32-bit FNV-1a hash (pure JS, zero Node built-in imports, deterministic 16-hex-char digest)
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= ch ^ ((i & 0xff) + 1);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export function buildEmailDigestWindowKey(
  frequency: Exclude<EmailDigestFrequency, "off">,
  alertIds: readonly string[],
  now: Date = new Date(),
): string {
  if (frequency === "daily") {
    return `daily:${algiersToday(now)}`;
  }
  if (frequency === "hourly") {
    const hour = String(getAlgiersHour(now)).padStart(2, "0");
    return `hourly:${algiersToday(now)}T${hour}`;
  }
  const canonical = [...new Set(alertIds)].sort().join(",");
  return `immediate:${deterministicHexHash(canonical)}`;
}

export function buildEmailDigestDedupeKey(
  userId: string,
  digestKind: Exclude<EmailDigestFrequency, "off">,
  windowKey: string,
): string {
  return `email:${userId}:${digestKind}:${windowKey}`;
}

export function isDigestScheduleDue(args: {
  frequency: EmailDigestFrequency;
  digestHourAlgiers: number;
  lastSentAt: string | null;
  urgentBypass: boolean;
  now?: Date;
}): boolean {
  const { frequency, digestHourAlgiers, lastSentAt, urgentBypass } = args;
  const now = args.now ?? new Date();

  if (frequency === "off") return false;
  if (urgentBypass) return true;
  if (frequency === "immediate") return true;

  if (frequency === "hourly") {
    if (!lastSentAt) return true;
    const lastDate = new Date(lastSentAt);
    if (Number.isNaN(lastDate.getTime())) return true;
    const currentSlot = `${algiersToday(now)}T${String(getAlgiersHour(now)).padStart(2, "0")}`;
    const lastSlot = `${algiersToday(lastDate)}T${String(getAlgiersHour(lastDate)).padStart(2, "0")}`;
    return currentSlot !== lastSlot;
  }

  // frequency === "daily"
  const currentHour = getAlgiersHour(now);
  const targetHour = Math.min(23, Math.max(0, Math.floor(digestHourAlgiers)));
  if (currentHour < targetHour) return false;
  if (!lastSentAt) return true;
  const lastDate = new Date(lastSentAt);
  if (Number.isNaN(lastDate.getTime())) return true;
  return algiersToday(lastDate) !== algiersToday(now);
}

function resolveAlertProvenance(alert: DigestAlertItem): AlertProvenanceData {
  const payload = alert.payload ?? null;
  if (payload) {
    const parsed = parseProvenancePayload(payload);
    if (parsed) return parsed;
  }
  const kind = alert.kind.trim().toLowerCase();
  const sourceKey = payloadString(payload, "source_key");
  const sourceAttribution = payloadString(payload, "source_attribution");
  const hazard = payloadString(payload, "hazard");
  const phase = payloadString(payload, "phase");
  const magnitude = payloadNumber(payload, "magnitude");
  const radiusKm = payloadNumber(payload, "radius_km");
  const onmSeverity = payloadString(payload, "onm_severity");
  const confirmed =
    payload !== null &&
    Object.hasOwn(payload, "confirmed") &&
    payload["confirmed"] === true;

  return provenanceForWatchZoneAlert({
    kind,
    sourceTable: alert.source_table ?? null,
    severity:
      kind === "weather" || kind === "onm"
        ? (onmSeverity ?? alert.severity)
        : alert.severity,
    hazard,
    phase,
    confirmed,
    magnitude,
    sourceKey,
    sourceAttribution,
    areaLabel: alert.zone_name ?? payloadString(payload, "area_label") ?? null,
    radiusKm,
    observedAt: alert.created_at,
  });
}

function resolveAlertLink(alert: DigestAlertItem): string {
  if (alert.deep_link) {
    return sanitizeNadhirUrl(alert.deep_link, "/alerts");
  }
  const payload = alert.payload ?? null;
  const payloadUrl = payloadString(payload, "url");
  if (payloadUrl) {
    return sanitizeNadhirUrl(payloadUrl, "/alerts");
  }
  const shortId = payloadString(payload, "short_id");
  if (alert.kind.toLowerCase() === "fire" && shortId) {
    return sanitizeNadhirUrl(`/fire/${encodeURIComponent(shortId)}`, "/alerts");
  }
  const mapEvent = payloadString(payload, "map_event");
  if (mapEvent) {
    return sanitizeNadhirUrl(
      `/?event=${encodeURIComponent(mapEvent)}`,
      "/alerts",
    );
  }
  return `${APP_ORIGIN}/alerts`;
}

function preserveOrSanitizeSource(provenance: AlertProvenanceData): string {
  if (provenance.sourceKey.trim().toLowerCase() === "onm") {
    return provenance.sourceAttribution;
  }
  return sanitizeCopyText(provenance.sourceAttribution);
}

function sanitizeProvenanceForEmail(
  provenance: AlertProvenanceData,
  fallbackSource: string,
): AlertProvenanceData {
  const cleanedArea =
    provenance.areaLabel != null ? sanitizeCopyText(provenance.areaLabel) : "";
  const sourceAttribution =
    preserveOrSanitizeSource(provenance) || fallbackSource;
  return {
    ...provenance,
    areaLabel: cleanedArea.length > 0 ? cleanedArea : null,
    sourceAttribution,
  };
}

export function renderZoneDigestEmail(
  input: ZoneDigestRenderInput,
): RenderedZoneDigestEmail {
  const locale = input.locale;
  const dir: "rtl" | "ltr" = locale === "ar" ? "rtl" : "ltr";
  const textAlign = dir === "rtl" ? "right" : "left";
  const t = i18n.getFixedT(locale);
  const manageUrl = sanitizeNadhirUrl(
    input.manageUrl ?? `${APP_ORIGIN}/settings`,
    "/settings",
  );

  const firstAlert = input.alerts[0];
  const firstZone = sanitizeCopyText(
    firstAlert?.zone_name ?? t("common.notRecorded"),
  );
  const firstTitle = sanitizeCopyText(firstAlert?.title ?? "");

  const baseSubject =
    input.alerts.length === 1 && firstTitle
      ? t("emailDigest.subjectSingle", { title: firstTitle })
      : t("emailDigest.subjectDigest", {
          count: input.alerts.length,
          zone: firstZone,
        });
  const subject = sanitizeCopyText(
    input.urgentBypass
      ? `${t("emailDigest.subjectUrgentPrefix")}${baseSubject}`
      : baseSubject,
  );

  const heading = sanitizeCopyText(
    input.urgentBypass
      ? t("emailDigest.headingUrgent")
      : t("emailDigest.heading"),
  );
  const intro = sanitizeCopyText(t("emailDigest.intro"));
  const urgentNote = input.urgentBypass
    ? sanitizeCopyText(t("emailDigest.urgentBypassNote"))
    : null;
  const whyLabel = sanitizeCopyText(t("emailDigest.whySeeingLabel"));
  const viewDetailsLabel = sanitizeCopyText(t("emailDigest.viewDetails"));
  const disclaimer = sanitizeCopyText(t("emailDigest.infoDisclaimer"));
  const manageLabel = sanitizeCopyText(t("emailDigest.managePreferences"));

  const provenanceLines: string[] = [];
  const htmlItems: string[] = [];
  const textItems: string[] = [];

  for (const alert of input.alerts) {
    const rawProvenance = resolveAlertProvenance(alert);
    const provenance = sanitizeProvenanceForEmail(
      rawProvenance,
      t("common.notRecorded"),
    );
    const sourceAttr = provenance.sourceAttribution;
    const algiersStamp = formatAlgiersTimestamp(provenance.observedAt);
    const timeLabel = sanitizeCopyText(
      t("emailDigest.algiersTime", { time: algiersStamp }),
    );
    const provenanceLine = formatLocalizedProvenanceDigest(
      provenance,
      (key, vars) => (vars ? t(key, vars) : t(key)),
      timeLabel,
    );
    provenanceLines.push(provenanceLine);

    const safeTitle = sanitizeCopyText(alert.title);
    const safeBody = sanitizeCopyText(alert.body);
    const safeArea = alert.zone_name ? sanitizeCopyText(alert.zone_name) : null;
    const itemUrl = resolveAlertLink(alert);

    // Attribution first in every rendered item
    const sourceHeading = t("emailDigest.sourceLabel", { source: sourceAttr });

    htmlItems.push(
      [
        `<article style="border:1px solid #d4d4d8;border-radius:8px;padding:14px 16px;margin:0 0 12px 0;background:#ffffff;text-align:${textAlign};">`,
        `<p style="margin:0 0 6px 0;font-size:12px;font-weight:700;color:#18181b;">${escapeHtml(sourceHeading)}</p>`,
        `<h2 style="margin:0 0 6px 0;font-size:16px;line-height:1.35;color:#09090b;">${escapeHtml(safeTitle)}</h2>`,
        safeArea
          ? `<p style="margin:0 0 6px 0;font-size:13px;color:#3f3f46;">${escapeHtml(t("emailDigest.areaLabel", { area: safeArea }))}</p>`
          : "",
        safeBody
          ? `<p style="margin:0 0 8px 0;font-size:14px;line-height:1.5;color:#27272a;">${escapeHtml(safeBody)}</p>`
          : "",
        `<p style="margin:0 0 8px 0;font-size:12px;color:#52525b;">${escapeHtml(timeLabel)}</p>`,
        `<p style="margin:0 0 10px 0;"><a href="${escapeHtml(itemUrl)}" style="color:#b91c1c;font-weight:600;text-decoration:underline;">${escapeHtml(viewDetailsLabel)}</a></p>`,
        `<div style="border-top:1px solid #e4e4e7;padding-top:8px;font-size:12px;color:#52525b;">`,
        `<strong>${escapeHtml(whyLabel)}</strong> ${escapeHtml(provenanceLine)}`,
        `</div>`,
        `</article>`,
      ]
        .filter(Boolean)
        .join(""),
    );

    const textLines = [sourceHeading, safeTitle];
    if (safeArea) {
      textLines.push(t("emailDigest.areaLabel", { area: safeArea }));
    }
    if (safeBody) {
      textLines.push(safeBody);
    }
    textLines.push(timeLabel);
    textLines.push(`${viewDetailsLabel}: ${itemUrl}`);
    textLines.push(`${whyLabel} ${provenanceLine}`);
    textItems.push(textLines.join("\n"));
  }

  const html = [
    `<!doctype html>`,
    `<html lang="${escapeHtml(locale)}" dir="${dir}">`,
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>`,
    `<body dir="${dir}" style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#18181b;text-align:${textAlign};">`,
    `<div dir="${dir}" style="max-width:620px;margin:0 auto;padding:20px 16px;text-align:${textAlign};">`,
    `<header style="margin:0 0 16px 0;">`,
    `<h1 style="margin:0 0 6px 0;font-size:20px;line-height:1.3;color:#09090b;">${escapeHtml(heading)}</h1>`,
    `<p style="margin:0;font-size:14px;color:#3f3f46;">${escapeHtml(intro)}</p>`,
    urgentNote
      ? `<p style="margin:10px 0 0 0;padding:10px 12px;border-radius:6px;background:#fef2f2;border:1px solid #fecaca;font-size:13px;color:#991b1b;">${escapeHtml(urgentNote)}</p>`
      : "",
    `</header>`,
    `<main>${htmlItems.join("")}</main>`,
    `<footer style="margin-top:16px;padding-top:12px;border-top:1px solid #d4d4d8;font-size:12px;line-height:1.5;color:#52525b;">`,
    `<p style="margin:0 0 8px 0;">${escapeHtml(disclaimer)}</p>`,
    `<p style="margin:0;"><a href="${escapeHtml(manageUrl)}" style="color:#18181b;text-decoration:underline;">${escapeHtml(manageLabel)}</a></p>`,
    `</footer>`,
    `</div>`,
    `</body>`,
    `</html>`,
  ]
    .filter(Boolean)
    .join("");

  const textParts = [heading, intro];
  if (urgentNote) textParts.push(urgentNote);
  textParts.push("", textItems.join("\n\n---\n\n"), "", disclaimer);
  textParts.push(`${manageLabel}: ${manageUrl}`);

  return {
    subject,
    html,
    text: textParts.join("\n"),
    dir,
    locale,
    urgentBypass: input.urgentBypass,
    provenanceLines,
  };
}

function isBounceErrorMessage(
  errorName: string | null,
  message: string,
): boolean {
  const combined = `${errorName ?? ""} ${message}`.toLowerCase();
  return (
    combined.includes("bounce") ||
    combined.includes("suppressed") ||
    combined.includes("suppression") ||
    combined.includes("550 5.1.1") ||
    combined.includes("user unknown") ||
    combined.includes("invalid_recipient") ||
    combined.includes("mailbox unavailable")
  );
}

export function classifyResendError(error: unknown): ResendErrorClassification {
  if (error instanceof ResendHttpError) {
    if (error.bounced || isBounceErrorMessage(error.errorName, error.message)) {
      return {
        transient: false,
        permanent: true,
        bounced: true,
        retryAfterSeconds: null,
        code: "hard_bounce",
        message: error.message.slice(0, 500),
      };
    }
    if (error.status === 429) {
      return {
        transient: true,
        permanent: false,
        bounced: false,
        retryAfterSeconds: error.retryAfterSeconds,
        code: "http_429",
        message: error.message.slice(0, 500),
      };
    }
    if (error.status >= 500 && error.status <= 599) {
      return {
        transient: true,
        permanent: false,
        bounced: false,
        retryAfterSeconds: error.retryAfterSeconds,
        code: `http_${error.status}`,
        message: error.message.slice(0, 500),
      };
    }
    if (error.status >= 400 && error.status <= 499) {
      return {
        transient: false,
        permanent: true,
        bounced: false,
        retryAfterSeconds: null,
        code: `http_${error.status}`,
        message: error.message.slice(0, 500),
      };
    }
  }

  if (error instanceof Error) {
    const msg = error.message.slice(0, 500);
    if (isBounceErrorMessage(error.name, msg)) {
      return {
        transient: false,
        permanent: true,
        bounced: true,
        retryAfterSeconds: null,
        code: "hard_bounce",
        message: msg,
      };
    }
    const name = error.name.toLowerCase();
    return {
      transient: true,
      permanent: false,
      bounced: false,
      retryAfterSeconds: null,
      code:
        name === "timeouterror"
          ? "timeout"
          : name === "aborterror" || name === "typeerror"
            ? "network_error"
            : "delivery_error",
      message: msg,
    };
  }

  return {
    transient: true,
    permanent: false,
    bounced: false,
    retryAfterSeconds: null,
    code: "unknown_error",
    message: String(error).slice(0, 500),
  };
}

export function createResendEmailTransport(options: {
  apiKey: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ResendEmailTransport {
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoint = options.apiUrl ?? DEFAULT_RESEND_API_URL;

  return {
    async sendEmail(input: ResendEmailInput): Promise<ResendSendResult> {
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          from: input.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
          ...(input.headers ? { headers: input.headers } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const bodyText = await response.text().catch(() => "");
      let parsed: { id?: string; name?: string; message?: string } = {};
      try {
        parsed = JSON.parse(bodyText) as typeof parsed;
      } catch {
        parsed = {};
      }

      if (!response.ok) {
        const retryAfter = parseRetryAfterHeader(
          response.headers.get("retry-after"),
        );
        const errMessage =
          parsed.message ?? `Resend API HTTP ${response.status}`;
        throw new ResendHttpError(response.status, errMessage, {
          retryAfterSeconds: retryAfter,
          errorName: parsed.name ?? null,
          bounced: isBounceErrorMessage(parsed.name ?? null, errMessage),
          responseBody: bodyText,
        });
      }

      if (!parsed.id || typeof parsed.id !== "string") {
        throw new ResendHttpError(502, "Resend API response missing email id", {
          responseBody: bodyText,
        });
      }
      return { providerMessageId: parsed.id };
    },
  };
}

function normalizeFrequency(raw: string): EmailDigestFrequency {
  if (raw === "immediate" || raw === "hourly" || raw === "daily") return raw;
  return "off";
}

export function createSupabaseEmailDigestStore(): EmailDigestStore {
  return {
    async isPipelineActive(): Promise<boolean> {
      const { data, error } = await supabaseAdmin
        .from("delivery_pipeline_settings")
        .select("enabled, paused")
        .eq("pipeline", "email_digest")
        .maybeSingle();
      if (error || !data) return false;
      return data.enabled === true && data.paused === false;
    },

    async isEmailConsentWithdrawn(userId: string): Promise<boolean> {
      const { data, error } = await supabaseAdmin
        .from("privacy_consents")
        .select("status")
        .eq("user_id", userId)
        .eq("consent_type", "email_digest")
        .eq("status", "withdrawn")
        .maybeSingle();
      if (error) {
        throw new Error(`isEmailConsentWithdrawn: ${error.message}`);
      }
      return data?.status === "withdrawn";
    },

    async listPendingUsers(
      limit: number,
      afterUserId?: string | null,
    ): Promise<PendingEmailDigestUser[]> {
      const { data, error } = await supabaseAdmin.rpc(
        "list_pending_email_digest_users",
        { _limit: limit, _after_user_id: afterUserId ?? null },
      );
      if (error) {
        throw new Error(`list_pending_email_digest_users: ${error.message}`);
      }
      return (data ?? []).map((row) => ({
        user_id: row.user_id,
        email: row.email,
        display_name: row.display_name,
        locale: row.locale,
        email_digest_frequency: normalizeFrequency(row.email_digest_frequency),
        email_digest_hour_algiers: row.email_digest_hour_algiers,
        quiet_hours_start: row.quiet_hours_start,
        quiet_hours_end: row.quiet_hours_end,
        last_sent_at: row.last_sent_at,
      }));
    },

    async loadUndeliveredAlerts(
      userId: string,
      limit: number,
    ): Promise<DigestAlertItem[]> {
      const { data, error } = await supabaseAdmin
        .from("alerts")
        .select(
          "id, kind, severity, title, body, created_at, zone_id, distance_km, source_table, source_id, payload, zones(name)",
        )
        .eq("user_id", userId)
        .eq("delivered_email", false)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(limit);
      if (error) {
        throw new Error(`loadUndeliveredAlerts: ${error.message}`);
      }
      return (data ?? []).map((row) => {
        const zoneJoin = row.zones as { name?: string } | null;
        return {
          id: row.id,
          kind: row.kind,
          severity: row.severity,
          title: row.title,
          body: row.body,
          created_at: row.created_at,
          zone_id: row.zone_id,
          zone_name: zoneJoin?.name ?? null,
          distance_km: row.distance_km,
          source_table: row.source_table,
          source_id: row.source_id,
          payload:
            row.payload &&
            typeof row.payload === "object" &&
            !Array.isArray(row.payload)
              ? (row.payload as Record<string, unknown>)
              : null,
        };
      });
    },

    async claimDigestDelivery(input): Promise<ClaimedEmailDigestRow | null> {
      const { data, error } = await supabaseAdmin.rpc(
        "claim_email_digest_delivery",
        {
          _user_id: input.userId,
          _digest_kind: input.digestKind,
          _window_key: input.windowKey,
          _dedupe_key: input.dedupeKey,
          _locale: input.locale,
          _alert_ids: input.alertIds,
          _urgent_bypass: input.urgentBypass,
          _subject: input.subject,
        },
      );
      if (error) {
        throw new Error(`claim_email_digest_delivery: ${error.message}`);
      }
      const first = data?.[0];
      return first
        ? {
            id: first.id,
            lease_token: first.lease_token,
            attempts: first.attempts,
          }
        : null;
    },

    async finishDigestDelivery(input): Promise<boolean> {
      const { data, error } = await supabaseAdmin.rpc(
        "finish_email_digest_delivery",
        {
          _id: input.id,
          _lease_token: input.leaseToken,
          _sent: input.sent,
          _provider_message_id: input.providerMessageId ?? null,
          _error: input.error ?? null,
          _permanent: input.permanent ?? false,
          _bounced: input.bounced ?? false,
          _retry_after_seconds: input.retryAfterSeconds ?? null,
        },
      );
      if (error) {
        throw new Error(`finish_email_digest_delivery: ${error.message}`);
      }
      return data === true;
    },
  };
}

export async function deliverZoneEmailDigests(
  options: DeliverEmailDigestsOptions = {},
): Promise<EmailDigestRunSummary> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const limit = options.limit ?? DEFAULT_USER_LIMIT;
  const fromEmail =
    options.fromEmail ?? env["RESEND_FROM_EMAIL"] ?? DEFAULT_FROM_EMAIL;

  const summary: EmailDigestRunSummary = {
    disabled: false,
    unconfigured: false,
    usersChecked: 0,
    sent: 0,
    deferredQuietHours: 0,
    deferredSchedule: 0,
    retried: 0,
    failed: 0,
    bounced: 0,
    skipped: 0,
    errors: [],
  };

  if (isEnvDisabled(env["EMAIL_DIGEST_ENABLED"])) {
    summary.disabled = true;
    return summary;
  }

  let transport = options.transport;
  if (!transport) {
    const apiKey = (env["RESEND_API_KEY"] ?? "").trim();
    if (!apiKey) {
      summary.unconfigured = true;
      return summary;
    }
    const apiUrl = env["RESEND_API_URL"];
    transport = createResendEmailTransport({
      apiKey,
      ...(apiUrl ? { apiUrl } : {}),
    });
  }

  const store = options.store ?? createSupabaseEmailDigestStore();
  const active = await store.isPipelineActive();
  if (!active) {
    summary.disabled = true;
    return summary;
  }

  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
  const maxDeliveriesPerRun = Math.max(1, options.maxDeliveriesPerRun ?? limit);
  const seenUserIds = new Set<string>();
  let afterUserId: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    if (summary.sent + summary.failed >= maxDeliveriesPerRun) {
      break;
    }
    const users = await store.listPendingUsers(limit, afterUserId);
    if (users.length === 0) break;

    let progressed = false;
    for (const user of users) {
      if (summary.sent + summary.failed >= maxDeliveriesPerRun) {
        break;
      }
      if (seenUserIds.has(user.user_id)) {
        continue;
      }
      seenUserIds.add(user.user_id);
      progressed = true;

      summary.usersChecked += 1;
      const frequency = normalizeFrequency(user.email_digest_frequency);
      if (frequency === "off") {
        summary.skipped += 1;
        continue;
      }

      if (store.isEmailConsentWithdrawn) {
        let consentWithdrawn: boolean;
        try {
          consentWithdrawn = await store.isEmailConsentWithdrawn(user.user_id);
        } catch (error) {
          // Fail closed under Law 18-07 / Law 25-11: never dispatch email when consent status cannot be verified.
          const message =
            error instanceof Error ? error.message : String(error);
          summary.skipped += 1;
          summary.errors.push(
            `${user.user_id}: consent_check_failed: ${message.slice(0, 200)}`,
          );
          continue;
        }
        if (consentWithdrawn) {
          summary.skipped += 1;
          continue;
        }
      }

      const alerts = await store.loadUndeliveredAlerts(
        user.user_id,
        DEFAULT_ALERTS_PER_USER,
      );
      if (alerts.length === 0) {
        summary.skipped += 1;
        continue;
      }

      const hasUrgent = alerts.some((alert) => isUrgentDigestAlert(alert));
      const inQuiet = isInAlgiersQuietHours(
        user.quiet_hours_start,
        user.quiet_hours_end,
        now,
      );
      if (inQuiet && !hasUrgent) {
        // Defer cleanly without marking delivered_email = true
        summary.deferredQuietHours += 1;
        continue;
      }
      const urgentBypass = inQuiet && hasUrgent;

      const due = isDigestScheduleDue({
        frequency,
        digestHourAlgiers: user.email_digest_hour_algiers,
        lastSentAt: user.last_sent_at,
        urgentBypass: hasUrgent,
        now,
      });
      if (!due) {
        summary.deferredSchedule += 1;
        continue;
      }

      const locale: AnyLocale = isAnyLocale(user.locale) ? user.locale : "ar";
      const rendered = renderZoneDigestEmail({
        locale,
        recipientName: user.display_name,
        alerts,
        urgentBypass,
      });

      const alertIds = alerts.map((a) => a.id);
      const effectiveKind: Exclude<EmailDigestFrequency, "off"> =
        hasUrgent && frequency !== "immediate" ? "immediate" : frequency;
      const windowKey = buildEmailDigestWindowKey(effectiveKind, alertIds, now);
      const dedupeKey = buildEmailDigestDedupeKey(
        user.user_id,
        effectiveKind,
        windowKey,
      );

      const claimed = await store.claimDigestDelivery({
        userId: user.user_id,
        digestKind: effectiveKind,
        windowKey,
        dedupeKey,
        locale,
        alertIds,
        urgentBypass,
        subject: rendered.subject,
      });

      if (!claimed) {
        summary.skipped += 1;
        continue;
      }

      try {
        const sent = await transport.sendEmail({
          from: fromEmail,
          to: user.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: dedupeKey,
          headers: {
            "List-Unsubscribe": `<${APP_ORIGIN}/settings>`,
          },
        });
        await store.finishDigestDelivery({
          id: claimed.id,
          leaseToken: claimed.lease_token,
          sent: true,
          providerMessageId: sent.providerMessageId,
        });
        summary.sent += 1;
      } catch (error) {
        const classified = classifyResendError(error);
        const retryAfter = classified.transient
          ? computeBackoffSeconds(
              claimed.attempts,
              classified.retryAfterSeconds,
            )
          : null;
        await store.finishDigestDelivery({
          id: claimed.id,
          leaseToken: claimed.lease_token,
          sent: false,
          error: `${classified.code}: ${classified.message}`,
          permanent: classified.permanent,
          bounced: classified.bounced,
          retryAfterSeconds: retryAfter,
        });
        if (classified.bounced) {
          summary.bounced += 1;
        } else if (classified.permanent || claimed.attempts >= 5) {
          summary.failed += 1;
        } else {
          summary.retried += 1;
        }
        summary.errors.push(`${user.user_id}: ${classified.code}`);
      }
    }

    const lastUserId = users[users.length - 1]?.user_id ?? null;
    if (
      !progressed ||
      users.length < limit ||
      !lastUserId ||
      lastUserId === afterUserId
    ) {
      break;
    }
    afterUserId = lastUserId;
  }

  return summary;
}
