import type {
  ClaimedSourceJob,
  SourceExecutionTarget,
  SourceJob,
  SourceJobResult,
} from "@/lib/source-jobs";

import type { WorkerHealthSnapshot } from "./health";
import { createWorkerLogger, type WorkerLogger } from "./redact";

export type EUWorkerOptions = {
  workerId: string;
  executionTargets: readonly SourceExecutionTarget[];
  concurrency: number;
  pollIntervalMs: number;
  schedulerEnabled: boolean;
  schedulerIntervalMs: number;
  leaseSeconds: number;
  leaseRenewIntervalMs?: number | undefined;
  jobTimeoutMs: number;
  drainTimeoutMs: number;
};

export type EUWorkerDependencies = {
  claim: (input: {
    workerId: string;
    target: SourceExecutionTarget;
    now: string;
  }) => Promise<ClaimedSourceJob | null>;
  execute: (job: ClaimedSourceJob) => Promise<SourceJobResult>;
  complete: (
    job: ClaimedSourceJob,
    workerId: string,
    result: SourceJobResult,
  ) => Promise<SourceJob>;
  enqueueDue: (observedAt: string) => Promise<number>;
  requeueExpired: (now: string) => Promise<number>;
  renewLease: (input: {
    jobId: string;
    workerId: string;
    attempt: number;
    leaseSeconds: number;
    now: string;
  }) => Promise<string>;
  checkDb?: (() => Promise<boolean>) | undefined;
  logger?: WorkerLogger | undefined;
  now?: (() => number) | undefined;
};

export type StopResult = {
  drained: boolean;
  remaining: number;
};

const MAX_ERROR_BACKOFF_MS = 30_000;

function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function timeoutFailure(
  job: ClaimedSourceJob,
  timeoutMs: number,
): SourceJobResult {
  return {
    contractKey: job.contract_key,
    trigger: job.trigger_kind,
    scheduledFor: job.scheduled_for,
    startedAt: job.started_at,
    outcome: "failed",
    coverageStatus: "unknown",
    publicReasonCode: "upstream_unreachable",
    privateDiagnostic: `worker job execution exceeded ${timeoutMs}ms ceiling`,
    retryDisposition: "transient",
  };
}

function unexpectedFailure(
  job: ClaimedSourceJob,
  error: unknown,
): SourceJobResult {
  return {
    contractKey: job.contract_key,
    trigger: job.trigger_kind,
    scheduledFor: job.scheduled_for,
    startedAt: job.started_at,
    outcome: "failed",
    coverageStatus: "unknown",
    publicReasonCode: "internal_error",
    privateDiagnostic:
      error instanceof Error ? error.message : "unknown worker execution error",
    retryDisposition: "transient",
  };
}

export class EUWorker {
  private readonly options: EUWorkerOptions;
  private readonly deps: EUWorkerDependencies;
  private readonly logger: WorkerLogger;
  private readonly nowFn: () => number;

  private startedAt = 0;
  private running = false;
  private stopping = false;
  private stopController: AbortController | null = null;
  private slotPromises: Promise<void>[] = [];
  private schedulerPromise: Promise<void> | null = null;
  private readonly inFlightJobs = new Map<string, Promise<void>>();
  private completedJobs = 0;
  private failedJobs = 0;
  private lastSchedulerTickAt: string | null = null;
  private lastSchedulerError: string | null = null;
  private targetCursor = 0;

  constructor(options: EUWorkerOptions, deps: EUWorkerDependencies) {
    this.options = options;
    this.deps = deps;
    this.logger = deps.logger ?? createWorkerLogger();
    this.nowFn = deps.now ?? Date.now;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    this.startedAt = this.nowFn();
    this.stopController = new AbortController();

    this.logger("info", "eu worker starting", {
      workerId: this.options.workerId,
      targets: [...this.options.executionTargets],
      concurrency: this.options.concurrency,
      schedulerEnabled: this.options.schedulerEnabled,
    });

    if (this.options.schedulerEnabled) {
      this.schedulerPromise = this.runSchedulerLoop(this.stopController.signal);
    }

    this.slotPromises = Array.from(
      { length: this.options.concurrency },
      (_, i) => this.runConsumerSlot(i, this.stopController!.signal),
    );
  }

  getSnapshot(): WorkerHealthSnapshot {
    return {
      status: this.stopping ? "draining" : "ok",
      workerId: this.options.workerId,
      uptimeMs:
        this.startedAt > 0 ? Math.max(0, this.nowFn() - this.startedAt) : 0,
      activeJobs: this.inFlightJobs.size,
      targets: this.options.executionTargets,
      completedJobs: this.completedJobs,
      failedJobs: this.failedJobs,
      lastSchedulerTickAt: this.lastSchedulerTickAt,
    };
  }

  getLastSchedulerError(): string | null {
    return this.lastSchedulerError;
  }

  async checkDb(): Promise<boolean> {
    if (!this.deps.checkDb) return true;
    try {
      return await this.deps.checkDb();
    } catch {
      return false;
    }
  }

  async stop(
    drainTimeoutMs: number = this.options.drainTimeoutMs,
  ): Promise<StopResult> {
    if (!this.running && !this.stopping) {
      return { drained: true, remaining: 0 };
    }
    this.stopping = true;
    this.stopController?.abort();

    this.logger("info", "eu worker draining", {
      workerId: this.options.workerId,
      activeJobs: this.inFlightJobs.size,
      drainTimeoutMs,
    });

    const allLoops: Promise<unknown>[] = [...this.slotPromises];
    if (this.schedulerPromise) allLoops.push(this.schedulerPromise);

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(allLoops),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, drainTimeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const remaining = this.inFlightJobs.size;
    const drained = !timedOut && remaining === 0;
    this.running = false;

    this.logger(drained ? "info" : "warn", "eu worker stopped", {
      workerId: this.options.workerId,
      drained,
      remaining,
      completedJobs: this.completedJobs,
      failedJobs: this.failedJobs,
    });

    return { drained, remaining };
  }

  async runSchedulerTick(): Promise<{ enqueued: number; requeued: number }> {
    const nowIso = new Date(this.nowFn()).toISOString();
    const enqueued = await this.deps.enqueueDue(nowIso);
    const requeued = await this.deps.requeueExpired(nowIso);
    this.lastSchedulerTickAt = nowIso;
    this.lastSchedulerError = null;
    if (enqueued > 0 || requeued > 0) {
      this.logger("info", "scheduler tick completed", { enqueued, requeued });
    }
    return { enqueued, requeued };
  }

  private async runSchedulerLoop(signal: AbortSignal): Promise<void> {
    let consecutiveErrors = 0;
    while (!this.stopping && !signal.aborted) {
      try {
        await this.runSchedulerTick();
        consecutiveErrors = 0;
        await interruptibleSleep(this.options.schedulerIntervalMs, signal);
      } catch (error) {
        consecutiveErrors += 1;
        this.lastSchedulerError =
          error instanceof Error ? error.message : "scheduler error";
        this.logger("error", "scheduler tick failed", {
          error,
          consecutiveErrors,
        });
        const backoff = Math.min(
          this.options.pollIntervalMs * 2 ** (consecutiveErrors - 1),
          MAX_ERROR_BACKOFF_MS,
        );
        await interruptibleSleep(backoff, signal);
      }
    }
  }

  private nextTargetOrder(): SourceExecutionTarget[] {
    const targets = this.options.executionTargets;
    if (targets.length <= 1) return [...targets];
    const start = this.targetCursor % targets.length;
    this.targetCursor = (this.targetCursor + 1) % targets.length;
    return [...targets.slice(start), ...targets.slice(0, start)];
  }

  private async claimAnyTarget(): Promise<ClaimedSourceJob | null> {
    const ordered = this.nextTargetOrder();
    for (const target of ordered) {
      if (this.stopping) return null;
      const job = await this.deps.claim({
        workerId: this.options.workerId,
        target,
        now: new Date(this.nowFn()).toISOString(),
      });
      if (job) return job;
    }
    return null;
  }

  private async runConsumerSlot(
    slotIndex: number,
    signal: AbortSignal,
  ): Promise<void> {
    let consecutiveErrors = 0;
    while (!this.stopping && !signal.aborted) {
      let claimed: ClaimedSourceJob | null;
      try {
        claimed = await this.claimAnyTarget();
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors += 1;
        this.logger("error", "source job claim failed", {
          slotIndex,
          error,
          consecutiveErrors,
        });
        const backoff = Math.min(
          this.options.pollIntervalMs * 2 ** (consecutiveErrors - 1),
          MAX_ERROR_BACKOFF_MS,
        );
        await interruptibleSleep(backoff, signal);
        continue;
      }

      if (!claimed) {
        await interruptibleSleep(this.options.pollIntervalMs, signal);
        continue;
      }

      const execution = this.processClaimedJob(claimed, slotIndex);
      this.inFlightJobs.set(claimed.id, execution);
      try {
        await execution;
      } finally {
        this.inFlightJobs.delete(claimed.id);
      }
    }
  }

  private async processClaimedJob(
    job: ClaimedSourceJob,
    slotIndex: number,
  ): Promise<void> {
    const renewIntervalMs =
      this.options.leaseRenewIntervalMs ??
      Math.max(5_000, Math.floor((this.options.leaseSeconds * 1_000) / 3));

    let heartbeatStopped = false;
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (heartbeatStopped || renewing) return;
      renewing = true;
      void this.deps
        .renewLease({
          jobId: job.id,
          workerId: this.options.workerId,
          attempt: job.attempt_count,
          leaseSeconds: this.options.leaseSeconds,
          now: new Date(this.nowFn()).toISOString(),
        })
        .catch((error) => {
          heartbeatStopped = true;
          clearInterval(heartbeat);
          this.logger("warn", "lease renewal failed", {
            slotIndex,
            jobId: job.id,
            contract: job.contract_key,
            attempt: job.attempt_count,
            error,
          });
        })
        .finally(() => {
          renewing = false;
        });
    }, renewIntervalMs);

    let result: SourceJobResult;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<SourceJobResult>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve(timeoutFailure(job, this.options.jobTimeoutMs));
        }, this.options.jobTimeoutMs);
      });

      const runPromise = this.deps
        .execute(job)
        .catch((error) => unexpectedFailure(job, error));

      result = await Promise.race([runPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      heartbeatStopped = true;
      clearInterval(heartbeat);
    }

    try {
      const completed = await this.deps.complete(
        job,
        this.options.workerId,
        result,
      );
      if (completed.state === "succeeded") {
        this.completedJobs += 1;
      } else {
        this.failedJobs += 1;
      }
      this.logger("info", "source job completed", {
        slotIndex,
        jobId: job.id,
        contract: job.contract_key,
        target: job.execution_target,
        attempt: job.attempt_count,
        outcome: result.outcome,
        state: completed.state,
      });
    } catch (error) {
      this.failedJobs += 1;
      this.logger("error", "source job completion failed", {
        slotIndex,
        jobId: job.id,
        contract: job.contract_key,
        attempt: job.attempt_count,
        error,
      });
    }
  }
}
