import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { e2eBaseUrl } from "./env.ts";

export interface RecordedHttpRequest {
  method: string;
  url: string;
  pathname: string;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  rawBody: Buffer;
}

export interface MockHttpResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array | Buffer;
}

export type MockHttpHandler = (
  req: RecordedHttpRequest,
) => MockHttpResponse | Promise<MockHttpResponse>;

export interface MockHttpServerHandle {
  url: string;
  port: number;
  requests: RecordedHttpRequest[];
  clearRequests: () => void;
  close: () => Promise<void>;
}

export interface TextFetchResult {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  url: string;
}

export interface JsonFetchResult<T> {
  status: number;
  ok: boolean;
  headers: Headers;
  data: T;
  rawText: string;
  url: string;
}

export interface BytesFetchResult {
  status: number;
  ok: boolean;
  headers: Headers;
  bytes: Uint8Array;
  url: string;
}

export function resolveTargetUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const normalizedPath = pathOrUrl.startsWith("/")
    ? pathOrUrl
    : `/${pathOrUrl}`;
  return `${e2eBaseUrl()}${normalizedPath}`;
}

export async function fetchText(
  pathOrUrl: string,
  init?: RequestInit,
): Promise<TextFetchResult> {
  const url = resolveTargetUrl(pathOrUrl);
  const res = await fetch(url, init);
  const text = await res.text();
  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    text,
    url: res.url || url,
  };
}

export async function fetchJson<T = unknown>(
  pathOrUrl: string,
  init?: RequestInit,
): Promise<JsonFetchResult<T>> {
  const result = await fetchText(pathOrUrl, init);
  let data: T;
  try {
    data = JSON.parse(result.text) as T;
  } catch (error) {
    const snippet = result.text.slice(0, 240);
    throw new Error(
      `Expected JSON response from ${result.url} (status ${result.status}), got: ${snippet}`,
      { cause: error },
    );
  }
  return {
    status: result.status,
    ok: result.ok,
    headers: result.headers,
    data,
    rawText: result.text,
    url: result.url,
  };
}

export async function fetchBytes(
  pathOrUrl: string,
  init?: RequestInit,
): Promise<BytesFetchResult> {
  const url = resolveTargetUrl(pathOrUrl);
  const res = await fetch(url, init);
  const arrayBuffer = await res.arrayBuffer();
  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    bytes: new Uint8Array(arrayBuffer),
    url: res.url || url,
  };
}

function readIncomingBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => {
      resolveBody(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      rejectBody(err);
    });
  });
}

export async function startMockHttpServer(
  handler: MockHttpHandler,
): Promise<MockHttpServerHandle> {
  const requests: RecordedHttpRequest[] = [];

  const server: Server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const rawBody = await readIncomingBody(req);
        const rawUrl = req.url ?? "/";
        const parsed = new URL(rawUrl, "http://127.0.0.1");
        const query: Record<string, string> = {};
        parsed.searchParams.forEach((value, key) => {
          query[key] = value;
        });

        const headers: Record<string, string | string[] | undefined> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          headers[k] = v;
        }

        const recorded: RecordedHttpRequest = {
          method: req.method ?? "GET",
          url: rawUrl,
          pathname: parsed.pathname,
          query,
          headers,
          body: rawBody.toString("utf8"),
          rawBody,
        };
        requests.push(recorded);

        const response = await handler(recorded);
        const status = response.status ?? 200;
        const responseHeaders = response.headers ?? {};

        res.writeHead(status, responseHeaders);
        if (response.body === undefined) {
          res.end();
        } else if (typeof response.body === "string") {
          res.end(response.body);
        } else {
          res.end(Buffer.from(response.body));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Mock HTTP handler error";
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(message);
      }
    },
  );

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address() as AddressInfo | null;
  if (!address || typeof address.port !== "number") {
    throw new Error("Mock HTTP server failed to bind an ephemeral port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    requests,
    clearRequests: () => {
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        if (!server.listening) {
          resolveClose();
          return;
        }
        server.close((err) => {
          if (
            err &&
            (err as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
          ) {
            rejectClose(err);
          } else {
            resolveClose();
          }
        });
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
      }),
  };
}
