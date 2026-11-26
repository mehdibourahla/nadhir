import { PNG } from "pngjs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { stripImageMetadata } from "@/lib/image-metadata";
import {
  e2eBaseUrl,
  e2ePgUrl,
  importRepoModule,
  listRepoFiles,
  readRepoFile,
  REPO_ROOT,
  repoFileExists,
} from "./env.ts";
import {
  createJpegWithExif,
  createPngWithExif,
  createSpoofedMimePayload,
  inspectImageForMetadata,
} from "./exif.ts";
import {
  buildClmsFixture,
  buildCraagBulletin,
  buildDgpcNonFirePost,
  buildEmscEvent,
  buildGhslFixture,
  buildGwisFixture,
  buildImergFixture,
  buildMtgFciFixture,
  buildMtgLightningFixture,
  buildOnmCapXml,
  buildTarikiPost,
  deriveWilayaSlug,
  HTTP_200_HTML_ERROR_BODY,
  loadAlgeriaAdmin,
  loadLoi2606,
} from "./fixtures.ts";
import {
  fetchBytes,
  fetchJson,
  fetchText,
  startMockHttpServer,
} from "./http.ts";
import {
  assertValidShareCardImage,
  decodeRasterDimensions,
  detectImageFormat,
  SHARE_CARD_MAX_BYTES,
} from "./image.ts";
import {
  findBannedSafeLabels,
  findEmDashesInText,
  measureContrastViolations,
  measureHorizontalOverflow,
  measureTouchTargets,
  stripHtmlForTextScan,
  VIEWPORTS,
  withBrowserPage,
} from "./playwright.ts";

describe("E2E Harness Self-Tests", () => {
  describe("env.ts", () => {
    it("resolves repository files and dynamically imports existing modules", async () => {
      expect(REPO_ROOT.length).toBeGreaterThan(0);
      expect(e2eBaseUrl()).toMatch(/^https?:\/\//);
      expect(e2ePgUrl()).toContain("postgres");
      expect(repoFileExists("data/geo/algeria-admin.json")).toBe(true);
      expect(readRepoFile("package.json")).toContain('"name"');

      const geoFiles = listRepoFiles("data/geo", ".json");
      expect(geoFiles).toContain("data/geo/algeria-admin.json");
      expect(geoFiles).toContain("data/geo/loi-26-06.json");

      const channelsMod = await importRepoModule<{
        NOTIFICATION_CHANNEL_IDS: readonly string[];
      }>("src/lib/notification-channels.ts");
      expect(channelsMod.NOTIFICATION_CHANNEL_IDS).toContain("alerts_urgent");
    });

    it("throws a descriptive error when importing a missing module", async () => {
      await expect(
        importRepoModule("src/lib/does-not-exist-e2e-probe.ts"),
      ).rejects.toThrow(/Missing required repository module/);
    });
  });

  describe("exif.ts & image.ts", () => {
    it("generates genuine JPEG with APP1 Exif/GPS/Camera + COM and verifies stripping", async () => {
      const jpegWithExif = createJpegWithExif({
        make: "Samsung",
        model: "Galaxy A55",
        latitude: 36.7538,
        longitude: 3.0588,
        includeIccProfile: true,
      });

      expect(detectImageFormat(jpegWithExif)).toBe("jpeg");
      const before = inspectImageForMetadata(jpegWithExif);
      expect(before.format).toBe("jpeg");
      expect(before.hasExif).toBe(true);
      expect(before.hasGps).toBe(true);
      expect(before.hasCameraTags).toBe(true);
      expect(before.hasTextChunks).toBe(true);
      expect(before.markers).toContain("APP1");
      expect(before.markers).toContain("APP2-ICC");
      expect(before.markers).toContain("COM");

      const decodedBefore = await decodeRasterDimensions(jpegWithExif);
      expect(decodedBefore.width).toBe(16);
      expect(decodedBefore.height).toBe(16);
      expect(decodedBefore.isBlank).toBe(false);

      const stripped = stripImageMetadata(jpegWithExif, "image/jpeg");
      const after = inspectImageForMetadata(stripped);
      expect(after.format).toBe("jpeg");
      expect(after.hasExif).toBe(false);
      expect(after.hasGps).toBe(false);
      expect(after.hasCameraTags).toBe(false);
      expect(after.hasTextChunks).toBe(false);
      expect(after.markers).toContain("APP2-ICC");

      const decodedAfter = await decodeRasterDimensions(stripped);
      expect(decodedAfter.width).toBe(16);
      expect(decodedAfter.height).toBe(16);
      expect(decodedAfter.isBlank).toBe(false);
    });

    it("generates genuine PNG with eXIf, tEXt, iTXt chunks and verifies stripping", async () => {
      const pngWithExif = createPngWithExif();
      expect(detectImageFormat(pngWithExif)).toBe("png");

      const before = inspectImageForMetadata(pngWithExif);
      expect(before.format).toBe("png");
      expect(before.hasExif).toBe(true);
      expect(before.hasGps).toBe(true);
      expect(before.hasCameraTags).toBe(true);
      expect(before.hasTextChunks).toBe(true);
      expect(before.markers).toContain("eXIf");
      expect(before.markers).toContain("tEXt");
      expect(before.markers).toContain("iTXt");

      const decoded = await assertValidShareCardImage(pngWithExif);
      expect(decoded.width).toBe(16);
      expect(decoded.height).toBe(16);
      expect(decoded.isBlank).toBe(false);

      const stripped = stripImageMetadata(pngWithExif, "image/png");
      const after = inspectImageForMetadata(stripped);
      expect(after.hasExif).toBe(false);
      expect(after.hasGps).toBe(false);
      expect(after.hasCameraTags).toBe(false);
      expect(after.hasTextChunks).toBe(false);
    });

    it("places PNG eXIf chunk before IDAT so sharp/libpng parses EXIF bytes and handles JPEG 0xFF fill bytes", async () => {
      const pngWithExif = createPngWithExif();
      const pngMeta = await sharp(Buffer.from(pngWithExif)).metadata();
      expect(pngMeta.exif).toBeDefined();
      expect(pngMeta.exif!.byteLength).toBeGreaterThan(0);

      const pngInspection = inspectImageForMetadata(pngWithExif);
      const exifIdx = pngInspection.markers.indexOf("eXIf");
      const idatIdx = pngInspection.markers.indexOf("IDAT");
      expect(exifIdx).toBeGreaterThan(0);
      expect(idatIdx).toBeGreaterThan(exifIdx);

      // Insert legal ISO/IEC 10918-1 0xFF fill byte(s) and a standalone TEM marker (0xFF 0x01)
      // immediately after SOI (0xFF 0xD8) and before APP1 (0xFF 0xE1).
      const jpegWithExif = createJpegWithExif();
      const paddedJpeg = new Uint8Array(jpegWithExif.byteLength + 4);
      paddedJpeg.set(jpegWithExif.subarray(0, 2), 0); // SOI
      paddedJpeg[2] = 0xff; // standalone TEM marker
      paddedJpeg[3] = 0x01;
      paddedJpeg[4] = 0xff; // consecutive 0xFF fill bytes before APP1
      paddedJpeg[5] = 0xff;
      paddedJpeg.set(jpegWithExif.subarray(2), 6);

      const paddedInspection = inspectImageForMetadata(paddedJpeg);
      expect(paddedInspection.format).toBe("jpeg");
      expect(paddedInspection.hasExif).toBe(true);
      expect(paddedInspection.hasGps).toBe(true);
      expect(paddedInspection.hasCameraTags).toBe(true);
      expect(paddedInspection.markers).toContain("APP1");
    });

    it("detects spoofed MIME payloads, oversized share cards, and blank solid-color stubs", async () => {
      const spoofed = createSpoofedMimePayload();
      expect(detectImageFormat(spoofed)).toBe("unknown");
      expect(inspectImageForMetadata(spoofed).format).toBe("unknown");
      await expect(assertValidShareCardImage(spoofed)).rejects.toThrow(
        /not a valid PNG, JPEG, or WebP/,
      );

      // Solid-color blank PNG should be rejected by assertValidShareCardImage.
      const blankPng = new PNG({ width: 32, height: 32 });
      blankPng.data.fill(255);
      const blankBytes = Uint8Array.from(PNG.sync.write(blankPng));
      await expect(assertValidShareCardImage(blankBytes)).rejects.toThrow(
        /blank\/solid-color/,
      );

      // Oversized payload > 37,888 bytes should be rejected.
      const validPng = createPngWithExif();
      await expect(
        assertValidShareCardImage(validPng, validPng.byteLength - 1),
      ).rejects.toThrow(/exceeds byte budget/);
      expect(SHARE_CARD_MAX_BYTES).toBe(37_888);
    });
  });

  describe("http.ts", () => {
    it("starts an ephemeral mock HTTP server, records requests, and closes cleanly", async () => {
      const server = await startMockHttpServer((req) => {
        if (req.pathname === "/json") {
          return {
            status: 201,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ echoed: req.body, lang: req.query.lang }),
          };
        }
        if (req.pathname === "/bytes") {
          return {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
            body: new Uint8Array([1, 2, 3, 4]),
          };
        }
        return {
          status: 200,
          headers: { "content-type": "text/plain" },
          body: "nadhir-ok",
        };
      });

      try {
        const textRes = await fetchText(`${server.url}/health`);
        expect(textRes.status).toBe(200);
        expect(textRes.text).toBe("nadhir-ok");

        const jsonRes = await fetchJson<{ echoed: string; lang: string }>(
          `${server.url}/json?lang=ar`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"hello":"world"}',
          },
        );
        expect(jsonRes.status).toBe(201);
        expect(jsonRes.data).toEqual({
          echoed: '{"hello":"world"}',
          lang: "ar",
        });

        const bytesRes = await fetchBytes(`${server.url}/bytes`);
        expect(Array.from(bytesRes.bytes)).toEqual([1, 2, 3, 4]);

        expect(server.requests).toHaveLength(3);
        expect(server.requests[1]?.method).toBe("POST");
        expect(server.requests[1]?.pathname).toBe("/json");
      } finally {
        await server.close();
      }
    });
  });

  describe("fixtures.ts", () => {
    it("loads all 69 Algeria wilayas, 1,537 communes, and Loi 26-06 with collision-free slugs", () => {
      const admin = loadAlgeriaAdmin();
      expect(admin.wilayas).toHaveLength(69);
      expect(admin.communes).toHaveLength(1537);

      const slugs = admin.wilayas.map((w) => deriveWilayaSlug(w.name_fr));
      expect(new Set(slugs).size).toBe(69);
      expect(deriveWilayaSlug("Alger")).toBe("alger");
      expect(deriveWilayaSlug("Béjaïa")).toBe("bejaia");
      expect(deriveWilayaSlug("Bou Saâda")).toBe("bou-saada");
      expect(deriveWilayaSlug("El Abiodh Sidi Cheikh")).toBe(
        "el-abiodh-sidi-cheikh",
      );

      const loi = loadLoi2606();
      expect(loi.total_wilayas).toBe(69);
      expect(loi.wilayas).toHaveLength(21);
    });

    it("builds valid CAP 1.2 XML (Alert, Update, Cancel) and multi-source fixtures", () => {
      const alertXml = buildOnmCapXml({
        identifier: "onm-2026-001",
        msgType: "Alert",
        severity: "Moderate",
      });
      expect(alertXml).toContain("urn:oasis:names:tc:emergency:cap:1.2");
      expect(alertXml).toContain("<msgType>Alert</msgType>");
      expect(alertXml).toContain("Office National de la Météorologie (ONM)");

      const updateXml = buildOnmCapXml({
        identifier: "onm-2026-002",
        msgType: "Update",
        references: "onm@meteo.dz,onm-2026-001,2026-11-24T12:00:00+01:00",
        severity: "Extreme",
      });
      expect(updateXml).toContain("<references>");
      expect(updateXml).toContain("<severity>Extreme</severity>");

      const cancelXml = buildOnmCapXml({
        identifier: "onm-2026-003",
        msgType: "Cancel",
        references: "onm@meteo.dz,onm-2026-002,2026-11-24T13:00:00+01:00",
        expires: null,
      });
      expect(cancelXml).toContain("<msgType>Cancel</msgType>");
      expect(cancelXml).not.toContain("<expires>");

      expect(buildDgpcNonFirePost({ kind: "flood" }).sourceKey).toBe(
        "dgpc_telegram",
      );
      expect(
        buildDgpcNonFirePost({ kind: "retrospective" })
          .isRetrospectiveCasualtyReport,
      ).toBe(true);
      expect(buildDgpcNonFirePost({ kind: "ita_media" }).sourceKey).toBe(
        "ita_facebook",
      );

      const tarikiTatweel = buildTarikiPost({ kind: "tatweel_hashtag_emoji" });
      expect(tarikiTatweel.rawText).toContain("\u0640");
      expect(tarikiTatweel.expectedDangerous).toBe(true);
      expect(buildTarikiPost({ kind: "road_works" }).expectedDangerous).toBe(
        false,
      );
      expect(buildTarikiPost({ kind: "convoy" }).expectedDangerous).toBe(false);
      expect(
        buildTarikiPost({ kind: "heavy_trucks_only" }).expectedDangerous,
      ).toBe(false);

      expect(buildEmscEvent({ mag: 4.6 }).properties.mag).toBe(4.6);
      expect(buildCraagBulletin({ mode: "html" }).html).toContain("CRAAG");
      expect(buildCraagBulletin({ mode: "error_html" }).html).toBe(
        HTTP_200_HTML_ERROR_BODY,
      );
      expect(buildImergFixture().sourceType).toBe("observed_satellite");
      expect(
        buildMtgFciFixture({ quietSaharaOnly: true }).hotspots[0]
          ?.insideWatchArea,
      ).toBe(false);
      expect(buildMtgLightningFixture().flashes.length).toBeGreaterThan(0);
      expect(buildGwisFixture().burnedAreaHa).toBeGreaterThan(0);
      expect(buildClmsFixture().ndvi).toBeGreaterThan(0);
      expect(buildGhslFixture().populationWithin5km).toBeGreaterThan(0);
    });
  });

  describe("playwright.ts", () => {
    it("detects em-dashes and ADR-0002 banned safe labels accurately", () => {
      const emDash = findEmDashesInText("Alert — Severe storm — Algiers");
      expect(emDash.count).toBe(2);
      expect(findEmDashesInText("Alert: Severe storm, Algiers").count).toBe(0);

      expect(
        findBannedSafeLabels(
          "Family check-in: reported safe at 14:30 near Tizi Ouzou",
        ),
      ).toEqual([]);
      expect(
        findBannedSafeLabels("This open area is not a safe zone."),
      ).toEqual([]);

      const violations = findBannedSafeLabels(
        "Status: Safe Zone\nSafe\nAll-Clear\nMark Safe",
      );
      expect(violations.length).toBeGreaterThanOrEqual(4);

      // Regression: bounded `near` capture must not swallow same-line banned labels,
      // and inline labeled status badges must be caught.
      expect(findBannedSafeLabels("reported safe at 14:30 near Alger")).toEqual(
        [],
      );
      expect(
        findBannedSafeLabels("reported safe at 14:30 near Alger, Safe zone")
          .length,
      ).toBeGreaterThan(0);
      expect(findBannedSafeLabels("Status: Safe").length).toBeGreaterThan(0);
      expect(findBannedSafeLabels("Statut : sûre").length).toBeGreaterThan(0);
      expect(findBannedSafeLabels("الحالة: آمنة").length).toBeGreaterThan(0);

      // Regression: Nadhir's own ADR-0002 negated honesty disclaimers (fr.ts:324, ar.ts:316, en.ts:488,796)
      // must NOT trigger false positives.
      expect(
        findBannedSafeLabels(
          "Publication historique. Son expiration ou retrait ne signifie pas que l’incident est terminé ou la zone sûre.",
        ),
      ).toEqual([]);
      expect(
        findBannedSafeLabels(
          "منشور سابق. انتهاء صلاحيته أو سحبه لا يعني انتهاء الحادث أو أن المنطقة آمنة.",
        ),
      ).toEqual([]);
      expect(
        findBannedSafeLabels(
          "Not named in the bulletin of 14:00. Protection Civile does not publish a per-commune all-clear, so this is not a sign the fire is out.",
        ),
      ).toEqual([]);
      expect(
        findBannedSafeLabels("Notice period over — this is not an all-clear"),
      ).toEqual([]);

      // Regression: stripHtmlForTextScan removes <script>, <style>, comments, and tags.
      const cleanHtml =
        '<!doctype html><html><head><style>/* Safe zone — ignored */</style></head><body><!-- All-Clear --><script>const x = "Safe zone — test";</script><main><p>Alger vigilance météo</p></main></body></html>';
      const strippedClean = stripHtmlForTextScan(cleanHtml);
      expect(strippedClean).toBe("Alger vigilance météo");
      expect(findBannedSafeLabels(strippedClean)).toEqual([]);
      expect(findEmDashesInText(strippedClean).count).toBe(0);

      const badHtml = "<div><p>Status: Safe</p></div>";
      expect(
        findBannedSafeLabels(stripHtmlForTextScan(badHtml)).length,
      ).toBeGreaterThan(0);
    });

    it("measures Tailwind CSS v4 oklch(), oklab(), color(srgb), and color-mix() contrast accurately", async () => {
      const mockHtml = `<!DOCTYPE html>
<html lang="fr" dir="ltr">
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; font-family: sans-serif; background: oklch(1 0 0); }
    #oklch-dark { color: oklch(0.1 0 0); background: oklch(1 0 0); }
    #oklch-red-700 { color: oklch(0.505 0.213 27.518); background: #ffffff; }
    #srgb-dark { color: color(srgb 0 0 0); background: color-mix(in oklab, white 95%, transparent); }
    #oklch-low { color: oklch(0.85 0.01 90); background: oklch(0.92 0.01 90); }
  </style>
</head>
<body>
  <main>
    <h1 id="oklch-dark">High contrast oklch dark text on white</h1>
    <p id="oklch-red-700">Tailwind v4 text-red-700 on white</p>
    <p id="srgb-dark">CSS Color 4 srgb on color-mix surface</p>
    <p id="oklch-low">Low contrast oklch text</p>
  </main>
</body>
</html>`;

      const server = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: mockHtml,
      }));

      try {
        await withBrowserPage(
          { locale: "fr", viewport: VIEWPORTS.mobile },
          async (page) => {
            await page.goto(server.url, { waitUntil: "domcontentloaded" });
            const violations = await measureContrastViolations(page, 4.5);
            const selectors = violations.map((v) => v.selector);

            expect(selectors).toEqual(["p#oklch-low"]);
            expect(selectors).not.toContain("h1#oklch-dark");
            expect(selectors).not.toContain("p#oklch-red-700");
            expect(selectors).not.toContain("p#srgb-dark");
          },
        );
      } finally {
        await server.close();
      }
    });

    it("launches headless Chromium and verifies Arabic RTL, overflow, touch targets, and WCAG contrast", async () => {
      const mockHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; font-family: sans-serif; background: #ffffff; color: #111827; }
    .good-btn { min-width: 48px; min-height: 48px; background: #111827; color: #ffffff; border: 0; }
    .tiny-btn { width: 24px; height: 24px; background: #111827; color: #ffffff; border: 0; }
    .low-contrast { color: #b5b5b5; background: #ffffff; }
    .wide-overflow { width: 520px; height: 10px; }
  </style>
</head>
<body>
  <main>
    <h1 id="title">نذير للإنذار متعدد المخاطر</h1>
    <button id="ok-btn" class="good-btn">تحديث</button>
    <button id="bad-btn" class="tiny-btn">×</button>
    <p id="low-c" class="low-contrast">نص ضعيف التباين</p>
    <div class="wide-overflow"></div>
  </main>
</body>
</html>`;

      const server = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: mockHtml,
      }));

      try {
        await withBrowserPage(
          { locale: "ar", viewport: VIEWPORTS.mobile },
          async (page) => {
            await page.goto(server.url, { waitUntil: "domcontentloaded" });
            const meta = await page.evaluate(() => ({
              dir: document.documentElement.getAttribute("dir"),
              lang: document.documentElement.getAttribute("lang"),
              title: document.getElementById("title")?.textContent ?? "",
            }));

            expect(meta.dir).toBe("rtl");
            expect(meta.lang).toBe("ar");
            expect(meta.title).toContain("نذير");

            const overflow = await measureHorizontalOverflow(page);
            expect(overflow.hasOverflow).toBe(true);
            expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);

            const touchViolations = await measureTouchTargets(page, 44);
            expect(touchViolations.map((v) => v.selector)).toContain(
              "button#bad-btn",
            );
            expect(touchViolations.map((v) => v.selector)).not.toContain(
              "button#ok-btn",
            );

            const contrastViolations = await measureContrastViolations(
              page,
              4.5,
            );
            expect(contrastViolations.map((v) => v.selector)).toContain(
              "p#low-c",
            );
            expect(contrastViolations.map((v) => v.selector)).not.toContain(
              "h1#title",
            );
          },
        );
      } finally {
        await server.close();
      }
    });
  });
});
