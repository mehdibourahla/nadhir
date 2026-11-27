import { describe, expect, it } from "vitest";

import {
  e2eBaseUrl,
  importRepoModule,
  listRepoFiles,
  readRepoFile,
  repoFileExists,
} from "../lib/env.ts";
import { deriveWilayaSlug, loadAlgeriaAdmin } from "../lib/fixtures.ts";
import { fetchBytes, fetchJson, fetchText } from "../lib/http.ts";
import {
  assertValidShareCardImage,
  SHARE_CARD_MAX_BYTES,
} from "../lib/image.ts";
import {
  findBannedSafeLabels,
  findEmDashesInText,
  measureContrastViolations,
  measureHorizontalOverflow,
  measureTouchTargets,
  stripHtmlForTextScan,
  withBrowserPage,
} from "../lib/playwright.ts";

function localeUrl(path: string, lang: "ar" | "fr" | "en" | "kab"): string {
  const base = e2eBaseUrl();
  const sep = path.includes("?") ? "&" : "?";
  return `${base}${path}${sep}lang=${lang}`;
}

function byteArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe("Tier 1 — F14: High-Craft UI/UX Overhaul (Mobile & Desktop, AR RTL & FR LTR)", () => {
  it("F14.1: Home '/' in Arabic (ar) renders dir='rtl', lang='ar', Arabic content, and zero horizontal overflow on mobile 390x844 and desktop 1440x900", async () => {
    for (const viewport of ["mobile", "desktop"] as const) {
      await withBrowserPage({ locale: "ar", viewport }, async (page) => {
        const res = await page.goto(localeUrl("/", "ar"), {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        });
        expect(res?.status()).toBe(200);
        await page.waitForFunction(
          () =>
            document.documentElement.getAttribute("dir") === "rtl" &&
            /[\u0600-\u06FF]/.test(document.body.innerText ?? ""),
          undefined,
          { timeout: 10_000 },
        );

        const docMeta = await page.evaluate(() => ({
          dir: document.documentElement.getAttribute("dir"),
          lang: document.documentElement.getAttribute("lang"),
          bodyText: (document.body.innerText ?? "").trim(),
        }));
        expect(docMeta.dir).toBe("rtl");
        expect(docMeta.lang?.toLowerCase()).toMatch(/^ar/);
        expect(docMeta.bodyText).toMatch(/[\u0600-\u06FF]/);

        const overflow = await measureHorizontalOverflow(page);
        expect(
          overflow.hasOverflow,
          `AR ${viewport} overflow: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
        ).toBe(false);
      });
    }
  });

  it("F14.2: Home '/' in French (fr) renders dir='ltr', lang='fr', French content, and zero horizontal overflow on mobile 390x844 and desktop 1440x900", async () => {
    for (const viewport of ["mobile", "desktop"] as const) {
      await withBrowserPage({ locale: "fr", viewport }, async (page) => {
        const res = await page.goto(localeUrl("/", "fr"), {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        });
        expect(res?.status()).toBe(200);
        await page.waitForFunction(
          () =>
            document.documentElement.getAttribute("dir") === "ltr" &&
            (document.body.innerText ?? "").trim().length > 20,
          undefined,
          { timeout: 10_000 },
        );

        const docMeta = await page.evaluate(() => ({
          dir: document.documentElement.getAttribute("dir"),
          lang: document.documentElement.getAttribute("lang"),
          bodyText: (document.body.innerText ?? "").trim(),
        }));
        expect(docMeta.dir).toBe("ltr");
        expect(docMeta.lang?.toLowerCase()).toMatch(/^fr/);
        expect(docMeta.bodyText.length).toBeGreaterThan(20);

        const overflow = await measureHorizontalOverflow(page);
        expect(
          overflow.hasOverflow,
          `FR ${viewport} overflow: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
        ).toBe(false);
      });
    }
  });

  it("F14.3: mobile map peek sheet exposes accessible expand controls and renders cleanly on mobile 390x844", async () => {
    const panelSrc = readRepoFile("src/routes/index.tsx");
    expect(panelSrc).toMatch(/mobileSheetExpanded/);

    await withBrowserPage(
      { locale: "fr", viewport: "mobile" },
      async (page) => {
        const res = await page.goto(localeUrl("/", "fr"), {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        });
        expect(res?.status()).toBe(200);

        const sheetSelector =
          '[data-sheet-detent], [data-detent], [aria-label*="detent" i], [aria-label*="sheet" i], [role="region"]';
        await page
          .locator(sheetSelector)
          .first()
          .waitFor({ state: "attached", timeout: 10_000 });
        const sheetCount = await page.locator(sheetSelector).count();
        expect(sheetCount).toBeGreaterThan(0);

        const detentHandle = page.locator(
          '[data-sheet-handle], [data-detent-toggle], button[aria-controls*="sheet" i], button[aria-expanded]',
        );
        if ((await detentHandle.count()) > 0) {
          await detentHandle
            .first()
            .waitFor({ state: "visible", timeout: 5_000 });
          await detentHandle.first().click();
          await page.waitForFunction(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth + 1,
            undefined,
            { timeout: 5_000 },
          );
        }

        const overflow = await measureHorizontalOverflow(page);
        expect(overflow.hasOverflow).toBe(false);
      },
    );
  });

  it("F14.4: hazard filter pills render on map workspace with >=44px touch targets and zero horizontal document overflow", async () => {
    await withBrowserPage(
      { locale: "fr", viewport: "mobile" },
      async (page) => {
        const res = await page.goto(localeUrl("/", "fr"), {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        });
        expect(res?.status()).toBe(200);

        const pillLocator = page.locator(
          '[data-hazard-filter], [role="tab"], [aria-pressed]',
        );
        await pillLocator
          .first()
          .waitFor({ state: "visible", timeout: 10_000 });
        const count = await pillLocator.count();
        expect(count, "Hazard filter pills must be rendered").toBeGreaterThan(
          0,
        );

        const maxToCheck = Math.min(count, 8);
        for (let i = 0; i < maxToCheck; i += 1) {
          const box = await pillLocator.nth(i).boundingBox();
          if (box && box.width > 0 && box.height > 0) {
            expect(
              box.height,
              `Hazard filter pill #${i} height must be >= 44px`,
            ).toBeGreaterThanOrEqual(43.5);
          }
        }

        const overflow = await measureHorizontalOverflow(page);
        expect(overflow.hasOverflow).toBe(false);
      },
    );
  });

  it("F14.5: 2-second alert card hierarchy renders with zero bare 'safe' status labels and zero em dashes", async () => {
    const alertsSrc = readRepoFile("src/routes/_authenticated/alerts.tsx");
    expect(alertsSrc).toMatch(/AlertProvenance|provenance/i);

    await withBrowserPage(
      { locale: "fr", viewport: "mobile" },
      async (page) => {
        const res = await page.goto(localeUrl("/", "fr"), {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        });
        expect(res?.status()).toBe(200);
        await page.waitForFunction(
          () => (document.body.innerText ?? "").trim().length > 20,
          undefined,
          { timeout: 10_000 },
        );

        const visibleText = await page.evaluate(
          () => document.body.innerText ?? "",
        );
        expect(findBannedSafeLabels(visibleText)).toEqual([]);
        expect(findEmDashesInText(visibleText).count).toBe(0);
      },
    );
  });

  it("F14.6: hazard-agnostic Emergency 14 / Position Card / Check-In sheet (/survival) renders 14/1070/112 without evacuation routing or banned labels", async () => {
    await withBrowserPage(
      { locale: "fr", viewport: "mobile" },
      async (page) => {
        const res = await page.goto(localeUrl("/survival", "fr"), {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        });
        expect(res?.status()).toBe(200);
        await page.waitForFunction(
          () => /\b14\b/.test(document.body.innerText ?? ""),
          undefined,
          { timeout: 10_000 },
        );

        const text = await page.evaluate(() => document.body.innerText ?? "");
        expect(text).toMatch(/\b14\b/);
        expect(text).toMatch(/\b1070\b|\b112\b/);
        expect(findBannedSafeLabels(text)).toEqual([]);
        expect(findEmDashesInText(text).count).toBe(0);
        expect(text).not.toMatch(/\bguardian\b|\bemergency mode\b/i);

        const overflow = await measureHorizontalOverflow(page);
        expect(overflow.hasOverflow).toBe(false);
      },
    );
  });

  it("F14.7: enforces WCAG contrast (>=4.5:1), >=44px touch targets, and server pagination contract across '/' and '/forecast'", async () => {
    expect(repoFileExists("src/lib/paging.ts")).toBe(true);
    const pagingSrc = readRepoFile("src/lib/paging.ts");
    expect(pagingSrc).toMatch(/25/);

    for (const path of ["/", "/forecast"] as const) {
      await withBrowserPage(
        { locale: "fr", viewport: "mobile" },
        async (page) => {
          const res = await page.goto(localeUrl(path, "fr"), {
            waitUntil: "domcontentloaded",
            timeout: 25_000,
          });
          expect(res?.status()).toBe(200);
          await page
            .locator("main, [role='main'], h1, button, a")
            .first()
            .waitFor({ state: "visible", timeout: 10_000 });
          await page.waitForFunction(
            () => (document.body.innerText ?? "").trim().length > 20,
            undefined,
            { timeout: 10_000 },
          );

          const touchViolations = await measureTouchTargets(page, 44);
          expect(
            touchViolations,
            `${path} touch target violations (<44px): ${JSON.stringify(touchViolations.slice(0, 5))}`,
          ).toEqual([]);

          const contrastViolations = await measureContrastViolations(page, 4.5);
          expect(
            contrastViolations,
            `${path} WCAG contrast violations (<4.5:1): ${JSON.stringify(contrastViolations.slice(0, 5))}`,
          ).toEqual([]);
        },
      );
    }
  });
});

describe("Tier 1 — F15: Multi-Hazard /forecast View", () => {
  it("F15.1: /forecast returns HTTP 200 in both ar and fr with non-empty localized multi-hazard content", async () => {
    const arRes = await fetchText("/forecast?lang=ar");
    expect(arRes.status).toBe(200);
    expect(arRes.text).toMatch(/[\u0600-\u06FF]/);

    const frRes = await fetchText("/forecast?lang=fr");
    expect(frRes.status).toBe(200);
    expect(frRes.text.length).toBeGreaterThan(500);
  });

  it("F15.2: /forecast source & view cover ONM warnings, fire danger, weather, air quality, and observed rainfall/lightning context", () => {
    const forecastFiles = [
      "src/routes/forecast.tsx",
      "src/routes/wilaya.$slug.tsx",
      "src/routes/index.tsx",
    ].filter((f) => repoFileExists(f));
    expect(forecastFiles.length).toBeGreaterThan(0);

    const combined = forecastFiles.map((f) => readRepoFile(f)).join("\n");
    expect(combined).toMatch(/onm|vigilance/i);
    expect(combined).toMatch(/fwi|fire|danger/i);
    expect(combined).toMatch(/air|aqi|pm2|dust/i);
    expect(combined).toMatch(/rain|imerg|precip|lightning/i);
  });

  it("F15.3: /forecast?commune=1617 deep-link returns HTTP 200 without server error or raw PostgREST errors", async () => {
    const res = await fetchText("/forecast?commune=1617&lang=fr");
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/PGRST\d{3}|PostgREST|stack trace/i);
  });

  it("F15.4: /forecast displays national worst-wilaya outlook ranking without leaking raw DB errors or bare 'safe' labels", async () => {
    await withBrowserPage(
      { locale: "fr", viewport: "desktop" },
      async (page) => {
        const res = await page.goto(localeUrl("/forecast", "fr"), {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        });
        expect(res?.status()).toBe(200);
        await page.waitForFunction(
          () => (document.body.innerText ?? "").trim().length > 40,
          undefined,
          { timeout: 10_000 },
        );

        const text = await page.evaluate(() => document.body.innerText ?? "");
        expect(text.length).toBeGreaterThan(40);
        expect(text).not.toMatch(/PGRST\d{3}|relation .* does not exist/i);
        expect(findBannedSafeLabels(text)).toEqual([]);
        expect(findEmDashesInText(text).count).toBe(0);
      },
    );
  });

  it("F15.5: /forecast SSR decoded HTML payload <= 3.3 MB and zero horizontal overflow on mobile 390x844", async () => {
    const res = await fetchText("/forecast?lang=ar");
    expect(res.status).toBe(200);
    const byteLen = new TextEncoder().encode(res.text).byteLength;
    expect(byteLen).toBeLessThanOrEqual(3_300_000);

    await withBrowserPage(
      { locale: "ar", viewport: "mobile" },
      async (page) => {
        const pageRes = await page.goto(localeUrl("/forecast", "ar"), {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        });
        expect(pageRes?.status()).toBe(200);
        await page.waitForFunction(
          () => /[\u0600-\u06FF]/.test(document.body.innerText ?? ""),
          undefined,
          { timeout: 10_000 },
        );

        const overflow = await measureHorizontalOverflow(page);
        expect(overflow.hasOverflow).toBe(false);
      },
    );
  });
});

describe("Tier 1 — F16: 69 Indexable Bilingual (AR/FR) /wilaya/$slug Landing Pages", () => {
  type WilayaSlugsMod = {
    WILAYA_SLUGS?: readonly unknown[];
    WILAYA_REGISTRY?: readonly { code: string; slug: string }[];
    wilayaByCode?: (
      code: string,
    ) => { code: string; slug: string } | null | undefined;
    wilayaBySlug?: (
      slug: string,
    ) => { code: string; slug: string } | null | undefined;
    slugForWilayaCode?: (code: string) => string | null | undefined;
    getWilayaSlug?: (code: string) => string | null | undefined;
    getAllWilayaSlugs?: () => Array<{ code: string; slug: string } | string>;
  };

  async function resolveAll69Slugs(): Promise<
    Array<{ code: string; slug: string; nameFr: string; nameAr: string }>
  > {
    const admin = loadAlgeriaAdmin();
    const mod = await importRepoModule<WilayaSlugsMod>(
      "src/lib/wilaya-slugs.ts",
    );

    const lookupSlug = (code: string, nameFr: string): string => {
      const fromFn =
        mod.wilayaByCode?.(code)?.slug ??
        mod.slugForWilayaCode?.(code) ??
        mod.getWilayaSlug?.(code) ??
        null;
      if (typeof fromFn === "string" && fromFn.length > 0) return fromFn;
      return deriveWilayaSlug(nameFr);
    };

    return admin.wilayas.map((w) => ({
      code: w.code,
      slug: lookupSlug(w.code, w.name_fr),
      nameFr: w.name_fr,
      nameAr: w.name_ar,
    }));
  }

  it("F16.1: src/lib/wilaya-slugs.ts deterministically maps all 69 Loi 26-06 wilayas (01..69) to unique ASCII kebab-case slugs", async () => {
    const entries = await resolveAll69Slugs();
    expect(entries).toHaveLength(69);

    const seen = new Set<string>();
    for (const entry of entries) {
      expect(entry.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(seen.has(entry.slug), `Duplicate wilaya slug: ${entry.slug}`).toBe(
        false,
      );
      seen.add(entry.slug);
    }

    const mod = await importRepoModule<WilayaSlugsMod>(
      "src/lib/wilaya-slugs.ts",
    );
    if (mod.wilayaBySlug) {
      for (const entry of entries) {
        const resolved = mod.wilayaBySlug(entry.slug);
        expect(
          resolved?.code,
          `wilayaBySlug('${entry.slug}') must resolve to code ${entry.code}`,
        ).toBe(entry.code);
      }
    }
  });

  it("F16.2: ALL 69 /wilaya/$slug pages return HTTP 200 SSR in BOTH ar and fr (138 total responses)", async () => {
    const entries = await resolveAll69Slugs();
    expect(entries).toHaveLength(69);

    const failures: string[] = [];
    const batchSize = 10;

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.flatMap((w) =>
          (["ar", "fr"] as const).map(async (lang) => {
            const res = await fetchText(`/wilaya/${w.slug}?lang=${lang}`);
            return { code: w.code, slug: w.slug, lang, status: res.status };
          }),
        ),
      );
      for (const r of results) {
        if (r.status !== 200) {
          failures.push(
            `${r.code}/${r.slug}?lang=${r.lang} -> HTTP ${r.status}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("F16.3: wilaya pages include <title>, meta description, canonical link, and hreflang (ar-DZ, fr-DZ, x-default)", async () => {
    const res = await fetchText("/wilaya/alger?lang=fr");
    expect(res.status).toBe(200);
    const html = res.text;

    expect(html).toMatch(/<title>[^<]+<\/title>/i);
    expect(html).toMatch(
      /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}["']/i,
    );
    expect(html).toMatch(
      /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']+\/wilaya\/alger/i,
    );
    expect(html).toMatch(/hreflang=["']ar-DZ["']/i);
    expect(html).toMatch(/hreflang=["']fr-DZ["']/i);
    expect(html).toMatch(/hreflang=["']x-default["']/i);
  });

  it("F16.4: wilaya pages declare og:image pointing to /api/public/share/wilaya/...", async () => {
    const res = await fetchText("/wilaya/alger?lang=ar");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(
      /property=["']og:image["'][^>]+content=["'][^"']*\/api\/public\/share\/wilaya\/alger/i,
    );
  });

  it("F16.5: new 2026 Loi 26-06 wilayas (59 Aflou, 60 Barika, 69 El Abiodh Sidi Cheikh) render localized AR/FR content without bare 'Safe'", async () => {
    const entries = await resolveAll69Slugs();
    const targetCodes = ["59", "60", "69"];

    for (const code of targetCodes) {
      const w = entries.find((entry) => entry.code === code);
      expect(w, `Wilaya ${code} must exist`).toBeDefined();

      const arRes = await fetchText(`/wilaya/${w!.slug}?lang=ar`);
      expect(arRes.status).toBe(200);
      expect(arRes.text).toMatch(/[\u0600-\u06FF]/);
      const arVisibleText = stripHtmlForTextScan(arRes.text);
      expect(findBannedSafeLabels(arVisibleText)).toEqual([]);
      expect(findEmDashesInText(arVisibleText).count).toBe(0);

      const frRes = await fetchText(`/wilaya/${w!.slug}?lang=fr`);
      expect(frRes.status).toBe(200);
      expect(frRes.text.toLowerCase()).toContain(
        w!.nameFr.toLowerCase().slice(0, 5),
      );
      const frVisibleText = stripHtmlForTextScan(frRes.text);
      expect(findBannedSafeLabels(frVisibleText)).toEqual([]);
      expect(findEmDashesInText(frVisibleText).count).toBe(0);
    }
  });

  it("F16.6: robots.txt permits /wilaya/ crawling and sitemap exposes indexable wilaya URLs", async () => {
    const robotsRes = await fetchText("/robots.txt");
    expect(robotsRes.status).toBe(200);
    expect(robotsRes.text).not.toMatch(/Disallow:\s*\/wilaya/i);

    const sitemapRes = await fetchText("/sitemap.xml");
    expect(sitemapRes.status).toBe(200);
    expect(sitemapRes.text).toContain("/wilaya/");
    expect(sitemapRes.text).toContain("/wilaya/alger");
  });
});

describe("Tier 1 — F17: Universal <= 37 KB WhatsApp/Facebook Share Cards (4 Kinds x 4 Locales)", () => {
  async function assertShareCardViaHttpOrRenderer(
    kind: "onm" | "fire" | "quake",
    httpPath: string,
  ): Promise<void> {
    const shareRoutes = listRepoFiles("src/routes/api/public/share");
    expect(
      shareRoutes.length,
      "Share card API route files must exist under src/routes/api/public/share/",
    ).toBeGreaterThan(0);

    const res = await fetchBytes(httpPath);
    if (res.status === 200) {
      const info = await assertValidShareCardImage(
        res.bytes,
        SHARE_CARD_MAX_BYTES,
      );
      expect(info.width).toBeGreaterThan(100);
      expect(info.height).toBeGreaterThan(100);
      return;
    }

    // If the specific entity ID is not seeded in the local test DB (404),
    // verify the real server share-card renderer produces valid <= 37 KB raster bytes for this kind.
    expect(
      res.status,
      `Share card endpoint ${httpPath} must return 200 or 404 (not 500/501)`,
    ).toBe(404);

    const renderMod = await importRepoModule<{
      renderUniversalShareCard?: (
        model: unknown,
        opts: {
          format: "whatsapp" | "facebook" | "og" | "post" | "story" | "sticker";
          codec: "webp" | "jpeg" | "png";
          maxBytes?: number;
        },
      ) => Promise<Uint8Array | null>;
    }>("src/lib/share-render.server.ts");
    const shareCardMod = await importRepoModule<{
      onmCardModel: (
        warning: Record<string, unknown>,
        wilayaLabel: string | null,
        t: (key: string, vars?: Record<string, string>) => string,
        lang: "ar" | "fr" | "en" | "kab",
      ) => unknown;
      fireCardModel: (
        cluster: Record<string, unknown>,
        level: "probable" | "confirmed",
        placeLabel: string | null,
        t: (key: string, vars?: Record<string, string>) => string,
        lang: "ar" | "fr" | "en" | "kab",
      ) => unknown;
      quakeCardModel: (
        quake: Record<string, unknown>,
        placeLabel: string | null,
        t: (key: string, vars?: Record<string, string>) => string,
        lang: "ar" | "fr" | "en" | "kab",
      ) => unknown;
    }>("src/lib/share-card.ts");
    const translatorMod = await importRepoModule<{
      shareTranslator: (
        lang: "ar" | "fr" | "en" | "kab",
      ) => (key: string, vars?: Record<string, string>) => string;
    }>("src/lib/share-translator.ts");

    expect(
      typeof renderMod.renderUniversalShareCard,
      `share-render.server.ts must export renderUniversalShareCard for ${kind}`,
    ).toBe("function");

    const t = translatorMod.shareTranslator("fr");
    const model =
      kind === "onm"
        ? shareCardMod.onmCardModel(
            {
              id: "onm-e2e-16",
              cap_id: "urn:oid:2.49.0.1.12.0.20261124.016",
              title: "نشرية جوية خاصة أمطار غزيرة",
              event: "Pluies",
              severity: "Severe",
              urgency: "Expected",
              certainty: "Observed",
              onset: "2026-11-24T12:00:00Z",
              expires: "2026-11-24T22:00:00Z",
              sent: "2026-11-24T11:30:00Z",
              area_desc: "Alger, Tipaza",
              cap_url: "https://meteo.dz",
              wilaya_id: null,
              headline_fr: "BMS Pluies Niveau 2",
              superseded_at: null,
              msg_type: "Alert",
              cap_references: null,
              superseded_by: null,
              cancelled_at: null,
            },
            "Alger",
            t,
            "fr",
          )
        : kind === "fire"
          ? shareCardMod.fireCardModel(
              {
                id: "fire-e2e-1",
                short_id: "DZ-E2E-1",
                state: "probable",
                first_detected_at: "2026-11-24T13:30:00Z",
                last_detected_at: "2026-11-24T14:00:00Z",
                updated_at: "2026-11-24T14:00:00Z",
                lat: 36.7118,
                lon: 4.0459,
                detection_count: 5,
                sources: ["firms", "fci"],
                confirmed_at: null,
                resolved_at: null,
                suspected_persistent_source: false,
              },
              "probable",
              "Tizi Ouzou",
              t,
              "fr",
            )
          : shareCardMod.quakeCardModel(
              {
                id: "20261124_0000046",
                occurred_at: "2026-11-24T13:42:18Z",
                lat: 36.7525,
                lon: 5.0556,
                depth_km: 10,
                magnitude: 4.6,
                magnitude_type: "ml",
                region: "NORTHERN ALGERIA",
                network: "EMSC / CRAAG",
                commune_id: null,
                offshore: false,
                updated_at: "2026-11-24T13:44:05Z",
              },
              "Béjaïa",
              t,
              "fr",
            );

    const bytes = await renderMod.renderUniversalShareCard!(model, {
      format: "whatsapp",
      codec: "webp",
      maxBytes: SHARE_CARD_MAX_BYTES,
    });
    expect(bytes, `Renderer returned null for ${kind}`).toBeInstanceOf(
      Uint8Array,
    );
    const info = await assertValidShareCardImage(bytes!, SHARE_CARD_MAX_BYTES);
    expect(info.width).toBeGreaterThan(100);
    expect(info.height).toBeGreaterThan(100);
  }

  it("F17.1: ONM warning share card renders a valid raster image <= 37,888 bytes", async () => {
    await assertShareCardViaHttpOrRenderer(
      "onm",
      "/api/public/share/onm/16.whatsapp.webp?lang=fr",
    );
  });

  it("F17.2: Probable Fire share card renders a valid raster image <= 37,888 bytes", async () => {
    let fireId = "sample-fire";
    const firesRes = await fetchJson<{
      fires?: Array<{ short_id?: string }>;
    }>("/api/public/v1/fires?limit=1").catch(() => null);
    if (firesRes?.status === 200 && firesRes.data.fires?.[0]?.short_id) {
      fireId = firesRes.data.fires[0].short_id;
    }

    await assertShareCardViaHttpOrRenderer(
      "fire",
      `/api/public/share/fire/${encodeURIComponent(fireId)}.whatsapp.webp?lang=fr`,
    );
  });

  it("F17.3: Earthquake share card renders a valid raster image <= 37,888 bytes", async () => {
    await assertShareCardViaHttpOrRenderer(
      "quake",
      "/api/public/share/quake/latest.whatsapp.webp?lang=fr",
    );
  });

  it("F17.4: Wilaya share card (/api/public/share/wilaya/alger.whatsapp.webp) returns HTTP 200 with valid raster image <= 37,888 bytes", async () => {
    const res = await fetchBytes(
      "/api/public/share/wilaya/alger.whatsapp.webp?lang=fr",
    );
    expect(res.status).toBe(200);
    const info = await assertValidShareCardImage(
      res.bytes,
      SHARE_CARD_MAX_BYTES,
    );
    expect(info.width).toBeGreaterThan(100);
    expect(info.height).toBeGreaterThan(100);
  });

  it("F17.5: ?lang= switching across ar, fr, en, and kab each produces valid <= 37,888 byte images with distinct localized output", async () => {
    const results: Record<string, Uint8Array> = {};
    for (const lang of ["ar", "fr", "en", "kab"] as const) {
      const res = await fetchBytes(
        `/api/public/share/wilaya/alger.whatsapp.webp?lang=${lang}`,
      );
      expect(
        res.status,
        `wilaya share card ?lang=${lang} must return 200`,
      ).toBe(200);
      await assertValidShareCardImage(res.bytes, SHARE_CARD_MAX_BYTES);
      results[lang] = res.bytes;
    }

    // Arabic and French localized share cards must render distinct raster bytes
    expect(byteArraysEqual(results.ar!, results.fr!)).toBe(false);
  });

  it("F17.6: share-card payload & renderer enforce attribution first, Africa/Algiers timestamp, nadhir.app footer, and zero Nadhir-voiced Instructions", () => {
    const shareCardSrc = readRepoFile("src/lib/share-card.ts");
    const renderSrc = readRepoFile("src/lib/share-render.server.ts");
    const combined = `${shareCardSrc}\n${renderSrc}`;

    expect(combined).toMatch(/Africa\/Algiers|algiers/i);
    expect(combined).toContain("nadhir.app");
    expect(combined).toMatch(/attribution|source/i);
    expect(findBannedSafeLabels(shareCardSrc)).toEqual([]);
  });
});
