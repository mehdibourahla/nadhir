import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_PG_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DEFAULT_SUPABASE_URL = "http://127.0.0.1:54321";

export function e2eBaseUrl(): string {
  const raw = process.env.E2E_BASE_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

export function e2ePgUrl(): string {
  const raw = process.env.E2E_PG_URL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_PG_URL;
}

export function e2eScreenshotDir(): string {
  const raw = process.env.E2E_SCREENSHOT_DIR?.trim();
  if (raw && raw.length > 0) {
    return resolve(raw);
  }
  return resolve(REPO_ROOT, "tmp", "e2e-screenshots");
}

export function e2eSupabaseUrl(): string {
  const raw = process.env.E2E_SUPABASE_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_SUPABASE_URL;
  return base.replace(/\/+$/, "");
}

export function e2eSupabaseServiceRoleKey(): string {
  return process.env.E2E_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
}

export function repoPath(...parts: string[]): string {
  return resolve(REPO_ROOT, ...parts);
}

export function repoFileExists(relPath: string): boolean {
  return existsSync(repoPath(relPath));
}

export function readRepoFile(relPath: string): string {
  const absPath = repoPath(relPath);
  if (!existsSync(absPath)) {
    throw new Error(
      `Expected repository file does not exist: ${relPath} (resolved: ${absPath})`,
    );
  }
  return readFileSync(absPath, "utf8");
}

export function readRepoJson<T = unknown>(relPath: string): T {
  const raw = readRepoFile(relPath);
  return JSON.parse(raw) as T;
}

export function listRepoFiles(relDir: string, ext?: string): string[] {
  const rootDir = repoPath(relDir);
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    return [];
  }

  const normalizedExt = ext
    ? ext.startsWith(".")
      ? ext.toLowerCase()
      : `.${ext.toLowerCase()}`
    : undefined;

  const out: string[] = [];

  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (
          !normalizedExt ||
          entry.name.toLowerCase().endsWith(normalizedExt)
        ) {
          const rel = relative(REPO_ROOT, fullPath).split("\\").join(posix.sep);
          out.push(rel);
        }
      }
    }
  };

  walk(rootDir);
  return out.sort((a, b) => a.localeCompare(b));
}

function resolveRepoModulePath(relPath: string): string | null {
  const direct = repoPath(relPath);
  if (existsSync(direct) && statSync(direct).isFile()) {
    return direct;
  }

  const candidateExtensions = [".ts", ".tsx", ".mts", ".js", ".mjs"];
  for (const suffix of candidateExtensions) {
    const withExt = `${direct}${suffix}`;
    if (existsSync(withExt) && statSync(withExt).isFile()) {
      return withExt;
    }
  }

  for (const suffix of candidateExtensions) {
    const indexFile = resolve(direct, `index${suffix}`);
    if (existsSync(indexFile) && statSync(indexFile).isFile()) {
      return indexFile;
    }
  }

  return null;
}

export async function importRepoModule<
  T extends Record<string, unknown> = Record<string, unknown>,
>(relPath: string): Promise<T> {
  const resolvedPath = resolveRepoModulePath(relPath);
  if (!resolvedPath) {
    throw new Error(
      `Missing required repository module: ${relPath} (searched relative to ${REPO_ROOT})`,
    );
  }

  try {
    const url = pathToFileURL(resolvedPath).href;
    const mod = (await import(url)) as T;
    return mod;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to import repository module "${relPath}" (${resolvedPath}): ${message}`,
      { cause: error },
    );
  }
}
