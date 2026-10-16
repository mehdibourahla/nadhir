# ITA Facebook source: Apify bridge now, Meta PPCA later

**Superseded 2026-10-16.** The page is read directly, logged out, every minute (`facebook-page.ts`); Apify is removed. The "login wall, datacenter" rejection below was never tested: a browser-headed GET returns the newest post server-rendered, from Cloudflare too.

Collect every post of Info Trafic Algérie's Facebook page, not only the subset its website feed
republishes. The target is Meta's Page Public Content Access (PPCA); an Apify collector carries
the posts until PPCA is approved. Measurements of 2026-09-28 decided the design.

## What the measurements showed

- `ita_website` (`infotraficalgerie.com/api/facebook/`) is ITA's curated traffic feed, not a
  mirror: accidents and congestion from three pages (`808412572528916` main, `100263326209599`,
  `101990129373936`), each tagged `region` and `type`.
- Apify task `nadhir-ita-traficalg` (`apify/facebook-posts-scraper`, every 5 min since
  2026-09-23) saw 72 main-page posts from 2026-09-24 15:51 to 2026-09-28 15:25; the website feed
  had 32 of them. Of the 40 it lacked, about 15 were actionable hazards: two fires (`#حريق`), oil
  on motorways, a broken-down vehicle in a live lane, wrong-way drivers, stones thrown from a
  bridge, billboards about to fall. The rest were reader messages, behaviour posts and advice.
- Both sources see a post a median 2 min after publication.
- Nothing ever read the Apify datasets: no webhook, no code on any branch, no prod table.
- Pricing is per event. An empty window still writes a `no_items` record, billed as a post:
  $0.005 post + $0.002 date filter + $0.001 start = $0.008 a run. 910 of the last 1000 runs were
  empty. The account hit its $10 cap on 2026-09-28 at 15:25 UTC; the cycle resets 2026-10-07.

Cost by cadence, simulated on the real post times (19 posts/day):

| Cadence | Per month | Worst delay |
|---|---|---|
| 5 min | $70 | 5 min |
| 15 min | $24 | 15 min |
| 30 min | $13 | 30 min |
| 60 min | $8 | 60 min |

## Decisions

- Target: Meta PPCA (Graph API `/{page-id}/feed`). It needs business verification and App Review;
  the applicant is an Algerian entity not yet registered, so PPCA is months away.
- Interim: Apify at 15 min, about $24/month, behind a fetcher the Graph API later replaces.
- Rejected: self-scraping through Cloudflare Browser Rendering (Facebook login wall, datacenter
  IP blocking, Meta terms); running without a bridge (the reader alerts and fire posts stay
  invisible until PPCA).

## Collector

- New source contract `ita_facebook`: family `civil_information`, criticality `supporting`,
  cadence 15 min, overlap 5 min, warning 45 min, stale 90 min, execution target `cloudflare`,
  `replay_capability` `none`.
- Our scheduler owns the cadence. The Apify schedule `nadhir-ita-every-5-min` is disabled.
- Each job calls `POST /v2/actor-tasks/{task}/run-sync-get-dataset-items` through `archivedFetch`,
  120 s timeout, token in the worker secret `APIFY_TOKEN`, task id in `APIFY_ITA_TASK_ID`.
- The POST body merges over the task input: `onlyPostsNewerThan` is the minutes since the job's
  `data_from` plus 2, clamped to 20–60, so a retried job still covers its own window;
  `resultsLimit` 20, `maxItems=20` and `maxTotalChargeUsd=0.2` cap what one run can cost.
- A run that returns 20 items (the window may hold more) or whose lookback hit the 60-minute cap
  is `partial` and does not mark its interval covered. The busiest windows seen were 4 posts in
  22 minutes and 7 in 60; a claimed job's `data_from` is at most about 52 minutes old.
- No gap replay: the actor filters only by a lower time bound, so replaying an old window would
  fetch and bill every post since then. A slot lost beyond its retry window stays lost; the
  website feed still carries the curated subset.
- Items are validated with zod and mapped to the existing `ItaFeedPost` shape:
  `id` = `${pageAdLibrary.id}_${postId}`, `uri` = `pageName`, `created_time` = `time`,
  `message` = `text`, `region` = `""`, `type` = `[]`. The identity matches the website feed's
  (`808412572528916_<postId>`, `uri=traficalg`).
- A `no_items` record means an empty window: the run succeeds with zero posts. An item failing
  the schema is rejected and counted, and fails the run like a rejected website post. All 106
  posts seen on 2026-09-28 had text and `pageAdLibrary.id` `808412572528916`.

## Storage and extraction

- New RPC `save_ita_facebook_posts(_job, _attempt, _posts)`: asserts the `ita_facebook` lease,
  inserts into `ita_reports`, touches no ETag state. `save_ita_feed` stays `ita_website`-only.
- Dedup, both RPCs: skip the insert when a row with the same `(source_page, source_post_id)` and
  the same `ita_text_key(body)` exists: the text with emoji, hashtags, whitespace and ASCII
  punctuation removed. The website feed rewrites Facebook's text (it drops hashtags such as
  `#iAccident🚨🚨` into `type`): of the 32 posts both sources saw on 2026-09-28, 1 body was
  identical and all 32 keys were. The first source to see a post wins; a text edit still adds a
  revision; an edit that only changes hashtags or emoji does not. An edit reverted to an earlier
  text is not stored again.
  Behaviour change on `ita_website`: a change of `region` or `type` alone no longer creates a
  revision or a republication. A post Apify saw first keeps no website region/type hint; the
  extractor already treats both as unreliable.
- `ita_facebook` only collects. Extraction stays with the `ita_website` job (`claim_ita_extractions`,
  5 per 5-min run, about 60/hour against roughly 30 new posts/day), so retries, quarantine and
  `prepare_source_recovery` keep one owner.

## Failure and budget

- A capped account answers HTTP 403 `{"error":{"type":"platform-feature-disabled","message":
  "Monthly usage hard limit exceeded"}}` (observed 2026-09-28). The run fails with private
  diagnostic `Apify usage cap reached (HTTP 403)` and public code `upstream_unreachable`: a new
  public code would need strings in four locales for one source. A timeout or 5xx fails the run
  for the next slot. The contract thresholds put a dead collector in `source_watchdog`, and the
  existing operator alert reaches Telegram within the hour.
- `ita_facebook` stays out of the public map's `relevantKeys` banner on purpose: a capped bridge
  must not tell every user the map is limited. `/status` shows its label from the database.
- At most 96 runs/day. The owner sets the Apify account's hard monthly limit to $30.

## PPCA track

1. Register the Algerian entity (company or association).
2. Create a Meta Business account in the exact legal name, with a `@nadhir.app` email.
3. Code, once the legal name is known: legal name and one contact in the `nadhir.app` footer;
   the entity in `/privacy` and `/terms` (both live).
4. Business verification with the RC/NIF certificate or association receipt showing legal name
   and address (3–7 business days, per secondary sources).
5. Create the Meta app; request PPCA in App Review with a screencast from an ITA post to the Civil
   Publication Nadhir makes from it. PPCA's allowed use is to analyse and display Page posts.

Until approval, a development-mode app reads only Pages whose admin holds a role in the app.

## Cutover to the Graph API

- A `graph` fetcher reads `/{page-id}/feed` and returns `ItaFeedPost`; `ita_facebook` switches to
  it with a `parser_version` bump. Contract, RPC, dedup and extraction are unchanged.
- The same PR deletes the Apify fetcher, the `APIFY_*` secrets and the Apify task.
- Tariki, the DGPC Facebook page and DGF each become a separate decision on the same collector.

## Tests

- Mapping, with fixtures cut from real datasets pulled on 2026-09-28: a post and a `no_items`
  record; a schema failure uses that post with `text` removed.
- pgTAP: the same post from both sources inserts once; a text edit inserts a revision; a
  region/type-only website change inserts nothing; a lost `ita_facebook` lease is refused.
- Runner: an empty window succeeds with zero posts; a capped 403 fails as
  `upstream_unreachable`; the lookback follows `data_from` within 20–60 minutes.

## Out of scope

Tariki, the DGPC Facebook page and DGF (after PPCA); comments and reactions; images and video.

## Sources

- Meta, Page Public Content Access: https://developers.facebook.com/docs/features-reference/page-public-content-access
- Business verification requirements (secondary): https://saveoffice.io/blog/meta-business-verification-documents,
  https://docs.360dialog.com/docs/resources/meta-business-verification/classic-business-verification
- Apify actor pricing: `GET /v2/acts/KoJrdxJCTtpon81KY` (`pricingInfos`), read 2026-09-28.
