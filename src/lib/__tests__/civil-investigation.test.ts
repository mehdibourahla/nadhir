import { beforeEach, expect, it, vi } from "vitest";
const { rpc, from, investigate } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  investigate: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc, from },
}));
vi.mock("../civil-agent.server", () => ({
  investigateCivilReport: investigate,
  civilAgentCompletion: () => vi.fn(),
}));
import { runCivilInvestigations } from "../civil-investigation.server";
import { GatewayFailed, GatewayPending } from "../llm/gateway.server";
import type { ClaimedSourceJob } from "../source-jobs";
const job = { id: "job", attempt_count: 3 } as ClaimedSourceJob;
beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_civil_investigations"
        ? [{ id: "work", report_id: "report", incident_index: 0, attempts: 7 }]
        : null,
    error: null,
  }));
  from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: () => query,
      neq: () => query,
      in: () => query,
      order: () => query,
      limit: () => query,
      gt: () => query,
      abortSignal: () => query,
      single: async () => ({
        data: {
          body: "Accident Tipaza",
          published_at: "2026-09-21T10:00:00Z",
          source_post_id: "post",
          source_page: "traficalg",
          extraction: { incidents: [{ kind: "collision" }] },
        },
        error: null,
      }),
      then: (resolve: (x: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
    };
    return query;
  });
});
it("persists the grounded agent decision with both attempt fences", async () => {
  const decision = {
    decision: { outcome: "review" },
    trace: [],
    model: "test",
    version: "civil-agent-v1",
  };
  investigate.mockResolvedValue(decision);
  expect(await runCivilInvestigations(job)).toEqual({ failed: 0, pending: 0 });
  expect(rpc).toHaveBeenLastCalledWith("finish_civil_investigation", {
    _job: "job",
    _attempt: 3,
    _id: "work",
    _investigation_attempt: 7,
    _result: decision,
    _error: null,
  });
});
it("retains provider failure for autonomous retry without manufacturing a decision", async () => {
  investigate.mockRejectedValue(new Error("provider timeout"));
  expect(await runCivilInvestigations(job)).toEqual({ failed: 1, pending: 0 });
  expect(rpc).toHaveBeenLastCalledWith(
    "finish_civil_investigation",
    expect.objectContaining({ _result: null, _error: "provider timeout" }),
  );
});
it("records rejected database decisions as failed investigations", async () => {
  investigate.mockResolvedValue({ decision: { outcome: "publish" } });
  rpc.mockImplementation(async (name, args) => ({
    data:
      name === "claim_civil_investigations"
        ? [{ id: "work", report_id: "report", incident_index: 0, attempts: 7 }]
        : null,
    error: args._result ? { message: "source revision changed" } : null,
  }));
  expect((await runCivilInvestigations(job)).failed).toBe(1);
  expect(rpc).toHaveBeenLastCalledWith(
    "finish_civil_investigation",
    expect.objectContaining({
      _result: null,
      _error: "Civil decision rejected: source revision changed",
    }),
  );
});
it("does not investigate without a source-job claim", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "lease lost" } });
  await expect(runCivilInvestigations(job)).rejects.toThrow("lease lost");
  expect(investigate).not.toHaveBeenCalled();
});
it.each([
  [new GatewayPending("plan_paused", 1800), 1800],
  [new GatewayPending("rate_limited", 5), 60],
  [new GatewayPending("login_expired", 600), 600],
])(
  "puts the claim back without spending an attempt on %s",
  async (failure, delay) => {
    rpc.mockImplementation(async (name) => ({
      data:
        name === "claim_civil_investigations"
          ? [
              {
                id: "work",
                report_id: "report",
                incident_index: 0,
                attempts: 7,
              },
              {
                id: "next",
                report_id: "report",
                incident_index: 1,
                attempts: 2,
              },
            ]
          : null,
      error: null,
    }));
    investigate.mockRejectedValue(failure);
    expect(await runCivilInvestigations(job)).toEqual({
      failed: 0,
      pending: 0,
      paused: failure.message,
    });
    expect(investigate).toHaveBeenCalledTimes(1);
    const calls = rpc.mock.calls.map(([name]) => name);
    expect(calls).not.toContain("finish_civil_investigation");
    expect(rpc).toHaveBeenCalledWith("release_civil_investigation", {
      _job: "job",
      _attempt: 3,
      _id: "work",
      _investigation_attempt: 7,
      _delay_seconds: delay,
    });
    expect(rpc).toHaveBeenCalledWith(
      "release_civil_investigation",
      expect.objectContaining({ _id: "next", _investigation_attempt: 2 }),
    );
  },
);
it("spends an attempt on an upstream failure", async () => {
  investigate.mockRejectedValue(new GatewayFailed("upstream"));
  expect(await runCivilInvestigations(job)).toEqual({ failed: 1, pending: 0 });
  expect(rpc).toHaveBeenLastCalledWith(
    "finish_civil_investigation",
    expect.objectContaining({ _error: "model gateway upstream" }),
  );
});
