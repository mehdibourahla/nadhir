import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  detectImageMimeType,
  MAX_REPORT_PHOTO_BYTES,
  validateAndStripReportPhoto,
  type AllowedImageMimeType,
} from "@/lib/image-metadata";

const MULTIPART_OVERHEAD_BYTES = 65_536;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export interface ReportPhotoDeps {
  getUser: (
    token: string,
  ) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  consumeRateLimit: (
    userId: string,
  ) => Promise<{ data: boolean | null; error: unknown }>;
  hasWithdrawnCitizenReportsConsent: (
    userId: string,
  ) => Promise<{ withdrawn: boolean; error: unknown }>;
  uploadObject: (
    path: string,
    bytes: Uint8Array<ArrayBuffer>,
    contentType: AllowedImageMimeType,
  ) => Promise<{ error: unknown }>;
  randomUuid: () => string;
}

const defaultDeps: ReportPhotoDeps = {
  getUser: (token) => supabaseAdmin.auth.getUser(token),
  consumeRateLimit: async (userId) => {
    const res = await supabaseAdmin.rpc("consume_rate_limit", {
      _bucket: `report-photo:${userId}`,
      _limit: 10,
      _window_seconds: 600,
    });
    return { data: res.data, error: res.error };
  },
  hasWithdrawnCitizenReportsConsent: async (userId) => {
    const { data, error } = await supabaseAdmin
      .from("privacy_consents")
      .select("status")
      .eq("user_id", userId)
      .eq("consent_type", "citizen_reports")
      .eq("status", "withdrawn")
      .maybeSingle();
    return { withdrawn: Boolean(data), error };
  },
  uploadObject: (path, bytes, contentType) =>
    supabaseAdmin.storage.from("report-photos").upload(path, bytes, {
      contentType,
      upsert: true,
    }),
  randomUuid: () => crypto.randomUUID(),
};

export async function handleReportPhotoUpload(
  request: Request,
  overrides: Partial<ReportPhotoDeps> = {},
): Promise<Response> {
  const deps: ReportPhotoDeps = { ...defaultDeps, ...overrides };

  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!bearer) return json({ error: "unauthorized" }, 401);

  const auth = await deps.getUser(bearer);
  if (auth.error || !auth.data.user) {
    return json({ error: "unauthorized" }, 401);
  }
  const userId = auth.data.user.id;

  const quota = await deps.consumeRateLimit(userId);
  if (quota.error || quota.data == null) {
    return json({ error: "quota_unavailable" }, 503);
  }
  if (quota.data !== true) {
    return json({ error: "rate_limited" }, 429);
  }

  // Fail-closed (Law 18-07 / Law 25-11): block report photo processing if
  // citizen_reports consent is withdrawn or cannot be verified.
  const consent = await deps.hasWithdrawnCitizenReportsConsent(userId);
  if (consent.error) {
    return json({ error: "consent_unavailable" }, 503);
  }
  if (consent.withdrawn) {
    return json({ error: "consent_withdrawn" }, 403);
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const declaredLength = Number(contentLengthHeader);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_REPORT_PHOTO_BYTES + MULTIPART_OVERHEAD_BYTES
    ) {
      return json({ error: "too_large" }, 413);
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  const fileEntry = formData.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    return json({ error: "invalid_request" }, 400);
  }

  const objectIdRaw = formData.get("objectId");
  let objectId: string;
  if (objectIdRaw === null || objectIdRaw === "") {
    objectId = deps.randomUuid();
  } else if (typeof objectIdRaw === "string" && UUID_RE.test(objectIdRaw)) {
    objectId = objectIdRaw;
  } else {
    return json({ error: "invalid_request" }, 400);
  }

  if (fileEntry.size > MAX_REPORT_PHOTO_BYTES) {
    return json({ error: "too_large" }, 413);
  }

  const rawBytes = new Uint8Array(await fileEntry.arrayBuffer());
  if (rawBytes.byteLength > MAX_REPORT_PHOTO_BYTES) {
    return json({ error: "too_large" }, 413);
  }

  let cleaned;
  try {
    cleaned = validateAndStripReportPhoto(rawBytes, {
      declaredMime: fileEntry.type,
      maxBytes: MAX_REPORT_PHOTO_BYTES,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_image";
    if (code === "too_large") return json({ error: "too_large" }, 413);
    if (code === "unsupported_type") {
      return json({ error: "unsupported_type" }, 415);
    }
    return json({ error: "invalid_image" }, 400);
  }

  if (detectImageMimeType(cleaned.bytes) !== cleaned.mimeType) {
    return json({ error: "invalid_image" }, 400);
  }

  const path = `${userId}/${objectId}.${cleaned.extension}`;
  const upload = await deps.uploadObject(path, cleaned.bytes, cleaned.mimeType);
  if (upload.error) {
    return json({ error: "upload_failed" }, 503);
  }

  return json(
    {
      path,
      mimeType: cleaned.mimeType,
      byteLength: cleaned.bytes.byteLength,
      stripped: true,
      strippedBytes: cleaned.strippedBytes,
    },
    200,
  );
}
