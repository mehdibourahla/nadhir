import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { getSourceArchiveContext } from "./source-archive-context.server";

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const LABEL = /^[a-zA-Z0-9_.:-]{1,100}$/;
type CaptureError =
  "network_error" | "body_read_failed" | "body_too_large" | "storage_failed";
export class ArchiveFailure extends Error {
  constructor(code: string, options?: ErrorOptions) {
    super(`Source archive ${code}`, options);
    this.name = "ArchiveFailure";
  }
}

export type SourceCapture = {
  source_key: string;
  endpoint: string;
  source_origin: string;
  request_params: Json;
  requested_at: string;
  fetched_at: string;
  http_status: number | null;
  status: "captured" | "not_modified" | "failed";
  error_code: CaptureError | null;
  sha256: string | null;
  storage_path: string | null;
  media_type: string | null;
  byte_length: number | null;
  response_headers: Record<string, string>;
  job_id: string | null;
  attempt: number | null;
  contract_version: number | null;
  parser_version: string | null;
  code_revision: string | null;
};
export type SourceArchiveStore = {
  putObject: (
    path: string,
    bytes: Uint8Array,
    mediaType: string,
  ) => Promise<void>;
  capture: (capture: SourceCapture) => Promise<void>;
};
type ArchiveOptions = {
  fetchImpl?: typeof fetch;
  requestParams?: Record<string, unknown>;
};

function safeParams(value: unknown, depth = 0): Json {
  if (depth > 8) throw new ArchiveFailure("unsafe_request_params");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.length <= 2000 &&
    !value.includes("://")
  )
    return value;
  if (Array.isArray(value) && value.length <= 1000)
    return value.map((item) => safeParams(item, depth + 1));
  if (
    typeof value === "object" &&
    value &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const entries = Object.entries(value);
    if (entries.length > 100) throw new ArchiveFailure("unsafe_request_params");
    return Object.fromEntries(
      entries.map(([key, item]) => {
        if (
          /token|secret|password|authorization|cookie|credential|api.?key|access.?key/i.test(
            key,
          )
        )
          throw new ArchiveFailure("unsafe_request_params");
        return [key, safeParams(item, depth + 1)];
      }),
    );
  }
  throw new ArchiveFailure("unsafe_request_params");
}

async function capture(store: SourceArchiveStore, row: SourceCapture) {
  try {
    await store.capture(row);
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    throw new ArchiveFailure("catalog_failed", { cause: error });
  }
}

export function createArchivedFetch(store: SourceArchiveStore) {
  return async function archivedFetch(
    sourceKey: string,
    endpoint: string,
    input: RequestInfo | URL,
    init?: RequestInit,
    options?: ArchiveOptions,
  ): Promise<Response> {
    if (!LABEL.test(sourceKey) || !LABEL.test(endpoint))
      throw new ArchiveFailure("unsafe_source_label");
    let origin: string;
    try {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      origin = url.origin;
    } catch {
      throw new ArchiveFailure("unsafe_source_origin");
    }
    const params = safeParams(options?.requestParams ?? {});
    if (JSON.stringify(params).length > 20_000)
      throw new ArchiveFailure("unsafe_request_params");
    const context = getSourceArchiveContext();
    const base: SourceCapture = {
      source_key: sourceKey,
      endpoint,
      source_origin: origin,
      request_params: params,
      requested_at: new Date().toISOString(),
      fetched_at: new Date().toISOString(),
      http_status: null,
      status: "failed",
      error_code: null,
      sha256: null,
      storage_path: null,
      media_type: null,
      byte_length: null,
      response_headers: {},
      job_id: context?.jobId ?? null,
      attempt: context?.attempt ?? null,
      contract_version: context?.contractVersion ?? null,
      parser_version: context?.parserVersion ?? null,
      code_revision: /^[a-f0-9]{40}$/.test(
        process.env["NADHIR_CODE_REVISION"] ?? "",
      )
        ? process.env["NADHIR_CODE_REVISION"]!
        : null,
    };
    let response: Response;
    try {
      response = await (options?.fetchImpl ?? fetch)(input, init);
    } catch (error) {
      await capture(store, {
        ...base,
        fetched_at: new Date().toISOString(),
        error_code: "network_error",
      });
      throw new Error("Source upstream network error", { cause: error });
    }
    base.http_status = response.status;
    base.media_type =
      response.headers.get("content-type")?.slice(0, 255) ?? null;
    for (const key of ["etag", "last-modified", "date"]) {
      const value = response.headers.get(key);
      if (value) base.response_headers[key] = value.slice(0, 2000);
    }
    if (response.status === 304) {
      await capture(store, {
        ...base,
        fetched_at: new Date().toISOString(),
        status: "not_modified",
        byte_length: 0,
      });
      return response;
    }
    const chunks: Uint8Array[] = [];
    const reader = response.body?.getReader();
    let length = 0;
    let bodyFailure: CaptureError | null = null;
    try {
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_BODY_BYTES) {
            bodyFailure = "body_too_large";
            break;
          }
          chunks.push(value);
        }
    } catch {
      bodyFailure = "body_read_failed";
    } finally {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          bodyFailure ??= "body_read_failed";
        }
        reader.releaseLock();
      }
    }
    base.fetched_at = new Date().toISOString();
    base.byte_length = length;
    if (bodyFailure) {
      await capture(store, { ...base, error_code: bodyFailure });
      throw new ArchiveFailure(bodyFailure);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    chunks.length = 0;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const path = `sha256/${sha256.slice(0, 2)}/${sha256}`;
    try {
      await store.putObject(
        path,
        bytes,
        base.media_type ?? "application/octet-stream",
      );
    } catch (error) {
      await capture(store, { ...base, error_code: "storage_failed" });
      throw new ArchiveFailure("storage_failed", { cause: error });
    }
    await capture(store, {
      ...base,
      status: "captured",
      sha256,
      storage_path: path,
    });
    return new Response([204, 205].includes(response.status) ? null : bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

const store: SourceArchiveStore = {
  async putObject(path, bytes, mediaType) {
    const { error } = await supabaseAdmin.storage
      .from("source-archive")
      .upload(path, bytes, { contentType: mediaType, upsert: false });
    if (error && String(error.statusCode) !== "409")
      throw new ArchiveFailure("storage_failed", { cause: error });
  },
  async capture(row) {
    const { error } = await supabaseAdmin.from("source_captures").insert(row);
    if (error) throw new ArchiveFailure("catalog_failed", { cause: error });
  },
};
export const archivedFetch = createArchivedFetch(store);
