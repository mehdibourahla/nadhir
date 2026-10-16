import { describe, expect, it, vi } from "vitest";
import { fetchItaFeed } from "../text-sources/ita-feed";
import {
  runItaSourceWith,
  type ItaStore,
} from "../text-sources/ita-pipeline.server";
import { LlmUnavailable } from "../text-sources/llm-unavailable";

const post = {
  id: "808412572528916_1511278197712051",
  uri: "traficalg",
  created_time: "2026-09-08T18:35:11+0000",
  message:
    "🚧 متابعة : وجود أشغال بالطريق السيار شرق غرب على مستوى البويرة اتجاه الجزائر",
  region: "Bouira",
  type: ["iTravaux"],
};
function setup() {
  const store = {
    etag: vi.fn().mockResolvedValue('"old"'),
    saveFeed: vi.fn<ItaStore["saveFeed"]>().mockResolvedValue(1),
    claim: vi.fn().mockResolvedValue([{ id: "revision", raw: post }]),
    finish: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    pendingCount: vi.fn().mockResolvedValue(0),
  } satisfies ItaStore;
  const fetchFeed = vi
    .fn()
    .mockResolvedValue({ notModified: false, etag: '"new"', posts: [post] });
  const extract = vi.fn().mockResolvedValue({ incidents: [] });
  return { store, fetchFeed, extract };
}
describe("ITA pipeline", () => {
  it("processes durable backlog despite upstream failure", async () => {
    const deps = setup();
    deps.fetchFeed.mockRejectedValue(new Error("upstream unavailable"));
    const run = await runItaSourceWith(deps);
    expect(deps.extract).toHaveBeenCalledWith(post);
    expect(run).toMatchObject({ extracted: 1, error: "upstream unavailable" });
    expect(deps.store.saveFeed).not.toHaveBeenCalled();
  });
  it("cancels a stalled fetch without advancing its checkpoint", async () => {
    const deps = setup();
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const stalled: typeof fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
        started();
      });
    try {
      const result = runItaSourceWith({
        ...deps,
        fetchFeed: (etag) => fetchItaFeed(etag, stalled),
      });
      await ready;
      expect(timeout).toHaveBeenCalledWith(20_000);
      controller.abort(
        new DOMException("ITA request timed out", "TimeoutError"),
      );
      expect(await result).toMatchObject({
        error: "ITA request timed out",
        extracted: 1,
      });
      expect(deps.store.saveFeed).not.toHaveBeenCalled();
      expect(deps.store.claim).toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });
  it("persists source before extraction and includes metadata in the revision hash", async () => {
    const deps = setup();
    await runItaSourceWith(deps);
    expect(deps.store.saveFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        etag: '"new"',
        posts: [
          expect.objectContaining({
            body: post.message,
            source_page: "traficalg",
            source_post_id: post.id,
            content_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ],
      }),
    );
    expect(deps.store.saveFeed.mock.invocationCallOrder[0]).toBeLessThan(
      deps.extract.mock.invocationCallOrder[0]!,
    );
    const originalHash =
      deps.store.saveFeed.mock.calls[0]![0].posts[0]!.content_hash;
    deps.fetchFeed.mockResolvedValue({
      notModified: false,
      etag: '"newer"',
      posts: [{ ...post, region: "Alger" }],
    });
    await runItaSourceWith(deps);
    expect(
      deps.store.saveFeed.mock.calls[1]![0].posts[0]!.content_hash,
    ).not.toBe(originalHash);
  });
  it("processes pending extractions after an unchanged 304", async () => {
    const deps = setup();
    deps.fetchFeed.mockResolvedValue({
      notModified: true,
      etag: '"old"',
      posts: [],
    });
    const run = await runItaSourceWith(deps);
    expect(deps.store.claim).toHaveBeenCalledWith(5);
    expect(deps.extract).toHaveBeenCalledWith(post);
    expect(run.extracted).toBe(1);
  });
  it("retains source and surfaces extraction failures", async () => {
    const deps = setup();
    deps.extract.mockRejectedValue(new Error("OPENROUTER_API_KEY missing"));
    deps.store.pendingCount.mockResolvedValue(1);
    const run = await runItaSourceWith(deps);
    expect(run).toMatchObject({
      stored: 1,
      failed: 1,
      pending: 1,
      error: "OPENROUTER_API_KEY missing",
    });
    expect(deps.store.finish).toHaveBeenCalledWith(
      "revision",
      null,
      "OPENROUTER_API_KEY missing",
    );
  });
  it("returns every unread claim when the model provider is unavailable", async () => {
    const deps = setup();
    deps.store.claim.mockResolvedValue([
      { id: "first", raw: post },
      { id: "second", raw: post },
    ]);
    deps.extract.mockRejectedValue(
      new LlmUnavailable("ITA extraction HTTP 402"),
    );
    const run = await runItaSourceWith(deps);
    expect(deps.extract).toHaveBeenCalledTimes(1);
    expect(deps.store.finish).not.toHaveBeenCalled();
    expect(deps.store.release.mock.calls).toEqual([["first"], ["second"]]);
    expect(run).toMatchObject({ failed: 0, error: "ITA extraction HTTP 402" });
  });
  it("does not extract or advance after a storage failure", async () => {
    const deps = setup();
    deps.store.saveFeed.mockRejectedValue(new Error("database unavailable"));
    await expect(runItaSourceWith(deps)).rejects.toThrow(
      "database unavailable",
    );
    expect(deps.extract).not.toHaveBeenCalled();
  });
  it("surfaces durable completion failures instead of claiming success", async () => {
    const deps = setup();
    deps.store.finish.mockRejectedValue(new Error("lease expired"));
    await expect(runItaSourceWith(deps)).rejects.toThrow("lease expired");
  });
  it("reports a backlog without failing collection when no retry is eligible", async () => {
    const deps = setup();
    deps.store.claim.mockResolvedValue([]);
    deps.store.pendingCount.mockResolvedValue(8);
    const result = await runItaSourceWith(deps);
    expect(result.pending).toBe(8);
    expect(result.error).toBeUndefined();
  });
  it("keeps the ETag unchanged while valid posts from a partial feed are processed", async () => {
    const deps = setup();
    deps.fetchFeed.mockResolvedValue({
      notModified: false,
      etag: '"new"',
      posts: [post],
      rejectedPosts: 1,
    });
    const result = await runItaSourceWith(deps);
    expect(result).toMatchObject({
      stored: 1,
      rejected: 1,
      error: "ITA feed rejected 1 posts",
    });
    expect(deps.store.saveFeed).toHaveBeenCalledWith(
      expect.objectContaining({ etag: '"old"' }),
    );
  });
});
