import {
  castVote,
  clientIp,
  submitIdea,
  type SubmitOutcome,
  type VoteOutcome,
} from "@/lib/contribute.server";
import { readJsonBody } from "@/lib/request-body.server";
import { submitSuggestions } from "@/lib/translate.server";
import {
  extractTurnstileToken,
  resolveExpectedTurnstileHostnames,
  verifyTurnstileToken,
  type TurnstileVerifyInput,
  type TurnstileVerifyResult,
} from "@/lib/turnstile.server";

const IDEA_MAX_BYTES = 16_384;
const VOTE_MAX_BYTES = 16_384;
const TRANSLATION_MAX_BYTES = 131_072;

export interface ContributeRouteDeps {
  verifyTurnstile: (
    input: TurnstileVerifyInput,
  ) => Promise<TurnstileVerifyResult>;
  submitIdea: typeof submitIdea;
  castVote: typeof castVote;
  submitSuggestions: typeof submitSuggestions;
}

const defaultDeps: ContributeRouteDeps = {
  verifyTurnstile: verifyTurnstileToken,
  submitIdea,
  castVote,
  submitSuggestions,
};

async function checkTurnstile(
  request: Request,
  body: unknown,
  action: string,
  deps: ContributeRouteDeps,
): Promise<Response | null> {
  const result = await deps.verifyTurnstile({
    token: extractTurnstileToken(body, request),
    remoteIp: clientIp(request),
    expectedAction: action,
    expectedHostname: resolveExpectedTurnstileHostnames(request),
  });
  if (result.ok) return null;
  return Response.json(
    {
      ok: false,
      reason: "captcha",
      captchaReason: result.reason,
    },
    { status: result.status },
  );
}

export async function handleContributeIdea(
  request: Request,
  overrides: Partial<ContributeRouteDeps> = {},
): Promise<Response> {
  const deps: ContributeRouteDeps = { ...defaultDeps, ...overrides };
  const read = await readJsonBody(request, IDEA_MAX_BYTES);
  if ("error" in read) {
    return Response.json(
      { ok: false, reason: "failed" },
      { status: read.status },
    );
  }
  const body = read.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, reason: "failed" }, { status: 400 });
  }

  const captchaFailure = await checkTurnstile(
    request,
    body,
    "contribute_idea",
    deps,
  );
  if (captchaFailure) return captchaFailure;

  const input = body as Record<string, unknown>;
  const outcome: SubmitOutcome = await deps.submitIdea(
    {
      lane: String(input["lane"] ?? "other"),
      message: String(input["message"] ?? ""),
      contact: input["contact"] ? String(input["contact"]) : null,
      locale: String(input["locale"] ?? "en"),
      website: input["website"] ? String(input["website"]) : undefined,
    },
    clientIp(request),
  );
  if (outcome.ok) return Response.json(outcome);
  return Response.json(outcome, {
    status: outcome.reason === "rateLimited" ? 429 : 400,
  });
}

export async function handleContributeTranslation(
  request: Request,
  overrides: Partial<ContributeRouteDeps> = {},
): Promise<Response> {
  const deps: ContributeRouteDeps = { ...defaultDeps, ...overrides };
  const read = await readJsonBody(request, TRANSLATION_MAX_BYTES);
  if ("error" in read) {
    return Response.json(
      { ok: false, reason: "failed" },
      { status: read.status },
    );
  }
  const body = read.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, reason: "failed" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  if (
    "rows" in input &&
    input["rows"] !== undefined &&
    !Array.isArray(input["rows"])
  ) {
    return Response.json({ ok: false, reason: "failed" }, { status: 400 });
  }
  const rawRows = Array.isArray(input["rows"]) ? input["rows"] : [];
  const rows: Array<{
    keyPath: string;
    sourceText: string;
    currentText: string;
    suggestion: string | null;
    verdict: string;
    note: string | null;
  }> = [];
  for (const entry of rawRows) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return Response.json({ ok: false, reason: "failed" }, { status: 400 });
    }
    const r = entry as Record<string, unknown>;
    rows.push({
      keyPath: String(r["keyPath"] ?? ""),
      sourceText: String(r["sourceText"] ?? ""),
      currentText: String(r["currentText"] ?? ""),
      suggestion: r["suggestion"] ? String(r["suggestion"]) : null,
      verdict: String(r["verdict"] ?? ""),
      note: r["note"] ? String(r["note"]) : null,
    });
  }

  const captchaFailure = await checkTurnstile(
    request,
    body,
    "contribute_translation",
    deps,
  );
  if (captchaFailure) return captchaFailure;

  const outcome = await deps.submitSuggestions(
    String(input["locale"] ?? ""),
    String(input["reviewerKey"] ?? ""),
    input["reviewerName"] ? String(input["reviewerName"]) : null,
    rows,
    clientIp(request),
  );
  if (outcome.ok) return Response.json(outcome);
  return Response.json(outcome, {
    status: outcome.reason === "rateLimited" ? 429 : 400,
  });
}

export async function handleContributeVote(
  request: Request,
  overrides: Partial<ContributeRouteDeps> = {},
): Promise<Response> {
  const deps: ContributeRouteDeps = { ...defaultDeps, ...overrides };
  const read = await readJsonBody(request, VOTE_MAX_BYTES);
  if ("error" in read) {
    return Response.json(
      { ok: false, reason: "failed" },
      { status: read.status },
    );
  }
  const body = read.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, reason: "failed" }, { status: 400 });
  }

  const captchaFailure = await checkTurnstile(
    request,
    body,
    "contribute_vote",
    deps,
  );
  if (captchaFailure) return captchaFailure;

  const input = body as Record<string, unknown>;
  const outcome: VoteOutcome = await deps.castVote(
    String(input["ideaId"] ?? ""),
    String(input["voterKey"] ?? ""),
    Number(input["value"] ?? 0),
    clientIp(request),
  );
  if (outcome.ok) return Response.json(outcome);
  return Response.json(outcome, {
    status: outcome.reason === "rateLimited" ? 429 : 400,
  });
}
