import { drainWebhookDeliveries } from "@/lib/webhooks.server";
import { evaluateAlerts } from "@/lib/alerts-engine.server";
import {
  retryDispositionForReason,
  type ClaimedSourceJob,
  type SourceReplayInterval,
  type SourceJobResult,
} from "@/lib/source-jobs";
import {
  deliveryRunOutcome,
  publicReasonForError,
  sourceRunOutcome,
  type PublicSourceReason,
  type SourceRunReport,
} from "@/lib/source-runs";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runItaSource } from "@/lib/text-sources/ita-pipeline.server";
import { runItaFacebookSource } from "@/lib/text-sources/ita-facebook.server";
import {
  runTextSource,
  type TextSourceRun,
} from "@/lib/text-sources/pipeline.server";

import { algiersToday } from "./algiers-date";
import { publishBroadcasts } from "./broadcast.server";
import { deliverBroadcasts } from "./delivery.server";
import { ingestEffis } from "./effis.server";
import { ingestFci, ingestS3, type FciRun } from "./fci.server";
import { ingestFirms } from "./firms.server";
import { fuseDetections } from "./fusion.server";
import { ingestOnm } from "./onm.server";
import { ingestEmsc } from "./emsc.server";
import { ingestMetar } from "./metar.server";
import {
  flagPersistentCandidates,
  screenPersistentSources,
} from "./persistent.server";
import { enrichClusterWinds, refreshRiskForecasts } from "./weather.server";
import { collectWeatherEvidence } from "./weather-evidence.server";

export const RUNTIME_CONTRACT_KEYS = [
  "openmeteo_weather",
  "ita_website",
  "ita_facebook",
  "firms",
  "fci",
  "s3_slstr",
  "onm",
  "emsc",
  "metar",
  "persistent_screen",
  "fusion",
  "openmeteo_wind",
  "local_fwi",
  "effis",
  "alert_evaluation",
  "broadcast_publish",
  "broadcast_delivery",
] as const;

export type RuntimeContractKey = (typeof RUNTIME_CONTRACT_KEYS)[number];
export type SourceRunner = (job: ClaimedSourceJob) => Promise<SourceJobResult>;
export type SourceRunnerRegistry = Record<RuntimeContractKey, SourceRunner>;

export type SourceRunnerDependencies = {
  collectWeatherEvidence: typeof collectWeatherEvidence;
  runItaSource: typeof runItaSource;
  runItaFacebookSource: typeof runItaFacebookSource;
  ingestFirms: typeof ingestFirms;
  ingestFci: typeof ingestFci;
  ingestS3: typeof ingestS3;
  ingestOnm: typeof ingestOnm;
  ingestEmsc: typeof ingestEmsc;
  ingestMetar: typeof ingestMetar;
  screenPersistentSources: typeof screenPersistentSources;
  fuseDetections: typeof fuseDetections;
  flagPersistentCandidates: typeof flagPersistentCandidates;
  enrichClusterWinds: typeof enrichClusterWinds;
  refreshRiskForecasts: typeof refreshRiskForecasts;
  ingestEffis: typeof ingestEffis;
  evaluateAlerts: typeof evaluateAlerts;
  publishBroadcasts: typeof publishBroadcasts;
  deliverBroadcasts: typeof deliverBroadcasts;
  drainWebhookDeliveries: typeof drainWebhookDeliveries;
};

function baseReport(
  job: ClaimedSourceJob,
): Pick<
  SourceRunReport,
  "contractKey" | "trigger" | "scheduledFor" | "startedAt"
> {
  return {
    contractKey: job.contract_key,
    trigger: job.trigger_kind,
    scheduledFor: job.scheduled_for,
    startedAt: job.started_at,
  };
}

function retryDisposition(
  outcome: SourceRunReport["outcome"],
  reason: PublicSourceReason | null,
): SourceJobResult["retryDisposition"] {
  if (outcome === "succeeded" || outcome === "skipped") return "none";
  return retryDispositionForReason(reason ?? "internal_error");
}

function adapterHealth(input: {
  accepted: number;
  expected?: number | null;
  error?: string | undefined;
  disabled?: boolean;
  partialReason?: PublicSourceReason | undefined;
}) {
  const health = sourceRunOutcome(input);
  const reason = input.error
    ? publicReasonForError(input.error)
    : health.outcome === "partial"
      ? (input.partialReason ?? "coverage_partial")
      : health.outcome === "skipped"
        ? "disabled"
        : null;
  return {
    ...health,
    publicReasonCode: reason,
    privateDiagnostic: input.error ?? null,
    retryDisposition: retryDisposition(health.outcome, reason),
  };
}

function coveredInterval(job: ClaimedSourceJob, succeeded: boolean) {
  return succeeded
    ? { dataFrom: job.data_from, dataThrough: job.data_through }
    : {};
}

function replayInterval(
  job: ClaimedSourceJob,
): SourceReplayInterval | undefined {
  return job.trigger_kind === "replay"
    ? { dataFrom: job.data_from, dataThrough: job.data_through }
    : undefined;
}

function wfsFireReport(job: ClaimedSourceJob, run: FciRun): SourceJobResult {
  const accepted = Math.max(run.fetched - run.outside - run.filtered, 0);
  const health = adapterHealth({ accepted, error: run.error });
  return {
    ...baseReport(job),
    ...health,
    upstreamPublishedAt: run.latestSlot,
    dataFrom: health.outcome === "succeeded" ? (run.dataFrom ?? null) : null,
    dataThrough:
      health.outcome === "succeeded"
        ? (run.dataThrough ?? run.latestSlot)
        : null,
    recordsSeen: run.fetched,
    recordsInserted: run.inserted,
    recordsRejected: run.outside + run.filtered,
    qualityChecks: {
      inside_watch_box: run.outside === 0,
      outside_watch_area: run.filtered,
      latest_slot_age_minutes: run.ageMinutes,
    },
  };
}

export function createSourceRunners(
  dependencies: SourceRunnerDependencies,
): SourceRunnerRegistry {
  return {
    openmeteo_weather: async (job) => {
      const run = await dependencies.collectWeatherEvidence(job);
      const health = adapterHealth({
        accepted: run.accepted,
        expected: run.expected,
        error: run.error,
      });
      return {
        ...baseReport(job),
        ...health,
        ...coveredInterval(job, health.outcome === "succeeded"),
        recordsSeen: run.accepted + run.rejected,
        recordsInserted: run.inserted,
        recordsRejected: run.rejected,
        recordsExpected: run.expected,
        qualityChecks: { complete_communes: run.accepted, horizon_hours: 48 },
      };
    },
    ita_website: async (job) => {
      const run = await dependencies.runItaSource(job);
      const health = adapterHealth({
        accepted: run.stored + run.extracted,
        error: run.error,
      });
      return {
        ...baseReport(job),
        ...health,
        ...coveredInterval(job, health.outcome === "succeeded"),
        recordsSeen: run.fetched,
        recordsInserted: run.stored,
        recordsUpdated: run.extracted,
        recordsRejected: run.rejected,
        qualityChecks: {
          extraction_failed: run.failed,
          extraction_pending: run.pending,
          feed_rejected: run.rejected,
          not_modified: run.notModified,
        },
      };
    },
    ita_facebook: async (job) => {
      const run = await dependencies.runItaFacebookSource(job);
      const health = adapterHealth({
        accepted: run.fetched,
        expected: run.complete ? null : run.fetched + 1,
        error: run.error,
      });
      return {
        ...baseReport(job),
        ...health,
        ...coveredInterval(job, health.outcome === "succeeded"),
        recordsSeen: run.fetched,
        recordsInserted: run.stored,
        recordsRejected: run.rejected,
        qualityChecks: { lookback_minutes: run.lookbackMinutes },
      };
    },
    firms: async (job) => {
      const run = await dependencies.ingestFirms(replayInterval(job));
      const health = adapterHealth({ accepted: run.fetched, error: run.error });
      return {
        ...baseReport(job),
        ...health,
        dataFrom:
          health.outcome === "succeeded" ? (run.dataFrom ?? null) : null,
        dataThrough:
          health.outcome === "succeeded" ? (run.dataThrough ?? null) : null,
        recordsSeen: run.fetched,
        recordsInserted: run.inserted,
        qualityChecks: { feeds_answered: run.feeds.length },
      };
    },
    fci: async (job) =>
      wfsFireReport(job, await dependencies.ingestFci(replayInterval(job))),
    s3_slstr: async (job) =>
      wfsFireReport(job, await dependencies.ingestS3(replayInterval(job))),
    onm: async (job) => {
      const run = await dependencies.ingestOnm();
      const accepted = Math.max(run.fetched - run.unmatched, 0);
      const health = adapterHealth({
        accepted,
        expected: run.fetched || null,
        error: run.error,
      });
      return {
        ...baseReport(job),
        ...health,
        ...coveredInterval(job, health.outcome === "succeeded"),
        recordsSeen: run.fetched,
        recordsInserted: run.stored,
        recordsRejected: run.unmatched,
        recordsExpected: run.fetched || null,
        qualityChecks: {
          unmatched_wilayas: run.unmatched,
          detailed_entries: run.detailed ?? 0,
          superseded_entries: run.superseded ?? 0,
        },
      };
    },
    emsc: async (job) => {
      const run = await dependencies.ingestEmsc();
      const health = adapterHealth({ accepted: run.fetched, error: run.error });
      return {
        ...baseReport(job),
        ...health,
        ...coveredInterval(job, health.outcome === "succeeded"),
        recordsSeen: run.fetched,
        recordsInserted: run.stored,
        recordsRejected: 0,
        qualityChecks: { outside_algeria: run.outside },
      };
    },
    metar: async (job) => {
      const run = await dependencies.ingestMetar();
      const health = adapterHealth({ accepted: run.stored, error: run.error });
      return {
        ...baseReport(job),
        ...health,
        ...coveredInterval(job, health.outcome === "succeeded"),
        recordsSeen: run.fetched,
        recordsInserted: run.stored,
        recordsRejected: 0,
        qualityChecks: { stations: run.stored },
      };
    },
    persistent_screen: async (job) => {
      const run = await dependencies.screenPersistentSources();
      const complete = run.registry > 0;
      const outcome = complete ? "succeeded" : "partial";
      const reason = complete ? null : ("coverage_partial" as const);
      return {
        ...baseReport(job),
        outcome,
        coverageStatus: complete ? "complete" : "partial",
        ...coveredInterval(job, complete),
        recordsSeen: run.screened,
        recordsUpdated: run.screened,
        qualityChecks: { registry_entries: run.registry },
        publicReasonCode: reason,
        retryDisposition: retryDisposition(outcome, reason),
      };
    },
    fusion: async (job) => {
      const run = await dependencies.fuseDetections();
      const candidates = await dependencies.flagPersistentCandidates();
      return {
        ...baseReport(job),
        outcome: "succeeded",
        coverageStatus: "complete",
        ...coveredInterval(job, true),
        recordsSeen: run.processed,
        recordsInserted: run.created,
        recordsUpdated: run.clustersTouched,
        qualityChecks: {
          clusters_resolved: run.resolved,
          persistent_candidates: candidates.flagged,
        },
        retryDisposition: "none",
      };
    },
    openmeteo_wind: async (job) => {
      const updated = await dependencies.enrichClusterWinds();
      return {
        ...baseReport(job),
        outcome: "succeeded",
        coverageStatus: "complete",
        ...coveredInterval(job, true),
        recordsSeen: updated,
        recordsUpdated: updated,
        retryDisposition: "none",
      };
    },
    local_fwi: async (job) => {
      // the refresh stages into its own snapshot; a newer one supersedes this run
      const run = await dependencies.refreshRiskForecasts({
        snapshotId: crypto.randomUUID(),
        baseDate: algiersToday(new Date(job.scheduled_for)),
        scheduledFor: job.scheduled_for,
      });
      const expected = run.communes * 6;
      const missingGeography = run.communes === 0 && !run.error;
      const error =
        run.error ?? (missingGeography ? "no communes available" : undefined);
      const health = run.superseded
        ? ({
            outcome: "skipped",
            coverageStatus: "complete",
            retryDisposition: "none",
          } as const)
        : adapterHealth({
            accepted: run.rows,
            expected,
            error,
            partialReason: missingGeography ? "dependency_failed" : undefined,
          });
      return {
        ...baseReport(job),
        ...health,
        ...coveredInterval(job, health.outcome === "succeeded"),
        recordsSeen: run.rows,
        recordsInserted: run.rows,
        recordsExpected: expected || null,
        qualityChecks: {
          communes: run.communes,
          horizon_days: 6,
          requests: run.requests ?? 0,
        },
      };
    },
    effis: async (job) => {
      const run = await dependencies.ingestEffis(
        algiersToday(new Date(job.scheduled_for)),
      );
      const health = adapterHealth({
        accepted: run.classified,
        expected: run.communes || null,
        error: run.error,
      });
      return {
        ...baseReport(job),
        ...health,
        ...coveredInterval(job, health.outcome === "succeeded"),
        recordsSeen: run.communes,
        recordsInserted: run.classified,
        recordsExpected: run.communes || null,
        qualityChecks: { communes_classified: run.classified },
      };
    },
    alert_evaluation: async (job) => {
      const run = await dependencies.evaluateAlerts();
      return {
        ...baseReport(job),
        outcome: "succeeded",
        coverageStatus: "complete",
        ...coveredInterval(job, true),
        recordsSeen: run.evaluated,
        recordsInserted: run.created,
        recordsRejected: run.suppressed,
        recordsUpdated: run.sent ?? 0,
        qualityChecks: {
          delivery_failed: run.failed ?? 0,
          suppressed: run.suppressed,
        },
        retryDisposition: "none",
      };
    },
    broadcast_publish: async (job) => {
      const run = await dependencies.publishBroadcasts();
      return {
        ...baseReport(job),
        outcome: "succeeded",
        coverageStatus: "complete",
        ...coveredInterval(job, true),
        recordsSeen: run.published + run.suppressed,
        recordsInserted: run.published,
        qualityChecks: { suppressed: run.suppressed },
        retryDisposition: "none",
      };
    },
    broadcast_delivery: async (job) => {
      const [broadcasts, webhooks] = await Promise.allSettled([
        dependencies.deliverBroadcasts(),
        dependencies.drainWebhookDeliveries(),
      ]);
      if (broadcasts.status === "rejected") throw broadcasts.reason;
      if (webhooks.status === "rejected") throw webhooks.reason;
      const run = broadcasts.value;
      const webhookRun = webhooks.value;
      const broadcastHealth = deliveryRunOutcome(run);
      const health =
        webhookRun.failed > 0 && broadcastHealth.outcome !== "failed"
          ? ({
              outcome: "partial",
              coverageStatus: "partial",
              publicReasonCode: "delivery_failed",
            } as const)
          : broadcastHealth;
      return {
        ...baseReport(job),
        ...health,
        ...coveredInterval(job, health.outcome === "succeeded"),
        recordsSeen:
          run.rows + run.telegramRows + webhookRun.sent + webhookRun.failed,
        recordsUpdated: run.sent + run.telegramSent + webhookRun.sent,
        qualityChecks: {
          fcm_configured: run.fcmConfigured,
          telegram_configured: run.telegramConfigured,
          telegram_channels: run.telegramChannels,
          webhook_sent: webhookRun.sent,
          webhook_failed: webhookRun.failed,
        },
        retryDisposition: retryDisposition(
          health.outcome,
          health.publicReasonCode ?? null,
        ),
      };
    },
  };
}

const sourceRunnerDependencies: SourceRunnerDependencies = {
  collectWeatherEvidence,
  runItaSource,
  runItaFacebookSource,
  ingestFirms,
  ingestFci,
  ingestS3,
  ingestOnm,
  ingestEmsc,
  ingestMetar,
  screenPersistentSources,
  fuseDetections,
  flagPersistentCandidates,
  enrichClusterWinds,
  refreshRiskForecasts,
  ingestEffis,
  evaluateAlerts,
  publishBroadcasts,
  deliverBroadcasts,
  drainWebhookDeliveries,
};

export const SOURCE_RUNNERS = createSourceRunners(sourceRunnerDependencies);

export function isRuntimeContractKey(key: string): key is RuntimeContractKey {
  return RUNTIME_CONTRACT_KEYS.some((candidate) => candidate === key);
}

// text sources are registry rows, not compile-time keys; one runner shape serves them all
export async function textSourceRunner(
  contractKey: string,
): Promise<SourceRunner | null> {
  const { data, error } = await supabaseAdmin
    .from("text_sources")
    .select("key")
    .eq("key", contractKey)
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw new Error(`text source lookup failed: ${error.message}`);
  if (!data) return null;
  return async (job) => {
    const recovery = await supabaseAdmin.rpc("prepare_source_recovery", {
      _key: contractKey,
      _job: job.id,
      _attempt: job.attempt_count,
      ...(contractKey === "dgpc_telegram"
        ? { _parser_version: "dgpc-extract-v6" }
        : {}),
    });
    if (recovery.error)
      throw new Error(`text recovery: ${recovery.error.message}`);
    const run = await runTextSource(contractKey).catch(
      (error: unknown): TextSourceRun => ({
        fetched: 0,
        stored: 0,
        skippedPosts: 0,
        mentions: 0,
        resolved: 0,
        unresolved: 0,
        incidentsCreated: 0,
        incidentsUpdated: 0,
        incidentsUnlisted: 0,
        gated: 0,
        clustersConfirmed: 0,
        retried: 0,
        llmSkipped: false,
        llmFailed: 0,
        situationItems: 0,
        adviceStored: 0,
        rejectedSpans: 0,
        pending: 0,
        error: error instanceof Error ? error.message : "text source failed",
      }),
    );
    const health = adapterHealth({
      accepted: run.resolved + run.skippedPosts,
      error: run.error,
    });
    return {
      ...baseReport(job),
      ...health,
      ...coveredInterval(job, health.outcome === "succeeded"),
      recordsSeen: run.fetched,
      recordsInserted: run.mentions,
      recordsRejected: run.unresolved,
      qualityChecks: {
        documents_stored: run.stored,
        posts_not_fire: run.skippedPosts,
        mentions_unresolved: run.unresolved,
        incidents_created: run.incidentsCreated,
        incidents_updated: run.incidentsUpdated,
        incidents_unlisted: run.incidentsUnlisted,
        mentions_gated: run.gated,
        clusters_confirmed: run.clustersConfirmed,
        documents_retried: run.retried,
        llm_skipped: run.llmSkipped,
        llm_failed: run.llmFailed,
        situation_items: run.situationItems,
        advice_stored: run.adviceStored,
        spans_rejected: run.rejectedSpans,
        extraction_pending: run.pending,
      },
    };
  };
}
