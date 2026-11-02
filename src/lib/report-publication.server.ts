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

const store = {
  waiting: async (ids?: string[]): Promise<Waiting[]> => {
    let query = supabaseAdmin
      .from("citizen_reports")
      .select("id, kind, note, commune_id")
      .eq("publish_state", "classifying")
      .order("created_at")
      .limit(20);
    if (ids) query = query.in("id", ids);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
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
  // one unavailable gateway degrades the whole batch, so the alert engine never waits 8 s a report
  let down: GatewayReason | null = null;
  for (const report of await deps.waiting(ids)) {
    const at = new Date(now()).toISOString();
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
