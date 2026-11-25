import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  consent: vi.fn(),
  owned: vi.fn(),
  state: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table === "privacy_consents") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: mocks.consent }),
              }),
            }),
          }),
        };
      }
      return {
        select: (columns: string) => ({
          eq: () =>
            columns === "id"
              ? { eq: () => ({ maybeSingle: mocks.owned }) }
              : { single: mocks.state },
        }),
      };
    },
  },
}));
vi.mock("@/lib/report-publication.server", () => ({
  publishWaitingReports: vi.fn(),
}));

import { handleReportPublish } from "@/lib/report-publish.server";

const ID = "3c100000-0000-4000-8000-000000000001";
const request = (body: unknown, bearer = true) =>
  new Request("https://nadhir.app/api/private/report-publish", {
    method: "POST",
    headers: bearer ? { authorization: "Bearer session" } : {},
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1" } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.consent.mockResolvedValue({ data: null, error: null });
  mocks.owned.mockResolvedValue({ data: { id: ID }, error: null });
  mocks.state.mockResolvedValue({
    data: { publish_state: "published", hazard: "flooding", summary: "Water" },
    error: null,
  });
});

it("refuses a caller who is not signed in", async () => {
  const publish = vi.fn();
  expect(
    (await handleReportPublish(request({ id: ID }, false), publish)).status,
  ).toBe(401);
  expect(publish).not.toHaveBeenCalled();
});

it("never classifies someone else's report", async () => {
  mocks.owned.mockResolvedValue({ data: null, error: null });
  const publish = vi.fn();
  expect((await handleReportPublish(request({ id: ID }), publish)).status).toBe(
    404,
  );
  expect(publish).not.toHaveBeenCalled();
});

it("rejects a body that is not exactly one report id", async () => {
  const publish = vi.fn();
  for (const body of [{ id: "nope" }, { id: ID, force: true }, {}])
    expect((await handleReportPublish(request(body), publish)).status).toBe(
      400,
    );
  expect(publish).not.toHaveBeenCalled();
});

it("classifies the caller's report and returns where it stands", async () => {
  const publish = vi.fn();
  const res = await handleReportPublish(request({ id: ID }), publish);
  expect(res.status).toBe(200);
  expect(publish).toHaveBeenCalledWith([ID]);
  expect(await res.json()).toEqual({
    publish_state: "published",
    hazard: "flooding",
    summary: "Water",
  });
});

it("rejects report publish with 403 when citizen_reports consent is withdrawn and fails closed with 503 on DB error (T5-R2-01)", async () => {
  const publish = vi.fn();
  mocks.consent.mockResolvedValueOnce({
    data: { status: "withdrawn" },
    error: null,
  });
  const withdrawnRes = await handleReportPublish(request({ id: ID }), publish);
  expect(withdrawnRes.status).toBe(403);
  expect(await withdrawnRes.json()).toEqual({ error: "consent_withdrawn" });
  expect(publish).not.toHaveBeenCalled();

  mocks.consent.mockResolvedValueOnce({
    data: null,
    error: { message: "consent table timeout" },
  });
  const errorRes = await handleReportPublish(request({ id: ID }), publish);
  expect(errorRes.status).toBe(503);
  expect(await errorRes.json()).toEqual({ error: "consent_unavailable" });
  expect(publish).not.toHaveBeenCalled();
});
