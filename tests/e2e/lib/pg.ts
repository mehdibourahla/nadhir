import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { e2ePgUrl } from "./env.ts";

function runPsql(args: string[], sql: string, pgUrl: string): string {
  try {
    return execFileSync("psql", [...args, pgUrl], {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 25 * 1024 * 1024,
    });
  } catch (error) {
    const err = error as {
      stderr?: string | Buffer;
      stdout?: string | Buffer;
      message?: string;
    };
    const stderr =
      typeof err.stderr === "string"
        ? err.stderr.trim()
        : err.stderr instanceof Buffer
          ? err.stderr.toString("utf8").trim()
          : "";
    const detail = stderr || err.message || String(error);
    throw new Error(`psql command failed against ${pgUrl}: ${detail}`, {
      cause: error,
    });
  }
}

export function psqlExec(sql: string, pgUrl = e2ePgUrl()): string {
  return runPsql(["-X", "-v", "ON_ERROR_STOP=1", "-q"], sql, pgUrl).trim();
}

export function psqlQuery(sql: string, pgUrl = e2ePgUrl()): string {
  return runPsql(
    ["-X", "-v", "ON_ERROR_STOP=1", "-t", "-A"],
    sql,
    pgUrl,
  ).trim();
}

export function psqlJson<T = Record<string, unknown>>(
  sql: string,
  pgUrl = e2ePgUrl(),
): T[] {
  const cleaned = sql.trim().replace(/;+\s*$/, "");
  const wrapped = `SELECT coalesce(json_agg(t), '[]'::json)::text FROM (\n${cleaned}\n) AS t;`;
  const raw = psqlQuery(wrapped, pgUrl);
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array from psqlJson, got: ${raw}`);
  }
  return parsed as T[];
}

export function assertPgReachable(pgUrl = e2ePgUrl()): void {
  const result = psqlQuery("SELECT 1;", pgUrl);
  if (result !== "1") {
    throw new Error(
      `Local Postgres health check at ${pgUrl} returned unexpected output: "${result}"`,
    );
  }
}

export function runInRolledBackTx(sql: string, pgUrl = e2ePgUrl()): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const txSql = `BEGIN;\n${trimmed};\nROLLBACK;\n`;
  return runPsql(
    ["-X", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-q"],
    txSql,
    pgUrl,
  ).trim();
}

export const withRollbackSql = runInRolledBackTx;

export async function withTempPgSchema<T>(
  fn: (schema: string) => Promise<T> | T,
  pgUrl = e2ePgUrl(),
): Promise<T> {
  const suffix = randomBytes(4).toString("hex");
  const schema = `e2e_tmp_${Date.now()}_${suffix}`;
  psqlExec(`CREATE SCHEMA "${schema}";`, pgUrl);
  try {
    return await fn(schema);
  } finally {
    psqlExec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`, pgUrl);
  }
}
