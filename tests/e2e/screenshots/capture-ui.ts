import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { e2eBaseUrl, e2eScreenshotDir } from "../lib/env.ts";
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
  TouchTargetViolation,
} from "../lib/playwright.ts";

export interface CaptureScreenSpec {
  name: string;
  path: string;
  fallbackPath?: string;
}

export const CAPTURE_SCREENS: readonly CaptureScreenSpec[] = [
  { name: "home", path: "/" },
  { name: "alerts", path: "/alerts" },
  { name: "emergency", path: "/survival" },
  { name: "forecast", path: "/forecast" },
  { name: "wilaya-alger", path: "/wilaya/alger" },
  { name: "privacy", path: "/privacy" },
  {
    name: "settings-notifications",
    path: "/settings",
    fallbackPath: "/alerts",
  },
];

export const CAPTURE_VIEWPORTS = ["mobile", "desktop"] as const;
export const CAPTURE_LOCALES = ["ar", "fr"] as const;

export type CaptureViewport = (typeof CAPTURE_VIEWPORTS)[number];
export type CaptureLocale = (typeof CAPTURE_LOCALES)[number];

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

export async function captureUiScreenshots(
  options: CaptureUiOptions = {},
): Promise<AuditMetricsManifest> {
  const baseUrl = (options.baseUrl ?? e2eBaseUrl()).replace(/\/+$/, "");
  const screenshotDir = resolve(options.outputDir ?? e2eScreenshotDir());
  const screens = options.screens ?? CAPTURE_SCREENS;
  const timeoutMs = options.timeoutMs ?? 20_000;

  mkdirSync(screenshotDir, { recursive: true });

  const entries: ScreenAuditMetric[] = [];

  for (const viewport of CAPTURE_VIEWPORTS) {
    for (const locale of CAPTURE_LOCALES) {
      await withBrowserPage(
        {
          locale,
          viewport: VIEWPORTS[viewport],
          baseUrl,
        },
        async (page) => {
          for (const screen of screens) {
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
            let errorMessage: string | null = null;

            try {
              let response = await page.goto(targetUrl, {
                waitUntil: "networkidle",
                timeout: timeoutMs,
              });
              status = response ? response.status() : null;

              if (status === 404 && screen.fallbackPath) {
                targetUrl = buildLocalizedUrl(
                  baseUrl,
                  screen.fallbackPath,
                  locale,
                );
                response = await page.goto(targetUrl, {
                  waitUntil: "networkidle",
                  timeout: timeoutMs,
                });
                status = response ? response.status() : null;
              }

              await page.waitForTimeout(400);
              const resolvedUrl = page.url();
              finalUrl =
                resolvedUrl && resolvedUrl !== "about:blank"
                  ? resolvedUrl
                  : targetUrl;

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
              }
            } catch (error) {
              const resolvedUrl = page.url();
              finalUrl =
                resolvedUrl && resolvedUrl !== "about:blank"
                  ? resolvedUrl
                  : targetUrl;
              errorMessage =
                error instanceof Error ? error.message : String(error);
            }

            entries.push({
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
              screenshotPath,
              error: errorMessage,
            });
          }
        },
      );
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
