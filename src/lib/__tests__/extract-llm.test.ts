import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatRequest } from "@/lib/llm/codex.server";
import {
  extractMentionsWithLlm,
  type LlmExtractionDependencies,
} from "@/lib/text-sources/extract-llm.server";
import { LlmUnavailable } from "@/lib/text-sources/llm-unavailable";

const text =
  "✅⏮️ حريق غابة منطقة صعبة المسلك ببلدية الولجة بولبلوط ولاية #سكيكدة، مع إقحام طائرتي الإطفاء، العملية متواصلة...";

const good = {
  wilaya: "سكيكدة",
  commune: "الولجة بولبلوط",
  place: null,
  kind: "vegetation",
  status: "ongoing",
  count: 1,
  evidence: "حريق غابة منطقة صعبة المسلك ببلدية الولجة بولبلوط",
};

function deps(
  content: string,
  over: Partial<LlmExtractionDependencies> = {},
): LlmExtractionDependencies & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    model: "gpt-6-luna",
    complete: async (request) => {
      calls.push(request);
      return content;
    },
    calls,
    ...over,
  };
}

const gateway = () => {
  vi.stubEnv("NADHIR_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("NADHIR_GATEWAY_ACCESS_CLIENT_ID", "id");
  vi.stubEnv("NADHIR_GATEWAY_ACCESS_CLIENT_SECRET", "secret");
};

describe("extractMentionsWithLlm through the gateway", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("bounds gateway requests to 45 seconds", async () => {
    gateway();
    const request = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ text: '{"mentions":[]}' }),
    );
    vi.stubGlobal("fetch", request);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await extractMentionsWithLlm({ text, wilayaHint: null, language: "ar" });
    expect(timeout).toHaveBeenCalledWith(45_000);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://gateway.test/v1/complete");
    expect(JSON.parse(init.body as string).purpose).toBe("extract_dgpc");
  });

  it.each([
    [429, { reason: "plan_paused", retry_after: 60 }, true],
    [429, { reason: "rate_limited", retry_after: 6 }, true],
    [503, { reason: "login_expired" }, true],
    [401, { reason: "unauthorized" }, true],
    [530, "<html>tunnel down</html>", true],
    [502, { reason: "upstream" }, false],
    [400, { reason: "bad_request" }, false],
  ] as const)(
    "tells a gateway %i %j apart from the document's own failure",
    async (status, body, unavailable) => {
      gateway();
      vi.stubGlobal("fetch", async () =>
        typeof body === "string"
          ? new Response(body, { status })
          : Response.json(body, { status }),
      );
      const failure = await extractMentionsWithLlm({
        text,
        wilayaHint: null,
        language: "ar",
      }).catch((error: unknown) => error);
      expect(failure instanceof LlmUnavailable).toBe(unavailable);
      expect(String(failure)).toMatch(/^Gateway\w+: model gateway \w+$/);
    },
  );

  it("waits, without spending an attempt, while no gateway is configured", async () => {
    vi.stubEnv("NADHIR_GATEWAY_URL", "");
    const failure = await extractMentionsWithLlm({
      text,
      wilayaHint: null,
      language: "ar",
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LlmUnavailable);
    expect(String(failure)).toContain("gateway_unset");
  });
});

describe("extractMentionsWithLlm", () => {
  it("returns mentions whose evidence is quoted from the input", async () => {
    const d = deps(JSON.stringify({ mentions: [good] }));
    const result = await extractMentionsWithLlm(
      { text, wilayaHint: null, language: "ar" },
      d,
    );
    expect(result).toEqual({
      mentions: [expect.objectContaining({ commune: "الولجة بولبلوط" })],
    });
  });

  it("rejects incomplete grounding instead of silently dropping mentions", async () => {
    const d = deps(
      JSON.stringify({
        mentions: [{ ...good, evidence: "حريق ببلدية عزابة" }],
      }),
    );
    await expect(
      extractMentionsWithLlm({ text, wilayaHint: null, language: "ar" }, d),
    ).rejects.toThrow("unsupported evidence");
  });

  it("asks for a strict JSON schema and sends the post as data in the user turn", async () => {
    const d = deps(JSON.stringify({ mentions: [] }));
    await extractMentionsWithLlm(
      { text, wilayaHint: "سكيكدة", language: "ar" },
      d,
    );
    const req = d.calls[0]!;
    expect(req.response_format.type).toBe("json_schema");
    expect(req.response_format.json_schema.strict).toBe(true);
    expect(req.response_format.json_schema.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["mentions"],
    });
    const system = req.messages.find((m) => m.role === "system")!;
    const user = req.messages.find((m) => m.role === "user")!;
    expect(system.content).not.toContain("الولجة");
    expect(user.content).toContain(text);
  });

  it("accepts a reply wrapped in a markdown fence", async () => {
    const d = deps(
      "```json\n" + JSON.stringify({ mentions: [good] }) + "\n```",
    );
    const result = await extractMentionsWithLlm(
      { text, wilayaHint: null, language: "ar" },
      d,
    );
    expect(result).toMatchObject({ mentions: [expect.anything()] });
  });

  it("fails loudly when the reply is not the expected shape", async () => {
    const d = deps(
      JSON.stringify({ mentions: [{ ...good, kind: "volcano" }] }),
    );
    await expect(
      extractMentionsWithLlm({ text, wilayaHint: null, language: "ar" }, d),
    ).rejects.toThrow(/llm extraction/);
  });
});
