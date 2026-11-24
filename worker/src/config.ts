import os from "node:os";

import {
  isSourceExecutionTarget,
  SOURCE_EXECUTION_TARGETS,
  type SourceExecutionTarget,
} from "@/lib/source-jobs";

export type WorkerConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  workerId: string;
  executionTargets: readonly SourceExecutionTarget[];
  concurrency: number;
  pollIntervalMs: number;
  schedulerEnabled: boolean;
  schedulerIntervalMs: number;
  leaseSeconds: number;
  jobTimeoutMs: number;
  healthHost: string;
  healthPort: number;
  drainTimeoutMs: number;
};

function parseHttpUrl(raw: string | undefined, name: string): string {
  const value = raw?.trim();
  if (!value) throw new Error(`${name} is required`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return value.replace(/\/+$/, "");
}

function parseBoundedInt(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function parseBoolean(
  raw: string | undefined,
  name: string,
  fallback: boolean,
): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be "true" or "false"`);
}

function parseExecutionTargets(
  raw: string | undefined,
): readonly SourceExecutionTarget[] {
  const source = raw === undefined || raw.trim() === "" ? "worker" : raw;
  const items = source
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (items.length === 0) {
    throw new Error(
      `WORKER_EXECUTION_TARGETS must contain at least one of ${SOURCE_EXECUTION_TARGETS.join(", ")}`,
    );
  }
  const unique: SourceExecutionTarget[] = [];
  for (const item of items) {
    if (!isSourceExecutionTarget(item)) {
      throw new Error(
        `Invalid execution target "${item}"; expected one of ${SOURCE_EXECUTION_TARGETS.join(", ")}`,
      );
    }
    if (!unique.includes(item)) unique.push(item);
  }
  return unique;
}

export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const supabaseUrl = parseHttpUrl(env["SUPABASE_URL"], "SUPABASE_URL");
  const supabaseServiceRoleKey = env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }

  const defaultWorkerId = `eu-worker:${os.hostname()}:${process.pid}`.slice(
    0,
    200,
  );
  const workerId = (env["WORKER_ID"]?.trim() || defaultWorkerId).trim();
  if (workerId.length < 1 || workerId.length > 200) {
    throw new Error("WORKER_ID must be between 1 and 200 characters");
  }

  const healthHost = (env["WORKER_HEALTH_HOST"]?.trim() || "0.0.0.0").trim();
  if (!healthHost) {
    throw new Error("WORKER_HEALTH_HOST must be non-empty");
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    workerId,
    executionTargets: parseExecutionTargets(env["WORKER_EXECUTION_TARGETS"]),
    concurrency: parseBoundedInt(
      env["WORKER_CONCURRENCY"],
      "WORKER_CONCURRENCY",
      3,
      1,
      16,
    ),
    pollIntervalMs: parseBoundedInt(
      env["WORKER_POLL_INTERVAL_MS"],
      "WORKER_POLL_INTERVAL_MS",
      2_000,
      200,
      60_000,
    ),
    schedulerEnabled: parseBoolean(
      env["WORKER_SCHEDULER_ENABLED"],
      "WORKER_SCHEDULER_ENABLED",
      true,
    ),
    schedulerIntervalMs: parseBoundedInt(
      env["WORKER_SCHEDULER_INTERVAL_MS"],
      "WORKER_SCHEDULER_INTERVAL_MS",
      30_000,
      1_000,
      300_000,
    ),
    leaseSeconds: parseBoundedInt(
      env["WORKER_LEASE_SECONDS"],
      "WORKER_LEASE_SECONDS",
      180,
      30,
      3_600,
    ),
    jobTimeoutMs: parseBoundedInt(
      env["WORKER_JOB_TIMEOUT_MS"],
      "WORKER_JOB_TIMEOUT_MS",
      1_200_000,
      1_000,
      3_600_000,
    ),
    healthHost,
    healthPort: parseBoundedInt(
      env["WORKER_HEALTH_PORT"],
      "WORKER_HEALTH_PORT",
      8090,
      0,
      65_535,
    ),
    drainTimeoutMs: parseBoundedInt(
      env["WORKER_DRAIN_TIMEOUT_MS"],
      "WORKER_DRAIN_TIMEOUT_MS",
      30_000,
      1_000,
      300_000,
    ),
  };
}
