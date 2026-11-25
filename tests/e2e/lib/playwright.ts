import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface ViewportSize {
  width: number;
  height: number;
}

export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  narrowMobile: { width: 320, height: 568 },
  desktop: { width: 1440, height: 900 },
} as const satisfies Record<string, ViewportSize>;

export type ViewportName = keyof typeof VIEWPORTS;
export type E2ELocale = "ar" | "fr" | "en" | "kab";

export interface PlaywrightRequestHandle {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
}

export interface PlaywrightRouteHandle {
  request(): PlaywrightRequestHandle;
  fulfill(response: {
    status?: number;
    contentType?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
  }): Promise<void>;
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

export interface PlaywrightResponseHandle {
  status(): number;
  ok(): boolean;
  url(): string;
  headers(): Record<string, string>;
}

export interface PlaywrightBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlaywrightLocatorHandle {
  count(): Promise<number>;
  first(): PlaywrightLocatorHandle;
  nth(index: number): PlaywrightLocatorHandle;
  textContent(): Promise<string | null>;
  innerText(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  isVisible(): Promise<boolean>;
  click(options?: { timeout?: number; force?: boolean }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  boundingBox(): Promise<PlaywrightBoundingBox | null>;
  waitFor(options?: {
    state?: "attached" | "detached" | "visible" | "hidden";
    timeout?: number;
  }): Promise<void>;
}

export interface PageHandle {
  goto(
    url: string,
    options?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
      timeout?: number;
    },
  ): Promise<PlaywrightResponseHandle | null>;
  setContent(
    html: string,
    options?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
      timeout?: number;
    },
  ): Promise<void>;
  content(): Promise<string>;
  url(): string;
  title(): Promise<string>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  locator(selector: string): PlaywrightLocatorHandle;
  waitForSelector(
    selector: string,
    options?: {
      state?: "attached" | "detached" | "visible" | "hidden";
      timeout?: number;
    },
  ): Promise<unknown>;
  waitForTimeout(timeout: number): Promise<void>;
  waitForLoadState(
    state?: "load" | "domcontentloaded" | "networkidle",
    options?: { timeout?: number },
  ): Promise<void>;
  screenshot(options?: {
    path?: string;
    fullPage?: boolean;
    type?: "png" | "jpeg";
  }): Promise<Buffer>;
  route(
    url: string | RegExp,
    handler: (route: PlaywrightRouteHandle) => void | Promise<void>,
  ): Promise<void>;
  keyboard: {
    press(key: string): Promise<void>;
  };
  close(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export interface BrowserContextHandle {
  newPage(): Promise<PageHandle>;
  setOffline(offline: boolean): Promise<void>;
  route(
    url: string | RegExp,
    handler: (route: PlaywrightRouteHandle) => void | Promise<void>,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserHandle {
  newContext(options?: {
    viewport?: ViewportSize;
    locale?: string;
    hasTouch?: boolean;
    baseURL?: string;
    offline?: boolean;
  }): Promise<BrowserContextHandle>;
  version(): string;
  close(): Promise<void>;
}

export interface PlaywrightModule {
  chromium: {
    launch(options?: {
      headless?: boolean;
      args?: string[];
    }): Promise<BrowserHandle>;
    executablePath(): string;
  };
}

export interface MockRouteRule {
  url: string | RegExp;
  status?: number;
  contentType?: string;
  headers?: Record<string, string>;
  body: string | Buffer;
}

export interface BrowserPageOptions {
  locale?: E2ELocale;
  viewport?: ViewportName | ViewportSize;
  baseUrl?: string;
  offline?: boolean;
  mockRoutes?: MockRouteRule[];
  hasTouch?: boolean;
}

export interface HorizontalOverflowResult {
  scrollWidth: number;
  clientWidth: number;
  hasOverflow: boolean;
}

export interface TouchTargetViolation {
  selector: string;
  text: string;
  width: number;
  height: number;
}

export interface ContrastViolation {
  text: string;
  ratio: number;
  fg: string;
  bg: string;
  selector: string;
}

export interface EmDashReport {
  count: number;
  excerpts: string[];
}

let cachedPlaywright: PlaywrightModule | null = null;

function resolvePlaywrightCandidates(): string[] {
  const candidates: string[] = [];

  const envPath = process.env.PLAYWRIGHT_PACKAGE_PATH?.trim();
  if (envPath) {
    const resolvedEnv = resolve(envPath);
    candidates.push(resolvedEnv, join(resolvedEnv, "index.mjs"));
  }

  try {
    const npmGlobalRoot = execSync("npm root -g", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (npmGlobalRoot) {
      candidates.push(join(npmGlobalRoot, "playwright", "index.mjs"));
    }
  } catch {
    // Continue to fallback candidate scans.
  }

  const fnmVersionsDir = join(
    homedir(),
    ".local",
    "share",
    "fnm",
    "node-versions",
  );
  if (existsSync(fnmVersionsDir)) {
    const versions = readdirSync(fnmVersionsDir).sort((a, b) =>
      b.localeCompare(a),
    );
    for (const version of versions) {
      candidates.push(
        join(
          fnmVersionsDir,
          version,
          "installation",
          "lib",
          "node_modules",
          "playwright",
          "index.mjs",
        ),
      );
    }
  }

  candidates.push(
    "/opt/homebrew/lib/node_modules/playwright/index.mjs",
    "/usr/local/lib/node_modules/playwright/index.mjs",
  );

  return candidates;
}

function isPlaywrightModule(value: unknown): value is PlaywrightModule {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const chromium = record.chromium;
  if (typeof chromium !== "object" || chromium === null) return false;
  const chromiumRecord = chromium as Record<string, unknown>;
  return typeof chromiumRecord.launch === "function";
}

export async function loadPlaywright(): Promise<PlaywrightModule> {
  if (cachedPlaywright) {
    return cachedPlaywright;
  }

  const candidates = resolvePlaywrightCandidates();
  const attempted: string[] = [];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    attempted.push(candidate);
    try {
      const imported: unknown = await import(pathToFileURL(candidate).href);
      if (isPlaywrightModule(imported)) {
        cachedPlaywright = imported;
        return imported;
      }
      if (
        typeof imported === "object" &&
        imported !== null &&
        "default" in imported &&
        isPlaywrightModule((imported as { default: unknown }).default)
      ) {
        const mod = (imported as { default: PlaywrightModule }).default;
        cachedPlaywright = mod;
        return mod;
      }
    } catch {
      try {
        const req = createRequire(import.meta.url);
        const cjsPath = candidate.endsWith("index.mjs")
          ? candidate.replace(/index\.mjs$/, "index.js")
          : candidate;
        const required: unknown = req(cjsPath);
        if (isPlaywrightModule(required)) {
          cachedPlaywright = required;
          return required;
        }
      } catch {
        // Try next candidate.
      }
    }
  }

  throw new Error(
    `Unable to locate global Playwright installation. Set PLAYWRIGHT_PACKAGE_PATH or install playwright globally. Checked: ${attempted.join(", ") || candidates.join(", ")}`,
  );
}

const BCP47_LOCALE: Record<E2ELocale, string> = {
  ar: "ar-DZ",
  fr: "fr-DZ",
  en: "en-US",
  kab: "kab-DZ",
};

function resolveViewport(
  viewport: ViewportName | ViewportSize | undefined,
): ViewportSize {
  if (!viewport) return VIEWPORTS.mobile;
  if (typeof viewport === "string") {
    return VIEWPORTS[viewport];
  }
  return viewport;
}

export async function withBrowserPage<T>(
  options: BrowserPageOptions,
  fn: (page: PageHandle, context: BrowserContextHandle) => Promise<T>,
): Promise<T> {
  const pw = await loadPlaywright();
  const viewport = resolveViewport(options.viewport);
  const locale = options.locale ?? "ar";
  const browser = await pw.chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport,
      locale: BCP47_LOCALE[locale],
      hasTouch: options.hasTouch ?? viewport.width <= 500,
      baseURL: options.baseUrl,
      offline: options.offline ?? false,
    });

    try {
      if (options.mockRoutes) {
        for (const rule of options.mockRoutes) {
          await context.route(rule.url, async (route) => {
            await route.fulfill({
              status: rule.status ?? 200,
              contentType: rule.contentType,
              headers: rule.headers,
              body: rule.body,
            });
          });
        }
      }

      const page = await context.newPage();
      try {
        return await fn(page, context);
      } finally {
        await page.close();
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

export async function measureHorizontalOverflow(
  page: PageHandle,
): Promise<HorizontalOverflowResult> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const scrollWidth = Math.ceil(root.scrollWidth);
    const clientWidth = Math.ceil(root.clientWidth);
    return {
      scrollWidth,
      clientWidth,
      hasOverflow: scrollWidth > clientWidth,
    };
  });
}

export async function measureTouchTargets(
  page: PageHandle,
  minPx = 44,
): Promise<TouchTargetViolation[]> {
  return page.evaluate((threshold) => {
    const selector =
      'button, a[href], [role="button"], [role="tab"], input:not([type="hidden"]), select';
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    );
    const violations: Array<{
      selector: string;
      text: string;
      width: number;
      height: number;
    }> = [];

    const describeEl = (el: HTMLElement): string => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const role = el.getAttribute("role");
      const rolePart = role ? `[role="${role}"]` : "";
      return `${tag}${id}${rolePart}`;
    };

    for (const el of elements) {
      if (el.getAttribute("aria-hidden") === "true") continue;
      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        parseFloat(style.opacity) === 0
      ) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Skip sr-only visually hidden helpers (1px x 1px clipped boxes).
      if (rect.width <= 1 && rect.height <= 1 && style.overflow === "hidden") {
        continue;
      }

      if (rect.width < threshold - 0.25 || rect.height < threshold - 0.25) {
        const label = (
          el.innerText ||
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);

        violations.push({
          selector: describeEl(el),
          text: label,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        });
      }
    }

    return violations;
  }, minPx);
}

export async function measureContrastViolations(
  page: PageHandle,
  minRatio = 4.5,
): Promise<ContrastViolation[]> {
  return page.evaluate((threshold) => {
    type Rgba = [number, number, number, number];

    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = 1;
    colorCanvas.height = 1;
    const colorCtx = colorCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const colorCache = new Map<string, Rgba>();

    const parseColor = (raw: string): Rgba => {
      const trimmed = raw.trim();
      if (
        !trimmed ||
        trimmed === "transparent" ||
        trimmed === "rgba(0, 0, 0, 0)" ||
        trimmed === "rgba(0,0,0,0)" ||
        trimmed === "rgb(0 0 0 / 0)"
      ) {
        return [0, 0, 0, 0];
      }

      const cached = colorCache.get(trimmed);
      if (cached) return cached;

      let parsed: Rgba;
      if (colorCtx) {
        colorCtx.clearRect(0, 0, 1, 1);
        colorCtx.fillStyle = "rgba(0, 0, 0, 0)";
        colorCtx.fillStyle = trimmed;
        colorCtx.fillRect(0, 0, 1, 1);
        const pixel = colorCtx.getImageData(0, 0, 1, 1).data;
        parsed = [
          pixel[0] ?? 0,
          pixel[1] ?? 0,
          pixel[2] ?? 0,
          (pixel[3] ?? 0) / 255,
        ];
      } else {
        const match = trimmed.match(
          /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i,
        );
        parsed = match
          ? [
              Number(match[1]),
              Number(match[2]),
              Number(match[3]),
              match[4] !== undefined ? Number(match[4]) : 1,
            ]
          : [0, 0, 0, 0];
      }

      colorCache.set(trimmed, parsed);
      return parsed;
    };

    const compositeOver = (fg: Rgba, bg: Rgba): Rgba => {
      const alpha = fg[3] + bg[3] * (1 - fg[3]);
      if (alpha === 0) return [255, 255, 255, 1];
      return [
        (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / alpha,
        (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / alpha,
        (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / alpha,
        alpha,
      ];
    };

    const relativeLuminance = (rgb: Rgba): number => {
      const toLinear = (channel: number): number => {
        const s = channel / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return (
        0.2126 * toLinear(rgb[0]) +
        0.7152 * toLinear(rgb[1]) +
        0.0722 * toLinear(rgb[2])
      );
    };

    const contrastRatio = (fg: Rgba, bg: Rgba): number => {
      const l1 = relativeLuminance(fg);
      const l2 = relativeLuminance(bg);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    };

    const effectiveBackground = (start: HTMLElement): Rgba => {
      const layers: Rgba[] = [];
      let current: HTMLElement | null = start;
      while (current) {
        const bg = parseColor(window.getComputedStyle(current).backgroundColor);
        if (bg[3] > 0) {
          layers.push(bg);
          if (bg[3] >= 0.999) break;
        }
        current = current.parentElement;
      }
      let result: Rgba = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const layer = layers[i];
        if (layer) {
          result = compositeOver(layer, result);
        }
      }
      return result;
    };

    const formatRgb = (rgba: Rgba): string =>
      `rgb(${Math.round(rgba[0])}, ${Math.round(rgba[1])}, ${Math.round(rgba[2])})`;

    const violations: Array<{
      text: string;
      ratio: number;
      fg: string;
      bg: string;
      selector: string;
    }> = [];

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const seenElements = new Set<HTMLElement>();

    let node = walker.nextNode();
    while (node) {
      const text = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
      const parent = node.parentElement;
      node = walker.nextNode();

      if (!text || !parent || seenElements.has(parent)) continue;
      const tag = parent.tagName.toLowerCase();
      if (
        tag === "script" ||
        tag === "style" ||
        tag === "noscript" ||
        tag === "template"
      ) {
        continue;
      }

      const style = window.getComputedStyle(parent);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        parseFloat(style.opacity) === 0
      ) {
        continue;
      }

      const rect = parent.getBoundingClientRect();
      if (rect.width <= 1 && rect.height <= 1 && style.overflow === "hidden") {
        continue;
      }
      if (rect.width === 0 || rect.height === 0) continue;

      seenElements.add(parent);
      const bg = effectiveBackground(parent);
      const rawFg = parseColor(style.color);
      const effectiveFg = compositeOver(rawFg, bg);
      const ratio = contrastRatio(effectiveFg, bg);

      if (ratio < threshold) {
        const idPart = parent.id ? `#${parent.id}` : "";
        violations.push({
          text: text.slice(0, 80),
          ratio: Math.round(ratio * 100) / 100,
          fg: formatRgb(effectiveFg),
          bg: formatRgb(bg),
          selector: `${tag}${idPart}`,
        });
      }
    }

    return violations;
  }, minRatio);
}

export function findEmDashesInText(text: string): EmDashReport {
  const excerpts: string[] = [];
  let count = 0;
  let idx = text.indexOf("\u2014");
  while (idx !== -1) {
    count += 1;
    if (excerpts.length < 20) {
      const start = Math.max(0, idx - 24);
      const end = Math.min(text.length, idx + 25);
      excerpts.push(text.slice(start, end).replace(/\s+/g, " ").trim());
    }
    idx = text.indexOf("\u2014", idx + 1);
  }
  return { count, excerpts };
}

export function stripHtmlForTextScan(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALLOWED_SAFE_PATTERNS: RegExp[] = [
  /reported\s+safe\s+at\s+\d{1,2}:\d{2}(?:\s+near\s+[^\n.!?,;|—]+)?/gi,
  // English ADR-0002 negated honesty disclaimers (e.g., en.ts:488,796; admin/en.ts:57)
  /not\s+(?:a\s+)?safe\s+(?:zone|area)/gi,
  /not\s+an?\s+all[-\s]clear/gi,
  /does\s+not\s+(?:publish|announce|issue|declare)\s+(?:a\s+|an\s+)?(?:per-commune\s+)?all[-\s]clear/gi,
  /never\s+(?:a\s+safe\s+(?:zone|area)|(?:implies|declares|means)\s+(?:an?\s+)?all[-\s]clear)/gi,
  // French ADR-0002 negated honesty disclaimers (e.g., fr.ts:324; kab.ts:323)
  /ne\s+signifie\s+pas\s+[^\n.!?]*zone\s+s[ûu]re/gi,
  /pas\s+une\s+zone\s+s[ûu]re/gi,
  /ne\s+constitue\s+pas\s+[^\n.!?]*fin\s+d['’]alerte/gi,
  // Arabic ADR-0002 negated honesty disclaimers (e.g., ar.ts:316)
  /لا\s+يعني\s+[^\n.!?]*المنطقة\s+آمنة/g,
  /ليست\s+منطقة\s+آمنة/g,
  /لا\s+يعني\s+انتهاء\s+[^\n.!?]*آمن(?:ة)?/g,
];

const BANNED_SAFE_PHRASE_PATTERNS: RegExp[] = [
  /\bsafe\s+zone\b/gi,
  /\bsafe\s+area\b/gi,
  /\bmark\s+(?:as\s+)?safe\b/gi,
  /\bsafety\s+status\b/gi,
  /\ball[-\s]clear\b/gi,
  /\bzone\s+s[ûu]re\b/gi,
  /\bzone\s+de\s+s[ée]curit[ée]\b/gi,
  /(?:status|état|statut|الحالة)\s*[:-]\s*(?:(?:safe|s[ûu]re?|all[-\s]clear)\b|آمن(?:ة)?(?=$|[\s.,;:|!?—-]))/gi,
  /منطقة\s+آمنة/g,
  /الوضع\s+آمن/g,
  /الحالة\s+آمنة/g,
];

const BANNED_STANDALONE_LINE =
  /^\s*(?:safe|all[-\s]clear|s[ûu]re?|آمنة?|yeɣlel)\s*$/i;

export function findBannedSafeLabels(text: string): string[] {
  let sanitized = text;
  for (const allowed of ALLOWED_SAFE_PATTERNS) {
    sanitized = sanitized.replace(allowed, " ");
  }

  const hits = new Set<string>();

  for (const pattern of BANNED_SAFE_PHRASE_PATTERNS) {
    const matches = sanitized.match(pattern);
    if (matches) {
      for (const m of matches) {
        hits.add(m.trim());
      }
    }
  }

  for (const line of sanitized.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && BANNED_STANDALONE_LINE.test(trimmed)) {
      hits.add(trimmed);
    }
  }

  return Array.from(hits);
}
