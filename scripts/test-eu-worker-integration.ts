import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { SQL } from "bun";

import type { Database, Json } from "../src/integrations/supabase/types";
import {
  completeWithGatewayResult,
  resetLlmCircuitBreakers,
} from "../src/lib/llm/gateway.server";
import type { ClaimedSourceJob, SourceJobResult } from "../src/lib/source-jobs";
import {
  claimSourceJob,
  completeSourceJob,
  enqueueDueSourceJobs,
  renewSourceJobLease,
  requeueExpiredSourceJobs,
} from "../src/lib/source-jobs.server";
import { runItaFacebookSourceWith } from "../src/lib/text-sources/ita-facebook.server";
import { startHealthServer } from "../worker/src/health";
import { EUWorker } from "../worker/src/runner";

function loadLocalSupabaseEnv(): Record<string, string> {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const result: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match || !match[1] || match[2] === undefined) continue;
    result[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return result;
}

function assertLoopbackUrl(raw: string, label: string): URL {
  const parsed = new URL(raw);
  assert(
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname),
    `${label} must point to a local loopback host (got ${parsed.hostname})`,
  );
  return parsed;
}

function isLoopbackUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

const explicitUrl = process.env["WORKER_TEST_SUPABASE_URL"];
const explicitKey = process.env["WORKER_TEST_SUPABASE_SERVICE_ROLE_KEY"];
const envSupabaseIsLocal =
  isLoopbackUrl(process.env["SUPABASE_URL"]) &&
  Boolean(process.env["SUPABASE_SERVICE_ROLE_KEY"]);
const statusEnv =
  explicitUrl || envSupabaseIsLocal ? {} : loadLocalSupabaseEnv();

const supabaseUrl =
  explicitUrl ||
  (envSupabaseIsLocal ? process.env["SUPABASE_URL"] : statusEnv["API_URL"]);
const serviceRoleKey =
  explicitKey ||
  (envSupabaseIsLocal
    ? process.env["SUPABASE_SERVICE_ROLE_KEY"]
    : statusEnv["SERVICE_ROLE_KEY"]);
const databaseUrl =
  process.env["WORKER_TEST_DATABASE_URL"] ||
  (isLoopbackUrl(process.env["DATABASE_URL"])
    ? process.env["DATABASE_URL"]
    : statusEnv["DB_URL"]) ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

assert(supabaseUrl, "SUPABASE_URL (or local supabase status API_URL) required");
assert(
  serviceRoleKey,
  "SUPABASE_SERVICE_ROLE_KEY (or local supabase status SERVICE_ROLE_KEY) required",
);

assertLoopbackUrl(supabaseUrl, "SUPABASE_URL");
const dbParsed = assertLoopbackUrl(databaseUrl, "DATABASE_URL");

const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sql = new SQL({
  hostname: dbParsed.hostname,
  port: Number(dbParsed.port || 54322),
  username: dbParsed.username || "postgres",
  password: dbParsed.password || "postgres",
  database: dbParsed.pathname.slice(1) || "postgres",
  max: 2,
  tls: false,
});

const testRunId = crypto.randomUUID().slice(0, 8);
const workerId = `eu-worker-int:${testRunId}`;
const testContractKey = `test_eu_worker_${testRunId}`;
const drainContractKey = `test_eu_drain_${testRunId}`;
const fixturePostId = `eu_worker_fb_${testRunId}`;
const createdJobIds = new Set<string>();

type CheckpointSnapshotRow = {
  contract_key: string;
  last_scheduled_for: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  upstream_published_at: string | null;
  data_from: string | null;
  data_through: string | null;
  validated_at: string | null;
  published_at: string | null;
  replay_cursor: Json | null;
  consecutive_failures: number;
  schema_fingerprint: string | null;
  records_accepted: number;
  records_expected: number | null;
  coverage_status: string;
  fallback_contract_key: string | null;
  last_public_reason_code: string | null;
  updated_at: string;
};

let testStartedAt: string | null = null;
let initialCheckpoints: CheckpointSnapshotRow[] = [];

async function waitFor<T>(
  predicate: () => Promise<T | null | undefined | false>,
  timeoutMs = 10_000,
  intervalMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await Bun.sleep(intervalMs);
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

let healthServer: Awaited<ReturnType<typeof startHealthServer>> | null = null;
let worker: EUWorker | null = null;
let mockPrimaryServer: http.Server | null = null;
let mockFallbackServer: http.Server | null = null;

try {
  // Capture Postgres start timestamp & pre-existing checkpoints BEFORE any writes or worker startup
  const [tsRow] = await sql<{ ts: string }[]>`select now()::text as ts`;
  testStartedAt = tsRow!.ts;
  initialCheckpoints = await sql<CheckpointSnapshotRow[]>`
    select
      contract_key,
      last_scheduled_for::text,
      last_attempt_at::text,
      last_success_at::text,
      upstream_published_at::text,
      data_from::text,
      data_through::text,
      validated_at::text,
      published_at::text,
      replay_cursor,
      consecutive_failures,
      schema_fingerprint,
      records_accepted,
      records_expected,
      coverage_status,
      fallback_contract_key,
      last_public_reason_code,
      updated_at::text
    from public.source_checkpoints
  `;

  // Isolate from any stale pre-existing worker leases/jobs in local DB
  await sql`delete from public.source_job_leases where contract_key in ('ita_facebook', ${testContractKey}, ${drainContractKey})`;
  await sql`delete from public.source_runs where contract_key in (${testContractKey}, ${drainContractKey})`;
  await sql`delete from public.source_jobs where contract_key in (${testContractKey}, ${drainContractKey})`;
  await sql`delete from public.source_runs where job_id in (select id from public.source_jobs where contract_key = 'ita_facebook' and scheduled_for >= now() - interval '5 minutes')`;
  await sql`delete from public.source_jobs where contract_key = 'ita_facebook' and scheduled_for >= now() - interval '5 minutes'`;
  await sql`delete from public.ita_reports where source_post_id = ${fixturePostId}`;

  // Create two temporary worker-targeted test contracts for retry + drain scenarios
  for (const [key, label] of [
    [testContractKey, "EU Worker Integration Retry Test"],
    [drainContractKey, "EU Worker Integration Drain Test"],
  ] as const) {
    await sql`
      insert into public.source_contracts (
        key, version, label, family, owner, attribution, licence,
        criticality, freshness_basis, expected_coverage, enabled, schedule_enabled,
        cadence_minutes, overlap_minutes, warning_after_minutes, stale_after_minutes,
        schedule_offset_minutes, execution_target, lease_seconds, max_attempts,
        retry_base_seconds, retry_window_minutes, replay_capability, dependency_keys,
        parser_version
      )
      select
        ${key}, 1, ${label}, family, owner, attribution, licence,
        'supporting', freshness_basis, expected_coverage, true, false,
        5, 0, 15, 30,
        0, 'worker', 60, 3,
        1, 15, 'none', '{}', 'int-test-v1'
      from public.source_contracts
      where key = 'ita_facebook'
    `;
  }

  // Track controlled execution behavior per contract
  let retryAttempts = 0;
  const drainStarted = Promise.withResolvers<void>();
  const drainRelease = Promise.withResolvers<void>();

  const executeJob = async (
    job: ClaimedSourceJob,
  ): Promise<SourceJobResult> => {
    createdJobIds.add(job.id);
    if (job.contract_key === "ita_facebook") {
      const fbRun = await runItaFacebookSourceWith({
        fetchPosts: async () => [
          {
            id: fixturePostId,
            uri: "traficalg",
            created_time: "2026-11-24T11:55:00Z",
            message: `EU worker fixture post ${testRunId}: accident RN5 Bouira`,
            region: "Bouira",
            type: ["iAccident"],
          },
        ],
        save: async (posts) => {
          const { data, error } = await supabase.rpc(
            "save_ita_facebook_posts",
            {
              _job: job.id,
              _attempt: job.attempt_count,
              _posts: posts as unknown as Json,
            },
          );
          if (error)
            throw new Error(`save_ita_facebook_posts: ${error.message}`);
          return data;
        },
      });
      assert.equal(fbRun.error, undefined);
      return {
        contractKey: job.contract_key,
        trigger: job.trigger_kind,
        scheduledFor: job.scheduled_for,
        startedAt: job.started_at,
        outcome: "succeeded",
        coverageStatus: "complete",
        recordsSeen: fbRun.fetched,
        recordsInserted: fbRun.stored,
        upstreamPublishedAt: fbRun.newestPostAt,
        dataFrom: job.data_from,
        dataThrough: job.data_through,
        retryDisposition: "none",
      };
    }

    if (job.contract_key === testContractKey) {
      retryAttempts += 1;
      if (retryAttempts === 1) {
        return {
          contractKey: job.contract_key,
          trigger: job.trigger_kind,
          scheduledFor: job.scheduled_for,
          startedAt: job.started_at,
          outcome: "failed",
          coverageStatus: "unknown",
          publicReasonCode: "upstream_unreachable",
          privateDiagnostic: "simulated transient error attempt 1",
          retryDisposition: "transient",
        };
      }
      return {
        contractKey: job.contract_key,
        trigger: job.trigger_kind,
        scheduledFor: job.scheduled_for,
        startedAt: job.started_at,
        outcome: "succeeded",
        coverageStatus: "complete",
        recordsSeen: 3,
        recordsInserted: 3,
        dataFrom: job.data_from,
        dataThrough: job.data_through,
        retryDisposition: "none",
      };
    }

    if (job.contract_key === drainContractKey) {
      drainStarted.resolve();
      await drainRelease.promise;
      return {
        contractKey: job.contract_key,
        trigger: job.trigger_kind,
        scheduledFor: job.scheduled_for,
        startedAt: job.started_at,
        outcome: "succeeded",
        coverageStatus: "complete",
        dataFrom: job.data_from,
        dataThrough: job.data_through,
        retryDisposition: "none",
      };
    }

    // Any other scheduled worker contract enqueued by tick completes cleanly in test mode
    return {
      contractKey: job.contract_key,
      trigger: job.trigger_kind,
      scheduledFor: job.scheduled_for,
      startedAt: job.started_at,
      outcome: "succeeded",
      coverageStatus: "complete",
      dataFrom: job.data_from,
      dataThrough: job.data_through,
      retryDisposition: "none",
    };
  };

  // --- Scenario D (Part 1 & 2): Direct RPC verification for lease renewal & expired lease recovery ---
  const [leaseTestRow] = await sql<{ id: string }[]>`
    insert into public.source_jobs (
      contract_key, contract_version, trigger_kind, idempotency_key,
      scheduled_for, data_from, data_through, execution_target, enqueued_by,
      available_at, max_attempts, retry_base_seconds, retry_until
    ) values (
      ${testContractKey}, 1, 'manual', ${`int:lease:${testRunId}`},
      now(), now() - interval '5 minutes', now(), 'worker', array['worker'],
      now(), 3, 1, now() + interval '15 minutes'
    )
    returning id
  `;
  createdJobIds.add(leaseTestRow!.id);

  const leaseClaimed = await claimSourceJob(supabase, {
    workerId,
    target: "worker",
    contractKey: testContractKey,
  });
  assert(leaseClaimed, "must claim lease test job");

  const [beforeLease] = await sql<{ lease_expires_at: string }[]>`
    select lease_expires_at::text from public.source_job_leases where job_id = ${leaseClaimed.id}::uuid
  `;
  const extendedExpiry = await renewSourceJobLease(supabase, {
    jobId: leaseClaimed.id,
    workerId,
    attempt: leaseClaimed.attempt_count,
    leaseSeconds: 300,
  });
  assert(
    Date.parse(extendedExpiry) > Date.parse(beforeLease!.lease_expires_at),
    "renewSourceJobLease must extend lease_expires_at",
  );

  await assert.rejects(
    () =>
      renewSourceJobLease(supabase, {
        jobId: leaseClaimed.id,
        workerId: "wrong-worker-id",
        attempt: leaseClaimed.attempt_count,
        leaseSeconds: 300,
      }),
    /Could not renew source job/,
  );

  // Expire lease artificially and recover via public.requeue_expired_source_jobs
  await sql`
    update public.source_job_leases
    set leased_at = now() - interval '60 seconds',
        lease_expires_at = now() - interval '5 seconds'
    where job_id = ${leaseClaimed.id}::uuid
  `;
  const recoveredCount = await requeueExpiredSourceJobs(supabase);
  assert(
    recoveredCount >= 1,
    "requeueExpiredSourceJobs must recover expired lease",
  );
  const [afterRecover] = await sql<{ state: string }[]>`
    select state from public.source_jobs where id = ${leaseClaimed.id}::uuid
  `;
  assert.equal(afterRecover?.state, "retry_wait");
  // Clean up lease test job before starting live worker
  await sql`delete from public.source_runs where job_id = ${leaseClaimed.id}::uuid`;
  await sql`delete from public.source_jobs where id = ${leaseClaimed.id}::uuid`;
  console.log(
    "[PASS] Scenario D: renewSourceJobLease + requeueExpiredSourceJobs verified",
  );

  // --- Scenario A: Startup & Real /healthz + /readyz Probes ---
  worker = new EUWorker(
    {
      workerId,
      executionTargets: ["worker"],
      concurrency: 2,
      pollIntervalMs: 100,
      schedulerEnabled: true,
      schedulerIntervalMs: 2_000,
      leaseSeconds: 60,
      jobTimeoutMs: 15_000,
      drainTimeoutMs: 10_000,
    },
    {
      claim: ({ workerId: wid, target, now }) =>
        claimSourceJob(supabase, { workerId: wid, target, now }),
      execute: executeJob,
      complete: (job, wid, result) =>
        completeSourceJob(supabase, job, wid, result),
      enqueueDue: (observedAt) =>
        enqueueDueSourceJobs(supabase, observedAt, "worker"),
      requeueExpired: (now) => requeueExpiredSourceJobs(supabase, now),
      renewLease: (input) => renewSourceJobLease(supabase, input),
      checkDb: async () => {
        const { error } = await supabase
          .from("source_contracts")
          .select("key")
          .limit(1);
        return !error;
      },
      logger: () => {},
    },
  );

  healthServer = await startHealthServer({
    host: "127.0.0.1",
    port: 0,
    getSnapshot: () => worker!.getSnapshot(),
    checkDb: () => worker!.checkDb(),
  });
  const baseUrl = `http://127.0.0.1:${healthServer.port}`;
  worker.start();

  const healthRes = await fetch(`${baseUrl}/healthz`);
  assert.equal(healthRes.status, 200);
  const healthText = await healthRes.text();
  assert(
    !healthText.includes(serviceRoleKey),
    "healthz must never leak service role key",
  );
  const healthJson = JSON.parse(healthText);
  assert.equal(healthJson.status, "ok");
  assert.equal(healthJson.workerId, workerId);

  const readyRes = await fetch(`${baseUrl}/readyz`);
  assert.equal(readyRes.status, 200);
  const readyJson = await readyRes.json();
  assert.equal(readyJson.ready, true);
  console.log(
    "[PASS] Scenario A: EUWorker startup + /healthz & /readyz verified",
  );

  // --- Scenario B: ita_facebook End-to-End (scheduler enqueue -> claim -> save_ita_facebook_posts -> complete) ---
  const fbJob = await waitFor(async () => {
    const [row] = await sql<{ id: string; state: string }[]>`
      select id, state
      from public.source_jobs
      where contract_key = 'ita_facebook'
        and execution_target = 'worker'
        and 'worker' = any(enqueued_by)
        and state = 'succeeded'
        and scheduled_for >= now() - interval '5 minutes'
      order by created_at desc
      limit 1
    `;
    return row ?? null;
  }, 10_000);
  createdJobIds.add(fbJob.id);

  const [savedReport] = await sql<{ id: string; body: string }[]>`
    select id, body from public.ita_reports where source_post_id = ${fixturePostId}
  `;
  assert(
    savedReport,
    "ita_facebook fixture post must be persisted in ita_reports",
  );
  assert(savedReport.body.includes(testRunId));

  const [fbRuns] = await sql<{ count: number }[]>`
    select count(*)::int as count from public.source_runs where job_id = ${fbJob.id}::uuid and outcome = 'succeeded'
  `;
  assert.equal(fbRuns?.count, 1);

  const [fbLeases] = await sql<{ count: number }[]>`
    select count(*)::int as count from public.source_job_leases where job_id = ${fbJob.id}::uuid
  `;
  assert.equal(fbLeases?.count, 0);
  console.log(
    "[PASS] Scenario B: ita_facebook end-to-end Postgres persistence & lease cleanup verified",
  );

  // --- Scenario C: Scheduled/Retry Ingestion Job (transient failure -> retry_wait -> backoff -> succeeded) ---
  const [retryJob] = await sql<{ id: string }[]>`
    insert into public.source_jobs (
      contract_key, contract_version, trigger_kind, idempotency_key,
      scheduled_for, data_from, data_through, execution_target, enqueued_by,
      available_at, max_attempts, retry_base_seconds, retry_until
    ) values (
      ${testContractKey}, 1, 'scheduled', ${`int:retry:${testRunId}`},
      now(), now() - interval '5 minutes', now(), 'worker', array['worker'],
      now(), 3, 1, now() + interval '15 minutes'
    )
    returning id
  `;
  createdJobIds.add(retryJob!.id);

  // Wait for attempt 1 -> retry_wait, then automatic re-claim -> attempt 2 succeeded
  await waitFor(async () => {
    const [row] = await sql<{ state: string; attempt_count: number }[]>`
      select state, attempt_count from public.source_jobs where id = ${retryJob!.id}::uuid
    `;
    return row?.state === "succeeded" && row.attempt_count === 2 ? row : null;
  }, 15_000);

  const retryRuns = await sql<{ attempt: number; outcome: string }[]>`
    select attempt, outcome from public.source_runs
    where job_id = ${retryJob!.id}::uuid
    order by attempt asc
  `;
  assert.deepEqual(
    retryRuns.map((r) => [r.attempt, r.outcome]),
    [
      [1, "failed"],
      [2, "succeeded"],
    ],
  );
  console.log(
    "[PASS] Scenario C: Transient failure -> retry_wait -> automatic retry completion verified",
  );

  // --- Scenario E: Graceful Shutdown Drain ---
  const [drainJob] = await sql<{ id: string }[]>`
    insert into public.source_jobs (
      contract_key, contract_version, trigger_kind, idempotency_key,
      scheduled_for, data_from, data_through, execution_target, enqueued_by,
      available_at, max_attempts, retry_base_seconds, retry_until
    ) values (
      ${drainContractKey}, 1, 'manual', ${`int:drain:1:${testRunId}`},
      now(), now() - interval '5 minutes', now(), 'worker', array['worker'],
      now(), 3, 1, now() + interval '15 minutes'
    )
    returning id
  `;
  createdJobIds.add(drainJob!.id);

  await drainStarted.promise;

  const stopPromise = worker.stop(5_000);
  const drainingRes = await fetch(`${baseUrl}/readyz`);
  assert.equal(drainingRes.status, 503);
  const drainingJson = await drainingRes.json();
  assert.equal(drainingJson.ready, false);
  assert.equal(drainingJson.reason, "draining");

  // Enqueue a second queued job AFTER drain starts; worker must NOT claim it
  const [mustStayQueued] = await sql<{ id: string }[]>`
    insert into public.source_jobs (
      contract_key, contract_version, trigger_kind, idempotency_key,
      scheduled_for, data_from, data_through, execution_target, enqueued_by,
      available_at, max_attempts, retry_base_seconds, retry_until
    ) values (
      ${testContractKey}, 1, 'manual', ${`int:drain:2:${testRunId}`},
      now(), now() - interval '5 minutes', now(), 'worker', array['worker'],
      now(), 3, 1, now() + interval '15 minutes'
    )
    returning id
  `;
  createdJobIds.add(mustStayQueued!.id);
  await Bun.sleep(200);

  drainRelease.resolve();
  const stopResult = await stopPromise;
  assert.deepEqual(stopResult, { drained: true, remaining: 0 });

  const [drainedState] = await sql<{ state: string }[]>`
    select state from public.source_jobs where id = ${drainJob!.id}::uuid
  `;
  assert.equal(drainedState?.state, "succeeded");
  const [queuedState] = await sql<{ state: string }[]>`
    select state from public.source_jobs where id = ${mustStayQueued!.id}::uuid
  `;
  assert.equal(queuedState?.state, "queued");
  console.log(
    "[PASS] Scenario E: Graceful shutdown drain + /readyz 503 verified",
  );

  // --- Scenario F: Real HTTP F4 Automatic LLM API Fallback End-to-End ---
  resetLlmCircuitBreakers();
  mockPrimaryServer = http.createServer((_req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ reason: "login_expired" }));
  });
  mockFallbackServer = http.createServer((req, res) => {
    assert.equal(req.headers["authorization"], "Bearer sk-local-eu-fallback");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"mentions":[]}',
            },
          },
        ],
      }),
    );
  });

  await new Promise<void>((resolve) =>
    mockPrimaryServer!.listen(0, "127.0.0.1", resolve),
  );
  await new Promise<void>((resolve) =>
    mockFallbackServer!.listen(0, "127.0.0.1", resolve),
  );
  const primaryPort = (mockPrimaryServer.address() as AddressInfo).port;
  const fallbackPort = (mockFallbackServer.address() as AddressInfo).port;

  const llmResult = await completeWithGatewayResult(
    "extract_dgpc",
    {
      messages: [
        { role: "system", content: "Return JSON." },
        { role: "user", content: "Test post" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "fire_mentions",
          strict: true,
          schema: {
            type: "object",
            properties: {
              mentions: { type: "array", items: { type: "string" } },
            },
            required: ["mentions"],
            additionalProperties: false,
          },
        },
      },
    },
    {
      config: {
        url: `http://127.0.0.1:${primaryPort}`,
        clientId: "local-id",
        clientSecret: "local-secret",
      },
      fallback: [
        {
          id: "local-eu-mistral",
          provider: "openai-compatible",
          apiUrl: `http://127.0.0.1:${fallbackPort}/v1/chat/completions`,
          apiKey: "sk-local-eu-fallback",
          model: "mistral-small-latest",
        },
      ],
    },
  );
  assert.equal(llmResult.text, '{"mentions":[]}');
  assert.equal(llmResult.provenance.fallbackUsed, true);
  assert.equal(llmResult.provenance.primaryErrorKind, "login_expired");
  assert.equal(llmResult.provenance.providerId, "local-eu-mistral");
  console.log(
    "[PASS] Scenario F: Real HTTP F4 automatic LLM fallback verified",
  );
  console.log("ALL EU WORKER + LLM FALLBACK INTEGRATION SCENARIOS PASSED");
} finally {
  // 1. Stop EUWorker & close health/mock HTTP servers first so no background tick writes after cleanup starts.
  if (worker) await worker.stop(2_000).catch(() => {});
  if (healthServer) await healthServer.close().catch(() => {});
  if (mockPrimaryServer) {
    await new Promise<void>((resolve) =>
      mockPrimaryServer!.close(() => resolve()),
    );
  }
  if (mockFallbackServer) {
    await new Promise<void>((resolve) =>
      mockFallbackServer!.close(() => resolve()),
    );
  }
  resetLlmCircuitBreakers();

  // 2. Delete fixture ita_reports row.
  await sql`delete from public.ita_reports where source_post_id = ${fixturePostId}`;

  // 3. Delete source_job_leases touched by test contracts, workerId, or since testStartedAt.
  if (testStartedAt) {
    await sql`
      delete from public.source_job_leases
      where contract_key in (${testContractKey}, ${drainContractKey})
        or worker_id = ${workerId}
        or leased_at >= ${testStartedAt}::timestamptz
    `;
  } else {
    await sql`
      delete from public.source_job_leases
      where contract_key in (${testContractKey}, ${drainContractKey})
        or worker_id = ${workerId}
    `;
  }

  // 4. Clear bidirectional FKs (source_jobs.gap_id and source_gaps.resolved_by_run_id) before deleting runs/gaps/jobs.
  for (const jobId of createdJobIds) {
    await sql`
      update public.source_gaps
      set resolved_by_run_id = null
      where resolved_by_run_id in (
        select id from public.source_runs where job_id = ${jobId}::uuid
      )
    `;
    await sql`update public.source_jobs set gap_id = null where id = ${jobId}::uuid`;
  }
  if (testStartedAt) {
    await sql`
      update public.source_jobs
      set gap_id = null
      where contract_key in (${testContractKey}, ${drainContractKey})
        or created_at >= ${testStartedAt}::timestamptz
        or updated_at >= ${testStartedAt}::timestamptz
        or 'worker' = any(enqueued_by)
        or gap_id in (
          select id from public.source_gaps
          where contract_key in (${testContractKey}, ${drainContractKey})
            or detected_at >= ${testStartedAt}::timestamptz
            or updated_at >= ${testStartedAt}::timestamptz
        )
    `;
    await sql`
      update public.source_gaps
      set resolved_by_run_id = null
      where contract_key in (${testContractKey}, ${drainContractKey})
        or detected_at >= ${testStartedAt}::timestamptz
        or updated_at >= ${testStartedAt}::timestamptz
        or resolved_by_run_id in (
          select id from public.source_runs
          where contract_key in (${testContractKey}, ${drainContractKey})
            or created_at >= ${testStartedAt}::timestamptz
            or job_id in (
              select id from public.source_jobs
              where created_at >= ${testStartedAt}::timestamptz
                or updated_at >= ${testStartedAt}::timestamptz
                or 'worker' = any(enqueued_by)
            )
        )
    `;
  } else {
    await sql`update public.source_jobs set gap_id = null where contract_key in (${testContractKey}, ${drainContractKey})`;
    await sql`update public.source_gaps set resolved_by_run_id = null where contract_key in (${testContractKey}, ${drainContractKey})`;
  }

  // 5. Delete source_runs.
  for (const jobId of createdJobIds) {
    await sql`delete from public.source_runs where job_id = ${jobId}::uuid`;
  }
  if (testStartedAt) {
    await sql`
      delete from public.source_runs
      where contract_key in (${testContractKey}, ${drainContractKey})
        or created_at >= ${testStartedAt}::timestamptz
        or job_id in (
          select id from public.source_jobs
          where created_at >= ${testStartedAt}::timestamptz
            or updated_at >= ${testStartedAt}::timestamptz
            or 'worker' = any(enqueued_by)
        )
    `;
  } else {
    await sql`delete from public.source_runs where contract_key in (${testContractKey}, ${drainContractKey})`;
  }

  // 6. Delete source_gaps.
  if (testStartedAt) {
    await sql`
      delete from public.source_gaps
      where contract_key in (${testContractKey}, ${drainContractKey})
        or detected_at >= ${testStartedAt}::timestamptz
    `;
  } else {
    await sql`delete from public.source_gaps where contract_key in (${testContractKey}, ${drainContractKey})`;
  }

  // 7. Delete source_jobs.
  for (const jobId of createdJobIds) {
    await sql`delete from public.source_jobs where id = ${jobId}::uuid`;
  }
  if (testStartedAt) {
    await sql`
      delete from public.source_jobs
      where contract_key in (${testContractKey}, ${drainContractKey})
        or created_at >= ${testStartedAt}::timestamptz
        or updated_at >= ${testStartedAt}::timestamptz
        or 'worker' = any(enqueued_by)
    `;
  } else {
    await sql`delete from public.source_jobs where contract_key in (${testContractKey}, ${drainContractKey})`;
  }

  // 8. Clean up source_checkpoints touched during the test and restore any pre-existing seeded checkpoints.
  if (testStartedAt) {
    await sql`
      delete from public.source_checkpoints
      where contract_key in (${testContractKey}, ${drainContractKey})
        or updated_at >= ${testStartedAt}::timestamptz
    `;
    for (const cp of initialCheckpoints) {
      if (
        cp.contract_key === testContractKey ||
        cp.contract_key === drainContractKey
      ) {
        continue;
      }
      await sql`
        insert into public.source_checkpoints (
          contract_key,
          last_scheduled_for,
          last_attempt_at,
          last_success_at,
          upstream_published_at,
          data_from,
          data_through,
          validated_at,
          published_at,
          replay_cursor,
          consecutive_failures,
          schema_fingerprint,
          records_accepted,
          records_expected,
          coverage_status,
          fallback_contract_key,
          last_public_reason_code,
          updated_at
        ) values (
          ${cp.contract_key},
          ${cp.last_scheduled_for}::timestamptz,
          ${cp.last_attempt_at}::timestamptz,
          ${cp.last_success_at}::timestamptz,
          ${cp.upstream_published_at}::timestamptz,
          ${cp.data_from}::timestamptz,
          ${cp.data_through}::timestamptz,
          ${cp.validated_at}::timestamptz,
          ${cp.published_at}::timestamptz,
          ${cp.replay_cursor === null ? null : JSON.stringify(cp.replay_cursor)}::jsonb,
          ${cp.consecutive_failures},
          ${cp.schema_fingerprint},
          ${cp.records_accepted},
          ${cp.records_expected},
          ${cp.coverage_status},
          ${cp.fallback_contract_key},
          ${cp.last_public_reason_code},
          ${cp.updated_at}::timestamptz
        )
        on conflict (contract_key) do nothing
      `;
    }
  } else {
    await sql`delete from public.source_checkpoints where contract_key in (${testContractKey}, ${drainContractKey})`;
  }

  // 9. Delete temporary test contracts.
  await sql`delete from public.source_contracts where key in (${testContractKey}, ${drainContractKey})`;
  await sql.close();
}
