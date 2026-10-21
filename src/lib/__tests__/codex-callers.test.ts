import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: {
    CODEX_LOGIN: {
      idFromName: (name: string) => name,
      get: () => ({
        lease: async () => ({
          status: "ready",
          token: "access-1",
          account: "acct-1",
        }),
        pause: async () => {},
        expire: async () => {},
      }),
    },
  },
}));

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

const itaPost = {
  id: "808412572528916_1511278197712051",
  uri: "traficalg",
  created_time: "2026-09-08T18:35:11+0000",
  message: "أشغال في البويرة",
  region: "Bouira",
  type: [],
};

const fetch = vi.fn(
  async (_url: string) =>
    new Response(
      'data: {"type":"response.output_text.delta","delta":"{}"}\n\ndata: {"type":"response.completed"}\n\n',
      { status: 200, headers: { "x-codex-primary-used-percent": "1" } },
    ),
);

beforeEach(() => {
  vi.stubEnv("CODEX_MODEL", "gpt-6-luna");
  vi.stubEnv("OPENROUTER_API_KEY", "test-only");
  vi.stubGlobal("fetch", fetch);
  fetch.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("with CODEX_MODEL set, every LLM caller tries the subscription first", () => {
  it.each([
    [
      "report classifier",
      () =>
        classifyReport(
          { kind: "fire", note: "smoke", place: null },
          defaultClassifier(),
        ),
    ],
    [
      "text source extraction",
      () =>
        extractMentionsWithLlm({ text: "x", wilayaHint: null, language: "ar" }),
    ],
    ["DGPC situation", () => readSituation("x", defaultSituationReader())],
    ["ITA extraction", () => extractItaReport(itaPost)],
    [
      "civil agent",
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
  ])("%s", async (_name, call) => {
    await call().catch(() => {});
    expect(fetch.mock.calls[0]?.[0]).toBe(CODEX_RESPONSES_URL);
  });
});
