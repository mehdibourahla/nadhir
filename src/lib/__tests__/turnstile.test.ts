import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const reportMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  owned: vi.fn(),
  state: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: { getUser: reportMocks.getUser },
    rpc: reportMocks.rpc,
    from: () => ({
      select: (columns: string) => ({
        eq: () =>
          columns === "id"
            ? { eq: () => ({ maybeSingle: reportMocks.owned }) }
            : { single: reportMocks.state },
      }),
    }),
  },
}));

vi.mock("@/lib/report-publication.server", () => ({
  publishWaitingReports: vi.fn(),
}));

import { turnstileLanguage } from "@/lib/turnstile";
import {
  handleContributeIdea,
  handleContributeTranslation,
  handleContributeVote,
} from "@/lib/contribute-routes.server";
import { handleReportPublish } from "@/lib/report-publish.server";
import {
  TURNSTILE_SITEVERIFY_URL,
  verifyTurnstileToken,
} from "@/lib/turnstile.server";

const SECRET = "test-turnstile-secret-key";
const REPORT_ID = "3c100000-0000-4000-8000-000000000001";

describe("F24 verifyTurnstileToken (fail-closed Cloudflare Turnstile verifier)", () => {
  it("skips when unconfigured and not required, but fails closed (503) when required", async () => {
    const skipped = await verifyTurnstileToken({
      token: null,
      secretKey: "",
      required: false,
    });
    expect(skipped).toEqual({ ok: true, skipped: true });

    const requiredMissingSecret = await verifyTurnstileToken({
      token: "valid-token",
      secretKey: "",
      required: true,
    });
    expect(requiredMissingSecret).toEqual({
      ok: false,
      status: 503,
      reason: "not_configured",
    });
  });

  it("rejects missing, blank, oversized, or control-char tokens with 400 before calling siteverify", async () => {
    const fetchImpl = vi.fn();

    expect(
      await verifyTurnstileToken({
        token: "",
        secretKey: SECRET,
        fetchImpl,
      }),
    ).toEqual({ ok: false, status: 400, reason: "missing_token" });

    expect(
      await verifyTurnstileToken({
        token: "a".repeat(2049),
        secretKey: SECRET,
        fetchImpl,
      }),
    ).toEqual({ ok: false, status: 400, reason: "invalid_token_format" });

    expect(
      await verifyTurnstileToken({
        token: "bad\ntoken",
        secretKey: SECRET,
        fetchImpl,
      }),
    ).toEqual({ ok: false, status: 400, reason: "invalid_token_format" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects leading/trailing CRLF or NUL control characters before trimming with 400 and zero fetch calls", async () => {
    const fetchImpl = vi.fn();

    expect(
      await verifyTurnstileToken({
        token: "\r\nvalid-token\r\n",
        secretKey: SECRET,
        fetchImpl,
      }),
    ).toEqual({ ok: false, status: 400, reason: "invalid_token_format" });

    expect(
      await verifyTurnstileToken({
        token: "\0valid-token\0",
        secretKey: SECRET,
        fetchImpl,
      }),
    ).toEqual({ ok: false, status: 400, reason: "invalid_token_format" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects invalid or replayed (timeout-or-duplicate) tokens with 403", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: false,
        "error-codes": ["timeout-or-duplicate"],
      }),
    );

    const result = await verifyTurnstileToken({
      token: "replayed-token",
      secretKey: SECRET,
      remoteIp: "198.51.100.10",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(result).toEqual({
      ok: false,
      status: 403,
      reason: "invalid_token",
      errorCodes: ["timeout-or-duplicate"],
    });
  });

  it("rejects wrong action and wrong hostname with 403", async () => {
    const wrongAction = await verifyTurnstileToken({
      token: "tok",
      secretKey: SECRET,
      expectedAction: "contribute_idea",
      expectedHostname: "nadhir.app",
      fetchImpl: vi.fn(async () =>
        Response.json({
          success: true,
          action: "other_action",
          hostname: "nadhir.app",
        }),
      ),
    });
    expect(wrongAction).toEqual({
      ok: false,
      status: 403,
      reason: "action_mismatch",
    });

    const wrongHost = await verifyTurnstileToken({
      token: "tok",
      secretKey: SECRET,
      expectedAction: "contribute_idea",
      expectedHostname: "nadhir.app",
      fetchImpl: vi.fn(async () =>
        Response.json({
          success: true,
          action: "contribute_idea",
          hostname: "attacker.example",
        }),
      ),
    });
    expect(wrongHost).toEqual({
      ok: false,
      status: 403,
      reason: "hostname_mismatch",
    });
  });

  it("fails closed with 503 on verifier 5xx, non-JSON, or timeout", async () => {
    const upstream5xx = await verifyTurnstileToken({
      token: "tok",
      secretKey: SECRET,
      fetchImpl: vi.fn(
        async () => new Response("bad gateway", { status: 502 }),
      ),
    });
    expect(upstream5xx).toEqual({
      ok: false,
      status: 503,
      reason: "upstream_error",
    });

    const badJson = await verifyTurnstileToken({
      token: "tok",
      secretKey: SECRET,
      fetchImpl: vi.fn(
        async () => new Response("<html>err</html>", { status: 200 }),
      ),
    });
    expect(badJson).toEqual({
      ok: false,
      status: 503,
      reason: "upstream_error",
    });

    const timeout = await verifyTurnstileToken({
      token: "tok",
      secretKey: SECRET,
      timeoutMs: 10,
      fetchImpl: vi.fn(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    });
    expect(timeout).toEqual({
      ok: false,
      status: 503,
      reason: "timeout",
    });
  });

  it("accepts a valid token with matching action and hostname", async () => {
    const result = await verifyTurnstileToken({
      token: "valid-token",
      secretKey: SECRET,
      expectedAction: "report_publish",
      expectedHostname: ["nadhir.app"],
      fetchImpl: vi.fn(async () =>
        Response.json({
          success: true,
          action: "report_publish",
          hostname: "nadhir.app",
          challenge_ts: "2026-11-25T11:00:00Z",
        }),
      ),
    });

    expect(result).toEqual({
      ok: true,
      action: "report_publish",
      hostname: "nadhir.app",
      challengeTs: "2026-11-25T11:00:00Z",
    });
  });
});

describe("F24 wired write handlers enforce Turnstile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    reportMocks.getUser.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });
    reportMocks.rpc.mockResolvedValue({ data: true, error: null });
    reportMocks.owned.mockResolvedValue({
      data: { id: REPORT_ID },
      error: null,
    });
    reportMocks.state.mockResolvedValue({
      data: { publish_state: "published", hazard: "fire", summary: "Smoke" },
      error: null,
    });
  });

  it("blocks unverified submissions and accepts valid tokens on contribute idea, translation, and vote", async () => {
    const submitIdeaMock = vi.fn(async () => ({
      ok: true as const,
      id: "idea-1",
    }));
    const submitSuggestionsMock = vi.fn(async () => ({
      ok: true as const,
      saved: 1,
    }));
    const castVoteMock = vi.fn(async () => ({ ok: true as const, score: 4 }));

    const rejectVerify = vi.fn(async (input) =>
      verifyTurnstileToken({
        ...input,
        secretKey: SECRET,
        fetchImpl: vi.fn(async () =>
          Response.json({
            success: false,
            "error-codes": ["invalid-input-response"],
          }),
        ),
      }),
    );

    const acceptVerify = vi.fn(async (input) =>
      verifyTurnstileToken({
        ...input,
        secretKey: SECRET,
        fetchImpl: vi.fn(async () =>
          Response.json({
            success: true,
            action: input.expectedAction,
            hostname: "nadhir.app",
          }),
        ),
      }),
    );

    // Idea: missing -> 400, invalid -> 403, valid -> 200
    const ideaMissing = await handleContributeIdea(
      new Request("https://nadhir.app/api/public/contribute/idea", {
        method: "POST",
        body: JSON.stringify({
          lane: "data",
          message: "Add rain radar",
          locale: "en",
        }),
      }),
      { verifyTurnstile: rejectVerify, submitIdea: submitIdeaMock },
    );
    expect(ideaMissing.status).toBe(400);
    expect(submitIdeaMock).not.toHaveBeenCalled();

    const ideaInvalid = await handleContributeIdea(
      new Request("https://nadhir.app/api/public/contribute/idea", {
        method: "POST",
        body: JSON.stringify({
          lane: "data",
          message: "Add rain radar",
          locale: "en",
          turnstileToken: "bad-tok",
        }),
      }),
      { verifyTurnstile: rejectVerify, submitIdea: submitIdeaMock },
    );
    expect(ideaInvalid.status).toBe(403);
    expect(submitIdeaMock).not.toHaveBeenCalled();

    const ideaValid = await handleContributeIdea(
      new Request("https://nadhir.app/api/public/contribute/idea", {
        method: "POST",
        body: JSON.stringify({
          lane: "data",
          message: "Add rain radar",
          locale: "en",
          turnstileToken: "good-tok",
        }),
      }),
      { verifyTurnstile: acceptVerify, submitIdea: submitIdeaMock },
    );
    expect(ideaValid.status).toBe(200);
    expect(submitIdeaMock).toHaveBeenCalledOnce();

    // Translation: invalid -> 403, valid -> 200
    const transInvalid = await handleContributeTranslation(
      new Request("https://nadhir.app/api/public/contribute/translation", {
        method: "POST",
        body: JSON.stringify({
          locale: "kab",
          reviewerKey: "reviewer-key-1234",
          rows: [],
          turnstileToken: "bad-tok",
        }),
      }),
      {
        verifyTurnstile: rejectVerify,
        submitSuggestions: submitSuggestionsMock,
      },
    );
    expect(transInvalid.status).toBe(403);
    expect(submitSuggestionsMock).not.toHaveBeenCalled();

    const transValid = await handleContributeTranslation(
      new Request("https://nadhir.app/api/public/contribute/translation", {
        method: "POST",
        body: JSON.stringify({
          locale: "kab",
          reviewerKey: "reviewer-key-1234",
          rows: [],
          turnstileToken: "good-tok",
        }),
      }),
      {
        verifyTurnstile: acceptVerify,
        submitSuggestions: submitSuggestionsMock,
      },
    );
    expect(transValid.status).toBe(200);
    expect(submitSuggestionsMock).toHaveBeenCalledOnce();

    // Vote: invalid -> 403, valid -> 200
    const voteInvalid = await handleContributeVote(
      new Request("https://nadhir.app/api/public/contribute/vote", {
        method: "POST",
        body: JSON.stringify({
          ideaId: "idea-1",
          voterKey: "voter-key-1234",
          value: 1,
          turnstileToken: "bad-tok",
        }),
      }),
      { verifyTurnstile: rejectVerify, castVote: castVoteMock },
    );
    expect(voteInvalid.status).toBe(403);
    expect(castVoteMock).not.toHaveBeenCalled();

    const voteValid = await handleContributeVote(
      new Request("https://nadhir.app/api/public/contribute/vote", {
        method: "POST",
        body: JSON.stringify({
          ideaId: "idea-1",
          voterKey: "voter-key-1234",
          value: 1,
          turnstileToken: "good-tok",
        }),
      }),
      { verifyTurnstile: acceptVerify, castVote: castVoteMock },
    );
    expect(voteValid.status).toBe(200);
    expect(castVoteMock).toHaveBeenCalledOnce();
  });

  it("enforces Turnstile on handleReportPublish while still rejecting unknown fields like force: true", async () => {
    const publish = vi.fn();
    const makeReq = (body: unknown) =>
      new Request("https://nadhir.app/api/private/report-publish", {
        method: "POST",
        headers: { authorization: "Bearer valid-session" },
        body: JSON.stringify(body),
      });

    const unknownField = await handleReportPublish(
      makeReq({ id: REPORT_ID, force: true }),
      publish,
    );
    expect(unknownField.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();

    const blocked = await handleReportPublish(
      makeReq({ id: REPORT_ID, turnstileToken: "bad" }),
      publish,
      {
        verifyTurnstile: async (input) =>
          verifyTurnstileToken({
            ...input,
            secretKey: SECRET,
            fetchImpl: vi.fn(async () =>
              Response.json({
                success: false,
                "error-codes": ["timeout-or-duplicate"],
              }),
            ),
          }),
      },
    );
    expect(blocked.status).toBe(403);
    expect(publish).not.toHaveBeenCalled();

    const allowed = await handleReportPublish(
      makeReq({ id: REPORT_ID, turnstileToken: "good-token" }),
      publish,
      {
        verifyTurnstile: async (input) =>
          verifyTurnstileToken({
            ...input,
            secretKey: SECRET,
            fetchImpl: vi.fn(async () =>
              Response.json({
                success: true,
                action: "report_publish",
                hostname: "nadhir.app",
              }),
            ),
          }),
      },
    );
    expect(allowed.status).toBe(200);
    expect(publish).toHaveBeenCalledWith([REPORT_ID]);
  });

  it("maps Kabyle locale to French for Turnstile widget rendering", () => {
    expect(turnstileLanguage("ar")).toBe("ar");
    expect(turnstileLanguage("fr")).toBe("fr");
    expect(turnstileLanguage("kab")).toBe("fr");
    expect(turnstileLanguage("en")).toBe("en");
  });
});

describe("F24 read-only public hazard feeds have ZERO Turnstile gating (SECURITY.md:38)", () => {
  it("contains zero Turnstile imports or invocations across public hazard routes", () => {
    const root = process.cwd();
    const readOnlyFiles: string[] = [
      "src/routes/forecast.tsx",
      "src/routes/wilaya.$slug.tsx",
    ];

    for (const dir of [
      "src/routes/api/public/v1",
      "src/routes/api/public/share",
      "src/routes/survival",
    ]) {
      const fullDir = join(root, dir);
      for (const entry of readdirSync(fullDir)) {
        if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
          readOnlyFiles.push(join(dir, entry));
        }
      }
    }

    expect(readOnlyFiles.length).toBeGreaterThanOrEqual(15);

    const violations: string[] = [];
    for (const relPath of readOnlyFiles) {
      const source = readFileSync(join(root, relPath), "utf8");
      if (/turnstile/i.test(source)) {
        violations.push(relPath);
      }
    }
    expect(violations).toEqual([]);
  });
});
