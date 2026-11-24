import { describe, expect, it } from "vitest";

import { loadWorkerConfig } from "../src/config";

const REQUIRED_ENV = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test_key",
};

describe("loadWorkerConfig", () => {
  it("loads defaults and strips trailing slash from SUPABASE_URL", () => {
    const cfg = loadWorkerConfig(REQUIRED_ENV);
    expect(cfg.supabaseUrl).toBe("https://example.supabase.co");
    expect(cfg.supabaseServiceRoleKey).toBe("sb_secret_test_key");
    expect(cfg.executionTargets).toEqual(["worker"]);
    expect(cfg.concurrency).toBe(3);
    expect(cfg.pollIntervalMs).toBe(2_000);
    expect(cfg.schedulerEnabled).toBe(true);
    expect(cfg.schedulerIntervalMs).toBe(30_000);
    expect(cfg.leaseSeconds).toBe(180);
    expect(cfg.jobTimeoutMs).toBe(1_200_000);
    expect(cfg.healthHost).toBe("0.0.0.0");
    expect(cfg.healthPort).toBe(8090);
    expect(cfg.drainTimeoutMs).toBe(30_000);
    expect(cfg.workerId.length).toBeGreaterThan(0);
    expect(cfg.workerId.length).toBeLessThanOrEqual(200);
  });

  it("parses deduplicated multi-target lists and custom bounds", () => {
    const cfg = loadWorkerConfig({
      ...REQUIRED_ENV,
      WORKER_ID: "eu-fra-1",
      WORKER_EXECUTION_TARGETS: "worker, github, worker, cloudflare",
      WORKER_CONCURRENCY: "4",
      WORKER_POLL_INTERVAL_MS: "500",
      WORKER_SCHEDULER_ENABLED: "false",
      WORKER_SCHEDULER_INTERVAL_MS: "5000",
      WORKER_LEASE_SECONDS: "120",
      WORKER_JOB_TIMEOUT_MS: "60000",
      WORKER_HEALTH_HOST: "127.0.0.1",
      WORKER_HEALTH_PORT: "0",
      WORKER_DRAIN_TIMEOUT_MS: "10000",
    });

    expect(cfg.workerId).toBe("eu-fra-1");
    expect(cfg.executionTargets).toEqual(["worker", "github", "cloudflare"]);
    expect(cfg.concurrency).toBe(4);
    expect(cfg.pollIntervalMs).toBe(500);
    expect(cfg.schedulerEnabled).toBe(false);
    expect(cfg.schedulerIntervalMs).toBe(5_000);
    expect(cfg.leaseSeconds).toBe(120);
    expect(cfg.jobTimeoutMs).toBe(60_000);
    expect(cfg.healthHost).toBe("127.0.0.1");
    expect(cfg.healthPort).toBe(0);
    expect(cfg.drainTimeoutMs).toBe(10_000);
  });

  it("fails fast on missing required env vars or invalid bounds", () => {
    expect(() => loadWorkerConfig({})).toThrow("SUPABASE_URL is required");
    expect(() =>
      loadWorkerConfig({
        SUPABASE_URL: "ftp://bad.example",
        SUPABASE_SERVICE_ROLE_KEY: "key",
      }),
    ).toThrow("http or https");
    expect(() =>
      loadWorkerConfig({
        SUPABASE_URL: "https://admin:supersecret@example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "key",
      }),
    ).toThrow("embedded credentials");
    expect(() =>
      loadWorkerConfig({
        SUPABASE_URL: "https://admin@example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "key",
      }),
    ).toThrow("embedded credentials");
    expect(() =>
      loadWorkerConfig({ SUPABASE_URL: "https://example.supabase.co" }),
    ).toThrow("SUPABASE_SERVICE_ROLE_KEY is required");
    expect(() =>
      loadWorkerConfig({
        ...REQUIRED_ENV,
        WORKER_EXECUTION_TARGETS: "worker,unknown",
      }),
    ).toThrow("Invalid execution target");
    expect(() =>
      loadWorkerConfig({ ...REQUIRED_ENV, WORKER_CONCURRENCY: "99" }),
    ).toThrow("WORKER_CONCURRENCY");
    expect(() =>
      loadWorkerConfig({ ...REQUIRED_ENV, WORKER_LEASE_SECONDS: "10" }),
    ).toThrow("WORKER_LEASE_SECONDS");
    expect(() =>
      loadWorkerConfig({ ...REQUIRED_ENV, WORKER_SCHEDULER_ENABLED: "yes" }),
    ).toThrow("WORKER_SCHEDULER_ENABLED");
    expect(() =>
      loadWorkerConfig({ ...REQUIRED_ENV, WORKER_ID: "x".repeat(201) }),
    ).toThrow("WORKER_ID");
  });
});
