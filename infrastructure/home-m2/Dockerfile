# Build from the repository root:
#   docker compose -f infrastructure/home-m2/docker-compose.yml build
FROM oven/bun:1.3.14-alpine

WORKDIR /app
# the gateway has no dependencies beyond Bun and the repo's plan client
COPY src/lib/llm/codex.server.ts src/lib/llm/codex-login.server.ts src/lib/llm/codex-device-login.ts src/lib/llm/
COPY gateway/auth.ts gateway/gateway.ts gateway/login.ts gateway/policy.ts gateway/server.ts gateway/token-file.ts gateway/

RUN mkdir -m 700 /token && chown bun:bun /token
USER bun
ENV NODE_ENV=production \
    NADHIR_GATEWAY_PORT=8080 \
    NADHIR_GATEWAY_TOKEN_FILE=/token/login.json
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "gateway/server.ts"]
