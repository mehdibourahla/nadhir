# Codex subscription transport (2026-10-21)

## Goal

Run Nadhir's public-source extraction (DGPC bulletins and situation posts, ITA website and Facebook posts) on the
owner's ChatGPT Plus plan through the Codex endpoint, OpenRouter falling back on any failure. Off until the
`CODEX_MODEL` repository variable is set. The citizen-report classifier and the civil agent stay on OpenRouter, so
the privacy policy (OpenRouter passes a citizen report to Gemini) stays true.

Protocol as SanoX proved it (PR #355/#356): `POST https://chatgpt.com/backend-api/codex/responses`, SSE, our own
`instructions`, `text.format` json_schema, `store: false`, model `gpt-6-luna` on the standard tier. Plain `fetch`.
Probed with Nadhir's schemas: the zod-generated ITA schema and multi-turn inputs (the ITA repair turns) are accepted.

## Why the calls run on GitHub runners

From workerd, chatgpt.com's Cloudflare edge answers the Codex endpoint with its "Unable to load site" page (HTTP
403), while curl and bun on the same machine, IP and token get 200. `auth.openai.com` answers workerd normally.
Nadhir already moved `ita_facebook` to `execution_target = 'github'` for the same reason (Facebook walls Cloudflare
egress), so the model calls follow it:

- Migration `20261021120000_llm_extraction_github_egress.sql` moves `dgpc_telegram` and `ita_website` (the two
  public-source contracts that call the model; `ita_facebook` only stores posts and is already on github). The
  RSS feeds also use the extractor but are not in scope and stay on Workers and OpenRouter.
- Cadence and lease stay as they are. A runner starts before it claims, so the lease covers execution only, as on
  Workers. `dgpc_telegram` keeps 15 min and the 600 s lease every text source got; ITA keeps 5 min and 300 s,
  bounded per revision by its 45 s budget, which the Codex attempt (30 s timeout) shares. Jobs already queued as
  `cloudflare` drain on Workers: the claim filters on the job's own target.
- `scripts/run-source-job.ts` and `source-jobs-github.yml` accept the two contracts; only their runs get
  `OPENROUTER_API_KEY`, `CODEX_MODEL` and `NADHIR_CRON_SECRET`.
- The seam (`src/lib/llm/subscription.server.ts`) is active only when `GITHUB_ACTIONS=true` and `CODEX_MODEL` is
  set. Workers never try Codex: no probing, no pause noise.

Owner decision, not taken here: `dgpc_telegram` feeds Official Incidents (the only path to "confirmed"). On GitHub
its job waits for pg_cron's one-minute dispatch plus a runner start (tens of seconds, minutes when Actions is slow),
and depends on GitHub Actions being up; the schedule fallback runs only hourly, 06:00 to 17:00 UTC.

## One owner for the login

Refresh tokens rotate: two refreshes of one grant race and the loser kills the login. A SQLite-backed Durable
Object, `CodexLogin` (`src/exports.cloudflare.ts`, state in `src/lib/llm/codex-login.server.ts`), is the only
holder: Cloudflare runs one instance of it, concurrent refreshes share one request, and its storage survives
restarts (both checked in workerd). Refreshing from workerd works.

Runners reach it through `POST /api/internal/codex-login` (same Bearer `NADHIR_CRON_SECRET` scheme as
`source-jobs/run`):

- `{action: "lease"}` returns `{status: "ready", access_token, account_id}`, `{status: "paused"}` or
  `{status: "unavailable", reason, pausedSeconds}`, never cached. Runners never see the refresh token.
- `{action: "report", token, outcome}` after every Codex attempt: the usage headers of a served call, or the
  failure (`reason`, HTTP `status`, `retryAfter`). The object decides: a 401 marks that token stale (only if it is
  still the current one), and the pause is computed and stored there, only ever extended. Parallel runners
  (DGPC and ITA run at once) therefore share one pause and one 80 % ceiling.

Rejected: Workers KV (no compare-and-set, so two refreshers race); a Supabase row (puts the refresh token in the
application database).

Login: `scripts/codex-login-seed.ts` moves a fresh device login (`codex login --device-auth` in an empty
`CODEX_HOME`) into the Worker secret `CODEX_LOGIN_SEED` and deletes the local file. The object adopts a seed whose
fingerprint changed; a re-login is a new seed and lifts any pause.

## Failure handling (as SanoX)

Any failure falls back to OpenRouter for that call. Pauses: 429 the server's reset time; login problems (refresh
refused, no seed, 401/403, other 4xx) 10 min, logged as errors; 5xx, network, timeout, bad stream 1 min, warnings.
At 80 % of either plan window the object pauses until that window resets. Missing usage headers warn once per
runner. The route unreachable or the report undeliverable: fall back, logged. A caller's own abort is rethrown.

## Reasoning effort and evaluation

Each call site names its effort (`completeWithSubscription(purpose, effort, ...)`, `subscriptionFirst(...,
{effort})`); latency no longer matters on a runner. All three use `low`.

`bun run evaluate:codex` (`scripts/evaluate-codex-extraction.ts`, outputs in `.agent/runs/2026-10-21-codex-extraction/`):
the 12 DGPC fixtures through `extractMentionsWithLlm`, each result then scored by the real `runTextSourceWith` on an
in-memory store with the committed gazetteer plus the aliases the migrations seed; 8 ITA posts (synthetic, labels are
the evaluator's reading) through `extractItaReport`. Two runs per arm, about 130 Luna calls, plan usage 1 % (5 h) and
9 % (week) after.

| Arm               | Run   | Bulletins the pipeline accepts | Fires the model read | Fires the pipeline records | ITA correct | Median s |
| ----------------- | ----- | ------------------------------ | -------------------- | -------------------------- | ----------- | -------- |
| gemini-2.5-flash  | 1 / 2 | 9/12, 9/12                     | 77, 77               | 59, 59                     | 8/8, 8/8    | 1.3      |
| gpt-6-luna none   | 1 / 2 | 9/12, 8/12                     | 76, 45               | 59, 59                     | 8/8, 8/8    | 2.1      |
| gpt-6-luna low    | 1 / 2 | 9/12, 9/12                     | 47, 47               | 59, 59                     | 8/8, 8/8    | 2.1      |
| gpt-6-luna medium | 1 / 2 | 10/12, 9/12                    | 44, 54               | 60, 59                     | 8/8, 8/8    | 3.5      |

Read: Luna often skips the wilaya-only distribution lines, but the pipeline records the same fires either way,
because the template reads the distribution and fills what the model left out. Every arm hits the same distribution
conflicts (6872, 6857, 6908); `none` added one (6876, run 2); `medium` once resolved 6908. `low` matches Gemini in
both runs at a cost and latency close to `none`. The situation reader was not re-run (2/3 against Gemini at `none`
earlier, a commune written as `بئر الحمام / مرحومة`).

## Checks

`scripts/codex-egress-check.ts`, run by the manual workflow "Codex egress check": one call from a GitHub runner
through the route to chatgpt.com, the outcome reported to the object. It prints `ok` with the usage headers, or
the failure reason and the pause it caused.

## Data protection

DGPC and ITA posts are public posts by official and media accounts. They may still name people (ITA summaries are
told not to). They would reach OpenAI under the consumer ChatGPT terms, which carry no data processing agreement.
Citizen reports never take this path.
