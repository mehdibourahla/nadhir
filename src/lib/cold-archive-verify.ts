import { createHash } from "node:crypto";
import { type ColdTable, sha256, type Summary } from "./cold-archive";

export const COLD_TABLE_CONFIG = {
  weather_snapshots: { dayColumn: "scheduled_at", hotDays: 90 },
  risk_forecasts: { dayColumn: "created_at", hotDays: 90 },
  broadcast_audit: { dayColumn: "at", hotDays: 90 },
  airport_observations: { dayColumn: "observed_at", hotDays: 90 },
  source_runs: { dayColumn: "started_at", hotDays: 90 },
  source_jobs: { dayColumn: "created_at", hotDays: 92 },
} as const satisfies Record<ColdTable, { dayColumn: string; hotDays: number }>;

export interface ColdCutoff {
  table: ColdTable;
  asOfDay: string;
  hotDays: number;
  firstHotDay: string;
  lastEligibleDay: string;
}

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isIsoDay(value: string): boolean {
  const match = ISO_DAY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function shiftUtcDay(day: string, deltaDays: number): string {
  if (!isIsoDay(day)) {
    throw new Error(`Invalid ISO UTC day: ${day}`);
  }
  if (!Number.isInteger(deltaDays)) {
    throw new Error(`deltaDays must be an integer (got ${deltaDays})`);
  }
  const match = ISO_DAY_RE.exec(day);
  if (!match) throw new Error(`Invalid ISO UTC day: ${day}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  const shifted = new Date(Date.UTC(year, month - 1, dayOfMonth + deltaDays));
  const y = String(shifted.getUTCFullYear()).padStart(4, "0");
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function computeColdCutoff(
  table: ColdTable,
  asOfDay: string,
): ColdCutoff {
  if (!isIsoDay(asOfDay)) {
    throw new Error(`Invalid asOfDay: ${asOfDay}`);
  }
  const { hotDays } = COLD_TABLE_CONFIG[table];
  return {
    table,
    asOfDay,
    hotDays,
    firstHotDay: shiftUtcDay(asOfDay, -hotDays),
    lastEligibleDay: shiftUtcDay(asOfDay, -hotDays - 1),
  };
}

export function isDayEligibleForArchive(
  table: ColdTable,
  day: string,
  asOfDay: string,
): boolean {
  if (!isIsoDay(day)) {
    throw new Error(`Invalid day: ${day}`);
  }
  const cutoff = computeColdCutoff(table, asOfDay);
  return day <= cutoff.lastEligibleDay;
}

export function compareCLocale(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function computeKeyDigest(ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  const sorted = [...ids].sort(compareCLocale);
  return createHash("md5").update(sorted.join(","), "utf8").digest("hex");
}

export function canonicalizeJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return value.toString();
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort(compareCLocale);
  const out: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const entry = record[key];
    if (entry !== undefined) {
      out[key] = canonicalizeJsonValue(entry);
    }
  }
  return out;
}

export function serializeCanonicalNdjson(
  rows: readonly (Record<string, unknown> & { id: string })[],
): Uint8Array {
  if (rows.length === 0) return new Uint8Array(0);
  const sorted = [...rows].sort((a, b) => compareCLocale(a.id, b.id));
  const lines = sorted.map((row) => JSON.stringify(canonicalizeJsonValue(row)));
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

export function readBackCanonicalNdjson(bytes: Uint8Array): Summary {
  if (bytes.byteLength === 0) {
    return { rows: 0, digest: null };
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const rawLines = decoded.split("\n");
  if (rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }
  if (rawLines.length === 0) {
    return { rows: 0, digest: null };
  }
  const ids: string[] = [];
  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const line = rawLines[idx];
    if (line === undefined || line.length === 0) {
      throw new Error(`Empty NDJSON line at index ${idx}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Malformed JSON at line ${idx + 1}: ${reason}`, {
        cause: error,
      });
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error(`NDJSON line ${idx + 1} is not a JSON object`);
    }
    const id = (parsed as Record<string, unknown>)["id"];
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        `NDJSON line ${idx + 1} is missing a non-empty string id`,
      );
    }
    ids.push(id);
  }
  return { rows: ids.length, digest: computeKeyDigest(ids) };
}

export function verifyExportArtifact(
  bytes: Uint8Array,
  expectedSha256: string,
  expectedSummary: Summary,
): { sha256: string; summary: Summary } {
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  const summary = readBackCanonicalNdjson(bytes);
  if (
    summary.rows !== expectedSummary.rows ||
    summary.digest !== expectedSummary.digest
  ) {
    throw new Error(
      `Summary mismatch: expected rows=${expectedSummary.rows} digest=${expectedSummary.digest}, got rows=${summary.rows} digest=${summary.digest}`,
    );
  }
  return { sha256: actualSha256, summary };
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function assertLoopbackHttpUrl(raw: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${label} must use http: or https: protocol (got ${parsed.protocol})`,
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${label} must not embed credentials`);
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `${label} must point to a local loopback host (got ${parsed.hostname})`,
    );
  }
  return parsed;
}

export function assertLoopbackDatabaseUrl(raw: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      `${label} must use postgres: or postgresql: protocol (got ${parsed.protocol})`,
    );
  }
  // Reject libpq multi-host forms such as postgres://user:pass@127.0.0.1:5432,prod.db:5432/postgres
  const authority = raw.slice(parsed.protocol.length + 2).split(/[/?#]/, 1)[0];
  const hostPortPart = authority?.includes("@")
    ? authority.slice(authority.lastIndexOf("@") + 1)
    : authority;
  if (!hostPortPart || hostPortPart.includes(",")) {
    throw new Error(`${label} must specify a single loopback host`);
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `${label} must point to a local loopback host (got ${parsed.hostname})`,
    );
  }
  for (const [key, value] of parsed.searchParams.entries()) {
    const normalized = key.toLowerCase();
    if (normalized === "host" || normalized === "hostaddr") {
      const hosts = value.split(",").map((part) => part.trim());
      if (hosts.length !== 1 || !hosts[0] || !isLoopbackHost(hosts[0])) {
        throw new Error(
          `${label} query parameter ${key} must not override to a non-loopback host`,
        );
      }
    }
  }
  return parsed;
}

export type VerifyMode = "auto" | "duckdb" | "ts";
export type ResolvedVerifyMode = "duckdb" | "ts";

export function resolveVerifyMode(
  requested: VerifyMode,
  duckdbAvailable: boolean,
): ResolvedVerifyMode {
  if (requested === "ts") return "ts";
  if (requested === "duckdb") {
    if (!duckdbAvailable) {
      throw new Error(
        "Requested --mode duckdb, but the DuckDB CLI binary is not installed or not executable. Install duckdb, set DUCKDB_BIN, or run with --mode auto / --mode ts.",
      );
    }
    return "duckdb";
  }
  return duckdbAvailable ? "duckdb" : "ts";
}

export interface VerifyColdArchiveArgs {
  dryRun: boolean;
  asOf: string;
  mode: VerifyMode;
  seed: boolean;
  json: boolean;
  help: boolean;
}

export function parseVerifyColdArchiveArgs(
  argv: readonly string[],
): VerifyColdArchiveArgs {
  let dryRun = false;
  let asOf = "2026-11-26";
  let mode: VerifyMode = "auto";
  let seed = true;
  let json = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--no-seed") {
      seed = false;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--as-of") {
      const next = argv[i + 1];
      if (!next || !isIsoDay(next)) {
        throw new Error(
          `Invalid --as-of value "${next ?? ""}" (expected YYYY-MM-DD)`,
        );
      }
      asOf = next;
      i += 1;
    } else if (arg.startsWith("--as-of=")) {
      const value = arg.slice("--as-of=".length);
      if (!isIsoDay(value)) {
        throw new Error(
          `Invalid --as-of value "${value}" (expected YYYY-MM-DD)`,
        );
      }
      asOf = value;
    } else if (arg === "--mode") {
      const next = argv[i + 1];
      if (next !== "auto" && next !== "duckdb" && next !== "ts") {
        throw new Error(
          `Invalid --mode value "${next ?? ""}" (expected auto|duckdb|ts)`,
        );
      }
      mode = next;
      i += 1;
    } else if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value !== "auto" && value !== "duckdb" && value !== "ts") {
        throw new Error(
          `Invalid --mode value "${value}" (expected auto|duckdb|ts)`,
        );
      }
      mode = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dryRun, asOf, mode, seed, json, help };
}
