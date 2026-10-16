import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  extractFacebookPage,
  facebookPageFetch,
  fetchFacebookPagePosts,
} from "@/lib/text-sources/facebook-page";

const html = readFileSync(
  new URL("./fixtures/facebook-page-traficalg.html", import.meta.url),
  "utf8",
);

describe("Facebook page reader", () => {
  it("reads the newest post a logged-out page renders", () => {
    expect(extractFacebookPage(html)).toEqual({
      page_id: "808412572528916",
      stories: [
        {
          post_id: "1548230040683533",
          creation_time: 1792176041,
          message: expect.stringContaining("ازدحام مروري بالطريق الاجتنابي"),
        },
      ],
    });
  });

  it("keeps the identity the Apify-era rows were stored under", async () => {
    const posts = await fetchFacebookPagePosts(
      "traficalg",
      facebookPageFetch(async () => new Response(html)),
    );
    expect(posts).toEqual([
      {
        id: "808412572528916_1548230040683533",
        uri: "traficalg",
        created_time: "2026-10-16T18:40:41Z",
        message: expect.stringContaining("#ازدحام"),
        region: "",
        type: [],
      },
    ]);
  });

  it("sends browser navigation headers, without which Facebook answers 400", async () => {
    const upstream = vi.fn(async () => new Response(html));
    await fetchFacebookPagePosts("traficalg", facebookPageFetch(upstream));
    const [url, init] = upstream.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://www.facebook.com/traficalg");
    expect(init.headers).toMatchObject({
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "document",
    });
  });

  it("hands the archive the extracted posts, not the megabyte page", async () => {
    const response = await facebookPageFetch(async () => new Response(html))(
      "https://www.facebook.com/traficalg",
    );
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.text()).length).toBeLessThan(2_000);
  });

  const wall = (cookie = "datr=abc; Path=/; Secure") =>
    new Response(null, {
      status: 302,
      headers: {
        location: "https://www.facebook.com/login/?next=traficalg",
        "set-cookie": cookie,
      },
    });

  it("replays the wall's cookies like a browser and reads the page on a retry", async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(wall())
      .mockResolvedValueOnce(new Response(html));
    const posts = await fetchFacebookPagePosts(
      "traficalg",
      facebookPageFetch(upstream),
    );
    expect(posts).toHaveLength(1);
    expect(upstream.mock.calls[1]![1]!.headers).toMatchObject({
      Cookie: "datr=abc",
    });
  });

  it("fails loudly on a login wall that holds for every attempt", async () => {
    const upstream = vi.fn<typeof fetch>(async () => wall());
    await expect(
      fetchFacebookPagePosts("traficalg", facebookPageFetch(upstream)),
    ).rejects.toThrow("Facebook login wall (HTTP 302)");
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("fails on a redirect that is not the login wall instead of following it", async () => {
    const moved = new Response(null, {
      status: 302,
      headers: { location: "https://www.facebook.com/elsewhere" },
    });
    await expect(
      fetchFacebookPagePosts(
        "traficalg",
        facebookPageFetch(async () => moved),
      ),
    ).rejects.toThrow("Facebook page HTTP 302");
  });

  it("fails loudly when Facebook refuses the request", async () => {
    await expect(
      fetchFacebookPagePosts(
        "traficalg",
        facebookPageFetch(async () => new Response("", { status: 400 })),
      ),
    ).rejects.toThrow("Facebook page HTTP 400");
  });

  it("fails loudly when the page renders no post, so a markup change is not read as silence", async () => {
    await expect(
      fetchFacebookPagePosts(
        "traficalg",
        facebookPageFetch(async () => new Response("<html></html>")),
      ),
    ).rejects.toThrow("Facebook page rendered no post (schema changed?)");
  });
});
