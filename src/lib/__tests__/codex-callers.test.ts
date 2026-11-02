import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { civilAgentCompletion } from "@/lib/civil-agent.server";
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

const GATEWAY = "https://gateway.nadhir.test";

const itaPost = {
  id: "808412572528916_1511278197712051",
  uri: "traficalg",
  created_time: "2026-09-08T18:35:11+0000",
  message: "أشغال في البويرة",
  region: "Bouira",
  type: [],
};

const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
  Response.json({ text: "{}" }),
);

beforeEach(() => {
  vi.stubEnv("NADHIR_GATEWAY_URL", `${GATEWAY}/`);
  vi.stubEnv("NADHIR_GATEWAY_ACCESS_CLIENT_ID", "client-id.access");
  vi.stubEnv("NADHIR_GATEWAY_ACCESS_CLIENT_SECRET", "client-secret");
  // the old transport's settings must no longer matter
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("CODEX_MODEL", "");
  vi.stubGlobal("fetch", fetch);
  fetch.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("every model call site", () => {
  it.each([
    [
      "classify_report",
      () =>
        classifyReport(
          { kind: "fire", note: "smoke", place: null },
          defaultClassifier(),
        ),
    ],
    ["extract_ita", () => extractItaReport(itaPost)],
    [
      "extract_dgpc",
      () =>
        extractMentionsWithLlm({ text: "x", wilayaHint: null, language: "ar" }),
    ],
    ["dgpc_situation", () => readSituation("x", defaultSituationReader())],
    [
      "civil_agent_step",
      () =>
        civilAgentCompletion(new AbortController().signal)({
          messages: [{ role: "user", content: "x" }],
          response_format: {
            type: "json_schema",
            json_schema: { name: "s", strict: true, schema: {} },
          },
        }),
    ],
  ])("calls the gateway as %s and nothing else", async (purpose, call) => {
    await call().catch(() => {});
    const urls = fetch.mock.calls.map(([url]) => url);
    expect(urls.length).toBeGreaterThan(0);
    expect(new Set(urls)).toEqual(new Set([`${GATEWAY}/v1/complete`]));
    const [, init] = fetch.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["cf-access-client-id"]).toBe("client-id.access");
    expect(headers["cf-access-client-secret"]).toBe("client-secret");
    expect(init.redirect).toBe("manual");
    const body = JSON.parse(init.body as string);
    expect(body.purpose).toBe(purpose);
    expect(Object.keys(body.request).sort()).toEqual([
      "messages",
      "response_format",
    ]);
  });
});
