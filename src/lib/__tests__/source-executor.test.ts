import { describe, expect, it, vi } from "vitest";
import { getSourceArchiveContext } from "../source-archive-context.server";

import type { ClaimedSourceJob, SourceJobResult } from "@/lib/source-jobs";
import {
  executeNextSourceJob,
  runClaimedSourceJob,
} from "@/lib/ingest/source-executor.server";
import type { SourceRunnerRegistry } from "@/lib/ingest/source-runners.server";

const claimed = (id = "job-1"): ClaimedSourceJob => ({
  id,
  contract_key: "firms",
  contract_version: 1,
  trigger_kind: "replay",
  idempotency_key: `replay:${id}`,
  scheduled_for: "2026-08-31T20:00:00.000Z",
  data_from: "2026-08-31T19:50:00.000Z",
  data_through: "2026-08-31T20:00:00.000Z",
  dispatched_at: null,
  execution_target: "cloudflare",
  state: "running",
  enqueued_by: ["manual"],
  available_at: "2026-08-31T20:00:00.000Z",
  attempt_count: 1,
  max_attempts: 3,
  retry_base_seconds: 30,
  retry_until: "2026-08-31T20:30:00.000Z",
  gap_id: "gap-1",
  started_at: "2026-08-31T20:00:01.000Z",
  finished_at: null,
  last_error_at: null,
  last_public_reason_code: null,
  created_at: "2026-08-31T20:00:00.000Z",
  updated_at: "2026-08-31T20:00:01.000Z",
});

const success = (job: ClaimedSourceJob): SourceJobResult => ({
  contractKey: job.contract_key,
  trigger: job.trigger_kind,
  scheduledFor: job.scheduled_for,
  startedAt: job.started_at,
  outcome: "succeeded",
  coverageStatus: "complete",
  dataFrom: job.data_from,
  dataThrough: job.data_through,
  retryDisposition: "none",
});

function registry(runner: SourceRunnerRegistry["firms"]): SourceRunnerRegistry {
  return new Proxy(
    { firms: runner },
    { get: (target, key) => target[key as "firms"] },
  ) as SourceRunnerRegistry;
}

describe("executeNextSourceJob", () => {
  it("returns unclaimed without invoking a runner", async () => {
    const run = vi.fn();
    const claim = vi.fn().mockResolvedValue(null);
    const complete = vi.fn();

    await expect(
      executeNextSourceJob(
        { target: "cloudflare", workerId: "worker-1" },
        {
          claim,
          complete,
          runners: registry(run),
          textRunner: vi.fn().mockResolvedValue(null),
        },
      ),
    ).resolves.toEqual({ claimed: false });
    expect(run).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("runs and completes exactly the claimed contract", async () => {
    const job = claimed();
    const result = success(job);
    const run = vi.fn(async () => {
      expect(getSourceArchiveContext()).toMatchObject({
        jobId: job.id,
        attempt: job.attempt_count,
        contractVersion: job.contract_version,
      });
      return result;
    });
    const complete = vi
      .fn()
      .mockResolvedValue({ ...job, state: "succeeded", finished_at: "done" });

    await expect(
      executeNextSourceJob(
        { target: "cloudflare", workerId: "worker-1" },
        {
          claim: vi.fn().mockResolvedValue(job),
          complete,
          runners: registry(run),
          textRunner: vi.fn().mockResolvedValue(null),
        },
      ),
    ).resolves.toEqual({
      claimed: true,
      contract: "firms",
      state: "succeeded",
    });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(job);
    expect(complete).toHaveBeenCalledWith(job, "worker-1", result);
  });

  it("turns an unknown runner throw into one transient audited failure", async () => {
    const job = claimed();
    const complete = vi.fn().mockResolvedValue({ ...job, state: "retry_wait" });

    await executeNextSourceJob(
      { target: "cloudflare", workerId: "worker-1" },
      {
        claim: vi.fn().mockResolvedValue(job),
        complete,
        runners: registry(
          vi.fn().mockRejectedValue(new Error("private adapter failure")),
        ),
        textRunner: vi.fn().mockResolvedValue(null),
      },
    );

    expect(complete).toHaveBeenCalledWith(
      job,
      "worker-1",
      expect.objectContaining({
        outcome: "failed",
        publicReasonCode: "internal_error",
        privateDiagnostic: "private adapter failure",
        retryDisposition: "transient",
      }),
    );
  });

  it("rejects when completion fails so lease expiry can recover the job", async () => {
    const job = claimed();

    await expect(
      executeNextSourceJob(
        { target: "cloudflare", workerId: "worker-1" },
        {
          claim: vi.fn().mockResolvedValue(job),
          complete: vi.fn().mockRejectedValue(new Error("completion failed")),
          runners: registry(vi.fn().mockResolvedValue(success(job))),
          textRunner: vi.fn().mockResolvedValue(null),
        },
      ),
    ).rejects.toThrow("completion failed");
  });

  it("passes an identical replay interval to every attempt", async () => {
    const first = claimed("job-replay-1");
    const second = claimed("job-replay-2");
    const run = vi.fn().mockImplementation(success);
    const complete = vi
      .fn()
      .mockImplementation(async (job: ClaimedSourceJob) => ({
        ...job,
        state: "succeeded",
      }));
    const claim = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const deps = {
      claim,
      complete,
      runners: registry(run),
      textRunner: vi.fn().mockResolvedValue(null),
    };

    await executeNextSourceJob(
      { target: "cloudflare", workerId: "worker-1" },
      deps,
    );
    await executeNextSourceJob(
      { target: "cloudflare", workerId: "worker-1" },
      deps,
    );

    expect(
      run.mock.calls.map(([job]) => [job.data_from, job.data_through]),
    ).toEqual([
      [first.data_from, first.data_through],
      [first.data_from, first.data_through],
    ]);
  });
});

describe("executeNextSourceJob for registry-driven text sources", () => {
  it("runs a contract that is not in the static registry through the text runner", async () => {
    const job = { ...claimed(), contract_key: "dgpc_telegram" };
    const result = { ...success(job), contractKey: "dgpc_telegram" };
    const textRunner = vi.fn().mockResolvedValue(result);
    const complete = vi.fn().mockResolvedValue({ ...job, state: "succeeded" });

    await expect(
      executeNextSourceJob(
        { target: "cloudflare", workerId: "worker-1" },
        {
          claim: vi.fn().mockResolvedValue(job),
          complete,
          runners: registry(vi.fn()),
          textRunner: vi.fn().mockResolvedValue(textRunner),
        },
      ),
    ).resolves.toEqual({
      claimed: true,
      contract: "dgpc_telegram",
      state: "succeeded",
    });
    expect(textRunner).toHaveBeenCalledWith(job);
  });

  it("fails the job when no runner of either kind exists", async () => {
    const job = { ...claimed(), contract_key: "mystery" };
    const complete = vi.fn().mockResolvedValue({ ...job, state: "failed" });

    await executeNextSourceJob(
      { target: "cloudflare", workerId: "worker-1" },
      {
        claim: vi.fn().mockResolvedValue(job),
        complete,
        runners: registry(vi.fn()),
        textRunner: vi.fn().mockResolvedValue(null),
      },
    );

    expect(complete).toHaveBeenCalledWith(
      job,
      "worker-1",
      expect.objectContaining({
        outcome: "failed",
        publicReasonCode: "internal_error",
        privateDiagnostic: "No runner is registered for the claimed contract",
      }),
    );
  });

  it("runClaimedSourceJob executes a worker-targeted job with archive context and wraps throws", async () => {
    const workerJob: ClaimedSourceJob = {
      ...claimed("job-worker-1"),
      execution_target: "worker",
    };
    const expected = success(workerJob);
    const runner = vi.fn(async () => {
      expect(getSourceArchiveContext()).toMatchObject({
        jobId: workerJob.id,
        attempt: workerJob.attempt_count,
        parserVersion: "v2",
      });
      return expected;
    });

    await expect(
      runClaimedSourceJob(workerJob, {
        runners: registry(runner),
        textRunner: vi.fn().mockResolvedValue(null),
        parserVersion: vi.fn().mockResolvedValue("v2"),
      }),
    ).resolves.toEqual(expected);

    await expect(
      runClaimedSourceJob(workerJob, {
        runners: registry(vi.fn().mockRejectedValue(new Error("boom"))),
        textRunner: vi.fn().mockResolvedValue(null),
      }),
    ).resolves.toMatchObject({
      outcome: "failed",
      publicReasonCode: "internal_error",
      privateDiagnostic: "boom",
      retryDisposition: "transient",
    });
  });
});
