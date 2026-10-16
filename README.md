# Nadhir (نذير)

Local hazards and alerts for Algeria. _Nadhir_ is Arabic for "the one who warns".

Nadhir brings together weather forecasts, satellite fire observations, fire danger and
clearly attributed official warnings near chosen locations. The interface is available
in Arabic (default, RTL), French and English; Kabyle remains withheld pending speaker review.
Hourly Open-Meteo evidence covers a 48-hour horizon independently of ONM warnings and FWI.
The live map combines satellite fire observations, official incidents, ONM warnings and
citizen hazard reports, with area search and attributed details. Model forecasts do not
trigger new emergency broadcasts. Fire detail pages and Survival Mode remain fire-specific;
Survival Mode is not flood guidance.

> **Nadhir is not an official source.** It is not a government warning system and must not
> be presented as one. Detections are satellite estimates with real false-positive and
> latency characteristics; see the limitations below before relying on any of it.

## Data sources

| Source                                          | State                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| NASA FIRMS (SNPP, NOAA-20, NOAA-21, MODIS)      | connected, ingesting                                                                                           |
| NASA FIRMS science archive (`VIIRS_SNPP_SP`)    | source of the persistent-industrial-source registry — its `type` label is absent from the near-real-time feeds |
| Open-Meteo (weather, fire-weather index, winds) | connected                                                                                                      |
| OpenStreetMap (admin boundaries, settlements)   | seeded from `data/geo/`, ODbL                                                                                  |
| EUMETSAT MTG FCI                                | connected — fire-radiative-power points from EUMETSAT's public WFS ingest every 10 minutes                     |
| EFFIS / GWIS                                    | connected — daily danger-class comparison sampled from the EFFIS WMS                                           |
| Copernicus Sentinel-3 SLSTR                     | ingested through EUMETSAT's public WFS                                                                         |
| ONM                                            | official weather warnings from its vigilance RSS feed, attributed separately from model forecasts              |
| Protection Civile (DGPC)                        | official incidents from its public Telegram bulletins, preserving source attribution                           |

Geography is 69 wilayas, 1536 communes and 10257 settlements, taken from OpenStreetMap via
Overpass rather than geoBoundaries or GADM — those have incomplete Algerian ADM2 coverage.

## Stack

TanStack Start (SSR React) with TypeScript and Tailwind, on Supabase Postgres. Source work
runs as isolated per-contract jobs from a durable Postgres queue. Cloudflare Workers consumes
short jobs; GitHub Actions consumes the CPU-heavy daily FWI and EFFIS jobs. Geometry is stored
as plain lat/lon columns instead of PostGIS (ADR-001), so distance work happens in application
code.

Package manager is **bun**, not npm — the lockfile is `bun.lock` and every script below
assumes it.

## Running locally

```sh
bun install
cp .env.example .env.local   # ships working public values — nothing to fill
bun run dev                  # http://localhost:8080
```

The dev server listens on **8080**, not vite's usual 5173; the port is set explicitly in
`vite.config.ts`.

Only the Supabase URL and publishable key are needed to boot the UI. The service-role key
and ingestion credentials (`FIRMS_MAP_KEY`, `EUMETSAT_CONSUMER_KEY/SECRET`) are server-side
only and are needed just for ingestion. Every stage reports a structured outcome to the private,
append-only `source_runs` ledger; the public `source_health` view derives freshness, coverage and
availability without exposing credentials or raw errors. Missing credentials fail that source's
contract with an allow-listed public reason instead of exposing a mutable raw-error note.

### Database

Migrations live in `supabase/migrations/`. Before running `supabase db push`,
check that `supabase/config.toml` names the project you actually mean — a stale ref there
sends migrations to the wrong database, and CLI errors quote the stale id rather than the
linked one. `supabase/.temp/linked-project.json` is the real link target.

Seed geography once the schema is up:

```sh
bun run seed:geo            # add --prune to drop units no longer in data/geo/
```

## Commands

| Command                                                                          | Purpose                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `bun run dev`                                                                    | dev server on :8080                                                                                    |
| `bun run build`                                                                  | production build                                                                                       |
| `bun run cap:sync`                                                               | build the Android/iOS bundle (`build:native`) and copy it into `android/` and `ios/` (ADR-0005)        |
| `bun run test`                                                                   | vitest suite                                                                                           |
| `bun run lint`                                                                   | eslint                                                                                                 |
| `bun run format`                                                                 | prettier                                                                                               |
| `bun run seed:geo`                                                               | reseed admin units and settlements from `data/geo/`                                                    |
| `bun run bootstrap:fwi`                                                          | fill `fwi_state` for communes that have none                                                           |
| `bun run source:job -- --target ...`                                             | consume at most one queued job for the named execution tier                                            |
| `bun run replay:source -- <gap-uuid>`                                            | enqueue one previously recorded gap for replay                                                         |
| `bun run replay:window -- --data <dir> --tag <tag> --from <iso> --through <iso>` | replay ingest → fusion → broadcast planning offline over a cached window (see `data/replay/README.md`) |

## How it fits together

Detections arrive from FIRMS and FCI, then independent jobs screen persistent heat sources,
cluster accepted points into `fire_clusters`, enrich wind, publish broadcasts, deliver them,
and evaluate alert rules. Separately, daily jobs pull weather per commune, advance the Canadian
Forest Fire Weather Index, and ingest the EFFIS comparator. A separate collector refreshes
48-hour Open-Meteo weather forecasts every six hours. Dependencies are explicit in the
queue, so an optional-source failure does not consume another contract's lease or retry budget.

The FWI codes are **stateful**: yesterday's fuel-moisture codes are persisted in `fwi_state`
so each run advances one day instead of re-fetching months of history. This matters because
the drought code has a ~52-day time constant, so a commune with no stored state needs a
92-day spin-up — roughly a hundred times the weather-API cost of a normal daily run. Bootstrapping
a fresh commune set is therefore rate-limited by the Open-Meteo free tier, which is what
`bootstrap:fwi` exists to work around: it retries in passes, and progress is durable because
each batch is flushed as it completes.

Supabase cron and Cloudflare's minute Cron Trigger independently enqueue the same normalized
contract slots. A unique contract/slot key makes duplicate triggers harmless. Cloudflare
dispatches bounded one-job Worker requests; expired leases are recovered in Postgres. An
independent GitHub Actions watchdog reads the private queue view twice an hour. A watchdog
failure means the database has evidence of a breached contract—such as a late job, expired lease,
or missing run—not that it has inferred which process failed. Retries are bounded by each
contract's attempt count and usefulness window. Gaps are recorded durably. FIRMS, FCI and EFFIS gaps
inside their provider retention windows can be replayed exactly, only by ID, through
`bun run replay:source -- <gap-uuid>`; terminal gaps for other contracts are marked unrecoverable.
Current-only jobs never run a fresh payload against an old interval: older queued slots are
audited as unrecoverable, and the FWI/EFFIS consumers drain through the newest useful job. A
not-yet-available retry keeps its consumer polling; once its usefulness window closes, it is
terminalized and audited in bounded maintenance batches instead of being executed late. A gap is
offered for replay only while the provider can still serve its recorded interval.

A public read API is exposed at `/api/public/v1/fires`, `/api/public/v1/risk`,
`/api/public/v1/stats` and `/api/public/v1/status`. The status endpoint is the same sanitized,
server-derived health model used by the UI. The risk endpoint takes `?commune=<code>` — the
`admin_units.code` value, not a place name. Fires also serve GeoJSON with `?format=geojson`.

## Deployment

Runs on Cloudflare Workers, built by nitro's `cloudflare-module` preset. The worker name is
set in `vite.config.ts`; nitro regenerates `.output/server/wrangler.json` on every build, so
edits there are lost.

```sh
bun run build
bunx wrangler deploy
```

Live at <https://nadhir.app> (plus `www`). The custom domains are declared as `routes` in
`vite.config.ts`, so Cloudflare re-attaches them on every deploy and issues the certificate
itself — there are no DNS records to add.

Declaring `routes` also flips wrangler's `workers_dev` default to false, so
`nadhir.mehdibrhl4.workers.dev` now returns 404 (Cloudflare error 1042). That is deliberate:
scheduled Worker dispatch uses the canonical `NADHIR_APP_URL` configured in `vite.config.ts`.

**This needs the Workers Paid plan.** React SSR costs more than the free plan's 10ms CPU
budget, so on the free plan roughly 70% of page loads return 503 `exceededCpu` while the JSON
API and static assets — which never render React — keep returning 200. That asymmetry is the
signature of the CPU limit rather than a broken deploy.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are baked into the client bundle at
build time. Everything else is a runtime secret set with `wrangler secret put <NAME>`:
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FIRMS_MAP_KEY`,
`EUMETSAT_CONSUMER_KEY`, `EUMETSAT_CONSUMER_SECRET`, `NADHIR_CRON_SECRET`.

`NADHIR_CRON_SECRET` authenticates only the private one-job execution route. There are no
`/api/public/cron/*` execution endpoints. `source_jobs`, `source_job_leases`, `source_gaps`,
raw runs, and replay controls are service-role-only.

The daily FWI and EFFIS jobs are CPU-bound, so they run on GitHub Actions
(`.github/workflows/source-jobs-github.yml`). `private.dispatch_github_source_jobs()` runs from pg_cron every minute and fires a
`repository_dispatch` for each due `github`-target job (GitHub's own `schedule` trigger is kept only
as a best-effort fallback — it delivered 1 of 12 firings on 2026-09-01), using the Vault secrets
`github_dispatch_token` (a fine-grained PAT with Contents: read/write on this repository) and
`github_repo` (`owner/name`). The workflow can still be dispatched by hand with a contract key,
which remains the fastest way to fill `fwi_state` for a new commune set.

## Known limitations

Nadhir is a working data platform with an honest status page; it is **not yet a safe warning
service**. The full, evidence-checked list is in **[GAPS.md](GAPS.md)** — start there if you
want to contribute. The blockers that matter most:

- **Weather danger is not a complete fire-risk model.** Fuel-limited communes are masked and
  local FWI percentiles now accompany the absolute scale; reference-data validation and
  land-cover refresh remain important. The old late-August Extreme percentage was seasonal,
  not proof of broken FWI arithmetic.
- **Registration has worked; email delivery still needs operational validation.** The dated
  SMTP/account observations in GAPS are not a current capacity guarantee.
- **Broadcast delivery exists, but reliability work remains.** Telegram has recorded live
  sends and its current public policy is DGPC official relays only. FCM has an accountless
  subscription path, with a device receipt measured since #177. Durable destination receipts
  deployed in #121. Independent queues and operator controls shipped in #122 and #125;
  per-user zone email/SMS still needs a provider and verified recipients.
- **Cross-border fires are watched but coarsely placed.** Detections in the Moroccan and
  Tunisian border strips are ingested and shown with coordinates rather than an Algerian
  commune name, but nothing yet says which country they are in.
- **No sub-5-minute detection.** The geostationary FCI WFS feed is ingested every 10 minutes,
  with roughly 25 minutes of upstream publication latency. Meeting the original target needs
  the Data Store push subscription plus a decode worker.
- **Gas flares are screened, not perfectly.** 77% of Algeria's satellite fire detections are
  permanent industrial heat sources. A registry learned from NASA's own labels removes 98.4%
  of alerting-size false fires, at the cost of 5.5% of real ones — almost all of them small
  fires inside refinery grounds. Screened detections stay in the database. The industrial
  source registry remains available at `/api/public/v1/sources`; the live map does not
  display an industrial heat-source layer.

## Contributing

Issues and pull requests are welcome — [CONTRIBUTING.md](CONTRIBUTING.md) has the
two-minute no-secrets setup and the access tiers. [GAPS.md](GAPS.md) lists every known gap
with source pointers; its current priorities and open-PR review distinguish implemented
features from remaining validation. The "Where to start" table maps interests to tasks.

CI runs `tsc --noEmit`, the test suite and eslint on every pull request, and `main` requires a
reviewed pull request — pushes straight to it are blocked. Run `bun run format` before opening
one; prettier is enforced through eslint.

Before changing anything that decides what a user is told, read `ORIGINAL-SPEC.md` for the
intended model. It is authoritative except on the wilaya count — Algeria has 69, not the 58
the spec lists.

## Licence

The application declares its code AGPL-3.0 and its derived data CC-BY 4.0, with attribution
to "Nadhir — NASA FIRMS, Open-Meteo". Source data stays under the licences of NASA FIRMS,
EUMETSAT, Copernicus, Open-Meteo and OpenStreetMap.

The full AGPL-3.0 text is in [LICENSE](LICENSE).
