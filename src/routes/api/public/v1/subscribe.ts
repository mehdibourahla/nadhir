import { createFileRoute } from "@tanstack/react-router";

const MAX_COMMUNES = 10;
const LANGS = ["ar", "fr", "en", "kab"];

export const Route = createFileRoute("/api/public/v1/subscribe")({
  server: {
    handlers: {
      ANY: async () => {
        const { postMethodNotAllowed } =
          await import("@/lib/public-api.server");
        return postMethodNotAllowed();
      },
      OPTIONS: async () => {
        const { postPreflight } = await import("@/lib/public-api.server");
        return postPreflight();
      },
      POST: async ({ request }) => {
        const { postJson: json, enforcePostRateLimit } =
          await import("@/lib/public-api.server");
        const limited = await enforcePostRateLimit(request);
        if (limited) return limited;

        const { fcmConfigured, fcmSubscribeTopics } =
          await import("@/lib/ingest/fcm.server");
        if (!fcmConfigured())
          return json({ error: "push delivery is not configured" }, 503);

        const { readJsonBody } = await import("@/lib/request-body.server");
        const read = await readJsonBody(request, 16_384);
        if ("error" in read) {
          return json(
            {
              error:
                read.status === 413 ? "body too large" : "invalid JSON body",
            },
            read.status,
          );
        }
        if (
          !read.body ||
          typeof read.body !== "object" ||
          Array.isArray(read.body)
        ) {
          return json({ error: "invalid JSON body" }, 400);
        }
        const body = read.body as {
          token?: unknown;
          communes?: unknown;
          lang?: unknown;
          action?: unknown;
        };

        const { token, communes, lang, action } = body;
        if (typeof token !== "string" || !token.length || token.length > 4096)
          return json({ error: "invalid token" }, 400);
        if (typeof lang !== "string" || !LANGS.includes(lang))
          return json({ error: "invalid lang", allowed: LANGS }, 400);
        if (action !== "subscribe" && action !== "unsubscribe")
          return json(
            { error: "invalid action", allowed: ["subscribe", "unsubscribe"] },
            400,
          );
        if (
          !Array.isArray(communes) ||
          !communes.length ||
          communes.length > MAX_COMMUNES ||
          communes.some((c) => typeof c !== "string")
        )
          return json(
            { error: `communes must be 1-${MAX_COMMUNES} codes` },
            400,
          );

        const { supabaseAdmin } =
          await import("@/integrations/supabase/client.server");
        const { data: known, error } = await supabaseAdmin
          .from("admin_units")
          .select("code")
          .eq("level", "commune")
          .in("code", communes as string[]);
        if (error) return json({ error: "commune lookup failed" }, 500);
        const knownCodes = new Set((known ?? []).map((r) => r.code));
        const unknown = (communes as string[]).filter(
          (c) => !knownCodes.has(c),
        );
        if (unknown.length)
          return json({ error: "unknown commune codes", unknown }, 400);

        const { fcmTopic } = await import("@/lib/fcm");
        const topics = (communes as string[]).map((c) => fcmTopic(c, lang));
        try {
          await fcmSubscribeTopics(token, topics, action === "subscribe");
        } catch (e) {
          return json(
            { error: e instanceof Error ? e.message : "subscription failed" },
            502,
          );
        }
        return json({ ok: true, topics });
      },
    },
  },
});
