import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  e2eBaseUrl,
  e2eScreenshotDir,
  e2eSupabaseServiceRoleKey,
  e2eSupabaseUrl,
} from "../lib/env.ts";
import {
  findBannedSafeLabels,
  findEmDashesInText,
  measureContrastViolations,
  measureHorizontalOverflow,
  measureTouchTargets,
  VIEWPORTS,
  withBrowserPage,
} from "../lib/playwright.ts";
import type {
  ContrastViolation,
  EmDashReport,
  HorizontalOverflowResult,
  PageHandle,
  TouchTargetViolation,
} from "../lib/playwright.ts";

export interface CaptureScreenSpec {
  name: string;
  path: string;
  fallbackPath?: string;
  requiresAuth?: boolean;
}

export const CAPTURE_SCREENS: readonly CaptureScreenSpec[] = [
  { name: "home", path: "/" },
  { name: "alerts", path: "/alerts", requiresAuth: true },
  { name: "emergency", path: "/survival" },
  { name: "forecast", path: "/forecast" },
  { name: "wilaya-alger", path: "/wilaya/alger" },
  { name: "privacy", path: "/privacy" },
  {
    name: "settings-notifications",
    path: "/settings",
    fallbackPath: "/alerts",
    requiresAuth: true,
  },
];

export const CAPTURE_VIEWPORTS = ["mobile", "desktop"] as const;
export const CAPTURE_LOCALES = ["ar", "fr"] as const;

export type CaptureViewport = (typeof CAPTURE_VIEWPORTS)[number];
export type CaptureLocale = (typeof CAPTURE_LOCALES)[number];

export interface FailedRequestEntry {
  url: string;
  status: number;
}

export interface ScreenAuditMetric {
  screen: string;
  path: string;
  url: string;
  viewport: CaptureViewport;
  locale: CaptureLocale;
  status: number;
  dir: string;
  lang: string;
  overflow: HorizontalOverflowResult;
  touchTargetViolations: TouchTargetViolation[];
  contrastViolations: ContrastViolation[];
  emDashes: EmDashReport;
  bannedSafeLabels: string[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: FailedRequestEntry[];
  redirectedToAuth: boolean;
  screenshotPath: string;
  error: string | null;
}

export interface AuditMetricsManifest {
  generatedAt: string;
  baseUrl: string;
  screenshotDir: string;
  totalScreenshots: number;
  entries: ScreenAuditMetric[];
}

export interface CaptureUiOptions {
  baseUrl?: string;
  outputDir?: string;
  screens?: readonly CaptureScreenSpec[];
  timeoutMs?: number;
}

interface EphemeralLocalUser {
  id: string;
  email: string;
  password: string;
  supabaseUrl: string;
  serviceRoleKey: string;
}

function buildLocalizedUrl(
  baseUrl: string,
  routePath: string,
  locale: CaptureLocale,
): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const sep = cleanPath.includes("?") ? "&" : "?";
  return `${cleanBase}${cleanPath}${sep}lang=${locale}`;
}

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    if (parsed.username !== "" || parsed.password !== "") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}

async function provisionEphemeralLocalUser(): Promise<EphemeralLocalUser | null> {
  const serviceRoleKey = e2eSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    return null;
  }

  const supabaseUrl = e2eSupabaseUrl();
  if (!isLoopbackUrl(supabaseUrl)) {
    throw new Error(
      `Refusing to provision ephemeral screenshot user against non-loopback E2E_SUPABASE_URL: ${supabaseUrl}`,
    );
  }

  const suffix = randomUUID();
  const email = `e2e-ui-screenshot-${suffix}@local.test`;
  const password = `NadhirE2e!${suffix.slice(0, 12)}`;
  const authHeaders = {
    Authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey,
    "Content-Type": "application/json",
  };

  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Nadhir E2E" },
    }),
  });
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(
      `Failed to provision ephemeral local auth user (HTTP ${createRes.status}): ${body.slice(0, 240)}`,
    );
  }

  const created = (await createRes.json()) as {
    id?: string;
    user?: { id?: string };
  };
  const userId = created.id ?? created.user?.id;
  if (!userId) {
    throw new Error("Local GoTrue admin user creation did not return user id");
  }

  const user: EphemeralLocalUser = {
    id: userId,
    email,
    password,
    supabaseUrl,
    serviceRoleKey,
  };

  try {
    // Seed 1 realistic watch zone and 1 unread local alert so /alerts renders
    // a real 2-second AlertCard + "Why am I seeing this?" AlertProvenance footer.
    const zoneRes = await fetch(`${supabaseUrl}/rest/v1/zones`, {
      method: "POST",
      headers: {
        ...authHeaders,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        user_id: userId,
        name: "Bab El Oued, Alger",
        lat: 36.7905,
        lon: 3.0497,
        radius_km: 15,
        min_danger_level: 3,
        active: true,
      }),
    });
    if (!zoneRes.ok) {
      const body = await zoneRes.text().catch(() => "");
      throw new Error(
        `Failed to seed ephemeral watch zone (HTTP ${zoneRes.status}): ${body.slice(0, 240)}`,
      );
    }
    const zones = (await zoneRes.json()) as Array<{ id?: string }>;
    const zoneId = zones[0]?.id ?? null;

    const observedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const expiresAt = new Date(Date.now() + 6 * 3_600_000).toISOString();
    const alertRes = await fetch(`${supabaseUrl}/rest/v1/alerts`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        user_id: userId,
        zone_id: zoneId,
        kind: "weather",
        severity: 4,
        dedupe_key: `e2e-ui-screenshot-${suffix}`,
        title: "BMS Pluies Niveau 2 (Orange) · Alger",
        body: "Office National de la Météorologie (ONM) : fortes pluies orageuses observées et attendues sur la wilaya d'Alger.",
        push_state: "skipped",
        payload: {
          onm_severity: "Severe",
          hazard: "rain",
          expires_at: expiresAt,
          authority: "Office National de la Météorologie (ONM)",
          provenance_trigger: "watch_zone",
          provenance_area: "Bab El Oued, Alger",
          provenance_radius_km: "15",
          provenance_source_key: "onm",
          provenance_source: "Office National de la Météorologie (ONM)",
          provenance_rule: "provenance.rule.onmSevere",
          provenance_observed_at: observedAt,
          provenance_authority_status: "official",
        },
      }),
    });
    if (!alertRes.ok) {
      const body = await alertRes.text().catch(() => "");
      throw new Error(
        `Failed to seed ephemeral alert (HTTP ${alertRes.status}): ${body.slice(0, 240)}`,
      );
    }
  } catch (error) {
    await cleanupEphemeralLocalUser(user);
    throw error;
  }

  return user;
}

async function cleanupEphemeralLocalUser(
  user: EphemeralLocalUser,
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${user.serviceRoleKey}`,
    apikey: user.serviceRoleKey,
  };
  const cleanupErrors: string[] = [];

  for (const table of ["alerts", "zones", "privacy_consents"]) {
    try {
      const res = await fetch(
        `${user.supabaseUrl}/rest/v1/${table}?user_id=eq.${encodeURIComponent(user.id)}`,
        { method: "DELETE", headers },
      );
      if (!res.ok && res.status !== 404) {
        cleanupErrors.push(`${table} HTTP ${res.status}`);
      }
    } catch (err) {
      cleanupErrors.push(
        `${table}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  try {
    const res = await fetch(
      `${user.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
      { method: "DELETE", headers },
    );
    if (!res.ok && res.status !== 404) {
      cleanupErrors.push(`auth.users HTTP ${res.status}`);
    }
  } catch (err) {
    cleanupErrors.push(
      `auth.users: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (cleanupErrors.length > 0) {
    throw new Error(
      `Ephemeral screenshot user cleanup failed: ${cleanupErrors.join("; ")}`,
    );
  }
}

async function signInViaLocalAuth(
  page: PageHandle,
  baseUrl: string,
  locale: CaptureLocale,
  user: EphemeralLocalUser,
  timeoutMs: number,
): Promise<void> {
  const authUrl = buildLocalizedUrl(baseUrl, "/auth", locale);
  const res = await page.goto(authUrl, {
    waitUntil: "networkidle",
    timeout: timeoutMs,
  });
  if (!res || res.status() >= 400) {
    throw new Error(
      `Failed to open /auth for local sign-in (HTTP ${res?.status() ?? 0})`,
    );
  }

  await page.waitForSelector('input[type="email"]', {
    state: "visible",
    timeout: timeoutMs,
  });
  await page.locator('input[type="email"]').fill(user.email, {
    timeout: timeoutMs,
  });
  await page.locator("#password").fill(user.password, {
    timeout: timeoutMs,
  });
  await page.locator('form button:not([type="button"])').first().click({
    timeout: timeoutMs,
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = page.url();
    try {
      const parsed = new URL(current);
      if (parsed.pathname !== "/auth") {
        await page.waitForLoadState("networkidle", { timeout: timeoutMs });
        await page.waitForTimeout(300);
        return;
      }
    } catch {
      // ignore transient URLs
    }
    await page.waitForTimeout(150);
  }

  throw new Error(
    `Timed out waiting for local sign-in redirect off /auth (still at ${page.url()})`,
  );
}

interface ScreenTelemetryBuffer {
  active: boolean;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: FailedRequestEntry[];
}

function attachTelemetryListeners(
  page: PageHandle,
  buffer: ScreenTelemetryBuffer,
): void {
  page.on("console", (msgArg) => {
    if (!buffer.active || !msgArg || typeof msgArg !== "object") return;
    const msg = msgArg as { type?: () => string; text?: () => string };
    if (typeof msg.type === "function" && msg.type() === "error") {
      const text = typeof msg.text === "function" ? msg.text() : String(msgArg);
      buffer.consoleErrors.push(text.slice(0, 400));
    }
  });

  page.on("pageerror", (errArg) => {
    if (!buffer.active) return;
    const text =
      errArg instanceof Error ? errArg.message : String(errArg ?? "pageerror");
    buffer.pageErrors.push(text.slice(0, 400));
  });

  page.on("response", (resArg) => {
    if (!buffer.active || !resArg || typeof resArg !== "object") return;
    const res = resArg as { status?: () => number; url?: () => string };
    const status = typeof res.status === "function" ? res.status() : 0;
    if (status >= 400) {
      const url = typeof res.url === "function" ? res.url() : "";
      buffer.failedRequests.push({ url, status });
    }
  });
}

async function captureScreenOnPage(args: {
  page: PageHandle;
  buffer: ScreenTelemetryBuffer;
  screen: CaptureScreenSpec;
  viewport: CaptureViewport;
  locale: CaptureLocale;
  baseUrl: string;
  screenshotDir: string;
  timeoutMs: number;
  expectAuthenticated: boolean;
}): Promise<ScreenAuditMetric> {
  const {
    page,
    buffer,
    screen,
    viewport,
    locale,
    baseUrl,
    screenshotDir,
    timeoutMs,
    expectAuthenticated,
  } = args;

  const filename = `${screen.name}__${viewport}__${locale}.png`;
  const screenshotPath = join(screenshotDir, filename);
  let targetUrl = buildLocalizedUrl(baseUrl, screen.path, locale);
  let finalUrl: string;
  let status: number | null = null;
  let dir = "";
  let lang = "";
  let overflow: HorizontalOverflowResult = {
    scrollWidth: 0,
    clientWidth: VIEWPORTS[viewport].width,
    hasOverflow: false,
  };
  let touchTargetViolations: TouchTargetViolation[] = [];
  let contrastViolations: ContrastViolation[] = [];
  let emDashes: EmDashReport = { count: 0, excerpts: [] };
  let bannedSafeLabels: string[] = [];
  let redirectedToAuth: boolean;
  let errorMessage: string | null = null;

  buffer.consoleErrors = [];
  buffer.pageErrors = [];
  buffer.failedRequests = [];
  buffer.active = true;

  try {
    let response = await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    });
    status = response ? response.status() : null;

    if (status === 404 && screen.fallbackPath) {
      targetUrl = buildLocalizedUrl(baseUrl, screen.fallbackPath, locale);
      response = await page.goto(targetUrl, {
        waitUntil: "networkidle",
        timeout: timeoutMs,
      });
      status = response ? response.status() : null;
    }

    await page.waitForTimeout(screen.requiresAuth ? 800 : 400);
    const resolvedUrl = page.url();
    finalUrl =
      resolvedUrl && resolvedUrl !== "about:blank" ? resolvedUrl : targetUrl;

    try {
      redirectedToAuth = new URL(finalUrl).pathname === "/auth";
    } catch {
      redirectedToAuth = finalUrl.includes("/auth");
    }

    const docMeta = await page.evaluate(() => ({
      dir: document.documentElement.getAttribute("dir") ?? "",
      lang: document.documentElement.getAttribute("lang") ?? "",
      visibleText: document.body?.innerText ?? "",
    }));

    dir = docMeta.dir;
    lang = docMeta.lang;
    overflow = await measureHorizontalOverflow(page);
    touchTargetViolations = await measureTouchTargets(page, 44);
    contrastViolations = await measureContrastViolations(page, 4.5);
    emDashes = findEmDashesInText(docMeta.visibleText);
    bannedSafeLabels = findBannedSafeLabels(docMeta.visibleText);

    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      type: "png",
    });

    if (status === null || status >= 400) {
      errorMessage = `HTTP ${status} on ${finalUrl}`;
    } else if (expectAuthenticated && redirectedToAuth) {
      errorMessage = `Authenticated screen "${screen.name}" unexpectedly redirected to ${finalUrl}`;
    }
  } catch (error) {
    const resolvedUrl = page.url();
    finalUrl =
      resolvedUrl && resolvedUrl !== "about:blank" ? resolvedUrl : targetUrl;
    try {
      redirectedToAuth = new URL(finalUrl).pathname === "/auth";
    } catch {
      redirectedToAuth = finalUrl.includes("/auth");
    }
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    buffer.active = false;
  }

  return {
    screen: screen.name,
    path: screen.path,
    url: finalUrl,
    viewport,
    locale,
    status: status ?? 0,
    dir,
    lang,
    overflow,
    touchTargetViolations,
    contrastViolations,
    emDashes,
    bannedSafeLabels,
    consoleErrors: [...buffer.consoleErrors],
    pageErrors: [...buffer.pageErrors],
    failedRequests: [...buffer.failedRequests],
    redirectedToAuth,
    screenshotPath,
    error: errorMessage,
  };
}

export async function captureUiScreenshots(
  options: CaptureUiOptions = {},
): Promise<AuditMetricsManifest> {
  const baseUrl = (options.baseUrl ?? e2eBaseUrl()).replace(/\/+$/, "");
  const screenshotDir = resolve(options.outputDir ?? e2eScreenshotDir());
  const screens = options.screens ?? CAPTURE_SCREENS;
  const timeoutMs = options.timeoutMs ?? 20_000;

  mkdirSync(screenshotDir, { recursive: true });

  const needsAuthProvisioning = screens.some((s) => s.requiresAuth);
  const ephemeralUser = needsAuthProvisioning
    ? await provisionEphemeralLocalUser()
    : null;

  const entries: ScreenAuditMetric[] = [];

  try {
    for (const viewport of CAPTURE_VIEWPORTS) {
      for (const locale of CAPTURE_LOCALES) {
        const byName = new Map<string, ScreenAuditMetric>();
        const publicScreens = screens.filter((s) => !s.requiresAuth);
        const authScreens = screens.filter((s) => s.requiresAuth);

        await withBrowserPage(
          {
            locale,
            viewport: VIEWPORTS[viewport],
            baseUrl,
          },
          async (page) => {
            const buffer: ScreenTelemetryBuffer = {
              active: false,
              consoleErrors: [],
              pageErrors: [],
              failedRequests: [],
            };
            attachTelemetryListeners(page, buffer);

            for (const screen of publicScreens) {
              const entry = await captureScreenOnPage({
                page,
                buffer,
                screen,
                viewport,
                locale,
                baseUrl,
                screenshotDir,
                timeoutMs,
                expectAuthenticated: false,
              });
              byName.set(screen.name, entry);
            }

            if (authScreens.length > 0) {
              if (ephemeralUser) {
                await signInViaLocalAuth(
                  page,
                  baseUrl,
                  locale,
                  ephemeralUser,
                  timeoutMs,
                );
              }

              for (const screen of authScreens) {
                const entry = await captureScreenOnPage({
                  page,
                  buffer,
                  screen,
                  viewport,
                  locale,
                  baseUrl,
                  screenshotDir,
                  timeoutMs,
                  expectAuthenticated: ephemeralUser !== null,
                });
                byName.set(screen.name, entry);
              }
            }
          },
        );

        for (const screen of screens) {
          const entry = byName.get(screen.name);
          if (entry) entries.push(entry);
        }
      }
    }
  } finally {
    if (ephemeralUser) {
      await cleanupEphemeralLocalUser(ephemeralUser);
    }
  }

  const manifest: AuditMetricsManifest = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    screenshotDir,
    totalScreenshots: entries.filter((entry) => entry.error === null).length,
    entries,
  };

  writeFileSync(
    join(screenshotDir, "audit-metrics.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

async function main(): Promise<void> {
  const manifest = await captureUiScreenshots();
  const failed = manifest.entries.filter((entry) => entry.error !== null);
  console.log(
    `Captured ${manifest.totalScreenshots}/${manifest.entries.length} UI screenshots in ${manifest.screenshotDir}`,
  );
  console.log(
    `Telemetry written to ${join(manifest.screenshotDir, "audit-metrics.json")}`,
  );
  if (failed.length > 0) {
    for (const entry of failed) {
      console.error(
        `[FAIL] ${entry.screen} (${entry.viewport}/${entry.locale}): ${entry.error}`,
      );
    }
    process.exit(1);
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  process.argv[1].endsWith("capture-ui.ts");

if (isDirectExecution) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`UI screenshot capture failed: ${message}`);
    process.exit(1);
  });
}
