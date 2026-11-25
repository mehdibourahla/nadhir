import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readJsonBody } from "@/lib/request-body.server";

export const PRIVACY_POLICY_VERSION = "2026-11-25";

export const CONSENT_TYPES = [
  "privacy_policy",
  "citizen_reports",
  "zone_alerts",
  "email_digest",
  "push_alerts",
  "on_device_commune",
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];
export type ConsentStatus = "granted" | "withdrawn";
export type ConsentLocale = "ar" | "fr" | "en" | "kab";
export type ConsentSourceSurface =
  "web" | "android" | "ios" | "api" | "settings" | "privacy" | "signup";

const CONSENT_TYPE_SET = new Set<string>(CONSENT_TYPES);
const CONSENT_STATUS_SET = new Set<string>(["granted", "withdrawn"]);
const CONSENT_LOCALE_SET = new Set<string>(["ar", "fr", "en", "kab"]);
const CONSENT_SURFACE_SET = new Set<string>([
  "web",
  "android",
  "ios",
  "api",
  "settings",
  "privacy",
  "signup",
]);
const POLICY_VERSION_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z0-9-]+)?$/;
const ALLOWED_POST_KEYS = new Set([
  "consent_type",
  "status",
  "policy_version",
  "locale",
  "source_surface",
]);

export interface AuthenticatedPrivacyUser {
  id: string;
  email?: string | null;
  created_at?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
}

export interface PrivacyConsentRow {
  id: string;
  user_id: string;
  consent_type: ConsentType;
  policy_version: string;
  status: ConsentStatus;
  granted_at: string | null;
  withdrawn_at: string | null;
  locale: ConsentLocale;
  source_surface: ConsentSourceSurface;
  created_at: string;
  updated_at: string;
}

export interface ConsentMutationInput {
  consent_type: ConsentType;
  policy_version?: string;
  locale?: ConsentLocale;
  source_surface?: ConsentSourceSurface;
}

export interface PersonalDataExport {
  schema_version: "1.0";
  exported_at: string;
  legal_basis: string;
  authority: string;
  policy_version: string;
  account: {
    id: string;
    email: string | null;
    created_at: string | null;
    email_confirmed_at: string | null;
    last_sign_in_at: string | null;
  };
  profile: Record<string, unknown> | null;
  privacy_consents: Array<{
    consent_type: string;
    policy_version: string;
    status: string;
    granted_at: string | null;
    withdrawn_at: string | null;
    locale: string;
    source_surface: string;
    created_at: string;
    updated_at: string;
  }>;
  watch_zones: Array<Record<string, unknown>>;
  citizen_reports: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  push_devices: {
    registered_device_count: number;
    devices: Array<{
      device_hash_prefix: string;
      updated_at: string;
    }>;
  };
  push_test_receipts: Array<{
    id: string;
    sent_at: string;
    received_at: string | null;
  }>;
  email_digest_deliveries: Array<Record<string, unknown>>;
  email_digest_suppression: {
    reason: string;
    suppressed_at: string;
  } | null;
  webhook_endpoints: Array<{
    id: string;
    label: string;
    url: string;
    kinds: string[];
    min_severity: number;
    active: boolean;
    last_attempt_at: string | null;
    last_status: number | null;
    created_at: string;
    updated_at: string;
    secret_redacted: true;
  }>;
  webhook_deliveries: Array<{
    id: string;
    endpoint_id: string;
    alert_id: string | null;
    ok: boolean;
    status_code: number | null;
    created_at: string;
  }>;
  report_witnesses: Array<{
    report_id: string;
    vote: string;
    created_at: string;
  }>;
  report_flags: Array<{
    report_id: string;
    reason: string;
    created_at: string;
  }>;
  blocked_authors_count: number;
  roles: Array<{
    role: string;
    created_at: string;
  }>;
  data_minimization_notes: string[];
}

export interface PrivacyExportRawData {
  profile: Record<string, unknown> | null;
  privacy_consents: Array<Record<string, unknown>>;
  watch_zones: Array<Record<string, unknown>>;
  citizen_reports: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  push_devices: Array<Record<string, unknown>>;
  push_test_receipts: Array<Record<string, unknown>>;
  email_digest_deliveries: Array<Record<string, unknown>>;
  email_digest_suppression: Record<string, unknown> | null;
  webhook_endpoints: Array<Record<string, unknown>>;
  webhook_deliveries: Array<Record<string, unknown>>;
  report_witnesses: Array<Record<string, unknown>>;
  report_flags: Array<Record<string, unknown>>;
  blocked_authors_count: number;
  roles: Array<Record<string, unknown>>;
}

export interface PrivacyDeps {
  getUser: (token: string) => Promise<{
    data: { user: AuthenticatedPrivacyUser | null };
    error: unknown;
  }>;
  consumeRateLimit: (
    bucket: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<{ data: boolean | null; error: unknown }>;
  listConsents: (userId: string) => Promise<PrivacyConsentRow[]>;
  upsertConsent: (row: {
    user_id: string;
    consent_type: ConsentType;
    policy_version: string;
    status: ConsentStatus;
    granted_at: string | null;
    withdrawn_at: string | null;
    locale: ConsentLocale;
    source_surface: ConsentSourceSurface;
  }) => Promise<PrivacyConsentRow>;
  fetchExportData: (userId: string) => Promise<PrivacyExportRawData>;
  now: () => Date;
}

const json = (
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...extraHeaders,
    },
  });

async function defaultListConsents(
  userId: string,
): Promise<PrivacyConsentRow[]> {
  const { data, error } = await supabaseAdmin
    .from("privacy_consents")
    .select(
      "id, user_id, consent_type, policy_version, status, granted_at, withdrawn_at, locale, source_surface, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("consent_read_failed");
  return (data ?? []) as PrivacyConsentRow[];
}

async function defaultUpsertConsent(row: {
  user_id: string;
  consent_type: ConsentType;
  policy_version: string;
  status: ConsentStatus;
  granted_at: string | null;
  withdrawn_at: string | null;
  locale: ConsentLocale;
  source_surface: ConsentSourceSurface;
}): Promise<PrivacyConsentRow> {
  const { data, error } = await supabaseAdmin
    .from("privacy_consents")
    .upsert(row, { onConflict: "user_id,consent_type" })
    .select(
      "id, user_id, consent_type, policy_version, status, granted_at, withdrawn_at, locale, source_surface, created_at, updated_at",
    )
    .single();
  if (error || !data) throw new Error("consent_write_failed");
  return data as PrivacyConsentRow;
}

async function defaultFetchExportData(
  userId: string,
): Promise<PrivacyExportRawData> {
  const [
    profileRes,
    consentsRes,
    zonesRes,
    reportsRes,
    alertsRes,
    pushDevicesRes,
    pushTestsRes,
    digestDeliveriesRes,
    digestSuppressionRes,
    webhooksRes,
    webhookDeliveriesRes,
    witnessesRes,
    flagsRes,
    blocksRes,
    rolesRes,
  ] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select(
        "id, display_name, locale, phone, alert_email, alert_push, email_digest_frequency, email_digest_hour_algiers, min_confidence, min_danger_level, quiet_hours_start, quiet_hours_end, created_at, updated_at",
      )
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("privacy_consents")
      .select(
        "consent_type, policy_version, status, granted_at, withdrawn_at, locale, source_surface, created_at, updated_at",
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    supabaseAdmin
      .from("zones")
      .select(
        "id, name, lat, lon, radius_km, commune_id, min_danger_level, notify_fires, notify_risk, notify_weather, notify_official, notify_road, notify_citizen, notify_earthquake, active, created_at, updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("citizen_reports")
      .select(
        "id, kind, hazard, sighting, size_hint, lat, lon, commune_id, note, summary, photo_url, status, publish_state, observed_at, expires_at, created_at, updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("alerts")
      .select(
        "id, kind, severity, title, body, commune_id, zone_id, distance_km, delivered_email, delivered_webhook, push_state, read_at, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("user_push_devices")
      .select("device_hash, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    supabaseAdmin
      .from("push_test_receipts")
      .select("id, sent_at, received_at")
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("email_digest_deliveries")
      .select(
        "id, digest_kind, window_key, locale, alert_count, urgent_bypass, state, subject, sent_at, bounced_at, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("email_digest_suppressions")
      .select("reason, suppressed_at")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("webhook_endpoints")
      .select(
        "id, label, url, kinds, min_severity, active, last_attempt_at, last_status, created_at, updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("webhook_deliveries")
      .select("id, endpoint_id, alert_id, ok, status_code, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("report_witnesses")
      .select("report_id, vote, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("citizen_report_flags")
      .select("report_id, reason, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("user_report_blocks")
      .select("blocker", { count: "exact", head: true })
      .eq("blocker", userId),
    supabaseAdmin
      .from("user_roles")
      .select("role, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const failures = [
    profileRes.error,
    consentsRes.error,
    zonesRes.error,
    reportsRes.error,
    alertsRes.error,
    pushDevicesRes.error,
    pushTestsRes.error,
    digestDeliveriesRes.error,
    digestSuppressionRes.error,
    webhooksRes.error,
    webhookDeliveriesRes.error,
    witnessesRes.error,
    flagsRes.error,
    blocksRes.error,
    rolesRes.error,
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error("export_read_failed");
  }

  return {
    profile: (profileRes.data as Record<string, unknown> | null) ?? null,
    privacy_consents: (consentsRes.data ?? []) as Array<
      Record<string, unknown>
    >,
    watch_zones: (zonesRes.data ?? []) as Array<Record<string, unknown>>,
    citizen_reports: (reportsRes.data ?? []) as Array<Record<string, unknown>>,
    alerts: (alertsRes.data ?? []) as Array<Record<string, unknown>>,
    push_devices: (pushDevicesRes.data ?? []) as Array<Record<string, unknown>>,
    push_test_receipts: (pushTestsRes.data ?? []) as Array<
      Record<string, unknown>
    >,
    email_digest_deliveries: (digestDeliveriesRes.data ?? []) as Array<
      Record<string, unknown>
    >,
    email_digest_suppression:
      (digestSuppressionRes.data as Record<string, unknown> | null) ?? null,
    webhook_endpoints: (webhooksRes.data ?? []) as Array<
      Record<string, unknown>
    >,
    webhook_deliveries: (webhookDeliveriesRes.data ?? []) as Array<
      Record<string, unknown>
    >,
    report_witnesses: (witnessesRes.data ?? []) as Array<
      Record<string, unknown>
    >,
    report_flags: (flagsRes.data ?? []) as Array<Record<string, unknown>>,
    blocked_authors_count: blocksRes.count ?? 0,
    roles: (rolesRes.data ?? []) as Array<Record<string, unknown>>,
  };
}

const defaultDeps: PrivacyDeps = {
  getUser: async (token) => {
    const res = await supabaseAdmin.auth.getUser(token);
    return {
      data: {
        user: res.data.user
          ? {
              id: res.data.user.id,
              email: res.data.user.email ?? null,
              created_at: res.data.user.created_at ?? null,
              email_confirmed_at: res.data.user.email_confirmed_at ?? null,
              last_sign_in_at: res.data.user.last_sign_in_at ?? null,
            }
          : null,
      },
      error: res.error,
    };
  },
  consumeRateLimit: async (bucket, limit, windowSeconds) => {
    const res = await supabaseAdmin.rpc("consume_rate_limit", {
      _bucket: bucket,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    return { data: res.data, error: res.error };
  },
  listConsents: defaultListConsents,
  upsertConsent: defaultUpsertConsent,
  fetchExportData: defaultFetchExportData,
  now: () => new Date(),
};

function pickKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in record) {
      out[key] = record[key];
    }
  }
  return out;
}

export async function listUserConsents(
  userId: string,
  overrides: Partial<PrivacyDeps> = {},
): Promise<PrivacyConsentRow[]> {
  const deps: PrivacyDeps = { ...defaultDeps, ...overrides };
  return deps.listConsents(userId);
}

export async function recordUserConsent(
  userId: string,
  input: ConsentMutationInput,
  overrides: Partial<PrivacyDeps> = {},
): Promise<PrivacyConsentRow> {
  const deps: PrivacyDeps = { ...defaultDeps, ...overrides };
  const nowIso = deps.now().toISOString();
  return deps.upsertConsent({
    user_id: userId,
    consent_type: input.consent_type,
    policy_version: input.policy_version ?? PRIVACY_POLICY_VERSION,
    status: "granted",
    granted_at: nowIso,
    withdrawn_at: null,
    locale: input.locale ?? "ar",
    source_surface: input.source_surface ?? "web",
  });
}

export async function withdrawUserConsent(
  userId: string,
  input: ConsentMutationInput,
  overrides: Partial<PrivacyDeps> = {},
): Promise<PrivacyConsentRow> {
  const deps: PrivacyDeps = { ...defaultDeps, ...overrides };
  const nowIso = deps.now().toISOString();
  const existing = await deps.listConsents(userId);
  const prior = existing.find((row) => row.consent_type === input.consent_type);
  return deps.upsertConsent({
    user_id: userId,
    consent_type: input.consent_type,
    policy_version: input.policy_version ?? PRIVACY_POLICY_VERSION,
    status: "withdrawn",
    granted_at: prior?.granted_at ?? null,
    withdrawn_at: nowIso,
    locale: input.locale ?? "ar",
    source_surface: input.source_surface ?? "web",
  });
}

export async function buildPersonalDataExport(
  user: AuthenticatedPrivacyUser,
  overrides: Partial<PrivacyDeps> = {},
): Promise<PersonalDataExport> {
  const deps: PrivacyDeps = { ...defaultDeps, ...overrides };
  const raw = await deps.fetchExportData(user.id);
  const exportedAt = deps.now().toISOString();

  const sanitizedDevices = raw.push_devices.map((device) => {
    const hash =
      typeof device["device_hash"] === "string" ? device["device_hash"] : "";
    return {
      device_hash_prefix: hash.slice(0, 8),
      updated_at: String(device["updated_at"] ?? ""),
    };
  });

  const sanitizedWebhooks = raw.webhook_endpoints.map((endpoint) => ({
    id: String(endpoint["id"] ?? ""),
    label: String(endpoint["label"] ?? ""),
    url: String(endpoint["url"] ?? ""),
    kinds: Array.isArray(endpoint["kinds"])
      ? endpoint["kinds"].map((k) => String(k))
      : [],
    min_severity: Number(endpoint["min_severity"] ?? 0),
    active: Boolean(endpoint["active"]),
    last_attempt_at:
      typeof endpoint["last_attempt_at"] === "string"
        ? endpoint["last_attempt_at"]
        : null,
    last_status:
      typeof endpoint["last_status"] === "number"
        ? endpoint["last_status"]
        : null,
    created_at: String(endpoint["created_at"] ?? ""),
    updated_at: String(endpoint["updated_at"] ?? ""),
    secret_redacted: true as const,
  }));

  return {
    schema_version: "1.0",
    exported_at: exportedAt,
    legal_basis:
      "Algerian Law No. 18-07 (10 June 2018) amended by Law No. 25-11 (24 July 2025): Right of Access and Data Portability",
    authority:
      "ANPDP (Autorite Nationale de Protection des Donnees a Caractere Personnel)",
    policy_version: PRIVACY_POLICY_VERSION,
    account: {
      id: user.id,
      email: user.email ?? null,
      created_at: user.created_at ?? null,
      email_confirmed_at: user.email_confirmed_at ?? null,
      last_sign_in_at: user.last_sign_in_at ?? null,
    },
    profile: raw.profile
      ? pickKeys(raw.profile, [
          "id",
          "display_name",
          "locale",
          "phone",
          "alert_email",
          "alert_push",
          "email_digest_frequency",
          "email_digest_hour_algiers",
          "min_confidence",
          "min_danger_level",
          "quiet_hours_start",
          "quiet_hours_end",
          "created_at",
          "updated_at",
        ])
      : null,
    privacy_consents: raw.privacy_consents.map((row) => ({
      consent_type: String(row["consent_type"] ?? ""),
      policy_version: String(row["policy_version"] ?? ""),
      status: String(row["status"] ?? ""),
      granted_at:
        typeof row["granted_at"] === "string" ? row["granted_at"] : null,
      withdrawn_at:
        typeof row["withdrawn_at"] === "string" ? row["withdrawn_at"] : null,
      locale: String(row["locale"] ?? "ar"),
      source_surface: String(row["source_surface"] ?? "web"),
      created_at: String(row["created_at"] ?? ""),
      updated_at: String(row["updated_at"] ?? ""),
    })),
    watch_zones: raw.watch_zones.map((zone) =>
      pickKeys(zone, [
        "id",
        "name",
        "lat",
        "lon",
        "radius_km",
        "commune_id",
        "min_danger_level",
        "notify_fires",
        "notify_risk",
        "notify_weather",
        "notify_official",
        "notify_road",
        "notify_citizen",
        "notify_earthquake",
        "active",
        "created_at",
        "updated_at",
      ]),
    ),
    citizen_reports: raw.citizen_reports.map((report) =>
      pickKeys(report, [
        "id",
        "kind",
        "hazard",
        "sighting",
        "size_hint",
        "lat",
        "lon",
        "commune_id",
        "note",
        "summary",
        "photo_url",
        "status",
        "publish_state",
        "observed_at",
        "expires_at",
        "created_at",
        "updated_at",
      ]),
    ),
    alerts: raw.alerts.map((alert) =>
      pickKeys(alert, [
        "id",
        "kind",
        "severity",
        "title",
        "body",
        "commune_id",
        "zone_id",
        "distance_km",
        "delivered_email",
        "delivered_webhook",
        "push_state",
        "read_at",
        "created_at",
      ]),
    ),
    push_devices: {
      registered_device_count: sanitizedDevices.length,
      devices: sanitizedDevices,
    },
    push_test_receipts: raw.push_test_receipts.map((receipt) => ({
      id: String(receipt["id"] ?? ""),
      sent_at: String(receipt["sent_at"] ?? ""),
      received_at:
        typeof receipt["received_at"] === "string"
          ? receipt["received_at"]
          : null,
    })),
    email_digest_deliveries: raw.email_digest_deliveries.map((delivery) =>
      pickKeys(delivery, [
        "id",
        "digest_kind",
        "window_key",
        "locale",
        "alert_count",
        "urgent_bypass",
        "state",
        "subject",
        "sent_at",
        "bounced_at",
        "created_at",
      ]),
    ),
    email_digest_suppression: raw.email_digest_suppression
      ? {
          reason: String(raw.email_digest_suppression["reason"] ?? ""),
          suppressed_at: String(
            raw.email_digest_suppression["suppressed_at"] ?? "",
          ),
        }
      : null,
    webhook_endpoints: sanitizedWebhooks,
    webhook_deliveries: raw.webhook_deliveries.map((delivery) => ({
      id: String(delivery["id"] ?? ""),
      endpoint_id: String(delivery["endpoint_id"] ?? ""),
      alert_id:
        typeof delivery["alert_id"] === "string" ? delivery["alert_id"] : null,
      ok: Boolean(delivery["ok"]),
      status_code:
        typeof delivery["status_code"] === "number"
          ? delivery["status_code"]
          : null,
      created_at: String(delivery["created_at"] ?? ""),
    })),
    report_witnesses: raw.report_witnesses.map((witness) => ({
      report_id: String(witness["report_id"] ?? ""),
      vote: String(witness["vote"] ?? ""),
      created_at: String(witness["created_at"] ?? ""),
    })),
    report_flags: raw.report_flags.map((flag) => ({
      report_id: String(flag["report_id"] ?? ""),
      reason: String(flag["reason"] ?? ""),
      created_at: String(flag["created_at"] ?? ""),
    })),
    blocked_authors_count: raw.blocked_authors_count,
    roles: raw.roles.map((role) => ({
      role: String(role["role"] ?? ""),
      created_at: String(role["created_at"] ?? ""),
    })),
    data_minimization_notes: [
      "On-device Current Commune (ADR-0006): following never sends your exact position or commune code to Nadhir servers.",
      "Server-side EXIF stripping (F23): GPS coordinates, camera identity, XMP, and text metadata are removed from report photos before storage.",
      "Operational retention: citizen reports expire from the public map after 6 to 24 hours; operational cold-archive tables are archived and pruned from Postgres after 90 days (92 days for source_jobs).",
      "Zero analytics, advertising, or third-party crash SDKs are bundled; email digest logs store zero raw recipient email addresses; webhook HMAC secrets and full push device hashes are excluded from exports.",
    ],
  };
}

async function authenticateRequest(
  request: Request,
  deps: PrivacyDeps,
): Promise<AuthenticatedPrivacyUser | Response> {
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!bearer) return json({ error: "unauthorized" }, 401);
  const auth = await deps.getUser(bearer);
  if (auth.error || !auth.data.user) {
    return json({ error: "unauthorized" }, 401);
  }
  return auth.data.user;
}

export async function handlePrivacyConsentGet(
  request: Request,
  overrides: Partial<PrivacyDeps> = {},
): Promise<Response> {
  const deps: PrivacyDeps = { ...defaultDeps, ...overrides };
  const userOrErr = await authenticateRequest(request, deps);
  if (userOrErr instanceof Response) return userOrErr;

  const quota = await deps.consumeRateLimit(
    `privacy-consent-read:${userOrErr.id}`,
    60,
    60,
  );
  if (quota.error || quota.data == null) {
    return json({ error: "quota_unavailable" }, 503);
  }
  if (quota.data !== true) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  }

  try {
    const consents = await listUserConsents(userOrErr.id, deps);
    return json(
      {
        policy_version: PRIVACY_POLICY_VERSION,
        consents,
      },
      200,
    );
  } catch {
    return json({ error: "consent_unavailable" }, 503);
  }
}

export async function handlePrivacyConsentPost(
  request: Request,
  overrides: Partial<PrivacyDeps> = {},
): Promise<Response> {
  const deps: PrivacyDeps = { ...defaultDeps, ...overrides };
  const userOrErr = await authenticateRequest(request, deps);
  if (userOrErr instanceof Response) return userOrErr;

  const quota = await deps.consumeRateLimit(
    `privacy-consent-write:${userOrErr.id}`,
    20,
    60,
  );
  if (quota.error || quota.data == null) {
    return json({ error: "quota_unavailable" }, 503);
  }
  if (quota.data !== true) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  }

  const read = await readJsonBody(request, 4096);
  if ("error" in read) return json({ error: "invalid_request" }, read.status);
  const body = read.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_request" }, 400);
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0 || !keys.every((key) => ALLOWED_POST_KEYS.has(key))) {
    return json({ error: "invalid_request" }, 400);
  }

  const consentType = record["consent_type"];
  const status = record["status"];
  const policyVersion = record["policy_version"];
  const locale = record["locale"];
  const sourceSurface = record["source_surface"];

  if (typeof consentType !== "string" || !CONSENT_TYPE_SET.has(consentType)) {
    return json({ error: "invalid_consent_type" }, 400);
  }
  if (typeof status !== "string" || !CONSENT_STATUS_SET.has(status)) {
    return json({ error: "invalid_status" }, 400);
  }
  if (
    policyVersion !== undefined &&
    (typeof policyVersion !== "string" ||
      !POLICY_VERSION_RE.test(policyVersion))
  ) {
    return json({ error: "invalid_policy_version" }, 400);
  }
  if (
    locale !== undefined &&
    (typeof locale !== "string" || !CONSENT_LOCALE_SET.has(locale))
  ) {
    return json({ error: "invalid_locale" }, 400);
  }
  if (
    sourceSurface !== undefined &&
    (typeof sourceSurface !== "string" ||
      !CONSENT_SURFACE_SET.has(sourceSurface))
  ) {
    return json({ error: "invalid_source_surface" }, 400);
  }

  const mutationInput: ConsentMutationInput = {
    consent_type: consentType as ConsentType,
    policy_version:
      typeof policyVersion === "string"
        ? policyVersion
        : PRIVACY_POLICY_VERSION,
    locale: (locale as ConsentLocale | undefined) ?? "ar",
    source_surface:
      (sourceSurface as ConsentSourceSurface | undefined) ?? "web",
  };

  try {
    const consent =
      status === "granted"
        ? await recordUserConsent(userOrErr.id, mutationInput, deps)
        : await withdrawUserConsent(userOrErr.id, mutationInput, deps);
    return json(
      {
        ok: true,
        policy_version: PRIVACY_POLICY_VERSION,
        consent,
      },
      200,
    );
  } catch {
    return json({ error: "consent_write_failed" }, 503);
  }
}

export async function handlePrivacyExport(
  request: Request,
  overrides: Partial<PrivacyDeps> = {},
): Promise<Response> {
  const deps: PrivacyDeps = { ...defaultDeps, ...overrides };
  const userOrErr = await authenticateRequest(request, deps);
  if (userOrErr instanceof Response) return userOrErr;

  const quota = await deps.consumeRateLimit(
    `privacy-export:${userOrErr.id}`,
    5,
    3600,
  );
  if (quota.error || quota.data == null) {
    return json({ error: "quota_unavailable" }, 503);
  }
  if (quota.data !== true) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": "3600" });
  }

  try {
    const payload = await buildPersonalDataExport(userOrErr, deps);
    return json(payload, 200, {
      "Content-Disposition":
        'attachment; filename="nadhir-personal-data-export.json"',
    });
  } catch {
    return json({ error: "export_unavailable" }, 503);
  }
}
