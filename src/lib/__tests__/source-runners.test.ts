import { describe, expect, it, vi } from "vitest";

import type { ClaimedSourceJob } from "@/lib/source-jobs";
import {
  createSourceRunners,
  RUNTIME_CONTRACT_KEYS,
  type SourceRunnerDependencies,
} from "@/lib/ingest/source-runners.server";

const job = (contractKey: string): ClaimedSourceJob => ({
  id: `job-${contractKey}`,
  contract_key: contractKey,
  contract_version: 1,
  trigger_kind: "scheduled",
  idempotency_key: `scheduled:${contractKey}:2026-08-31T20:00:00Z`,
  scheduled_for: "2026-08-31T20:00:00.000Z",
  data_from: "2026-08-31T19:50:00.000Z",
  data_through: "2026-08-31T20:00:00.000Z",
  dispatched_at: null,
  execution_target: "cloudflare",
  state: "running",
  enqueued_by: ["database"],
  available_at: "2026-08-31T20:00:00.000Z",
  attempt_count: 1,
  max_attempts: 3,
  retry_base_seconds: 30,
  retry_until: "2026-08-31T20:30:00.000Z",
  gap_id: null,
  started_at: "2026-08-31T20:00:01.000Z",
  finished_at: null,
  last_error_at: null,
  last_public_reason_code: null,
  created_at: "2026-08-31T20:00:00.000Z",
  updated_at: "2026-08-31T20:00:01.000Z",
});

function dependencies() {
  return {
    collectWeatherEvidence: vi.fn().mockResolvedValue({
      expected: 2,
      accepted: 2,
      inserted: 2,
      rejected: 0,
      error: undefined,
    }),
    runItaSource: vi.fn().mockResolvedValue({
      fetched: 3,
      stored: 3,
      extracted: 3,
      failed: 0,
      pending: 0,
      notModified: false,
    }),
    runItaFacebookSource: vi.fn().mockResolvedValue({
      fetched: 1,
      stored: 1,
      newestPostAt: "2026-08-31T19:55:00Z",
    }),
    ingestFirms: vi.fn().mockResolvedValue({
      fetched: 2,
      inserted: 1,
      feeds: ["VIIRS:2"],
      dataFrom: "2026-08-31T19:52:00.000Z",
      dataThrough: "2026-08-31T19:58:00.000Z",
    }),
    ingestFci: vi.fn().mockResolvedValue({
      fetched: 4,
      inserted: 2,
      outside: 1,
      filtered: 1,
      latestSlot: "2026-08-31T19:50:00.000Z",
      ageMinutes: 10,
    }),
    ingestS3: vi.fn().mockResolvedValue({
      fetched: 3,
      inserted: 3,
      outside: 0,
      filtered: 0,
      latestSlot: "2026-08-31T21:16:00Z",
      ageMinutes: 95,
    }),
    ingestOnm: vi.fn().mockResolvedValue({
      fetched: 2,
      stored: 2,
      unmatched: 0,
      detailed: 2,
    }),
    ingestMetar: vi.fn().mockResolvedValue({ fetched: 31, stored: 31 }),
    ingestEmsc: vi.fn().mockResolvedValue({
      fetched: 3,
      stored: 1,
      outside: 2,
    }),
    screenPersistentSources: vi
      .fn()
      .mockResolvedValue({ screened: 4, registry: 10 }),
    fuseDetections: vi.fn().mockResolvedValue({
      processed: 5,
      clustersTouched: 3,
      created: 2,
      resolved: 1,
    }),
    flagPersistentCandidates: vi.fn().mockResolvedValue({ flagged: 1 }),
    enrichClusterWinds: vi.fn().mockResolvedValue(3),
    refreshRiskForecasts: vi
      .fn()
      .mockResolvedValue({ communes: 2, rows: 12, requests: 1 }),
    ingestEffis: vi.fn().mockResolvedValue({ communes: 2, classified: 2 }),
    evaluateAlerts: vi.fn().mockResolvedValue({
      evaluated: 4,
      created: 1,
      suppressed: 2,
      sent: 1,
      failed: 0,
    }),
    publishBroadcasts: vi
      .fn()
      .mockResolvedValue({ published: 2, suppressed: 1 }),
    drainWebhookDeliveries: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
    deliverBroadcasts: vi.fn().mockResolvedValue({
      rows: 2,
      sent: 2,
      telegramRows: 2,
      telegramSent: 2,
      telegramChannels: 1,
      fcmConfigured: true,
      telegramConfigured: true,
      disabled: false,
    }),
  } satisfies SourceRunnerDependencies;
}

describe("source runner registry", () => {
  it("keeps ITA failures visible without invoking any alert publisher", async () => {
    const deps = dependencies();
    deps.runItaSource.mockResolvedValue({
      fetched: 0,
      stored: 0,
      extracted: 0,
      failed: 0,
      pending: 2,
      notModified: true,
      error: "ITA extraction backlog: 2 reports",
    });
    const result = await createSourceRunners(deps).ita_website(
      job("ita_website"),
    );
    expect(result.outcome).toBe("failed");
    expect(result.qualityChecks).toMatchObject({
      extraction_pending: 2,
      not_modified: true,
    });
    expect(deps.publishBroadcasts).not.toHaveBeenCalled();
    expect(deps.deliverBroadcasts).not.toHaveBeenCalled();
    expect(deps.evaluateAlerts).not.toHaveBeenCalled();
    expect(deps.fuseDetections).not.toHaveBeenCalled();
  });
  it("reports a Facebook login wall as an unreachable upstream", async () => {
    const deps = dependencies();
    deps.runItaFacebookSource.mockResolvedValue({
      fetched: 0,
      stored: 0,
      newestPostAt: null,
      error: "Facebook login wall (HTTP 302)",
    });
    const result = await createSourceRunners(deps).ita_facebook(
      job("ita_facebook"),
    );
    expect(result).toMatchObject({
      outcome: "failed",
      publicReasonCode: "upstream_unreachable",
      retryDisposition: "transient",
      privateDiagnostic: "Facebook login wall (HTTP 302)",
    });
  });

  it("reports a page that renders no post as a schema change, not an internal error", async () => {
    const deps = dependencies();
    deps.runItaFacebookSource.mockResolvedValue({
      fetched: 0,
      stored: 0,
      newestPostAt: null,
      error: "Facebook page rendered no post (schema changed?)",
    });
    const result = await createSourceRunners(deps).ita_facebook(
      job("ita_facebook"),
    );
    expect(result).toMatchObject({
      outcome: "failed",
      publicReasonCode: "schema_invalid",
      retryDisposition: "permanent",
    });
  });

  it("covers the interval of a successful page read", async () => {
    const deps = dependencies();
    deps.runItaFacebookSource.mockResolvedValue({
      fetched: 1,
      stored: 0,
      newestPostAt: "2026-08-31T19:40:00Z",
    });
    const result = await createSourceRunners(deps).ita_facebook(
      job("ita_facebook"),
    );
    expect(result).toMatchObject({
      outcome: "succeeded",
      retryDisposition: "none",
      dataFrom: "2026-08-31T19:50:00.000Z",
      dataThrough: "2026-08-31T20:00:00.000Z",
      recordsSeen: 1,
      qualityChecks: { newest_post_at: "2026-08-31T19:40:00Z" },
    });
  });
  it("contains exactly one runner for every runtime contract", () => {
    expect(Object.keys(createSourceRunners(dependencies())).sort()).toEqual(
      [...RUNTIME_CONTRACT_KEYS].sort(),
    );
  });

  it("maps every adapter result into its own structured run", async () => {
    const deps = dependencies();
    const runners = createSourceRunners(deps);

    const results = await Promise.all(
      RUNTIME_CONTRACT_KEYS.map((key) => runners[key](job(key))),
    );

    expect(results.map((result) => result.contractKey)).toEqual(
      RUNTIME_CONTRACT_KEYS,
    );
    expect(results.every((result) => result.outcome === "succeeded")).toBe(
      true,
    );
    expect(results.every((result) => result.retryDisposition === "none")).toBe(
      true,
    );
    expect(deps.flagPersistentCandidates).toHaveBeenCalledOnce();
    expect(
      results.find((result) => result.contractKey === "firms"),
    ).toMatchObject({
      recordsSeen: 2,
      recordsInserted: 1,
      dataFrom: "2026-08-31T19:52:00.000Z",
      dataThrough: "2026-08-31T19:58:00.000Z",
    });
    expect(
      results.find((result) => result.contractKey === "fci"),
    ).toMatchObject({
      upstreamPublishedAt: "2026-08-31T19:50:00.000Z",
      recordsRejected: 2,
      qualityChecks: expect.objectContaining({ outside_watch_area: 1 }),
    });
    expect(
      results.find((result) => result.contractKey === "broadcast_delivery"),
    ).toMatchObject({ recordsSeen: 4, recordsUpdated: 4 });
  });

  it("keeps an under-covered adapter result partial and retryable", async () => {
    const deps = dependencies();
    deps.ingestOnm.mockResolvedValue({
      fetched: 3,
      stored: 3,
      unmatched: 1,
    });

    await expect(
      createSourceRunners(deps).onm(job("onm")),
    ).resolves.toMatchObject({
      outcome: "partial",
      coverageStatus: "partial",
      publicReasonCode: "coverage_partial",
      retryDisposition: "transient",
    });
  });

  it("contains raw adapter errors only in the private diagnostic", async () => {
    const deps = dependencies();
    deps.ingestFci.mockResolvedValue({
      fetched: 0,
      inserted: 0,
      outside: 0,
      filtered: 0,
      latestSlot: null,
      ageMinutes: null,
      error: "https://secret.provider.invalid returned token=private",
    });

    const result = await createSourceRunners(deps).fci(job("fci"));

    expect(result.publicReasonCode).toBe("upstream_unreachable");
    expect(result.privateDiagnostic).toContain("secret.provider.invalid");
    expect(JSON.stringify(result.publicReasonCode)).not.toContain("private");
  });

  it("runs Sentinel-3 through the same WFS report shape as FCI", async () => {
    const deps = dependencies();
    const result = await createSourceRunners(deps).s3_slstr(job("s3_slstr"));
    expect(result.outcome).toBe("succeeded");
    expect(result.upstreamPublishedAt).toBe("2026-08-31T21:16:00Z");
    expect(result.recordsInserted).toBe(3);
    expect(result.qualityChecks).toMatchObject({ latest_slot_age_minutes: 95 });
  });

  it("passes the recorded interval to replay-capable source adapters", async () => {
    const deps = dependencies();
    const replayInterval = {
      dataFrom: "2026-08-31T19:50:00.000Z",
      dataThrough: "2026-08-31T20:00:00.000Z",
    };

    await createSourceRunners(deps).firms({
      ...job("firms"),
      trigger_kind: "replay",
    });
    await createSourceRunners(deps).fci({
      ...job("fci"),
      trigger_kind: "replay",
    });

    expect(deps.ingestFirms).toHaveBeenCalledWith(replayInterval);
    expect(deps.ingestFci).toHaveBeenCalledWith(replayInterval);
  });

  it("does not let an optional wind failure call or block another runner", async () => {
    const deps = dependencies();
    deps.enrichClusterWinds.mockRejectedValue(
      new Error("open-meteo unavailable"),
    );
    const runners = createSourceRunners(deps);

    await expect(runners.openmeteo_wind(job("openmeteo_wind"))).rejects.toThrow(
      "open-meteo unavailable",
    );
    await expect(
      runners.broadcast_publish(job("broadcast_publish")),
    ).resolves.toMatchObject({ outcome: "succeeded" });
    expect(deps.publishBroadcasts).toHaveBeenCalledOnce();
  });

  // the slot, not the clock: a refresh that starts before Algiers midnight and
  // finishes after it must still publish under the day the job was scheduled for
  it("derives the risk base date from the job slot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T23:30:00.000Z"));
    const deps = dependencies();

    await createSourceRunners(deps).local_fwi({
      ...job("local_fwi"),
      scheduled_for: "2026-08-31T22:59:59.900Z",
    });

    expect(deps.refreshRiskForecasts).toHaveBeenCalledWith({
      snapshotId: expect.any(String),
      baseDate: "2026-08-31",
      scheduledFor: "2026-08-31T22:59:59.900Z",
    });
    vi.useRealTimers();
  });
});

describe("independent webhook delivery recovery", () => {
  it("drains pending webhooks when there are no new broadcast rows", async () => {
    const deps = dependencies();
    deps.deliverBroadcasts.mockResolvedValue({
      rows: 0,
      sent: 0,
      telegramRows: 0,
      telegramSent: 0,
      telegramChannels: 0,
      fcmConfigured: true,
      telegramConfigured: true,
      disabled: false,
    });
    deps.drainWebhookDeliveries.mockResolvedValue({ sent: 1, failed: 0 });
    const result = await createSourceRunners(deps).broadcast_delivery(
      job("broadcast_delivery"),
    );
    expect(deps.drainWebhookDeliveries).toHaveBeenCalledOnce();
    expect(result.recordsUpdated).toBe(1);
  });
  it("still drains webhooks if broadcast delivery throws", async () => {
    const deps = dependencies();
    deps.deliverBroadcasts.mockRejectedValue(new Error("database unavailable"));
    await expect(
      createSourceRunners(deps).broadcast_delivery(job("broadcast_delivery")),
    ).rejects.toThrow();
    expect(deps.drainWebhookDeliveries).toHaveBeenCalledOnce();
  });
  it("does not report successful health when webhook delivery fails", async () => {
    const deps = dependencies();
    deps.drainWebhookDeliveries.mockResolvedValue({ sent: 0, failed: 1 });
    const result = await createSourceRunners(deps).broadcast_delivery(
      job("broadcast_delivery"),
    );
    expect(result.outcome).toBe("partial");
    expect(result.publicReasonCode).toBe("delivery_failed");
  });
});

it.each(["failed", "skipped"])(
  "preserves combined delivery health when broadcasts are %s",
  async (outcome) => {
    const deps = dependencies();
    deps.deliverBroadcasts.mockResolvedValue({
      rows: 0,
      sent: 0,
      telegramRows: 0,
      telegramSent: 0,
      telegramChannels: 0,
      fcmConfigured: false,
      telegramConfigured: false,
      disabled: outcome === "skipped",
    });
    deps.drainWebhookDeliveries.mockResolvedValue({ sent: 0, failed: 1 });
    const result = await createSourceRunners(deps).broadcast_delivery(
      job("broadcast_delivery"),
    );
    expect(result.outcome).toBe(outcome === "failed" ? "failed" : "partial");
    expect(result.publicReasonCode).toBe(
      outcome === "failed" ? "credentials_missing" : "delivery_failed",
    );
    expect(result.qualityChecks).toMatchObject({ webhook_failed: 1 });
  },
);
