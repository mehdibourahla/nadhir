import {
  castVote,
  clientIp,
  submitIdea,
  type SubmitOutcome,
  type VoteOutcome,
} from "@/lib/contribute.server";
import { readJsonBody } from "@/lib/request-body.server";
import { readMySuggestions, submitSuggestions } from "@/lib/translate.server";
import {
  extractTurnstileToken,
  resolveExpectedTurnstileHostnames,
  verifyTurnstileToken,
  type TurnstileVerifyInput,
  type TurnstileVerifyResult,
} from "@/lib/turnstile.server";

const IDEA_MAX_BYTES = 16_384;
const VOTE_MAX_BYTES = 16_384;
const MY_TRANSLATIONS_MAX_BYTES = 16_384;
const TRANSLATION_MAX_BYTES = 131_072;

export interface ContributeRouteDeps {
  verifyTurnstile: (
    input: TurnstileVerifyInput,
  ) => Promise<TurnstileVerifyResult>;
  submitIdea: typeof submitIdea;
  castVote: typeof castVote;
  submitSuggestions: typeof submitSuggestions;
  readMySuggestions: typeof readMySuggestions;
}

const defaultDeps: ContributeRouteDeps = {
  verifyTurnstile: verifyTurnstileToken,
  submitIdea,
  castVote,
  submitSuggestions,
  readMySuggestions,
};

type ParsedField<T> = { ok: true; value: T } | { ok: false };

/** Strict string field reader that never invokes ToPrimitive (e.g. `{"toString": null}`). */
function readStringField(value: unknown, fallback = ""): ParsedField<string> {
  if (value === undefined || value === null)
    return { ok: true, value: fallback };
  if (typeof value === "string") return { ok: true, value };
  return { ok: false };
}

function readNullableStringField(value: unknown): ParsedField<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === "string") return { ok: true, value: value || null };
  return { ok: false };
}

function readOptionalStringField(
  value: unknown,
): ParsedField<string | undefined> {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value === "string") return { ok: true, value: value || undefined };
  return { ok: false };
}

/** Strict finite number reader that never invokes ToPrimitive (e.g. `{"valueOf": null}`). */
function readFiniteNumberField(
  value: unknown,
  fallback = 0,
): ParsedField<number> {
  if (value === undefined || value === null)
    return { ok: true, value: fallback };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { ok: true, value };
  }
  return { ok: false };
}

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

  const input = body as Record<string, unknown>;
  const lane = readStringField(input["lane"], "other");
  const message = readStringField(input["message"], "");
  const contact = readNullableStringField(input["contact"]);
  const locale = readStringField(input["locale"], "en");
  const website = readOptionalStringField(input["website"]);
  if (!lane.ok || !message.ok || !contact.ok || !locale.ok || !website.ok) {
    return Response.json({ ok: false, reason: "failed" }, { status: 400 });
  }

  const captchaFailure = await checkTurnstile(
    request,
    body,
    "contribute_idea",
    deps,
  );
  if (captchaFailure) return captchaFailure;

  const outcome: SubmitOutcome = await deps.submitIdea(
    {
      lane: lane.value,
      message: message.value,
      contact: contact.value,
      locale: locale.value,
      website: website.value,
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
  const locale = readStringField(input["locale"], "");
  const reviewerKey = readStringField(input["reviewerKey"], "");
  const reviewerName = readNullableStringField(input["reviewerName"]);
  if (!locale.ok || !reviewerKey.ok || !reviewerName.ok) {
    return Response.json({ ok: false, reason: "failed" }, { status: 400 });
  }
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
    const keyPath = readStringField(r["keyPath"], "");
    const sourceText = readStringField(r["sourceText"], "");
    const currentText = readStringField(r["currentText"], "");
    const suggestion = readNullableStringField(r["suggestion"]);
    const verdict = readStringField(r["verdict"], "");
    const note = readNullableStringField(r["note"]);
    if (
      !keyPath.ok ||
      !sourceText.ok ||
      !currentText.ok ||
      !suggestion.ok ||
      !verdict.ok ||
      !note.ok
    ) {
      return Response.json({ ok: false, reason: "failed" }, { status: 400 });
    }
    rows.push({
      keyPath: keyPath.value,
      sourceText: sourceText.value,
      currentText: currentText.value,
      suggestion: suggestion.value,
      verdict: verdict.value,
      note: note.value,
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
    locale.value,
    reviewerKey.value,
    reviewerName.value,
    rows,
    clientIp(request),
  );
  if (outcome.ok) return Response.json(outcome);
  return Response.json(outcome, {
    status: outcome.reason === "rateLimited" ? 429 : 400,
  });
}

export async function handleContributeMyTranslations(
  request: Request,
  overrides: Partial<ContributeRouteDeps> = {},
): Promise<Response> {
  const deps: ContributeRouteDeps = { ...defaultDeps, ...overrides };
  const read = await readJsonBody(request, MY_TRANSLATIONS_MAX_BYTES);
  if ("error" in read) {
    return Response.json({ rows: [] }, { status: read.status });
  }
  const body = read.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ rows: [] }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const locale = readStringField(input["locale"], "");
  const reviewerKey = readStringField(input["reviewerKey"], "");
  if (!locale.ok || !reviewerKey.ok) {
    return Response.json({ rows: [] }, { status: 400 });
  }
  const rows = await deps.readMySuggestions(locale.value, reviewerKey.value);
  return Response.json({ rows }, { headers: { "cache-control": "no-store" } });
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

  const input = body as Record<string, unknown>;
  const ideaId = readStringField(input["ideaId"], "");
  const voterKey = readStringField(input["voterKey"], "");
  const value = readFiniteNumberField(input["value"], 0);
  if (!ideaId.ok || !voterKey.ok || !value.ok) {
    return Response.json({ ok: false, reason: "failed" }, { status: 400 });
  }

  const captchaFailure = await checkTurnstile(
    request,
    body,
    "contribute_vote",
    deps,
  );
  if (captchaFailure) return captchaFailure;

  const outcome: VoteOutcome = await deps.castVote(
    ideaId.value,
    voterKey.value,
    value.value,
    clientIp(request),
  );
  if (outcome.ok) return Response.json(outcome);
  return Response.json(outcome, {
    status: outcome.reason === "rateLimited" ? 429 : 400,
  });
}
