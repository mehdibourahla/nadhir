import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { civilAgentCompletion } from "@/lib/civil-agent.server";
import { CODEX_RESPONSES_URL } from "@/lib/llm/codex.server";
import {
  classifyReport,
  defaultClassifier,
} from "@/lib/report-classifier.server";
import {
  defaultSituationReader,
  readSituation,
} from "@/lib/text-sources/dgpc-situation.server";
import { extractItaReport } from "@/lib/text-sources/ita-extract.server";
import { extractMentionsWithLlm } from "@/lib/text-sources/extract-llm.server";

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const ROUTE = "https://nadhir.app/api/internal/codex-login";

const itaPost = {
  id: "808412572528916_1511278197712051",
  uri: "traficalg",
  created_time: "2026-09-08T18:35:11+0000",
  message: "أشغال في البويرة",
  region: "Bouira",
  type: [],
};

const fetch = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === ROUTE)
    return JSON.parse(init!.body as string).action === "lease"
      ? Response.json({
          status: "ready",
          access_token: "access-1",
          account_id: "acct-1",
        })
      : Response.json({ pausedSeconds: null });
  if (url === CODEX_RESPONSES_URL)
    return new Response(
      'data: {"type":"response.output_text.delta","delta":"{}"}\n\ndata: {"type":"response.completed"}\n\n',
      { status: 200, headers: { "x-codex-primary-used-percent": "1" } },
    );
  return Response.json({ choices: [{ message: { content: "{}" } }] });
});

const urls = () => fetch.mock.calls.map(([url]) => url);

beforeEach(() => {
  vi.stubEnv("GITHUB_ACTIONS", "true");
  vi.stubEnv("CODEX_MODEL", "gpt-6-luna");
  vi.stubEnv("NADHIR_APP_URL", "https://nadhir.app");
  vi.stubEnv("NADHIR_CRON_SECRET", "runtime-secret");
  vi.stubEnv("OPENROUTER_API_KEY", "test-only");
  vi.stubGlobal("fetch", fetch);
  fetch.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("on a GitHub runner with CODEX_MODEL set", () => {
  it.each([
    [
      "DGPC bulletin extraction",
      () =>
        extractMentionsWithLlm({ text: "x", wilayaHint: null, language: "ar" }),
    ],
    ["DGPC situation", () => readSituation("x", defaultSituationReader())],
    ["ITA extraction", () => extractItaReport(itaPost)],
  ])("%s tries the subscription first", async (_name, call) => {
    await call().catch(() => {});
    expect(urls().slice(0, 2)).toEqual([ROUTE, CODEX_RESPONSES_URL]);
  });

  it.each([
    [
      "the citizen-report classifier",
      () =>
        classifyReport(
          { kind: "fire", note: "smoke", place: null },
          defaultClassifier(),
        ),
    ],
    [
      "the civil agent",
      () =>
        civilAgentCompletion(new AbortController().signal)({
          model: "m",
          messages: [{ role: "user", content: "x" }],
          response_format: {
            type: "json_schema",
            json_schema: { name: "s", strict: true, schema: {} },
          },
          temperature: 0,
          max_tokens: 1,
          provider: { require_parameters: true },
        }),
    ],
  ])("%s stays on OpenRouter", async (_name, call) => {
    await call().catch(() => {});
    expect(urls()).toEqual([OPENROUTER]);
  });
});
