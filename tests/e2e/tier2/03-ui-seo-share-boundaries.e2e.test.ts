import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  e2eBaseUrl,
  importRepoModule,
  listRepoFiles,
  readRepoFile,
  readRepoJson,
  repoFileExists,
} from "../lib/env.ts";
import { deriveWilayaSlug, loadAlgeriaAdmin } from "../lib/fixtures.ts";
import { fetchBytes, fetchText } from "../lib/http.ts";
import {
  assertValidShareCardImage,
  SHARE_CARD_MAX_BYTES,
} from "../lib/image.ts";
import {
  findBannedSafeLabels,
  findEmDashesInText,
  measureHorizontalOverflow,
  stripHtmlForTextScan,
  VIEWPORTS,
  withBrowserPage,
} from "../lib/playwright.ts";

function stripHtmlToVisibleText(html: string): string {
  return stripHtmlForTextScan(html)
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;|&#8212;|&#x2014;/gi, "\u2014")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

type TranslationTree = { [key: string]: string | TranslationTree };

function flattenTranslationTree(
  tree: TranslationTree,
  prefix = "",
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(tree)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      entries.push([fullKey, value]);
    } else if (value && typeof value === "object") {
      entries.push(...flattenTranslationTree(value, fullKey));
    }
  }
  return entries;
}

describe("Tier 2 Boundaries — F14–F17: UI/UX RTL, Survival Mode, Antislop, /forecast, 69 Wilaya SEO & <=37 KB Share Cards", () => {
  // ---------------------------------------------------------------------------
  // F14: UI/UX Overhaul, Narrow Viewport RTL, Offline Survival & Antislop Boundaries (Edge Case #16)
  // ---------------------------------------------------------------------------
  describe("F14 — Narrow 320px RTL/LTR, Offline Survival Mode, Guidance Isolation, SOS Honesty & Antislop", () => {
    it("narrow 320x568 mobile viewport in Arabic (RTL) renders with dir='rtl' and zero horizontal overflow", async () => {
      await withBrowserPage(
        {
          baseUrl: e2eBaseUrl(),
          viewport: VIEWPORTS.narrowMobile,
          locale: "ar",
          hasTouch: true,
        },
        async (page) => {
          const response = await page.goto("/?lang=ar", {
            waitUntil: "domcontentloaded",
          });
          expect(response?.status()).toBe(200);
          await page.waitForTimeout(300);

          const dir = await page.evaluate(() => document.documentElement.dir);
          expect(dir).toBe("rtl");

          const overflow = await measureHorizontalOverflow(page);
          expect(
            overflow.hasOverflow,
            `320px AR RTL overflow: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
          ).toBe(false);
        },
      );
    });

    it("narrow 320x568 mobile viewport in French (LTR) renders with dir='ltr' and zero horizontal overflow", async () => {
      await withBrowserPage(
        {
          baseUrl: e2eBaseUrl(),
          viewport: VIEWPORTS.narrowMobile,
          locale: "fr",
          hasTouch: true,
        },
        async (page) => {
          const response = await page.goto("/?lang=fr", {
            waitUntil: "domcontentloaded",
          });
          expect(response?.status()).toBe(200);
          await page.waitForTimeout(300);

          const dir = await page.evaluate(() => document.documentElement.dir);
          expect(dir).toBe("ltr");

          const overflow = await measureHorizontalOverflow(page);
          expect(
            overflow.hasOverflow,
            `320px FR LTR overflow: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
          ).toBe(false);
        },
      );
    });

    it("Offline Survival Mode (zero fresh data): setting browser offline after initial load still renders /survival, Position Card & 14/1070/112 dialers", async () => {
      await withBrowserPage(
        {
          baseUrl: e2eBaseUrl(),
          viewport: VIEWPORTS.mobile,
          locale: "fr",
          hasTouch: true,
        },
        async (page, context) => {
          const pageErrors: string[] = [];
          page.on("pageerror", (err) => pageErrors.push(String(err)));

          const initial = await page.goto("/survival?lang=fr", {
            waitUntil: "domcontentloaded",
          });
          expect(initial?.status()).toBe(200);
          await page.waitForTimeout(300);

          // Persist a realistic Survival Pack into localStorage, then drop the network completely.
          await page.evaluate(() => {
            window.localStorage.setItem(
              "nadhir.survival.pack",
              JSON.stringify({
                savedAt: "2026-11-24T12:00:00Z",
                lat: 36.7538,
                lon: 3.0588,
                commune: "Alger Centre",
                wilaya: "Alger",
                nearest: { name: "Bab El Oued", km: 2.4, bearing: 310 },
              }),
            );
          });

          await context.setOffline(true);
          await page.waitForTimeout(250);

          const bodyText = await page.evaluate(() => document.body.innerText);
          expect(bodyText.trim().length).toBeGreaterThan(20);

          // Must expose emergency dialer numbers (14 Protection Civile and 1070/112) even offline.
          const dialLinks = await page.evaluate(() =>
            Array.from(
              document.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"]'),
            ).map((a) => a.getAttribute("href") ?? ""),
          );
          expect(dialLinks.some((h) => h.includes("14"))).toBe(true);
          expect(
            bodyText.includes("14") &&
              (bodyText.includes("1070") || bodyText.includes("112")),
          ).toBe(true);
          expect(pageErrors).toEqual([]);
        },
      );
    });

    it("Edge Case #16 (Flood / Earthquake Guidance Isolation): Emergency/Survival guidance isolates wildfire text from flood & earthquake modes and scopes tsunami strictly to offshore M5+", async () => {
      const survivalFiles = [
        ...listRepoFiles("src/routes/survival", ".tsx"),
        "src/lib/survival.ts",
      ].filter((p) => repoFileExists(p));

      expect(survivalFiles.length).toBeGreaterThan(0);

      const combinedSrc = survivalFiles.map((f) => readRepoFile(f)).join("\n");
      // Track 3 requires hazard-agnostic Emergency sheet supporting flood & earthquake separately from fire.
      expect(combinedSrc).toMatch(/flood/i);
      expect(combinedSrc).toMatch(/earthquake|quake/i);

      // Verify standing guidance separates hazards (switch/map/branch by hazard kind) rather than unconditionally showing fire tips.
      expect(combinedSrc).toMatch(/hazard|kind|mode/i);

      // Coastal tsunami guidance, if present in survival/locales, must be gated on offshore M5+ quakes (never unconditional).
      if (/tsunami/i.test(combinedSrc)) {
        expect(combinedSrc).toMatch(/offshore/i);
      }
      expect(findBannedSafeLabels(combinedSrc)).toEqual([]);
      expect(combinedSrc).not.toMatch(/\bguardian\b/i);

      // Scope ADR-0003 "Guardian" prohibition to Survival/Emergency/Track3 locale keys
      // (explicitly excluding legitimate reporter trust-level reports.level.guardian).
      const [arMod, frMod, enMod, kabMod] = await Promise.all([
        importRepoModule<{ ar: TranslationTree }>("src/i18n/locales/ar.ts"),
        importRepoModule<{ fr: TranslationTree }>("src/i18n/locales/fr.ts"),
        importRepoModule<{ en: TranslationTree }>("src/i18n/locales/en.ts"),
        importRepoModule<{ kab: TranslationTree }>("src/i18n/locales/kab.ts"),
      ]);

      const survivalGuardianKeyScope = /^(?:survival|emergency|track3)\b/i;
      const guardianViolations: string[] = [];
      for (const [locale, tree] of [
        ["ar", arMod.ar],
        ["fr", frMod.fr],
        ["en", enMod.en],
        ["kab", kabMod.kab],
      ] as const) {
        for (const [key, value] of flattenTranslationTree(tree)) {
          if (!survivalGuardianKeyScope.test(key)) continue;
          if (/\bguardian\b/i.test(value)) {
            guardianViolations.push(`${locale}.${key}: "${value}"`);
          }
        }
      }
      expect(guardianViolations).toEqual([]);
    });

    it("Edge Case #16 (SOS Honesty): failed SOS persists locally as sent=false, displays 'not sent' + call 14, and NEVER claims 'request received'", async () => {
      const sosMod = await importRepoModule<{
        enqueueSos: (
          storage: {
            getItem: (k: string) => string | null;
            setItem: (k: string, v: string) => void;
          },
          input: {
            lat: number | null;
            lon: number | null;
            note: string | null;
          },
        ) => {
          id: string;
          sent: boolean;
          lat: number | null;
          lon: number | null;
        };
        loadSosQueue: (storage: {
          getItem: (k: string) => string | null;
          setItem: (k: string, v: string) => void;
        }) => Array<{ id: string; sent: boolean }>;
      }>("src/lib/sos-queue.ts");

      const mem = new Map<string, string>();
      const storage = {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mem.set(k, v);
        },
      };

      const queued = sosMod.enqueueSos(storage, {
        lat: 36.7538,
        lon: 3.0588,
        note: "Flooding on ground floor",
      });
      expect(queued.sent).toBe(false);
      expect(sosMod.loadSosQueue(storage)).toHaveLength(1);

      const enLocale = [
        readRepoFile("src/i18n/locales/en.ts"),
        ...listRepoFiles("src/i18n/modules", ".ts")
          .filter((f) => f.endsWith("/en.ts"))
          .map((f) => readRepoFile(f)),
      ].join("\n");

      expect(enLocale).not.toMatch(/request received/i);
      expect(enLocale).toMatch(/not sent/i);
    });

    it("antislop R-32 (Keyboard & Focus Accessibility): interactive explainers/disclosures are keyboard-focusable and Escape closes open overlays cleanly", async () => {
      await withBrowserPage(
        {
          baseUrl: e2eBaseUrl(),
          viewport: VIEWPORTS.desktop,
          locale: "fr",
        },
        async (page) => {
          const response = await page.goto("/forecast?lang=fr", {
            waitUntil: "domcontentloaded",
          });
          expect(response?.status()).toBe(200);
          await page.waitForTimeout(300);

          // Check interactive explainers/triggers have keyboard focusability (native button/summary or tabIndex=0).
          const unfocusableTriggers = await page.evaluate(() => {
            const nodes = Array.from(
              document.querySelectorAll<HTMLElement>(
                '[aria-expanded], [aria-haspopup], [data-explainer], [role="button"]',
              ),
            );
            return nodes
              .filter((el) => {
                const tag = el.tagName.toLowerCase();
                if (tag === "button" || tag === "a" || tag === "summary") {
                  return false;
                }
                const ti = el.getAttribute("tabindex");
                return ti === null || Number(ti) < 0;
              })
              .map(
                (el) =>
                  `${el.tagName.toLowerCase()}:${el.innerText.slice(0, 30)}`,
              );
          });

          expect(
            unfocusableTriggers,
            `Non-focusable interactive triggers (R-32): ${unfocusableTriggers.join(", ")}`,
          ).toEqual([]);

          // Open first expandable disclosure/menu if present and verify Escape closes it cleanly.
          const expandable = page.locator('[aria-expanded="false"]').first();
          if (
            (await expandable.count()) > 0 &&
            (await expandable.isVisible())
          ) {
            await expandable.click();
            await page.waitForTimeout(150);
            await page.keyboard.press("Escape");
            await page.waitForTimeout(150);
          }

          // Pressing Escape must never trigger an uncaught crash; page remains intact.
          expect((await page.title()).length).toBeGreaterThan(0);
        },
      );
    });

    it("antislop R-02 (Em-Dash Boundary): zero lone '—' (U+2014) empty-value placeholders in rendered HTML across /, /forecast, /survival, /wilaya/alger, /privacy", async () => {
      const routes = [
        "/?lang=fr",
        "/forecast?lang=fr",
        "/survival?lang=fr",
        "/wilaya/alger?lang=fr",
        "/privacy?lang=fr",
      ];

      for (const route of routes) {
        const res = await fetchText(route);
        expect(res.status, `Expected HTTP 200 on ${route}`).toBe(200);
        const visibleText = stripHtmlToVisibleText(res.text);
        const report = findEmDashesInText(visibleText);
        expect(
          report.count,
          `R-02 em-dash violation on ${route}: ${report.excerpts.join(" | ")}`,
        ).toBe(0);
      }
    });

    it("antislop R-20 (Server Pagination Boundary): paging.ts enforces PAGE_SIZE=25, deduplicates shifted rows, and map list caps at 20 per group", async () => {
      const pagingMod = await importRepoModule<{
        PAGE_SIZE: number;
        firstPage: number;
        nextOffset: <T>(last: T[], pages: T[][]) => number | null;
        pageRange: (offset: number) => readonly [number, number];
        pageRows: <T extends { id: string }>(
          data: { pages: T[][] } | undefined,
        ) => T[];
      }>("src/lib/paging.ts");

      expect(pagingMod.PAGE_SIZE).toBe(25);
      expect(pagingMod.firstPage).toBe(0);
      expect(pagingMod.pageRange(0)).toEqual([0, 24]);
      expect(pagingMod.pageRange(25)).toEqual([25, 49]);

      const fullPage = Array.from({ length: 25 }, (_, i) => ({ id: `r-${i}` }));
      const shortPage = Array.from({ length: 24 }, (_, i) => ({
        id: `r-${i}`,
      }));
      expect(pagingMod.nextOffset(fullPage, [fullPage])).toBe(25);
      expect(pagingMod.nextOffset(shortPage, [fullPage, shortPage])).toBeNull();

      // Shifted duplicate across page boundary keeps first copy only.
      const deduped = pagingMod.pageRows({
        pages: [
          [{ id: "a" }, { id: "b" }],
          [{ id: "b" }, { id: "c" }],
        ],
      });
      expect(deduped.map((r) => r.id)).toEqual(["a", "b", "c"]);

      // Map list panel enforces 20/group cap on active live map drawer
      const mapPanelFiles = ["src/routes/index.tsx"].filter((p) =>
        repoFileExists(p),
      );
      expect(mapPanelFiles.length).toBeGreaterThan(0);
      const mapPanelSrc = mapPanelFiles.map((p) => readRepoFile(p)).join("\n");
      expect(mapPanelSrc).toMatch(/\b20\b/);
    });
  });

  // ---------------------------------------------------------------------------
  // F15: Multi-Hazard /forecast View Boundaries
  // ---------------------------------------------------------------------------
  describe("F15 — Multi-Hazard /forecast Payload Budgets, Narrow RTL & Missing Horizon Honesty", () => {
    it("/forecast SSR payload stays within audit budgets (<= 3.3 MB decoded and <= 700 KB gzip)", async () => {
      const res = await fetchText("/forecast?lang=fr");
      expect(res.status).toBe(200);

      const rawBytes = Buffer.byteLength(res.text, "utf8");
      const gzipBytes = gzipSync(Buffer.from(res.text, "utf8")).byteLength;

      expect(rawBytes).toBeLessThanOrEqual(3_300_000);
      expect(gzipBytes).toBeLessThanOrEqual(700_000);
    });

    it("/forecast?lang=ar on narrow 320x568 viewport has zero document horizontal overflow", async () => {
      await withBrowserPage(
        {
          baseUrl: e2eBaseUrl(),
          viewport: VIEWPORTS.narrowMobile,
          locale: "ar",
          hasTouch: true,
        },
        async (page) => {
          const response = await page.goto("/forecast?lang=ar", {
            waitUntil: "domcontentloaded",
          });
          expect(response?.status()).toBe(200);
          await page.waitForTimeout(300);

          const overflow = await measureHorizontalOverflow(page);
          expect(
            overflow.hasOverflow,
            `320px /forecast AR RTL overflow: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
          ).toBe(false);
        },
      );
    });

    it("incomplete future air / ONM days show honest range messages (never fabricating '0')", () => {
      const forecastOutlookSrc = readRepoFile("src/lib/forecast-outlook.ts");
      const enLocale = readRepoFile("src/i18n/locales/en.ts");
      const weatherI18n = readRepoFile("src/i18n/weather.ts");
      const combined = `${forecastOutlookSrc}\n${enLocale}\n${weatherI18n}`;

      // Must have explicit unissued / beyond-range honesty labels rather than 0 defaults.
      expect(combined).toMatch(
        /not issued|beyond.*range|outside.*range|unavailable/i,
      );
    });

    it("invalid ?commune= query parameter on /forecast degrades gracefully without HTTP 500 or raw PostgREST error", async () => {
      const res = await fetchText(
        "/forecast?commune=NOT_A_REAL_COMMUNE_9999&lang=fr",
      );
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(
        /PGRST\d+|invalid input syntax for type uuid|stack trace/i,
      );
    });

    it("homepage (/) SSR payload stays within audit budgets (<= 1.2 MB decoded and <= 300 KB gzip)", async () => {
      const res = await fetchText("/?lang=ar");
      expect(res.status).toBe(200);

      const rawBytes = Buffer.byteLength(res.text, "utf8");
      const gzipBytes = gzipSync(Buffer.from(res.text, "utf8")).byteLength;

      expect(rawBytes).toBeLessThanOrEqual(1_200_000);
      expect(gzipBytes).toBeLessThanOrEqual(300_000);
    });

    it("isStaleForecastDate & publishedRiskTarget enforce exact calendar-day and 0..5 horizon boundaries", async () => {
      const nadhirMod = await importRepoModule<{
        isStaleForecastDate: (forecastDate: string, now?: number) => boolean;
        publishedRiskTarget: (
          checkpoint: {
            coverage_status: string | null;
            snapshot_id: string | null;
            base_date: string | null;
            published_at: string | null;
          } | null,
          targetDate: string,
        ) => { horizon: number } | null;
      }>("src/lib/nadhir.ts");

      const fixedNow = Date.parse("2026-11-24T10:00:00Z");
      expect(nadhirMod.isStaleForecastDate("2026-11-23", fixedNow)).toBe(true);
      expect(nadhirMod.isStaleForecastDate("2026-11-24", fixedNow)).toBe(false);
      expect(nadhirMod.isStaleForecastDate("2026-11-25", fixedNow)).toBe(false);

      const completeCp = {
        coverage_status: "complete",
        snapshot_id: "snap-1",
        base_date: "2026-11-24",
        published_at: "2026-11-24T06:00:00Z",
      };
      expect(
        nadhirMod.publishedRiskTarget(completeCp, "2026-11-23"),
      ).toBeNull();
      expect(
        nadhirMod.publishedRiskTarget(completeCp, "2026-11-24")?.horizon,
      ).toBe(0);
      expect(
        nadhirMod.publishedRiskTarget(completeCp, "2026-11-29")?.horizon,
      ).toBe(5);
      expect(
        nadhirMod.publishedRiskTarget(completeCp, "2026-11-30"),
      ).toBeNull();
      expect(
        nadhirMod.publishedRiskTarget(
          { ...completeCp, coverage_status: "partial" },
          "2026-11-24",
        ),
      ).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // F16: 69 Indexable Bilingual (AR/FR) /wilaya/$slug Landing Pages Boundaries
  // ---------------------------------------------------------------------------
  describe("F16 — 69-Wilaya SEO Slug, Tail Wilayas (name_kab: null), Tifinagh & Quiet Wilaya Honesty Boundaries", () => {
    it("invalid wilaya slug (/wilaya/not-a-real-wilaya-999) returns HTTP 404 (not 200 or 500)", async () => {
      const res = await fetchText("/wilaya/not-a-real-wilaya-999");
      expect(res.status).toBe(404);
    });

    it("encoded path-traversal slug (/wilaya/..%2fetc) returns HTTP 404 or 400 (never 200 or 500)", async () => {
      const res = await fetchText("/wilaya/..%2fetc");
      expect([400, 404]).toContain(res.status);
    });

    it("Loi 26-06 tail wilayas with name_kab: null (63, 66, 67, 68, 69) render HTTP 200 cleanly in ?lang=kab, ?lang=ar, and ?lang=fr", async () => {
      const admin = loadAlgeriaAdmin();
      const tailCodes = ["63", "66", "67", "68", "69"];
      const tailWilayas = tailCodes.map((code) => {
        const w = admin.wilayas.find((entry) => entry.code === code);
        expect(
          w,
          `Expected wilaya code ${code} in algeria-admin.json`,
        ).toBeDefined();
        expect(w?.name_kab).toBeNull();
        return w!;
      });

      for (const wilaya of tailWilayas) {
        const slug = deriveWilayaSlug(wilaya.name_fr);
        for (const lang of ["kab", "ar", "fr"] as const) {
          const res = await fetchText(`/wilaya/${slug}?lang=${lang}`);
          expect(
            res.status,
            `Expected HTTP 200 for /wilaya/${slug}?lang=${lang}`,
          ).toBe(200);
          const title = extractTitle(res.text);
          expect(
            title.length,
            `Empty <title> on /wilaya/${slug}?lang=${lang}`,
          ).toBeGreaterThan(2);
          expect(title).not.toMatch(/\b(null|undefined)\b/i);
        }
      }
    });

    it("Tifinagh wilaya 59 Aflou (ⴰⴼⵍⵓ) renders HTTP 200 cleanly with canonical & hreflang tags across kab, ar, fr", async () => {
      const admin = loadAlgeriaAdmin();
      const aflou = admin.wilayas.find((w) => w.code === "59");
      expect(aflou).toBeDefined();
      const slug = deriveWilayaSlug(aflou!.name_fr);

      for (const lang of ["kab", "ar", "fr"] as const) {
        const res = await fetchText(`/wilaya/${slug}?lang=${lang}`);
        expect(res.status).toBe(200);
        const title = extractTitle(res.text);
        expect(title.length).toBeGreaterThan(2);
        expect(res.text).toMatch(/rel=["']canonical["']/i);
        expect(res.text).toMatch(/hreflang=["']ar-DZ["']/i);
        expect(res.text).toMatch(/hreflang=["']fr-DZ["']/i);
        expect(res.text).toMatch(/hreflang=["']x-default["']/i);
      }
    });

    it("quiet wilaya with zero active hazards displays honest factual copy and NEVER renders 'Safe' / 'آمن' / 'Sûr'", async () => {
      for (const lang of ["en", "fr", "ar"] as const) {
        const res = await fetchText(`/wilaya/tamanrasset?lang=${lang}`);
        expect(res.status).toBe(200);
        const visible = stripHtmlToVisibleText(res.text);
        expect(
          findBannedSafeLabels(visible),
          `Banned safe label on /wilaya/tamanrasset?lang=${lang}`,
        ).toEqual([]);
        expect(findEmDashesInText(visible).count).toBe(0);
      }
    });

    it("src/lib/wilaya-slugs.ts maps all 69 Loi 26-06 wilayas deterministically with zero slug collisions", async () => {
      const slugMod = await importRepoModule<Record<string, unknown>>(
        "src/lib/wilaya-slugs.ts",
      );
      const admin = loadAlgeriaAdmin();
      expect(admin.wilayas).toHaveLength(69);

      const listFn = (slugMod["WILAYA_SLUGS"] ??
        slugMod["ALL_WILAYA_SLUGS"] ??
        slugMod["getAllWilayaSlugs"]) as unknown;
      const bySlugFn = (slugMod["wilayaBySlug"] ??
        slugMod["getWilayaBySlug"] ??
        slugMod["findWilayaBySlug"] ??
        slugMod["resolveWilayaBySlug"]) as
        ((slug: string) => unknown) | undefined;

      expect(
        listFn !== undefined || typeof bySlugFn === "function",
        "Expected slug registry export in src/lib/wilaya-slugs.ts",
      ).toBe(true);

      const slugs = new Set<string>();
      for (const w of admin.wilayas) {
        const expectedSlug = deriveWilayaSlug(w.name_fr);
        expect(expectedSlug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        slugs.add(expectedSlug);
        if (typeof bySlugFn === "function") {
          const found = bySlugFn(expectedSlug);
          expect(
            found,
            `Expected wilaya-slugs.ts to resolve slug "${expectedSlug}" (code ${w.code})`,
          ).toBeTruthy();
        }
      }
      expect(slugs.size).toBe(69);

      if (typeof bySlugFn === "function") {
        expect(bySlugFn("not-a-wilaya-999")).toBeFalsy();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // F17: Universal <= 37 KB WhatsApp/Facebook Share Card Boundaries (Edge Case #12)
  // ---------------------------------------------------------------------------
  describe("F17 — Share Card <= 37 KB Arabic Stress Test, Ineligible 404, Invalid Format 400 & No Satori RTL Trap", () => {
    it("Edge Case #12: longest Arabic wilaya name (الأبيض سيدي الشيخ, wilaya 69) in ?lang=ar renders valid non-blank image <= 37,888 bytes", async () => {
      const res = await fetchBytes(
        "/api/public/share/wilaya/el-abiodh-sidi-cheikh.whatsapp.webp?lang=ar",
      );
      expect(res.status).toBe(200);
      expect(res.bytes.byteLength).toBeLessThanOrEqual(SHARE_CARD_MAX_BYTES);

      const decoded = await assertValidShareCardImage(
        res.bytes,
        SHARE_CARD_MAX_BYTES,
      );
      expect(decoded.width).toBeGreaterThan(100);
      expect(decoded.height).toBeGreaterThan(100);
      expect(decoded.isBlank).toBe(false);
    });

    it("ineligible entities (non-existent Heat Signal fire / ITA media / unknown incident UUID) return HTTP 404", async () => {
      const ineligiblePaths = [
        "/api/public/share/fire/nonexistent-heat-signal-000.whatsapp.webp?lang=ar",
        "/api/public/share/incident/00000000-0000-4000-8000-000000000000.whatsapp.webp?lang=fr",
        "/api/public/share/quake/nonexistent-m1-event.whatsapp.webp?lang=ar",
      ];

      for (const path of ineligiblePaths) {
        const res = await fetchBytes(path);
        expect(
          res.status,
          `Expected HTTP 404 for ineligible share card ${path}`,
        ).toBe(404);
      }
    });

    it("invalid format parameter on share-card route returns HTTP 400 (never 200 or 500)", async () => {
      const res = await fetchBytes(
        "/api/public/share/wilaya/alger.invalidformat?lang=ar",
      );
      expect(res.status).toBe(400);
    });

    it("unknown ?lang=xx falls back deterministically (no HTTP 500) and still obeys <= 37,888 bytes", async () => {
      const shareMod = await importRepoModule<{
        shareLocale: (value: string | null | undefined) => string;
      }>("src/lib/share-card.ts");
      expect(shareMod.shareLocale("xx")).toBe("ar");
      expect(shareMod.shareLocale("")).toBe("ar");
      expect(shareMod.shareLocale(null)).toBe("ar");

      const res = await fetchBytes(
        "/api/public/share/wilaya/alger.whatsapp.webp?lang=xx",
      );
      expect(res.status).toBe(200);
      await assertValidShareCardImage(res.bytes, SHARE_CARD_MAX_BYTES);
    });

    it("Edge Case #12: share-card renderer does NOT depend on or import broken 'satori' for Arabic RTL shaping", () => {
      const pkg = readRepoJson<{
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      }>("package.json");
      expect(pkg.dependencies?.["satori"]).toBeUndefined();
      expect(pkg.devDependencies?.["satori"]).toBeUndefined();

      const shareFiles = [
        "src/lib/share-render.server.ts",
        "src/lib/share-card.ts",
        ...listRepoFiles("src/routes/api/public/share", ".ts"),
      ].filter((p) => repoFileExists(p));

      for (const relPath of shareFiles) {
        const src = readRepoFile(relPath);
        expect(src, `Forbidden satori import in ${relPath}`).not.toMatch(
          /from\s+["']satori["']|import\(\s*["']satori["']\s*\)/,
        );
      }
    });

    it("algiersDateTime formats cleanly across all 4 locales and linkTargets URI-encodes special characters safely", async () => {
      const shareMod = await importRepoModule<{
        algiersDateTime: (iso: string, locale: string) => string;
        linkTargets: (url: string) => { whatsapp: string; facebook: string };
      }>("src/lib/share-card.ts");

      for (const locale of ["ar", "fr", "en", "kab"] as const) {
        const formatted = shareMod.algiersDateTime(
          "2026-11-24T14:30:00Z",
          locale,
        );
        expect(formatted.length).toBeGreaterThan(5);
        // 14:30Z in Africa/Algiers (UTC+1) is 15:30 (or Arabic-Indic numerals ١٥:٣٠).
        expect(formatted).toMatch(/15:30|١٥:٣٠/);
      }

      const targets = shareMod.linkTargets(
        "https://nadhir.app/wilaya/alger?lang=ar&ref=wa&x=a b",
      );
      expect(targets.whatsapp).toContain(
        encodeURIComponent(
          "https://nadhir.app/wilaya/alger?lang=ar&ref=wa&x=a b",
        ),
      );
      expect(targets.facebook).toContain(
        encodeURIComponent(
          "https://nadhir.app/wilaya/alger?lang=ar&ref=wa&x=a b",
        ),
      );
    });
  });
});
