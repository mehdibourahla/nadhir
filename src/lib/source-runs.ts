import type { Database } from "@/integrations/supabase/types";

export type SourceRunOutcome = "succeeded" | "partial" | "failed" | "skipped";

export type SourceRunTrigger = "scheduled" | "manual" | "replay" | "dependency";

export type SourceCoverageStatus = "complete" | "partial" | "unknown";

export type PublicSourceReason =
  | "credentials_missing"
  | "licence_invalid"
  | "upstream_unreachable"
  | "schema_invalid"
  | "data_delayed"
  | "coverage_partial"
  | "dependency_failed"
  | "delivery_failed"
  | "disabled"
  | "internal_error";

export type SourceRunReport = {
  contractKey: string;
  trigger: SourceRunTrigger;
  scheduledFor: string;
  startedAt: string;
  finishedAt?: string;
  outcome: SourceRunOutcome;
  upstreamPublishedAt?: string | null;
  dataFrom?: string | null;
  dataThrough?: string | null;
  validatedAt?: string | null;
  publishedAt?: string | null;
  recordsSeen?: number;
  recordsInserted?: number;
  recordsUpdated?: number;
  recordsRejected?: number;
  recordsExpected?: number | null;
  coverageStatus: SourceCoverageStatus;
  qualityChecks?: Record<string, boolean | number | string | null>;
  publicReasonCode?: PublicSourceReason | null;
  privateDiagnostic?: string | null;
};

export function publicReasonForError(error: string): PublicSourceReason {
  const message = error.toLowerCase();

  // a parse failure is usually an error page from a flaky upstream, not a schema
  // change; calling it permanent retires the job with retries still budgeted
  if (
    message.includes("schema") ||
    message.includes("axis order") ||
    message.includes("malformed")
  )
    return "schema_invalid";

  if (
    (message.includes("licence") || message.includes("license")) &&
    !/\b(?:http\s+\d{3}|[45]\d\d)\b/.test(message) &&
    !message.includes("wfs") &&
    !message.includes("fetch") &&
    !message.includes("network") &&
    !message.includes("upstream")
  )
    return "licence_invalid";

  if (
    message.includes("missing") ||
    message.includes("not configured") ||
    message.includes("credential")
  )
    return "credentials_missing";

  if (
    message.includes("http") ||
    message.includes("wfs") ||
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("upstream") ||
    /\b[45]\d\d\b/.test(message)
  )
    return "upstream_unreachable";

  if (message.includes("provider") || message.includes("feed"))
    return "upstream_unreachable";

  return "internal_error";
}

export function sourceRunIdempotencyKey(
  contractKey: string,
  trigger: SourceRunTrigger,
  scheduledFor: string,
) {
  return `${contractKey}:${trigger}:${scheduledFor}`;
}

export function sourceRunOutcome(input: {
  accepted: number;
  expected?: number | null;
  error?: string | null | undefined;
  disabled?: boolean;
}): Pick<SourceRunReport, "outcome" | "coverageStatus"> {
  if (input.disabled) return { outcome: "skipped", coverageStatus: "unknown" };

  if (input.error) {
    if (input.accepted > 0)
      return { outcome: "partial", coverageStatus: "partial" };
    return { outcome: "failed", coverageStatus: "unknown" };
  }

  if (input.expected != null && input.accepted < input.expected)
    return { outcome: "partial", coverageStatus: "partial" };

  return { outcome: "succeeded", coverageStatus: "complete" };
}

export function deliveryRunOutcome(input: {
  disabled: boolean;
  fcmConfigured: boolean;
  telegramConfigured: boolean;
  telegramChannels: number;
}): Pick<SourceRunReport, "outcome" | "coverageStatus" | "publicReasonCode"> {
  if (input.disabled)
    return {
      outcome: "skipped",
      coverageStatus: "unknown",
      publicReasonCode: "disabled",
    };

  if (!input.fcmConfigured && !input.telegramConfigured)
    return {
      outcome: "failed",
      coverageStatus: "unknown",
      publicReasonCode: "credentials_missing",
    };

  if (!input.fcmConfigured || !input.telegramConfigured)
    return {
      outcome: "partial",
      coverageStatus: "partial",
      publicReasonCode: "credentials_missing",
    };

  if (input.telegramChannels === 0)
    return {
      outcome: "partial",
      coverageStatus: "partial",
      publicReasonCode: "coverage_partial",
    };

  return {
    outcome: "succeeded",
    coverageStatus: "complete",
    publicReasonCode: null,
  };
}

type GeneratedSourceRunRpcArgs =
  Database["public"]["Functions"]["record_source_run"]["Args"];
type NullableSourceRunArg =
  | "_data_from"
  | "_data_through"
  | "_private_diagnostic"
  | "_public_reason_code"
  | "_published_at"
  | "_records_expected"
  | "_upstream_published_at"
  | "_validated_at";

export type SourceRunRpcArgs = Omit<
  GeneratedSourceRunRpcArgs,
  NullableSourceRunArg
> & {
  [Key in NullableSourceRunArg]: GeneratedSourceRunRpcArgs[Key] | null;
};

export function sourceRunRpcArgs(
  report: SourceRunReport,
  now: string,
): SourceRunRpcArgs {
  const finishedAt = report.finishedAt ?? now;
  const succeeded = report.outcome === "succeeded";

  return {
    _contract_key: report.contractKey,
    _trigger_kind: report.trigger,
    _idempotency_key: sourceRunIdempotencyKey(
      report.contractKey,
      report.trigger,
      report.scheduledFor,
    ),
    _scheduled_for: report.scheduledFor,
    _started_at: report.startedAt,
    _finished_at: finishedAt,
    _outcome: report.outcome,
    _upstream_published_at: report.upstreamPublishedAt ?? null,
    _data_from: report.dataFrom ?? null,
    _data_through: report.dataThrough ?? null,
    _validated_at: succeeded
      ? (report.validatedAt ?? finishedAt)
      : (report.validatedAt ?? null),
    _published_at: succeeded
      ? (report.publishedAt ?? finishedAt)
      : (report.publishedAt ?? null),
    _records_seen: report.recordsSeen ?? 0,
    _records_inserted: report.recordsInserted ?? 0,
    _records_updated: report.recordsUpdated ?? 0,
    _records_rejected: report.recordsRejected ?? 0,
    _records_expected: report.recordsExpected ?? null,
    _coverage_status: report.coverageStatus,
    _quality_checks: report.qualityChecks ?? {},
    _public_reason_code: report.publicReasonCode ?? null,
    _private_diagnostic: report.privateDiagnostic ?? null,
  };
}
