const SENSITIVE_KEY_RE =
  /token|secret|password|authorization|cookie|credential|api.?key|access.?key|prompt|messages|body|html/i;

const MAX_STRING_LEN = 300;

export function redactText(
  input: string,
  extraSecrets: readonly string[] = [],
): string {
  let out = input;
  for (const secret of extraSecrets) {
    if (secret && secret.length >= 4) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  out = out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsb_secret_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\bsb_publishable_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED_JWT]",
    )
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[REDACTED]@")
    .replace(/\b(Set-Cookie|Cookie)\s*:\s*[^\r\n;]+/gi, "$1: [REDACTED]");
  if (out.length > MAX_STRING_LEN) {
    return `${out.slice(0, MAX_STRING_LEN)}...`;
  }
  return out;
}

export function sanitizeValue(
  value: unknown,
  extraSecrets: readonly string[] = [],
  depth = 0,
): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value, extraSecrets);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message, extraSecrets),
    };
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeValue(item, extraSecrets, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = sanitizeValue(item, extraSecrets, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export type WorkerLogLevel = "info" | "warn" | "error";

export type WorkerLogger = (
  level: WorkerLogLevel,
  message: string,
  fields?: Record<string, unknown>,
) => void;

export function createWorkerLogger(
  extraSecrets: readonly string[] = [],
  sink: {
    info?: (line: string) => void;
    warn?: (line: string) => void;
    error?: (line: string) => void;
  } = {
    info: (line) => console.log(line),
    warn: (line) => console.warn(line),
    error: (line) => console.error(line),
  },
): WorkerLogger {
  return (level, message, fields = {}) => {
    const payload = {
      ts: new Date().toISOString(),
      level,
      message: redactText(message, extraSecrets),
      ...(sanitizeValue(fields, extraSecrets) as Record<string, unknown>),
    };
    const serialized = JSON.stringify(payload);
    if (level === "error") (sink.error ?? console.error)(serialized);
    else if (level === "warn") (sink.warn ?? console.warn)(serialized);
    else (sink.info ?? console.log)(serialized);
  };
}
