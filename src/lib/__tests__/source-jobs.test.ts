import { describe, expect, it, vi } from "vitest";

import {
  isSourceExecutionTarget,
  retryDispositionForReason,
  sourceJobFromRow,
  type ClaimedSourceJob,
  type SourceJobResult,
} from "@/lib/source-jobs";
import {
  claimSourceJob,
  completeSourceJob,
  enqueueDueSourceJobs,
  renewSourceJobLease,
  requeueExpiredSourceJobs,
  sourceJobQueueHasPending,
} from "@/lib/source-jobs.server";

const claimedJob: ClaimedSourceJob = {
  id: "11111111-1111-4111-8111-111111111111",
  contract_key: "firms",
  contract_version: 1,
  trigger_kind: "scheduled",
  idempotency_key: "scheduled:firms:2026-08-31T20:00:00Z",
  scheduled_for: "2026-08-31T20:00:00.000Z",
  data_from: "2026-08-31T19:50:00.000Z",
  data_through: "2026-08-31T20:00:00.000Z",
  dispatched_at: null,
  execution_target: "cloudflare",
  state: "running",
  enqueued_by: ["database", "cloudflare"],
  available_at: "2026-08-31T20:00:00.000Z",
  attempt_count: 1,
  max_attempts: 3,
  retry_base_seconds: 30,
  retry_until: "2026-08-31T20:30:00.000Z",
  gap_id: null,
  started_at: "2026-08-31T20:00:01.000Z",
  finished_at: null,
  last_error_at: null,
  last_public_reason_code: null,
  created_at: "2026-08-31T20:00:00.000Z",
  updated_at: "2026-08-31T20:00:01.000Z",
};

describe("retryDispositionForReason", () => {
  it.each([
    ["credentials_missing", "permanent"],
    ["licence_invalid", "permanent"],
    ["schema_invalid", "permanent"],
    ["disabled", "permanent"],
    ["upstream_unreachable", "transient"],
    ["coverage_partial", "transient"],
    ["dependency_failed", "transient"],
    ["internal_error", "transient"],
  ] as const)("classifies %s as %s", (reason, expected) => {
    expect(retryDispositionForReason(reason)).toBe(expected);
  });
});

describe("source job RPC adapters", () => {
  it("claims with exact database argument names and returns the first row", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [claimedJob], error: null });

    await expect(
      claimSourceJob(
        { rpc },
        {
          workerId: "worker-1",
          target: "cloudflare",
          contractKey: "firms",
          now: "2026-08-31T20:00:01.000Z",
        },
      ),
    ).resolves.toEqual(claimedJob);
    expect(rpc).toHaveBeenCalledWith("claim_source_job", {
      _worker_id: "worker-1",
      _execution_target: "cloudflare",
      _contract_key: "firms",
      _now: "2026-08-31T20:00:01.000Z",
    });
  });

  it("returns null when no job is claimable", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    await expect(
      claimSourceJob({ rpc }, { workerId: "worker-1", target: "cloudflare" }),
    ).resolves.toBeNull();
  });

  it("distinguishes a future retry from a drained queue", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      sourceJobQueueHasPending(
        { rpc },
        {
          target: "github",
          contractKey: "local_fwi",
          now: "2026-08-31T20:00:01.000Z",
        },
      ),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("source_job_queue_has_pending", {
      _execution_target: "github",
      _contract_key: "local_fwi",
      _now: "2026-08-31T20:00:01.000Z",
    });
  });

  it("enqueues the independently observed scheduler minute", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 11, error: null });

    await expect(
      enqueueDueSourceJobs({ rpc }, "2026-08-31T20:07:00.000Z", "cloudflare"),
    ).resolves.toBe(11);
    expect(rpc).toHaveBeenCalledWith("enqueue_due_source_jobs", {
      _observed_at: "2026-08-31T20:07:00.000Z",
      _enqueued_by: "cloudflare",
    });
  });

  it("completes the leased attempt with retry policy and exact report fields", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...claimedJob, state: "retry_wait" },
      error: null,
    });
    const result: SourceJobResult = {
      contractKey: "firms",
      trigger: "scheduled",
      scheduledFor: "2026-08-31T20:00:00.000Z",
      startedAt: "2026-08-31T20:00:01.000Z",
      finishedAt: "2026-08-31T20:00:03.000Z",
      outcome: "failed",
      coverageStatus: "unknown",
      recordsSeen: 0,
      qualityChecks: { provider_answered: false },
      publicReasonCode: "upstream_unreachable",
      privateDiagnostic: "private provider timeout",
      retryDisposition: "transient",
    };

    await expect(
      completeSourceJob({ rpc }, claimedJob, "worker-1", result),
    ).resolves.toMatchObject({ state: "retry_wait" });
    expect(rpc).toHaveBeenCalledWith("complete_source_job", {
      _job_id: claimedJob.id,
      _worker_id: "worker-1",
      _attempt: 1,
      _finished_at: "2026-08-31T20:00:03.000Z",
      _outcome: "failed",
      _upstream_published_at: null,
      _data_from: null,
      _data_through: null,
      _validated_at: null,
      _published_at: null,
      _records_seen: 0,
      _records_inserted: 0,
      _records_updated: 0,
      _records_rejected: 0,
      _records_expected: null,
      _coverage_status: "unknown",
      _quality_checks: { provider_answered: false },
      _public_reason_code: "upstream_unreachable",
      _private_diagnostic: "private provider timeout",
      _retryable: true,
    });
  });

  it("never swallows a completion RPC failure", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    const result: SourceJobResult = {
      contractKey: "firms",
      trigger: "scheduled",
      scheduledFor: "2026-08-31T20:00:00.000Z",
      startedAt: "2026-08-31T20:00:01.000Z",
      outcome: "failed",
      coverageStatus: "unknown",
      publicReasonCode: "internal_error",
      retryDisposition: "transient",
    };

    await expect(
      completeSourceJob({ rpc }, claimedJob, "worker-1", result),
    ).rejects.toThrow("Could not complete source job");
  });

  it("supports the standalone EU worker target, scheduler, recovery, and lease renewal", async () => {
    expect(isSourceExecutionTarget("worker")).toBe(true);
    expect(isSourceExecutionTarget("cloudflare")).toBe(true);
    expect(isSourceExecutionTarget("github")).toBe(true);
    expect(isSourceExecutionTarget("other")).toBe(false);

    const workerRow = {
      ...claimedJob,
      execution_target: "worker",
      enqueued_by: ["worker"],
    };
    expect(sourceJobFromRow(workerRow).execution_target).toBe("worker");

    const enqueueRpc = vi.fn().mockResolvedValue({ data: 5, error: null });
    await expect(
      enqueueDueSourceJobs(
        { rpc: enqueueRpc },
        "2026-11-24T12:00:00Z",
        "worker",
      ),
    ).resolves.toBe(5);
    expect(enqueueRpc).toHaveBeenCalledWith("enqueue_due_source_jobs", {
      _observed_at: "2026-11-24T12:00:00Z",
      _enqueued_by: "worker",
    });

    const recoverRpc = vi.fn().mockResolvedValue({ data: 2, error: null });
    await expect(
      requeueExpiredSourceJobs({ rpc: recoverRpc }, "2026-11-24T12:05:00Z"),
    ).resolves.toBe(2);
    expect(recoverRpc).toHaveBeenCalledWith("requeue_expired_source_jobs", {
      _now: "2026-11-24T12:05:00Z",
    });

    const renewRpc = vi
      .fn()
      .mockResolvedValue({ data: "2026-11-24T12:10:00Z", error: null });
    await expect(
      renewSourceJobLease(
        { rpc: renewRpc },
        {
          jobId: claimedJob.id,
          workerId: "eu-worker-1",
          attempt: 1,
          leaseSeconds: 180,
          now: "2026-11-24T12:07:00Z",
        },
      ),
    ).resolves.toBe("2026-11-24T12:10:00Z");
    expect(renewRpc).toHaveBeenCalledWith("renew_source_job_lease", {
      _job_id: claimedJob.id,
      _worker_id: "eu-worker-1",
      _attempt: 1,
      _lease_seconds: 180,
      _now: "2026-11-24T12:07:00Z",
    });
  });
});
