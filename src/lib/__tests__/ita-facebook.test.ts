import { describe, expect, it, vi } from "vitest";

import { runItaFacebookSourceWith } from "@/lib/text-sources/ita-facebook.server";

const post = {
  id: "808412572528916_1526895906150280",
  uri: "traficalg",
  created_time: "2026-09-25T16:34:32Z",
  message: "#حريق #iIncendie 🔥🔥\n\nاشتعال نار فوق بوغلبون بعد نفق عين بوزيان",
  region: "",
  type: [],
};

describe("ITA Facebook collector", () => {
  it("stores the page's newest post as an ITA revision", async () => {
    const save = vi.fn(async () => 1);
    const run = await runItaFacebookSourceWith({
      fetchPosts: async () => [post],
      save,
    });
    expect(run).toEqual({
      fetched: 1,
      stored: 1,
      newestPostAt: "2026-09-25T16:34:32Z",
    });
    expect(save).toHaveBeenCalledWith([
      expect.objectContaining({
        source_post_id: post.id,
        source_page: "traficalg",
        source_url: "https://www.facebook.com/traficalg/posts/1526895906150280",
        body: post.message,
        raw: post,
      }),
    ]);
  });

  it("reports a fetch failure without storing", async () => {
    const save = vi.fn(async () => 0);
    const run = await runItaFacebookSourceWith({
      fetchPosts: async () => {
        throw new Error("Facebook login wall (HTTP 302)");
      },
      save,
    });
    expect(run).toEqual({
      fetched: 0,
      stored: 0,
      newestPostAt: null,
      error: "Facebook login wall (HTTP 302)",
    });
    expect(save).not.toHaveBeenCalled();
  });
});
