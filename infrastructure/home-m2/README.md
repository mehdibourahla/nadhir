# Nadhir model gateway on home-m2

Every Nadhir model call (citizen-report screening, ITA and DGPC extraction, the civil
agent) goes to `POST /v1/complete` on this gateway. The gateway is the only holder of
Nadhir's own ChatGPT login and calls gpt-6-luna on the owner's plan. Cloudflare Workers
cannot reach chatgpt.com, so the gateway runs at home behind a Cloudflare Tunnel with
Cloudflare Access in front of it.

```
Worker / GitHub runner ──HTTPS + Access service token──▶ Cloudflare Access
    ──▶ tunnel ──▶ cloudflared ──(compose network)──▶ gateway:8080 ──▶ chatgpt.com
```

The compose project `nadhir-gateway` has its own network and volume and publishes no host
port. The gateway container has a read-only root filesystem; its only writable path is the
`nadhir-gateway-token` volume holding the grant (`/token/login.json`, mode 600).

## The grant rule

The ChatGPT account is shared with SanoX, which stops at 80% of weekly use. Nadhir has its
**own** device login. The refresh token rotates on every refresh, so two holders of one
grant kill it.

- Never reuse `~/.codex`, SanoX's login or any other app's grant.
- Never copy `/token/login.json` or the `nadhir-gateway-token` volume to another host or
  into a backup. To move hosts, run a fresh login on the new host and delete the old volume.
- Never paste a token into an issue, a log or a chat.

Per-purpose ceilings on the plan's usage headers: `civil_agent_step` stops at 60%,
`extract_ita` at 75%, and `classify_report`, `extract_dgpc` and `dgpc_situation` at 90%.

## 1. Cloudflare (owner, once)

1. **Tunnel.** Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared, named
   `nadhir-gateway`. Copy the tunnel token. Add a public hostname, for example
   `gateway.nadhir.app`, with service `http://gateway:8080`.
2. **Service token.** Zero Trust → Access → Service credentials → Service tokens → Create,
   named `nadhir-gateway`. Copy the Client ID and Client Secret; the secret is shown once.
3. **Access application.** Access → Applications → Add → Self-hosted, for the same
   hostname. Add one policy with action **Service Auth** that includes the service token
   above, and nothing else. From the application's overview, copy the **Application
   Audience (AUD) tag**. The team domain is `<team>.cloudflareaccess.com`.

## 2. Deploy (owner, on home-m2)

```sh
git clone https://github.com/mehdibourahla/nadhir.git && cd nadhir   # or git pull
infrastructure/home-m2/write-secrets.sh    # prompts silently for each value
docker compose -f infrastructure/home-m2/docker-compose.yml up -d --build
```

`write-secrets.sh` writes `.env.gateway` (Access client ID and secret, team domain, AUD)
and `.env.tunnel` (`TUNNEL_TOKEN`) next to the compose file, mode 600. Both names are
git-ignored. Access strips the service-token headers before the origin, so with the team
domain and AUD set the gateway verifies only the `Cf-Access-Jwt-Assertion`, whose
`common_name` must be this service token's client ID; the secret is then unused.

## 3. One-time login (owner, on home-m2)

```sh
export CODEX_HOME=$(mktemp -d)
npx -y @openai/codex login --device-auth    # open the printed URL, enter the code
docker compose -f infrastructure/home-m2/docker-compose.yml \
  run --rm -T gateway bun gateway/login.ts - < "$CODEX_HOME/auth.json"
rm -rf "$CODEX_HOME"
```

The helper writes the grant into the volume under the same lock the gateway uses, prints
only the file path, and never prints a token. Run it again whenever `/health` says
`login: "expired"` or `"missing"`.

## 4. Health check

```sh
curl -s https://gateway.nadhir.app/health \
  -H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET"
```

The reply holds `ok`, `login` (`present`, `stale`, `missing`, `expired`, `unreadable`),
`paused_until` and the last seen usage windows, never a token. Without the service token,
Access refuses the request; if it reaches the gateway, the gateway answers 401.
On the host: `docker compose -f infrastructure/home-m2/docker-compose.yml ps` and `logs gateway`.
Logs carry purposes, reason codes and timings only, never prompts or model text.

## 5. Nadhir's callers (owner, once)

Set the same three values for the Worker (`bunx wrangler secret put <NAME> --name nadhir`)
and as GitHub Actions secrets for the source-job runners:

- `NADHIR_GATEWAY_URL`: `https://gateway.nadhir.app`
- `NADHIR_GATEWAY_ACCESS_CLIENT_ID`
- `NADHIR_GATEWAY_ACCESS_CLIENT_SECRET`

## 6. Rotate

- **Service token:** create a new token, add it to the Access policy, update the Worker and
  GitHub secrets, rerun `write-secrets.sh`, `docker compose up -d`, then delete the old
  token from Access.
- **Tunnel token:** refresh it in the tunnel's settings, rerun `write-secrets.sh`, then
  `docker compose up -d`.
- **ChatGPT grant:** repeat step 3; the new grant replaces the old one in place. To revoke
  it, sign out that device session from ChatGPT's security settings.
- **Update the gateway:** `git pull && docker compose ... up -d --build`. The grant volume
  survives rebuilds.
