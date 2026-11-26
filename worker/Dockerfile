# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    WORKER_HEALTH_HOST=0.0.0.0 \
    WORKER_HEALTH_PORT=8090

RUN addgroup -S nadhir && adduser -S -G nadhir nadhir

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY worker ./worker

USER nadhir
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:' + (process.env.WORKER_HEALTH_PORT ?? '8090') + '/healthz'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "run", "worker/src/index.ts"]
