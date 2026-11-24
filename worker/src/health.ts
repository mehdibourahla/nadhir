import http from "node:http";
import type { AddressInfo, Socket } from "node:net";

import type { SourceExecutionTarget } from "@/lib/source-jobs";

export type WorkerHealthSnapshot = {
  status: "ok" | "draining";
  workerId: string;
  uptimeMs: number;
  activeJobs: number;
  targets: readonly SourceExecutionTarget[];
  completedJobs: number;
  failedJobs: number;
  lastSchedulerTickAt: string | null;
};

export type HealthServerOptions = {
  host: string;
  port: number;
  getSnapshot: () => WorkerHealthSnapshot;
  checkDb: () => Promise<boolean>;
  dbCheckTimeoutMs?: number | undefined;
};

export type HealthServerHandle = {
  port: number;
  host: string;
  close: (timeoutMs?: number) => Promise<void>;
};

const DEFAULT_DB_CHECK_TIMEOUT_MS = 3_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  if (res.writableEnded || res.destroyed) return;
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function runBoundedDbCheck(
  checkDb: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve()
      .then(() => checkDb())
      .then((healthy) => Boolean(healthy))
      .catch(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export async function startHealthServer(
  options: HealthServerOptions,
): Promise<HealthServerHandle> {
  const dbCheckTimeoutMs = Math.max(
    50,
    options.dbCheckTimeoutMs ?? DEFAULT_DB_CHECK_TIMEOUT_MS,
  );
  const sockets = new Set<Socket>();

  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const pathname = (req.url ?? "/").split("?")[0] ?? "/";

    if (pathname !== "/healthz" && pathname !== "/readyz") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const snapshot = options.getSnapshot();

    if (pathname === "/healthz") {
      sendJson(res, 200, {
        status: snapshot.status,
        workerId: snapshot.workerId,
        uptimeMs: snapshot.uptimeMs,
        activeJobs: snapshot.activeJobs,
        targets: [...snapshot.targets],
        completedJobs: snapshot.completedJobs,
        failedJobs: snapshot.failedJobs,
        lastSchedulerTickAt: snapshot.lastSchedulerTickAt,
      });
      return;
    }

    if (snapshot.status === "draining") {
      sendJson(res, 503, {
        ready: false,
        reason: "draining",
        activeJobs: snapshot.activeJobs,
      });
      return;
    }

    void runBoundedDbCheck(options.checkDb, dbCheckTimeoutMs).then(
      (dbHealthy) => {
        if (!dbHealthy) {
          sendJson(res, 503, {
            ready: false,
            reason: "db_unavailable",
          });
          return;
        }
        sendJson(res, 200, {
          ready: true,
          workerId: snapshot.workerId,
          activeJobs: snapshot.activeJobs,
          lastSchedulerTickAt: snapshot.lastSchedulerTickAt,
        });
      },
    );
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  const boundPort = address?.port ?? options.port;
  const boundHost = address?.address ?? options.host;

  return {
    port: boundPort,
    host: boundHost,
    close: (timeoutMs: number = DEFAULT_CLOSE_TIMEOUT_MS) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(forceTimer);
          resolve();
        };

        const forceTimer = setTimeout(
          () => {
            server.closeAllConnections?.();
            for (const socket of sockets) {
              socket.destroy();
            }
            finish();
          },
          Math.max(0, timeoutMs),
        );
        if (typeof forceTimer === "object" && "unref" in forceTimer) {
          forceTimer.unref();
        }

        server.close(() => {
          finish();
        });
        server.closeIdleConnections?.();
      }),
  };
}
