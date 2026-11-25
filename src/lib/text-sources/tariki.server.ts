import { ArchiveFailure, archivedFetch } from "@/lib/source-archive.server";
import {
  retryDispositionForReason,
  type ClaimedSourceJob,
  type SourceJobResult,
} from "@/lib/source-jobs";
import { publicReasonForError, sourceRunOutcome } from "@/lib/source-runs";

import {
  defaultSituationReader,
  readSituation,
  TARIKI_SOURCE,
  type Situation,
} from "./dgpc-situation.server";
import {
  extractFacebookPageSlug,
  facebookPageFetch,
  fetchFacebookPagePosts,
} from "./facebook-page";
import { LlmUnavailable } from "./llm-unavailable";
import {
  createTextSourceSupabaseStore,
  runTextSourceWith,
  type TextSource,
  type TextSourceRun,
  type TextSourceStore,
} from "./pipeline.server";
import {
  classifyTarikiPostPreFilter,
  filterTarikiNonFireItems,
  TARIKI_PAGE_SLUG,
  TARIKI_SOURCE_KEY,
  tarikiPostsFromFacebookPage,
  type TarikiNormalizedBatch,
} from "./tariki";
import type { TelegramPost } from "./telegram-public";

export type TarikiRun = TextSourceRun & {
  upstreamPublishedAt: string | null;
  totalSeen: number;
  preFiltered: number;
};

export async function fetchTarikiPosts(
  source: Pick<TextSource, "key" | "url">,
  knownExternalIds: ReadonlySet<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<TarikiNormalizedBatch> {
  const slug = extractFacebookPageSlug(source.url || TARIKI_PAGE_SLUG);
  const rawPosts = await fetchFacebookPagePosts(slug, (input, init) =>
    archivedFetch(source.key || TARIKI_SOURCE_KEY, "page_posts", input, init, {
      fetchImpl: facebookPageFetch(fetchImpl),
      requestParams: { page: slug },
    }),
  );
  return tarikiPostsFromFacebookPage(rawPosts, slug, knownExternalIds);
}

export type TarikiDependencies = {
  store?: TextSourceStore;
  fetchBatch?: (
    source: TextSource,
    known: Set<string>,
  ) => Promise<TarikiNormalizedBatch>;
  readSituation?: (text: string) => Promise<Situation>;
};

export async function ingestTariki(
  dependencies: TarikiDependencies = {},
): Promise<TarikiRun> {
  const store =
    dependencies.store ?? createTextSourceSupabaseStore(TARIKI_SOURCE_KEY);
  const baseReadSituation =
    dependencies.readSituation ??
    ((text: string) =>
      readSituation(text, defaultSituationReader(), TARIKI_SOURCE));

  let upstreamPublishedAt: string | null = null;
  let totalSeen = 0;
  let preFiltered = 0;

  const fetchPosts = async (
    source: TextSource,
    known: Set<string>,
  ): Promise<TelegramPost[]> => {
    const batch = dependencies.fetchBatch
      ? await dependencies.fetchBatch(source, known)
      : await fetchTarikiPosts(source, known);
    upstreamPublishedAt = batch.upstreamPublishedAt;
    totalSeen = batch.totalSeen;
    return batch.posts;
  };

  const guardedReadSituation = async (text: string): Promise<Situation> => {
    const decision = classifyTarikiPostPreFilter(text);
    if (decision !== "candidate") {
      preFiltered += 1;
      return {
        disposition: "other",
        items: [],
        advice: null,
        rejected: 0,
      };
    }
    const raw = await baseReadSituation(text);
    if (raw.disposition === "fire") {
      return {
        disposition: "other",
        items: [],
        advice: null,
        rejected: raw.rejected,
      };
    }
    return {
      ...raw,
      items: filterTarikiNonFireItems(raw.items),
    };
  };

  try {
    const run = await runTextSourceWith(TARIKI_SOURCE_KEY, {
      store,
      fetchPosts,
      // Tariki NEVER invokes wildfire extraction
      extractLlm: async () => ({ mentions: [] }),
      readSituation: guardedReadSituation,
    });
    return {
      ...run,
      upstreamPublishedAt,
      totalSeen,
      preFiltered,
    };
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      fetched: 0,
      stored: 0,
      retried: 0,
      mentions: 0,
      resolved: 0,
      unresolved: 0,
      gated: 0,
      rejectedSpans: 0,
      llmFailed: error instanceof LlmUnavailable ? 1 : 0,
      skippedPosts: 0,
      situationItems: 0,
      adviceStored: 0,
      clustersConfirmed: 0,
      incidentsCreated: 0,
      incidentsUpdated: 0,
      incidentsUnlisted: 0,
      pending: 0,
      upstreamPublishedAt,
      totalSeen,
      preFiltered,
      error: message,
    };
  }
}

export async function runTarikiSource(
  job: ClaimedSourceJob,
  dependencies: TarikiDependencies = {},
): Promise<SourceJobResult> {
  const run = await ingestTariki(dependencies);
  const accepted =
    run.mentions +
    run.incidentsCreated +
    run.incidentsUpdated +
    run.skippedPosts +
    run.preFiltered +
    (run.fetched === 0 && !run.error ? 1 : 0);
  const health = sourceRunOutcome({ accepted, error: run.error });
  const reason = run.error
    ? publicReasonForError(run.error)
    : health.outcome === "skipped"
      ? "disabled"
      : null;

  return {
    contractKey: job.contract_key,
    trigger: job.trigger_kind,
    scheduledFor: job.scheduled_for,
    startedAt: job.started_at,
    ...health,
    upstreamPublishedAt: run.upstreamPublishedAt,
    dataFrom: health.outcome === "succeeded" ? job.data_from : null,
    dataThrough: health.outcome === "succeeded" ? job.data_through : null,
    recordsSeen: run.totalSeen || run.fetched,
    recordsInserted: run.incidentsCreated + run.mentions,
    recordsUpdated: run.incidentsUpdated,
    recordsRejected: run.unresolved + run.gated + run.rejectedSpans,
    qualityChecks: {
      stored_documents: run.stored,
      situation_items: run.situationItems,
      pre_filtered_non_dangers: run.preFiltered,
      clusters_confirmed: 0,
      pending_extractions: run.pending,
      llm_failed: run.llmFailed,
    },
    publicReasonCode: reason,
    privateDiagnostic: run.error ?? null,
    retryDisposition:
      health.outcome === "succeeded" || health.outcome === "skipped"
        ? "none"
        : retryDispositionForReason(reason ?? "internal_error"),
  };
}
