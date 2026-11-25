import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runClaimedSourceJob } from "@/lib/ingest/source-executor.server";
import { fallbackConfig } from "@/lib/llm/fallback.server";
import {
  claimSourceJob,
  completeSourceJob,
  enqueueDueSourceJobs,
  renewSourceJobLease,
  requeueExpiredSourceJobs,
} from "@/lib/source-jobs.server";

import { loadWorkerConfig } from "./config";
import { startHealthServer } from "./health";
import { createWorkerLogger } from "./redact";
import { EUWorker } from "./runner";

const config = loadWorkerConfig(process.env);
const secrets = Array.from(
  new Set(
    [
      config.supabaseServiceRoleKey,
      process.env["NADHIR_GATEWAY_ACCESS_CLIENT_SECRET"] ?? "",
      process.env["LLM_FALLBACK_API_KEY"] ?? "",
      ...fallbackConfig(process.env).map((p) => p.apiKey),
      process.env["FIREBASE_SERVICE_ACCOUNT"] ?? "",
      process.env["FIRMS_MAP_KEY"] ?? "",
      process.env["EUMETSAT_CONSUMER_SECRET"] ?? "",
      process.env["EUMETSAT_PUSH_TOKEN"] ?? "",
      process.env["CDSE_CLIENT_SECRET"] ?? "",
      process.env["CDSE_ACCESS_TOKEN"] ?? "",
      process.env["NASA_EARTHDATA_TOKEN"] ?? "",
      process.env["TELEGRAM_BOT_TOKEN"] ?? "",
      process.env["WHATSAPP_ACCESS_TOKEN"] ?? "",
      process.env["RESEND_API_KEY"] ?? "",
    ].filter(Boolean),
  ),
);

const logger = createWorkerLogger(secrets);

const worker = new EUWorker(
  {
    workerId: config.workerId,
    executionTargets: config.executionTargets,
    concurrency: config.concurrency,
    pollIntervalMs: config.pollIntervalMs,
    schedulerEnabled: config.schedulerEnabled,
    schedulerIntervalMs: config.schedulerIntervalMs,
    leaseSeconds: config.leaseSeconds,
    jobTimeoutMs: config.jobTimeoutMs,
    drainTimeoutMs: config.drainTimeoutMs,
  },
  {
    claim: ({ workerId, target, now }) =>
      claimSourceJob(supabaseAdmin, { workerId, target, now }),
    execute: (job) => runClaimedSourceJob(job),
    complete: (job, workerId, result) =>
      completeSourceJob(supabaseAdmin, job, workerId, result),
    enqueueDue: (observedAt) =>
      enqueueDueSourceJobs(supabaseAdmin, observedAt, "worker"),
    requeueExpired: (now) => requeueExpiredSourceJobs(supabaseAdmin, now),
    renewLease: (input) => renewSourceJobLease(supabaseAdmin, input),
    checkDb: async () => {
      const { error } = await supabaseAdmin
        .from("source_contracts")
        .select("key")
        .limit(1)
        .abortSignal(AbortSignal.timeout(3_000));
      return !error;
    },
    logger,
  },
);

const health = await startHealthServer({
  host: config.healthHost,
  port: config.healthPort,
  getSnapshot: () => worker.getSnapshot(),
  checkDb: () => worker.checkDb(),
});

logger("info", "health server listening", {
  host: health.host,
  port: health.port,
  workerId: config.workerId,
});

worker.start();

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger("info", "received shutdown signal", { signal });
  const result = await worker.stop(config.drainTimeoutMs);
  await health.close().catch((error) => {
    logger("warn", "health server close failed", { error });
  });
  process.exit(result.drained ? 0 : 1);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
