import { describe, expect, it } from "vitest";
import {
  importRepoModule,
  listRepoFiles,
  readRepoFile,
  readRepoJson,
  repoFileExists,
} from "../lib/env.ts";
import { startMockHttpServer } from "../lib/http.ts";
import { assertPgReachable, psqlJson, runInRolledBackTx } from "../lib/pg.ts";

describe("Tier 2 Boundaries — F1–F6: Branch Safety, Invariants, EU Worker, LLM Fallback, Cold Archive & Android Readiness", () => {
  // ---------------------------------------------------------------------------
  // F1: Clean Branch Sync, Migration Hygiene & Postgres Privilege Boundaries
  // ---------------------------------------------------------------------------
  describe("F1 — Branch Preservation, Migration Timestamps & Postgres Privilege Boundaries", () => {
    it("Edge Case #1: preserves pre-existing local audit & handoff files without loss alongside origin/main audits", () => {
      const requiredPreservedFiles = [
        "QA_AUDIT.md",
        ".agent/runs/handoff-native-store-readiness.md",
        ".agent/runs/handoff-store-publication.md",
        "docs/audits/2026-09-09-platform-audit.md",
        "docs/audits/2026-09-09-navigation-review.md",
      ];

      for (const relPath of requiredPreservedFiles) {
        expect(
          repoFileExists(relPath),
          `Expected preserved file to exist: ${relPath}`,
        ).toBe(true);
        const content = readRepoFile(relPath);
        expect(content.trim().length).toBeGreaterThan(20);
      }
    });

    it("Edge Case #10: enforces unique 14-digit migration version prefixes across all supabase/migrations/*.sql files", () => {
      const migrationFiles = listRepoFiles("supabase/migrations", ".sql");
      expect(migrationFiles.length).toBeGreaterThan(20);

      const seenVersions = new Map<string, string>();
      const duplicates: string[] = [];
      const malformed: string[] = [];

      for (const relPath of migrationFiles) {
        const filename = relPath.split("/").at(-1) ?? "";
        const match = /^(\d{14})_[a-z0-9_-]+\.sql$/i.exec(filename);
        if (!match || !match[1]) {
          malformed.push(filename);
          continue;
        }
        const version = match[1];
        const previous = seenVersions.get(version);
        if (previous) {
          duplicates.push(`${version}: ${previous} vs ${filename}`);
        } else {
          seenVersions.set(version, filename);
        }
      }

      expect(
        malformed,
        `Malformed migration filenames: ${malformed.join(", ")}`,
      ).toEqual([]);
      expect(
        duplicates,
        `Duplicate migration timestamp prefixes found: ${duplicates.join("; ")}`,
      ).toEqual([]);
    });

    it("keeps personal Nadhir boundary free of Paraito Hub / carte references across changed code & migrations", () => {
      const scannedDirs = ["src", "worker", "scripts", "supabase/migrations"];
      const forbiddenPattern = /\b(paraito|paraito-hub|paraito_hub)\b/i;
      const hits: string[] = [];

      for (const dir of scannedDirs) {
        for (const relPath of listRepoFiles(dir)) {
          if (
            !relPath.endsWith(".ts") &&
            !relPath.endsWith(".tsx") &&
            !relPath.endsWith(".sql") &&
            !relPath.endsWith(".js") &&
            !relPath.endsWith(".mjs")
          ) {
            continue;
          }
          const content = readRepoFile(relPath);
          if (forbiddenPattern.test(content)) {
            hits.push(relPath);
          }
        }
      }

      expect(
        hits,
        `Forbidden Paraito references found in: ${hits.join(", ")}`,
      ).toEqual([]);
    });

    it("Edge Case #9 (static): every new 20261124* migration function explicitly revokes EXECUTE from PUBLIC, anon, and authenticated", () => {
      const newMigrations = listRepoFiles("supabase/migrations", ".sql").filter(
        (rel) => /\/20261124\d{6}_/.test(rel),
      );
      expect(
        newMigrations.length,
        "Expected at least one 20261124* roadmap migration",
      ).toBeGreaterThan(0);

      const violations: string[] = [];
      const createFnRe =
        /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+\s*\([^)]*\))/gi;

      for (const relPath of newMigrations) {
        const sql = readRepoFile(relPath);
        let match = createFnRe.exec(sql);
        while (match !== null) {
          const fnSig = match[1]?.replace(/\s+/g, " ").trim() ?? "unknown";
          // Trigger functions returning trigger are not directly callable via RPC; check non-trigger functions.
          const afterSig = sql.slice(match.index, match.index + 320);
          const isTriggerFn = /returns\s+trigger\b/i.test(afterSig);
          if (!isTriggerFn) {
            const fnBaseName =
              fnSig.split("(")[0]?.replace(/"/g, "").trim() ?? "";
            const escapedName = fnBaseName.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );
            const revokeRe = new RegExp(
              `revoke\\s+(?:all|execute)\\s+on\\s+function\\s+(?:[^;]*?,\\s*)?${escapedName}\\s*\\([^;]*from\\s+([^;]+);`,
              "gi",
            );
            const revokeMatches = Array.from(sql.matchAll(revokeRe));
            const revokesAllThree = revokeMatches.some((m) => {
              const target = (m[1] ?? "").toLowerCase();
              return (
                /\bpublic\b/.test(target) &&
                /\banon\b/.test(target) &&
                /\bauthenticated\b/.test(target)
              );
            });
            if (!revokesAllThree) {
              violations.push(`${relPath}: ${fnSig}`);
            }
          }
          match = createFnRe.exec(sql);
        }
      }

      expect(
        violations,
        `Functions missing explicit REVOKE ... FROM PUBLIC, anon, authenticated: ${violations.join("; ")}`,
      ).toEqual([]);
    });

    it("Edge Case #9 (live Postgres): anon and authenticated roles cannot execute privileged cold-archive or source-job functions", () => {
      assertPgReachable();

      const rows = psqlJson<{
        signature: string;
        anon_exec: boolean;
        auth_exec: boolean;
      }>(`
        SELECT
          (n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')') AS signature,
          has_function_privilege('anon', p.oid, 'execute') AS anon_exec,
          has_function_privilege('authenticated', p.oid, 'execute') AS auth_exec
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE (n.nspname = 'public' AND p.proname IN (
          'cold_archive_commit',
          'cold_pending_days',
          'claim_source_job',
          'complete_source_job'
        ))
           OR (n.nspname = 'private' AND p.proname IN (
          'cold_candidates',
          'cold_archived'
        ))
        ORDER BY signature
      `);

      expect(rows.length).toBeGreaterThanOrEqual(4);
      const exposed = rows.filter((r) => r.anon_exec || r.auth_exec);
      expect(
        exposed,
        `Privileged functions executable by anon/authenticated: ${JSON.stringify(exposed)}`,
      ).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // F2: Safety, Legal, PostgREST Pagination, Auth Redirect & I18N Boundaries
  // ---------------------------------------------------------------------------
  describe("F2 — PostgREST 1,000-Row Cap, Auth Redirect, Arabic Plurals & ADR-0001/0003 Boundaries", () => {
    it("Edge Case #11: fetchAllPages handles exact 0, 999, 1000, 1001, and 1537-row commune boundaries without silent truncation", async () => {
      const paginateMod = await importRepoModule<{
        PAGE_SIZE: number;
        fetchAllPages: <T>(
          page: (
            from: number,
            to: number,
          ) => Promise<{ data: T[] | null; error: { message: string } | null }>,
          maxPages?: number,
        ) => Promise<T[]>;
      }>("src/lib/paginate.ts");

      expect(paginateMod.PAGE_SIZE).toBe(1000);

      for (const totalRows of [0, 999, 1000, 1001, 1537]) {
        const dataset = Array.from({ length: totalRows }, (_, i) => ({
          id: `commune-${String(i + 1).padStart(4, "0")}`,
        }));
        const pageRanges: Array<[number, number]> = [];
        const fetched = await paginateMod.fetchAllPages(async (from, to) => {
          pageRanges.push([from, to]);
          return { data: dataset.slice(from, to + 1), error: null };
        });

        expect(fetched.length).toBe(totalRows);
        if (totalRows === 1000) {
          // Exact multiple of 1,000 must probe page 2 to confirm exhaustion.
          expect(pageRanges).toEqual([
            [0, 999],
            [1000, 1999],
          ]);
        } else if (totalRows === 1537) {
          expect(pageRanges).toEqual([
            [0, 999],
            [1000, 1999],
          ]);
          expect(fetched[1536]?.id).toBe("commune-1537");
        }
      }

      // Mid-pagination PostgREST error must throw rather than returning partial 1,000 rows.
      await expect(
        paginateMod.fetchAllPages(async (from) => {
          if (from === 0) {
            return {
              data: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
              error: null,
            };
          }
          return { data: null, error: { message: "statement timeout" } };
        }),
      ).rejects.toThrow(/statement timeout/);
    });

    it("Edge Case #11 (static): code querying admin_units never uses unbounded .limit(>1000) instead of fetchAllPages", () => {
      const files = [
        ...listRepoFiles("src/lib", ".ts"),
        ...listRepoFiles("worker", ".ts"),
      ].filter((f) => !f.includes("__tests__") && !f.endsWith(".test.ts"));

      const unboundedHits: string[] = [];
      const adminLimitRe =
        /\.from\(\s*["']admin_units["']\s*\)[\s\S]{0,400}?\.limit\(\s*(\d+)\s*\)/g;

      for (const relPath of files) {
        const source = readRepoFile(relPath);
        let m = adminLimitRe.exec(source);
        while (m !== null) {
          const limitVal = Number(m[1]);
          if (limitVal > 1000) {
            unboundedHits.push(`${relPath}: .limit(${limitVal})`);
          }
          m = adminLimitRe.exec(source);
        }
      }

      expect(
        unboundedHits,
        `Unbounded admin_units .limit(>1000) calls that silently truncate at PostgREST 1000 cap: ${unboundedHits.join(", ")}`,
      ).toEqual([]);
    });

    it("antislop R-26: authDestination rejects protocol-relative //evil.example, backslash, scheme, and control-char open redirects", async () => {
      const authDestMod = await importRepoModule<{
        authDestination: (value: unknown) => string;
      }>("src/lib/auth-destination.ts");

      const maliciousInputs: unknown[] = [
        "//evil.example",
        "//evil.example/zones",
        "/\\evil.example",
        "https://evil.example/zones",
        "javascript:alert(1)",
        "/zones\r\nSet-Cookie: pwn=1",
        "/zones\x00/admin",
        "/unknown-open-path",
        null,
        undefined,
        123,
      ];

      for (const bad of maliciousInputs) {
        expect(
          authDestMod.authDestination(bad),
          `Expected "${String(bad)}" to fall back to /zones`,
        ).toBe("/zones");
      }

      // Valid destinations including "/" with query string must be preserved.
      expect(authDestMod.authDestination("/?lang=ar&commune=1601")).toBe(
        "/?lang=ar&commune=1601",
      );
      expect(authDestMod.authDestination("/alerts?tab=official")).toBe(
        "/alerts?tab=official",
      );
      expect(authDestMod.authDestination("/settings")).toBe("/settings");
    });

    it("Arabic plural edge cases (counts 0, 1, 2, 3, 11, 100) across ar, fr, en, kab never emit raw keys or undefined", async () => {
      const i18nMod = await importRepoModule<{
        default: {
          getFixedT: (
            lng: string,
          ) => (key: string, opts?: Record<string, unknown>) => string;
          hasResourceBundle: (lng: string, ns: string) => boolean;
          getResourceBundle: (
            lng: string,
            ns: string,
          ) => Record<string, unknown>;
        };
      }>("src/i18n/index.ts");

      const i18n = i18nMod.default;
      const arBundle = i18n.getResourceBundle("ar", "translation");

      // Collect keys that define Arabic plural variants (_zero, _one, _two, _few, _many, _other).
      const pluralBases = new Set<string>();
      const walk = (node: unknown, prefix: string): void => {
        if (!node || typeof node !== "object" || Array.isArray(node)) return;
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          const full = prefix ? `${prefix}.${k}` : k;
          if (typeof v === "string") {
            const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(full);
            if (m && m[1]) {
              pluralBases.add(m[1]);
            }
          } else {
            walk(v, full);
          }
        }
      };
      walk(arBundle, "");
      expect(pluralBases.size).toBeGreaterThan(0);

      const sampleCounts = [0, 1, 2, 3, 11, 100];
      const locales = ["ar", "fr", "en", "kab"] as const;
      const sampleBases = Array.from(pluralBases).slice(0, 15);

      for (const locale of locales) {
        const t = i18n.getFixedT(locale);
        for (const baseKey of sampleBases) {
          for (const count of sampleCounts) {
            const rendered = t(baseKey, { count });
            expect(
              rendered,
              `Empty plural for ${locale}:${baseKey} count=${count}`,
            ).toBeTruthy();
            expect(rendered).not.toBe(baseKey);
            expect(rendered).not.toContain("undefined");
            expect(rendered).not.toContain("NaN");
          }
        }
      }
    });

    it("ADR-0001 boundary: zero PostGIS geometry/geography columns or ST_ spatial calls in roadmap migrations or lib code", () => {
      const newMigrations = listRepoFiles("supabase/migrations", ".sql").filter(
        (rel) => /\/20261124\d{6}_/.test(rel),
      );
      const postgisRe =
        /\b(geography|geometry)\s*\(|\bST_[A-Z][A-Za-z0-9_]*\s*\(|create\s+extension[^;]*postgis/i;
      const hits: string[] = [];

      for (const relPath of newMigrations) {
        const sql = readRepoFile(relPath);
        if (postgisRe.test(sql)) {
          hits.push(relPath);
        }
      }

      expect(
        hits,
        `ADR-0001 violation (PostGIS found in migrations): ${hits.join(", ")}`,
      ).toEqual([]);
    });

    it("ADR-0003 & CONTEXT.md boundary: locale files contain zero forbidden evacuation-routing or Guardian/emergency-mode labels", () => {
      const localeFiles = [
        ...listRepoFiles("src/i18n/locales", ".ts"),
        ...listRepoFiles("src/i18n/modules", ".ts"),
      ];
      expect(localeFiles.length).toBeGreaterThanOrEqual(4);

      const forbiddenCopyRe =
        /\b(safest route|evacuation route|turn-by-turn evacuation|safe zone|safe area|emergency mode)\b/i;
      const violations: string[] = [];

      for (const relPath of localeFiles) {
        const content = readRepoFile(relPath);
        const match = forbiddenCopyRe.exec(content);
        if (match) {
          violations.push(`${relPath}: "${match[0]}"`);
        }
      }

      expect(
        violations,
        `Forbidden ADR-0002/0003 copy detected in locales: ${violations.join("; ")}`,
      ).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // F3: Standalone Always-On EU Backend Worker Boundaries
  // ---------------------------------------------------------------------------
  describe("F3 — EU Backend Worker & source_jobs Queue Boundaries", () => {
    it("rejects invalid execution_target strings in isSourceExecutionTarget and sourceJobFromRow", async () => {
      const sjMod = await importRepoModule<{
        isSourceExecutionTarget: (value: string) => boolean;
        sourceJobFromRow: (row: Record<string, unknown>) => unknown;
      }>("src/lib/source-jobs.ts");

      expect(sjMod.isSourceExecutionTarget("worker")).toBe(true);
      expect(sjMod.isSourceExecutionTarget("cloudflare")).toBe(true);
      expect(sjMod.isSourceExecutionTarget("github")).toBe(true);

      for (const invalid of [
        "",
        "lambda",
        "home-m2",
        "WORKER",
        "eu_worker",
        "__proto__",
      ]) {
        expect(sjMod.isSourceExecutionTarget(invalid)).toBe(false);
        expect(() =>
          sjMod.sourceJobFromRow({
            id: "00000000-0000-4000-8000-000000000001",
            execution_target: invalid,
            state: "queued",
            trigger_kind: "scheduled",
          }),
        ).toThrow(/invalid execution target/i);
      }
    });

    it("live Postgres: source_jobs CHECK constraint accepts 'worker' and rejects invalid execution_target with 23514", () => {
      assertPgReachable();

      const result = runInRolledBackTx(`
        INSERT INTO public.source_contracts (
          key, version, label, family, criticality, freshness_basis,
          cadence_minutes, warning_after_minutes, stale_after_minutes,
          parser_version, licence, attribution, owner, execution_target
        ) VALUES (
          'e2e.worker.target', 1, 'E2E Worker Target', 'reference_enrichment', 'optional', 'last_success_at',
          5, 10, 20, '1', 'test', 'test', 'test', 'worker'
        );

        DO $$
        DECLARE
          bad_rejected boolean := false;
        BEGIN
          BEGIN
            INSERT INTO public.source_jobs (
              contract_key, contract_version, execution_target, trigger_kind,
              idempotency_key, scheduled_for, data_from, data_through,
              state, max_attempts, retry_base_seconds, retry_until
            ) VALUES (
              'e2e.worker.target', 1, 'invalid_eu_target', 'manual',
              'e2e-bad-target-1', now(), now() - interval '10 minutes', now(),
              'queued', 3, 30, now() + interval '1 hour'
            );
          EXCEPTION WHEN check_violation THEN
            bad_rejected := true;
          END;
          IF NOT bad_rejected THEN
            RAISE EXCEPTION 'expected check_violation for invalid execution_target';
          END IF;
        END $$;

        INSERT INTO public.source_jobs (
          contract_key, contract_version, execution_target, trigger_kind,
          idempotency_key, scheduled_for, data_from, data_through,
          state, max_attempts, retry_base_seconds, retry_until
        ) VALUES (
          'e2e.worker.target', 1, 'worker', 'manual',
          'e2e-valid-worker-target-1', now(), now() - interval '10 minutes', now(),
          'queued', 3, 30, now() + interval '1 hour'
        );

        SELECT count(*)::text FROM public.source_jobs WHERE idempotency_key = 'e2e-valid-worker-target-1';
      `);

      expect(result.split("\n").at(-1)?.trim()).toBe("1");
    });

    it("claimedSourceJobFromRow rejects non-running jobs or running jobs missing started_at to prevent ghost execution", async () => {
      const sjMod = await importRepoModule<{
        claimedSourceJobFromRow: (row: Record<string, unknown>) => unknown;
      }>("src/lib/source-jobs.ts");

      for (const badState of ["queued", "retry_wait", "succeeded", "failed"]) {
        expect(() =>
          sjMod.claimedSourceJobFromRow({
            id: "00000000-0000-4000-8000-000000000002",
            execution_target: "worker",
            state: badState,
            trigger_kind: "scheduled",
            started_at: "2026-11-24T12:00:00Z",
          }),
        ).toThrow(/active attempt/i);
      }

      expect(() =>
        sjMod.claimedSourceJobFromRow({
          id: "00000000-0000-4000-8000-000000000003",
          execution_target: "worker",
          state: "running",
          trigger_kind: "scheduled",
          started_at: null,
        }),
      ).toThrow(/active attempt/i);
    });

    it("retryDispositionForReason separates permanent config/schema errors from transient upstream errors", async () => {
      const sjMod = await importRepoModule<{
        retryDispositionForReason: (reason: string) => string;
      }>("src/lib/source-jobs.ts");

      for (const permanent of [
        "credentials_missing",
        "licence_invalid",
        "schema_invalid",
        "disabled",
      ]) {
        expect(sjMod.retryDispositionForReason(permanent)).toBe("permanent");
      }

      for (const transient of [
        "upstream_unreachable",
        "data_delayed",
        "coverage_partial",
        "dependency_failed",
        "delivery_failed",
        "internal_error",
      ]) {
        expect(sjMod.retryDispositionForReason(transient)).toBe("transient");
      }
    });

    it("live Postgres: claim_source_job enforces active lease fencing and prevents double-claiming while leased, then allows reclaim after lease expiry", () => {
      assertPgReachable();

      const output = runInRolledBackTx(`
        INSERT INTO public.source_contracts (
          key, version, label, family, criticality, freshness_basis,
          cadence_minutes, warning_after_minutes, stale_after_minutes,
          parser_version, licence, attribution, owner, execution_target,
          lease_seconds, max_attempts
        ) VALUES (
          'e2e.worker.lease', 1, 'E2E Lease', 'reference_enrichment', 'optional', 'last_success_at',
          5, 10, 20, '1', 'test', 'test', 'test', 'worker', 60, 2
        );

        INSERT INTO public.source_jobs (
          id, contract_key, contract_version, execution_target, trigger_kind,
          idempotency_key, scheduled_for, data_from, data_through,
          available_at, state, max_attempts, retry_base_seconds, retry_until
        ) VALUES (
          '30000000-0000-4000-8000-000000000001',
          'e2e.worker.lease', 1, 'worker', 'manual',
          'e2e-lease-1',
          '2026-11-24T12:00:00Z'::timestamptz,
          '2026-11-24T11:50:00Z'::timestamptz,
          '2026-11-24T12:00:00Z'::timestamptz,
          '2026-11-24T12:00:00Z'::timestamptz,
          'queued', 2, 30, '2026-11-24T13:00:00Z'::timestamptz
        );

        -- First claim acquires the lease (attempt 1; lease_seconds = 60 -> expires at 12:01:05Z)
        CREATE TEMP TABLE e2e_claim1 AS
        SELECT * FROM public.claim_source_job(
          'e2e-worker-a', 'worker', 'e2e.worker.lease', '2026-11-24T12:00:05Z'::timestamptz
        )
        WHERE id = '30000000-0000-4000-8000-000000000001';

        -- Sequential second claim by another worker must NOT double-claim the leased job
        CREATE TEMP TABLE e2e_claim2 AS
        SELECT * FROM public.claim_source_job(
          'e2e-worker-b', 'worker', 'e2e.worker.lease', '2026-11-24T12:00:10Z'::timestamptz
        )
        WHERE id = '30000000-0000-4000-8000-000000000001';

        SELECT (SELECT count(*) FROM e2e_claim1)::text || ',' || (SELECT count(*) FROM e2e_claim2)::text;

        -- Requeue expired lease after 12:01:05Z and verify reclaim increments attempts up to max_attempts
        DO $$
        BEGIN
          PERFORM private.requeue_expired_source_jobs('2026-11-24T12:01:10Z'::timestamptz);
        END $$;

        CREATE TEMP TABLE e2e_reclaim AS
        SELECT * FROM public.claim_source_job(
          'e2e-worker-b', 'worker', 'e2e.worker.lease', '2026-11-24T12:05:00Z'::timestamptz
        )
        WHERE id = '30000000-0000-4000-8000-000000000001';

        SELECT count(*)::text || ':' || coalesce(max(attempt_count)::text, '0')
          FROM e2e_reclaim;
      `);

      const lines = output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      expect(lines).toContain("1,0");
      expect(lines.at(-1)).toBe("1:2");
    });

    it("EU backend worker directory ships standalone runtime & EU deployment artifacts with zero hardcoded secrets", () => {
      const workerFiles = listRepoFiles("worker");
      expect(
        workerFiles.length,
        "Expected standalone EU backend worker files under worker/",
      ).toBeGreaterThan(0);

      const hasDockerfile = workerFiles.some((f) => /dockerfile/i.test(f));
      const hasComposeOrDeploy = workerFiles.some((f) =>
        /(docker-compose|fly\.toml|systemd|\.service)/i.test(f),
      );
      const hasTsSource = workerFiles.some((f) => f.endsWith(".ts"));

      expect(hasDockerfile || hasComposeOrDeploy).toBe(true);
      expect(hasTsSource).toBe(true);

      const secretLiteralRe =
        /(sk-[a-zA-Z0-9]{24,}|sk-ant-[a-zA-Z0-9-]{20,}|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]{30,})/;
      for (const relPath of workerFiles) {
        if (relPath.endsWith(".png") || relPath.endsWith(".jpg")) continue;
        const text = readRepoFile(relPath);
        expect(
          secretLiteralRe.test(text),
          `Hardcoded secret detected in ${relPath}`,
        ).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // F4: Automatic LLM API Fallback & GatewayPending Boundaries (Edge Case #15)
  // ---------------------------------------------------------------------------
  describe("F4 — Automatic LLM API Fallback, Circuit Breaker & GatewayPending Boundaries", () => {
    const sampleRequest = {
      messages: [
        { role: "system" as const, content: "Extract Algerian hazard info." },
        { role: "user" as const, content: "Inondation à Bab El Oued, Alger." },
      ],
      response_format: {
        type: "json_schema" as const,
        json_schema: {
          name: "hazard_extraction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              hazard: { type: "string" },
            },
            required: ["hazard"],
          },
        },
      },
    };

    it("Edge Case #15: primary gateway timeout triggers automatic fallback cleanly with structured provenance", async () => {
      const gatewayMod = await importRepoModule<{
        completeWithGatewayResult: (
          purpose: string,
          request: unknown,
          options: Record<string, unknown>,
        ) => Promise<{
          text: string;
          provenance: {
            fallbackUsed: boolean;
            primaryErrorKind: string | null;
            providerId: string;
          };
        }>;
      }>("src/lib/llm/gateway.server.ts");

      const primaryServer = await startMockHttpServer(async () => {
        await new Promise((resolve) => setTimeout(resolve, 750));
        return {
          status: 200,
          body: JSON.stringify({ text: '{"hazard":"late"}' }),
        };
      });
      const fallbackServer = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          choices: [{ message: { content: '{"hazard":"flood"}' } }],
        }),
      }));

      try {
        const result = await gatewayMod.completeWithGatewayResult(
          "extract_dgpc",
          sampleRequest,
          {
            timeoutMs: 120,
            circuitBreaker: null,
            config: {
              url: primaryServer.url,
              clientId: "cid",
              clientSecret: "csecret",
            },
            fallback: [
              {
                id: "eu-mistral-mock",
                provider: "openai-compatible",
                apiUrl: `${fallbackServer.url}/v1/chat/completions`,
                apiKey: "test-fallback-key",
                model: "mistral-small-latest",
                timeoutMs: 2_000,
              },
            ],
          },
        );

        expect(JSON.parse(result.text)).toEqual({ hazard: "flood" });
        expect(result.provenance.fallbackUsed).toBe(true);
        expect(result.provenance.primaryErrorKind).toBe("timeout");
        expect(result.provenance.providerId).toBe("eu-mistral-mock");
        expect(fallbackServer.requests.length).toBe(1);
      } finally {
        await primaryServer.close();
        await fallbackServer.close();
      }
    });

    it("Edge Case #15: primary HTTP 429 and HTTP 503 both fail over to fallback without breaking extraction", async () => {
      const gatewayMod = await importRepoModule<{
        completeWithGatewayResult: (
          purpose: string,
          request: unknown,
          options: Record<string, unknown>,
        ) => Promise<{
          text: string;
          provenance: {
            fallbackUsed: boolean;
            primaryErrorKind: string | null;
          };
        }>;
      }>("src/lib/llm/gateway.server.ts");

      const fallbackServer = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          choices: [{ message: { content: '{"hazard":"storm"}' } }],
        }),
      }));

      const primary429 = await startMockHttpServer(() => ({
        status: 429,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "rate_limited", retry_after: 30 }),
      }));

      const primary503 = await startMockHttpServer(() => ({
        status: 503,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "upstream" }),
      }));

      try {
        const fbConfig = [
          {
            id: "eu-fallback",
            provider: "openai-compatible",
            apiUrl: `${fallbackServer.url}/v1/chat/completions`,
            apiKey: "fb-secret-token",
            model: "eu-model",
            timeoutMs: 2_000,
          },
        ];

        const res429 = await gatewayMod.completeWithGatewayResult(
          "extract_ita",
          sampleRequest,
          {
            circuitBreaker: null,
            config: { url: primary429.url, clientId: "c", clientSecret: "s" },
            fallback: fbConfig,
          },
        );
        expect(res429.provenance.fallbackUsed).toBe(true);
        expect(res429.provenance.primaryErrorKind).toBe("rate_limited");
        expect(JSON.parse(res429.text)).toEqual({ hazard: "storm" });

        const res503 = await gatewayMod.completeWithGatewayResult(
          "extract_ita",
          sampleRequest,
          {
            circuitBreaker: null,
            config: { url: primary503.url, clientId: "c", clientSecret: "s" },
            fallback: fbConfig,
          },
        );
        expect(res503.provenance.fallbackUsed).toBe(true);
        expect(res503.provenance.primaryErrorKind).toBe("upstream_5xx");
        expect(JSON.parse(res503.text)).toEqual({ hazard: "storm" });
      } finally {
        await primary429.close();
        await primary503.close();
        await fallbackServer.close();
      }
    });

    it("Edge Case #15: primary HTTP 200 with malformed payload (non-string text) triggers failover cleanly", async () => {
      const gatewayMod = await importRepoModule<{
        completeWithGatewayResult: (
          purpose: string,
          request: unknown,
          options: Record<string, unknown>,
        ) => Promise<{
          text: string;
          provenance: {
            fallbackUsed: boolean;
            primaryErrorKind: string | null;
          };
        }>;
      }>("src/lib/llm/gateway.server.ts");

      const primaryMalformed = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: { broken: true } }),
      }));
      const fallbackServer = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          choices: [{ message: { content: '{"hazard":"road"}' } }],
        }),
      }));

      try {
        const res = await gatewayMod.completeWithGatewayResult(
          "classify_report",
          sampleRequest,
          {
            circuitBreaker: null,
            config: {
              url: primaryMalformed.url,
              clientId: "cid",
              clientSecret: "csec",
            },
            fallback: [
              {
                id: "fb-clean",
                provider: "openai-compatible",
                apiUrl: `${fallbackServer.url}/v1/chat/completions`,
                apiKey: "key-1",
                model: "model-1",
                timeoutMs: 2_000,
              },
            ],
          },
        );
        expect(res.provenance.fallbackUsed).toBe(true);
        expect(res.provenance.primaryErrorKind).toBe("malformed");
        expect(JSON.parse(res.text)).toEqual({ hazard: "road" });
      } finally {
        await primaryMalformed.close();
        await fallbackServer.close();
      }
    });

    it("Edge Case #15: when BOTH primary and fallback fail, raises GatewayPending (never quarantining documents)", async () => {
      const gatewayMod = await importRepoModule<{
        GatewayPending: new (
          reason: string,
          retryAfter: number | null,
        ) => Error & {
          reason: string;
          retryAfter: number | null;
        };
        completeWithGateway: (
          purpose: string,
          request: unknown,
          options: Record<string, unknown>,
        ) => Promise<string>;
      }>("src/lib/llm/gateway.server.ts");

      const llmUnavailMod = await importRepoModule<{
        LlmUnavailable: new (...args: unknown[]) => Error;
      }>("src/lib/text-sources/llm-unavailable.ts");

      const downPrimary = await startMockHttpServer(() => ({
        status: 503,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "upstream", retry_after: 45 }),
      }));
      const downFallback = await startMockHttpServer(() => ({
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "30" },
        body: JSON.stringify({ error: "overloaded" }),
      }));

      try {
        let caught: unknown;
        try {
          await gatewayMod.completeWithGateway(
            "dgpc_situation",
            sampleRequest,
            {
              circuitBreaker: null,
              config: {
                url: downPrimary.url,
                clientId: "cid",
                clientSecret: "super-secret-primary",
              },
              fallback: [
                {
                  id: "fb-down",
                  provider: "openai-compatible",
                  apiUrl: `${downFallback.url}/v1/chat/completions`,
                  apiKey: "super-secret-fallback",
                  model: "eu-model",
                  maxRetries: 0,
                  timeoutMs: 2_000,
                },
              ],
            },
          );
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(gatewayMod.GatewayPending);
        expect(caught).toBeInstanceOf(llmUnavailMod.LlmUnavailable);
        const pending = caught as Error & {
          reason: string;
          retryAfter: number | null;
        };
        expect(pending.reason).toBe("fallback_unavailable");
        expect(pending.retryAfter).toBeGreaterThan(0);
      } finally {
        await downPrimary.close();
        await downFallback.close();
      }
    });

    it("Edge Case #15: circuit breaker opens after threshold failures and routes straight to fallback without hammering primary", async () => {
      const gatewayMod = await importRepoModule<{
        completeWithGatewayResult: (
          purpose: string,
          request: unknown,
          options: Record<string, unknown>,
        ) => Promise<{
          text: string;
          provenance: {
            fallbackUsed: boolean;
            primaryErrorKind: string | null;
            attempts: number;
          };
        }>;
      }>("src/lib/llm/gateway.server.ts");
      const fallbackMod = await importRepoModule<{
        LlmCircuitBreaker: new (opts?: {
          failureThreshold?: number;
          defaultCooldownMs?: number;
        }) => unknown;
      }>("src/lib/llm/fallback.server.ts");

      const downPrimary = await startMockHttpServer(() => ({
        status: 503,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "upstream" }),
      }));
      const healthyFallback = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          choices: [{ message: { content: '{"hazard":"flood"}' } }],
        }),
      }));

      try {
        let nowMs = 1_700_000_000_000;
        const breaker = new fallbackMod.LlmCircuitBreaker({
          failureThreshold: 2,
          defaultCooldownMs: 60_000,
        });
        const callOpts = {
          circuitBreaker: breaker,
          now: () => nowMs,
          config: { url: downPrimary.url, clientId: "c", clientSecret: "s" },
          fallback: [
            {
              id: "fb-ok",
              provider: "openai-compatible",
              apiUrl: `${healthyFallback.url}/v1/chat/completions`,
              apiKey: "key",
              model: "model",
              timeoutMs: 2_000,
            },
          ],
        };

        // Failures 1 & 2 hit primary and open circuit.
        await gatewayMod.completeWithGatewayResult(
          "extract_dgpc",
          sampleRequest,
          callOpts,
        );
        await gatewayMod.completeWithGatewayResult(
          "extract_dgpc",
          sampleRequest,
          callOpts,
        );
        expect(downPrimary.requests.length).toBe(2);

        // Call 3 must short-circuit primary completely (primaryErrorKind = circuit_open).
        const third = await gatewayMod.completeWithGatewayResult(
          "extract_dgpc",
          sampleRequest,
          callOpts,
        );
        expect(downPrimary.requests.length).toBe(2);
        expect(third.provenance.fallbackUsed).toBe(true);
        expect(third.provenance.primaryErrorKind).toBe("circuit_open");
        expect(third.provenance.attempts).toBe(1);

        // After cooldown elapses, primary is probed again.
        nowMs += 61_000;
        await gatewayMod.completeWithGatewayResult(
          "extract_dgpc",
          sampleRequest,
          callOpts,
        );
        expect(downPrimary.requests.length).toBe(3);
      } finally {
        await downPrimary.close();
        await healthyFallback.close();
      }
    });

    it("empty/invalid fallback API keys are ignored safely and thrown errors never leak secrets or hostnames", async () => {
      const gatewayMod = await importRepoModule<{
        fallbackConfig: (env: Record<string, string | undefined>) => unknown[];
        completeWithGateway: (
          purpose: string,
          request: unknown,
          options: Record<string, unknown>,
        ) => Promise<string>;
      }>("src/lib/llm/gateway.server.ts");

      expect(
        gatewayMod.fallbackConfig({
          LLM_FALLBACK_PROVIDER: "mistral",
          LLM_FALLBACK_API_KEY: "   ",
          LLM_FALLBACK_MODEL: "mistral-small-latest",
        }),
      ).toEqual([]);

      expect(
        gatewayMod.fallbackConfig({
          LLM_FALLBACK_CHAIN: "not-valid-json{{{",
        }),
      ).toEqual([]);

      expect(
        gatewayMod.fallbackConfig({
          LLM_FALLBACK_CHAIN: JSON.stringify([
            {
              provider: "openai-compatible",
              apiUrl: "ftp://evil.example/v1",
              apiKey: "secret-key",
              model: "m",
            },
          ]),
        }),
      ).toEqual([]);

      const secretVal = "SECRET_NEVER_LEAK_998877";
      const secretHost = "http://127.0.0.1:1"; // closed port -> unreachable
      let errMsg = "";
      try {
        await gatewayMod.completeWithGateway("extract_dgpc", sampleRequest, {
          circuitBreaker: null,
          config: {
            url: secretHost,
            clientId: "cid-secret",
            clientSecret: secretVal,
          },
          fallback: [
            {
              id: "fb-secret-check",
              provider: "openai-compatible",
              apiUrl: "http://127.0.0.1:1/v1/chat/completions",
              apiKey: secretVal,
              model: "m",
              maxRetries: 0,
              timeoutMs: 1_000,
            },
          ],
        });
      } catch (err) {
        errMsg =
          err instanceof Error
            ? `${err.message} ${String(err.stack ?? "")}`
            : String(err);
      }

      expect(errMsg).not.toContain(secretVal);
      expect(errMsg).not.toContain("127.0.0.1:1");
      expect(errMsg).not.toContain("cid-secret");
    });
  });

  // ---------------------------------------------------------------------------
  // F5: 2026-11-26 90-Day / 92-Day Cold-Archive Postgres Boundaries (Edge Cases #2, #3, #4)
  // ---------------------------------------------------------------------------
  describe("F5 — Cold-Archive 2026-11-26 90d/92d Cutoff, FK Protection & Commit Rollback Boundaries", () => {
    it("Edge Case #2/#3: rejects 89d and exact 90d hot days (cold_day_still_hot) while allowing 91d on 90d tables and verifies 2026-11-26 cutoff harness", () => {
      assertPgReachable();

      const out = runInRolledBackTx(`
        SET LOCAL ROLE service_role;
        DO $$
        DECLARE
          rejected_89 boolean := false;
          rejected_90 boolean := false;
          d89 date := (now() AT TIME ZONE 'UTC')::date - 89;
          d90 date := (now() AT TIME ZONE 'UTC')::date - 90;
        BEGIN
          BEGIN
            PERFORM public.cold_archive_commit('broadcast_audit', d89, 0, null, null, null, null);
          EXCEPTION WHEN invalid_parameter_value THEN
            IF SQLERRM = 'cold_day_still_hot' THEN rejected_89 := true; END IF;
          END;
          BEGIN
            PERFORM public.cold_archive_commit('broadcast_audit', d90, 0, null, null, null, null);
          EXCEPTION WHEN invalid_parameter_value THEN
            IF SQLERRM = 'cold_day_still_hot' THEN rejected_90 := true; END IF;
          END;
          IF NOT rejected_89 OR NOT rejected_90 THEN
            RAISE EXCEPTION 'expected cold_day_still_hot for both 89d and 90d';
          END IF;
        END $$;

        -- Age 91d (strictly older than 90d hot window) is accepted for 90d table with 0 rows
        SELECT public.cold_archive_commit(
          'airport_observations',
          (now() AT TIME ZONE 'UTC')::date - 91,
          0, null, null, null, null
        )::text;
      `);

      expect(out.split("\n").at(-1)?.trim()).toBe("0");

      // Also verify the repository contains the reproducible 2026-11-26 verification harness.
      expect(
        repoFileExists("scripts/verify-cold-archive.ts") ||
          repoFileExists("scripts/cold-archive.ts"),
      ).toBe(true);
      const harnessContent = repoFileExists("scripts/verify-cold-archive.ts")
        ? readRepoFile("scripts/verify-cold-archive.ts")
        : readRepoFile("scripts/cold-archive.ts");
      expect(harnessContent).toContain("2026-11-26");
    });

    it("Edge Case #3: source_jobs enforces 92-day hot window (age 91d & 92d rejected; >=93d only eligible when state IN ('succeeded','failed'))", () => {
      assertPgReachable();

      const out = runInRolledBackTx(`
        INSERT INTO public.source_contracts (
          key, version, label, family, criticality, freshness_basis,
          cadence_minutes, warning_after_minutes, stale_after_minutes,
          parser_version, licence, attribution, owner
        ) VALUES (
          'e2e.cold.jobs', 1, 'Cold Jobs', 'reference_enrichment', 'optional', 'last_success_at',
          5, 10, 20, '1', 'test', 'test', 'test'
        );

        -- Seed 5 jobs on day (today - 95d) across all 5 states
        WITH old_ts AS (
          SELECT (((now() AT TIME ZONE 'UTC')::date - 95)::timestamp AT TIME ZONE 'UTC' + interval '3 hours') AS at
        )
        INSERT INTO public.source_jobs (
          id, contract_key, contract_version, execution_target, trigger_kind,
          idempotency_key, scheduled_for, data_from, data_through,
          created_at, state, max_attempts, retry_base_seconds, retry_until
        )
        SELECT
          v.id, 'e2e.cold.jobs', 1, 'cloudflare', 'manual', v.k,
          o.at, o.at - interval '10 minutes', o.at,
          o.at, v.st, 3, 30, o.at + interval '1 hour'
        FROM old_ts o, (VALUES
          ('40000000-0000-4000-8000-000000000001'::uuid, 'j-queued', 'queued'),
          ('40000000-0000-4000-8000-000000000002'::uuid, 'j-running', 'running'),
          ('40000000-0000-4000-8000-000000000003'::uuid, 'j-retry', 'retry_wait'),
          ('40000000-0000-4000-8000-000000000004'::uuid, 'j-ok', 'succeeded'),
          ('40000000-0000-4000-8000-000000000005'::uuid, 'j-fail', 'failed')
        ) v(id, k, st);

        -- Verify age 91d and 92d are rejected as cold_day_still_hot for source_jobs
        SET LOCAL ROLE service_role;
        DO $$
        DECLARE
          rej91 boolean := false;
          rej92 boolean := false;
        BEGIN
          BEGIN
            PERFORM public.cold_archive_commit('source_jobs', (now() AT TIME ZONE 'UTC')::date - 91, 0, null, null, null, null);
          EXCEPTION WHEN invalid_parameter_value THEN
            IF SQLERRM = 'cold_day_still_hot' THEN rej91 := true; END IF;
          END;
          BEGIN
            PERFORM public.cold_archive_commit('source_jobs', (now() AT TIME ZONE 'UTC')::date - 92, 0, null, null, null, null);
          EXCEPTION WHEN invalid_parameter_value THEN
            IF SQLERRM = 'cold_day_still_hot' THEN rej92 := true; END IF;
          END;
          IF NOT rej91 OR NOT rej92 THEN
            RAISE EXCEPTION 'source_jobs must keep 91d and 92d hot';
          END IF;
        END $$;
        RESET ROLE;

        -- Only succeeded & failed jobs are candidates at age 95d (2 rows)
        SELECT count(*)::text
          FROM private.cold_candidates('source_jobs', (now() AT TIME ZONE 'UTC')::date - 95) c
          JOIN public.source_jobs j ON j.id = c.id
         WHERE j.contract_key = 'e2e.cold.jobs';
      `);

      expect(out.split("\n").at(-1)?.trim()).toBe("2");
    });

    it("Edge Case #2: published risk_forecasts older than 90d stay hot and direct DELETE raises published_risk_forecast_is_immutable", () => {
      assertPgReachable();

      const out = runInRolledBackTx(`
        WITH old_day AS (
          SELECT
            ((now() AT TIME ZONE 'UTC')::date - 105) AS d,
            (((now() AT TIME ZONE 'UTC')::date - 105)::timestamp AT TIME ZONE 'UTC' + interval '4 hours') AS at
        )
        INSERT INTO public.risk_publications (snapshot_id, base_date, scheduled_for, published_at, row_count)
        SELECT v.sid, o.d, o.at + v.shift, o.at, 1
        FROM old_day o, (VALUES
          ('41000000-0000-4000-8000-000000000001'::uuid, interval '0 hours'),
          ('41000000-0000-4000-8000-000000000002'::uuid, interval '1 hour')
        ) v(sid, shift);

        WITH old_day AS (
          SELECT
            ((now() AT TIME ZONE 'UTC')::date - 105) AS d,
            (((now() AT TIME ZONE 'UTC')::date - 105)::timestamp AT TIME ZONE 'UTC' + interval '4 hours') AS at
        )
        INSERT INTO public.risk_publication_checkpoint (key, snapshot_id, base_date, scheduled_for, published_at)
        SELECT 'local_fwi', '41000000-0000-4000-8000-000000000002', o.d, o.at + interval '1 hour', o.at
        FROM old_day o
        ON CONFLICT (key) DO UPDATE SET
          snapshot_id = EXCLUDED.snapshot_id,
          base_date = EXCLUDED.base_date,
          scheduled_for = EXCLUDED.scheduled_for,
          published_at = EXCLUDED.published_at;

        WITH old_day AS (
          SELECT
            ((now() AT TIME ZONE 'UTC')::date - 105) AS d,
            (((now() AT TIME ZONE 'UTC')::date - 105)::timestamp AT TIME ZONE 'UTC' + interval '4 hours') AS at
        )
        INSERT INTO public.risk_forecasts (id, snapshot_id, commune_id, forecast_date, horizon_days, source, fwi, danger_level, created_at)
        SELECT v.id, v.sid, (SELECT id FROM public.admin_units WHERE level = 'commune' LIMIT 1), o.d, 0, 'local_fwi', 15, 2, o.at
        FROM old_day o, (VALUES
          ('41000000-0000-4000-8000-000000000011'::uuid, '41000000-0000-4000-8000-000000000001'::uuid),
          ('41000000-0000-4000-8000-000000000012'::uuid, '41000000-0000-4000-8000-000000000002'::uuid)
        ) v(id, sid);

        -- Direct delete of published forecast raises published_risk_forecast_is_immutable (55000)
        DO $$
        DECLARE
          blocked boolean := false;
        BEGIN
          BEGIN
            DELETE FROM public.risk_forecasts WHERE id = '41000000-0000-4000-8000-000000000012';
          EXCEPTION WHEN SQLSTATE '55000' THEN
            IF SQLERRM = 'published_risk_forecast_is_immutable' THEN blocked := true; END IF;
          END;
          IF NOT blocked THEN
            RAISE EXCEPTION 'expected published_risk_forecast_is_immutable';
          END IF;
        END $$;

        -- Only the unpublished older snapshot row is a cold candidate
        SELECT string_agg(id::text, ',' ORDER BY id::text)
          FROM private.cold_candidates('risk_forecasts', (now() AT TIME ZONE 'UTC')::date - 105)
         WHERE id IN ('41000000-0000-4000-8000-000000000011', '41000000-0000-4000-8000-000000000012');
      `);

      expect(out.split("\n").at(-1)?.trim()).toBe(
        "41000000-0000-4000-8000-000000000011",
      );
    });

    it("Edge Case #2: source_runs older than 90d that resolved a source_gaps row or have outcome='running' stay hot", () => {
      assertPgReachable();

      const out = runInRolledBackTx(`
        INSERT INTO public.source_contracts (
          key, version, label, family, criticality, freshness_basis,
          cadence_minutes, warning_after_minutes, stale_after_minutes,
          parser_version, licence, attribution, owner
        ) VALUES (
          'e2e.cold.runs', 1, 'Cold Runs', 'reference_enrichment', 'optional', 'last_success_at',
          5, 10, 20, '1', 'test', 'test', 'test'
        );

        WITH old_ts AS (
          SELECT (((now() AT TIME ZONE 'UTC')::date - 106)::timestamp AT TIME ZONE 'UTC' + interval '5 hours') AS at
        )
        INSERT INTO public.source_runs (
          id, contract_key, contract_version, trigger_kind, idempotency_key,
          scheduled_for, started_at, finished_at, outcome, records_seen
        )
        SELECT v.id, 'e2e.cold.runs', 1, 'manual', v.k, o.at, o.at, o.at + interval '1 minute', v.outcome, 1
        FROM old_ts o, (VALUES
          ('42000000-0000-4000-8000-000000000001'::uuid, 'run-eligible', 'succeeded'),
          ('42000000-0000-4000-8000-000000000002'::uuid, 'run-gap-resolver', 'succeeded'),
          ('42000000-0000-4000-8000-000000000003'::uuid, 'run-still-running', 'running')
        ) v(id, k, outcome);

        WITH old_ts AS (
          SELECT (((now() AT TIME ZONE 'UTC')::date - 106)::timestamp AT TIME ZONE 'UTC' + interval '5 hours') AS at
        )
        INSERT INTO public.source_gaps (contract_key, data_from, data_through, state, resolved_by_run_id)
        SELECT 'e2e.cold.runs', o.at - interval '1 hour', o.at, 'resolved', '42000000-0000-4000-8000-000000000002'
        FROM old_ts o;

        SELECT string_agg(id::text, ',' ORDER BY id::text)
          FROM private.cold_candidates('source_runs', (now() AT TIME ZONE 'UTC')::date - 106)
         WHERE id IN (
           '42000000-0000-4000-8000-000000000001',
           '42000000-0000-4000-8000-000000000002',
           '42000000-0000-4000-8000-000000000003'
         );
      `);

      expect(out.split("\n").at(-1)?.trim()).toBe(
        "42000000-0000-4000-8000-000000000001",
      );
    });

    it("Edge Case #3: source_jobs older than 92d referenced by hot source_runs or weather_snapshots stay hot", () => {
      assertPgReachable();

      const out = runInRolledBackTx(`
        INSERT INTO public.source_contracts (
          key, version, label, family, criticality, freshness_basis,
          cadence_minutes, warning_after_minutes, stale_after_minutes,
          parser_version, licence, attribution, owner
        ) VALUES (
          'e2e.cold.fkjobs', 1, 'Cold FK Jobs', 'reference_enrichment', 'optional', 'last_success_at',
          5, 10, 20, '1', 'test', 'test', 'test'
        );

        WITH old_ts AS (
          SELECT (((now() AT TIME ZONE 'UTC')::date - 107)::timestamp AT TIME ZONE 'UTC' + interval '2 hours') AS at
        )
        INSERT INTO public.source_jobs (
          id, contract_key, contract_version, execution_target, trigger_kind,
          idempotency_key, scheduled_for, data_from, data_through,
          created_at, state, max_attempts, retry_base_seconds, retry_until
        )
        SELECT
          v.id, 'e2e.cold.fkjobs', 1, 'cloudflare', 'manual', v.k,
          o.at, o.at - interval '10 minutes', o.at,
          o.at, 'succeeded', 3, 30, o.at + interval '1 hour'
        FROM old_ts o, (VALUES
          ('43000000-0000-4000-8000-000000000001'::uuid, 'fkjob-unreferenced'),
          ('43000000-0000-4000-8000-000000000002'::uuid, 'fkjob-ref-by-run')
        ) v(id, k);

        -- Hot source_run pointing at fkjob-ref-by-run
        INSERT INTO public.source_runs (
          id, contract_key, contract_version, trigger_kind, idempotency_key,
          scheduled_for, started_at, finished_at, outcome, records_seen, job_id, attempt
        ) VALUES (
          '43000000-0000-4000-8000-000000000099',
          'e2e.cold.fkjobs', 1, 'manual', 'hot-run-fk-ref',
          now(), now(), now(), 'succeeded', 1, '43000000-0000-4000-8000-000000000002', 1
        );

        SELECT string_agg(id::text, ',' ORDER BY id::text)
          FROM private.cold_candidates('source_jobs', (now() AT TIME ZONE 'UTC')::date - 107)
         WHERE id IN (
           '43000000-0000-4000-8000-000000000001',
           '43000000-0000-4000-8000-000000000002'
         );
      `);

      expect(out.split("\n").at(-1)?.trim()).toBe(
        "43000000-0000-4000-8000-000000000001",
      );
    });

    it("Edge Case #4: cold_archive_commit rejects mismatched bytes, key_digest, row count, missing object, and bad path with zero deletions and zero cold_exports rows", () => {
      assertPgReachable();

      const out = runInRolledBackTx(`
        SELECT set_config('e2e.day', ((now() AT TIME ZONE 'UTC')::date - 108)::text, true);

        INSERT INTO public.broadcast_audit (id, at, action, reason)
        VALUES (
          '44000000-0000-4000-8000-000000000001',
          current_setting('e2e.day')::timestamp AT TIME ZONE 'UTC' + interval '3 hours',
          'suppressed',
          'e2e_cold_rollback_test'
        );

        INSERT INTO storage.objects (bucket_id, name, metadata)
        VALUES
          (
            'cold-archive',
            'cold/broadcast_audit/' || to_char(current_setting('e2e.day')::date, 'YYYY/MM/DD') || '.parquet',
            '{"size": 128}'::jsonb
          ),
          (
            'cold-archive',
            'cold/wrong_prefix/bad.parquet',
            '{"size": 128}'::jsonb
          );

        CREATE TEMP TABLE e2e_dig AS
        SELECT
          count(*) AS n,
          md5(string_agg(id::text, ',' ORDER BY id::text COLLATE "C")) AS dig
        FROM private.cold_candidates('broadcast_audit', current_setting('e2e.day')::date);
        GRANT SELECT ON e2e_dig TO service_role;

        SET LOCAL ROLE service_role;
        DO $$
        DECLARE
          d date := current_setting('e2e.day')::date;
          good_path text := 'cold/broadcast_audit/' || to_char(d, 'YYYY/MM/DD') || '.parquet';
          n bigint := (SELECT n FROM e2e_dig);
          dig text := (SELECT dig FROM e2e_dig);
          sha text := repeat('f', 64);
          err_bytes boolean := false;
          err_missing boolean := false;
          err_digest boolean := false;
          err_count boolean := false;
          err_path boolean := false;
        BEGIN
          -- 1. Mismatched bytes
          BEGIN
            PERFORM public.cold_archive_commit('broadcast_audit', d, n, dig, sha, 999, good_path);
          EXCEPTION WHEN SQLSTATE 'P0002' THEN
            IF SQLERRM = 'cold_file_missing' THEN err_bytes := true; END IF;
          END;
          -- 2. Missing storage.objects path
          BEGIN
            PERFORM public.cold_archive_commit('broadcast_audit', d, n, dig, sha, 128, 'cold/broadcast_audit/1999/01/01.parquet');
          EXCEPTION WHEN SQLSTATE 'P0002' THEN
            IF SQLERRM = 'cold_file_missing' THEN err_missing := true; END IF;
          END;
          -- 3. Mismatched key_digest
          BEGIN
            PERFORM public.cold_archive_commit('broadcast_audit', d, n, md5('wrong-digest'), sha, 128, good_path);
          EXCEPTION WHEN SQLSTATE 'P0001' THEN
            IF SQLERRM = 'cold_export_mismatch' THEN err_digest := true; END IF;
          END;
          -- 4. Mismatched row count
          BEGIN
            PERFORM public.cold_archive_commit('broadcast_audit', d, n + 1, dig, sha, 128, good_path);
          EXCEPTION WHEN SQLSTATE 'P0001' THEN
            IF SQLERRM = 'cold_export_mismatch' THEN err_count := true; END IF;
          END;
          -- 5. Invalid path outside cold/<table>/<yyyy>/<mm>/<dd>.parquet (check constraint 23514)
          BEGIN
            PERFORM public.cold_archive_commit('broadcast_audit', d, n, dig, sha, 128, 'cold/wrong_prefix/bad.parquet');
          EXCEPTION WHEN SQLSTATE '23514' THEN
            err_path := true;
          END;

          IF NOT (err_bytes AND err_missing AND err_digest AND err_count AND err_path) THEN
            RAISE EXCEPTION 'Missing expected rejection: bytes=% missing=% digest=% count=% path=%',
              err_bytes, err_missing, err_digest, err_count, err_path;
          END IF;
        END $$;
        RESET ROLE;

        SELECT
          (SELECT count(*) FROM public.broadcast_audit WHERE id = '44000000-0000-4000-8000-000000000001')::text
          || ',' ||
          (SELECT count(*) FROM public.cold_exports WHERE table_name = 'broadcast_audit' AND day = current_setting('e2e.day')::date)::text;
      `);

      expect(out.split("\n").at(-1)?.trim()).toBe("1,0");
    });

    it("broadcast_audit remains strictly append-only (UPDATE always blocked, DELETE blocked before archive) and cold_reader has zero write privileges", () => {
      assertPgReachable();

      const out = runInRolledBackTx(`
        INSERT INTO public.broadcast_audit (id, at, action, reason)
        VALUES ('45000000-0000-4000-8000-000000000001', now(), 'suppressed', 'immutability_check');

        DO $$
        DECLARE
          del_blocked boolean := false;
          upd_blocked boolean := false;
        BEGIN
          BEGIN
            DELETE FROM public.broadcast_audit WHERE id = '45000000-0000-4000-8000-000000000001';
          EXCEPTION WHEN SQLSTATE 'P0001' THEN
            IF SQLERRM = 'broadcast_audit is append-only' THEN del_blocked := true; END IF;
          END;
          BEGIN
            UPDATE public.broadcast_audit SET reason = 'tampered' WHERE id = '45000000-0000-4000-8000-000000000001';
          EXCEPTION WHEN SQLSTATE 'P0001' THEN
            IF SQLERRM = 'broadcast_audit is append-only' THEN upd_blocked := true; END IF;
          END;
          IF NOT del_blocked OR NOT upd_blocked THEN
            RAISE EXCEPTION 'broadcast_audit immutability violated';
          END IF;
        END $$;

        SELECT count(*)::text
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('public', 'private', 'storage')
           AND c.relkind IN ('r', 'p', 'v')
           AND (
             has_table_privilege('cold_reader', c.oid, 'insert')
             OR has_table_privilege('cold_reader', c.oid, 'update')
             OR has_table_privilege('cold_reader', c.oid, 'delete')
             OR has_table_privilege('cold_reader', c.oid, 'truncate')
           );
      `);

      expect(out.split("\n").at(-1)?.trim()).toBe("0");
    });
  });

  // ---------------------------------------------------------------------------
  // F6: Android app.nadhir Play Production Readiness Boundaries (Edge Case #13)
  // ---------------------------------------------------------------------------
  describe("F6 — Android Readiness, Notification Channels & Android 14+ Local Notification Boundaries", () => {
    it("Edge Case #13: every LocalNotifications.schedule call in push-native.ts sets isExactNotification: false", async () => {
      const channelsMod = await importRepoModule<{
        DEFAULT_LOCAL_NOTIFICATION_EXACT: boolean;
      }>("src/lib/notification-channels.ts");
      expect(channelsMod.DEFAULT_LOCAL_NOTIFICATION_EXACT).toBe(false);

      const pushNativeSrc = readRepoFile("src/lib/push-native.ts");
      const scheduleCalls =
        pushNativeSrc.match(
          /\b(?:LocalNotifications|localNotifications)\.schedule\s*\(/g,
        ) ?? [];
      expect(scheduleCalls.length).toBeGreaterThan(0);

      // Ensure isExactNotification: false (or DEFAULT_LOCAL_NOTIFICATION_EXACT) appears for every schedule block and NEVER true.
      expect(pushNativeSrc).not.toMatch(/isExactNotification\s*:\s*true/);
      const exactFalseMatches =
        pushNativeSrc.match(
          /isExactNotification\s*:\s*(?:false|DEFAULT_LOCAL_NOTIFICATION_EXACT)/g,
        ) ?? [];
      expect(exactFalseMatches.length).toBeGreaterThanOrEqual(
        scheduleCalls.length,
      );
    });

    it("unknown hazard kinds and malformed FCM payloads safely fall back to legacy 'alerts' channel without throwing", async () => {
      const channelsMod = await importRepoModule<{
        LEGACY_NOTIFICATION_CHANNEL_ID: string;
        resolveNotificationChannel: (input: Record<string, unknown>) => string;
        channelFromFcmData: (data: unknown) => string;
      }>("src/lib/notification-channels.ts");

      expect(channelsMod.LEGACY_NOTIFICATION_CHANNEL_ID).toBe("alerts");

      for (const unknownKind of [
        "",
        "volcano",
        "tsunami_unknown",
        "__proto__",
        "  ",
      ]) {
        expect(
          channelsMod.resolveNotificationChannel({ kind: unknownKind }),
        ).toBe("alerts");
      }

      for (const badPayload of [
        null,
        undefined,
        [],
        "alerts_urgent",
        42,
        { channel_id: "nonexistent_channel" },
        { kind: "" },
        { kind: 123 },
      ]) {
        expect(channelsMod.channelFromFcmData(badPayload)).toBe("alerts");
      }

      // Non-finite earthquake magnitude falls back cleanly without throwing.
      expect(
        channelsMod.resolveNotificationChannel({
          kind: "earthquake",
          magnitude: Number.NaN,
        }),
      ).toBe("alerts_earthquakes");
    });

    it("AndroidManifest.xml declares POST_NOTIFICATIONS, supportsRtl, forbids cleartext traffic, and keeps non-launcher receivers unexported", () => {
      const manifest = readRepoFile("android/app/src/main/AndroidManifest.xml");

      expect(manifest).toContain("android.permission.POST_NOTIFICATIONS");
      expect(manifest).toContain('android:supportsRtl="true"');
      expect(manifest).not.toMatch(/android:usesCleartextTraffic\s*=\s*"true"/);

      // Non-launcher receivers and FileProvider must explicitly set exported="false".
      expect(manifest).toMatch(
        /CommuneLocationReceiver[\s\S]{0,200}android:exported="false"/,
      );
      expect(manifest).toMatch(
        /CommuneBootReceiver[\s\S]{0,200}android:exported="false"/,
      );
      expect(manifest).toMatch(
        /FileProvider[\s\S]{0,200}android:exported="false"/,
      );
    });

    it("android/app/build.gradle contains zero hardcoded signing passwords or secrets and configures app.nadhir properly", () => {
      const gradle = readRepoFile("android/app/build.gradle");

      expect(gradle).toContain('applicationId "app.nadhir"');
      const hasLiteralVersionCode = /versionCode\s+[1-9]\d*/.test(gradle);
      const hasValidatedDynamicVersionCode =
        /versionCode\s+resolvedVersionCode\b/.test(gradle) &&
        /\?:\s*["'][1-9]\d*["']/.test(gradle) &&
        /(?:maxPlayVersionCode\s*=\s*2100000000|<=?\s*2100000000)/.test(gradle);
      expect(
        hasLiteralVersionCode || hasValidatedDynamicVersionCode,
        "Expected positive literal versionCode or validated dynamic resolvedVersionCode bounded by 2100000000",
      ).toBe(true);
      expect(gradle).toContain('System.getenv("NADHIR_UPLOAD_STORE")');
      expect(gradle).toContain('System.getenv("NADHIR_UPLOAD_PASSWORD")');

      // Forbid literal hardcoded passwords in signingConfigs.
      expect(gradle).not.toMatch(/storePassword\s+["'][^"']+["']/);
      expect(gradle).not.toMatch(/keyPassword\s+["'][^"']+["']/);
    });

    it("native Android NotificationChannels.java mirrors all 6 canonical channel IDs from notification-channels.ts", async () => {
      const channelsMod = await importRepoModule<{
        NOTIFICATION_CHANNEL_IDS: readonly string[];
      }>("src/lib/notification-channels.ts");

      const javaPath =
        "android/app/src/main/java/app/nadhir/NotificationChannels.java";
      expect(
        repoFileExists(javaPath),
        `Expected native channel registry at ${javaPath}`,
      ).toBe(true);

      const javaSrc = readRepoFile(javaPath);
      for (const channelId of channelsMod.NOTIFICATION_CHANNEL_IDS) {
        expect(
          javaSrc,
          `Missing channel ID "${channelId}" in ${javaPath}`,
        ).toContain(`"${channelId}"`);
      }
    });

    it("assetlinks.json targets app.nadhir and push-native appLink() blocks open-redirect schemes", async () => {
      const assetLinksPath = "public/.well-known/assetlinks.json";
      expect(
        repoFileExists(assetLinksPath),
        `Expected Android App Links metadata at ${assetLinksPath}`,
      ).toBe(true);

      const assetLinks =
        readRepoJson<
          Array<{ target?: { namespace?: string; package_name?: string } }>
        >(assetLinksPath);
      expect(Array.isArray(assetLinks)).toBe(true);
      expect(assetLinks.length).toBeGreaterThan(0);
      expect(
        assetLinks.some(
          (entry) =>
            entry.target?.namespace === "android_app" &&
            entry.target?.package_name === "app.nadhir",
        ),
      ).toBe(true);

      const pushNativeMod = await importRepoModule<{
        appLink: (data: unknown) => string | null;
      }>("src/lib/push-native.ts");

      expect(pushNativeMod.appLink({ link: "/alerts" })).toBe("/alerts");
      expect(pushNativeMod.appLink({ link: "/wilaya/alger" })).toBe(
        "/wilaya/alger",
      );
      for (const bad of [
        "//evil.example/phish",
        "/\\evil.example",
        "https://evil.example/alerts",
        "javascript:alert(1)",
        "",
      ]) {
        expect(pushNativeMod.appLink({ link: bad })).toBeNull();
      }
    });
  });
});
