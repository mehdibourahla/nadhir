# Nadhir Always-On EU Backend Worker

Standalone Bun/TypeScript ingestion worker that consumes Postgres `source_jobs` continuously from an EU host (e.g. Hetzner Falkenstein/Helsinki or Fly.io `fra`/`cdg`), eliminating:

1. The 720-runs/day GitHub Actions runner for `ita_facebook` (and scheduled GitHub Actions runs for `ita_website`, `dgpc_telegram`, `local_fwi`, and `effis`).
2. The single-point-of-failure dependency on `home-m2` by pairing directly with Nadhir's automatic LLM API fallback (`src/lib/llm/fallback.server.ts`).

Cloudflare Workers + R2 remain unchanged for public SSR, API endpoints, share cards, and fast edge-scheduled contracts (`execution_target = 'cloudflare'`).

## Architecture

- **Queue consumption**: Runs `WORKER_CONCURRENCY` independent async slots calling `public.claim_source_job(workerId, target)` for `WORKER_EXECUTION_TARGETS` (default `worker`). Postgres enforces at most one active lease per `contract_key`, so multiple contracts (`ita_facebook`, `ita_website`, `dgpc_telegram`, `local_fwi`, `effis`) run concurrently without interfering with each other.
- **Scheduler + stale-lease recovery**: Every `WORKER_SCHEDULER_INTERVAL_MS` (default 30s), calls `public.enqueue_due_source_jobs(now, 'worker')` and `public.requeue_expired_source_jobs(now)`. Dual-scheduling with `pg_cron` (`database`) and Cloudflare Cron (`cloudflare`) is idempotent on `(contract_key, scheduled_for)`.
- **Lease heartbeat & graceful drain**: Active jobs renew their Postgres lease via `public.renew_source_job_lease` every `leaseSeconds / 3`. On `SIGTERM`/`SIGINT`, `/readyz` flips to HTTP `503 { ready: false, reason: "draining" }`, no new jobs are claimed, and in-flight jobs finish and call `complete_source_job` within `WORKER_DRAIN_TIMEOUT_MS`.
- **Automatic LLM API fallback**: All LLM-backed jobs (`ita_website`, `dgpc_telegram`, civil investigations, report classification) route through `src/lib/llm/gateway.server.ts`. When `NADHIR_GATEWAY_URL` (`home-m2`) is unset, unreachable, paused, rate-limited, timed out, or returning 5xx, requests automatically fail over to the configured EU/cloud LLM API (`LLM_FALLBACK_*`) without quarantining documents.

## Environment Variables

| Variable                              | Required | Default                  | Description                                                                         |
| ------------------------------------- | -------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `SUPABASE_URL`                        | Yes      | —                        | Supabase project URL (`https://...`)                                                |
| `SUPABASE_SERVICE_ROLE_KEY`           | Yes      | —                        | Service role key (never logged)                                                     |
| `WORKER_ID`                           | No       | `eu-worker:<host>:<pid>` | Unique lease worker identifier (1–200 chars)                                        |
| `WORKER_EXECUTION_TARGETS`            | No       | `worker`                 | Comma-separated subset of `worker,github,cloudflare`                                |
| `WORKER_CONCURRENCY`                  | No       | `3`                      | Concurrent job slots (`1..16`)                                                      |
| `WORKER_POLL_INTERVAL_MS`             | No       | `2000`                   | Idle poll interval in ms (`200..60000`)                                             |
| `WORKER_SCHEDULER_ENABLED`            | No       | `true`                   | Run periodic enqueue + expired-lease recovery                                       |
| `WORKER_SCHEDULER_INTERVAL_MS`        | No       | `30000`                  | Scheduler tick interval in ms (`1000..300000`)                                      |
| `WORKER_LEASE_SECONDS`                | No       | `180`                    | Lease renewal extension in seconds (`30..3600`)                                     |
| `WORKER_JOB_TIMEOUT_MS`               | No       | `1200000`                | Per-job execution ceiling in ms (`1000..3600000`)                                   |
| `WORKER_HEALTH_HOST`                  | No       | `0.0.0.0`                | Health HTTP bind host                                                               |
| `WORKER_HEALTH_PORT`                  | No       | `8090`                   | Health HTTP bind port (`0..65535`)                                                  |
| `WORKER_DRAIN_TIMEOUT_MS`             | No       | `30000`                  | Graceful shutdown drain ceiling in ms                                               |
| `NADHIR_GATEWAY_URL`                  | No       | —                        | Optional primary home gateway URL                                                   |
| `NADHIR_GATEWAY_ACCESS_CLIENT_ID`     | No       | —                        | Optional Cloudflare Access client ID                                                |
| `NADHIR_GATEWAY_ACCESS_CLIENT_SECRET` | No       | —                        | Optional Cloudflare Access client secret                                            |
| `LLM_FALLBACK_PROVIDER`               | No       | —                        | `mistral` (EU default), `openai`, `openrouter`, `openai-compatible`, or `anthropic` |
| `LLM_FALLBACK_API_URL`                | No       | preset                   | Explicit API URL (optional when using a preset provider)                            |
| `LLM_FALLBACK_API_KEY`                | No       | —                        | Fallback LLM API key                                                                |
| `LLM_FALLBACK_MODEL`                  | No       | —                        | Fallback model name (e.g. `mistral-small-latest`)                                   |
| `LLM_FALLBACK_TIMEOUT_MS`             | No       | policy                   | Optional per-request fallback timeout cap (`1000..120000`)                          |
| `LLM_FALLBACK_MAX_RETRIES`            | No       | `0`                      | Optional bounded per-provider retry count (`0..2`)                                  |
| `LLM_FALLBACK_HEADERS`                | No       | —                        | Optional JSON map of extra headers (e.g. OpenRouter headers)                        |
| `LLM_FALLBACK_CHAIN`                  | No       | —                        | Optional JSON array of ordered fallback providers (overrides single vars)           |

## Deployment Options

### 1. Docker Compose on an EU VPS (Hetzner Falkenstein / Helsinki / Scaleway)

```bash
# Copy and populate secrets outside git
cp .env.example /etc/nadhir/worker.env
chmod 600 /etc/nadhir/worker.env

# Build and run always-on container
docker compose -f worker/docker-compose.eu.yml --env-file /etc/nadhir/worker.env up -d --build
```

Verify liveness and readiness locally on the host:

```bash
curl -sf http://127.0.0.1:8090/healthz
curl -sf http://127.0.0.1:8090/readyz
```

### 2. Fly.io (`fra` / `cdg`)

Use `worker/Dockerfile` with `primary_region = "fra"`, `min_machines_running = 1`, HTTP health checks against `/healthz` and `/readyz` on port `8090`, and store `SUPABASE_SERVICE_ROLE_KEY` and `LLM_FALLBACK_API_KEY` via `fly secrets set`.

### 3. Bare-Metal `systemd` Unit (Bun 1.3.14)

```ini
[Unit]
Description=Nadhir EU Backend Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nadhir
WorkingDirectory=/opt/nadhir
EnvironmentFile=/etc/nadhir/worker.env
ExecStart=/usr/local/bin/bun run worker/src/index.ts
Restart=always
RestartSec=5
TimeoutStopSec=35
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

## Operational Notes

- **Monitoring**: `scripts/external-watchdog.ts` reads `public.source_watchdog` across all enabled scheduled contracts, including `execution_target = 'worker'`. Point uptime probes at `/healthz` (process liveness) and `/readyz` (DB reachability + drain state).
- **Facebook Egress (`ita_facebook`)**: Datacenter EU IPs may occasionally encounter Facebook login walls. The worker's 2-minute cadence and transient backoff retry handle intermittent walls automatically; if sustained walls occur on a VPS IP, configure `HTTP_PROXY` / `HTTPS_PROXY` toward a clean EU egress IP.
- **Local Verification**: Run `bun run test:worker:integration` against a local Supabase Postgres instance (`supabase start ... && supabase db reset`) to verify queue consumption, `ita_facebook` persistence, retries, lease renewal, graceful drain, and LLM fallback end-to-end.
