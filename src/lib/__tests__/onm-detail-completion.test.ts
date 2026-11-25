import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  fetch: vi.fn(),
  failWrite: false,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      if (state.failWrite) return { error: { message: "write unavailable" } };
      Object.assign(
        state.rows.find((row) => row["id"] === args["_id"])!,
        {
          headline_fr: args["_headline_fr"] ?? null,
          cap_detail_fetched_at: new Date().toISOString(),
        },
      );
      return { error: null };
    },
    from: () => {
      let nullField = "";
      let batch = Infinity;
      const query = {
        select: () => query,
        is: (field: string) => {
          nullField = field;
          return query;
        },
        not: () => query,
        order: () => query,
        limit: (count: number) => {
          batch = count;
          return query;
        },
        then: (resolve: (result: unknown) => unknown) => {
          return Promise.resolve({
            data: state.rows
              .filter((row) => row[nullField] == null)
              .slice(0, batch),
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  },
}));
vi.mock("@/lib/source-archive.server", () => ({
  archivedFetch: (...args: unknown[]) => state.fetch(...args),
  ArchiveFailure: class extends Error {},
}));
import { backfillCapDetails } from "../ingest/onm.server";
const xml = readFileSync(
  new URL("./fixtures/onm-cap-sample.xml", import.meta.url),
  "utf8",
).replace(/<headline>[\s\S]*?<\/headline>/g, "");
beforeEach(() => {
  state.rows = Array.from({ length: 21 }, (_, index) => ({
    id: `cap-${index}`,
    cap_url: `https://ametvigilance.meteo.dz/CAPs/${index}.xml`,
    headline_fr: null,
    cap_detail_fetched_at: null,
  }));
  state.failWrite = false;
  state.fetch.mockReset().mockImplementation(async () => new Response(xml));
});
it("finishes valid CAPs without headlines and advances beyond the first twenty", async () => {
  expect(await backfillCapDetails()).toEqual({ filled: 20, failed: 0 });
  expect(await backfillCapDetails()).toEqual({ filled: 1, failed: 0 });
  expect(await backfillCapDetails()).toEqual({ filled: 0, failed: 0 });
  expect(state.fetch).toHaveBeenCalledTimes(21);
  expect(
    state.rows.every((row) => typeof row["cap_detail_fetched_at"] === "string"),
  ).toBe(true);
  expect(state.rows.every((row) => row["headline_fr"] === null)).toBe(true);
});
it.each(["fetch", "parse", "write"])(
  "keeps unsuccessful %s pending for recovery",
  async (kind) => {
    state.rows = state.rows.slice(0, 1);
    if (kind === "fetch")
      state.fetch.mockResolvedValue(
        new Response("unavailable", { status: 503 }),
      );
    if (kind === "parse")
      state.fetch.mockResolvedValue(new Response("invalid CAP"));
    if (kind === "write") state.failWrite = true;
    expect(await backfillCapDetails()).toEqual({ filled: 0, failed: 1 });
    expect(state.rows[0]?.["cap_detail_fetched_at"]).toBeNull();
    state.failWrite = false;
    state.fetch.mockImplementation(async () => new Response(xml));
    expect(await backfillCapDetails()).toEqual({ filled: 1, failed: 0 });
  },
);
it("passes redirect: 'manual' and treats 3xx redirects as failed without following (T5-R2-04)", async () => {
  state.rows = state.rows.slice(0, 1);
  state.fetch.mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    }),
  );
  expect(await backfillCapDetails()).toEqual({ filled: 0, failed: 1 });
  expect(state.fetch).toHaveBeenCalledWith(
    "onm",
    "cap_detail",
    "https://ametvigilance.meteo.dz/CAPs/0.xml",
    { redirect: "manual" },
    expect.objectContaining({
      requestParams: { document: "0.xml" },
    }),
  );
});
