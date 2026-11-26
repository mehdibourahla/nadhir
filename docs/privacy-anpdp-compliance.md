# Nadhir Privacy and Compliance Matrix (Algerian Law No. 18-07 and Law No. 25-11 / ANPDP)

Policy version: `2026-11-25`

## 1. Statutory Scope and Regulatory Authority

Nadhir is an independent personal public-interest multi-hazard alert platform for Algeria. Personal data processing for optional signed-in accounts is designed to comply with:

- **Algerian Law No. 18-07 of 10 June 2018** on the protection of natural persons in the processing of personal data.
- **Algerian Law No. 25-11 of 24 July 2025** amending and supplementing Law No. 18-07.
- **Oversight Authority**: Autorite Nationale de Protection des Donnees a Caractere Personnel (**ANPDP**).

Core hazard maps, forecasts, Survival Mode, and accountless commune push topics (`v1.commune.<code>.<lang>`) operate with zero account creation and zero personal identity stored on Nadhir servers.

---

## 2. Personal Data Inventory and Export Redaction Matrix

All user-owned tables cascade on `auth.users(id) ON DELETE CASCADE` and are accessible to the data subject through `GET /api/private/privacy-export` with strict redaction of secrets, hashes, and third-party identifiers:

| Table                              | Ownership Key | Included in JSON Export                                                                                          | Strictly Excluded / Redacted                                                                     |
| ---------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `auth.users`                       | `id`          | `id`, `email`, `created_at`, `email_confirmed_at`, `last_sign_in_at`                                             | Raw JWTs, MFA factors, recovery tokens, internal metadata                                        |
| `public.profiles`                  | `id`          | User-facing alert and locale preferences                                                                         | None                                                                                             |
| `public.privacy_consents`          | `user_id`     | `consent_type`, `policy_version`, `status`, `granted_at`, `withdrawn_at`, `locale`, `source_surface`, timestamps | None                                                                                             |
| `public.zones`                     | `user_id`     | Saved watch zones (`name`, `lat`, `lon`, `radius_km`, `commune_id`, notification toggles)                        | None                                                                                             |
| `public.citizen_reports`           | `user_id`     | User-submitted hazard reports and sanitized `photo_url` key                                                      | `reviewed_by` (moderator UUID), `moderation_note`, `flagged_at`, `user_flagged_at`, `classifier` |
| `public.alerts`                    | `user_id`     | Up to 500 recent user alerts (`kind`, `severity`, `title`, `body`, delivery status, timestamps)                  | `dedupe_key`, `push_claimed_at`, `push_attempts`                                                 |
| `public.user_push_devices`         | `user_id`     | `registered_device_count` and 8-char `device_hash_prefix` + `updated_at`                                         | Raw FCM/APNs tokens (never stored) and full SHA-256 `device_hash`                                |
| `public.push_test_receipts`        | `user_id`     | `id`, `sent_at`, `received_at`                                                                                   | None                                                                                             |
| `public.email_digest_deliveries`   | `user_id`     | Up to 200 recent digest delivery summaries (table stores zero raw recipient emails)                              | `lease_token`, `lease_until`, `dedupe_key`, `provider_message_id`, `last_error`                  |
| `public.email_digest_suppressions` | `user_id`     | `reason`, `suppressed_at`                                                                                        | `provider_error`                                                                                 |
| `public.webhook_endpoints`         | `user_id`     | Endpoint metadata + `secret_redacted: true`                                                                      | `secret` (HMAC signing secret), `last_error`                                                     |
| `public.webhook_deliveries`        | `user_id`     | Up to 200 recent delivery statuses (`ok`, `status_code`, `created_at`)                                           | Raw `error` internals                                                                            |
| `public.report_witnesses`          | `user_id`     | `report_id`, `vote`, `created_at`                                                                                | None                                                                                             |
| `public.citizen_report_flags`      | `user_id`     | `report_id`, `reason`, `created_at`                                                                              | None                                                                                             |
| `public.user_report_blocks`        | `blocker`     | `blocked_authors_count` only                                                                                     | Third-party `author` UUIDs                                                                       |
| `public.user_roles`                | `user_id`     | `role`, `created_at`                                                                                             | None                                                                                             |

Operational security/moderation tables (`webhook_outbox`, `citizen_report_submissions`, `reporter_blocks`, `admin_audit`) are excluded from citizen exports to prevent leaking queue leases or moderator metadata; `admin_audit` records are anonymized automatically on account deletion via `anonymize_deleted_account_audit()`.

---

## 3. Legal Bases and Consent Lifecycle

Optional account processing is backed by an auditable consent ledger (`public.privacy_consents`, unique per `(user_id, consent_type)`):

- **Supported consent types**: `privacy_policy`, `citizen_reports`, `zone_alerts`, `email_digest`, `push_alerts`, `on_device_commune`.
- **Tracked fields**: `policy_version`, `status` (`granted` or `withdrawn`), `granted_at`, `withdrawn_at`, `locale` (`ar`, `fr`, `en`, `kab`), `source_surface` (`web`, `android`, `ios`, `api`, `settings`, `privacy`, `signup`).
- **API endpoints**:
  - `GET /api/private/privacy-consent` (Bearer JWT, `Cache-Control: private, no-store`, rate-limited)
  - `POST /api/private/privacy-consent` (Bearer JWT, strict schema validation, records grant or withdrawal scoped strictly to `auth.uid()`)
- **Row-Level Security**: `anon` has zero privileges; `authenticated` users can only read, insert, and update their own rows (no direct `DELETE`; erasure occurs via account deletion `ON DELETE CASCADE`).

---

## 4. Data-Subject Rights Implementation Map

| Right (Law 18-07 / Law 25-11)            | Implementation Surface                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Right of Information                     | `/privacy` in 4 languages (`ar`, `fr`, `en`, `kab`) with versioned policy notice                                                   |
| Right of Access & Data Portability       | `GET /api/private/privacy-export` and Settings `#privacy` JSON export download                                                     |
| Right of Rectification                   | `/settings` profile, alert preferences, watch zones, and account security controls                                                 |
| Right of Opposition & Consent Withdrawal | `POST /api/private/privacy-consent` and Settings `#privacy` per-purpose controls                                                   |
| Right of Erasure                         | `DELETE /api/private/account` (deletes `report-photos/<uid>/*`, revokes sessions, cascades `auth.users`, anonymizes `admin_audit`) |
| Regulatory Recourse                      | Explicit ANPDP complaint notice published on `/privacy` in all 4 languages                                                         |

---

## 5. Technical Data Minimization and Security Controls

1. **ADR-0006 On-Device Current Commune**: Coarse location is matched locally on-device against bundled administrative boundaries (`communes.v1.json`): following never sends your exact position or commune code to Nadhir servers.
2. **F23 Server-Side EXIF Stripping & Storage RLS Lockdown**:
   - Direct client `INSERT` on `storage.objects` (`report-photos`) is removed, and direct `UPDATE` is locked down via `WITH CHECK (false)` (raising SQLSTATE `42501`).
   - All report photo uploads pass through `POST /api/private/report-photo`, which enforces Bearer auth, rate limits, 8 MiB ceiling, strict magic-byte validation (JPEG, PNG, WebP), and pure Web Standard server-side stripping of EXIF, GPS, XMP, ICC-unrelated APP2 (MPF), PNG `eXIf`/`tEXt`/`iTXt`/`zTXt`/`tIME`, WebP `EXIF`/`XMP `, and trailing payloads before persisting via `service_role`.
3. **F24 Cloudflare Turnstile Anti-Abuse Protection**:
   - Fail-closed server-side `siteverify` verification (`src/lib/turnstile.server.ts`) validating token format, single-use validity, `action`, and `hostname` on write/submission/auth endpoints (`contribute/idea`, `contribute/translation`, `contribute/vote`, `report-publish`, and web auth `signup`/`forgot`/`verify`).
   - Read-only public hazard feeds (`/api/public/v1/*`, `/api/public/share/*`, `/forecast`, `/wilaya/$slug`, `/survival/*`) are never gated by CAPTCHA.
4. **Transport & Packaging Hygiene**: HTTPS/TLS enforced (`usesCleartextTraffic="false"`, `allowMixedContent: false`), strict CSP headers, zero ad/analytics/crash SDKs, and SHA-256 device hashing only.

---

## 6. Cross-Border Transfer Register

| Sub-Processor                       | Purpose                                             | Region / Scope                                   | Data Minimization Safeguard                                                                         |
| ----------------------------------- | --------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Cloudflare (Workers, R2, Turnstile) | Edge SSR, public API, share cards, CAPTCHA          | Global Edge                                      | No persistent user account DB; Turnstile only on write/auth endpoints                               |
| Supabase                            | Auth, Postgres DB, private Storage                  | EU Region                                        | Strict RLS, least-privilege grants, private buckets                                                 |
| EU Backend Worker                   | Always-on ingestion and delivery                    | EU Host                                          | Non-root `read_only` container; consumes `source_jobs` only                                         |
| Google FCM / Apple APNs             | Mobile and web push delivery                        | Global                                           | Accountless commune topics or SHA-256 `device_hash` only; no raw FCM tokens stored                  |
| Resend                              | Transactional auth emails and optional zone digests | EU / US                                          | Zero raw email addresses stored in `email_digest_deliveries`                                        |
| LLM Classification & EU Fallback    | Citizen report text classification                  | EU (Mistral default) / configured cloud fallback | Receives hazard category, commune, and report text only; never email, user ID, or exact coordinates |
| CARTO / Open-Meteo                  | Public map tiles and weather forecasts              | Global / EU                                      | Standard client web requests with zero account identity                                             |

---

## 7. Retention and Deletion Schedule

- **Citizen reports on public map**: Expire after 6 hours (or up to 24 hours if corroborated by nearby signed-in witnesses).
- **Operational hot Postgres tables**: Archived to SHA-256 and MD5-digest verified Parquet snapshots in private `cold-archive` storage and pruned from Postgres after **90 days** (`weather_snapshots`, `risk_forecasts`, `broadcast_audit`, `airport_observations`, `source_runs`) or **92 days** (`source_jobs`).
- **Raw source archive (`source-archive`)**: Stores public upstream hazard feeds only; never stores auth traffic, notifications, credentials, or user location lookups.
- **Account erasure**: Immediate deletion of `report-photos/<userId>/*`, global session revocation, cascading `auth.users` deletion across all 15 user-linked tables, and automatic `admin_audit` anonymization.

---

## 8. Automated Verification Coverage

- `supabase/tests/m4c_privacy_exif_turnstile.test.sql`: pgTAP verification of `privacy_consents` constraints, RLS isolation, function privilege revocation, `ON DELETE CASCADE`, and `storage.objects` `report-photos` write lockdown + owner read/delete.
- `src/lib/__tests__/image-metadata.test.ts` and `src/lib/__tests__/report-photo-exif.test.ts`: Byte-level JPEG, PNG, and WebP EXIF/GPS/XMP/camera stripping and upload endpoint rejection tests (`400`, `401`, `413`, `415`).
- `src/lib/__tests__/turnstile.test.ts`: Fail-closed Turnstile verification across missing, replayed, wrong-action, wrong-hostname, timeout, and valid tokens across all wired write handlers, plus static guarantee of zero Turnstile gating on read-only public hazard routes.
- `src/lib/__tests__/privacy-anpdp-compliance.test.ts`: Consent grant/withdraw/list, `auth.uid()` scoping, JSON export schema and zero secret/hash/moderator-UUID leakage, 4-locale Law 18-07 / Law 25-11 / ANPDP copy checks, ADR-0006 wording checks, and zero em dashes.
