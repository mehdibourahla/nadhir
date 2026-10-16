import { z } from "zod/v4";

import type { ItaFeedPost } from "./ita-feed";

// Facebook answers 400 to a request that does not look like a browser navigation
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9",
  "sec-ch-ua":
    '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};
const LOGIN_WALL = 401;

const ExtractSchema = z.object({
  page_id: z.string().regex(/^\d+$/).nullable(),
  stories: z
    .array(
      z.object({
        post_id: z.string().regex(/^\d+$/),
        creation_time: z.number().int().positive(),
        message: z.string().max(50_000).nullable(),
      }),
    )
    .max(50),
});
type FacebookPageExtract = z.infer<typeof ExtractSchema>;

const isNode = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const at = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce((node, key) => (isNode(node) ? node[key] : undefined), value);

// logged out, a page server-renders only its newest post; older ones load on scroll
export function extractFacebookPage(html: string): FacebookPageExtract {
  let pageId: string | null = null;
  const stories = new Map<string, FacebookPageExtract["stories"][number]>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!isNode(value)) return;
    const delegateId = at(value, "delegate_page", "id");
    if (typeof delegateId === "string") pageId ??= delegateId;
    const postId = value["post_id"];
    const created = value["creation_time"];
    if (
      value["__typename"] === "Story" &&
      typeof postId === "string" &&
      typeof created === "number" &&
      !stories.has(postId)
    ) {
      // a reshare nests the original under attached_story; only this path is the post's own text
      const text = at(
        value,
        "comet_sections",
        "content",
        "story",
        "message",
        "text",
      );
      stories.set(postId, {
        post_id: postId,
        creation_time: created,
        message: typeof text === "string" ? text : null,
      });
    }
    Object.values(value).forEach(walk);
  };
  for (const [, json] of html.matchAll(
    /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      walk(JSON.parse(json!));
    } catch {
      continue;
    }
  }
  return { page_id: pageId, stories: [...stories.values()] };
}

const ATTEMPTS = 3;
const EMPTY = { page_id: null, stories: [] };

function isLoginWall(response: Response) {
  const location = response.headers.get("location");
  return (
    response.status >= 300 &&
    response.status < 400 &&
    location !== null &&
    new URL(location, "https://www.facebook.com").pathname.startsWith("/login")
  );
}

export function facebookPageFetch(
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const cookies = new Map<string, string>();
    for (let attempt = 1; ; attempt++) {
      const response = await fetchImpl(input, {
        ...init,
        headers: cookies.size
          ? { ...HEADERS, Cookie: [...cookies.values()].join("; ") }
          : HEADERS,
        redirect: "manual",
      });
      if (!isLoginWall(response)) {
        if (!response.ok)
          return Response.json(EMPTY, { status: response.status });
        return Response.json(extractFacebookPage(await response.text()));
      }
      await response.body?.cancel();
      if (attempt === ATTEMPTS)
        return Response.json(EMPTY, { status: LOGIN_WALL });
      // from shared datacenter IPs the wall is intermittent; a browser replays its cookies and retries
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(";")[0]!.trim();
        cookies.set(pair.split("=")[0]!, pair);
      }
    }
  };
}

export async function fetchFacebookPagePosts(
  page: string,
  fetchImpl: typeof fetch,
): Promise<ItaFeedPost[]> {
  const response = await fetchImpl(`https://www.facebook.com/${page}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === LOGIN_WALL) throw new Error("Facebook login wall");
  if (!response.ok) throw new Error(`Facebook page HTTP ${response.status}`);
  const { page_id, stories } = ExtractSchema.parse(await response.json());
  if (!page_id || !stories.length)
    throw new Error("Facebook page rendered no post");
  return stories.flatMap(({ post_id, creation_time, message }) =>
    message?.trim()
      ? [
          {
            id: `${page_id}_${post_id}`,
            uri: page,
            created_time: new Date(creation_time * 1000)
              .toISOString()
              .replace(/\.\d{3}Z$/, "Z"),
            message,
            region: "",
            type: [],
          },
        ]
      : [],
  );
}
