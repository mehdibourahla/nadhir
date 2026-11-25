import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  GatewayFailed,
  GatewayPending,
  gatewayReason,
  type GatewayReason,
} from "@/lib/llm/gateway.server";
import {
  classifyReport,
  defaultClassifier,
  type ClassifierDependencies,
} from "@/lib/report-classifier.server";

type Waiting = {
  id: string;
  user_id?: string | null;
  kind: string;
  note: string | null;
  commune_id: string | null;
};

type Patch = {
  publish_state: "published" | "held";
  hazard?: string;
  summary: string | null;
  classified_at: string;
  classifier: string;
  expires_at?: string;
};

const LIFETIME_MS = 6 * 3_600_000;
const IN_BATCH_SIZE = 100;

const store = {
  waiting: async (ids?: string[]): Promise<Waiting[]> => {
    let query = supabaseAdmin
      .from("citizen_reports")
      .select("id, user_id, kind, note, commune_id")
      .eq("publish_state", "classifying")
      .order("created_at")
      .limit(20);
    if (ids) query = query.in("id", ids);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  },
  withdrawnCitizenReportConsent: async (
    userIds: string[],
  ): Promise<Set<string>> => {
    if (!userIds.length) return new Set();
    const withdrawn = new Set<string>();
    for (let i = 0; i < userIds.length; i += IN_BATCH_SIZE) {
      const batch = userIds.slice(i, i + IN_BATCH_SIZE);
      const { data, error } = await supabaseAdmin
        .from("privacy_consents")
        .select("user_id")
        .in("user_id", batch)
        .eq("consent_type", "citizen_reports")
        .eq("status", "withdrawn");
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        withdrawn.add(row.user_id);
      }
    }
    return withdrawn;
  },
  place: async (communeId: string | null): Promise<string | null> => {
    if (!communeId) return null;
    const { data, error } = await supabaseAdmin
      .from("admin_units")
      .select("name_fr")
      .eq("id", communeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.name_fr ?? null;
  },
  save: async (id: string, patch: Patch) => {
    const { error } = await supabaseAdmin
      .from("citizen_reports")
      .update(patch)
      .eq("id", id)
      .eq("publish_state", "classifying");
    if (error) throw new Error(error.message);
  },
};

export async function publishWaitingReports(
  ids?: string[],
  dependencies: {
    store?: Partial<typeof store>;
    classifier?: ClassifierDependencies;
    now?: () => number;
  } = {},
) {
  const deps = { ...store, ...dependencies.store };
  const classifier = dependencies.classifier ?? defaultClassifier();
  const now = dependencies.now ?? Date.now;
  const tally = { published: 0, held: 0, waiting: 0 };
  const waitingReports = await deps.waiting(ids);
  if (!waitingReports.length) return tally;

  const userIds = [
    ...new Set(
      waitingReports
        .map((report) => report.user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  // Fail-closed (Law 18-07 / Law 25-11): check citizen_reports consent before
  // invoking external LLM classification or publishing any waiting report.
  const withdrawnUsers = userIds.length
    ? await deps.withdrawnCitizenReportConsent(userIds)
    : new Set<string>();

  // one unavailable gateway degrades the whole batch, so the alert engine never waits 8 s a report
  let down: GatewayReason | null = null;
  for (const report of waitingReports) {
    const at = new Date(now()).toISOString();
    if (report.user_id && withdrawnUsers.has(report.user_id)) {
      await deps.save(report.id, {
        publish_state: "held",
        summary: null,
        classified_at: at,
        classifier: "consent_withdrawn",
      });
      tally.held += 1;
      continue;
    }
    let patch: Patch;
    try {
      if (down) throw new GatewayPending(down, null);
      const decision = await classifyReport(
        {
          kind: report.kind,
          note: report.note ?? "",
          place: await deps.place(report.commune_id),
        },
        classifier,
      );
      patch = {
        publish_state: decision.publishable ? "published" : "held",
        hazard: decision.hazard,
        summary: decision.summary,
        classified_at: at,
        classifier: classifier.model,
        ...(decision.publishable
          ? { expires_at: new Date(now() + LIFETIME_MS).toISOString() }
          : {}),
      };
    } catch (failure) {
      if (failure instanceof GatewayPending) down = failure.reason;
      else if (failure instanceof GatewayFailed && failure.reason === "timeout")
        down = failure.reason;
      // a reason code only: the error may carry the citizen's words or model text
      console.warn(
        JSON.stringify({
          message: "report classification degraded",
          report: report.id,
          reason: gatewayReason(failure),
          fallback: report.kind === "other" ? "waiting" : "category_only",
        }),
      );
      // a tapped category is safe to show without its text; "something else" has no category to show
      if (report.kind === "other") {
        tally.waiting += 1;
        continue;
      }
      patch = {
        publish_state: "published",
        summary: null,
        classified_at: at,
        classifier: "fallback",
        expires_at: new Date(now() + LIFETIME_MS).toISOString(),
      };
    }
    await deps.save(report.id, patch);
    tally[patch.publish_state] += 1;
  }
  return tally;
}
