import { afterEach, describe, expect, it } from "vitest";

import {
  startHealthServer,
  type HealthServerHandle,
  type WorkerHealthSnapshot,
} from "../src/health";

let handle: HealthServerHandle | null = null;

afterEach(async () => {
  if (handle) {
    await handle.close();
    handle = null;
  }
});

describe("worker health server", () => {
  it("serves /healthz and /readyz with 200 healthy, 503 draining/db-down, 404, and 405", async () => {
    let snapshot: WorkerHealthSnapshot = {
      status: "ok",
      workerId: "eu-worker-test",
      uptimeMs: 1234,
      activeJobs: 1,
      targets: ["worker"],
      completedJobs: 5,
      failedJobs: 1,
      lastSchedulerTickAt: "2026-11-24T12:00:00.000Z",
    };
    let dbOk = true;

    handle = await startHealthServer({
      host: "127.0.0.1",
      port: 0,
      getSnapshot: () => snapshot,
      checkDb: async () => dbOk,
    });
    const base = `http://127.0.0.1:${handle.port}`;

    const healthRes = await fetch(`${base}/healthz`);
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toEqual({
      status: "ok",
      workerId: "eu-worker-test",
      uptimeMs: 1234,
      activeJobs: 1,
      targets: ["worker"],
      completedJobs: 5,
      failedJobs: 1,
      lastSchedulerTickAt: "2026-11-24T12:00:00.000Z",
    });

    const readyRes = await fetch(`${base}/readyz`);
    expect(readyRes.status).toBe(200);
    expect(await readyRes.json()).toMatchObject({
      ready: true,
      workerId: "eu-worker-test",
      activeJobs: 1,
    });

    dbOk = false;
    const dbDownRes = await fetch(`${base}/readyz`);
    expect(dbDownRes.status).toBe(503);
    expect(await dbDownRes.json()).toEqual({
      ready: false,
      reason: "db_unavailable",
    });

    dbOk = true;
    snapshot = { ...snapshot, status: "draining", activeJobs: 2 };
    const drainingRes = await fetch(`${base}/readyz`);
    expect(drainingRes.status).toBe(503);
    expect(await drainingRes.json()).toEqual({
      ready: false,
      reason: "draining",
      activeJobs: 2,
    });

    const notFound = await fetch(`${base}/unknown`);
    expect(notFound.status).toBe(404);

    const methodNotAllowed = await fetch(`${base}/healthz`, {
      method: "POST",
    });
    expect(methodNotAllowed.status).toBe(405);
  });

  it("times out stalled /readyz DB probes and returns 503 db_unavailable promptly", async () => {
    const snapshot: WorkerHealthSnapshot = {
      status: "ok",
      workerId: "eu-worker-stalled-db",
      uptimeMs: 100,
      activeJobs: 0,
      targets: ["worker"],
      completedJobs: 0,
      failedJobs: 0,
      lastSchedulerTickAt: null,
    };

    handle = await startHealthServer({
      host: "127.0.0.1",
      port: 0,
      getSnapshot: () => snapshot,
      checkDb: () => new Promise<boolean>(() => {}),
      dbCheckTimeoutMs: 60,
    });

    const t0 = performance.now();
    const res = await fetch(`http://127.0.0.1:${handle.port}/readyz`);
    const elapsedMs = performance.now() - t0;

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ready: false,
      reason: "db_unavailable",
    });
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("resolves health.close() promptly even while a /readyz DB probe is in-flight", async () => {
    const snapshot: WorkerHealthSnapshot = {
      status: "ok",
      workerId: "eu-worker-close-race",
      uptimeMs: 100,
      activeJobs: 0,
      targets: ["worker"],
      completedJobs: 0,
      failedJobs: 0,
      lastSchedulerTickAt: null,
    };
    let resolveProbeStarted!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      resolveProbeStarted = resolve;
    });

    handle = await startHealthServer({
      host: "127.0.0.1",
      port: 0,
      getSnapshot: () => snapshot,
      checkDb: () => {
        resolveProbeStarted();
        return new Promise<boolean>(() => {});
      },
      dbCheckTimeoutMs: 5_000,
    });

    const inFlight = fetch(`http://127.0.0.1:${handle.port}/readyz`).catch(
      () => null,
    );
    await probeStarted;

    const t0 = performance.now();
    await handle.close(80);
    const elapsedMs = performance.now() - t0;
    handle = null;

    await inFlight;
    expect(elapsedMs).toBeLessThan(1_000);
  });
});
