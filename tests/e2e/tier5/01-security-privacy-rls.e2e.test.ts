import { describe, expect, it } from "vitest";

import { importRepoModule } from "../lib/env.ts";
import {
  createJpegWithExif,
  createPngWithExif,
  inspectImageForMetadata,
} from "../lib/exif.ts";
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
});
