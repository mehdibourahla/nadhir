import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp } from "@/lib/contribute.server";
import { publishWaitingReports } from "@/lib/report-publication.server";
import { readJsonBody } from "@/lib/request-body.server";
import {
  extractTurnstileToken,
  resolveExpectedTurnstileHostnames,
  verifyTurnstileToken,
  type TurnstileVerifyInput,
  type TurnstileVerifyResult,
} from "@/lib/turnstile.server";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED_BODY_KEYS = new Set(["id", "turnstileToken"]);

export interface ReportPublishDeps {
  verifyTurnstile: (
    input: TurnstileVerifyInput,
  ) => Promise<TurnstileVerifyResult>;
}

const defaultDeps: ReportPublishDeps = {
  verifyTurnstile: verifyTurnstileToken,
};

export async function handleReportPublish(
  request: Request,
  publish = publishWaitingReports,
  overrides: Partial<ReportPublishDeps> = {},
): Promise<Response> {
  const deps: ReportPublishDeps = { ...defaultDeps, ...overrides };

  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!bearer) return json({ error: "Authentication required" }, 401);
  const auth = await supabaseAdmin.auth.getUser(bearer);
  if (auth.error || !auth.data.user)
    return json({ error: "Invalid session" }, 401);
  const userId = auth.data.user.id;

  const quota = await supabaseAdmin.rpc("consume_rate_limit", {
    _bucket: `report-publish:${userId}`,
    _limit: 10,
    _window_seconds: 600,
  });
  if (quota.error || quota.data == null)
    return json({ error: "Quota unavailable" }, 503);
  if (quota.data !== true) return json({ error: "Please wait" }, 429);

  const read = await readJsonBody(request, 4096);
  if ("error" in read) return json({ error: read.error }, read.status);
  const body = read.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid request" }, 400);
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length === 0 ||
    !keys.every((key) => ALLOWED_BODY_KEYS.has(key)) ||
    typeof record["id"] !== "string" ||
    !UUID.test(record["id"]) ||
    ("turnstileToken" in record && typeof record["turnstileToken"] !== "string")
  ) {
    return json({ error: "Invalid request" }, 400);
  }
  const reportId = record["id"];

  const captcha = await deps.verifyTurnstile({
    token: extractTurnstileToken(record, request),
    remoteIp: clientIp(request),
    expectedAction: "report_publish",
    expectedHostname: resolveExpectedTurnstileHostnames(request),
  });
  if (!captcha.ok) {
    return json(
      { error: "Captcha verification failed", reason: captcha.reason },
      captcha.status,
    );
  }

  const owned = await supabaseAdmin
    .from("citizen_reports")
    .select("id")
    .eq("id", reportId)
    .eq("user_id", userId)
    .maybeSingle();
  if (owned.error) return json({ error: "Report unavailable" }, 503);
  if (!owned.data) return json({ error: "Report not found" }, 404);

  await publish([reportId]);

  const report = await supabaseAdmin
    .from("citizen_reports")
    .select("publish_state, hazard, summary")
    .eq("id", reportId)
    .single();
  if (report.error) return json({ error: "Report unavailable" }, 503);
  return json(report.data);
}
