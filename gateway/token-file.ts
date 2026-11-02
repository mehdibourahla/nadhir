import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";

import {
  CodexLogin,
  type CodexLoginRpc,
  type LoginStorage,
} from "../src/lib/llm/codex-login.server";
import type { DeviceLogin } from "../src/lib/llm/codex-device-login";

const LOCK_STALE_MS = 60_000;
const LOCK_WAIT_MS = 30_000;
const LOCK_POLL_MS = 25;

function parseOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function fileStorage(path: string): LoginStorage {
  return {
    async get<T>(): Promise<T | undefined> {
      const text = await readFile(path, "utf8").catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error("login file unreadable", { cause: error });
      });
      if (text === null) return undefined;
      // a parse error message can quote the file, so it is never passed on
      const parsed = parseOrNull(text);
      if (parsed === null) throw new Error("login file malformed");
      return parsed as T;
    },
    async put(_key: string, value: unknown) {
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
      await rename(temp, path);
    },
  };
}

// an O_EXCL lock file: the gateway and the login helper never refresh one grant at the same time
export async function withFileLock<T>(
  path: string,
  work: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const lock = `${path}.lock`;
  const deadline = now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(lock, "wx", 0o600);
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const held = await stat(lock).catch(() => null);
      if (held && now() - held.mtimeMs > LOCK_STALE_MS)
        await rm(lock, { force: true });
      else if (now() > deadline)
        throw new Error("login file lock timeout", { cause: error });
      else await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  try {
    return await work();
  } finally {
    await rm(lock, { force: true });
  }
}

export function writeLogin(path: string, login: DeviceLogin): Promise<void> {
  return withFileLock(path, () =>
    fileStorage(path).put("login", {
      record: login,
      pausedUntil: 0,
      stale: false,
    }),
  );
}

// every call re-reads the file under the lock, so a refresh by another process is seen
export function fileLogin(
  path: string,
  options: { usageCeiling: number; now?: () => number },
): CodexLoginRpc {
  let queue: Promise<unknown> = Promise.resolve();
  const locked = <T>(work: (login: CodexLogin) => Promise<T>): Promise<T> => {
    const run = queue.then(() =>
      withFileLock(path, () =>
        work(
          new CodexLogin({
            storage: fileStorage(path),
            seed: () => undefined,
            usageCeiling: options.usageCeiling,
            ...(options.now ? { now: options.now } : {}),
          }),
        ),
      ),
    );
    queue = run.catch(() => {});
    return run;
  };
  return {
    lease: () => locked((login) => login.lease()),
    report: (token, outcome) => locked((login) => login.report(token, outcome)),
  };
}

export type LoginStatus = {
  login: "missing" | "present" | "stale" | "unreadable";
  pausedUntil: number | null;
};

export async function loginStatus(
  path: string,
  now: number,
): Promise<LoginStatus> {
  let state: { record?: unknown; pausedUntil?: unknown; stale?: unknown };
  try {
    state = (await fileStorage(path).get<typeof state>("login")) ?? {};
  } catch {
    return { login: "unreadable", pausedUntil: null };
  }
  const pausedUntil =
    typeof state.pausedUntil === "number" && state.pausedUntil > now
      ? state.pausedUntil
      : null;
  return {
    login: !state.record ? "missing" : state.stale ? "stale" : "present",
    pausedUntil,
  };
}
