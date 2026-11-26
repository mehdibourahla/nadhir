import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { ArchiveFailure, archivedFetch } from "@/lib/source-archive.server";
import {
  retryDispositionForReason,
  type ClaimedSourceJob,
  type SourceJobResult,
  type SourceReplayInterval,
} from "@/lib/source-jobs";
import { publicReasonForError, sourceRunOutcome } from "@/lib/source-runs";

import {
  MTG_FCI_PUSH_ATTRIBUTION,
  MTG_FCI_PUSH_FALLBACK_CONTRACT,
  MTG_FCI_PUSH_SOURCE_KEY,
  parseEumetsatFciCapXml,
  parseMtgFciPushPayload,
  type MtgFciPushDeliveryAudit,
  type MtgFciPushDetectionRow,
} from "./mtg-fci-push";

type DetectionInsert = Database["public"]["Tables"]["detections"]["Insert"];

export type MtgFciPushRun = {
  fetched: number;
  stored: number;
  outside: number;
  filtered: number;
  emptySlot: boolean;
  productId: string | null;
  slotTime: string | null;
  upstreamPublishedAt: string | null;
  latencySeconds: number | null;
  dataFrom?: string | null;
  dataThrough?: string | null;
  error?: string;
};

function readEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

function resolveSlotIso(
  nowMs: number,
  interval?: SourceReplayInterval,
): string {
  const targetMs = interval ? Date.parse(interval.dataThrough) : nowMs;
  const safeMs = Number.isFinite(targetMs) ? targetMs : nowMs;
  const floored = Math.floor(safeMs / (5 * 60_000)) * (5 * 60_000);
  return new Date(floored).toISOString();
}

const EUMETSAT_TOKEN_URL = "https://api.eumetsat.int/token";
const EUMETSAT_FCI_CAP_SEARCH_URL =
  "https://api.eumetsat.int/data/search-products/1.0.0/os?pi=EO%3AEUM%3ADAT%3A0801&format=json&c=1&sort=start,time,0";

async function fetchLatestEumetsatFciCap(
  consumerKey: string,
  consumerSecret: string,
  receivedAt: string,
): Promise<ReturnType<typeof parseEumetsatFciCapXml>> {
  const basic = btoa(`${consumerKey}:${consumerSecret}`);
  const tokRes = await fetch(EUMETSAT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokRes.ok) {
    throw new Error(`EUMETSAT token HTTP ${tokRes.status}`);
  }
  const tokJson = (await tokRes.json()) as { access_token?: string };
  if (!tokJson.access_token) {
    throw new Error("EUMETSAT token response missing access_token");
  }
  const authHeaders = { Authorization: `Bearer ${tokJson.access_token}` };
  const searchRes = await fetch(EUMETSAT_FCI_CAP_SEARCH_URL, {
    headers: authHeaders,
    signal: AbortSignal.timeout(15_000),
  });
  if (!searchRes.ok) {
    throw new Error(`EUMETSAT Data Store search HTTP ${searchRes.status}`);
  }
  const searchJson = (await searchRes.json()) as {
    features?: {
      id?: string;
      properties?: {
        links?: {
          "sip-entries"?: { href?: string; title?: string }[];
        };
      };
    }[];
  };
  const latest = searchJson.features?.[0];
  const productId = latest?.id;
  const entries = latest?.properties?.links?.["sip-entries"] ?? [];
  const capEntry = entries.find(
    (e) =>
      typeof e.href === "string" &&
      typeof e.title === "string" &&
      e.title.includes("FCI-2-FIR") &&
      e.title.endsWith(".xml"),
  );
  if (!productId || !capEntry?.href) {
    throw new Error(
      "MTG FCI push schema invalid: no EO:EUM:DAT:0801 CAP XML entry found",
    );
  }
  const xmlRes = await archivedFetch(
    MTG_FCI_PUSH_SOURCE_KEY,
    "mtg_fci_l2_fir_cap",
    capEntry.href,
    { headers: authHeaders, signal: AbortSignal.timeout(20_000) },
    { requestParams: { product: "EO:EUM:DAT:0801", id: productId } },
  );
  if (!xmlRes.ok) {
    throw new Error(`MTG FCI push upstream HTTP ${xmlRes.status}`);
  }
  return parseEumetsatFciCapXml(await xmlRes.text(), {
    productId: `EO:EUM:DAT:0801:${productId}`,
    receivedAt,
  });
}

const defaultStore = {
  feedUrl: () => readEnv("MTG_FCI_PUSH_URL") ?? null,
  pushToken: () => readEnv("EUMETSAT_PUSH_TOKEN") ?? null,
  eumetsatKey: () => readEnv("EUMETSAT_CONSUMER_KEY") ?? null,
  eumetsatSecret: () => readEnv("EUMETSAT_CONSUMER_SECRET") ?? null,
  fetchEumetsatCap: fetchLatestEumetsatFciCap,
  fetch: (
    url: string,
    slotIso: string,
    token: string | null,
    replay: boolean,
  ) =>
    archivedFetch(
      MTG_FCI_PUSH_SOURCE_KEY,
      "mtg_fci_l2p_frp_push",
      url,
      {
        signal: AbortSignal.timeout(20_000),
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      },
      {
        requestParams: {
          product: "EO:EUM:DAT:0662",
          slot: slotIso,
          replay,
        },
      },
    ),
  upsertDetections: async (rows: MtgFciPushDetectionRow[]) => {
    if (!rows.length) return 0;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch: DetectionInsert[] = rows.slice(i, i + 500);
      const { error, count } = await supabaseAdmin
        .from("detections")
        .upsert(batch, {
          onConflict: "natural_key",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (error) {
        throw new Error(`detections upsert failed: ${error.message}`);
      }
      inserted += count ?? 0;
    }
    return inserted;
  },
  recordDelivery: async (audit: MtgFciPushDeliveryAudit) => {
    const { error } = await supabaseAdmin.rpc("record_mtg_fci_push_delivery", {
      _product_id: audit.productId,
      _slot_time: audit.slotTime,
      _published_at: audit.publishedAt,
      _received_at: audit.receivedAt,
      _latency_seconds: audit.latencySeconds,
      _pixels_seen: audit.pixelsSeen,
      _pixels_stored: audit.pixelsStored,
      _pixels_filtered: audit.pixelsFiltered,
      _fallback_contract_key: audit.fallbackContractKey,
      _quality_state: audit.qualityState,
      _attribution: audit.attribution,
    });
    if (error) {
      throw new Error(
        `record_mtg_fci_push_delivery RPC failed: ${error.message}`,
      );
    }
  },
};

export type MtgFciPushDependencies = Partial<typeof defaultStore>;

export async function ingestMtgFciPush(
  dependencies: MtgFciPushDependencies = {},
  now: () => number = Date.now,
  interval?: SourceReplayInterval,
): Promise<MtgFciPushRun> {
  const deps = { ...defaultStore, ...dependencies };
  const nowMs = now();
  const slotIso = resolveSlotIso(nowMs, interval);
  const baseUrl = deps.feedUrl();

  if (!baseUrl) {
    const key = deps.eumetsatKey();
    const secret = deps.eumetsatSecret();
    if (key && secret) {
      const receivedAt = new Date(nowMs).toISOString();
      try {
        const parsed = await deps.fetchEumetsatCap(key, secret, receivedAt);
        const boundedRows = interval
          ? parsed.rows.filter((row) => {
              const ms = Date.parse(row.detected_at);
              return (
                ms >= Date.parse(interval.dataFrom) &&
                ms <= Date.parse(interval.dataThrough)
              );
            })
          : parsed.rows;
        const stored = boundedRows.length
          ? await deps.upsertDetections(boundedRows)
          : 0;
        await deps.recordDelivery({
          productId: parsed.productId,
          slotTime: parsed.slotTime,
          publishedAt: parsed.upstreamPublishedAt,
          receivedAt: parsed.receivedAt,
          latencySeconds: parsed.latencySeconds,
          pixelsSeen: parsed.pixelsSeen,
          pixelsStored: stored,
          pixelsFiltered:
            parsed.pixelsOutsideWatchBox + parsed.pixelsFilteredWatchArea,
          fallbackContractKey: MTG_FCI_PUSH_FALLBACK_CONTRACT,
          qualityState: parsed.qualityState,
          attribution: MTG_FCI_PUSH_ATTRIBUTION,
        });
        return {
          fetched: parsed.pixelsSeen,
          stored,
          outside: parsed.pixelsOutsideWatchBox,
          filtered: parsed.pixelsFilteredWatchArea,
          emptySlot: boundedRows.length === 0,
          productId: parsed.productId,
          slotTime: parsed.slotTime,
          upstreamPublishedAt: parsed.upstreamPublishedAt,
          latencySeconds: parsed.latencySeconds,
          dataFrom:
            interval?.dataFrom ??
            new Date(Date.parse(parsed.slotTime) - 10 * 60_000).toISOString(),
          dataThrough: interval?.dataThrough ?? parsed.slotTime,
        };
      } catch (error) {
        if (error instanceof ArchiveFailure) throw error;
        return {
          fetched: 0,
          stored: 0,
          outside: 0,
          filtered: 0,
          emptySlot: false,
          productId: null,
          slotTime: null,
          upstreamPublishedAt: null,
          latencySeconds: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      filtered: 0,
      emptySlot: false,
      productId: null,
      slotTime: null,
      upstreamPublishedAt: null,
      latencySeconds: null,
      error: "MTG FCI push URL not configured (MTG_FCI_PUSH_URL missing)",
    };
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(baseUrl);
  } catch {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      filtered: 0,
      emptySlot: false,
      productId: null,
      slotTime: null,
      upstreamPublishedAt: null,
      latencySeconds: null,
      error: "MTG FCI push URL not configured: invalid feed URL",
    };
  }
  if (interval) {
    requestUrl.searchParams.set("from", interval.dataFrom);
    requestUrl.searchParams.set("through", interval.dataThrough);
  }
  requestUrl.searchParams.set("slot", slotIso);

  let response: Response;
  try {
    response = await deps.fetch(
      requestUrl.toString(),
      slotIso,
      deps.pushToken(),
      Boolean(interval),
    );
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      filtered: 0,
      emptySlot: false,
      productId: null,
      slotTime: null,
      upstreamPublishedAt: null,
      latencySeconds: null,
      error: `MTG FCI push upstream fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      filtered: 0,
      emptySlot: false,
      productId: null,
      slotTime: null,
      upstreamPublishedAt: null,
      latencySeconds: null,
      error: `MTG FCI push upstream HTTP ${response.status}`,
    };
  }

  const contentType = response.headers.get("content-type");
  const receivedAt = new Date(nowMs).toISOString();

  try {
    const buffer = await response.arrayBuffer();
    const parsed = parseMtgFciPushPayload(buffer, {
      contentType,
      receivedAt,
    });

    const boundedRows = interval
      ? parsed.rows.filter((row) => {
          const ms = Date.parse(row.detected_at);
          return (
            ms >= Date.parse(interval.dataFrom) &&
            ms <= Date.parse(interval.dataThrough)
          );
        })
      : parsed.rows;

    const stored = boundedRows.length
      ? await deps.upsertDetections(boundedRows)
      : 0;

    await deps.recordDelivery({
      productId: parsed.productId,
      slotTime: parsed.slotTime,
      publishedAt: parsed.upstreamPublishedAt,
      receivedAt: parsed.receivedAt,
      latencySeconds: parsed.latencySeconds,
      pixelsSeen: parsed.pixelsSeen,
      pixelsStored: stored,
      pixelsFiltered:
        parsed.pixelsOutsideWatchBox + parsed.pixelsFilteredWatchArea,
      fallbackContractKey: MTG_FCI_PUSH_FALLBACK_CONTRACT,
      qualityState: parsed.qualityState,
      attribution: MTG_FCI_PUSH_ATTRIBUTION,
    });

    return {
      fetched: parsed.pixelsSeen,
      stored,
      outside: parsed.pixelsOutsideWatchBox,
      filtered: parsed.pixelsFilteredWatchArea,
      emptySlot: boundedRows.length === 0,
      productId: parsed.productId,
      slotTime: parsed.slotTime,
      upstreamPublishedAt: parsed.upstreamPublishedAt,
      latencySeconds: parsed.latencySeconds,
      dataFrom:
        interval?.dataFrom ??
        new Date(Date.parse(parsed.slotTime) - 10 * 60_000).toISOString(),
      dataThrough: interval?.dataThrough ?? parsed.slotTime,
    };
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      filtered: 0,
      emptySlot: false,
      productId: null,
      slotTime: null,
      upstreamPublishedAt: null,
      latencySeconds: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runMtgFciPushSource(
  job: ClaimedSourceJob,
  dependencies: MtgFciPushDependencies = {},
  now: () => number = Date.now,
): Promise<SourceJobResult> {
  const interval: SourceReplayInterval | undefined =
    job.trigger_kind === "replay" && job.data_from && job.data_through
      ? { dataFrom: job.data_from, dataThrough: job.data_through }
      : undefined;

  const run = await ingestMtgFciPush(dependencies, now, interval);
  const accepted = run.emptySlot && !run.error ? 1 : run.stored;
  const health = sourceRunOutcome({ accepted, error: run.error });
  const reason = run.error
    ? publicReasonForError(run.error)
    : health.outcome === "skipped"
      ? "disabled"
      : null;

  return {
    contractKey: job.contract_key,
    trigger: job.trigger_kind,
    scheduledFor: job.scheduled_for,
    startedAt: job.started_at,
    ...health,
    upstreamPublishedAt: run.upstreamPublishedAt,
    dataFrom:
      health.outcome === "succeeded" ? (run.dataFrom ?? job.data_from) : null,
    dataThrough:
      health.outcome === "succeeded"
        ? (run.dataThrough ?? run.slotTime ?? job.data_through)
        : null,
    recordsSeen: run.fetched,
    recordsInserted: run.stored,
    recordsRejected: run.outside + run.filtered,
    qualityChecks: {
      intake_channel: "push",
      fallback_contract: MTG_FCI_PUSH_FALLBACK_CONTRACT,
      empty_slot: run.emptySlot,
      latency_seconds: run.latencySeconds,
      sub_5min_target_met:
        run.latencySeconds !== null ? run.latencySeconds <= 300 : null,
    },
    publicReasonCode: reason,
    privateDiagnostic: run.error ?? null,
    retryDisposition:
      health.outcome === "succeeded" || health.outcome === "skipped"
        ? "none"
        : retryDispositionForReason(reason ?? "internal_error"),
  };
}
