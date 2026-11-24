import { describe, expect, it, vi } from "vitest";

import type {
  ClaimedSourceJob,
  SourceExecutionTarget,
  SourceJobResult,
} from "@/lib/source-jobs";

import { computeLeaseRenewIntervalMs, EUWorker } from "../src/runner";

function makeJob(
  id: string,
  contractKey: string,
  target: SourceExecutionTarget = "worker",
): ClaimedSourceJob {
  return {
    id,
    contract_key: contractKey,
    contract_version: 1,
    trigger_kind: "scheduled",
    idempotency_key: `scheduled:${contractKey}:${id}`,
    scheduled_for: "2026-11-24T12:00:00.000Z",
    data_from: "2026-11-24T11:58:00.000Z",
    data_through: "2026-11-24T12:00:00.000Z",
    dispatched_at: null,
    execution_target: target,
    state: "running",
    enqueued_by: ["worker"],
    available_at: "2026-11-24T12:00:00.000Z",
    attempt_count: 1,
    max_attempts: 3,
    retry_base_seconds: 30,
    retry_until: "2026-11-24T12:30:00.000Z",
    gap_id: null,
    started_at: "2026-11-24T12:00:01.000Z",
    finished_at: null,
    last_error_at: null,
    last_public_reason_code: null,
    created_at: "2026-11-24T12:00:00.000Z",
    updated_at: "2026-11-24T12:00:01.000Z",
  };
}

function okResult(job: ClaimedSourceJob): SourceJobResult {
  return {
    contractKey: job.contract_key,
    trigger: job.trigger_kind,
    scheduledFor: job.scheduled_for,
    startedAt: job.started_at,
    outcome: "succeeded",
    coverageStatus: "complete",
    retryDisposition: "none",
  };
}

describe("EUWorker", () => {
  it("runs concurrent consumer slots, scheduler tick, lease heartbeat, and completes jobs cleanly", async () => {
    const queue = [
      makeJob("job-1", "ita_facebook", "worker"),
      makeJob("job-2", "ita_website", "worker"),
    ];
    let currentInFlight = 0;
    let peakInFlight = 0;
    const renewed: string[] = [];
    const completed: string[] = [];

    const worker = new EUWorker(
      {
        workerId: "eu-worker-test",
        executionTargets: ["worker", "github"],
        concurrency: 2,
        pollIntervalMs: 25,
        schedulerEnabled: true,
        schedulerIntervalMs: 500,
        leaseSeconds: 60,
        leaseRenewIntervalMs: 20,
        jobTimeoutMs: 5_000,
        drainTimeoutMs: 5_000,
      },
      {
        claim: async ({ target }) => {
          const index = queue.findIndex((j) => j.execution_target === target);
          if (index < 0) return null;
          return queue.splice(index, 1)[0] ?? null;
        },
        execute: async (job) => {
          currentInFlight += 1;
          peakInFlight = Math.max(peakInFlight, currentInFlight);
          await new Promise((r) => setTimeout(r, 70));
          currentInFlight -= 1;
          return okResult(job);
        },
        complete: async (job) => {
          completed.push(job.id);
          return {
            ...job,
            state: "succeeded",
            finished_at: new Date().toISOString(),
          };
        },
        enqueueDue: vi.fn().mockResolvedValue(2),
        requeueExpired: vi.fn().mockResolvedValue(1),
        renewLease: async ({ jobId }) => {
          renewed.push(jobId);
          return new Date(Date.now() + 60_000).toISOString();
        },
        logger: () => {},
      },
    );

    worker.start();
    const deadline = Date.now() + 3_000;
    while (completed.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const stopped = await worker.stop(2_000);
    expect(stopped).toEqual({ drained: true, remaining: 0 });
    expect(completed.sort()).toEqual(["job-1", "job-2"]);
    expect(peakInFlight).toBe(2);
    expect(renewed.length).toBeGreaterThanOrEqual(2);
    expect(worker.getSnapshot()).toMatchObject({
      status: "draining",
      completedJobs: 2,
      failedJobs: 0,
      activeJobs: 0,
    });
    expect(worker.getSnapshot().lastSchedulerTickAt).not.toBeNull();
  });

  it("recovers from transient claim errors with backoff and drains in-flight jobs on stop()", async () => {
    const firstJob = makeJob("job-in-flight", "ita_facebook", "worker");
    const secondJob = makeJob("job-must-not-claim", "effis", "worker");
    let claimCalls = 0;
    let resolveStarted!: () => void;
    const jobStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let releaseJob!: () => void;
    const jobReleased = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });
    const completed: string[] = [];

    const worker = new EUWorker(
      {
        workerId: "eu-worker-drain",
        executionTargets: ["worker"],
        concurrency: 1,
        pollIntervalMs: 20,
        schedulerEnabled: false,
        schedulerIntervalMs: 1_000,
        leaseSeconds: 60,
        leaseRenewIntervalMs: 1_000,
        jobTimeoutMs: 5_000,
        drainTimeoutMs: 5_000,
      },
      {
        claim: async () => {
          claimCalls += 1;
          if (claimCalls === 1) throw new Error("transient db blip");
          if (claimCalls === 2) return firstJob;
          return secondJob;
        },
        execute: async (job) => {
          resolveStarted();
          await jobReleased;
          return okResult(job);
        },
        complete: async (job) => {
          completed.push(job.id);
          return { ...job, state: "succeeded" };
        },
        enqueueDue: vi.fn().mockResolvedValue(0),
        requeueExpired: vi.fn().mockResolvedValue(0),
        renewLease: vi.fn().mockResolvedValue("2026-11-24T12:10:00.000Z"),
        logger: () => {},
      },
    );

    worker.start();
    await jobStarted;

    const stopPromise = worker.stop(3_000);
    expect(worker.getSnapshot().status).toBe("draining");
    expect(worker.getSnapshot().activeJobs).toBe(1);

    releaseJob();
    const stopResult = await stopPromise;

    expect(stopResult).toEqual({ drained: true, remaining: 0 });
    expect(completed).toEqual(["job-in-flight"]);
    expect(claimCalls).toBe(2);
  });

  it("enforces bounded per-job timeout and completes as transient failure", async () => {
    const hungJob = makeJob("job-hung", "local_fwi", "worker");
    let claimedOnce = false;
    const results: SourceJobResult[] = [];

    const worker = new EUWorker(
      {
        workerId: "eu-worker-timeout",
        executionTargets: ["worker"],
        concurrency: 1,
        pollIntervalMs: 20,
        schedulerEnabled: false,
        schedulerIntervalMs: 1_000,
        leaseSeconds: 60,
        leaseRenewIntervalMs: 1_000,
        jobTimeoutMs: 50,
        drainTimeoutMs: 2_000,
      },
      {
        claim: async () => {
          if (claimedOnce) return null;
          claimedOnce = true;
          return hungJob;
        },
        execute: () => new Promise<SourceJobResult>(() => {}),
        complete: async (job, _workerId, result) => {
          results.push(result);
          return { ...job, state: "retry_wait" };
        },
        enqueueDue: vi.fn().mockResolvedValue(0),
        requeueExpired: vi.fn().mockResolvedValue(0),
        renewLease: vi.fn().mockResolvedValue("2026-11-24T12:10:00.000Z"),
        logger: () => {},
      },
    );

    worker.start();
    const deadline = Date.now() + 2_000;
    while (results.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15));
    }
    await worker.stop(1_000);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      outcome: "failed",
      publicReasonCode: "upstream_unreachable",
      retryDisposition: "transient",
    });
    expect(worker.getSnapshot().failedJobs).toBe(1);
  });

  it("survives synchronous throws in execute(), completes as internal_error, and keeps the consumer slot alive", async () => {
    const queue = [
      makeJob("job-sync-throw", "ita_facebook", "worker"),
      makeJob("job-after-throw", "ita_website", "worker"),
    ];
    const completed: Array<{ id: string; result: SourceJobResult }> = [];

    const worker = new EUWorker(
      {
        workerId: "eu-worker-sync-throw",
        executionTargets: ["worker"],
        concurrency: 1,
        pollIntervalMs: 15,
        schedulerEnabled: false,
        schedulerIntervalMs: 1_000,
        leaseSeconds: 60,
        leaseRenewIntervalMs: 1_000,
        jobTimeoutMs: 2_000,
        drainTimeoutMs: 2_000,
      },
      {
        claim: async () => queue.shift() ?? null,
        execute: (job) => {
          if (job.id === "job-sync-throw") {
            throw new Error("synchronous adapter crash");
          }
          return Promise.resolve(okResult(job));
        },
        complete: async (job, _workerId, result) => {
          completed.push({ id: job.id, result });
          return {
            ...job,
            state: result.outcome === "succeeded" ? "succeeded" : "retry_wait",
          };
        },
        enqueueDue: vi.fn().mockResolvedValue(0),
        requeueExpired: vi.fn().mockResolvedValue(0),
        renewLease: vi.fn().mockResolvedValue("2026-11-24T12:10:00.000Z"),
        logger: () => {},
      },
    );

    worker.start();
    const deadline = Date.now() + 2_000;
    while (completed.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15));
    }
    const stopped = await worker.stop(1_000);

    expect(stopped).toEqual({ drained: true, remaining: 0 });
    expect(completed).toHaveLength(2);
    expect(completed[0]?.id).toBe("job-sync-throw");
    expect(completed[0]?.result).toMatchObject({
      outcome: "failed",
      publicReasonCode: "internal_error",
      retryDisposition: "transient",
      privateDiagnostic: "synchronous adapter crash",
    });
    expect(completed[1]?.id).toBe("job-after-throw");
    expect(completed[1]?.result.outcome).toBe("succeeded");
    expect(worker.getSnapshot()).toMatchObject({
      completedJobs: 1,
      failedJobs: 1,
    });
  });

  it("caps default lease renewal heartbeat at 30s so short contracts (120s) never expire under large WORKER_LEASE_SECONDS", () => {
    expect(computeLeaseRenewIntervalMs(12)).toBe(5_000);
    expect(computeLeaseRenewIntervalMs(30)).toBe(10_000);
    expect(computeLeaseRenewIntervalMs(60)).toBe(20_000);
    expect(computeLeaseRenewIntervalMs(180)).toBe(30_000);
    expect(computeLeaseRenewIntervalMs(600)).toBe(30_000);
    expect(computeLeaseRenewIntervalMs(3_600)).toBe(30_000);
  });
});
