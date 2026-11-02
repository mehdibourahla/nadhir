#!/usr/bin/env bash
# Prompts for each secret the gateway and its tunnel need and writes them, owner-only,
# next to docker-compose.yml. Values are read silently and never echoed or logged.
set -euo pipefail
cd "$(dirname "$0")"
umask 077

ask() {
  local name="$1" value
  read -r -s -p "$name: " value
  echo >&2
  if [ -z "$value" ]; then
    echo "$name is required" >&2
    exit 1
  fi
  printf '%s=%s\n' "$name" "$value"
}

optional() {
  local name="$1" value
  read -r -s -p "$name (optional, Enter to skip): " value
  echo >&2
  printf '%s=%s\n' "$name" "$value"
}

{
  ask NADHIR_GATEWAY_ACCESS_CLIENT_ID
  ask NADHIR_GATEWAY_ACCESS_CLIENT_SECRET
  optional NADHIR_GATEWAY_ACCESS_TEAM_DOMAIN
  optional NADHIR_GATEWAY_ACCESS_AUD
} > .env.gateway.new
mv .env.gateway.new .env.gateway

ask TUNNEL_TOKEN > .env.tunnel.new
mv .env.tunnel.new .env.tunnel

chmod 600 .env.gateway .env.tunnel
echo "wrote .env.gateway and .env.tunnel (mode 600)" >&2
