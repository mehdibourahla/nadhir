# Codex subscription transport (2026-10-21)

## Goal

Run Nadhir's five structured LLM calls (report classifier, DGPC bulletin extraction, DGPC situation reader, ITA
extraction, civil agent) on the owner's ChatGPT Plus plan through the Codex endpoint, with OpenRouter kept as the
automatic fallback. Off by default: OpenRouter stays primary until `CODEX_MODEL` is set.

The protocol is the one SanoX proved (PR #355/#356, `.agent/evidence/2026-10-21-codex-subscription-spike/` there):
`POST https://chatgpt.com/backend-api/codex/responses`, SSE, our own `instructions`, `text.format` json_schema,
`store: false`, `reasoning.effort: none`, model `gpt-6-luna` on the standard tier. litellm's `chatgpt` provider
drops the schema, so plain `fetch`.

Probed from this branch with Nadhir's own schemas: the zod-generated ITA and civil-agent schemas (`$schema`,
`format: uuid`) and the classifier's `minimum`/`maximum` are accepted, and so are multi-turn inputs with assistant
messages (the civil agent's steps and the ITA repair turns).

## The hard part: one owner for the login on Workers

Refresh tokens rotate: two refreshes of one grant race and the loser's token kills the login. Workers run many
isolates at once and keep no module state between requests, so neither a per-isolate lock nor a Worker secret can
own the token.

Decision: one SQLite-backed Durable Object, `CodexLogin`, addressed by a fixed name. Cloudflare runs one instance of
it worldwide; it holds the token record, the pause deadline and the stale flag, and it is the only code that
refreshes. Concurrent refreshes inside it share one in-flight promise.

Rejected:

- Workers KV: eventually consistent (up to 60 s) with no compare-and-set, so two isolates both see an expiring token
  and both refresh. That is the exact race.
- A Supabase row with a lease: it works, but it puts an OAuth refresh token in the application database that every
  service-role path can read, and needs a migration and RPC for what is process state.

The Worker makes the Codex call itself (the object stays tiny and never holds a citizen's text): `lease()` returns a
token or "paused", then the Worker reports `pause(seconds)` or `expire(token)` back. `expire` only marks the token
stale if it is still the current one, so a late 401 from an old token cannot force a second refresh.

Nadhir already declares bindings in the generated wrangler config (`BROWSER` in `vite.config.ts`); the object is one
more binding plus a `new_sqlite_classes` migration, exported through nitro's `cloudflare.exports` entry
(`src/exports.cloudflare.ts`).

## Login

Nadhir gets its own device login, never a copy of SanoX's or the laptop's: two apps refreshing one grant race.
`scripts/codex-login-seed.ts` reads the `auth.json` of a fresh `codex login --device-auth` (run by the owner in an
empty `CODEX_HOME`), and pipes `{refresh_token, access_token, account_id}` into `wrangler secret put
CODEX_LOGIN_SEED`. The object adopts a seed whose fingerprint (SHA-256 of the refresh token) differs from the one it
stored, then owns the rotating record in its own storage; the secret is dead once rotated. A re-login is a new
seed. Adopting a seed clears any pause.

## Failure handling (as SanoX)

Any failure falls back to OpenRouter for that call and pauses the subscription; pauses only ever extend.

- 429: the server's reset time (`x-codex-primary-reset-after-seconds`, else `retry-after`).
- Login (refresh refused, no seed, 401/403, other 4xx): 10 min, logged as an error. A 401 also marks the token stale.
- 5xx, network, timeout, failed/malformed/incomplete stream, refresh transport: 1 min, logged as a warning.
- Usage headers `x-codex-{primary,secondary}-used-percent`: at 80 % of either window, pause until it resets
  (`*-reset-after-seconds`, else 5 min). Missing headers warn once per isolate.
- The object unreachable: fall back, logged. A caller's own abort is rethrown, never retried on OpenRouter.

`sent` (whether the text may have left) is logged with each failure: token and pause problems are `sent: false`,
anything after `fetch` starts is `sent: true`.

A reply that fails a caller's own validation is not a transport failure: it stays loud and is not retried on
OpenRouter, as on the OpenRouter path today.

## Scope

- No temperature and no max tokens on the Codex path (the endpoint takes neither); system messages become
  `instructions`.
- `CODEX_MODEL` must accept `reasoning.effort: none` (gpt-6-luna and gpt-6-sol do; gpt-6.1-sol does not).
- The plan's 5-hour and weekly allowance is shared with SanoX and the owner's own Codex work; the 80 % ceiling
  protects it.

## Not decided here: data protection

The privacy policy (`privacy_sharing_body`, four locales) says OpenRouter passes a citizen report's text to
Google's Gemini. With `CODEX_MODEL` set, that text (category, commune, the citizen's words) goes to OpenAI under
the consumer ChatGPT terms, which carry no data processing agreement. Flipping the flag needs an owner decision on
that, and a policy update if the classifier is included.

## Blocker found: chatgpt.com refuses the Workers runtime

`wrangler dev --local` (workerd on the laptop, same IP and same access token): `POST /backend-api/codex/responses`
returns Cloudflare's HTML page "Unable to load site" (HTTP 403, `server: cloudflare`), with or without a
User-Agent. From curl and bun on the same machine the same request returns 200. `auth.openai.com/oauth/token`
answers workerd normally. So chatgpt.com's edge blocks workerd's HTTP client, probably on its TLS fingerprint.

Not verified: production Workers egress (Cloudflare's network, not the laptop) is a different path and needs one
real call from a deployed Worker. If it is blocked too, the subscription never serves a call on Workers: each
attempt is a 403, a 10-minute pause, one error line and OpenRouter, so it costs nothing but stays useless. The
fix then is an egress off Workers (for example the GitHub runner Nadhir already uses for Facebook), which is a
separate design.

The same workerd run proved the object itself: the binding resolves, `lease`/`pause` work over RPC, six
concurrent calls share one lease, and a 600 s pause survives a restart.

## Evaluation (2026-10-21, gpt-6-luna vs google/gemini-2.5-flash)

Run from bun (the endpoint accepts it) with each caller's own prompt, schema and validator; fixtures from
`src/lib/__tests__/fixtures` (7 DGPC posts, 5 bulletins, 3 situation posts) plus 8 synthetic citizen reports and
5 synthetic ITA posts. 28 Luna calls, then 8 repeats; plan usage moved 0 points (5-hour 0 %, weekly 9 %).

| Task                                       | Cases | Same result | Median latency Gemini / Luna |
| ------------------------------------------ | ----- | ----------- | ---------------------------- |
| Report classifier (publishable, hazard)    | 8     | 8           | 0.77 s / 1.45 s              |
| ITA extraction (disposition, kind, status) | 5     | 4           | 1.24 s / 2.02 s              |
| DGPC situation reader                      | 3     | 2           | 1.20 s / 1.97 s              |
| DGPC bulletin extraction (mention set)     | 12    | 6           | 1.41 s / 2.36 s              |

- No call failed validation on either model, including the verbatim-evidence checks.
- Bulletins: on the two bulletins with wilaya distribution lines, Luna dropped those lines in 3 of 6 runs (15 of
  44 fires in one), Gemini in 0 of 6. The pipeline's totals check flags the document as incomplete and retries
  it, so the cost is retries and degraded source health, not silent loss. Luna also labels kind `unknown` more
  often and once kept a hashtag spelling (`سوق_أهراس`).
- Situation: Luna wrote the commune as `بئر الحمام / مرحومة` (two communes in one field); not checked against
  the gazetteer, likely unresolved.
- Classifier: on the neighbour complaint Luna gave `personal_data` where Gemini gave `not_a_hazard` (both
  unpublishable; Gemini's summary repeated the private name). On the publishable Kabyle fire report Luna returned
  the citizen's words verbatim as the summary, which would publish raw text against the Hazard Report rule;
  Gemini translated it to French instead of keeping the report's language.
- Not evaluated: the civil agent (its tools query production Supabase).

Read: Luna is close on the classifier and ITA (with the Kabyle summary miss), and weaker and less stable than
Gemini 2.5 Flash on bulletin extraction. One run per case except the bulletin repeats: indicative, not a rate.
