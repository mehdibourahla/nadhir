import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { ClaimedSourceJob } from "./source-jobs";
import {
  civilAgentCompletion,
  investigateCivilReport,
} from "./civil-agent.server";
import { searchAdministrativeAreas } from "./civil-location.server";
import { GATEWAY_MODEL } from "./llm/gateway.server";
import { LlmUnavailable } from "./text-sources/llm-unavailable";

// a paused plan retries no sooner than this, so a long pause does not spin the queue
const PAUSE_RETRY_S = 60;

export async function runCivilInvestigations(job: ClaimedSourceJob) {
  const fence = { _job: job.id, _attempt: job.attempt_count };
  const claimed = await supabaseAdmin.rpc("claim_civil_investigations", {
    ...fence,
    _limit: 2,
  });
  if (claimed.error)
    throw new Error(`Civil investigation claim: ${claimed.error.message}`);
  let failed = 0;
  let paused: string | null = null;
  for (const [index, work] of claimed.data.entries()) {
    let result: Awaited<ReturnType<typeof investigateCivilReport>> | null =
      null;
    let failure: string | null = null;
    try {
      const signal = AbortSignal.timeout(60_000);
      const source = await supabaseAdmin
        .from("ita_reports")
        .select("body,published_at,extraction,source_post_id,source_page")
        .eq("id", work.report_id)
        .abortSignal(signal)
        .single();
      if (source.error) throw new Error(source.error.message);
      const prior = await supabaseAdmin
        .from("civil_publications")
        .select(
          "id,summary,revision,source_published_at,area_id,ita_reports!inner(source_post_id,source_page)",
        )
        .eq("ita_reports.source_post_id", source.data.source_post_id)
        .eq("ita_reports.source_page", source.data.source_page)
        .neq("ita_report_id", work.report_id)
        .abortSignal(signal);
      if (prior.error)
        throw new Error(`Source revision lookup: ${prior.error.message}`);
      const extraction = source.data.extraction as { incidents: unknown[] };
      result = await investigateCivilReport(
        {
          body: source.data.body,
          publishedAt: source.data.published_at,
          incident: extraction.incidents[work.incident_index],
          existingSourcePublications: prior.data.map(
            ({ id, summary, revision, source_published_at, area_id }) => ({
              id,
              summary,
              revision,
              source_published_at,
              area_id,
            }),
          ),
        },
        {
          model: GATEWAY_MODEL,
          now: new Date(),
          complete: civilAgentCompletion(signal),
          searchAreas: (query, parentId) =>
            searchAdministrativeAreas(query, parentId, signal),
          async officialReports(query, areaId) {
            const { data, error } = await supabaseAdmin
              .rpc("search_civil_official_evidence", {
                _query: query,
                _area: areaId,
              })
              .abortSignal(signal);
            if (error)
              throw new Error(`Official evidence search: ${error.message}`);
            return data;
          },
          async recentPublications() {
            const { data, error } = await supabaseAdmin
              .from("civil_publications")
              .select("id,summary,source_published_at,area_id")
              .eq("state", "published")
              .gt("expires_at", new Date().toISOString())
              .order("source_published_at", { ascending: false })
              .limit(30)
              .abortSignal(signal);
            if (error) throw new Error(`Publication search: ${error.message}`);
            return data;
          },
        },
      );
    } catch (cause) {
      if (cause instanceof LlmUnavailable) {
        // the plan or the gateway is down, not this report: no attempt is spent
        for (const unread of claimed.data.slice(index)) {
          const released = await supabaseAdmin.rpc(
            "release_civil_investigation",
            {
              ...fence,
              _id: unread.id,
              _investigation_attempt: unread.attempts,
              _delay_seconds: Math.max(PAUSE_RETRY_S, cause.retryAfter ?? 0),
            },
          );
          if (released.error)
            throw new Error(
              `Civil investigation release: ${released.error.message}`,
              { cause },
            );
        }
        paused = cause.message;
        break;
      }
      failure =
        cause instanceof Error
          ? cause.message.slice(0, 500)
          : "Civil investigation failed";
      failed++;
    }
    const saved = await supabaseAdmin.rpc("finish_civil_investigation", {
      ...fence,
      _id: work.id,
      _investigation_attempt: work.attempts,
      _result: result as unknown as Json,
      _error: failure,
    });
    if (saved.error) {
      if (failure)
        throw new Error(`Civil failure persistence: ${saved.error.message}`);
      const rejected = await supabaseAdmin.rpc("finish_civil_investigation", {
        ...fence,
        _id: work.id,
        _investigation_attempt: work.attempts,
        _result: null,
        _error: `Civil decision rejected: ${saved.error.message}`.slice(0, 500),
      });
      if (rejected.error)
        throw new Error(
          `Civil decision persistence: ${rejected.error.message}`,
        );
      failed++;
    }
  }
  const backlog = await supabaseAdmin
    .from("civil_investigations")
    .select("id", { count: "exact", head: true })
    .in("state", ["pending", "processing", "hold", "failed"]);
  if (backlog.error)
    throw new Error(`Civil investigation backlog: ${backlog.error.message}`);
  const failures = await supabaseAdmin
    .from("civil_investigations")
    .select("id", { count: "exact", head: true })
    .in("state", ["failed"]);
  if (failures.error)
    throw new Error(`Civil investigation failures: ${failures.error.message}`);
  return {
    failed: Math.max(failed, failures.count ?? 0),
    pending: backlog.count ?? 0,
    ...(paused ? { paused } : {}),
  };
}
