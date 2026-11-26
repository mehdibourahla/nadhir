import type { Database } from "@/integrations/supabase/types";

import type {
  PublicSourceReason,
  SourceRunReport,
  SourceRunTrigger,
} from "./source-runs";

export const SOURCE_EXECUTION_TARGETS = [
  "cloudflare",
  "github",
  "worker",
] as const;
export type SourceExecutionTarget = (typeof SOURCE_EXECUTION_TARGETS)[number];
export type SourceJobState =
  "queued" | "running" | "retry_wait" | "succeeded" | "failed";
export type RetryDisposition = "none" | "transient" | "permanent";

export function isSourceExecutionTarget(
  value: string,
): value is SourceExecutionTarget {
  return (SOURCE_EXECUTION_TARGETS as readonly string[]).includes(value);
}

export type SourceReplayInterval = {
  dataFrom: string;
  dataThrough: string;
};

type SourceJobRow = Database["public"]["Tables"]["source_jobs"]["Row"];

export type SourceJob = Omit<
  SourceJobRow,
  "execution_target" | "state" | "trigger_kind"
> & {
  execution_target: SourceExecutionTarget;
  state: SourceJobState;
  trigger_kind: SourceRunTrigger;
};

export type ClaimedSourceJob = SourceJob & {
  state: "running";
  started_at: string;
};

export type SourceJobResult = SourceRunReport & {
  retryDisposition: RetryDisposition;
};

export function retryDispositionForReason(
  reason: PublicSourceReason,
): Exclude<RetryDisposition, "none"> {
  switch (reason) {
    case "credentials_missing":
    case "licence_invalid":
    case "schema_invalid":
    case "disabled":
      return "permanent";
    case "upstream_unreachable":
    case "data_delayed":
    case "coverage_partial":
    case "dependency_failed":
    case "delivery_failed":
    case "internal_error":
      return "transient";
  }
}

function executionTarget(value: string): SourceExecutionTarget {
  if (isSourceExecutionTarget(value)) return value;
  throw new Error("Source job has an invalid execution target");
}

function jobState(value: string): SourceJobState {
  switch (value) {
    case "queued":
    case "running":
    case "retry_wait":
    case "succeeded":
    case "failed":
      return value;
    default:
      throw new Error("Source job has an invalid state");
  }
}

function runTrigger(value: string): SourceRunTrigger {
  switch (value) {
    case "scheduled":
    case "manual":
    case "replay":
    case "dependency":
      return value;
    default:
      throw new Error("Source job has an invalid trigger");
  }
}

export function sourceJobFromRow(row: SourceJobRow): SourceJob {
  return {
    ...row,
    execution_target: executionTarget(row.execution_target),
    state: jobState(row.state),
    trigger_kind: runTrigger(row.trigger_kind),
  };
}

export function claimedSourceJobFromRow(row: SourceJobRow): ClaimedSourceJob {
  const job = sourceJobFromRow(row);
  if (job.state !== "running" || job.started_at === null)
    throw new Error("Claim RPC returned a job without an active attempt");
  return { ...job, state: "running", started_at: job.started_at };
}
