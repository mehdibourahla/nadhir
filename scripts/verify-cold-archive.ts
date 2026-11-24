import assert from "node:assert/strict";
import { execFile, execSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { SQL } from "bun";
import type { Database } from "../src/integrations/supabase/types";
import {
  archiveColdDays,
  COLD_TABLES,
  type ColdArchiveDeps,
  coldPath,
  type ColdTable,
  exportSql,
  isColdTable,
  readBackSql,
  sha256,
  type Summary,
  trialColdDay,
} from "../src/lib/cold-archive";
import {
  assertLoopbackDatabaseUrl,
  assertLoopbackHttpUrl,
  COLD_TABLE_CONFIG,
  computeColdCutoff,
  computeKeyDigest,
  parseVerifyColdArchiveArgs,
  readBackCanonicalNdjson,
  type ResolvedVerifyMode,
  resolveVerifyMode,
  serializeCanonicalNdjson,
  shiftUtcDay,
  verifyExportArtifact,
} from "../src/lib/cold-archive-verify";

const execFileAsync = promisify(execFile);
const BUCKET = "cold-archive";

function printHelp(): void {
  console.log(`Usage: bun run archive:cold:verify [options]

Options:
  --dry-run             Inspect cutoff windows & candidate counts without deleting or uploading
  --as-of YYYY-MM-DD    Reference UTC date for dry-run inspection (default: 2026-11-26)
  --mode auto|duckdb|ts Export/readback engine (default: auto)
  --no-seed             Skip seeding fixtures in --dry-run mode (inspect existing DB rows only)
  --json                Emit machine-readable JSON summary on stdout
  -h, --help            Show this help text`);
}

function loadLocalSupabaseEnv(): Record<string, string> {
  const out = execSync("supabase status -o env", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const result: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match || !match[1] || match[2] === undefined) continue;
    result[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return result;
}

function isLoopbackUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
      parsed.hostname.toLowerCase(),
    );
  } catch {
    return false;
  }
}

async function detectDuckdb(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ["--version"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

type CheckpointRow = {
  key: string;
  snapshot_id: string;
  base_date: string;
  scheduled_for: string;
  published_at: string;
  coverage_status: string;
};

type ColdExportKey = {
  table_name: string;
  day: string;
};

type FixtureTracker = {
  contractKeys: string[];
  itaReportIds: string[];
  civilInvestigationIds: string[];
  sourceGapIds: string[];
  sourceRunIds: string[];
  retiredKeys: string[];
  sourceJobIds: string[];
  weatherSnapshotIds: string[];
  airportObservationIds: string[];
  riskForecastIds: string[];
  riskPublicationIds: string[];
  broadcastAuditIds: string[];
  broadcastAuditDays: Set<string>;
  riskForecastDays: Set<string>;
  uploadedPaths: Set<string>;
};

function createTracker(): FixtureTracker {
  return {
    contractKeys: [],
    itaReportIds: [],
    civilInvestigationIds: [],
    sourceGapIds: [],
    sourceRunIds: [],
    retiredKeys: [],
    sourceJobIds: [],
    weatherSnapshotIds: [],
    airportObservationIds: [],
    riskForecastIds: [],
    riskPublicationIds: [],
    broadcastAuditIds: [],
    broadcastAuditDays: new Set<string>(),
    riskForecastDays: new Set<string>(),
    uploadedPaths: new Set<string>(),
  };
}

type SeededMatrix = {
  contractKey: string;
  eligible90: string;
  hot90: string;
  hot90Next: string;
  eligible92: string;
  hot92: string;
  hot92Next: string;
  emptyRunsDay: string;
  ids: {
    weatherEligible1: string;
    weatherEligible2: string;
    weatherHotBoundary: string;
    weatherHotFk: string;
    pubHistorical: string;
    pubCheckpoint: string;
    pubHotBoundary: string;
    pubHotNext: string;
    riskHistorical: string;
    riskCheckpoint: string;
    riskLegacyNull: string;
    riskHotBoundary: string;
    riskHotNext: string;
    auditEligible1: string;
    auditEligible2: string;
    auditHotBoundary: string;
    auditHotNext: string;
    airportEligible1: string;
    airportEligible2: string;
    airportHotBoundary: string;
    airportHotNext: string;
    runOldest: string;
    runCascade: string;
    runRunning: string;
    runGapResolved: string;
    runHotBoundary: string;
    runHotFk: string;
    jobSucceeded: string;
    jobFailed: string;
    jobQueued: string;
    jobRunning: string;
    jobRetryWait: string;
    jobCascade: string;
    jobFkRun: string;
    jobFkWeather: string;
    jobFkCivil: string;
    jobHotBoundary: string;
    jobHotNext: string;
    itaReport: string;
    civilInvestigation: string;
    sourceGap: string;
  };
  keys: {
    runOldest: string;
    runCascade: string;
    runRunning: string;
    runGapResolved: string;
    runHotBoundary: string;
    runHotFk: string;
  };
};

type DryRunTableReport = {
  table: ColdTable;
  hotDays: number;
  lastEligibleDay: string;
  firstHotDay: string;
  pendingDays: string[];
  eligibleCount: number;
  fkOrStateProtectedCount: number;
  hotCount: number;
};

async function seedCutoffMatrix(
  sql: SQL,
  communeId: string,
  tag: string,
  dates: {
    eligible90: string;
    hot90: string;
    hot90Next: string;
    eligible92: string;
    hot92: string;
    hot92Next: string;
  },
  tracker: FixtureTracker,
): Promise<SeededMatrix> {
  const uid = () => crypto.randomUUID();
  const contractKey = `test_cold_verify_${tag}`;
  tracker.contractKeys.push(contractKey);

  const ids = {
    weatherEligible1: uid(),
    weatherEligible2: uid(),
    weatherHotBoundary: uid(),
    weatherHotFk: uid(),
    pubHistorical: uid(),
    pubCheckpoint: uid(),
    pubHotBoundary: uid(),
    pubHotNext: uid(),
    riskHistorical: uid(),
    riskCheckpoint: uid(),
    riskLegacyNull: uid(),
    riskHotBoundary: uid(),
    riskHotNext: uid(),
    auditEligible1: uid(),
    auditEligible2: uid(),
    auditHotBoundary: uid(),
    auditHotNext: uid(),
    airportEligible1: uid(),
    airportEligible2: uid(),
    airportHotBoundary: uid(),
    airportHotNext: uid(),
    runOldest: uid(),
    runCascade: uid(),
    runRunning: uid(),
    runGapResolved: uid(),
    runHotBoundary: uid(),
    runHotFk: uid(),
    jobSucceeded: uid(),
    jobFailed: uid(),
    jobQueued: uid(),
    jobRunning: uid(),
    jobRetryWait: uid(),
    jobCascade: uid(),
    jobFkRun: uid(),
    jobFkWeather: uid(),
    jobFkCivil: uid(),
    jobHotBoundary: uid(),
    jobHotNext: uid(),
    itaReport: uid(),
    civilInvestigation: uid(),
    sourceGap: uid(),
  };

  const keys = {
    runOldest: `cold-verify-${tag}-run-oldest`,
    runCascade: `cold-verify-${tag}-run-cascade`,
    runRunning: `cold-verify-${tag}-run-running`,
    runGapResolved: `cold-verify-${tag}-run-gap`,
    runHotBoundary: `cold-verify-${tag}-run-hot-boundary`,
    runHotFk: `cold-verify-${tag}-run-hot-fk`,
  };

  tracker.itaReportIds.push(ids.itaReport);
  tracker.civilInvestigationIds.push(ids.civilInvestigation);
  tracker.sourceGapIds.push(ids.sourceGap);
  tracker.sourceRunIds.push(
    ids.runOldest,
    ids.runCascade,
    ids.runRunning,
    ids.runGapResolved,
    ids.runHotBoundary,
    ids.runHotFk,
  );
  tracker.retiredKeys.push(
    keys.runOldest,
    keys.runCascade,
    keys.runRunning,
    keys.runGapResolved,
    keys.runHotBoundary,
    keys.runHotFk,
  );
  tracker.sourceJobIds.push(
    ids.jobSucceeded,
    ids.jobFailed,
    ids.jobQueued,
    ids.jobRunning,
    ids.jobRetryWait,
    ids.jobCascade,
    ids.jobFkRun,
    ids.jobFkWeather,
    ids.jobFkCivil,
    ids.jobHotBoundary,
    ids.jobHotNext,
  );
  tracker.weatherSnapshotIds.push(
    ids.weatherEligible1,
    ids.weatherEligible2,
    ids.weatherHotBoundary,
    ids.weatherHotFk,
  );
  tracker.airportObservationIds.push(
    ids.airportEligible1,
    ids.airportEligible2,
    ids.airportHotBoundary,
    ids.airportHotNext,
  );
  tracker.riskPublicationIds.push(
    ids.pubHistorical,
    ids.pubCheckpoint,
    ids.pubHotBoundary,
    ids.pubHotNext,
  );
  tracker.riskForecastIds.push(
    ids.riskHistorical,
    ids.riskCheckpoint,
    ids.riskLegacyNull,
    ids.riskHotBoundary,
    ids.riskHotNext,
  );
  tracker.broadcastAuditIds.push(
    ids.auditEligible1,
    ids.auditEligible2,
    ids.auditHotBoundary,
    ids.auditHotNext,
  );
  for (const d of [dates.eligible90, dates.hot90, dates.hot90Next]) {
    tracker.broadcastAuditDays.add(d);
    tracker.riskForecastDays.add(d);
  }

  const evidenceJson = JSON.stringify({
    source: "open-meteo",
    model: "best_match",
    hours: Array.from({ length: 48 }, (_, h) => ({ h, temp_c: 27 })),
  });
  const contentHash = sha256(new TextEncoder().encode(`cold-verify-${tag}`));

  await sql.begin(async (tx) => {
    await tx`
      insert into public.source_contracts (
        key, version, label, family, owner, attribution, licence,
        criticality, freshness_basis, expected_coverage, enabled, schedule_enabled,
        cadence_minutes, overlap_minutes, warning_after_minutes, stale_after_minutes,
        schedule_offset_minutes, execution_target, lease_seconds, max_attempts,
        retry_base_seconds, retry_window_minutes, replay_capability, dependency_keys,
        parser_version
      )
      select
        ${contractKey}, 1, ${`Cold Verify ${tag}`}, family, owner, attribution, licence,
        'optional', freshness_basis, expected_coverage, true, false,
        5, 0, 15, 30,
        0, 'worker', 60, 3,
        5, 15, 'none', '{}', 'cold-verify-v1'
      from public.source_contracts
      where key = 'ita_facebook'
    `;

    const jobs: Array<{
      id: string;
      key: string;
      state: "succeeded" | "failed" | "queued" | "running" | "retry_wait";
      createdAt: string;
      attempts: number;
      startedAt: string | null;
      finishedAt: string | null;
    }> = [
      {
        id: ids.jobSucceeded,
        key: `cold-verify-${tag}-job-succeeded`,
        state: "succeeded",
        createdAt: `${dates.eligible92}T05:00:00Z`,
        attempts: 1,
        startedAt: `${dates.eligible92}T05:00:01Z`,
        finishedAt: `${dates.eligible92}T05:00:10Z`,
      },
      {
        id: ids.jobFailed,
        key: `cold-verify-${tag}-job-failed`,
        state: "failed",
        createdAt: `${dates.eligible92}T23:59:59Z`,
        attempts: 3,
        startedAt: `${dates.eligible92}T23:59:59Z`,
        finishedAt: `${dates.hot92}T00:00:05Z`,
      },
      {
        id: ids.jobQueued,
        key: `cold-verify-${tag}-job-queued`,
        state: "queued",
        createdAt: `${dates.eligible92}T06:00:00Z`,
        attempts: 0,
        startedAt: null,
        finishedAt: null,
      },
      {
        id: ids.jobRunning,
        key: `cold-verify-${tag}-job-running`,
        state: "running",
        createdAt: `${dates.eligible92}T07:00:00Z`,
        attempts: 1,
        startedAt: `${dates.eligible92}T07:00:01Z`,
        finishedAt: null,
      },
      {
        id: ids.jobRetryWait,
        key: `cold-verify-${tag}-job-retry`,
        state: "retry_wait",
        createdAt: `${dates.eligible92}T08:00:00Z`,
        attempts: 1,
        startedAt: `${dates.eligible92}T08:00:01Z`,
        finishedAt: null,
      },
      {
        id: ids.jobCascade,
        key: `cold-verify-${tag}-job-cascade`,
        state: "succeeded",
        createdAt: `${dates.eligible92}T09:00:00Z`,
        attempts: 1,
        startedAt: `${dates.eligible92}T09:00:01Z`,
        finishedAt: `${dates.eligible92}T09:00:05Z`,
      },
      {
        id: ids.jobFkRun,
        key: `cold-verify-${tag}-job-fk-run`,
        state: "succeeded",
        createdAt: `${dates.eligible92}T10:00:00Z`,
        attempts: 1,
        startedAt: `${dates.eligible92}T10:00:01Z`,
        finishedAt: `${dates.eligible92}T10:00:05Z`,
      },
      {
        id: ids.jobFkWeather,
        key: `cold-verify-${tag}-job-fk-weather`,
        state: "succeeded",
        createdAt: `${dates.eligible92}T11:00:00Z`,
        attempts: 1,
        startedAt: `${dates.eligible92}T11:00:01Z`,
        finishedAt: `${dates.eligible92}T11:00:05Z`,
      },
      {
        id: ids.jobFkCivil,
        key: `cold-verify-${tag}-job-fk-civil`,
        state: "succeeded",
        createdAt: `${dates.eligible92}T12:00:00Z`,
        attempts: 1,
        startedAt: `${dates.eligible92}T12:00:01Z`,
        finishedAt: `${dates.eligible92}T12:00:05Z`,
      },
      {
        id: ids.jobHotBoundary,
        key: `cold-verify-${tag}-job-hot-boundary`,
        state: "succeeded",
        createdAt: `${dates.hot92}T00:00:00Z`,
        attempts: 1,
        startedAt: `${dates.hot92}T00:00:01Z`,
        finishedAt: `${dates.hot92}T00:00:05Z`,
      },
      {
        id: ids.jobHotNext,
        key: `cold-verify-${tag}-job-hot-next`,
        state: "succeeded",
        createdAt: `${dates.hot92Next}T00:00:00Z`,
        attempts: 1,
        startedAt: `${dates.hot92Next}T00:00:01Z`,
        finishedAt: `${dates.hot92Next}T00:00:05Z`,
      },
    ];

    for (const job of jobs) {
      await tx`
        insert into public.source_jobs (
          id, contract_key, contract_version, trigger_kind, idempotency_key,
          scheduled_for, data_from, data_through, execution_target, state,
          enqueued_by, available_at, attempt_count, max_attempts, retry_base_seconds,
          retry_until, started_at, finished_at, created_at, updated_at
        ) values (
          ${job.id}::uuid, ${contractKey}, 1, 'manual', ${job.key},
          ${job.createdAt}::timestamptz,
          ${job.createdAt}::timestamptz - interval '1 hour',
          ${job.createdAt}::timestamptz,
          'worker', ${job.state}, array['worker'],
          ${job.createdAt}::timestamptz,
          ${job.attempts}, 3, 5,
          ${job.createdAt}::timestamptz + interval '1 hour',
          ${job.startedAt}::timestamptz,
          ${job.finishedAt}::timestamptz,
          ${job.createdAt}::timestamptz,
          ${job.createdAt}::timestamptz
        )
      `;
    }

    await tx`
      insert into public.ita_reports (
        id, source_post_id, source_page, source_url, published_at, content_hash, body, raw
      ) values (
        ${ids.itaReport}::uuid,
        ${`cold-verify-post-${tag}`},
        'cold_verify_page',
        ${`https://example.invalid/cold-verify/${tag}`},
        ${`${dates.eligible92}T12:00:00Z`}::timestamptz,
        ${contentHash},
        'Cold archive verification fixture report',
        '{"fixture":true}'::jsonb
      )
    `;

    await tx`
      insert into public.civil_investigations (
        id, report_id, incident_index, state, job_id, job_attempt
      ) values (
        ${ids.civilInvestigation}::uuid,
        ${ids.itaReport}::uuid,
        0,
        'pending',
        ${ids.jobFkCivil}::uuid,
        1
      )
    `;

    const weatherRows: Array<{
      id: string;
      at: string;
      jobId: string | null;
    }> = [
      {
        id: ids.weatherEligible1,
        at: `${dates.eligible90}T06:00:00Z`,
        jobId: null,
      },
      {
        id: ids.weatherEligible2,
        at: `${dates.eligible90}T23:59:59Z`,
        jobId: null,
      },
      {
        id: ids.weatherHotBoundary,
        at: `${dates.hot90}T00:00:00Z`,
        jobId: null,
      },
      {
        id: ids.weatherHotFk,
        at: `${dates.hot90Next}T12:00:00Z`,
        jobId: ids.jobFkWeather,
      },
    ];
    for (const row of weatherRows) {
      await tx`
        insert into public.weather_snapshots (
          id, commune_id, scheduled_at, fetched_at, job_id, evidence
        ) values (
          ${row.id}::uuid,
          ${communeId}::uuid,
          ${row.at}::timestamptz,
          ${row.at}::timestamptz + interval '1 minute',
          ${row.jobId}::uuid,
          ${evidenceJson}::text::jsonb
        )
      `;
    }

    const publications = [
      {
        id: ids.pubHistorical,
        baseDate: dates.eligible90,
        scheduledFor: `${dates.eligible90}T04:00:00Z`,
        publishedAt: `${dates.eligible90}T04:05:00Z`,
      },
      {
        id: ids.pubCheckpoint,
        baseDate: dates.eligible90,
        scheduledFor: `${dates.eligible90}T12:00:00Z`,
        publishedAt: `${dates.eligible90}T12:05:00Z`,
      },
      {
        id: ids.pubHotBoundary,
        baseDate: dates.hot90,
        scheduledFor: `${dates.hot90}T00:00:00Z`,
        publishedAt: `${dates.hot90}T00:05:00Z`,
      },
      {
        id: ids.pubHotNext,
        baseDate: dates.hot90Next,
        scheduledFor: `${dates.hot90Next}T06:00:00Z`,
        publishedAt: `${dates.hot90Next}T06:05:00Z`,
      },
    ];
    for (const pub of publications) {
      await tx`
        insert into public.risk_publications (
          snapshot_id, base_date, scheduled_for, published_at, row_count
        ) values (
          ${pub.id}::uuid,
          ${pub.baseDate}::date,
          ${pub.scheduledFor}::timestamptz,
          ${pub.publishedAt}::timestamptz,
          1
        )
      `;
    }

    await tx`
      insert into public.risk_publication_checkpoint (
        key, snapshot_id, base_date, scheduled_for, published_at
      ) values (
        'local_fwi',
        ${ids.pubCheckpoint}::uuid,
        ${dates.eligible90}::date,
        ${`${dates.eligible90}T12:00:00Z`}::timestamptz,
        ${`${dates.eligible90}T12:05:00Z`}::timestamptz
      )
      on conflict (key) do update set
        snapshot_id = excluded.snapshot_id,
        base_date = excluded.base_date,
        scheduled_for = excluded.scheduled_for,
        published_at = excluded.published_at
    `;

    const forecasts: Array<{
      id: string;
      snapshotId: string | null;
      forecastDate: string;
      horizonDays: number;
      createdAt: string;
    }> = [
      {
        id: ids.riskHistorical,
        snapshotId: ids.pubHistorical,
        forecastDate: dates.eligible90,
        horizonDays: 0,
        createdAt: `${dates.eligible90}T04:05:00Z`,
      },
      {
        id: ids.riskCheckpoint,
        snapshotId: ids.pubCheckpoint,
        forecastDate: dates.eligible90,
        horizonDays: 0,
        createdAt: `${dates.eligible90}T12:05:00Z`,
      },
      {
        id: ids.riskLegacyNull,
        snapshotId: null,
        forecastDate: dates.eligible90,
        horizonDays: 1,
        createdAt: `${dates.eligible90}T23:59:59Z`,
      },
      {
        id: ids.riskHotBoundary,
        snapshotId: ids.pubHotBoundary,
        forecastDate: dates.hot90,
        horizonDays: 0,
        createdAt: `${dates.hot90}T00:00:00Z`,
      },
      {
        id: ids.riskHotNext,
        snapshotId: ids.pubHotNext,
        forecastDate: dates.hot90Next,
        horizonDays: 0,
        createdAt: `${dates.hot90Next}T06:05:00Z`,
      },
    ];
    for (const fc of forecasts) {
      await tx`
        insert into public.risk_forecasts (
          id, snapshot_id, commune_id, forecast_date, horizon_days,
          source, fwi, danger_level, created_at
        ) values (
          ${fc.id}::uuid,
          ${fc.snapshotId}::uuid,
          ${communeId}::uuid,
          ${fc.forecastDate}::date,
          ${fc.horizonDays},
          'local_fwi',
          19.2,
          3,
          ${fc.createdAt}::timestamptz
        )
      `;
    }

    const audits = [
      {
        id: ids.auditEligible1,
        at: `${dates.eligible90}T04:00:00Z`,
        action: "published",
      },
      {
        id: ids.auditEligible2,
        at: `${dates.eligible90}T23:59:59Z`,
        action: "suppressed",
      },
      {
        id: ids.auditHotBoundary,
        at: `${dates.hot90}T00:00:00Z`,
        action: "suppressed",
      },
      {
        id: ids.auditHotNext,
        at: `${dates.hot90Next}T08:00:00Z`,
        action: "published",
      },
    ];
    for (const row of audits) {
      await tx`
        insert into public.broadcast_audit (id, at, action, reason, actor_id)
        values (
          ${row.id}::uuid,
          ${row.at}::timestamptz,
          ${row.action},
          ${`cold_verify_${tag}`},
          null
        )
      `;
    }

    const airports = [
      {
        id: ids.airportEligible1,
        station: "DAAG",
        name: "Algiers",
        lat: 36.691,
        lon: 3.215,
        at: `${dates.eligible90}T06:00:00Z`,
        raw: `METAR DAAG ${tag} E1`,
      },
      {
        id: ids.airportEligible2,
        station: "DAOO",
        name: "Oran",
        lat: 35.624,
        lon: -0.621,
        at: `${dates.eligible90}T23:59:59Z`,
        raw: `METAR DAOO ${tag} E2`,
      },
      {
        id: ids.airportHotBoundary,
        station: "DAAG",
        name: "Algiers",
        lat: 36.691,
        lon: 3.215,
        at: `${dates.hot90}T00:00:00Z`,
        raw: `METAR DAAG ${tag} HB`,
      },
      {
        id: ids.airportHotNext,
        station: "DAOO",
        name: "Oran",
        lat: 35.624,
        lon: -0.621,
        at: `${dates.hot90Next}T12:00:00Z`,
        raw: `METAR DAOO ${tag} HN`,
      },
    ];
    for (const row of airports) {
      await tx`
        insert into public.airport_observations (
          id, station, name, lat, lon, observed_at, raw
        ) values (
          ${row.id}::uuid,
          ${row.station},
          ${row.name},
          ${row.lat},
          ${row.lon},
          ${row.at}::timestamptz,
          ${row.raw}
        )
      `;
    }

    // source_runs: eligible92 has 1 run, hot92 has 0 rows (empty day!), eligible90 has cascade + running + gap-resolved
    const runs: Array<{
      id: string;
      key: string;
      startedAt: string;
      finishedAt: string | null;
      outcome: "succeeded" | "running";
      jobId: string | null;
      attempt: number | null;
    }> = [
      {
        id: ids.runOldest,
        key: keys.runOldest,
        startedAt: `${dates.eligible92}T10:00:00Z`,
        finishedAt: `${dates.eligible92}T10:01:00Z`,
        outcome: "succeeded",
        jobId: null,
        attempt: null,
      },
      {
        id: ids.runCascade,
        key: keys.runCascade,
        startedAt: `${dates.eligible90}T05:00:00Z`,
        finishedAt: `${dates.eligible90}T05:01:00Z`,
        outcome: "succeeded",
        jobId: ids.jobCascade,
        attempt: 1,
      },
      {
        id: ids.runRunning,
        key: keys.runRunning,
        startedAt: `${dates.eligible90}T06:00:00Z`,
        finishedAt: null,
        outcome: "running",
        jobId: null,
        attempt: null,
      },
      {
        id: ids.runGapResolved,
        key: keys.runGapResolved,
        startedAt: `${dates.eligible90}T07:00:00Z`,
        finishedAt: `${dates.eligible90}T07:01:00Z`,
        outcome: "succeeded",
        jobId: null,
        attempt: null,
      },
      {
        id: ids.runHotBoundary,
        key: keys.runHotBoundary,
        startedAt: `${dates.hot90}T00:00:00Z`,
        finishedAt: `${dates.hot90}T00:01:00Z`,
        outcome: "succeeded",
        jobId: null,
        attempt: null,
      },
      {
        id: ids.runHotFk,
        key: keys.runHotFk,
        startedAt: `${dates.hot90Next}T08:00:00Z`,
        finishedAt: `${dates.hot90Next}T08:01:00Z`,
        outcome: "succeeded",
        jobId: ids.jobFkRun,
        attempt: 1,
      },
    ];
    for (const run of runs) {
      await tx`
        insert into public.source_runs (
          id, contract_key, contract_version, trigger_kind, idempotency_key,
          scheduled_for, started_at, finished_at, outcome, records_seen, job_id, attempt
        ) values (
          ${run.id}::uuid,
          ${contractKey},
          1,
          'manual',
          ${run.key},
          ${run.startedAt}::timestamptz,
          ${run.startedAt}::timestamptz,
          ${run.finishedAt}::timestamptz,
          ${run.outcome},
          1,
          ${run.jobId}::uuid,
          ${run.attempt}
        )
      `;
    }

    await tx`
      insert into public.source_gaps (
        id, contract_key, data_from, data_through, state, resolved_by_run_id
      ) values (
        ${ids.sourceGap}::uuid,
        ${contractKey},
        ${`${dates.eligible90}T06:00:00Z`}::timestamptz,
        ${`${dates.eligible90}T07:00:00Z`}::timestamptz,
        'resolved',
        ${ids.runGapResolved}::uuid
      )
    `;
  });

  return {
    contractKey,
    eligible90: dates.eligible90,
    hot90: dates.hot90,
    hot90Next: dates.hot90Next,
    eligible92: dates.eligible92,
    hot92: dates.hot92,
    hot92Next: dates.hot92Next,
    emptyRunsDay: dates.hot92,
    ids,
    keys,
  };
}

async function cleanupFixtures(
  sql: SQL,
  supabase: ReturnType<typeof createClient<Database>>,
  tracker: FixtureTracker,
  initialCheckpoint: CheckpointRow | null,
  initialExports: Set<string>,
): Promise<void> {
  const paths = [...tracker.uploadedPaths];
  if (paths.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) {
      throw new Error(
        `Failed to remove verification storage objects: ${error.message}`,
      );
    }
    tracker.uploadedPaths.clear();
  }

  await sql.begin(async (tx) => {
    for (const id of tracker.civilInvestigationIds) {
      await tx`delete from public.civil_investigations where id = ${id}::uuid`;
    }
    for (const id of tracker.itaReportIds) {
      await tx`delete from public.ita_reports where id = ${id}::uuid`;
    }
    for (const id of tracker.sourceGapIds) {
      await tx`update public.source_gaps set resolved_by_run_id = null where id = ${id}::uuid`;
      await tx`delete from public.source_gaps where id = ${id}::uuid`;
    }
    for (const id of tracker.weatherSnapshotIds) {
      await tx`delete from public.weather_snapshots where id = ${id}::uuid`;
    }
    for (const id of tracker.sourceRunIds) {
      await tx`delete from public.source_runs where id = ${id}::uuid`;
    }
    for (const key of tracker.retiredKeys) {
      await tx`delete from public.source_run_retired_keys where idempotency_key = ${key}`;
    }
    for (const id of tracker.sourceJobIds) {
      await tx`delete from public.source_jobs where id = ${id}::uuid`;
    }
    for (const id of tracker.airportObservationIds) {
      await tx`delete from public.airport_observations where id = ${id}::uuid`;
    }

    // Restore pre-test risk_publication_checkpoint before deleting seeded risk_forecasts
    if (initialCheckpoint) {
      await tx`
        insert into public.risk_publication_checkpoint (
          key, snapshot_id, base_date, scheduled_for, published_at, coverage_status
        ) values (
          ${initialCheckpoint.key},
          ${initialCheckpoint.snapshot_id}::uuid,
          ${initialCheckpoint.base_date}::date,
          ${initialCheckpoint.scheduled_for}::timestamptz,
          ${initialCheckpoint.published_at}::timestamptz,
          ${initialCheckpoint.coverage_status}
        )
        on conflict (key) do update set
          snapshot_id = excluded.snapshot_id,
          base_date = excluded.base_date,
          scheduled_for = excluded.scheduled_for,
          published_at = excluded.published_at,
          coverage_status = excluded.coverage_status
      `;
    } else {
      await tx`delete from public.risk_publication_checkpoint where key = 'local_fwi'`;
    }

    // Trigger-safe transactional manifest bridge: insert temporary rows=0 cold_exports
    // placeholders for seeded broadcast_audit & risk_forecasts days so live triggers
    // legitimately permit deleting ONLY our seeded fixture UUIDs.
    for (const day of tracker.riskForecastDays) {
      await tx`
        insert into public.cold_exports (table_name, day, rows)
        values ('risk_forecasts', ${day}::date, 0)
        on conflict (table_name, day) do nothing
      `;
    }
    for (const day of tracker.broadcastAuditDays) {
      await tx`
        insert into public.cold_exports (table_name, day, rows)
        values ('broadcast_audit', ${day}::date, 0)
        on conflict (table_name, day) do nothing
      `;
    }

    for (const id of tracker.riskForecastIds) {
      await tx`delete from public.risk_forecasts where id = ${id}::uuid`;
    }
    for (const id of tracker.riskPublicationIds) {
      await tx`delete from public.risk_publications where snapshot_id = ${id}::uuid`;
    }
    for (const id of tracker.broadcastAuditIds) {
      await tx`delete from public.broadcast_audit where id = ${id}::uuid`;
    }

    // Remove ONLY cold_exports rows created during this run
    const currentExports = await tx<ColdExportKey[]>`
      select table_name, day::text as day from public.cold_exports
    `;
    for (const row of currentExports) {
      const composite = `${row.table_name}:${row.day}`;
      if (!initialExports.has(composite)) {
        await tx`
          delete from public.cold_exports
          where table_name = ${row.table_name} and day = ${row.day}::date
        `;
      }
    }

    for (const key of tracker.contractKeys) {
      await tx`delete from public.source_contracts where key = ${key}`;
    }
  });
}

async function queryCandidatesAsColdReader(
  readerSql: SQL,
  table: ColdTable,
  day: string,
): Promise<{
  rows: (Record<string, unknown> & { id: string })[];
  sourceSummary: Summary;
}> {
  assert(isColdTable(table), `Invalid cold table: ${table}`);
  return readerSql.begin(async (tx) => {
    const rows = (await tx.unsafe(
      `select t.* from public.${table} t join private.cold_candidates($1, $2::date) c on c.id = t.id`,
      [table, day],
    )) as (Record<string, unknown> & { id: string })[];
    const [summaryRow] = (await tx.unsafe(
      `select count(*)::int as rows, md5(string_agg(id::text, ',' order by id::text collate "C")) as digest from private.cold_candidates($1, $2::date)`,
      [table, day],
    )) as [{ rows: number; digest: string | null }];
    return {
      rows,
      sourceSummary: {
        rows: Number(summaryRow?.rows ?? 0),
        digest: summaryRow?.digest ?? null,
      },
    };
  });
}

async function inspectDryRun(
  sql: SQL,
  readerSql: SQL,
  asOfDay: string,
): Promise<DryRunTableReport[]> {
  const asOfTs = `${asOfDay}T03:17:00Z`;
  const reports: DryRunTableReport[] = [];

  for (const table of COLD_TABLES) {
    const cutoff = computeColdCutoff(table, asOfDay);
    const { dayColumn } = COLD_TABLE_CONFIG[table];

    const pendingRows = await sql<{ day: string }[]>`
      select d::text as day
      from private.cold_pending_days_as_of(${table}, ${asOfTs}::timestamptz) d
      order by 1
    `;
    const pendingDays = pendingRows.map((r) => r.day);

    let eligibleCount = 0;
    for (const day of pendingDays) {
      const { sourceSummary } = await queryCandidatesAsColdReader(
        readerSql,
        table,
        day,
      );
      eligibleCount += sourceSummary.rows;
    }

    const [windowCounts] = (await sql.unsafe(
      `select
         count(*) filter (where (${dayColumn} at time zone 'UTC')::date <= $1::date)::int as old_total,
         count(*) filter (where (${dayColumn} at time zone 'UTC')::date >= $2::date)::int as hot_total
       from public.${table}`,
      [cutoff.lastEligibleDay, cutoff.firstHotDay],
    )) as [{ old_total: number; hot_total: number }];

    const oldTotal = Number(windowCounts?.old_total ?? 0);
    const hotCount = Number(windowCounts?.hot_total ?? 0);
    const fkOrStateProtectedCount = Math.max(0, oldTotal - eligibleCount);

    reports.push({
      table,
      hotDays: cutoff.hotDays,
      lastEligibleDay: cutoff.lastEligibleDay,
      firstHotDay: cutoff.firstHotDay,
      pendingDays,
      eligibleCount,
      fkOrStateProtectedCount,
      hotCount,
    });
  }

  return reports;
}

async function countTableRows(sql: SQL): Promise<Record<ColdTable, number>> {
  const counts = {} as Record<ColdTable, number>;
  for (const table of COLD_TABLES) {
    const [row] = (await sql.unsafe(
      `select count(*)::int as c from public.${table}`,
    )) as [{ c: number }];
    counts[table] = Number(row?.c ?? 0);
  }
  return counts;
}

function buildColdArchiveDeps(options: {
  mode: ResolvedVerifyMode;
  sql: SQL;
  readerSql: SQL;
  supabase: ReturnType<typeof createClient<Database>>;
  tracker: FixtureTracker;
  duckdbBin: string;
  duckdbWorkDir: string | null;
  duckdbEnv: NodeJS.ProcessEnv | null;
  asOfTs: string | null; // null => real public.* RPCs via service_role; non-null => private.*_as_of
  onUpload?: () => void;
  onCommit?: () => void;
  quiet: boolean;
}): ColdArchiveDeps {
  const {
    mode,
    sql,
    readerSql,
    supabase,
    tracker,
    duckdbBin,
    duckdbWorkDir,
    duckdbEnv,
    asOfTs,
    onUpload,
    onCommit,
    quiet,
  } = options;

  const parseDuckSummaries = async (file: string) =>
    (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            side?: string;
            rows: number;
            digest: string | null;
          },
      )
      .map(({ side, rows, digest }) => ({
        side,
        summary: { rows: Number(rows), digest } satisfies Summary,
      }));

  return {
    pendingDays: async (table) => {
      if (asOfTs !== null) {
        const rows = await sql<{ day: string }[]>`
          select d::text as day
          from private.cold_pending_days_as_of(${table}, ${asOfTs}::timestamptz) d
          order by 1
        `;
        return rows.map((r) => r.day);
      }
      const { data, error } = await supabase.rpc("cold_pending_days", {
        _table: table,
      });
      if (error)
        throw new Error(`cold_pending_days(${table}): ${error.message}`);
      return data;
    },
    exportDay: async (table, day) => {
      if (mode === "duckdb" && duckdbWorkDir && duckdbEnv) {
        const parquet = join(duckdbWorkDir, `${table}-${day}.parquet`);
        const summaryFile = join(duckdbWorkDir, `${table}-${day}.json`);
        await execFileAsync(
          duckdbBin,
          [
            ":memory:",
            "-bail",
            "-c",
            exportSql(table, day, parquet, summaryFile),
          ],
          { env: duckdbEnv },
        );
        const sides = await parseDuckSummaries(summaryFile);
        const side = (name: string) => {
          const found = sides.find((s) => s.side === name);
          if (!found)
            throw new Error(`${table} ${day}: missing ${name} summary`);
          return found.summary;
        };
        return {
          file: side("file"),
          source: side("source"),
          bytes: await readFile(parquet),
        };
      }

      const { rows, sourceSummary } = await queryCandidatesAsColdReader(
        readerSql,
        table,
        day,
      );
      const bytes = serializeCanonicalNdjson(rows);
      const fileSummary = readBackCanonicalNdjson(bytes);
      return {
        file: fileSummary,
        source: sourceSummary,
        bytes,
      };
    },
    readBack: async (bytes) => {
      if (mode === "duckdb" && duckdbWorkDir) {
        const parquet = join(duckdbWorkDir, "stored.parquet");
        const summaryFile = join(duckdbWorkDir, "stored.json");
        await writeFile(parquet, bytes);
        await execFileAsync(duckdbBin, [
          ":memory:",
          "-bail",
          "-c",
          readBackSql(parquet, summaryFile),
        ]);
        const [stored] = await parseDuckSummaries(summaryFile);
        if (!stored) throw new Error("Stored parquet produced no summary");
        return stored.summary;
      }
      return readBackCanonicalNdjson(bytes);
    },
    upload: async (path, bytes) => {
      tracker.uploadedPaths.add(path);
      onUpload?.();
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, {
          upsert: true,
          contentType: "application/vnd.apache.parquet",
        });
      if (error) throw new Error(`Upload ${path}: ${error.message}`);
    },
    download: async (path) => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .download(path);
      if (error || !data) {
        throw new Error(`Download ${path}: ${error?.message ?? "empty"}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    commit: async ({
      table,
      day,
      rows,
      keyDigest,
      sha256: hash,
      bytes,
      path,
    }) => {
      onCommit?.();
      if (asOfTs !== null) {
        const [res] = await sql<{ deleted: number }[]>`
          select private.cold_archive_commit_as_of(
            ${table},
            ${day}::date,
            ${rows}::bigint,
            ${keyDigest},
            ${hash},
            ${bytes}::bigint,
            ${path},
            ${asOfTs}::timestamptz
          )::int as deleted
        `;
        return Number(res?.deleted ?? 0);
      }
      const { data, error } = await supabase.rpc("cold_archive_commit", {
        _table: table,
        _day: day,
        _rows: rows,
        ...(keyDigest === null ? {} : { _key_digest: keyDigest }),
        ...(hash === null ? {} : { _sha256: hash }),
        ...(bytes === null ? {} : { _bytes: bytes }),
        ...(path === null ? {} : { _path: path }),
      });
      if (error) {
        throw new Error(
          `cold_archive_commit(${table}, ${day}): ${error.message}`,
        );
      }
      return data;
    },
    log: (line) => {
      if (!quiet) {
        console.log(`  [archive] ${JSON.stringify(line)}`);
      }
    },
  };
}

async function verifyUploadedManifests(
  sql: SQL,
  supabase: ReturnType<typeof createClient<Database>>,
  mode: ResolvedVerifyMode,
  deps: ColdArchiveDeps,
  expectedDays: Array<{ table: ColdTable; day: string; rows: number }>,
): Promise<void> {
  for (const exp of expectedDays) {
    const [manifest] = await sql<
      {
        rows: number;
        key_digest: string | null;
        sha256: string | null;
        bytes: number | null;
        path: string | null;
      }[]
    >`
      select rows::int as rows, key_digest, sha256, bytes::int as bytes, path
      from public.cold_exports
      where table_name = ${exp.table} and day = ${exp.day}::date
    `;
    assert(manifest, `Manifest missing for ${exp.table} ${exp.day}`);
    assert.equal(
      manifest.rows,
      exp.rows,
      `Manifest row count mismatch for ${exp.table} ${exp.day}`,
    );

    if (exp.rows === 0) {
      assert.equal(manifest.key_digest, null);
      assert.equal(manifest.sha256, null);
      assert.equal(manifest.bytes, null);
      assert.equal(manifest.path, null);
      continue;
    }

    const expectedPath = coldPath("cold", exp.table, exp.day);
    assert.equal(manifest.path, expectedPath);
    assert(manifest.sha256 && /^[0-9a-f]{64}$/.test(manifest.sha256));
    assert(manifest.key_digest && /^[0-9a-f]{32}$/.test(manifest.key_digest));
    assert(manifest.bytes && manifest.bytes > 0);

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(expectedPath);
    assert(
      !error && data,
      `Storage readback failed for ${expectedPath}: ${error?.message}`,
    );
    const downloaded = new Uint8Array(await data.arrayBuffer());
    assert.equal(downloaded.byteLength, manifest.bytes);

    if (mode === "ts") {
      verifyExportArtifact(downloaded, manifest.sha256, {
        rows: manifest.rows,
        digest: manifest.key_digest,
      });
    } else {
      assert.equal(sha256(downloaded), manifest.sha256);
      const readSummary = await deps.readBack(downloaded);
      assert.equal(readSummary.rows, manifest.rows);
      assert.equal(readSummary.digest, manifest.key_digest);
    }
  }
}

async function main(): Promise<void> {
  const args = parseVerifyColdArchiveArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const explicitUrl = process.env["COLD_ARCHIVE_TEST_SUPABASE_URL"];
  const explicitKey =
    process.env["COLD_ARCHIVE_TEST_SUPABASE_SERVICE_ROLE_KEY"];
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
    process.env["COLD_ARCHIVE_TEST_DATABASE_URL"] ||
    (isLoopbackUrl(process.env["DATABASE_URL"])
      ? process.env["DATABASE_URL"]
      : statusEnv["DB_URL"]) ||
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

  assert(
    supabaseUrl,
    "Local SUPABASE_URL (or supabase status API_URL) required",
  );
  assert(
    serviceRoleKey,
    "Local SUPABASE_SERVICE_ROLE_KEY (or supabase status SERVICE_ROLE_KEY) required",
  );

  // Enforce loopback-only guards BEFORE opening any connection
  assertLoopbackHttpUrl(supabaseUrl, "SUPABASE_URL");
  const dbParsed = assertLoopbackDatabaseUrl(databaseUrl, "DATABASE_URL");

  const duckdbBin = process.env["DUCKDB_BIN"] ?? "duckdb";
  const duckdbAvailable = await detectDuckdb(duckdbBin);
  const resolvedMode = resolveVerifyMode(args.mode, duckdbAvailable);

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const sql = new SQL({
    hostname: dbParsed.hostname,
    port: Number(dbParsed.port || 54322),
    username: decodeURIComponent(dbParsed.username || "postgres"),
    password: decodeURIComponent(dbParsed.password || "postgres"),
    database: dbParsed.pathname.slice(1) || "postgres",
    max: 2,
    tls: false,
  });

  const tracker = createTracker();
  let initialCheckpoint: CheckpointRow | null = null;
  const initialExports = new Set<string>();
  let duckdbWorkDir: string | null = null;
  let duckdbEnv: NodeJS.ProcessEnv | null = null;
  let readerSql: SQL | null = null;
  let temporaryReaderPasswordSet = false;

  try {
    const [clockRow] = await sql<{ db_today: string }[]>`
      select (now() at time zone 'UTC')::date::text as db_today
    `;
    const dbToday = clockRow!.db_today;

    const [communeRow] = await sql<{ id: string }[]>`
      select id::text as id from public.admin_units where level = 'commune' order by id limit 1
    `;
    assert(
      communeRow,
      "At least one commune row is required in public.admin_units",
    );
    const communeId = communeRow.id;

    // Snapshot pre-existing checkpoint & cold_exports so cleanup is 100% lossless
    const existingCheckpoints = await sql<CheckpointRow[]>`
      select
        key,
        snapshot_id::text as snapshot_id,
        base_date::text as base_date,
        scheduled_for::text as scheduled_for,
        published_at::text as published_at,
        coverage_status
      from public.risk_publication_checkpoint
      where key = 'local_fwi'
    `;
    initialCheckpoint = existingCheckpoints[0] ?? null;

    const existingExportRows = await sql<ColdExportKey[]>`
      select table_name, day::text as day from public.cold_exports
    `;
    for (const row of existingExportRows) {
      initialExports.add(`${row.table_name}:${row.day}`);
    }

    // Open a genuine cold_reader login session so Postgres natively enforces
    // cold_reader RLS policies and default_transaction_read_only=on.
    const explicitReaderUrl =
      process.env["COLD_ARCHIVE_TEST_READER_DATABASE_URL"];
    let readerPassword: string;
    let readerHost = dbParsed.hostname;
    let readerPort = Number(dbParsed.port || 54322);
    let readerUser = "cold_reader";
    let readerDatabase = dbParsed.pathname.slice(1) || "postgres";

    if (explicitReaderUrl) {
      const readerParsed = assertLoopbackDatabaseUrl(
        explicitReaderUrl,
        "COLD_ARCHIVE_TEST_READER_DATABASE_URL",
      );
      readerHost = readerParsed.hostname;
      readerPort = Number(readerParsed.port || 54322);
      readerUser = decodeURIComponent(readerParsed.username || "cold_reader");
      readerPassword = decodeURIComponent(readerParsed.password || "");
      readerDatabase = readerParsed.pathname.slice(1) || "postgres";
    } else {
      readerPassword = crypto.randomUUID().replaceAll("-", "");
      await sql.unsafe(
        `alter role cold_reader with password '${readerPassword}'`,
      );
      temporaryReaderPasswordSet = true;
    }

    readerSql = new SQL({
      hostname: readerHost,
      port: readerPort,
      username: readerUser,
      password: readerPassword,
      database: readerDatabase,
      max: 2,
      tls: false,
    });

    const [readerCheck] = await readerSql<
      { current_user: string; read_only: string }[]
    >`select current_user, current_setting('transaction_read_only') as read_only`;
    assert.equal(readerCheck?.current_user, "cold_reader");
    assert.equal(readerCheck?.read_only, "on");

    if (resolvedMode === "duckdb") {
      duckdbWorkDir = await mkdtemp(join(tmpdir(), "cold-archive-verify-"));
      duckdbEnv = {
        ...process.env,
        PGHOST: readerHost,
        PGPORT: String(readerPort),
        PGUSER: readerUser,
        PGPASSWORD: readerPassword,
        PGDATABASE: readerDatabase,
        PGSSLMODE: "disable",
      };
    }

    if (!args.json) {
      console.log(
        `[cold-archive-verify] mode=${resolvedMode} duckdbAvailable=${duckdbAvailable} dbToday=${dbToday} asOf=${args.asOf} dryRun=${args.dryRun}`,
      );
    }

    // -----------------------------------------------------------------------
    // DRY-RUN MODE (--dry-run)
    // -----------------------------------------------------------------------
    if (args.dryRun) {
      const runTag = crypto.randomUUID().slice(0, 8);
      if (args.seed) {
        const c90 = computeColdCutoff("broadcast_audit", args.asOf);
        const c92 = computeColdCutoff("source_jobs", args.asOf);
        await seedCutoffMatrix(
          sql,
          communeId,
          `dry_${runTag}`,
          {
            eligible90: c90.lastEligibleDay,
            hot90: c90.firstHotDay,
            hot90Next: shiftUtcDay(c90.firstHotDay, 1),
            eligible92: c92.lastEligibleDay,
            hot92: c92.firstHotDay,
            hot92Next: shiftUtcDay(c92.firstHotDay, 1),
          },
          tracker,
        );
      }

      const beforeCounts = await countTableRows(sql);
      const [beforeExportsCount] = await sql<{ c: number }[]>`
        select count(*)::int as c from public.cold_exports
      `;
      const [beforeStorageCount] = await sql<{ c: number }[]>`
        select count(*)::int as c from storage.objects where bucket_id = ${BUCKET}
      `;

      const reports = await inspectDryRun(sql, readerSql, args.asOf);

      const afterCounts = await countTableRows(sql);
      const [afterExportsCount] = await sql<{ c: number }[]>`
        select count(*)::int as c from public.cold_exports
      `;
      const [afterStorageCount] = await sql<{ c: number }[]>`
        select count(*)::int as c from storage.objects where bucket_id = ${BUCKET}
      `;

      assert.deepEqual(afterCounts, beforeCounts, "Dry-run must delete 0 rows");
      assert.equal(
        afterExportsCount?.c,
        beforeExportsCount?.c,
        "Dry-run must not mutate public.cold_exports",
      );
      assert.equal(
        afterStorageCount?.c,
        beforeStorageCount?.c,
        "Dry-run must upload 0 Storage objects",
      );

      if (args.seed) {
        const byTable = new Map(reports.map((r) => [r.table, r]));
        const c90 = computeColdCutoff("broadcast_audit", args.asOf);
        const c92 = computeColdCutoff("source_jobs", args.asOf);
        assert.deepEqual(byTable.get("weather_snapshots")?.pendingDays, [
          c90.lastEligibleDay,
        ]);
        assert.equal(byTable.get("weather_snapshots")?.eligibleCount, 2);
        assert.equal(byTable.get("risk_forecasts")?.eligibleCount, 2);
        assert.equal(byTable.get("risk_forecasts")?.fkOrStateProtectedCount, 1);
        assert.equal(byTable.get("broadcast_audit")?.eligibleCount, 2);
        assert.equal(byTable.get("airport_observations")?.eligibleCount, 2);
        assert.deepEqual(byTable.get("source_runs")?.pendingDays, [
          c92.lastEligibleDay,
          c92.firstHotDay,
          c90.lastEligibleDay,
        ]);
        assert.equal(byTable.get("source_runs")?.eligibleCount, 2);
        assert.equal(byTable.get("source_runs")?.fkOrStateProtectedCount, 2);
        assert.deepEqual(byTable.get("source_jobs")?.pendingDays, [
          c92.lastEligibleDay,
        ]);
        assert.equal(byTable.get("source_jobs")?.eligibleCount, 2);
        assert.equal(byTable.get("source_jobs")?.fkOrStateProtectedCount, 7);
      }

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              dryRun: true,
              mode: resolvedMode,
              dbToday,
              asOf: args.asOf,
              seeded: args.seed,
              tables: reports,
            },
            null,
            2,
          ),
        );
      } else {
        for (const r of reports) {
          console.log(
            `  [dry-run] ${r.table} (${r.hotDays}d): lastEligible=${r.lastEligibleDay} firstHot=${r.firstHotDay} pending=[${r.pendingDays.join(",")}] eligible=${r.eligibleCount} protected=${r.fkOrStateProtectedCount} hot=${r.hotCount}`,
          );
        }
        console.log(
          `[PASS] Dry-run verified for --as-of ${args.asOf}: 0 rows deleted, 0 manifests created, 0 storage uploads.`,
        );
      }
      return;
    }

    // -----------------------------------------------------------------------
    // FULL VERIFICATION MODE
    // Phase 1: Reproducible 2026-11-26 & 2026-11-27 Cutoff Proof (ALL 6 tables)
    // -----------------------------------------------------------------------
    const phase1Tag = `p1_${crypto.randomUUID().slice(0, 6)}`;
    const phase1 = await seedCutoffMatrix(
      sql,
      communeId,
      phase1Tag,
      {
        eligible90: "2026-08-27",
        hot90: "2026-08-28",
        hot90Next: "2026-08-29",
        eligible92: "2026-08-25",
        hot92: "2026-08-26",
        hot92Next: "2026-08-27",
      },
      tracker,
    );

    // 1A: Dry-run check at 2026-11-26
    const dryReports26 = await inspectDryRun(sql, readerSql, "2026-11-26");
    const dryByTable26 = new Map(dryReports26.map((r) => [r.table, r]));
    assert.deepEqual(dryByTable26.get("weather_snapshots")?.pendingDays, [
      "2026-08-27",
    ]);
    assert.deepEqual(dryByTable26.get("risk_forecasts")?.pendingDays, [
      "2026-08-27",
    ]);
    assert.deepEqual(dryByTable26.get("broadcast_audit")?.pendingDays, [
      "2026-08-27",
    ]);
    assert.deepEqual(dryByTable26.get("airport_observations")?.pendingDays, [
      "2026-08-27",
    ]);
    assert.deepEqual(dryByTable26.get("source_runs")?.pendingDays, [
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
    ]);
    assert.deepEqual(dryByTable26.get("source_jobs")?.pendingDays, [
      "2026-08-25",
    ]);

    // 1B: Reject hot boundaries at 2026-11-26T03:17:00Z across all 6 tables
    for (const [table, hotDay] of [
      ["weather_snapshots", "2026-08-28"],
      ["risk_forecasts", "2026-08-28"],
      ["broadcast_audit", "2026-08-28"],
      ["airport_observations", "2026-08-28"],
      ["source_runs", "2026-08-28"],
      ["source_jobs", "2026-08-26"],
    ] as const) {
      await assert.rejects(
        () =>
          sql`
            select private.cold_archive_commit_as_of(
              ${table}, ${hotDay}::date, 0, null, null, null, null, '2026-11-26T03:17:00Z'::timestamptz
            )
          `,
        /cold_day_still_hot/,
        `2026-11-26 must reject hot day ${hotDay} for ${table}`,
      );
    }

    // 1C: Commit all 6 tables at simulated 2026-11-26T03:17:00Z via archiveColdDays(deps)
    const simDeps26 = buildColdArchiveDeps({
      mode: resolvedMode,
      sql,
      readerSql,
      supabase,
      tracker,
      duckdbBin,
      duckdbWorkDir,
      duckdbEnv,
      asOfTs: "2026-11-26T03:17:00Z",
      quiet: args.json,
    });
    const archivedDays26 = await archiveColdDays(simDeps26);
    assert.equal(
      archivedDays26,
      8,
      "2026-11-26 commit should archive 8 table-days (including empty 2026-08-26)",
    );

    await verifyUploadedManifests(sql, supabase, resolvedMode, simDeps26, [
      { table: "weather_snapshots", day: "2026-08-27", rows: 2 },
      { table: "risk_forecasts", day: "2026-08-27", rows: 2 },
      { table: "broadcast_audit", day: "2026-08-27", rows: 2 },
      { table: "airport_observations", day: "2026-08-27", rows: 2 },
      { table: "source_runs", day: "2026-08-25", rows: 1 },
      { table: "source_runs", day: "2026-08-26", rows: 0 },
      { table: "source_runs", day: "2026-08-27", rows: 1 },
      { table: "source_jobs", day: "2026-08-25", rows: 3 },
    ]);

    // Verify 2026-11-27 follow-on boundary commits 2026-08-28 (90d) and 2026-08-26 (92d) while rejecting 2026-08-29 / 2026-08-27
    const simDeps27 = buildColdArchiveDeps({
      mode: resolvedMode,
      sql,
      readerSql,
      supabase,
      tracker,
      duckdbBin,
      duckdbWorkDir,
      duckdbEnv,
      asOfTs: "2026-11-27T03:17:00Z",
      quiet: args.json,
    });
    const archivedDays27 = await archiveColdDays(simDeps27);
    assert.equal(
      archivedDays27,
      6,
      "2026-11-27 follow-on should archive 6 boundary days",
    );

    await verifyUploadedManifests(sql, supabase, resolvedMode, simDeps27, [
      { table: "weather_snapshots", day: "2026-08-28", rows: 1 },
      { table: "risk_forecasts", day: "2026-08-28", rows: 1 },
      { table: "broadcast_audit", day: "2026-08-28", rows: 1 },
      { table: "airport_observations", day: "2026-08-28", rows: 1 },
      { table: "source_runs", day: "2026-08-28", rows: 1 },
      { table: "source_jobs", day: "2026-08-26", rows: 1 },
    ]);

    for (const [table, hotDay] of [
      ["weather_snapshots", "2026-08-29"],
      ["broadcast_audit", "2026-08-29"],
      ["source_jobs", "2026-08-27"],
    ] as const) {
      await assert.rejects(
        () =>
          sql`
            select private.cold_archive_commit_as_of(
              ${table}, ${hotDay}::date, 0, null, null, null, null, '2026-11-27T03:17:00Z'::timestamptz
            )
          `,
        /cold_day_still_hot/,
        `2026-11-27 must reject hot day ${hotDay} for ${table}`,
      );
    }

    // Verify protected rows survived Phase 1
    const [p1CheckpointAlive] = await sql<{ c: number }[]>`
      select count(*)::int as c from public.risk_forecasts where id = ${phase1.ids.riskCheckpoint}::uuid
    `;
    assert.equal(p1CheckpointAlive?.c, 1);

    if (!args.json) {
      console.log(
        "[PASS] Phase 1: 2026-11-26 & 2026-11-27 simulated cutoff proof passed across all 6 tables",
      );
    }

    // Clean Phase 1 fixtures cleanly before Phase 2 live wall-clock test
    await cleanupFixtures(
      sql,
      supabase,
      tracker,
      initialCheckpoint,
      initialExports,
    );

    // -----------------------------------------------------------------------
    // Phase 2: Live Wall-Clock service_role Full 6-Table Proof (real now())
    // -----------------------------------------------------------------------
    const live90 = computeColdCutoff("broadcast_audit", dbToday);
    const live92 = computeColdCutoff("source_jobs", dbToday);
    const phase2Tag = `p2_${crypto.randomUUID().slice(0, 6)}`;
    const phase2 = await seedCutoffMatrix(
      sql,
      communeId,
      phase2Tag,
      {
        eligible90: live90.lastEligibleDay,
        hot90: live90.firstHotDay,
        hot90Next: shiftUtcDay(live90.firstHotDay, 1),
        eligible92: live92.lastEligibleDay,
        hot92: live92.firstHotDay,
        hot92Next: shiftUtcDay(live92.firstHotDay, 1),
      },
      tracker,
    );

    // Verify cold_reader read-only enforcement on real Postgres session
    await assert.rejects(
      () =>
        readerSql!`delete from public.airport_observations where id = ${phase2.ids.airportEligible1}::uuid`,
      /permission denied|read-only/,
      "cold_reader must be strictly read-only",
    );

    // Negative Rollback Suite (ALL 6 failure modes BEFORE any live commit)
    const { rows: auditRows, sourceSummary: auditSummary } =
      await queryCandidatesAsColdReader(
        readerSql,
        "broadcast_audit",
        phase2.eligible90,
      );
    assert.equal(auditSummary.rows, 2);
    assert(auditSummary.digest);
    const auditBytes = serializeCanonicalNdjson(auditRows);
    const auditHash = sha256(auditBytes);
    const auditPath = coldPath("cold", "broadcast_audit", phase2.eligible90);

    // 1. Hot boundary day rejection (90d & 92d)
    {
      const { error: e1 } = await supabase.rpc("cold_archive_commit", {
        _table: "broadcast_audit",
        _day: phase2.hot90,
        _rows: 0,
      });
      assert(
        e1?.message.includes("cold_day_still_hot"),
        `Expected cold_day_still_hot, got ${e1?.message}`,
      );

      const { error: e2 } = await supabase.rpc("cold_archive_commit", {
        _table: "source_jobs",
        _day: phase2.hot92,
        _rows: 0,
      });
      assert(
        e2?.message.includes("cold_day_still_hot"),
        `Expected cold_day_still_hot for source_jobs ${phase2.hot92}, got ${e2?.message}`,
      );

      const { error: e3 } = await supabase.rpc("cold_archive_commit", {
        _table: "source_jobs",
        _day: phase2.eligible90,
        _rows: 0,
      });
      assert(
        e3?.message.includes("cold_day_still_hot"),
        `Expected cold_day_still_hot for source_jobs 91d ${phase2.eligible90}, got ${e3?.message}`,
      );
    }

    // 2. Missing Storage object -> cold_file_missing (P0002)
    {
      const { error } = await supabase.rpc("cold_archive_commit", {
        _table: "broadcast_audit",
        _day: phase2.eligible90,
        _rows: auditSummary.rows,
        _key_digest: auditSummary.digest,
        _sha256: auditHash,
        _bytes: auditBytes.byteLength,
        _path: auditPath,
      });
      assert(
        error?.message.includes("cold_file_missing"),
        `Expected cold_file_missing, got ${error?.message}`,
      );
    }

    // Upload real bytes + invalid-path object for negative tests 3-6
    tracker.uploadedPaths.add(auditPath);
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(auditPath, auditBytes, {
        upsert: true,
        contentType: "application/vnd.apache.parquet",
      });
    assert(!upErr, `Failed negative-test upload: ${upErr?.message}`);

    const badPath = "cold/elsewhere.parquet";
    tracker.uploadedPaths.add(badPath);
    const { error: badUpErr } = await supabase.storage
      .from(BUCKET)
      .upload(badPath, auditBytes, {
        upsert: true,
        contentType: "application/vnd.apache.parquet",
      });
    assert(!badUpErr, `Failed invalid-path upload: ${badUpErr?.message}`);

    // 3. Tampered byte size -> cold_file_missing
    {
      const { error } = await supabase.rpc("cold_archive_commit", {
        _table: "broadcast_audit",
        _day: phase2.eligible90,
        _rows: auditSummary.rows,
        _key_digest: auditSummary.digest,
        _sha256: auditHash,
        _bytes: auditBytes.byteLength + 1,
        _path: auditPath,
      });
      assert(
        error?.message.includes("cold_file_missing"),
        `Expected cold_file_missing on wrong size, got ${error?.message}`,
      );
    }

    // 4. Tampered key_digest -> cold_export_mismatch
    {
      const wrongDigest = computeKeyDigest(["wrong-id"])!;
      const { error } = await supabase.rpc("cold_archive_commit", {
        _table: "broadcast_audit",
        _day: phase2.eligible90,
        _rows: auditSummary.rows,
        _key_digest: wrongDigest,
        _sha256: auditHash,
        _bytes: auditBytes.byteLength,
        _path: auditPath,
      });
      assert(
        error?.message.includes("cold_export_mismatch"),
        `Expected cold_export_mismatch on wrong digest, got ${error?.message}`,
      );
    }

    // 5. Tampered row count -> cold_export_mismatch
    {
      const { error } = await supabase.rpc("cold_archive_commit", {
        _table: "broadcast_audit",
        _day: phase2.eligible90,
        _rows: auditSummary.rows + 1,
        _key_digest: auditSummary.digest,
        _sha256: auditHash,
        _bytes: auditBytes.byteLength,
        _path: auditPath,
      });
      assert(
        error?.message.includes("cold_export_mismatch"),
        `Expected cold_export_mismatch on wrong count, got ${error?.message}`,
      );
    }

    // 6. Invalid path -> 23514 check violation
    {
      const { error } = await supabase.rpc("cold_archive_commit", {
        _table: "broadcast_audit",
        _day: phase2.eligible90,
        _rows: auditSummary.rows,
        _key_digest: auditSummary.digest,
        _sha256: auditHash,
        _bytes: auditBytes.byteLength,
        _path: badPath,
      });
      assert(
        error &&
          (error.code === "23514" ||
            error.message.includes("check constraint")),
        `Expected 23514 on invalid path, got ${error?.code} ${error?.message}`,
      );
    }

    // Verify 0 rows deleted, 0 manifests created, 0 retired keys after all 6 rollback tests
    const [auditAfterRollback] = await sql<{ c: number }[]>`
      select count(*)::int as c from public.broadcast_audit where reason = ${`cold_verify_${phase2Tag}`}
    `;
    assert.equal(
      auditAfterRollback?.c,
      4,
      "Rollback tests must delete 0 broadcast_audit rows",
    );
    const [exportsAfterRollback] = await sql<{ c: number }[]>`
      select count(*)::int as c from public.cold_exports where table_name = 'broadcast_audit' and day = ${phase2.eligible90}::date
    `;
    assert.equal(
      exportsAfterRollback?.c,
      0,
      "Rollback tests must write 0 cold_exports rows",
    );
    const [retiredAfterRollback] = await sql<{ c: number }[]>`
      select count(*)::int as c from public.source_run_retired_keys where idempotency_key like ${`cold-verify-${phase2Tag}-%`}
    `;
    assert.equal(
      retiredAfterRollback?.c,
      0,
      "Rollback tests must write 0 source_run_retired_keys rows",
    );

    // Clean temporary negative-test objects before trial & live archiveColdDays
    await supabase.storage.from(BUCKET).remove([auditPath, badPath]);
    tracker.uploadedPaths.delete(auditPath);
    tracker.uploadedPaths.delete(badPath);

    let uploadCalls = 0;
    let commitCalls = 0;
    const liveDeps = buildColdArchiveDeps({
      mode: resolvedMode,
      sql,
      readerSql,
      supabase,
      tracker,
      duckdbBin,
      duckdbWorkDir,
      duckdbEnv,
      asOfTs: null,
      onUpload: () => {
        uploadCalls += 1;
      },
      onCommit: () => {
        commitCalls += 1;
      },
      quiet: args.json,
    });

    // Trial export (trialColdDay): uploads under trial/, commits 0 rows, deletes 0 rows
    const beforeTrialRisk = await sql<{ c: number }[]>`
      select count(*)::int as c from public.risk_forecasts where id in (
        ${phase2.ids.riskHistorical}::uuid,
        ${phase2.ids.riskCheckpoint}::uuid,
        ${phase2.ids.riskLegacyNull}::uuid
      )
    `;
    await trialColdDay(liveDeps, "risk_forecasts", phase2.eligible90);
    const trialPath = coldPath("trial", "risk_forecasts", phase2.eligible90);
    assert(
      tracker.uploadedPaths.has(trialPath),
      "trialColdDay must upload under trial/",
    );
    assert.equal(commitCalls, 0, "trialColdDay must never commit");
    const afterTrialRisk = await sql<{ c: number }[]>`
      select count(*)::int as c from public.risk_forecasts where id in (
        ${phase2.ids.riskHistorical}::uuid,
        ${phase2.ids.riskCheckpoint}::uuid,
        ${phase2.ids.riskLegacyNull}::uuid
      )
    `;
    assert.equal(
      afterTrialRisk[0]?.c,
      beforeTrialRisk[0]?.c,
      "trialColdDay must delete 0 rows",
    );

    // Live archiveColdDays Run #1 (real service_role RPCs + real local Storage)
    uploadCalls = 0;
    commitCalls = 0;
    const liveArchivedDays = await archiveColdDays(liveDeps);
    assert.equal(
      liveArchivedDays,
      8,
      "Live archiveColdDays Run #1 must archive 8 table-days",
    );
    assert.equal(
      uploadCalls,
      7,
      "Live run must upload 7 files (skipping upload for 0-row empty day)",
    );
    assert.equal(commitCalls, 8, "Live run must commit 8 manifests");

    await verifyUploadedManifests(sql, supabase, resolvedMode, liveDeps, [
      { table: "weather_snapshots", day: phase2.eligible90, rows: 2 },
      { table: "risk_forecasts", day: phase2.eligible90, rows: 2 },
      { table: "broadcast_audit", day: phase2.eligible90, rows: 2 },
      { table: "airport_observations", day: phase2.eligible90, rows: 2 },
      { table: "source_runs", day: phase2.eligible92, rows: 1 },
      { table: "source_runs", day: phase2.emptyRunsDay, rows: 0 },
      { table: "source_runs", day: phase2.eligible90, rows: 1 },
      { table: "source_jobs", day: phase2.eligible92, rows: 3 },
    ]);

    // Verify all hot & FK/state-protected rows survived, eligible rows deleted
    const [remainingWeather] = await sql<{ c: number }[]>`
      select count(*)::int as c from public.weather_snapshots where id in (
        ${phase2.ids.weatherEligible1}::uuid, ${phase2.ids.weatherEligible2}::uuid
      )
    `;
    assert.equal(remainingWeather?.c, 0);
    const [hotWeather] = await sql<{ c: number }[]>`
      select count(*)::int as c from public.weather_snapshots where id in (
        ${phase2.ids.weatherHotBoundary}::uuid, ${phase2.ids.weatherHotFk}::uuid
      )
    `;
    assert.equal(hotWeather?.c, 2);

    const [survivingJobs] = await sql<{ c: number }[]>`
      select count(*)::int as c from public.source_jobs where contract_key = ${phase2.contractKey}
    `;
    assert.equal(
      survivingJobs?.c,
      8,
      "source_jobs: 3 eligible deleted (succeeded, failed, cascaded), 8 protected/hot survived",
    );

    // Verify source_run_retired_keys populated & replay rejected by guard_retired_run
    const retiredRows = await sql<{ idempotency_key: string }[]>`
      select idempotency_key from public.source_run_retired_keys
      where idempotency_key in (${phase2.keys.runOldest}, ${phase2.keys.runCascade})
      order by 1
    `;
    assert.equal(
      retiredRows.length,
      2,
      "Archived source_runs keys must be retired",
    );
    await assert.rejects(
      () =>
        sql`
          insert into public.source_runs (
            contract_key, contract_version, trigger_kind, idempotency_key,
            scheduled_for, started_at, outcome
          ) values (
            ${phase2.contractKey}, 1, 'manual', ${phase2.keys.runCascade},
            now(), now(), 'succeeded'
          )
        `,
      /retired_source_run_key/,
      "Re-inserting a retired source_runs idempotency_key must be blocked",
    );

    // Verify broadcast_audit & risk_forecasts immutability on surviving rows
    await assert.rejects(
      () =>
        sql`update public.broadcast_audit set reason = 'tampered' where id = ${phase2.ids.auditHotBoundary}::uuid`,
      /broadcast_audit is append-only/,
    );
    await assert.rejects(
      () =>
        sql`delete from public.broadcast_audit where id = ${phase2.ids.auditHotBoundary}::uuid`,
      /broadcast_audit is append-only/,
    );
    await assert.rejects(
      () =>
        sql`delete from public.risk_forecasts where id = ${phase2.ids.riskCheckpoint}::uuid`,
      /published_risk_forecast_is_immutable/,
    );

    // Live archiveColdDays Run #2 — 100% Idempotency Proof
    uploadCalls = 0;
    commitCalls = 0;
    const secondRunDays = await archiveColdDays(liveDeps);
    assert.equal(secondRunDays, 0, "Idempotent second run must archive 0 days");
    assert.equal(uploadCalls, 0, "Idempotent second run must upload 0 objects");
    assert.equal(
      commitCalls,
      0,
      "Idempotent second run must commit 0 manifests",
    );

    // Duplicate commit rejected with 23505
    const { error: dupErr } = await supabase.rpc("cold_archive_commit", {
      _table: "source_runs",
      _day: phase2.emptyRunsDay,
      _rows: 0,
    });
    assert(
      dupErr &&
        (dupErr.code === "23505" || dupErr.message.includes("duplicate key")),
      `Duplicate commit must fail with 23505 (got ${dupErr?.code} ${dupErr?.message})`,
    );

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            dryRun: false,
            mode: resolvedMode,
            duckdbAvailable,
            dbToday,
            phase1: {
              asOf20261126ArchivedDays: archivedDays26,
              asOf20261127ArchivedDays: archivedDays27,
            },
            phase2: {
              liveArchivedDays,
              secondRunDays,
              negativeRollbackCasesPassed: 6,
              trialVerified: true,
            },
          },
          null,
          2,
        ),
      );
    } else {
      console.log(
        "[PASS] Phase 2: Live wall-clock service_role 6-table archive, 6 rollback cases, trialColdDay, immutability, retired keys & idempotency passed",
      );
      console.log("ALL COLD-ARCHIVE VERIFICATION CHECKS PASSED");
    }
  } finally {
    try {
      await cleanupFixtures(
        sql,
        supabase,
        tracker,
        initialCheckpoint,
        initialExports,
      );
    } finally {
      if (readerSql) {
        await readerSql.close().catch(() => {});
      }
      if (temporaryReaderPasswordSet) {
        await sql
          .unsafe("alter role cold_reader with password null")
          .catch(() => {});
      }
      if (duckdbWorkDir) {
        await rm(duckdbWorkDir, { recursive: true, force: true }).catch(
          () => {},
        );
      }
      await sql.close();
    }
  }
}

await main();
