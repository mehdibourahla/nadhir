import { afterEach, describe, expect, it, vi } from "vitest";

import {
  completeWithGateway,
  GatewayFailed,
  GatewayPending,
} from "@/lib/llm/gateway.server";

const config = {
  url: "https://gateway.test",
  clientId: "id",
  clientSecret: "client-secret-value",
};
const request = {
  messages: [{ role: "user" as const, content: "private words" }],
  response_format: {
    type: "json_schema" as const,
    json_schema: { name: "a", strict: true, schema: {} },
  },
};
const call = async () => {
  try {
    await completeWithGateway("extract_dgpc", request, { config });
  } catch (error) {
    return error as Error & { reason?: string };
  }
  throw new Error("expected a gateway failure");
};

afterEach(() => vi.unstubAllGlobals());

describe("completeWithGateway", () => {
  it("returns the gateway's text", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ text: "answer" }));
    expect(await completeWithGateway("extract_dgpc", request, { config })).toBe(
      "answer",
    );
  });

  it("carries the gateway's retry_after on a pause", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json(
        { reason: "plan_paused", retry_after: 1234 },
        { status: 429 },
      ),
    );
    const error = await call();
    expect(error).toBeInstanceOf(GatewayPending);
    expect(error).toMatchObject({ reason: "plan_paused", retryAfter: 1234 });
  });

  it.each([
    ["an Access redirect", () => new Response(null, { status: 302 })],
    ["a tunnel error page", () => new Response("<html>", { status: 530 })],
    [
      "an unknown reason",
      () => Response.json({ reason: "x" }, { status: 500 }),
    ],
  ])("treats %s as an unreachable gateway", async (_name, reply) => {
    vi.stubGlobal("fetch", async () => reply());
    expect(await call()).toMatchObject({ reason: "gateway_unreachable" });
  });

  it("treats a 200 without text as the document's failure", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ answer: 1 }));
    const error = await call();
    expect(error).toBeInstanceOf(GatewayFailed);
    expect(error).toMatchObject({ reason: "malformed" });
  });

  it("rethrows the caller's own abort", async () => {
    const controller = new AbortController();
    const reason = new Error("job cancelled");
    vi.stubGlobal("fetch", async () => {
      controller.abort(reason);
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      completeWithGateway("extract_dgpc", request, {
        config,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
  });

  it("never puts the secret or the prompt in an error", async () => {
    for (const reply of [
      () => Response.json({ reason: "upstream" }, { status: 502 }),
      () => Response.json({ reason: "unauthorized" }, { status: 401 }),
      () => {
        throw new TypeError("fetch failed");
      },
    ]) {
      vi.stubGlobal("fetch", async () => reply());
      const error = await call();
      expect(error.message).toMatch(/^model gateway \w+$/);
      expect(JSON.stringify(error)).not.toContain("client-secret-value");
      expect(JSON.stringify(error)).not.toContain("private words");
    }
  });
});
