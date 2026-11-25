import { describe, expect, it } from "vitest";

import { importRepoModule } from "../lib/env.ts";
import {
  createJpegWithExif,
  createPngWithExif,
  inspectImageForMetadata,
} from "../lib/exif.ts";
import { fetchText } from "../lib/http.ts";
import { assertPgReachable, psqlQuery, runInRolledBackTx } from "../lib/pg.ts";

function asciiBytes(value: string): number[] {
  return [...value].map((ch) => ch.charCodeAt(0));
}

function pngChunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [
    (len >> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
    ...asciiBytes(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
}

function jpegSegment(marker: number, body: number[]): number[] {
  const len = body.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...body];
}

function webpChunk(fourCC: string, payload: number[]): number[] {
  const len = payload.length;
  const pad = len & 1 ? [0] : [];
  return [
    ...asciiBytes(fourCC),
    len & 0xff,
    (len >> 8) & 0xff,
    (len >> 16) & 0xff,
    (len >> 24) & 0xff,
    ...payload,
    ...pad,
  ];
}

describe("Tier 5 — Security, Privacy & RLS Adversarial Hardening", () => {
  describe("T5-01: push_alerts consent withdrawal (Law 18-07 / Law 25-11)", () => {
    it("excludes withdrawn push_alerts users in live Postgres claim_alert_pushes and restores eligibility on re-grant", () => {
      assertPgReachable();
      const output = runInRolledBackTx(`
        INSERT INTO auth.users (id, email) VALUES
          ('5e010000-0000-4000-8000-000000000001', 't5-e2e-granted@example.invalid'),
          ('5e010000-0000-4000-8000-000000000002', 't5-e2e-withdrawn@example.invalid'),
          ('5e010000-0000-4000-8000-000000000003', 't5-e2e-email-only@example.invalid');

        INSERT INTO public.privacy_consents (
          user_id, consent_type, policy_version, status, granted_at, withdrawn_at, locale, source_surface
        ) VALUES
          ('5e010000-0000-4000-8000-000000000001', 'push_alerts', '2026-11-25', 'granted', now() - interval '1 hour', null, 'ar', 'settings'),
          ('5e010000-0000-4000-8000-000000000002', 'push_alerts', '2026-11-25', 'withdrawn', now() - interval '2 hours', now(), 'ar', 'settings'),
          ('5e010000-0000-4000-8000-000000000003', 'email_digest', '2026-11-25', 'withdrawn', now() - interval '2 hours', now(), 'fr', 'privacy');

        INSERT INTO public.alerts (id, user_id, kind, severity, dedupe_key, title, body, created_at) VALUES
          ('5e010000-0000-4000-8000-000000000101', '5e010000-0000-4000-8000-000000000001', 'weather', 3, 't5e2e:u1', 'ONM', 'Rain', now()),
          ('5e010000-0000-4000-8000-000000000102', '5e010000-0000-4000-8000-000000000002', 'weather', 3, 't5e2e:u2', 'ONM', 'Rain', now()),
          ('5e010000-0000-4000-8000-000000000103', '5e010000-0000-4000-8000-000000000003', 'weather', 3, 't5e2e:u3', 'ONM', 'Rain', now());

        CREATE TEMP TABLE _t5_first_claim AS
          SELECT id FROM public.claim_alert_pushes(50)
           WHERE id IN (
             '5e010000-0000-4000-8000-000000000101'::uuid,
             '5e010000-0000-4000-8000-000000000102'::uuid,
             '5e010000-0000-4000-8000-000000000103'::uuid
           );

        UPDATE public.privacy_consents
           SET status = 'granted', granted_at = now(), withdrawn_at = null
         WHERE user_id = '5e010000-0000-4000-8000-000000000002'
           AND consent_type = 'push_alerts';

        CREATE TEMP TABLE _t5_second_claim AS
          SELECT id FROM public.claim_alert_pushes(50)
           WHERE id = '5e010000-0000-4000-8000-000000000102'::uuid;

        SELECT json_build_object(
          'first_claimed', (SELECT coalesce(json_agg(id ORDER BY id), '[]'::json) FROM _t5_first_claim),
          'second_claimed', (SELECT coalesce(json_agg(id ORDER BY id), '[]'::json) FROM _t5_second_claim),
          'u2_attempts', (SELECT push_attempts FROM public.alerts WHERE id = '5e010000-0000-4000-8000-000000000102'::uuid)
        )::text
      `);

      const lines = output
        .split(/\r?\n/)
        .filter((l) => l.trim().startsWith("{"));
      const parsed = JSON.parse(lines.at(-1) ?? "{}") as {
        first_claimed: string[];
        second_claimed: string[];
        u2_attempts: number;
      };
      expect(parsed.first_claimed).toEqual([
        "5e010000-0000-4000-8000-000000000101",
        "5e010000-0000-4000-8000-000000000103",
      ]);
      expect(parsed.second_claimed).toEqual([
        "5e010000-0000-4000-8000-000000000102",
      ]);
      expect(parsed.u2_attempts).toBe(1);
    });

    it("enforces 5-role least-privilege grants, SECURITY DEFINER, and pinned search_path on claim_alert_pushes", () => {
      assertPgReachable();
      const raw = psqlQuery(`
        SELECT json_build_object(
          'public', has_function_privilege('public', 'public.claim_alert_pushes(integer)', 'execute'),
          'anon', has_function_privilege('anon', 'public.claim_alert_pushes(integer)', 'execute'),
          'authenticated', has_function_privilege('authenticated', 'public.claim_alert_pushes(integer)', 'execute'),
          'cold_reader', has_function_privilege('cold_reader', 'public.claim_alert_pushes(integer)', 'execute'),
          'service_role', has_function_privilege('service_role', 'public.claim_alert_pushes(integer)', 'execute'),
          'secdef', (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.claim_alert_pushes(integer)'::regprocedure),
          'pinned_search_path', (
            SELECT p.proconfig IS NOT NULL
               AND ('search_path=""' = ANY(p.proconfig) OR 'search_path=' = ANY(p.proconfig))
              FROM pg_proc p
             WHERE p.oid = 'public.claim_alert_pushes(integer)'::regprocedure
          )
        )::text;
      `);
      const matrix = JSON.parse(raw) as Record<string, boolean>;
      expect(matrix).toEqual({
        public: false,
        anon: false,
        authenticated: false,
        cold_reader: false,
        service_role: true,
        secdef: true,
        pinned_search_path: true,
      });
    });

    it("enforces fail-closed defense-in-depth in drainAlertPushes when push_alerts consent is withdrawn or lookup fails", async () => {
      const mod = await importRepoModule<{
        drainAlertPushes: (deps: Record<string, unknown>) => Promise<{
          pushed: number;
          pushFailed: number;
          noDevice: number;
          consentWithdrawn: number;
          claimsLost: number;
        }>;
      }>("src/lib/alert-push.server.ts");

      const sent: string[] = [];
      const finished: Array<[string, string]> = [];
      const rows = [
        {
          id: "alert-withdrawn",
          user_id: "user-withdrawn",
          kind: "weather",
          title: "ONM",
          body: "Rain",
          source_id: "onm-1",
          cluster_id: null,
          payload: null,
          push_attempts: 1,
          push_claimed_at: "2026-11-25T12:00:00Z",
        },
        {
          id: "alert-granted",
          user_id: "user-granted",
          kind: "weather",
          title: "ONM",
          body: "Rain",
          source_id: "onm-2",
          cluster_id: null,
          payload: null,
          push_attempts: 1,
          push_claimed_at: "2026-11-25T12:00:00Z",
        },
      ];

      const summary = await mod.drainAlertPushes({
        configured: () => true,
        claim: async () => rows,
        withdrawnPushConsent: async () => new Set(["user-withdrawn"]),
        devices: async (userIds: string[]) => new Set(userIds),
        send: async (row: { id: string }) => {
          sent.push(row.id);
        },
        finish: async (row: { id: string }, state: string) => {
          finished.push([row.id, state]);
        },
      });

      expect(summary).toEqual({
        pushed: 1,
        pushFailed: 0,
        noDevice: 0,
        consentWithdrawn: 1,
        claimsLost: 0,
      });
      expect(sent).toEqual(["alert-granted"]);
      expect(finished).toEqual([
        ["alert-withdrawn", "skipped"],
        ["alert-granted", "sent"],
      ]);

      // Fail-closed: DB error on consent check MUST NOT invoke FCM send
      let sentOnError = 0;
      await expect(
        mod.drainAlertPushes({
          configured: () => true,
          claim: async () => rows,
          withdrawnPushConsent: async () => {
            throw new Error("consent lookup error");
          },
          devices: async () => new Set(["user-granted"]),
          send: async () => {
            sentOnError += 1;
          },
          finish: async () => undefined,
        }),
      ).rejects.toThrow("consent lookup error");
      expect(sentOnError).toBe(0);
    });
  });

  describe("T5-05: Image metadata sanitizer allowlist & empty-image rejection", () => {
    it("strips PNG private/non-allowlisted chunks (zXIf, meTa, dSIG) and rejects zero-IDAT PNGs", async () => {
      const mod = await importRepoModule<{
        stripImageMetadata: (bytes: Uint8Array, mime: string) => Uint8Array;
        validateAndStripReportPhoto: (
          bytes: Uint8Array,
          opts?: { declaredMime?: string },
        ) => { bytes: Uint8Array; mimeType: string; strippedBytes: number };
      }>("src/lib/image-metadata.ts");

      const dirtyPng = new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        ...pngChunk("IHDR", new Array(13).fill(1)),
        ...pngChunk("zXIf", asciiBytes("GPS:36.7538N,3.0588E")),
        ...pngChunk("meTa", asciiBytes("iPhone16Pro")),
        ...pngChunk("dSIG", asciiBytes("PRIVATE_CERT")),
        ...pngChunk("IDAT", [1, 2, 3, 4]),
        ...pngChunk("IEND", []),
      ]);

      const cleaned = mod.validateAndStripReportPhoto(dirtyPng, {
        declaredMime: "image/png",
      });
      const text = new TextDecoder("latin1").decode(cleaned.bytes);
      expect(text).not.toContain("zXIf");
      expect(text).not.toContain("meTa");
      expect(text).not.toContain("dSIG");
      expect(text).not.toContain("36.7538");
      expect(text).toContain("IHDR");
      expect(text).toContain("IDAT");
      expect(text).toContain("IEND");

      const zeroIdatPng = new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        ...pngChunk("IHDR", new Array(13).fill(1)),
        ...pngChunk("IEND", []),
      ]);
      expect(() =>
        mod.validateAndStripReportPhoto(zeroIdatPng, {
          declaredMime: "image/png",
        }),
      ).toThrow("invalid_image");
    });

    it("strips JPEG APP0 JFXX/thumbnail metadata, preserves minimal 16B JFIF, and rejects 4-byte empty JPEGs", async () => {
      const mod = await importRepoModule<{
        validateAndStripReportPhoto: (
          bytes: Uint8Array,
          opts?: { declaredMime?: string },
        ) => { bytes: Uint8Array; mimeType: string; strippedBytes: number };
      }>("src/lib/image-metadata.ts");

      const minimalJfif = [...asciiBytes("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0];
      const jpegWithJfxx = new Uint8Array([
        0xff,
        0xd8,
        ...jpegSegment(0xe0, minimalJfif),
        ...jpegSegment(0xe0, asciiBytes("JFXX\0GPS:36.7538N,3.0588E")),
        ...jpegSegment(0xda, [0x00, 0x01]),
        0x11,
        0x22,
        0xff,
        0xd9,
      ]);

      const result = mod.validateAndStripReportPhoto(jpegWithJfxx, {
        declaredMime: "image/jpeg",
      });
      const latin1 = new TextDecoder("latin1").decode(result.bytes);
      expect(latin1).toContain("JFIF\0");
      expect(latin1).not.toContain("JFXX");
      expect(latin1).not.toContain("36.7538");

      const emptyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      expect(() =>
        mod.validateAndStripReportPhoto(emptyJpeg, {
          declaredMime: "image/jpeg",
        }),
      ).toThrow("invalid_image");
    });

    it("sanitizes genuine JFIF JPEG, PNG with EXIF, and WebP VP8X+EXIF+XMP cleanly", async () => {
      const mod = await importRepoModule<{
        validateAndStripReportPhoto: (
          bytes: Uint8Array,
          opts?: { declaredMime?: string },
        ) => { bytes: Uint8Array; mimeType: string; strippedBytes: number };
      }>("src/lib/image-metadata.ts");

      const jpegClean = mod.validateAndStripReportPhoto(
        createJpegWithExif({ latitude: 36.7538, longitude: 3.0588 }),
        { declaredMime: "image/jpeg" },
      );
      expect(inspectImageForMetadata(jpegClean.bytes).hasGps).toBe(false);
      expect(inspectImageForMetadata(jpegClean.bytes).hasExif).toBe(false);

      const pngClean = mod.validateAndStripReportPhoto(
        createPngWithExif({ latitude: 36.7538, longitude: 3.0588 }),
        { declaredMime: "image/png" },
      );
      expect(inspectImageForMetadata(pngClean.bytes).hasGps).toBe(false);
      expect(inspectImageForMetadata(pngClean.bytes).hasExif).toBe(false);

      const vp8x = webpChunk("VP8X", [0x2c, 0, 0, 0, 1, 0, 0, 1, 0, 0]);
      const vp8 = webpChunk("VP8 ", [0x10, 0x20, 0x30, 0x40]);
      const exif = webpChunk("EXIF", asciiBytes("Exif\0\0GPS=36.7538"));
      const xmp = webpChunk(
        "XMP ",
        asciiBytes("<x:xmpmeta>secret</x:xmpmeta>"),
      );
      const body = [...asciiBytes("WEBP"), ...vp8x, ...vp8, ...exif, ...xmp];
      const riffLen = body.length;
      const webp = new Uint8Array([
        ...asciiBytes("RIFF"),
        riffLen & 0xff,
        (riffLen >> 8) & 0xff,
        (riffLen >> 16) & 0xff,
        (riffLen >> 24) & 0xff,
        ...body,
      ]);

      const webpClean = mod.validateAndStripReportPhoto(webp, {
        declaredMime: "image/webp",
      });
      const webpText = new TextDecoder("latin1").decode(webpClean.bytes);
      expect(webpText).not.toContain("36.7538");
      expect(webpText).not.toContain("secret");
      expect(webpClean.bytes[20]).toBe(0x20);
    });
  });

  describe("T5-08 & Turnstile SSRF: Auth destination & verifyUrl defenses", () => {
    it("ignores ?lang= inside #fragment and blocks open-redirect / CRLF payloads", async () => {
      const mod = await importRepoModule<{
        authDestination: (value: unknown) => string;
        extractLocaleFromDestination: (dest: string) => string | undefined;
        authRedirectSearch: (
          href: string,
          searchStr?: string,
        ) => { returnTo: string; lang?: string };
      }>("src/lib/auth-destination.ts");

      expect(
        mod.extractLocaleFromDestination("/alerts#section?lang=en"),
      ).toBeUndefined();
      expect(mod.authRedirectSearch("/alerts#section?lang=en")).toEqual({
        returnTo: "/alerts#section?lang=en",
      });
      expect(
        mod.extractLocaleFromDestination("/alerts?lang=ar#section?lang=en"),
      ).toBe("ar");
      expect(mod.authRedirectSearch("/alerts?lang=ar#section?lang=en")).toEqual(
        {
          returnTo: "/alerts?lang=ar#section?lang=en",
          lang: "ar",
        },
      );

      for (const hostile of [
        "//evil.com/zones",
        "/\\evil.com",
        "/zones\r\nSet-Cookie: a=1",
        "/admin/../auth",
      ]) {
        expect(mod.authDestination(hostile), hostile).toBe("/zones");
      }
    });

    it("rejects all 8 adversarial SSRF verifyUrl targets in Turnstile verifier without invoking fetch", async () => {
      const mod = await importRepoModule<{
        verifyTurnstileToken: (
          input: Record<string, unknown>,
        ) => Promise<{ ok: boolean; status?: number; reason?: string }>;
      }>("src/lib/turnstile.server.ts");

      const hostileUrls = [
        "http://[::ffff:127.0.0.1]/siteverify",
        "http://[::ffff:169.254.169.254]/latest/meta-data/",
        "http://0.0.0.0/siteverify",
        "http://127.0.0.2/siteverify",
        "http://localhost./siteverify",
        "http://user:pass@127.0.0.1/siteverify",
        "file:///etc/passwd",
        "https://evil.example/siteverify",
      ];

      let fetchCalls = 0;
      for (const verifyUrl of hostileUrls) {
        const result = await mod.verifyTurnstileToken({
          token: "valid-token-value",
          secretKey: "test-secret-key",
          verifyUrl,
          fetchImpl: async () => {
            fetchCalls += 1;
            return new Response("{}", { status: 200 });
          },
        });
        expect(result.ok, verifyUrl).toBe(false);
        expect(result.status, verifyUrl).toBe(503);
        expect(result.reason, verifyUrl).toBe("invalid_verify_url");
      }
      expect(fetchCalls).toBe(0);
    });
  });

  describe("T5-R2-01: Law 18-07 / Law 25-11 consent withdrawal for zone_alerts & citizen_reports", () => {
    it("enforces citizen_reports withdrawal & fail-closed checks in publishWaitingReports and handleReportPhotoUpload", async () => {
      const pubMod = await importRepoModule<{
        publishWaitingReports: (
          ids?: string[],
          deps?: Record<string, unknown>,
        ) => Promise<{ published: number; held: number; waiting: number }>;
      }>("src/lib/report-publication.server.ts");
      const photoMod = await importRepoModule<{
        handleReportPhotoUpload: (
          request: Request,
          overrides?: Record<string, unknown>,
        ) => Promise<Response>;
      }>("src/lib/report-photo.server.ts");

      let llmCalls = 0;
      const saved: Array<[string, Record<string, unknown>]> = [];
      const tally = await pubMod.publishWaitingReports(undefined, {
        store: {
          waiting: async () => [
            {
              id: "t5-r2-withdrawn",
              user_id: "5e020000-0000-4000-8000-000000000001",
              kind: "flooding",
              note: "water on road",
              commune_id: null,
            },
          ],
          withdrawnCitizenReportConsent: async () =>
            new Set(["5e020000-0000-4000-8000-000000000001"]),
          place: async () => null,
          save: async (id: string, patch: Record<string, unknown>) => {
            saved.push([id, patch]);
          },
        },
        classifier: {
          model: "test-model",
          complete: async () => {
            llmCalls += 1;
            return JSON.stringify({
              publishable: true,
              hazard: "flooding",
              summary: "Water",
              severity: 3,
              reason: "ok",
            });
          },
        },
        now: () => Date.parse("2026-11-25T15:00:00Z"),
      });
      expect(tally).toEqual({ published: 0, held: 1, waiting: 0 });
      expect(llmCalls).toBe(0);
      expect(saved[0]?.[1]?.["publish_state"]).toBe("held");
      expect(saved[0]?.[1]?.["classifier"]).toBe("consent_withdrawn");

      // Fail-closed on consent DB error in publishWaitingReports
      await expect(
        pubMod.publishWaitingReports(undefined, {
          store: {
            waiting: async () => [
              {
                id: "t5-r2-err",
                user_id: "5e020000-0000-4000-8000-000000000002",
                kind: "flooding",
                note: "water",
                commune_id: null,
              },
            ],
            withdrawnCitizenReportConsent: async () => {
              throw new Error("consent lookup failed");
            },
            place: async () => null,
            save: async () => undefined,
          },
          classifier: {
            model: "test-model",
            complete: async () => {
              llmCalls += 1;
              return "{}";
            },
          },
        }),
      ).rejects.toThrow("consent lookup failed");
      expect(llmCalls).toBe(0);

      // handleReportPhotoUpload: 403 on withdrawn, 503 fail-closed on DB error, 0 storage writes
      let uploads = 0;
      const makePhotoReq = () => {
        const form = new FormData();
        form.append(
          "file",
          new File(
            [
              Buffer.from(
                createJpegWithExif({ latitude: 36.75, longitude: 3.05 }),
              ),
            ],
            "photo.jpg",
            { type: "image/jpeg" },
          ),
        );
        return new Request("http://127.0.0.1:4173/api/private/report-photo", {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
          body: form,
        });
      };

      const photoWithdrawn = await photoMod.handleReportPhotoUpload(
        makePhotoReq(),
        {
          getUser: async () => ({
            data: { user: { id: "5e020000-0000-4000-8000-000000000001" } },
            error: null,
          }),
          consumeRateLimit: async () => ({ data: true, error: null }),
          hasWithdrawnCitizenReportsConsent: async () => ({
            withdrawn: true,
            error: null,
          }),
          uploadObject: async () => {
            uploads += 1;
            return { error: null };
          },
          randomUuid: () => "11111111-1111-4111-8111-111111111199",
        },
      );
      expect(photoWithdrawn.status).toBe(403);
      expect(await photoWithdrawn.json()).toEqual({
        error: "consent_withdrawn",
      });

      const photoErr = await photoMod.handleReportPhotoUpload(makePhotoReq(), {
        getUser: async () => ({
          data: { user: { id: "5e020000-0000-4000-8000-000000000001" } },
          error: null,
        }),
        consumeRateLimit: async () => ({ data: true, error: null }),
        hasWithdrawnCitizenReportsConsent: async () => ({
          withdrawn: false,
          error: { message: "db error" },
        }),
        uploadObject: async () => {
          uploads += 1;
          return { error: null };
        },
        randomUuid: () => "11111111-1111-4111-8111-111111111198",
      });
      expect(photoErr.status).toBe(503);
      expect(await photoErr.json()).toEqual({
        error: "consent_unavailable",
      });
      expect(uploads).toBe(0);
    });

    it("enforces zone_alerts and citizen_reports withdrawal end-to-end against live local Supabase & HTTP APIs with zero DB residue", async () => {
      assertPgReachable();
      const supaMod = await importRepoModule<{
        supabaseAdmin: {
          auth: {
            admin: {
              createUser: (args: {
                email: string;
                password: string;
                email_confirm: boolean;
              }) => Promise<{
                data: { user: { id: string } | null };
                error: { message: string } | null;
              }>;
              deleteUser: (id: string) => Promise<{ error: unknown }>;
            };
          };
          from: (table: string) => {
            insert: (
              row: Record<string, unknown>,
            ) => Promise<{ error: { message: string } | null }>;
            delete: () => {
              eq: (col: string, val: string) => Promise<{ error: unknown }>;
              in: (col: string, vals: string[]) => Promise<{ error: unknown }>;
            };
          };
        };
      }>("src/integrations/supabase/client.server.ts");
      const alertsMod = await importRepoModule<{
        evaluateAlerts: (userId?: string) => Promise<{
          evaluated: number;
          created: number;
          suppressed: number;
        }>;
      }>("src/lib/alerts-engine.server.ts");

      const email = `t5-r2-consent-${Date.now()}@example.invalid`;
      const password = "TestPassword#2026!";
      const created = await supaMod.supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      const userId = created.data.user!.id;

      try {
        // Sign in against local Supabase GoTrue to get a real JWT
        const supaUrl =
          process.env["E2E_SUPABASE_URL"] ??
          process.env["SUPABASE_URL"] ??
          "http://127.0.0.1:54321";
        const publishableKey =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ??
          process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
          "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
        const tokenRes = await fetch(
          `${supaUrl}/auth/v1/token?grant_type=password`,
          {
            method: "POST",
            headers: {
              apikey: publishableKey,
              "content-type": "application/json",
            },
            body: JSON.stringify({ email, password }),
          },
        );
        expect(tokenRes.status).toBe(200);
        const tokenBody = (await tokenRes.json()) as { access_token: string };
        const bearer = tokenBody.access_token;

        // Seed an active watch zone + withdrawn consents for zone_alerts & citizen_reports
        const zoneInsert = await supaMod.supabaseAdmin.from("zones").insert({
          user_id: userId,
          name: "T5-R2 Watch Zone",
          lat: 36.7538,
          lon: 3.0588,
          radius_km: 15,
          active: true,
        });
        expect(zoneInsert.error).toBeNull();

        const consentZone = await supaMod.supabaseAdmin
          .from("privacy_consents")
          .insert({
            user_id: userId,
            consent_type: "zone_alerts",
            policy_version: "2026-11-25",
            status: "withdrawn",
            withdrawn_at: new Date().toISOString(),
            locale: "fr",
            source_surface: "settings",
          });
        expect(consentZone.error).toBeNull();

        const consentReport = await supaMod.supabaseAdmin
          .from("privacy_consents")
          .insert({
            user_id: userId,
            consent_type: "citizen_reports",
            policy_version: "2026-11-25",
            status: "withdrawn",
            withdrawn_at: new Date().toISOString(),
            locale: "fr",
            source_surface: "settings",
          });
        expect(consentReport.error).toBeNull();

        // 1. evaluateAlerts must skip the withdrawn user's active watch zone completely
        const evalRes = await alertsMod.evaluateAlerts(userId);
        expect(evalRes).toEqual({ evaluated: 0, created: 0, suppressed: 0 });

        // 2. Live POST /api/private/report-publish must return 403 { error: "consent_withdrawn" }
        const publishRes = await fetchText("/api/private/report-publish", {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearer}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ id: "3c100000-0000-4000-8000-000000000001" }),
        });
        expect(publishRes.status).toBe(403);
        expect(JSON.parse(publishRes.text)).toEqual({
          error: "consent_withdrawn",
        });

        // 3. Live POST /api/private/report-photo must return 403 { error: "consent_withdrawn" }
        const photoForm = new FormData();
        photoForm.append(
          "file",
          new File(
            [
              Buffer.from(
                createJpegWithExif({ latitude: 36.75, longitude: 3.05 }),
              ),
            ],
            "report.jpg",
            { type: "image/jpeg" },
          ),
        );
        const photoRes = await fetchText("/api/private/report-photo", {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}` },
          body: photoForm,
        });
        expect(photoRes.status).toBe(403);
        expect(JSON.parse(photoRes.text)).toEqual({
          error: "consent_withdrawn",
        });
      } finally {
        psqlQuery(
          `DELETE FROM private.api_rate_limit WHERE bucket IN ('report-publish:${userId}', 'report-photo:${userId}');`,
        );
        await supaMod.supabaseAdmin.auth.admin.deleteUser(userId);
      }
    });
  });

  describe("T5-R2-02: Public contribute & subscribe null guards and bounded JSON body reads", () => {
    it("rejects rows: [null], JSON null body, and oversized payloads cleanly without HTTP 500 crashes", async () => {
      // 1. Live POST /api/public/contribute/translation with rows: [null] -> 400 (no TypeError 500)
      const nullRowRes = await fetchText("/api/public/contribute/translation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale: "fr",
          reviewerKey: "reviewer12345",
          rows: [null],
        }),
      });
      expect(nullRowRes.status).toBe(400);

      // 2. Live POST /api/public/contribute/my-translations with JSON null body -> 400 (no TypeError 500)
      const myTransNull = await fetchText(
        "/api/public/contribute/my-translations",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "null",
        },
      );
      expect(myTransNull.status).toBe(400);

      // 3. Live oversized payloads (>16 KiB on idea/vote/my-translations; >128 KiB on translation) -> 413
      const big16k = JSON.stringify({
        locale: "fr",
        reviewerKey: "k".repeat(20_000),
      });
      expect(
        (
          await fetchText("/api/public/contribute/my-translations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: big16k,
          })
        ).status,
      ).toBe(413);
      expect(
        (
          await fetchText("/api/public/contribute/idea", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: big16k,
          })
        ).status,
      ).toBe(413);
      expect(
        (
          await fetchText("/api/public/contribute/vote", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: big16k,
          })
        ).status,
      ).toBe(413);
      expect(
        (
          await fetchText("/api/public/contribute/translation", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              locale: "fr",
              reviewerKey: "reviewer12345",
              rows: [{ keyPath: "a", suggestion: "x".repeat(140_000) }],
            }),
          })
        ).status,
      ).toBe(413);
    });
  });
});
