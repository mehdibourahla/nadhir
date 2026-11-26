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

describe("Tier 1 — F3: Always-On EU Backend Worker (source_jobs)", () => {
  it("F3.1: worker/ contains standalone entrypoint, EU container/deploy manifest (Dockerfile + compose/systemd), and health check contract", () => {
    const workerFiles = listRepoFiles("worker");
    expect(workerFiles.length).toBeGreaterThan(0);

    const hasEntrypoint =
      repoFileExists("worker/src/index.ts") ||
      repoFileExists("worker/index.ts");
    expect(hasEntrypoint).toBe(true);

    const hasDockerfile = repoFileExists("worker/Dockerfile");
    expect(hasDockerfile).toBe(true);
    const dockerfile = readRepoFile("worker/Dockerfile");
    expect(dockerfile).toMatch(/\bFROM\b/i);
    expect(dockerfile).toMatch(/HEALTHCHECK|health/i);

    const deployManifests = workerFiles.filter((f) =>
      /(docker-compose|compose|systemd|\.service|fly\.toml|hetzner)/i.test(f),
    );
    expect(deployManifests.length).toBeGreaterThan(0);
  });

  it("F3.2: Postgres source_contracts and source_jobs accept execution_target='worker' while preserving 'cloudflare' and 'github'", () => {
    assertPgReachable();

    const constraints = psqlJson<{
      table_name: string;
      constraint_def: string;
    }>(`
      SELECT c.relname AS table_name, pg_get_constraintdef(con.oid) AS constraint_def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('source_contracts', 'source_jobs')
        AND pg_get_constraintdef(con.oid) ILIKE '%execution_target%'
      ORDER BY c.relname
    `);

    expect(constraints.length).toBeGreaterThanOrEqual(2);
    for (const row of constraints) {
      expect(row.constraint_def).toContain("'worker'");
      expect(row.constraint_def).toContain("'cloudflare'");
      expect(row.constraint_def).toContain("'github'");
    }

    const txOut = runInRolledBackTx(`
      INSERT INTO public.source_contracts (
        key, version, label, family, criticality, freshness_basis,
        cadence_minutes, warning_after_minutes, stale_after_minutes,
        parser_version, licence, attribution, owner, execution_target
      ) VALUES
        ('e2e.worker.target', 1, 'Worker Target', 'reference_enrichment', 'optional', 'last_success_at', 5, 10, 20, '1', 'test', 'test', 'test', 'worker'),
        ('e2e.cf.target', 1, 'CF Target', 'reference_enrichment', 'optional', 'last_success_at', 5, 10, 20, '1', 'test', 'test', 'test', 'cloudflare'),
        ('e2e.gh.target', 1, 'GH Target', 'reference_enrichment', 'optional', 'last_success_at', 5, 10, 20, '1', 'test', 'test', 'test', 'github');
      SELECT count(*) FROM public.source_contracts WHERE key IN ('e2e.worker.target', 'e2e.cf.target', 'e2e.gh.target')
    `);
    expect(txOut.split("\n").pop()?.trim()).toBe("3");
  });

  it("F3.3: ita_facebook, ita_website, dgpc_telegram, local_fwi, and effis contracts target 'worker' in Postgres", () => {
    assertPgReachable();

    const rows = psqlJson<{ key: string; execution_target: string }>(`
      SELECT key, execution_target
      FROM public.source_contracts
      WHERE key IN ('ita_facebook', 'ita_website', 'dgpc_telegram', 'local_fwi', 'effis')
      ORDER BY key
    `);

    expect(rows.map((r) => r.key)).toEqual([
      "dgpc_telegram",
      "effis",
      "ita_facebook",
      "ita_website",
      "local_fwi",
    ]);
    for (const row of rows) {
      expect(row.execution_target, `${row.key} must target worker`).toBe(
        "worker",
      );
    }
  });

  it("F3.4: source_jobs Postgres queue executes claim -> lease fencing -> transient retry_wait -> re-claim -> complete_source_job lifecycle in rolled-back tx", () => {
    assertPgReachable();

    const result = runInRolledBackTx(`
      INSERT INTO public.source_contracts (
        key, version, label, family, criticality, freshness_basis,
        cadence_minutes, warning_after_minutes, stale_after_minutes,
        parser_version, licence, attribution, owner, execution_target,
        max_attempts, retry_base_seconds, retry_window_minutes, lease_seconds
      ) VALUES (
        'e2e.worker.lifecycle', 1, 'Lifecycle Test', 'reference_enrichment', 'optional', 'last_success_at',
        5, 10, 20, '1', 'test', 'test', 'test', 'worker',
        3, 30, 60, 120
      );

      INSERT INTO public.source_jobs (
        id, contract_key, contract_version, trigger_kind, idempotency_key,
        scheduled_for, data_from, data_through, execution_target, enqueued_by,
        available_at, max_attempts, retry_base_seconds, retry_until
      ) VALUES (
        '30000000-0000-4000-8000-000000000001',
        'e2e.worker.lifecycle', 1, 'manual', 'e2e:worker:lifecycle:1',
        '2026-11-24T12:00:00Z', '2026-11-24T11:50:00Z', '2026-11-24T12:00:00Z',
        'worker', array['worker'], '2026-11-24T12:00:00Z', 3, 30, '2026-11-24T13:00:00Z'
      );

      -- 1) Claim job on worker target
      CREATE TEMP TABLE e2e_claim1 AS
      SELECT * FROM public.claim_source_job(
        'eu-worker-test-1', 'worker', 'e2e.worker.lifecycle', '2026-11-24T12:00:05Z'::timestamptz
      );

      -- 2) Lease fencing: second worker cannot claim the leased job
      CREATE TEMP TABLE e2e_claim_fenced AS
      SELECT * FROM public.claim_source_job(
        'eu-worker-test-2', 'worker', 'e2e.worker.lifecycle', '2026-11-24T12:00:10Z'::timestamptz
      );

      -- 3) Transient failure transitions to retry_wait with backoff
      CREATE TEMP TABLE e2e_retry AS
      SELECT * FROM public.complete_source_job(
        '30000000-0000-4000-8000-000000000001', 'eu-worker-test-1', 1,
        '2026-11-24T12:00:15Z'::timestamptz, 'failed',
        null, '2026-11-24T11:50:00Z'::timestamptz, '2026-11-24T12:00:00Z'::timestamptz,
        null, null, 0, 0, 0, 0, null, 'unknown', '{}'::jsonb,
        'upstream_unreachable', 'transient test error', true
      );

      -- 4) Re-claim after backoff window and complete cleanly
      CREATE TEMP TABLE e2e_claim2 AS
      SELECT * FROM public.claim_source_job(
        'eu-worker-test-1', 'worker', 'e2e.worker.lifecycle', '2026-11-24T12:05:00Z'::timestamptz
      );

      CREATE TEMP TABLE e2e_done AS
      SELECT * FROM public.complete_source_job(
        '30000000-0000-4000-8000-000000000001', 'eu-worker-test-1', 2,
        '2026-11-24T12:05:10Z'::timestamptz, 'succeeded',
        '2026-11-24T12:00:00Z'::timestamptz, '2026-11-24T11:50:00Z'::timestamptz, '2026-11-24T12:00:00Z'::timestamptz,
        '2026-11-24T12:05:05Z'::timestamptz, '2026-11-24T12:05:08Z'::timestamptz,
        5, 5, 0, 0, 5, 'complete', '{}'::jsonb,
        null, null, false
      );

      SELECT json_build_object(
        'claim1_state', (SELECT state FROM e2e_claim1),
        'claim1_attempt', (SELECT attempt_count FROM e2e_claim1),
        'fenced_count', (SELECT count(*) FROM e2e_claim_fenced),
        'retry_state', (SELECT state FROM e2e_retry),
        'claim2_attempt', (SELECT attempt_count FROM e2e_claim2),
        'done_state', (SELECT state FROM e2e_done)
      )::text
    `);

    const lastLine = result.split("\n").pop()?.trim() ?? "";
    const parsed = JSON.parse(lastLine) as {
      claim1_state: string;
      claim1_attempt: number;
      fenced_count: number;
      retry_state: string;
      claim2_attempt: number;
      done_state: string;
    };

    expect(parsed.claim1_state).toBe("running");
    expect(parsed.claim1_attempt).toBe(1);
    expect(parsed.fenced_count).toBe(0);
    expect(parsed.retry_state).toBe("retry_wait");
    expect(parsed.claim2_attempt).toBe(2);
    expect(parsed.done_state).toBe("succeeded");
  });

  it("F3.5: src/lib/source-jobs.ts accepts 'worker' execution target alongside 'cloudflare' and 'github' and rejects invalid targets", async () => {
    const mod = await importRepoModule<{
      SOURCE_EXECUTION_TARGETS?: readonly string[];
      isSourceExecutionTarget?: (value: string) => boolean;
      sourceJobFromRow: (row: Record<string, unknown>) => {
        execution_target: string;
      };
    }>("src/lib/source-jobs.ts");

    if (mod.SOURCE_EXECUTION_TARGETS) {
      expect(mod.SOURCE_EXECUTION_TARGETS).toContain("worker");
      expect(mod.SOURCE_EXECUTION_TARGETS).toContain("cloudflare");
      expect(mod.SOURCE_EXECUTION_TARGETS).toContain("github");
    }
    if (mod.isSourceExecutionTarget) {
      expect(mod.isSourceExecutionTarget("worker")).toBe(true);
      expect(mod.isSourceExecutionTarget("invalid_target")).toBe(false);
    }

    const baseRow = {
      id: "00000000-0000-4000-8000-000000000099",
      contract_key: "ita_facebook",
      contract_version: 1,
      trigger_kind: "scheduled",
      idempotency_key: "scheduled:ita_facebook:2026-11-24T12:00:00Z",
      scheduled_for: "2026-11-24T12:00:00Z",
      data_from: "2026-11-24T11:50:00Z",
      data_through: "2026-11-24T12:00:00Z",
      execution_target: "worker",
      state: "queued",
      enqueued_by: ["worker"],
      available_at: "2026-11-24T12:00:00Z",
      attempt_count: 0,
      max_attempts: 3,
      retry_base_seconds: 60,
      retry_until: "2026-11-24T13:00:00Z",
      started_at: null,
      finished_at: null,
      last_error_at: null,
      last_public_reason_code: null,
      created_at: "2026-11-24T12:00:00Z",
      updated_at: "2026-11-24T12:00:00Z",
    };

    expect(mod.sourceJobFromRow(baseRow).execution_target).toBe("worker");
    expect(() =>
      mod.sourceJobFromRow({ ...baseRow, execution_target: "unknown" }),
    ).toThrow();
  });

  it("F3.6: worker scheduler/runtime supports worker execution targets and lease renewal without hardcoded live credentials", () => {
    const workerTsFiles = listRepoFiles("worker", ".ts");
    expect(workerTsFiles.length).toBeGreaterThan(0);

    const combined = workerTsFiles.map((f) => readRepoFile(f)).join("\n");
    expect(combined).toMatch(/claim_source_job|claimSourceJob/);
    expect(combined).toMatch(/complete_source_job|completeSourceJob/);
    expect(combined).toMatch(/health|ready|\/health/i);
    expect(combined).not.toMatch(
      /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{30,}/,
    );
  });
});

describe("Tier 1 — F4: Automatic LLM API Fallback & GatewayPending", () => {
  type GatewayMod = {
    completeWithGatewayResult: (
      purpose: string,
      request: { messages: Array<{ role: string; content: string }> },
      options?: Record<string, unknown>,
    ) => Promise<{
      text: string;
      provenance: {
        provider: string;
        providerId: string;
        model: string;
        fallbackUsed: boolean;
        primaryErrorKind: string | null;
      };
    }>;
    resetLlmCircuitBreakers?: () => void;
    GatewayPending: new (reason: string, retryAfter: number | null) => Error;
  };

  const sampleRequest = {
    messages: [
      { role: "system", content: "Classify Algerian hazard alert JSON." },
      { role: "user", content: "Incendie signalé à Tizi Ouzou." },
    ],
    response_format: {
      type: "json_schema" as const,
      json_schema: {
        name: "hazard_classification",
        strict: true,
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
    },
  };

  it("F4.1: uses primary gateway when healthy and records primary provenance (fallbackUsed=false)", async () => {
    const mod = await importRepoModule<GatewayMod>(
      "src/lib/llm/gateway.server.ts",
    );
    mod.resetLlmCircuitBreakers?.();

    const primaryServer = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: '{"ok":true,"source":"primary"}' }),
    }));
    const fallbackServer = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        choices: [{ message: { content: '{"ok":true,"source":"fallback"}' } }],
      }),
    }));

    try {
      const res = await mod.completeWithGatewayResult(
        "classify_report",
        sampleRequest,
        {
          config: {
            url: primaryServer.url,
            clientId: "test-client-id",
            clientSecret: "test-client-secret",
          },
          fallback: [
            {
              id: "eu-mistral",
              provider: "openai-compatible",
              apiUrl: `${fallbackServer.url}/v1/chat/completions`,
              apiKey: "test-fallback-key",
              model: "mistral-small-latest",
              maxRetries: 0,
            },
          ],
        },
      );

      expect(res.text).toContain("primary");
      expect(res.provenance.fallbackUsed).toBe(false);
      expect(res.provenance.provider).toBe("gateway");
      expect(primaryServer.requests.length).toBe(1);
      expect(fallbackServer.requests.length).toBe(0);
    } finally {
      await primaryServer.close();
      await fallbackServer.close();
    }
  });

  it("F4.2: automatically fails over to fallback LLM API on primary HTTP 500 and HTTP 429 with provenance metadata", async () => {
    const mod = await importRepoModule<GatewayMod>(
      "src/lib/llm/gateway.server.ts",
    );

    for (const status of [500, 429]) {
      mod.resetLlmCircuitBreakers?.();
      const primaryServer = await startMockHttpServer(() => ({
        status,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: status === 429 ? "rate_limited" : "upstream",
          retry_after: 30,
        }),
      }));
      const fallbackServer = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          choices: [
            { message: { content: `{"recovered":true,"from":${status}}` } },
          ],
        }),
      }));

      try {
        const res = await mod.completeWithGatewayResult(
          "classify_report",
          sampleRequest,
          {
            config: {
              url: primaryServer.url,
              clientId: "test-client-id",
              clientSecret: "test-client-secret",
            },
            fallback: [
              {
                id: "eu-mistral",
                provider: "openai-compatible",
                apiUrl: `${fallbackServer.url}/v1/chat/completions`,
                apiKey: "test-fallback-key",
                model: "mistral-small-latest",
                maxRetries: 0,
              },
            ],
          },
        );

        expect(res.text).toContain(`"from":${status}`);
        expect(res.provenance.fallbackUsed).toBe(true);
        expect(res.provenance.provider).toBe("openai-compatible");
        expect(res.provenance.primaryErrorKind).toBeTruthy();
        expect(fallbackServer.requests.length).toBe(1);
      } finally {
        await primaryServer.close();
        await fallbackServer.close();
      }
    }
  });

  it("F4.3: automatically fails over when primary gateway config is unset/null and fallback is configured", async () => {
    const mod = await importRepoModule<GatewayMod>(
      "src/lib/llm/gateway.server.ts",
    );
    mod.resetLlmCircuitBreakers?.();

    const fallbackServer = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        choices: [{ message: { content: '{"mode":"fallback_only"}' } }],
      }),
    }));

    try {
      const res = await mod.completeWithGatewayResult(
        "classify_report",
        sampleRequest,
        {
          config: null,
          fallback: [
            {
              id: "eu-fallback",
              provider: "openai-compatible",
              apiUrl: `${fallbackServer.url}/v1/chat/completions`,
              apiKey: "test-fallback-key",
              model: "mistral-small-latest",
              maxRetries: 0,
            },
          ],
        },
      );

      expect(res.text).toContain("fallback_only");
      expect(res.provenance.fallbackUsed).toBe(true);
      expect(res.provenance.primaryErrorKind).toBe("unset");
    } finally {
      await fallbackServer.close();
    }
  });

  it("F4.4: throws GatewayPending (never quarantining documents) when both primary and fallback fail", async () => {
    const mod = await importRepoModule<GatewayMod>(
      "src/lib/llm/gateway.server.ts",
    );
    mod.resetLlmCircuitBreakers?.();

    const primaryServer = await startMockHttpServer(() => ({
      status: 503,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "gateway_unreachable", retry_after: 45 }),
    }));
    const fallbackServer = await startMockHttpServer(() => ({
      status: 503,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: { message: "service unavailable" } }),
    }));

    try {
      let caught: unknown;
      try {
        await mod.completeWithGatewayResult("classify_report", sampleRequest, {
          config: {
            url: primaryServer.url,
            clientId: "test-client-id",
            clientSecret: "test-client-secret",
          },
          fallback: [
            {
              id: "eu-fallback",
              provider: "openai-compatible",
              apiUrl: `${fallbackServer.url}/v1/chat/completions`,
              apiKey: "test-fallback-key",
              model: "mistral-small-latest",
              maxRetries: 0,
            },
          ],
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(mod.GatewayPending);
    } finally {
      await primaryServer.close();
      await fallbackServer.close();
    }
  });

  it("F4.5: error messages never leak API keys, gateway secrets, or internal auth headers", async () => {
    const mod = await importRepoModule<GatewayMod>(
      "src/lib/llm/gateway.server.ts",
    );
    mod.resetLlmCircuitBreakers?.();

    const secretApiKey = "sk-live-SUPER-SECRET-KEY-99887766";
    const secretClientSecret = "cf-secret-TOKEN-11223344";

    const failingServer = await startMockHttpServer(() => ({
      status: 401,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: `Rejected key ${secretApiKey} / ${secretClientSecret}`,
      }),
    }));

    try {
      let caught: unknown;
      try {
        await mod.completeWithGatewayResult("classify_report", sampleRequest, {
          config: {
            url: failingServer.url,
            clientId: "client-id-secret",
            clientSecret: secretClientSecret,
          },
          fallback: [
            {
              id: "eu-fallback",
              provider: "openai-compatible",
              apiUrl: `${failingServer.url}/v1/chat/completions`,
              apiKey: secretApiKey,
              model: "mistral-small-latest",
              maxRetries: 0,
            },
          ],
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      const errText = `${(caught as Error).name}: ${(caught as Error).message}`;
      expect(errText).not.toContain(secretApiKey);
      expect(errText).not.toContain(secretClientSecret);
      expect(errText).not.toContain("cf-access-client-secret");
    } finally {
      await failingServer.close();
    }
  });
});

describe("Tier 1 — F5: 2026-11-26 90-Day Cold-Archive Verification (6 Tables)", () => {
  it("F5.1: scripts/verify-cold-archive.ts exists and targets 2026-11-26 dry-run/cutoff verification across all 6 cold tables", () => {
    expect(repoFileExists("scripts/verify-cold-archive.ts")).toBe(true);
    const scriptSrc = readRepoFile("scripts/verify-cold-archive.ts");

    expect(scriptSrc).toContain("2026-11-26");
    for (const table of [
      "weather_snapshots",
      "risk_forecasts",
      "broadcast_audit",
      "airport_observations",
      "source_runs",
      "source_jobs",
    ]) {
      expect(scriptSrc, `verify-cold-archive.ts must cover ${table}`).toContain(
        table,
      );
    }
  });

  it("F5.2: private.cold_tables contains all 6 cold tables with exact hot windows (90d x 5, 92d for source_jobs)", () => {
    assertPgReachable();

    const rows = psqlJson<{
      table_name: string;
      day_column: string;
      hot_days: number;
    }>(`
      SELECT table_name, day_column, hot_days
      FROM private.cold_tables
      ORDER BY table_name
    `);

    expect(rows).toEqual([
      {
        table_name: "airport_observations",
        day_column: "observed_at",
        hot_days: 90,
      },
      { table_name: "broadcast_audit", day_column: "at", hot_days: 90 },
      { table_name: "risk_forecasts", day_column: "created_at", hot_days: 90 },
      { table_name: "source_jobs", day_column: "created_at", hot_days: 92 },
      { table_name: "source_runs", day_column: "started_at", hot_days: 90 },
      {
        table_name: "weather_snapshots",
        day_column: "scheduled_at",
        hot_days: 90,
      },
    ]);
  });

  it("F5.3: rolled-back 6-table cold-archive cycle archives & deletes pre-cutoff rows while keeping 2026-09-15 active rows untouched", () => {
    assertPgReachable();

    // 2026-08-20 is strictly before both 2026-11-24 - 92d (2026-08-24) and 2026-11-26 - 92d (2026-08-26).
    // 2026-08-27 is 91 days before 2026-11-26 (eligible for 90d tables at 2026-11-26 cutoff).
    // 2026-09-15 is active/hot relative to 2026-11-26 and must remain untouched.
    const out = runInRolledBackTx(`
      DO $$
      DECLARE
        _commune uuid := (SELECT id FROM public.admin_units WHERE level = 'commune' LIMIT 1);
        _old_day date := DATE '2026-08-20';
        _old_ts timestamptz := TIMESTAMPTZ '2026-08-20T06:00:00Z';
        _aug27_ts timestamptz := TIMESTAMPTZ '2026-08-27T06:00:00Z';
        _active_ts timestamptz := TIMESTAMPTZ '2026-09-15T12:00:00Z';
        _hours jsonb := (SELECT jsonb_agg(jsonb_build_object('h', g)) FROM generate_series(1, 48) g);
        _evidence jsonb := jsonb_build_object('source', 'open-meteo', 'model', 'best_match', 'hours', _hours);
        _t text;
        _cnt bigint;
        _dig text;
        _del bigint;
        _path text;
      BEGIN
        IF _commune IS NULL THEN
          RAISE EXCEPTION 'admin_units commune required for cold-archive test';
        END IF;

        INSERT INTO public.source_contracts (
          key, version, label, family, criticality, freshness_basis,
          cadence_minutes, warning_after_minutes, stale_after_minutes,
          parser_version, licence, attribution, owner
        ) VALUES (
          'e2e.cold.six', 1, 'Cold Six', 'reference_enrichment', 'optional', 'last_success_at',
          5, 10, 20, '1', 'test', 'test', 'test'
        );

        -- 1. weather_snapshots
        INSERT INTO public.weather_snapshots (id, commune_id, scheduled_at, fetched_at, evidence) VALUES
          ('40000000-0000-4000-8000-000000000001', _commune, _old_ts, _old_ts, _evidence),
          ('40000000-0000-4000-8000-000000000002', _commune, _aug27_ts, _aug27_ts, _evidence),
          ('40000000-0000-4000-8000-000000000003', _commune, _active_ts, _active_ts, _evidence);

        -- 2. risk_forecasts (unreferenced snapshot vs active)
        INSERT INTO public.risk_publications (snapshot_id, base_date, scheduled_for, published_at, row_count) VALUES
          ('40000000-0000-4000-8000-000000000010', _old_day, _old_ts, _old_ts, 1),
          ('40000000-0000-4000-8000-000000000011', DATE '2026-09-15', _active_ts, _active_ts, 1);
        INSERT INTO public.risk_forecasts (id, snapshot_id, commune_id, forecast_date, horizon_days, source, fwi, danger_level, created_at) VALUES
          ('40000000-0000-4000-8000-000000000012', '40000000-0000-4000-8000-000000000010', _commune, _old_day, 0, 'local_fwi', 12, 1, _old_ts),
          ('40000000-0000-4000-8000-000000000013', '40000000-0000-4000-8000-000000000011', _commune, DATE '2026-09-15', 0, 'local_fwi', 15, 2, _active_ts);

        -- 3. broadcast_audit
        INSERT INTO public.broadcast_audit (id, at, action, reason) VALUES
          ('40000000-0000-4000-8000-000000000021', _old_ts, 'suppressed', 'e2e_cold_old'),
          ('40000000-0000-4000-8000-000000000022', _active_ts, 'suppressed', 'e2e_cold_active');

        -- 4. airport_observations
        INSERT INTO public.airport_observations (id, station, name, lat, lon, observed_at, raw) VALUES
          ('40000000-0000-4000-8000-000000000031', 'DAAG', 'Algiers', 36.69, 3.21, _old_ts, 'METAR DAAG OLD'),
          ('40000000-0000-4000-8000-000000000032', 'DAAG', 'Algiers', 36.69, 3.21, _active_ts, 'METAR DAAG ACTIVE');

        -- 5. source_runs
        INSERT INTO public.source_runs (id, contract_key, contract_version, trigger_kind, idempotency_key, scheduled_for, started_at, finished_at, outcome, records_seen) VALUES
          ('40000000-0000-4000-8000-000000000041', 'e2e.cold.six', 1, 'manual', 'e2e-cold-run-old', _old_ts, _old_ts, _old_ts + interval '1 min', 'succeeded', 1),
          ('40000000-0000-4000-8000-000000000042', 'e2e.cold.six', 1, 'manual', 'e2e-cold-run-active', _active_ts, _active_ts, _active_ts + interval '1 min', 'succeeded', 1);

        -- 6. source_jobs
        INSERT INTO public.source_jobs (id, contract_key, contract_version, trigger_kind, idempotency_key, scheduled_for, data_from, data_through, execution_target, enqueued_by, available_at, state, max_attempts, retry_base_seconds, retry_until, created_at, updated_at) VALUES
          ('40000000-0000-4000-8000-000000000051', 'e2e.cold.six', 1, 'manual', 'e2e-cold-job-old', _old_ts, _old_ts - interval '5 minutes', _old_ts, 'worker', array['worker'], _old_ts, 'succeeded', 3, 60, _old_ts + interval '1 hour', _old_ts, _old_ts),
          ('40000000-0000-4000-8000-000000000052', 'e2e.cold.six', 1, 'manual', 'e2e-cold-job-active', _active_ts, _active_ts - interval '5 minutes', _active_ts, 'worker', array['worker'], _active_ts, 'succeeded', 3, 60, _active_ts + interval '1 hour', _active_ts, _active_ts);

        -- Verify 2026-08-27 row appears in cold_candidates for weather_snapshots
        IF NOT EXISTS (
          SELECT 1 FROM private.cold_candidates('weather_snapshots', DATE '2026-08-27')
          WHERE id = '40000000-0000-4000-8000-000000000002'
        ) THEN
          RAISE EXCEPTION '2026-08-27 candidate missing';
        END IF;

        -- Archive & commit all 6 tables for _old_day
        FOREACH _t IN ARRAY ARRAY['weather_snapshots', 'risk_forecasts', 'broadcast_audit', 'airport_observations', 'source_runs', 'source_jobs'] LOOP
          SELECT count(*), md5(string_agg(id::text, ',' ORDER BY id::text COLLATE "C"))
          INTO _cnt, _dig
          FROM private.cold_candidates(_t, _old_day);

          IF _cnt < 1 THEN
            RAISE EXCEPTION 'Expected >= 1 candidate for % on %', _t, _old_day;
          END IF;

          _path := format('cold/%s/%s.parquet', _t, to_char(_old_day, 'YYYY/MM/DD'));
          INSERT INTO storage.objects (bucket_id, name, metadata)
          VALUES ('cold-archive', _path, '{"size": 128}'::jsonb)
          ON CONFLICT DO NOTHING;

          _del := public.cold_archive_commit(_t, _old_day, _cnt, _dig, repeat('a', 64), 128, _path);
          IF _del <> _cnt THEN
            RAISE EXCEPTION 'Expected % deleted rows for %, got %', _cnt, _t, _del;
          END IF;
        END LOOP;
      END $$;

      SELECT json_build_object(
        'old_remaining',
          (SELECT count(*) FROM public.weather_snapshots WHERE id = '40000000-0000-4000-8000-000000000001') +
          (SELECT count(*) FROM public.risk_forecasts WHERE id = '40000000-0000-4000-8000-000000000012') +
          (SELECT count(*) FROM public.broadcast_audit WHERE id = '40000000-0000-4000-8000-000000000021') +
          (SELECT count(*) FROM public.airport_observations WHERE id = '40000000-0000-4000-8000-000000000031') +
          (SELECT count(*) FROM public.source_runs WHERE id = '40000000-0000-4000-8000-000000000041') +
          (SELECT count(*) FROM public.source_jobs WHERE id = '40000000-0000-4000-8000-000000000051'),
        'active_preserved',
          (SELECT count(*) FROM public.weather_snapshots WHERE id = '40000000-0000-4000-8000-000000000003') +
          (SELECT count(*) FROM public.risk_forecasts WHERE id = '40000000-0000-4000-8000-000000000013') +
          (SELECT count(*) FROM public.broadcast_audit WHERE id = '40000000-0000-4000-8000-000000000022') +
          (SELECT count(*) FROM public.airport_observations WHERE id = '40000000-0000-4000-8000-000000000032') +
          (SELECT count(*) FROM public.source_runs WHERE id = '40000000-0000-4000-8000-000000000042') +
          (SELECT count(*) FROM public.source_jobs WHERE id = '40000000-0000-4000-8000-000000000052'),
        'exports_recorded',
          (SELECT count(*) FROM public.cold_exports WHERE day = DATE '2026-08-20')
      )::text
    `);

    const parsed = JSON.parse(out.split("\n").pop()?.trim() ?? "{}") as {
      old_remaining: number;
      active_preserved: number;
      exports_recorded: number;
    };
    expect(parsed.old_remaining).toBe(0);
    expect(parsed.active_preserved).toBe(6);
    expect(parsed.exports_recorded).toBe(6);
  });

  it("F5.4: source_runs cold-archive deletion retires idempotency keys into public.source_run_retired_keys", () => {
    assertPgReachable();

    const out = runInRolledBackTx(`
      DO $$
      DECLARE
        _day date := DATE '2026-08-19';
        _ts timestamptz := TIMESTAMPTZ '2026-08-19T05:00:00Z';
        _cnt bigint;
        _dig text;
        _path text := 'cold/source_runs/2026/08/19.parquet';
      BEGIN
        INSERT INTO public.source_contracts (
          key, version, label, family, criticality, freshness_basis,
          cadence_minutes, warning_after_minutes, stale_after_minutes,
          parser_version, licence, attribution, owner
        ) VALUES (
          'e2e.cold.retire', 1, 'Retire Test', 'reference_enrichment', 'optional', 'last_success_at',
          5, 10, 20, '1', 'test', 'test', 'test'
        );

        INSERT INTO public.source_runs (
          id, contract_key, contract_version, trigger_kind, idempotency_key,
          scheduled_for, started_at, finished_at, outcome, records_seen
        ) VALUES (
          '40000000-0000-4000-8000-000000000091',
          'e2e.cold.retire', 1, 'manual', 'e2e-retired-idempotency-key-91',
          _ts, _ts, _ts + interval '1 min', 'succeeded', 1
        );

        SELECT count(*), md5(string_agg(id::text, ',' ORDER BY id::text COLLATE "C"))
        INTO _cnt, _dig
        FROM private.cold_candidates('source_runs', _day);

        INSERT INTO storage.objects (bucket_id, name, metadata)
        VALUES ('cold-archive', _path, '{"size": 64}'::jsonb)
        ON CONFLICT DO NOTHING;

        PERFORM public.cold_archive_commit('source_runs', _day, _cnt, _dig, repeat('b', 64), 64, _path);
      END $$;

      SELECT count(*) FROM public.source_run_retired_keys
      WHERE idempotency_key = 'e2e-retired-idempotency-key-91'
    `);

    expect(out.split("\n").pop()?.trim()).toBe("1");
  });

  it("F5.5: broadcast_audit blocks UPDATE unconditionally and permits DELETE only when private.cold_archived is true", () => {
    assertPgReachable();

    const out = runInRolledBackTx(`
      DO $$
      DECLARE
        _unarchived_del_blocked boolean := false;
        _update_blocked boolean := false;
      BEGIN
        INSERT INTO public.broadcast_audit (id, at, action, reason)
        VALUES ('40000000-0000-4000-8000-000000000077', TIMESTAMPTZ '2026-08-18T05:00:00Z', 'suppressed', 'e2e_audit_guard');

        BEGIN
          DELETE FROM public.broadcast_audit WHERE id = '40000000-0000-4000-8000-000000000077';
        EXCEPTION WHEN raise_exception THEN
          _unarchived_del_blocked := true;
        END;

        BEGIN
          UPDATE public.broadcast_audit SET reason = 'mutated' WHERE id = '40000000-0000-4000-8000-000000000077';
        EXCEPTION WHEN raise_exception THEN
          _update_blocked := true;
        END;

        IF NOT _unarchived_del_blocked THEN
          RAISE EXCEPTION 'Expected unarchived DELETE to be blocked';
        END IF;
        IF NOT _update_blocked THEN
          RAISE EXCEPTION 'Expected UPDATE to be blocked';
        END IF;

        INSERT INTO public.cold_exports (table_name, day, rows, key_digest, sha256, bytes, path)
        VALUES (
          'broadcast_audit', DATE '2026-08-18', 1,
          md5('40000000-0000-4000-8000-000000000077'), repeat('c', 64), 64,
          'cold/broadcast_audit/2026/08/18.parquet'
        );

        -- UPDATE must still be blocked even after archiving
        _update_blocked := false;
        BEGIN
          UPDATE public.broadcast_audit SET reason = 'mutated_after_archive' WHERE id = '40000000-0000-4000-8000-000000000077';
        EXCEPTION WHEN raise_exception THEN
          _update_blocked := true;
        END;
        IF NOT _update_blocked THEN
          RAISE EXCEPTION 'Expected UPDATE to remain blocked even when archived';
        END IF;

        -- DELETE now succeeds because private.cold_archived('broadcast_audit', old.at) is true
        DELETE FROM public.broadcast_audit WHERE id = '40000000-0000-4000-8000-000000000077';
      END $$;

      SELECT count(*) FROM public.broadcast_audit WHERE id = '40000000-0000-4000-8000-000000000077'
    `);

    expect(out.split("\n").pop()?.trim()).toBe("0");
  });

  it("F5.6: private cold-archive storage bucket (public=false) and read-only cold_reader role exist in Postgres", () => {
    assertPgReachable();

    const buckets = psqlJson<{ id: string; public: boolean }>(`
      SELECT id, public FROM storage.buckets WHERE id = 'cold-archive'
    `);
    expect(buckets).toEqual([{ id: "cold-archive", public: false }]);

    const roles = psqlJson<{ rolname: string; rolconfig: string[] | null }>(`
      SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'cold_reader'
    `);
    expect(roles).toHaveLength(1);
    expect(roles[0]?.rolconfig ?? []).toContain(
      "default_transaction_read_only=on",
    );
  });
});

describe("Tier 1 — F6: Android app.nadhir Play Production Readiness", () => {
  it("F6.1: capacitor.config.ts specifies appId='app.nadhir', webDir='dist/client', and allowMixedContent=false", async () => {
    const capMod = await importRepoModule<{
      default: {
        appId?: string;
        webDir?: string;
        android?: { allowMixedContent?: boolean };
      };
    }>("capacitor.config.ts");

    expect(capMod.default.appId).toBe("app.nadhir");
    expect(capMod.default.webDir).toBe("dist/client");
    expect(capMod.default.android?.allowMixedContent).toBe(false);
  });

  it("F6.2: android/app/src/main/AndroidManifest.xml declares POST_NOTIFICATIONS and supportsRtl='true'", () => {
    const manifest = readRepoFile("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain("android.permission.POST_NOTIFICATIONS");
    expect(manifest).toMatch(/android:supportsRtl\s*=\s*"true"/);
  });

  it("F6.3: NotificationChannels.java and MainActivity.java register all 6 canonical channels from src/lib/notification-channels.ts at startup", async () => {
    const channelsMod = await importRepoModule<{
      NOTIFICATION_CHANNEL_IDS: readonly string[];
    }>("src/lib/notification-channels.ts");

    const javaChannels = readRepoFile(
      "android/app/src/main/java/app/nadhir/NotificationChannels.java",
    );
    const mainActivity = readRepoFile(
      "android/app/src/main/java/app/nadhir/MainActivity.java",
    );

    expect(channelsMod.NOTIFICATION_CHANNEL_IDS).toHaveLength(6);
    for (const id of channelsMod.NOTIFICATION_CHANNEL_IDS) {
      expect(
        javaChannels,
        `NotificationChannels.java must define channel "${id}"`,
      ).toContain(`"${id}"`);
    }
    expect(mainActivity).toMatch(/NotificationChannels\./);
  });

  it("F6.4: android/app/build.gradle configures env-driven release signing (zero hardcoded passwords) and valid versionCode/versionName", () => {
    const gradle = readRepoFile("android/app/build.gradle");

    const hasLiteralVersionCode = /versionCode\s+\d+/.test(gradle);
    const hasValidatedEnvVersionCode =
      /versionCode\s+[A-Za-z_][A-Za-z0-9_]*/.test(gradle) &&
      /Integer\.parseInt/.test(gradle) &&
      /rawVersionCode[^\n]*["']\d+["']/.test(gradle);
    expect(
      hasLiteralVersionCode || hasValidatedEnvVersionCode,
      "build.gradle must declare a positive integer or validated env-driven versionCode",
    ).toBe(true);

    const hasLiteralVersionName = /versionName\s+["'][^"']+["']/.test(gradle);
    const hasValidatedEnvVersionName =
      /versionName\s+[A-Za-z_][A-Za-z0-9_]*/.test(gradle) &&
      /resolvedVersionName[^\n]*["']\d+\.\d+\.\d+["']/.test(gradle);
    expect(
      hasLiteralVersionName || hasValidatedEnvVersionName,
      "build.gradle must declare a valid semver or validated env-driven versionName",
    ).toBe(true);

    expect(gradle).toMatch(/signingConfigs/);
    expect(gradle).toMatch(/System\.getenv|findProperty|project\.hasProperty/);
    expect(gradle).not.toMatch(/storePassword\s+["'][^$"']{4,}["']/);
    expect(gradle).not.toMatch(/keyPassword\s+["'][^$"']{4,}["']/);
  });

  it("F6.5: public/.well-known/assetlinks.json exists with valid Digital Asset Links structure for app.nadhir", () => {
    expect(repoFileExists("public/.well-known/assetlinks.json")).toBe(true);
    const links = readRepoJson<
      Array<{
        relation?: string[];
        target?: {
          namespace?: string;
          package_name?: string;
          sha256_cert_fingerprints?: string[];
        };
      }>
    >("public/.well-known/assetlinks.json");

    expect(Array.isArray(links)).toBe(true);
    expect(links.length).toBeGreaterThan(0);

    const nadhirEntry = links.find(
      (entry) => entry.target?.package_name === "app.nadhir",
    );
    expect(nadhirEntry).toBeDefined();
    expect(nadhirEntry?.target?.namespace).toBe("android_app");
    expect(nadhirEntry?.relation).toContain(
      "delegate_permission/common.handle_all_urls",
    );
    expect(Array.isArray(nadhirEntry?.target?.sha256_cert_fingerprints)).toBe(
      true,
    );
  });

  it("F6.6: docs/store-listing.md documents Play Data Safety and ADR-0006 background location disclosure", () => {
    expect(repoFileExists("docs/store-listing.md")).toBe(true);
    const doc = readRepoFile("docs/store-listing.md");

    expect(doc).toMatch(/Data Safety/i);
    expect(doc).toMatch(/location|commune/i);
    expect(doc).toMatch(/on-device|device|never leaves|ADR-0006/i);
    expect(doc).toMatch(/app\.nadhir/i);
  });
});
