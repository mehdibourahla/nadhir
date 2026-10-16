import { archivedFetch } from "@/lib/source-archive.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { ClaimedSourceJob } from "@/lib/source-jobs";
import type { ItaFeedPost } from "./ita-feed";
import { facebookPageFetch, fetchFacebookPagePosts } from "./facebook-page";
import { revision, type Revision } from "./ita-pipeline.server";

const PAGE = "traficalg";

export type ItaFacebookRun = {
  fetched: number;
  stored: number;
  newestPostAt: string | null;
  error?: string;
};

export async function runItaFacebookSourceWith({
  fetchPosts,
  save,
}: {
  fetchPosts: () => Promise<ItaFeedPost[]>;
  save: (posts: Revision[]) => Promise<number>;
}): Promise<ItaFacebookRun> {
  let posts: ItaFeedPost[];
  try {
    posts = await fetchPosts();
  } catch (cause) {
    return {
      fetched: 0,
      stored: 0,
      newestPostAt: null,
      error:
        cause instanceof Error ? cause.message : "Facebook page unavailable",
    };
  }
  const stored = await save(await Promise.all(posts.map(revision)));
  return {
    fetched: posts.length,
    stored,
    newestPostAt:
      posts
        .map((p) => p.created_time)
        .sort()
        .at(-1) ?? null,
  };
}

export async function runItaFacebookSource(
  job: ClaimedSourceJob,
): Promise<ItaFacebookRun> {
  return runItaFacebookSourceWith({
    fetchPosts: () =>
      fetchFacebookPagePosts(PAGE, (input, init) =>
        archivedFetch("ita_facebook", "page_posts", input, init, {
          fetchImpl: facebookPageFetch(),
          requestParams: { page: PAGE },
        }),
      ),
    async save(posts) {
      const { data, error } = await supabaseAdmin.rpc(
        "save_ita_facebook_posts",
        {
          _job: job.id,
          _attempt: job.attempt_count,
          _posts: posts as unknown as Json,
        },
      );
      if (error) throw new Error(`ITA Facebook storage: ${error.message}`);
      return data;
    },
  });
}
