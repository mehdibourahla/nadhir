import http from "node:http";
import type { AddressInfo } from "node:net";

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

export type HealthServerHandle = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function startHealthServer(options: {
  host: string;
  port: number;
  getSnapshot: () => WorkerHealthSnapshot;
  checkDb: () => Promise<boolean>;
}): Promise<HealthServerHandle> {
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

    void options
      .checkDb()
      .then((dbHealthy) => {
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
      })
      .catch(() => {
        sendJson(res, 503, {
          ready: false,
          reason: "db_unavailable",
        });
      });
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
