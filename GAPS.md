# Known gaps

## Civil platform update — 2026-09-21

The map supports multiple civil hazards. Deployed PR #138 adds reviewed
ITA publications, audited revisions/withdrawal, automatic read-time expiry and public JSON/CAP.
It does not expand notification eligibility or turn media into
authority instructions. Official multi-hazard onboarding/delivery remains a separate milestone.

Source recovery #139 is deployed: all four DGPC and one ITA quarantines recovered automatically;
16/16 source-health checks, zero pending interpretations, zero open replay gaps and zero
watchdog issues were verified on 21 September. The independent database-triggered watchdog
ran successfully. Four exhausted historical gaps are retained as unrecoverable.
Broader upstream-outage and disaster-restoration exercises remain. The owner previously
confirmed private Telegram and authentication email receipt; device push receipt is measured
since #177 (2026-09-25: an admin test push reached the owner's iPhone 4.3 s after sending).

The [official notification policy](docs/official-notification-policy.md) defines source,
hazard, channel and lifecycle requirements. This branch fixes ONM publication/delivery expiry.
ONM cancellation chains, structured manual-warning metadata and DGPC non-fire adapters remain
explicit gaps; collecting a post or publishing an ITA item does not make it push-eligible.

## Historical priorities — reconciled 2026-09-08

Atomic risk publication is implemented;
production's `local_fwi` checkpoint is complete for 2026-09-08. Local FWI percentiles and
the admin console are also implemented. Telegram is live: the last 24 hours contained
nine satellite broadcasts with six recorded channel sends.

Priorities checked against current code:

1. DGPC-only public Telegram deployed in #120 on 2026-09-08 at 15:58 UTC; the next
   delivery run succeeded at 16:01 UTC. Only official CAP messages carrying
   `source_key=dgpc_telegram` are eligible.
2. Destination receipts deployed in #121. Production delivery runs succeed; the same-day
   read-only check found no receipt rows yet. Device push receipt is measured since #177;
   real DGPC and signup receipt remain unverified.
3. Independent channel queues, backlog incidents, acknowledgement and audited pause/resume
   shipped in #122; source pause/resume in #125. Browser QA also corrected operator access to
   the source replay list. Bulk history now moves to the cold archive after 90 days (#176)
   instead of being purged. Production failure drills remain an operational follow-up; see
   `docs/source-operations.md`.
4. Eight dependency PR intents were integrated in #122. PR #31's source intent
   is replaced with a bounded operator ensemble preview; see `docs/source-successors.md`.
5. R2 growth and R5 observation-ended notifications shipped in #122.
   Email/SMS delivery still requires a named provider and private test recipients/device.

Code and open PRs were rechecked on 2026-09-08. Dated production counts below are historical
observations, not current measurements; configuration and coverage must be refreshed before
acting on them. Code availability alone does not prove live delivery or field verification.

What Nadhir does not do yet, why it matters, and where to start. Historical measurements retain
their dates and reproduction pointers.

Nadhir is expanding from wildfire monitoring to civil information and alerts. A gap in a warning system is not the same as a
missing feature in a normal app: if the danger scale is wrong or an alert never sends, the
product is confidently useless at the moment it matters. The list is ordered accordingly.

**The project is not a safe warning service today.** It is a working data platform with an
honest status page. Treat §1 as the distance between those two things.

## 1. Blocking a real warning service

### 1.1 Danger scale — fuel mask and local percentiles implemented

An earlier version of this section said the scale "carries no information" because 68.8% of
communes read Extreme with none at Low. That predates the noon-LST input fix and was
investigated on 2026-08-29 against a 3-year FWI climatology (the repo's own code over ERA5
archive weather) and ten years of NASA-labelled vegetation fires. The distribution is
seasonal, not broken: Tizi Ouzou spends 48% of the year at level 1 (January: 88 of 93 days)
and ~half of August days at level 5, so "no commune at Low in late August" is what a working
Mediterranean fire-weather scale says at seasonal peak. The scale also discriminates — the 15
largest real-fire days near Tizi Ouzou (2023–25) average level 4.47 against an all-day mean
of 2.25, and 71% of the 697 communes at Extreme on 2026-08-29 had ≥10 vegetation-fire
detections within ~10 km in 2016–25. Do not re-derive "the thresholds are uncalibrated" from
the old text, and do not edit the FWI maths (verified against Van Wagner's worked example in
`src/lib/__tests__/risk.test.ts`).

Current behavior:

- **Fuel mask — shipped 2026-08-30.** FWI is a weather index with no fuel term; Tamanrasset
  read level 5 on 89% of all days including winter. Since the WorldCover enrichment, a
  commune below 5% burnable cover (tree+shrub+grass+crop, `isFuelLimited` in
  `src/lib/zonal.ts`) is written with `risk_forecasts.fuel_limited`; surfaces show "not
  rated", rollups and risk alerts skip it. Dense-urban cores (Alger-Centre) mask too, same
  as EFFIS's own no-data treatment of cities. Absent land-cover data never masks.
- **Local percentiles — implemented 2026-09-03.** `weather.server.ts` reads per-commune,
  calendar-day breakpoints from `fwi_climatology`, persists `fwi_percentile`, and exposes it
  through the forecast page and public risk API beside the absolute class. The seed path is
  `scripts/seed-fwi-climatology.ts` and `data/ewds/`. Missing breakpoints produce null, not
  invented calibration. Remaining work is coverage/provenance and scientific validation of
  the seeded reference data, not building another percentile formula.

Reproduce the seasonality and discrimination numbers: the queries and scripts are described
in the 2026-08-29 investigation; the distribution itself is
`select danger_level, count(*) from risk_forecasts where horizon_days=0 group by 1;`

### 1.2 Registration works; confirm current email capacity

**Reopened and re-measured 2026-09-02: 29 accounts exist, 16 of them email-confirmed, created
between 30 Aug and 2 Sep, owning 19 zones across 9 people.** So registration is not the total
wall this section described. The configuration checked then used the built-in sender with a
**2 emails/hour project-wide** ceiling; 13 accounts were unconfirmed, but that count alone
does not establish why they did not confirm. Reproduce:
`select count(*), count(email_confirmed_at) from auth.users;`

Login itself is fine, and was verified end to end: password grant issues a token, the app's
lazy profile creation succeeds, zone creation succeeds, and RLS holds (inserting a zone under
another user's id is rejected 403). The wall is purely getting confirmed in the first place.

Two related settings were wrong and are now fixed: `site_url` pointed at `http://localhost:3000`
so every confirmation link was dead, and `uri_allow_list` was empty so the app's
`emailRedirectTo` was ignored.

Remaining work: recheck the live Auth email configuration and a confirmation receipt; configure
production SMTP if still absent. Do not use the September 2 account ratio as today's failure rate.

### 1.3 Broadcast delivery exists; reliability and zone delivery remain

Broadcasts publish from satellite fires, ONM and official incident relays, with FCM topic
delivery and an accountless subscription flow (`src/lib/ingest/broadcast.server.ts`,
`delivery.server.ts`). Telegram has recorded live channel sends; its current public policy
is DGPC official CAP relays only. The per-user zone `alerts` rows still lack email/SMS
delivery. A real device receipt was measured on 2026-09-25 (#177); missing push
configuration still reports degraded health.

The **CAP object** every channel must render is now built (`cap_alerts`, `src/lib/cap.ts`):
each fire alert links to one CAP 1.2 warning carrying all four languages, so a channel added
later renders an approved object instead of inventing its own payload. Signing, approval chains and Cell Broadcast remain
institutional work, not code.

What is left is providers for zone email/SMS. The `cap_alerts` migration was applied to the live project on 2026-08-29
(ledger version 20260829010000).

**Commune alert state — 2026-09-02.** A push now means a commune's alert level rose:
level 1 is a fire within the 15 km ring, level 2 a detection pixel inside the commune
polygon, computed against every open thread so a neighbouring cluster cannot re-alert a
commune at a level it already holds; ends push only where nothing else covers the
commune; Extreme needs a settlement within 5 km _and_ 20 MW peak FRP; a thread ended
under 24 h reopens as an update. `broadcasts.commune_codes` stays the coverage the
in-app banner reads, `push_codes` the communes selected for delivery after the level and
daily-cap rules (delivery status stays in the `*_delivered_at` columns), `inside_codes` the
level-2 set.
Replayed over 25–28 Aug FCI (44,534 pixels, `bun run replay:window`): 156 initials and
1,816 commune pushes against 381 and 9,575 under the previous rules, peak 3 pushes to one
commune in a day against 44, no cluster re-broadcast as a fresh initial against 41. Eight
of the ten DGPC-named Jijel communes were pushed 32–42 min after their first in-polygon
pixel; Chekfa (112 min) and Boudria Ben Yadjis (132 min) were pushed the minute their
cluster crossed the confidence bar — single-pixel FCI slots ramp `confidenceScore`
slowly, a fusion question, not the push rule. Rejected with numbers: requiring two looks
before a push removed 12 of 381 initials on that night and cost 10 min at median — it
addresses single-look artefacts, not fatigue. The FRP floor changed no Jijel initial;
its target is the persistent low hotspot whose every look is 1–10 MW — Baraki went out as
Extreme to 44 communes four times under the old rule.

Start at: `src/lib/alerts-engine.server.ts`, `src/lib/cap.ts`.

### 1.4 Geostationary detection — wired 2026-08-30, ~30–40 min latency

MTG FCI detections now ingest every 10 minutes from EUMETSAT's public WFS
(`mtg_fd:frp` on view.eumetsat.int — the same product the Data Store serves as
netCDF, pre-decoded to GeoJSON points, anonymous). `src/lib/ingest/fci.server.ts`
replaced the old catalogue-liveness poll; end-to-end latency is the feed's ~25 min
plus the 10-minute cron. The spec's sub-5-minute target is not met and cannot be
from this feed; it would need the Data Store push subscription plus a decode worker.

Guards, stated: the layer serves a months-deep archive, so the fetch is time-filtered
server-side; the CQL BBOX is lat-first, and a run whose features all fall outside the
watch box errors instead of ingesting the wrong hemisphere. The offline registry
thresholds were derived from ~4 looks/day and must be re-derived before FCI detections
are ever fed into registry _learning_ — today they are not.

**Corrected 2026-09-01.** This section used to claim flare screening applied unchanged.
It does apply, but it was never sufficient, and the sentence hid a missing guard: FCI
shipped without the `isInWatchArea` polygon `firms.server.ts` has used since the first
commit, and its bbox spans lat 18.9–37.6 against the FIRMS feed's 33.2–37.6. Over two
days that admitted 3,731 Saharan detections; 1,377 cleared the flare registry and
clustered, and 25 of the 37 "active fires" on the public map were bare sand at solar
noon. The registry cannot catch this: it is a 1.5 km lookup on recurring sites, and the
noise does not recur — 88% of 403 desert cells were seen exactly once, against 39%
one-shot for northern FCI fires on the same 10-minute revisit. Nor would a confidence
threshold have helped; the artefacts carry median confidence 0.86 against 0.60 for real
FIRMS detections. Geography was the only available discriminator. Fixed in #58, with 362
already-clustered false positives retired in #62.

Two consequences of that fix, both shipped the same day: the upstream slot time has to be
read _before_ the watch-area filter, or freshness only advances when something is alight
in the north and a quiet evening ages a healthy feed into `stale` (#59); and the live map
needed the `false_positive` exclusion that `/api/public/v1/fires` and the history query
already applied (#62).

**Chain latency, measured and corrected 2026-09-02.** An earlier note in this file called
the pipeline "four independent 10-minute polls" whose floor was structural. That was wrong.
The contracts all carry `schedule_offset_minutes = 0`; what staggers them is the queue's
dependency gate plus one claim per Cron Event, so production ran ingest → screen → fuse →
publish → deliver exactly one minute apart:

```
23:00:14 fci   23:01:14 persistent_screen   23:02:14 fusion
23:03:14 broadcast_publish   23:04:14 broadcast_delivery
```

Four minutes, not forty. The dispatcher now claims in five waves of two within a 20-second
budget instead of four parallel claims, so one Cron Event drains the whole chain; the first
wave always runs whatever the budget says. The remaining floor is the feed itself: FCI is
~22 min behind real time and its slot is 10 min wide.

**Persistence rule shipped 2026-09-02.** A Fire is Detected only on two distinct looks —
two slots of one sensor, or two sensors — so two adjacent FCI pixels in one 10-minute slot
no longer promote a cluster. Measured on production since 30 Aug: of 362 clusters retired as
`false_positive`, 311 rest on a single look against 51 with two or more, and one live
`active` cluster was a single-slot FCI pair at 0.60. Replayed over the Jijel night it costs
7 of 156 initial broadcasts and 10 minutes on 4 of the 10 DGPC-named communes (32 → 42 min);
all ten are still reached. Reproduce with the query in this section's history or
`bun run replay:window`. The paragraph below records what was measured and rejected before
this rule, and still stands for the variants it names.

**Superseded — the earlier persistence discussion.** Nothing between ingest and the
map requires a geostationary detection to be confirmed by a second look, so the watch-area
polygon is the only defence left, and one missing import cost 25 false fires. Requiring
_N_ revisits in a cell before a slot-cadence source can seed a cluster would have caught
this independently of geography. It is not implemented because it trades against warning
latency on a safety product: any such rule delays a genuine new ignition by at least one
10-minute slot, and that tradeoff is a decision for the maintainers, not a cleanup.

Two variants were measured on 2026-09-01 against the 31 Aug – 1 Sep detections, and both
fail — record this before proposing either again:

- **Plain "require two looks"** would suppress real fires. 39% of northern FCI cells (28
  of 72) were one-shot, so the rule cannot separate a first detection of a genuine
  ignition from an artefact using persistence alone.
- **Gating it on `isFuelLimited`** to spare vegetated ground fixes that, but leaves almost
  nothing to act on and does not work as a backstop. Of 472 detections inside the watch
  area only 9 (1.9%) fall in a fuel-limited commune. And of the 4,239 the polygon now
  rejects — the flood the rule was meant to catch if the polygon were ever missing again —
  **60% are not within 60 km of any commune at all**, so there is no landcover to test and
  the rule silently passes them. It would have caught 40% and let 2,538 through.

A workable version would apply persistence to slot-cadence sources without a commune
lookup, so it does not fail in empty terrain, and would need an FRP or confidence
dimension to avoid the one-shot problem above. That is design work, not a patch.

**Sentinel-3 SLSTR — two defects found and fixed 2026-09-02, still zero stored rows.**
It shipped with `detections.source` checked against `('firms','fci')`, so every SLSTR pixel
was rejected at insert while the run ledger said `partial / internal_error` (#75). It also
keyed freshness on `upstream_published_at`: a polar orbiter passes twice a day over a country
that is often not burning, and an empty response carries no slot, so the watermark never
advanced and a working feed read `unavailable` for ever — the same class as FCI's `latestSlot`
below. FIRMS is polar too and keys freshness on the poll for this reason; `s3_slstr` now does
the same. As of 23:30 on 2 Sep the feed answers and had exactly one in-area detection all day
(S3B, 36.777 / 4.876, FRP 13.6 MW at 10:19 UTC) which aged out of the six-hour fetch window
before the constraint fix deployed at 19:45. The first stored row is expected on the next
pass with a fire under it, not tonight.

**Sentinel-3 SLSTR added 2026-09-02.** The same anonymous WFS serves
`copernicus:sentinel3{a,b}_slstr_level2_frp`, pre-decoded like the FCI layer, so a second
independent sensor (polar, ~1 km, two passes a day per satellite, NRT under 3 h) costs one
layer descriptor in `fci.server.ts` and the `s3_slstr` contract. It runs hourly with the
same watch-area gate; it improves recall on fires VIIRS and FCI miss, not first-alert
latency. It shipped with `detections.source` still checked against `('firms','fci')`, so
every SLSTR pixel was rejected at insert for three days while the run ledger said
`partial / internal_error` and the health view said `unavailable`; widened 2026-09-02. The DGPC recall study found 7 of 42 named fires on 28 Aug with no detection at all.

### 1.5 Official incident reports — first source wired 2026-09-02

Satellites are the only way a fire could exist in Nadhir until now; the 2026-09-01 recall
study found that on 28 Aug, 7 of 42 communes DGPC named as burning had **no detection at
all**, and one (Aïn Zouit) was named three days before FIRMS saw it. The official layer
buys that recall and the authority's own status vocabulary — bulletins arrive 1–4 times a
day (same-day gaps median 2.7 h), so it is not early warning and must not be sold as one.

Shape: per-source knowledge lives in a `text_sources` registry row (transport, authority
tier, language, template) and a thin adapter that writes immutable `source_documents`;
everything after is shared — classify by regex → the header's as-of and per-wilaya ongoing
counts by regex → every fire line by one model completion with a strict JSON schema and quoted
evidence (gpt-6-luna on the ChatGPT plan, through the home gateway in `infrastructure/home-m2`)
→ a distribution gate (a commune the model names outside the authority's own per-wilaya count,
or in excess of it, falls back to wilaya precision; the remainder of each count becomes a
wilaya-level mention) → resolve against the
gazetteer plus `admin_unit_aliases` → append-only `incident_mentions` → deterministic
match & merge (same commune · kind within 48 h; highest tier and latest as-of set the
status) → `official_incidents`. The map draws the commune polygon, never a point; the
sheet quotes the evidence and links the post. `official_incident_recall_daily` is the
standing metric on `/status`.

Eight national press RSS feeds were registered as `media`-tier text sources on 2026-09-02
and withdrawn the same evening: in an hour of production they yielded 102 articles, 16 about
fires, all aftermath and solidarity, and one wilaya-only mention with no status. Web editions
publish after the fact; live media here is television and radio, which have no text surface.
The DGPC channel's fire bulletins arrive 1–4 times a day, a median of 10 h apart across all
consecutive bulletins including the overnight gap (2.7 h when only same-day pairs are counted),
and nothing at night. Sources stay national by rule — no per-wilaya or per-commune page is
ever registered — and everything official beyond DGPC (wilaya directorates, Gendarmerie Tariki
road status every 15 min, Info Trafic Algérie with ~1.9M followers, DGF) sits behind Facebook.

Open: wilaya Civil Protection and forestry pages live
on Facebook and need Meta page access or a Telegram/RSS surface; without `NADHIR_GATEWAY_URL` nothing is
extracted and every document waits in the retry queue. Official incidents now feed
Broadcast Alerts through `relayOfficialIncidents` in `broadcast.server.ts`; public
Telegram additionally requires the DGPC source marker (§1.3).

Citizen hazard reports now also render on the live map (hollow marker, kind, age, "unverified"
line) from the same 24-hour `hazard_reports` view the Survival page uses; the approved-only
query nothing consumed is gone.

## 2. Data quality

### 2.1 Land cover and terrain — populated 2026-08-30

All **1536 communes** now carry WorldCover 2021 class fractions (`landcover`),
`forest_fraction` from tree cover, and Copernicus DEM slope/aspect stats (`terrain`).
Commune polygons were seeded from Overpass into `admin_units.geom` (join by `ref:ONS`,
1536/1537). The §9.3 wind bump has 250 eligible communes (was 13); 168 communes fall under
the 5% burnable-cover fuel mask. Verified against an independent benchmark at Tizi Ouzou
(tree 0.499 vs 0.431, mean slope 7.7° vs 6.0°, p90 18.9° vs 19.9°).

Remaining, stated rather than hidden: wilaya rows are not enriched (the model reads commune
values only); WorldCover is frozen at 2021, so a commune that burned since is still modelled
as vegetated — Impact Observatory's annual product is the refresh path; `terrain` has no
reader in the risk model yet, stored so the raster pass is not run twice.

Re-run: `bun run seed:polygons`, `bun run enrich:zonal`.
Reproduce: `select count(*) filter (where landcover is not null) from admin_units where level='commune';`

### 2.2 EFFIS / GWIS is connected for danger classes only

Since 2026-08-29 the daily risk refresh samples the EFFIS WMS danger map per commune into
`effis_danger` — the external comparator §1.1 needs. Three corrections to what this section
originally claimed, all verified live on 2026-08-29:

- **Raw FWI is available programmatically.** GetFeatureInfo on layer `ecmwf007.query` with
  `info_format=text/html` returns FWI, FFMC, DMC, DC, ISI, BUI and the danger/anomaly/
  ranking indices as numbers. Earlier checks missed it because text/plain and GML return
  empty attributes and a continental bbox returns an empty body. A wholesale switch was
  considered and rejected: per-commune point queries mean 1,536 daily requests against
  JRC's free WMS versus one GetMap; the layer serves the cold-start guard and future
  spot-calibration instead.
- **The palette labels were shifted one class.** The legend's six classes start at Low —
  there is no very_low, and the top class is Very Extreme. Fixed in `effis.server.ts`;
  the mislabeled 2026-08-29 rows were deleted by migration. White pixels are EFFIS
  declining to rate unvegetated land and are stored as `masked` rather than dropped.
- **EFFIS runs can be cold-started.** On 2026-08-29 every Mediterranean pixel (Tizi Ouzou,
  Seville, Sicily) carried DMC ≈ 6.5 and DC ≈ 16 — the CFFDRS initialization values,
  physically impossible in late August. The ingest now checks sentinel DC values through
  the query layer and refuses the run during the dry season when all sit below 100.

The adapter now requests its job's date and EFFIS has a seven-day interval replay window
(`20260903190000_effis_interval_replay.sql`). A palette change still degrades the source
loudly when zero communes match.

**Historical outage, measured 2026-09-01:** every EFFIS
endpoint answers `msLoadMap(): Unable to access file` — served as **HTTP 200 with
`text/html`**, not a 4xx or 5xx. `effis_danger` holds no rows, so §1.1's external
comparator is unavailable, and the cold-start guard cannot fire either: it needs two
readable sentinels and `GetFeatureInfo` returns none while the mapserver is broken.
`res.ok` was therefore the wrong contract check — 590 bytes of HTML reached
`PNG.sync.read`, threw, and the executor filed a JRC outage as our `internal_error`,
pointing an on-call reader at the wrong codebase. `pngPayloadError` now checks the PNG
signature before decoding and reports `upstream_unreachable` (#63). Nothing here brings
EFFIS back; it recovers when JRC does.

### 2.3b Three communes were parented to the wrong wilaya by OSM

Adekar (ONS 0624, chef-lieu of its own daïra in Béjaïa) was seeded under Tizi Ouzou, so
DGPC bulletins naming it never resolved — the "missing from the gazetteer" symptom this
file used to record. Fixed 2026-09-02 in `data/geo/algeria-admin.json` and by migration.

Two more have the same shape and are **not** fixed, because the right parent needs a
source rather than a guess: `2005 Moulay Larbi` sits under Sidi Bel Abbès with a Saïda
code, and `3017 Benaceur` under El Oued with an Ouargla code — and Benaceur may belong to
Touggourt (55) since the 2019 reform. Both are outside the fire watch area. Reproduce:

```sql
select c.code, c.name_fr, w.name_fr as parent
from admin_units c join admin_units w on w.id = c.parent_id
where c.level = 'commune' and left(c.code, 2) <> lpad(w.code, 2, '0')
  and w.code::int <= 48;
```

A code prefix that disagrees with the parent is normal for the wilayas created in 2019
(49–58), which kept their communes' historical ONS codes; the query above excludes them.

Separately, "Larbaa" is not an alias gap: three communes carry the name (Batna, Blida,
Tissemsilt), so a bulletin naming it resolves only when the wilaya is extracted, since the
national fallback demands a unique name.

### 2.3 Commune-to-wilaya assignment — reconciled with Loi 26-06 (2026-08-30)

The law (JORADP N° 25, transcribed with citations in `data/geo/loi-26-06.json`) is now
the applied authority: `bun run audit:loi` verifies 403 of the law's 404 listed
assignments against the live `admin_units`, zero misfiled. Five re-parents were applied
with article citations (El Aricha's four communes out of Tlemcen per Art. 52 bis 14;
Beni Khellad out of Aïn Témouchent per Art. 17) and mirrored in `data/geo/algeria-admin.json`
so reseeds agree; ten spelling variants are pinned in the law file's `name_mappings`
(each code verified against the database), and the audit consumes them.

Still open, stated in the law file's `open_items`: Bou Saâda's "Menaâ" (Art. 52 bis 19)
has no counterpart commune in the database; `2839 Ouled Atia` exists here but in no law
list; and `admin_units` holds 1537 communes against the law's 1541 — the missing rows
are unidentified and need the Arabic original or ONS tables to name.

### 2.4 Source reliability — atomic publication built; delivery remains open

The first slice of the Data Reliability Control Plane replaces the two most dangerous health
shortcuts. Freshness is no longer guessed in the browser from hard-coded intervals, and raw
`ingest_runs.error` is no longer public. Every current source and derived stage reports a
structured outcome to an append-only private `source_runs` ledger; one atomic recorder advances
the corresponding `source_checkpoints` row; and the `source_health` view derives `healthy`,
`delayed`, `degraded`, `stale`, `unavailable` or `paused` from the versioned contract and its
watermarks. The status page, homepage signal and `/api/public/v1/status` consume that same
sanitized projection. This is milestone M1A in `roadmap.md`.

M2 replaces the direct HTTP cron pipelines with durable per-contract `source_jobs` and one active
lease per contract. Supabase and Cloudflare independently enqueue the same normalized slots;
short jobs run on the Worker, while FWI and EFFIS have separate GitHub consumers. Attempts and
retry windows are bounded, expired leases are recovered, missing intervals become `source_gaps`,
and exact interval replay accepts a recorded FIRMS, FCI or EFFIS gap UUID inside provider
retention. Terminal gaps for other contracts are marked unrecoverable rather than pretending
they can be reconstructed. A watchdog queries Supabase directly from GitHub
Actions, so the Worker is not its own monitor. Its failures report breached database evidence,
not an inferred Worker crash. Queue, lease, gap, run, and replay internals remain service-role-only.
Current-only backlog is explicit: an older queued slot is failed with an audited `data_delayed`
run and unrecoverable gap before the consumer drains the newest useful slot.
Consumers keep polling while a retry is pending, and an expired usefulness window is terminalized
in bounded 25-row maintenance batches with an audited run plus a replayable or explicitly
unrecoverable gap. Replayability also respects the provider's retention window.
Deployed 2026-08-31 (#52). The production observation this section asked for happened on
2026-09-01 and found one defect the local verification could not see. `local_fwi` and
`effis` are the only contracts with `execution_target = 'github'`, so nothing in the
every-minute Cloudflare path can claim them; their 06:00 slots carried
`retry_window_minutes = 240`, closing the window at 10:00, while GitHub delivered the
scheduled workflow at 11:33, 13:09, 11:34 and 12:30 on consecutive days. The runner
therefore arrived after the claim function's maintenance loop had already expired the job
it came to do, found nothing, printed `{"claimed":false,"pending":false}` and exited 0 —
a green workflow over a source that had not run since the cutover. `source_gaps` records
it exactly: both contracts hold `unrecoverable` rows stamped `detected_at 11:33:19Z`.

The daily fire-danger refresh was consequently stale for a day and its horizon thinned by
one day per day. The window is now 720 minutes and the workflow cron runs hourly across
it rather than four times an hour inside four (#63); GitHub drops bunched schedules, which
is why sixteen requested runs produced roughly one. The adapter itself was never at
fault — invoked directly it completed all 1,536 communes in 63 requests without error.

**The watchdog was inside the Worker again, and is not any more (2026-09-02).** #67 moved
it into the Worker's own cron with a Telegram DM, which is the fastest signal while the
Worker is alive and no signal at all when it is not — the failure that silences every
10-minute source at once. A second watchdog now runs in GitHub Actions twice an hour,
queries Supabase directly, and adds the one issue the in-Worker one cannot raise:
`worker_silent`, when no `cloudflare`-target contract has started a run in 25 minutes. It
keeps its own fingerprint (`external_watchdog`), so the two do not overwrite each other's
transition state. `TELEGRAM_BOT_TOKEN` was a repository secret while `NADHIR_OPERATOR_CHAT_ID`
was missing at that observation. Recheck current configuration and receipt evidence; that
dated absence is not proof the operator notification remains unwired today.

Worth carrying into reliability validation: a consumer that reports success when it claimed nothing cannot
distinguish "drained" from "never arrived", and that is the same shape as the two other
blind signals found the same day (§2.2's outage filed as our own error, and ONM stuck
`partial` on one trailing letter).

Publication and delivery status:

- **Atomic FWI publication (M3) — implemented.** `weather.server.ts` stages a generation and
  calls `publish_risk_forecast_snapshot`; the database validates complete coverage and switches
  the publication pointer transactionally. The 2026-09-08 takeover observed a complete
  `local_fwi` checkpoint. Keep failure/partial-generation checks as release gates; do not
  schedule this as an unbuilt feature.
- **Channel-isolated delivery (M4).** The receipt fix deployed in #121: private
  `broadcast_delivery_receipts` records successful chats/topics so retries skip them; provider
  rejection continues other destinations, and channel errors do not block the other channel.
  #122 added independent leased queues, eight bounded attempts, 24-hour expiry,
  a 15-minute backlog signal, operator pause/resume and incident acknowledgement. An accepted send with a lost
  response or failed receipt write can still repeat; neither provider offers exactly-once sends.

The dormant `data_sources` and `ingest_runs` relations exist only for the expand/contract deploy
window. The inactive database HTTP helper and token table also remain until the queue-backed
release completes its observation window. The contract-release checklist in
`docs/superpowers/plans/2026-08-31-source-health-contract-cleanup.md` removes them after
production evidence proves that no deployed code still uses them.

That evidence now exists for the two relations, gathered 2026-09-01: `ingest_runs` has no
writer and no reader anywhere outside the generated types, and `data_sources` is written
only by `scripts/seed-geo.ts` and read by nothing, its last row dated 2026-08-31T18:30Z —
before the cutover. Both still carry public read grants, so they read as live surface to
anyone reviewing the schema. The checklist can proceed for them.

## 3. Product surface

- **R2 growth and R5 observation-ended** shipped in #122. Growth
  requires doubling area or FRP against the last notification and a 45-minute interval.
  End messages use the actual active-to-contained observation event and explicitly do not
  declare extinction or safety. Both use `alerts.kind='fire'` with a payload phase.
- **Citizen reports** strip Exif before upload (`src/lib/image-metadata.ts`), which also
  narrows accepted photos to JPEG and PNG — anything else is refused rather than stored
  unsanitised. The strip runs **in the browser**, so it protects a reporter from leaking their
  own GPS but is not a control against someone who uploads to Storage without it; the bucket
  enforces the size and mime limits server-side, nothing more. Captcha and antivirus scanning
  are still missing. The August inventory recorded 0 reports; these are gaps to close before promoting the
  feature, not a live exposure.
- **Persistent industrial sources are screened** since 2026-08-29. NASA's science-processed
  archive labels 76.8% of Algeria's 1.1M detections (2016–2025) as `type=2` static land
  sources — gas flares, refineries, power plants — and the NRT feeds Nadhir ingests carry no
  such label, so a registry of 567 grid cells in 158 sites is learned offline and applied at
  ingest (`src/lib/ingest/persistent.server.ts`, `data/flares/`). Held out on 2024–25 inside
  the ingest box, it removes **98.4%** of alerting-size false events (1319 → 21) and loses
  **5.5%** of real ones (181 → 171); the losses are almost all inside the Arzew and Skikda
  complexes, peak FRP 19.3 MW. Residual: ~0.9 false alerting events per month and ~5 genuine
  low-intensity events a year. On the live database this resolved 17 clusters as `flare`,
  including Arzew and Skikda, which the confidence model had scored at 0.82 — above the 0.6
  alerting bar, while a genuine new wildfire scores ~0.40.
  Reproduce: `bun run evaluate:sources`.
- **ONM vigilance is relayed** since 2026-08-30: the met office's CAP warnings
  (CC BY 4.0, WMO-registered authority) ingest every pipeline run into
  `onm_vigilance` and display verbatim per wilaya on the forecast page. Honest
  limits: ONM publishes no wildfire event type (heat and wind are the
  fire-relevant channels); titles are English-only in the feed (the per-warning
  CAP XML carries FR/EN, not Arabic); publication cadence is unproven. Health is
  therefore based on successful validated polls, so a quiet weather day is not
  treated as a dead feed.
- **Admin console — implemented.** `/admin` includes fire resolution (`resolve_fire`),
  source-gap replay, risk publication, official-incident editing, moderation queues,
  member tools, place verification and an audit timeline. See `src/lib/admin-*.ts` and
  `src/routes/_authenticated/admin/`. Incident acknowledgement and delivery pause/resume
  shipped in #122; source pause/resume and admin navigation in #125. Production failure
  drills remain part of M5.
- **`/contribute` now has replies.** `IdeaQueue.tsx` calls `replyToIdea` and displays whether
  the reply author is a person or agent. This proves the workflow exists, not that someone
  is monitoring submissions. Voting is anonymous and keyed to a
  `localStorage` value, so clearing storage earns another vote; the UI says the count shows
  interest rather than a number of people. Open-area verification has a column
  (`verified_at`) and an operator action (`verify_open_area`); contributor field verification
  still arrives through moderation rather than a dedicated evidence-submission form.
- **Translation review is a real surface** since 2026-08-30:
  `/contribute/language/<ar|fr|kab>` shows all 671 strings beside their English source,
  accepts a suggestion or a "reads right" confirmation per string, keeps drafts in the
  browser across sessions, and submits in rate-limited batches. Accepting in the moderation
  console records a decision only — `bun run apply:translations <locale>` rewrites the
  locale file and leaves a normal diff, so every word a person is shown still arrives
  through a reviewed commit. Suggestions whose `current_text` no longer matches the file are
  skipped and named rather than applied to changed copy. Kabyle stays out of the language
  pickers until a speaker has been through it.
- **Survival mode** (`/survival`) ships with deliberate limits, each stated in the UI
  rather than papered over: the SOS queue is **local-only** — no server inbox exists
  because nobody would monitor it (§1.3), and the copy says so; quick hazard reports
  reuse the authenticated report flow, so registration delivery limits affect access;
  `open_areas` was seeded on 2026-08-29 (2068 rows from OSM — reproduce:
  `select count(*) from open_areas;`). Recheck `verified_at` before claiming any entry has
  or has not received field verification;
  threat facts inherit §1.4's
  source-dependent detection latency and always display their age; the service worker caches the
  survival shell only; spoken/recorded guidance audio (accessibility for low literacy)
  does not exist yet and must be human-recorded, not TTS.
- **Public API** has no WebSocket and no tiles. What exists is `/api/public/v1/fires`
  (with `?format=geojson`), `/api/public/v1/risk`, `/api/public/v1/stats` and the sanitized
  `/api/public/v1/status`; the risk endpoint takes `?commune=<code>` using
  `admin_units.code`, not a place name.

## 4. Contributing, tooling and licence

### 4.1 Dependency advisories — audit refreshed 2026-09-08

`bun audit --json` still reports five high-severity entries across `brace-expansion`,
`js-yaml` and `nanoid`. Runtime reachability was not rechecked in this reconciliation, so the
older dev-only assessment is not a current bundle guarantee. Trace the dependency paths and
re-audit any proposed lockfile before claiming an upgrade clears these. Open PRs are in §4.5.

### 4.2 Password policy is inconsistent

Supabase Auth accepts a 6-character minimum while the sign-up form asks for 8. The API is the
real boundary, so the effective policy is 6. Captcha is disabled, which combined with §1.2's
2-emails/hour ceiling means a bot could exhaust the project's email quota trivially.

### 4.3 Verification gaps

Current CI requires frozen-lockfile installation, TypeScript, Vitest, lint, and a fresh
Supabase migration/pgTAP run (`.github/workflows/ci.yml`). The August test counts no longer
describe this suite. Tests now also cover atomic risk publication and the admin workflows.
Remaining release evidence includes real channel receipt, partial-send/retry behavior,
operator failure drills and browser journeys; a green unit suite alone cannot establish these.
The held-out screening confusion matrix remains a separate workflow (`screening-gate.yml`).

### 4.4 Hosting needs the Workers Paid plan

React SSR costs more than the Cloudflare free plan's 10 ms CPU budget. On the free plan roughly
70% of page loads return 503 `exceededCpu` while the JSON API and static assets keep returning
200 — that asymmetry is the signature of the CPU limit, not a broken deploy. The paid plan's
default is 50 ms, which is also too low; the deployed limit is set explicitly to 30 s in
`vite.config.ts`.

### 4.5 Open PR review — 2026-09-08

[PR #31](https://github.com/mehdibourahla/fire-watcher-pro/pull/31) is conflicted and still
has changes requested on unchanged head `7255fbad`. Its only successful status is CodeRabbit,
whose comment says automatic review was skipped; there is no passing application CI evidence.
Do not revive the combined patch. FCI WFS ingest, CAP Telegram delivery, local percentiles
and cited Loi reconciliation already exist on main. Remaining useful proposals are separate
per-fire DEM spread research, measured burn-perimeter/fuel recovery, and cited geography open
items (§2.3). The unchanged diff still rotates the shared downwind bearing, uses hard-coded
burn circles and logistic calibration, inserts unsupported `eumetsat_fci`, and polls L1c
`EO:EUM:DAT:0665`. Those are correctness blockers, not rebase chores. Follow the existing
changes-requested review; no PR was closed or modified during this reconciliation.

Eight dependency PRs remain open, all without reviews:

| PR                                                                                       | Observed evidence                                   | Next step                                                                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [#1](https://github.com/mehdibourahla/fire-watcher-pro/pull/1) checkout 7                | `check` and `db-tests` pass; blocked pending review | Refresh against main; verify every checkout caller, including newly added workflows, and runner compatibility. |
| [#117](https://github.com/mehdibourahla/fire-watcher-pro/pull/117) cache 6               | CI passes; changes only screening/refresh workflows | Validate actual cache restore/save; normal CI did not exercise these jobs.                                     |
| [#118](https://github.com/mehdibourahla/fire-watcher-pro/pull/118) create-pull-request 8 | CI passes; changes only monthly registry refresh    | Review permissions/token behavior and the refresh workflow before approval.                                    |
| [#119](https://github.com/mehdibourahla/fire-watcher-pro/pull/119) grouped packages      | Frozen-lockfile install fails                       | Regenerate `bun.lock` on a refreshed branch; test router/SSR/build and Worker bundling.                        |
| [#3](https://github.com/mehdibourahla/fire-watcher-pro/pull/3) Vitest 4                  | Frozen-lockfile install fails                       | Update lockfile, then check test configuration and full suite compatibility.                                   |
| [#4](https://github.com/mehdibourahla/fire-watcher-pro/pull/4) ESLint 10                 | Frozen-lockfile install fails                       | Update lockfile, then validate typescript-eslint and plugin compatibility.                                     |
| [#6](https://github.com/mehdibourahla/fire-watcher-pro/pull/6) Node types 26             | Frozen-lockfile install fails                       | Check Bun/Worker API compatibility; avoid type-checking against unavailable runtime APIs.                      |
| [#7](https://github.com/mehdibourahla/fire-watcher-pro/pull/7) Recharts 3                | Frozen-lockfile install fails                       | Update lockfile, then verify history charts and tooltip behavior.                                              |

All five package PRs change only `package.json`; their logs stop at `bun install
--frozen-lockfile` with “lockfile had changes, but lockfile is frozen”. These are lockfile
failures, not evidence of incompatible upgrades. Fix that first on refreshed branches, then
run the actual CI gates and relevant runtime checks. Green Actions PRs still need review;
none was merged, approved or rebased here.

## 5. Traps

Things that cost real debugging time here, none of them obvious from the code.

- **Migrations.** Two agents adding migrations the same hour produced a duplicate version
  prefix, which the Supabase ledger cannot hold. Applying one with `psql` without inserting a
  row into `supabase_migrations.schema_migrations` silently breaks the next `supabase db push`.
  Check existing versions and the ledger before adding one, and re-check after merging `main`:
  a long-running branch collided twice in one afternoon because everyone picks round-hour
  timestamps. Offset minutes (`…095000`, `…105000`) sidestep it.
- **`main` is protected.** Pull request with a review required; force-push and deletion blocked.
  An admin push still succeeds while printing the rule warning — that output is not an error.
- **Declaring `routes` in the wrangler config flips `workers_dev` to false.** Attaching the
  custom domain silently disabled the old `workers.dev` hostname, which broke a scheduled cron
  that was still pointed at it. Update the `nadhir_app_url` vault secret in the same change.
- **maplibre loads its worker as a sibling file of its own chunk.** Nothing emits that file by
  default; a small plugin in `vite.config.ts` does. Remove it and the map renders blank with no
  console error and no failed request — it simply never asks for a tile.
- **PostgREST truncates at 1000 rows.** Use `fetchAllPages` from `src/lib/paginate.ts` for any
  select that can exceed it. Reads only; `.in()` on update or delete is fine.
- **One GitHub setting is not API-reachable**: Settings → Actions → fork pull request workflows.
  It should require approval for all outside collaborators.
- **`REVOKE ... FROM PUBLIC` does not lock down a Postgres function here.** Supabase grants
  EXECUTE on new public-schema functions to `anon` and `authenticated` through default
  privileges, which a revoke from PUBLIC leaves untouched. `consume_rate_limit` was callable
  by `anon` from 2026-08-28 until 2026-08-30 — enough to exhaust any caller's bucket. Revoke
  from `anon, authenticated` by name, and check with
  `select proname, proacl from pg_proc where proname = '<fn>'`.
- **A source job is split across two runners by `execution_target`.** `local_fwi` and
  `effis` run on GitHub; everything else runs on the Worker. `claim_source_job` filters on
  that column, so a job perfectly visible in `source_jobs` is unclaimable by the scheduler
  you happen to be reading about, and the consumer that _can_ claim it reports success
  when it claimed nothing. Check `execution_target` and the matching workflow before
  concluding a contract is broken, and remember a green _Source jobs (github target)_ run may mean
  the queue was empty, not drained.
- **Freshness computed downstream of a filter stops meaning freshness.** FCI's
  `latestSlot` was assigned after a row was accepted, so once the watch-area gate rejected
  the Saharan majority the feed's `upstream_published_at` only advanced when something was
  alight in the north — a healthy source aged into `stale` in 53 minutes. Any watermark
  read after a `continue` inherits that filter's semantics. The same class bit the map
  (`false_positive` excluded by the API and history, not by `clustersQuery`) and ONM
  (`85/87` forever on one trailing letter). When a signal cannot separate _working and
  quiet_ from _broken_, it is not a signal.
- **The CSP blocked the local-stack workflow this file documents.** `connect-src` allowed only
  `https://*.supabase.co`, so a contributor following CONTRIBUTING.md's `supabase start`
  instructions got a browser that silently refused every call to their own database.
  `src/server.ts` now allows localhost origins in dev only.

## Where to start

| If you want                    | Look at                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| A bounded maintenance PR       | §4.5 refresh one dependency PR and its lockfile            |
| Data engineering               | §2.1 land-cover refresh, §2.3 cited geography open items   |
| Backend with real consequences | §1.3/§2.4 delivery retries and verified channel receipts   |
| Domain science                 | §1.1 percentile validation; §4.5 measured per-fire terrain |
| Ops                            | §1.2 SMTP, §2.4 isolated execution and replay              |

Before changing anything that decides what a user is told, read `ORIGINAL-SPEC.md` for the
intended model and `roadmap.md` for what is already built. The spec is authoritative except on
the wilaya count: Algeria has 69, not the 58 the spec lists, and the code asserts 69 in
`src/lib/__tests__/geo-seed.test.ts`.
