import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { track4Ar } from "@/i18n/modules/track4/ar";
import { track4En } from "@/i18n/modules/track4/en";
import { track4Fr } from "@/i18n/modules/track4/fr";
import { track4Kab } from "@/i18n/modules/track4/kab";
import {
  buildPersonalDataExport,
  CONSENT_TYPES,
  handlePrivacyConsentGet,
  handlePrivacyConsentPost,
  handlePrivacyExport,
  PRIVACY_POLICY_VERSION,
  type PrivacyConsentRow,
  type PrivacyDeps,
  type PrivacyExportRawData,
} from "@/lib/privacy-consent.server";

const USER_A = {
  id: "f0480000-0000-4000-8000-000000000001",
  email: "citizen-a@example.com",
  created_at: "2026-09-01T10:00:00Z",
  email_confirmed_at: "2026-09-01T10:05:00Z",
  last_sign_in_at: "2026-11-25T09:00:00Z",
};

function makeInMemoryDeps(rawExport?: Partial<PrivacyExportRawData>): {
  deps: PrivacyDeps;
  store: Map<string, PrivacyConsentRow>;
} {
  const store = new Map<string, PrivacyConsentRow>();
  const now = () => new Date("2026-11-25T11:30:00.000Z");

  const deps: PrivacyDeps = {
    getUser: vi.fn(async (token: string) =>
      token === "valid-user-a"
        ? { data: { user: USER_A }, error: null }
        : { data: { user: null }, error: { message: "invalid" } },
    ),
    consumeRateLimit: vi.fn(async () => ({ data: true, error: null })),
    listConsents: vi.fn(async (userId: string) =>
      [...store.values()].filter((row) => row.user_id === userId),
    ),
    upsertConsent: vi.fn(async (row) => {
      const key = `${row.user_id}:${row.consent_type}`;
      const existing = store.get(key);
      const saved: PrivacyConsentRow = {
        id: existing?.id ?? `consent-${store.size + 1}`,
        user_id: row.user_id,
        consent_type: row.consent_type,
        policy_version: row.policy_version,
        status: row.status,
        granted_at: row.granted_at,
        withdrawn_at: row.withdrawn_at,
        locale: row.locale,
        source_surface: row.source_surface,
        created_at: existing?.created_at ?? now().toISOString(),
        updated_at: now().toISOString(),
      };
      store.set(key, saved);
      return saved;
    }),
    fetchExportData: vi.fn(async (userId: string) => ({
      profile: {
        id: userId,
        display_name: "Amina",
        locale: "fr",
        phone: null,
        alert_email: true,
        alert_push: true,
        email_digest_frequency: "daily",
        email_digest_hour_algiers: 7,
        min_confidence: 60,
        min_danger_level: 3,
        quiet_hours_start: 22,
        quiet_hours_end: 6,
        created_at: "2026-09-01T10:00:00Z",
        updated_at: "2026-11-25T10:00:00Z",
      },
      privacy_consents: [...store.values()]
        .filter((row) => row.user_id === userId)
        .map((r) => ({ ...r })),
      watch_zones: [
        {
          id: "zone-1",
          name: "Tizi Ouzou",
          lat: 36.7169,
          lon: 4.0497,
          radius_km: 20,
          commune_id: "1501",
          min_danger_level: 3,
          notify_fires: true,
          notify_risk: true,
          notify_weather: true,
          notify_official: true,
          notify_road: true,
          notify_citizen: true,
          notify_earthquake: true,
          active: true,
          created_at: "2026-09-02T00:00:00Z",
          updated_at: "2026-09-02T00:00:00Z",
        },
      ],
      citizen_reports: [
        {
          id: "rep-1",
          kind: "sighting",
          hazard: "fire",
          sighting: "smoke",
          size_hint: "small",
          lat: 36.71,
          lon: 4.05,
          commune_id: "1501",
          note: "Smoke near ridge",
          summary: "Smoke reported",
          photo_url: `${userId}/f0481000-0000-4000-8000-000000000001.webp`,
          status: "approved",
          publish_state: "published",
          observed_at: "2026-11-25T08:00:00Z",
          expires_at: "2026-11-25T14:00:00Z",
          created_at: "2026-11-25T08:00:00Z",
          updated_at: "2026-11-25T08:01:00Z",
          // Adversarial internal fields that MUST be stripped:
          reviewed_by: "mod-secret-uuid-9999",
          moderation_note: "internal mod note",
          classifier: "mistral-internal",
        },
      ],
      alerts: [
        {
          id: "al-1",
          kind: "weather",
          severity: 4,
          title: "ONM Orange",
          body: "Heavy rain warning",
          commune_id: "1501",
          zone_id: "zone-1",
          distance_km: 4.2,
          delivered_email: true,
          delivered_webhook: false,
          push_state: "sent",
          read_at: null,
          created_at: "2026-11-25T07:00:00Z",
          // Internal fields that MUST be stripped:
          dedupe_key: "secret-dedupe-key",
          push_claimed_at: "2026-11-25T07:00:01Z",
          push_attempts: 1,
        },
      ],
      push_devices: [
        {
          device_hash:
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          fcm_token: "RAW_FCM_TOKEN_MUST_NEVER_LEAK",
          updated_at: "2026-11-24T12:00:00Z",
        },
      ],
      push_test_receipts: [
        {
          id: "pt-1",
          sent_at: "2026-11-24T12:01:00Z",
          received_at: "2026-11-24T12:01:03Z",
        },
      ],
      email_digest_deliveries: [
        {
          id: "ed-1",
          digest_kind: "daily",
          window_key: "2026-11-25",
          locale: "fr",
          alert_count: 2,
          urgent_bypass: false,
          state: "sent",
          subject: "Nadhir daily digest",
          sent_at: "2026-11-25T06:00:00Z",
          bounced_at: null,
          created_at: "2026-11-25T05:59:00Z",
          // Internal fields that MUST be stripped:
          lease_token: "secret-lease-token",
          dedupe_key: "digest-dedupe",
          last_error: "internal smtp trace",
        },
      ],
      email_digest_suppression: {
        reason: "user_unsubscribed",
        suppressed_at: "2026-11-25T08:00:00Z",
        provider_error: "SECRET_PROVIDER_ERROR_DUMP",
      },
      webhook_endpoints: [
        {
          id: "wh-1",
          label: "Community hook",
          url: "https://hooks.example.dz/nadhir",
          secret: "HMAC_TOP_SECRET_SHOULD_NEVER_EXPORT",
          kinds: ["official", "earthquake"],
          min_severity: 3,
          active: true,
          last_attempt_at: "2026-11-25T08:00:00Z",
          last_status: 200,
          last_error: "internal stack",
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-01T00:00:00Z",
        },
      ],
      webhook_deliveries: [
        {
          id: "whd-1",
          endpoint_id: "wh-1",
          alert_id: "al-1",
          ok: true,
          status_code: 200,
          error: "raw error text",
          created_at: "2026-11-25T08:00:01Z",
        },
      ],
      report_witnesses: [
        {
          report_id: "rep-2",
          vote: "seen",
          created_at: "2026-11-25T08:10:00Z",
        },
      ],
      report_flags: [
        {
          report_id: "rep-3",
          reason: "false",
          created_at: "2026-11-25T08:15:00Z",
        },
      ],
      blocked_authors_count: 2,
      roles: [{ role: "citizen", created_at: "2026-09-01T10:00:00Z" }],
      ...rawExport,
    })),
    now,
  };

  return { deps, store };
}

describe("F22 Law 18-07 / Law 25-11 (ANPDP) consent & export APIs", () => {
  it("records consent grants, withdraws consents, and scopes strictly to authenticated user", async () => {
    const { deps } = makeInMemoryDeps();

    // Unauthenticated rejected
    const unauthGet = await handlePrivacyConsentGet(
      new Request("https://nadhir.app/api/private/privacy-consent"),
      deps,
    );
    expect(unauthGet.status).toBe(401);

    // Grant consent
    const grantRes = await handlePrivacyConsentPost(
      new Request("https://nadhir.app/api/private/privacy-consent", {
        method: "POST",
        headers: {
          authorization: "Bearer valid-user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          consent_type: "email_digest",
          status: "granted",
          locale: "fr",
          source_surface: "settings",
        }),
      }),
      deps,
    );
    expect(grantRes.status).toBe(200);
    expect(grantRes.headers.get("cache-control")).toBe("private, no-store");
    const grantBody = (await grantRes.json()) as {
      ok: boolean;
      consent: PrivacyConsentRow;
    };
    expect(grantBody.ok).toBe(true);
    expect(grantBody.consent.user_id).toBe(USER_A.id);
    expect(grantBody.consent.status).toBe("granted");
    expect(grantBody.consent.granted_at).toBeTruthy();
    expect(grantBody.consent.withdrawn_at).toBeNull();

    // Withdraw consent
    const withdrawRes = await handlePrivacyConsentPost(
      new Request("https://nadhir.app/api/private/privacy-consent", {
        method: "POST",
        headers: {
          authorization: "Bearer valid-user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          consent_type: "email_digest",
          status: "withdrawn",
          locale: "fr",
          source_surface: "settings",
        }),
      }),
      deps,
    );
    expect(withdrawRes.status).toBe(200);
    const withdrawBody = (await withdrawRes.json()) as {
      ok: boolean;
      consent: PrivacyConsentRow;
    };
    expect(withdrawBody.consent.status).toBe("withdrawn");
    expect(withdrawBody.consent.withdrawn_at).toBeTruthy();

    // List consents returns recorded entry for USER_A
    const listRes = await handlePrivacyConsentGet(
      new Request("https://nadhir.app/api/private/privacy-consent", {
        headers: { authorization: "Bearer valid-user-a" },
      }),
      deps,
    );
    expect(listRes.status).toBe(200);
    expect(listRes.headers.get("cache-control")).toBe("private, no-store");
    const listBody = (await listRes.json()) as {
      policy_version: string;
      consents: PrivacyConsentRow[];
    };
    expect(listBody.policy_version).toBe(PRIVACY_POLICY_VERSION);
    expect(listBody.consents).toHaveLength(1);
    expect(listBody.consents[0]?.status).toBe("withdrawn");
  });

  it("rejects tampered user_id, invalid consent_type, invalid policy_version (400), and rate limits (429)", async () => {
    const { deps } = makeInMemoryDeps();

    const makePost = (body: unknown) =>
      new Request("https://nadhir.app/api/private/privacy-consent", {
        method: "POST",
        headers: {
          authorization: "Bearer valid-user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

    // Attempt to spoof another user_id in body is rejected
    expect(
      (
        await handlePrivacyConsentPost(
          makePost({
            consent_type: "privacy_policy",
            status: "granted",
            user_id: "f0480000-0000-4000-8000-000000000999",
          }),
          deps,
        )
      ).status,
    ).toBe(400);

    expect(
      (
        await handlePrivacyConsentPost(
          makePost({ consent_type: "unknown_purpose", status: "granted" }),
          deps,
        )
      ).status,
    ).toBe(400);

    expect(
      (
        await handlePrivacyConsentPost(
          makePost({
            consent_type: "privacy_policy",
            status: "granted",
            policy_version: "bad-version",
          }),
          deps,
        )
      ).status,
    ).toBe(400);

    // Rate limited -> 429
    deps.consumeRateLimit = vi.fn(async () => ({ data: false, error: null }));
    const limited = await handlePrivacyConsentPost(
      makePost({ consent_type: "privacy_policy", status: "granted" }),
      deps,
    );
    expect(limited.status).toBe(429);
  });

  it("exports full personal data JSON with strict redaction of secrets, hashes, and third-party/moderator UUIDs", async () => {
    const { deps } = makeInMemoryDeps();

    const unauth = await handlePrivacyExport(
      new Request("https://nadhir.app/api/private/privacy-export"),
      deps,
    );
    expect(unauth.status).toBe(401);

    const res = await handlePrivacyExport(
      new Request("https://nadhir.app/api/private/privacy-export", {
        headers: { authorization: "Bearer valid-user-a" },
      }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="nadhir-personal-data-export.json"',
    );

    const rawText = await res.text();
    const payload = JSON.parse(rawText) as Awaited<
      ReturnType<typeof buildPersonalDataExport>
    >;

    expect(payload.schema_version).toBe("1.0");
    expect(payload.policy_version).toBe(PRIVACY_POLICY_VERSION);
    expect(payload.legal_basis).toContain("18-07");
    expect(payload.legal_basis).toContain("25-11");
    expect(payload.authority).toContain("ANPDP");
    expect(payload.account.id).toBe(USER_A.id);
    expect(payload.webhook_endpoints[0]?.secret_redacted).toBe(true);
    expect(payload.push_devices.registered_device_count).toBe(1);
    expect(payload.push_devices.devices[0]?.device_hash_prefix).toBe(
      "abcdef01",
    );
    expect(payload.blocked_authors_count).toBe(2);
    expect(payload.data_minimization_notes.join(" ")).toContain(
      "following never sends your exact position",
    );

    // ZERO secret, hash, internal token, moderator UUID, or em-dash leakage
    for (const forbidden of [
      "HMAC_TOP_SECRET_SHOULD_NEVER_EXPORT",
      "RAW_FCM_TOKEN_MUST_NEVER_LEAK",
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      "mod-secret-uuid-9999",
      "internal mod note",
      "secret-lease-token",
      "secret-dedupe-key",
      "SECRET_PROVIDER_ERROR_DUMP",
      "\u2014",
    ]) {
      expect(rawText).not.toContain(forbidden);
    }

    // Export rate limit -> 429
    deps.consumeRateLimit = vi.fn(async () => ({ data: false, error: null }));
    const limited = await handlePrivacyExport(
      new Request("https://nadhir.app/api/private/privacy-export", {
        headers: { authorization: "Bearer valid-user-a" },
      }),
      deps,
    );
    expect(limited.status).toBe(429);
  });
});

describe("F22 4-locale Law 18-07 / Law 25-11 / ANPDP copy, ADR-0006 & antislop compliance", () => {
  it("discloses Law 18-07, Law 25-11, and ANPDP across all 4 locales with zero em dashes and ADR-0006 wording", () => {
    const locales = [
      ["en", track4En],
      ["fr", track4Fr],
      ["ar", track4Ar],
      ["kab", track4Kab],
    ] as const;

    for (const [lang, bundle] of locales) {
      const serialized = JSON.stringify(bundle);
      expect(serialized, `${lang} Law 18-07`).toContain("18-07");
      expect(serialized, `${lang} Law 25-11`).toContain("25-11");
      expect(serialized, `${lang} ANPDP`).toContain("ANPDP");
      expect(serialized, `${lang} zero em dash`).not.toContain("\u2014");
      expect(
        serialized.toLowerCase(),
        `${lang} ADR-0006 no tracking`,
      ).not.toContain("tracking");
      expect(
        serialized.toLowerCase(),
        `${lang} ADR-0006 no live location`,
      ).not.toContain("live location");
      expect(
        serialized.toLowerCase(),
        `${lang} ADR-0006 no near me`,
      ).not.toContain("near me");
      for (const consentType of CONSENT_TYPES) {
        expect(
          bundle.privacyCompliance.settings.purposes[consentType].label.trim()
            .length,
          `${lang} purpose ${consentType}`,
        ).toBeGreaterThan(0);
      }
    }

    expect(track4En.privacyCompliance.sections.minimizationBody).toContain(
      "following never sends your exact position",
    );
  });

  it("verifies docs/privacy-anpdp-compliance.md and M4C UI/server files have zero em dashes", () => {
    const root = process.cwd();
    const doc = readFileSync(
      join(root, "docs/privacy-anpdp-compliance.md"),
      "utf8",
    );
    expect(doc).toContain("18-07");
    expect(doc).toContain("25-11");
    expect(doc).toContain("ANPDP");
    expect(doc).toContain("following never sends your exact position");
    expect(doc).toContain("90 days");
    expect(doc).toContain("92 days");
    expect(doc).toContain("EXIF");
    expect(doc).toContain("Turnstile");

    const filesToAudit = [
      "docs/privacy-anpdp-compliance.md",
      "src/routes/privacy.tsx",
      "src/routes/_authenticated/settings.tsx",
      "src/components/nadhir/PrivacyControls.tsx",
      "src/components/TurnstileWidget.tsx",
      "src/lib/turnstile.ts",
      "src/lib/privacy-consent.server.ts",
      "src/lib/report-photo.server.ts",
      "src/lib/turnstile.server.ts",
      "src/lib/image-metadata.ts",
    ];

    for (const relPath of filesToAudit) {
      const content = readFileSync(join(root, relPath), "utf8");
      expect(content, `${relPath} zero em dash`).not.toContain("\u2014");
    }
  });
});
