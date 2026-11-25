import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  FCM_LANGS,
  fcmMessageForSelfTest,
  type FcmLang,
  type FcmSelfTestMessage,
} from "@/lib/fcm";
import { fcmConfigured, fcmSend } from "@/lib/ingest/fcm.server";
import { testPushReceipt } from "@/lib/push-receipt.server";
import { readJsonBody } from "@/lib/request-body.server";

const TOKEN_PATTERN = /^[A-Za-z0-9:_\-=.+]+$/;
const MIN_TOKEN_LEN = 10;
const MAX_TOKEN_LEN = 4096;
const MAX_BODY_BYTES = 8192;
const ALLOWED_BODY_KEYS = new Set(["token", "lang"]);

const PRIVATE_NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
};

const PUBLIC_NO_STORE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

type RateLimitResult = {
  data: boolean | null;
  error: { message: string } | null;
};

type RateLimitBucket = {
  bucket: string;
  limit: number;
  windowSeconds: number;
};

export type PushTestDeps = {
  getUser: (bearer: string) => Promise<{
    data: { user: { id: string } | null };
    error: unknown;
  }>;
  consumeRateLimit: (
    bucket: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<RateLimitResult>;
  isFcmConfigured: () => boolean;
  verifyDeviceOwned: (
    userId: string,
    tokenHash: string,
  ) => Promise<{ owned: boolean; error: unknown }>;
  createReceipt: (
    userId: string,
  ) => Promise<{ id: string | null; error: unknown }>;
  signReceipt: (testId: string) => Promise<string>;
  sendFcm: (message: FcmSelfTestMessage) => Promise<void>;
  now: () => Date;
  delayMs: number;
};

export type PublicPushTestDeps = {
  consumeRateLimit: (
    bucket: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<RateLimitResult>;
  isFcmConfigured: () => boolean;
  sendFcm: (message: FcmSelfTestMessage) => Promise<void>;
  newTestId: () => string;
  now: () => Date;
};

function privateJson(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return Response.json(body, {
    status,
    headers: { ...PRIVATE_NO_STORE_HEADERS, ...extraHeaders },
  });
}

function publicJson(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return Response.json(body, {
    status,
    headers: { ...PUBLIC_NO_STORE_CORS_HEADERS, ...extraHeaders },
  });
}

export function publicPushTestPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: PUBLIC_NO_STORE_CORS_HEADERS,
  });
}

export function publicPushTestMethodNotAllowed(): Response {
  return publicJson({ error: "method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    forwarded.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function parseSelfTestBody(
  body: unknown,
): { token: string; lang: FcmLang } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "__proto__")) return null;
  const keys = Object.keys(record);
  if (keys.length === 0 || keys.length > 2) return null;
  for (const key of keys) {
    if (!ALLOWED_BODY_KEYS.has(key)) return null;
  }
  const rawToken = record["token"];
  if (typeof rawToken !== "string") return null;
  const trimmed = rawToken.trim();
  if (
    trimmed !== rawToken ||
    trimmed.length < MIN_TOKEN_LEN ||
    trimmed.length > MAX_TOKEN_LEN ||
    !TOKEN_PATTERN.test(trimmed)
  ) {
    return null;
  }
  let lang: FcmLang = "ar";
  if ("lang" in record && record["lang"] !== undefined) {
    const rawLang = record["lang"];
    if (
      typeof rawLang !== "string" ||
      !(FCM_LANGS as readonly string[]).includes(rawLang)
    ) {
      return null;
    }
    lang = rawLang as FcmLang;
  }
  return { token: trimmed, lang };
}

async function checkRateLimits(
  consumeRateLimit: PushTestDeps["consumeRateLimit"],
  buckets: RateLimitBucket[],
  respond: (
    body: unknown,
    status: number,
    extraHeaders?: Record<string, string>,
  ) => Response,
): Promise<Response | null> {
  for (const entry of buckets) {
    const quota = await consumeRateLimit(
      entry.bucket,
      entry.limit,
      entry.windowSeconds,
    );
    if (quota.error || quota.data == null) {
      return respond({ error: "Quota unavailable" }, 503);
    }
    if (quota.data !== true) {
      return respond(
        {
          error: "Too many push test requests. Please wait before retrying.",
          retryAfter: entry.windowSeconds,
        },
        429,
        { "Retry-After": String(entry.windowSeconds) },
      );
    }
  }
  return null;
}

const defaultConsumeRateLimit: PushTestDeps["consumeRateLimit"] = async (
  bucket,
  limit,
  windowSeconds,
) => {
  const res = await supabaseAdmin.rpc("consume_rate_limit", {
    _bucket: bucket,
    _limit: limit,
    _window_seconds: windowSeconds,
  });
  return {
    data: typeof res.data === "boolean" ? res.data : null,
    error: res.error,
  };
};

const defaultPrivateDeps: PushTestDeps = {
  getUser: (bearer) => supabaseAdmin.auth.getUser(bearer),
  consumeRateLimit: defaultConsumeRateLimit,
  isFcmConfigured: fcmConfigured,
  verifyDeviceOwned: async (userId, tokenHash) => {
    const res = await supabaseAdmin
      .from("user_push_devices")
      .select("device_hash")
      .eq("user_id", userId)
      .eq("device_hash", tokenHash)
      .maybeSingle();
    if (res.error) return { owned: false, error: res.error };
    return { owned: Boolean(res.data?.device_hash), error: null };
  },
  createReceipt: async (userId) => {
    const res = await supabaseAdmin
      .from("push_test_receipts")
      .insert({ user_id: userId })
      .select("id")
      .single();
    if (res.error || !res.data?.id) {
      return { id: null, error: res.error ?? new Error("receipt missing") };
    }
    return { id: res.data.id, error: null };
  },
  signReceipt: (testId) => testPushReceipt(testId),
  sendFcm: (message) => fcmSend(message),
  now: () => new Date(),
  delayMs: 0,
};

const defaultPublicDeps: PublicPushTestDeps = {
  consumeRateLimit: defaultConsumeRateLimit,
  isFcmConfigured: fcmConfigured,
  sendFcm: (message) => fcmSend(message),
  newTestId: () => crypto.randomUUID(),
  now: () => new Date(),
};

export async function handlePushTest(
  request: Request,
  overrides: Partial<PushTestDeps> = {},
): Promise<Response> {
  const deps: PushTestDeps = { ...defaultPrivateDeps, ...overrides };
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!bearer) return privateJson({ error: "Authentication required" }, 401);

  try {
    const auth = await deps.getUser(bearer);
    if (auth.error || !auth.data.user) {
      return privateJson({ error: "Invalid session" }, 401);
    }
    const userId = auth.data.user.id;

    const userLimited = await checkRateLimits(
      deps.consumeRateLimit,
      [
        { bucket: `push-test:${userId}`, limit: 2, windowSeconds: 60 },
        { bucket: `push-test:hour:${userId}`, limit: 6, windowSeconds: 3600 },
      ],
      privateJson,
    );
    if (userLimited) return userLimited;

    if (!deps.isFcmConfigured()) {
      return privateJson({ error: "Push is not configured" }, 503);
    }

    const read = await readJsonBody(request, MAX_BODY_BYTES);
    if ("error" in read) return privateJson({ error: read.error }, read.status);

    const parsed = parseSelfTestBody(read.body);
    if (!parsed) return privateJson({ error: "Invalid device token" }, 400);

    const tokenHash = await sha256Hex(parsed.token);
    const ownership = await deps.verifyDeviceOwned(userId, tokenHash);
    if (ownership.error) {
      return privateJson({ error: "Device verification unavailable" }, 503);
    }
    if (!ownership.owned) {
      return privateJson(
        {
          error: "device_not_owned",
          message:
            "This device is not registered for push alerts on your account. Enable device notifications first.",
        },
        403,
      );
    }

    const tokenLimited = await checkRateLimits(
      deps.consumeRateLimit,
      [{ bucket: `push-test:tok:${tokenHash}`, limit: 3, windowSeconds: 300 }],
      privateJson,
    );
    if (tokenLimited) return tokenLimited;

    const created = await deps.createReceipt(userId);
    if (created.error || !created.id) {
      return privateJson({ error: "Push test unavailable" }, 503);
    }
    const testId = created.id;
    const receipt = await deps.signReceipt(testId);
    const observedAt = deps.now().toISOString();

    if (deps.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, deps.delayMs));
    }

    const payload = fcmMessageForSelfTest({
      token: parsed.token,
      testId,
      lang: parsed.lang,
      receipt,
      linkPath: "/settings",
      observedAt,
    });

    try {
      await deps.sendFcm(payload);
    } catch {
      return privateJson({ error: "Push provider rejected the test" }, 502);
    }

    return privateJson({
      accepted: true,
      ok: true,
      testId,
      channelId: "alerts_test",
      sentAt: observedAt,
    });
  } catch {
    return privateJson({ error: "Push test unavailable" }, 503);
  }
}

export async function handlePublicPushTest(
  request: Request,
  overrides: Partial<PublicPushTestDeps> = {},
): Promise<Response> {
  const deps: PublicPushTestDeps = { ...defaultPublicDeps, ...overrides };

  try {
    const ip = clientIp(request);
    const ipLimited = await checkRateLimits(
      deps.consumeRateLimit,
      [
        { bucket: `public-push-test:ip:${ip}`, limit: 2, windowSeconds: 60 },
        {
          bucket: `public-push-test:ip-hour:${ip}`,
          limit: 6,
          windowSeconds: 3600,
        },
      ],
      publicJson,
    );
    if (ipLimited) return ipLimited;

    if (!deps.isFcmConfigured()) {
      return publicJson({ error: "Push is not configured" }, 503);
    }

    const read = await readJsonBody(request, MAX_BODY_BYTES);
    if ("error" in read) return publicJson({ error: read.error }, read.status);

    const parsed = parseSelfTestBody(read.body);
    if (!parsed) return publicJson({ error: "Invalid device token" }, 400);

    const tokenHash = await sha256Hex(parsed.token);
    const tokenLimited = await checkRateLimits(
      deps.consumeRateLimit,
      [
        {
          bucket: `public-push-test:tok:${tokenHash}`,
          limit: 2,
          windowSeconds: 60,
        },
      ],
      publicJson,
    );
    if (tokenLimited) return tokenLimited;

    const testId = deps.newTestId();
    const observedAt = deps.now().toISOString();
    const payload = fcmMessageForSelfTest({
      token: parsed.token,
      testId,
      lang: parsed.lang,
      linkPath: "/",
      observedAt,
    });

    try {
      await deps.sendFcm(payload);
    } catch {
      return publicJson({ error: "Push provider rejected the test" }, 502);
    }

    return publicJson({
      accepted: true,
      ok: true,
      testId,
      channelId: "alerts_test",
      sentAt: observedAt,
    });
  } catch {
    return publicJson({ error: "Push test unavailable" }, 503);
  }
}
