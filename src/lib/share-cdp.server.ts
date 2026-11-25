import type { ShareImageCodec } from "@/lib/share-card";

export interface CaptureAttempt {
  codec: ShareImageCodec;
  quality?: number;
  scale: number;
}

export interface CapturePageOptions {
  width: number;
  height: number;
  omitBackground: boolean;
}

export type CaptureDecision = {
  done: boolean;
  bytes: Uint8Array<ArrayBuffer>;
};

export function isCloudflareWorkersRuntime(): boolean {
  return (
    typeof globalThis.navigator !== "undefined" &&
    globalThis.navigator?.userAgent === "Cloudflare-Workers"
  );
}

async function discoverChromeBinary(): Promise<string | null> {
  const [{ existsSync, readdirSync }, os, path] = await Promise.all([
    import("node:fs"),
    import("node:os"),
    import("node:path"),
  ]);

  const envBin =
    process.env["SHARE_CHROME_BIN"]?.trim() ||
    process.env["CHROME_PATH"]?.trim();
  if (envBin && existsSync(envBin)) {
    return envBin;
  }

  const home = os.homedir();
  const playwrightDirs = [
    process.env["PLAYWRIGHT_BROWSERS_PATH"]?.trim(),
    path.join(home, "Library", "Caches", "ms-playwright"),
    path.join(home, ".cache", "ms-playwright"),
  ].filter((d): d is string => Boolean(d));

  const parseRevision = (dirName: string): number => {
    const match = dirName.match(/-(\d+)$/);
    return match ? Number.parseInt(match[1]!, 10) : 0;
  };

  for (const baseDir of playwrightDirs) {
    if (!existsSync(baseDir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(baseDir);
    } catch {
      continue;
    }

    const headlessDirs = entries
      .filter((name) => name.startsWith("chromium_headless_shell-"))
      .sort((a, b) => parseRevision(b) - parseRevision(a));

    for (const dir of headlessDirs) {
      const candidates = [
        path.join(
          baseDir,
          dir,
          "chrome-headless-shell-mac-arm64",
          "chrome-headless-shell",
        ),
        path.join(
          baseDir,
          dir,
          "chrome-headless-shell-mac-x64",
          "chrome-headless-shell",
        ),
        path.join(
          baseDir,
          dir,
          "chrome-headless-shell-linux64",
          "chrome-headless-shell",
        ),
        path.join(baseDir, dir, "chrome-linux", "headless_shell"),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }

    const fullDirs = entries
      .filter((name) => name.startsWith("chromium-"))
      .sort((a, b) => parseRevision(b) - parseRevision(a));

    for (const dir of fullDirs) {
      const candidates = [
        path.join(
          baseDir,
          dir,
          "chrome-mac-arm64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        path.join(
          baseDir,
          dir,
          "chrome-mac-x64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        path.join(
          baseDir,
          dir,
          "chrome-mac",
          "Chromium.app",
          "Contents",
          "MacOS",
          "Chromium",
        ),
        path.join(baseDir, dir, "chrome-linux64", "chrome"),
        path.join(baseDir, dir, "chrome-linux", "chrome"),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  const systemCandidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  for (const candidate of systemCandidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

interface PendingRpc {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const IDLE_SHUTDOWN_MS = 30_000;
const RPC_TIMEOUT_MS = 15_000;
const LAUNCH_TIMEOUT_MS = 15_000;

class LocalCdpBrowser {
  private readonly proc: import("node:child_process").ChildProcess;
  private readonly ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRpc>();
  private closed = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private activeCaptures = 0;

  constructor(
    proc: import("node:child_process").ChildProcess,
    ws: WebSocket,
    private readonly onClosed: () => void,
  ) {
    this.proc = proc;
    this.ws = ws;

    this.ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) return;
      let msg: {
        id?: number;
        result?: Record<string, unknown>;
        error?: { message?: string };
      };
      try {
        msg = JSON.parse(raw) as typeof msg;
      } catch {
        return;
      }
      if (typeof msg.id !== "number") return;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        entry.reject(new Error(msg.error.message || "CDP command failed"));
      } else {
        entry.resolve(msg.result ?? {});
      }
    });

    const handleDisconnect = () => {
      this.teardown();
    };
    this.ws.addEventListener("close", handleDisconnect);
    this.ws.addEventListener("error", handleDisconnect);
    this.proc.once("exit", handleDisconnect);
  }

  isAlive(): boolean {
    return (
      !this.closed &&
      this.proc.exitCode === null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleShutdown(): void {
    this.clearIdleTimer();
    if (this.closed || this.activeCaptures > 0) return;
    this.idleTimer = setTimeout(() => {
      this.teardown();
    }, IDLE_SHUTDOWN_MS);
    if (typeof this.idleTimer.unref === "function") {
      this.idleTimer.unref();
    }
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    if (!this.isAlive()) {
      return Promise.reject(new Error("Local CDP browser is not connected"));
    }
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout on ${method}`));
      }, RPC_TIMEOUT_MS);
      if (typeof timer.unref === "function") timer.unref();

      this.pending.set(id, { resolve, reject, timer });
      const payload: Record<string, unknown> = { id, method, params };
      if (sessionId) payload["sessionId"] = sessionId;
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async captureWithLadder(
    html: string,
    pageOpts: CapturePageOptions,
    runAttempts: (
      capture: (attempt: CaptureAttempt) => Promise<Uint8Array<ArrayBuffer>>,
    ) => Promise<Uint8Array<ArrayBuffer>>,
  ): Promise<Uint8Array<ArrayBuffer>> {
    this.activeCaptures += 1;
    this.clearIdleTimer();
    let targetId: string | null = null;
    try {
      const created = await this.send("Target.createTarget", {
        url: "about:blank",
      });
      targetId = String(created["targetId"] ?? "");
      if (!targetId) throw new Error("Target.createTarget returned empty id");

      const attached = await this.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const sessionId = String(attached["sessionId"] ?? "");
      if (!sessionId)
        throw new Error("Target.attachToTarget returned empty session");

      await this.send("Page.enable", {}, sessionId);
      await this.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: pageOpts.width,
          height: pageOpts.height,
          deviceScaleFactor: 1,
          mobile: false,
        },
        sessionId,
      );

      if (pageOpts.omitBackground) {
        await this.send(
          "Emulation.setDefaultBackgroundColorOverride",
          { color: { r: 0, g: 0, b: 0, a: 0 } },
          sessionId,
        );
      }

      const tree = await this.send("Page.getFrameTree", {}, sessionId);
      const frame = (
        tree["frameTree"] as { frame?: { id?: string } } | undefined
      )?.frame;
      const frameId = frame?.id;
      if (!frameId) throw new Error("Page.getFrameTree returned no frame id");

      await this.send("Page.setDocumentContent", { frameId, html }, sessionId);
      await this.send(
        "Runtime.evaluate",
        {
          expression:
            "document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true",
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      );

      let currentScale = 1;
      return await runAttempts(async (attempt) => {
        if (attempt.scale !== currentScale) {
          await this.send(
            "Emulation.setDeviceMetricsOverride",
            {
              width: pageOpts.width,
              height: pageOpts.height,
              deviceScaleFactor: attempt.scale,
              mobile: false,
            },
            sessionId,
          );
          currentScale = attempt.scale;
        }
        const shotParams: Record<string, unknown> = {
          format: attempt.codec,
          fromSurface: true,
        };
        if (
          (attempt.codec === "webp" || attempt.codec === "jpeg") &&
          typeof attempt.quality === "number"
        ) {
          shotParams["quality"] = attempt.quality;
        }
        const shot = await this.send(
          "Page.captureScreenshot",
          shotParams,
          sessionId,
        );
        const b64 = String(shot["data"] ?? "");
        if (!b64) throw new Error("Page.captureScreenshot returned empty data");
        const buf = Buffer.from(b64, "base64");
        const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
        out.set(buf);
        return out;
      });
    } finally {
      if (targetId && this.isAlive()) {
        await this.send("Target.closeTarget", { targetId }).catch(() => {});
      }
      this.activeCaptures = Math.max(0, this.activeCaptures - 1);
      this.scheduleIdleShutdown();
    }
  }

  teardown(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearIdleTimer();
    this.onClosed();

    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Local CDP browser closed"));
      this.pending.delete(id);
    }
    try {
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
    } catch {
      // ignore close errors
    }
    try {
      if (this.proc.exitCode === null) {
        this.proc.kill("SIGKILL");
      }
    } catch {
      // ignore kill errors
    }
  }
}

let sharedBrowser: LocalCdpBrowser | null = null;
let launchPromise: Promise<LocalCdpBrowser | null> | null = null;
let hooksRegistered = false;

function registerProcessCleanup(): void {
  if (hooksRegistered || typeof process === "undefined") return;
  hooksRegistered = true;
  const cleanup = () => {
    sharedBrowser?.teardown();
    sharedBrowser = null;
  };
  process.once("exit", cleanup);
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
}

async function launchLocalBrowser(): Promise<LocalCdpBrowser | null> {
  if (isCloudflareWorkersRuntime()) return null;
  if (typeof WebSocket !== "function") return null;

  const chromeBin = await discoverChromeBinary();
  if (!chromeBin) return null;

  const { spawn } = await import("node:child_process");
  registerProcessCleanup();

  const proc = spawn(
    chromeBin,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--hide-scrollbars",
      "--remote-debugging-port=0",
      "about:blank",
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );

  const wsUrl = await new Promise<string>((resolve, reject) => {
    let stderrBuf = "";
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(new Error("Timed out waiting for Chromium CDP endpoint"));
    }, LAUNCH_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();

    const onData = (chunk: Buffer | string) => {
      stderrBuf += String(chunk);
      const match = stderrBuf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        proc.stderr?.off("data", onData);
        resolve(match[1]!);
      }
    };

    proc.stderr?.on("data", onData);
    proc.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Chromium exited before CDP ready (code ${String(code)}): ${stderrBuf.slice(0, 200)}`,
        ),
      );
    });
  });

  let ws: WebSocket;
  try {
    ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          // ignore
        }
        reject(new Error("Timed out connecting to Chromium CDP WebSocket"));
      }, LAUNCH_TIMEOUT_MS);
      if (typeof timer.unref === "function") timer.unref();

      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Failed to connect to Chromium CDP WebSocket"));
      });
    });
  } catch (err) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
    throw err;
  }

  const instance = new LocalCdpBrowser(proc, ws, () => {
    if (sharedBrowser === instance) {
      sharedBrowser = null;
    }
  });
  return instance;
}

export async function getLocalShareBrowser(): Promise<LocalCdpBrowser | null> {
  if (isCloudflareWorkersRuntime()) return null;
  if (sharedBrowser && sharedBrowser.isAlive()) {
    return sharedBrowser;
  }
  if (!launchPromise) {
    launchPromise = launchLocalBrowser()
      .then((browser) => {
        sharedBrowser = browser;
        return browser;
      })
      .catch((err) => {
        console.error("local share browser launch failed", err);
        return null;
      })
      .finally(() => {
        launchPromise = null;
      });
  }
  return launchPromise;
}

export async function closeLocalShareBrowser(): Promise<void> {
  const pending = launchPromise;
  if (pending) {
    await pending.catch(() => null);
  }
  if (sharedBrowser) {
    sharedBrowser.teardown();
    sharedBrowser = null;
  }
}
