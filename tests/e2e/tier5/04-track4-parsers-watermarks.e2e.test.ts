import { describe, expect, it } from "vitest";

import { importRepoModule } from "../lib/env.ts";

const IMPOSSIBLE_ISO_DATES = [
  "2026-02-30T12:00:00Z",
  "2026-04-31T00:00:00Z",
  "2026-02-29T12:00:00Z",
  "1",
  "May 2026",
  "2026-11-25T25:00:00Z",
] as const;

describe("Tier 5 — Track 4 Parsers, Watermarks & Coordinates Adversarial Hardening", () => {
  describe("T5-03: Strict calendar-safe timestamp validation across all 8 M6 parsers", () => {
    it("rejects impossible calendar dates and non-ISO strings in IMERG and H-SAF without rolling over", async () => {
      const imergMod = await importRepoModule<{
        parseIsoTimestamp: (
          value: unknown,
          label: string,
          source: string,
        ) => string;
        parseImergPayload: (
          payload: Record<string, unknown>,
        ) => Promise<unknown>;
      }>("src/lib/ingest/imerg.ts");
      const hsafMod = await importRepoModule<{
        parseHsafPayload: (
          payload: Record<string, unknown>,
        ) => Promise<unknown>;
      }>("src/lib/ingest/hsaf.ts");

      // Valid leap-year date must still pass
      expect(
        imergMod.parseIsoTimestamp(
          "2024-02-29T12:00:00Z",
          "valid_time",
          "IMERG",
        ),
      ).toBe("2024-02-29T12:00:00.000Z");

      for (const bad of IMPOSSIBLE_ISO_DATES) {
        expect(
          () => imergMod.parseIsoTimestamp(bad, "valid_time", "IMERG"),
          bad,
        ).toThrow(/schema invalid/i);
        await expect(
          imergMod.parseImergPayload({
            valid_time: bad,
            window_minutes: 30,
            cells: [],
          }),
        ).rejects.toThrow(/schema invalid/i);
        await expect(
          hsafMod.parseHsafPayload({
            valid_time: bad,
            window_minutes: 30,
            cells: [],
          }),
        ).rejects.toThrow(/schema invalid/i);
      }
    });

    it("rejects impossible calendar dates in MTG FCI Push and MTG Lightning L2", async () => {
      const fciMod = await importRepoModule<{
        parseMtgFciPushPayload: (payload: Record<string, unknown>) => unknown;
      }>("src/lib/ingest/mtg-fci-push.ts");
      const liMod = await importRepoModule<{
        parseMtgLightningPayload: (payload: Record<string, unknown>) => unknown;
      }>("src/lib/ingest/mtg-lightning.ts");

      for (const bad of ["2026-02-30T12:00:00Z", "2026-04-31T00:00:00Z", "1"]) {
        expect(() =>
          fciMod.parseMtgFciPushPayload({
            product_id: "EO:EUM:DAT:0662",
            slot_time: bad,
            published_at: bad,
            pixels: [],
          }),
        ).toThrow(/schema invalid/i);

        expect(() =>
          liMod.parseMtgLightningPayload({
            published_at: bad,
            flashes: [],
          }),
        ).toThrow(/schema invalid/i);
      }
    });

    it("rejects impossible calendar dates in GWIS, CLMS, and GHSL without advancing watermarks", async () => {
      const gwisMod = await importRepoModule<{
        parseGwisPayload: (payload: Record<string, unknown>) => unknown;
      }>("src/lib/ingest/gwis.ts");
      const clmsMod = await importRepoModule<{
        parseClmsPayload: (
          payload: Record<string, unknown>,
        ) => Promise<unknown>;
      }>("src/lib/ingest/clms.ts");
      const ghslMod = await importRepoModule<{
        parseGhslPayload: (
          payload: Record<string, unknown>,
        ) => Promise<unknown>;
      }>("src/lib/ingest/ghsl.ts");

      for (const bad of [
        "2026-02-30T12:00:00Z",
        "2026-04-31T00:00:00Z",
        "May 2026",
      ]) {
        expect(() =>
          gwisMod.parseGwisPayload({
            type: "FeatureCollection",
            published_at: bad,
            features: [],
          }),
        ).toThrow(/schema invalid/i);

        await expect(
          clmsMod.parseClmsPayload({
            product_version: "v2",
            observed_at: "2026-11-24",
            published_at: bad,
            cells: [],
          }),
        ).rejects.toThrow(/schema invalid/i);

        await expect(
          ghslMod.parseGhslPayload({
            epoch_year: 2025,
            resolution_m: 1000,
            crs: "EPSG:4326",
            published_at: bad,
            cells: [],
          }),
        ).rejects.toThrow(/schema invalid/i);
      }
    });

    it("rejects impossible ISO and DMY/YMD calendar dates in CRAAG earthquake parser", async () => {
      const craagMod = await importRepoModule<{
        parseCraagTimestamp: (raw: string) => string;
        parseCraagBulletins: (payload: Record<string, unknown>) => unknown;
      }>("src/lib/ingest/craag.ts");

      for (const bad of [
        "2026-02-30T12:00:00Z",
        "2026-04-31T00:00:00Z",
        "30/02/2026 12:00:00",
        "31/04/2026 08:15:00",
        "2026-02-29 12:00:00",
        "May 2026",
      ]) {
        expect(() => craagMod.parseCraagTimestamp(bad), bad).toThrow(
          /CRAAG schema invalid/i,
        );
        expect(() =>
          craagMod.parseCraagBulletins({
            bulletins: [
              {
                observed_at: bad,
                lat: 36.75,
                lon: 3.05,
                magnitude: 4.1,
                place: "Alger",
              },
            ],
          }),
        ).toThrow(/CRAAG schema invalid/i);
      }
    });
  });

  describe("T5-04: CRAAG adjacent compass coordinates & western Algeria EMSC matching", () => {
    it("parses adjacent compass letters (W/O/S/N/E) with accurate signs without false matches on English/French words", async () => {
      const craagMod = await importRepoModule<{
        parseCraagCoordinate: (
          raw: string | number,
          axis: "lat" | "lon",
        ) => number;
        parseCraagBulletins: (payload: Record<string, unknown>) => {
          bulletins: Array<{
            bulletinId: string;
            observedAt: string;
            lat: number;
            lon: number;
            magnitude: number;
          }>;
        };
        matchCraagToEmsc: (
          bulletin: Record<string, unknown>,
          candidates: Array<Record<string, unknown>>,
        ) => { earthquakeId: string; distanceKm: number } | null;
      }>("src/lib/ingest/craag.ts");

      expect(craagMod.parseCraagCoordinate("1.25W", "lon")).toBe(-1.25);
      expect(craagMod.parseCraagCoordinate("1.25O", "lon")).toBe(-1.25);
      expect(craagMod.parseCraagCoordinate("36.75S", "lat")).toBe(-36.75);
      expect(craagMod.parseCraagCoordinate("36.75N", "lat")).toBe(36.75);
      expect(craagMod.parseCraagCoordinate("3.05E", "lon")).toBe(3.05);
      expect(craagMod.parseCraagCoordinate("1.25 غربا", "lon")).toBe(-1.25);
      expect(craagMod.parseCraagCoordinate("NORTH 36.75", "lat")).toBe(36.75);
      expect(craagMod.parseCraagCoordinate("WEST 1.25", "lon")).toBe(1.25);
      expect(craagMod.parseCraagCoordinate("EST 3.05", "lon")).toBe(3.05);

      const parsed = craagMod.parseCraagBulletins({
        bulletins: [
          {
            observed_at: "2026-11-25T14:10:00Z",
            lat: "35.69N",
            lon: "1.25W",
            magnitude: 4.5,
            place: "Tlemcen / Oran",
          },
        ],
      });
      expect(parsed.bulletins).toHaveLength(1);
      expect(parsed.bulletins[0]!.lon).toBe(-1.25);

      const match = craagMod.matchCraagToEmsc(parsed.bulletins[0]!, [
        {
          id: "emsc-east-decoy",
          occurred_at: "2026-11-25T14:10:05Z",
          lat: 35.69,
          lon: 1.25,
          magnitude: 4.5,
        },
        {
          id: "emsc-west-oran",
          occurred_at: "2026-11-25T14:10:08Z",
          lat: 35.7,
          lon: -1.24,
          magnitude: 4.4,
        },
      ]);
      expect(match?.earthquakeId).toBe("emsc-west-oran");
      expect(match!.distanceKm).toBeLessThan(5);
    });
  });

  describe("T5-11: IMERG & H-SAF long HTML comment & XML error guard parity", () => {
    it("rejects HTTP 200 HTML error pages preceded by >512-byte comments, unclosed comments, and se_xml/+xml types", async () => {
      const imergMod = await importRepoModule<{
        assertNotUpstreamErrorBody: (
          body: string | ArrayBuffer | Uint8Array,
          contentType: string | null | undefined,
          sourceName: string,
        ) => void;
        parseImergPayload: (
          payload: string,
          opts?: { contentType?: string },
        ) => Promise<unknown>;
      }>("src/lib/ingest/imerg.ts");
      const hsafMod = await importRepoModule<{
        parseHsafPayload: (
          payload: string,
          opts?: { contentType?: string },
        ) => Promise<unknown>;
      }>("src/lib/ingest/hsaf.ts");

      const longCommentHtml = `<!-- ${"A".repeat(600)} --><html><body>502 Bad Gateway</body></html>`;
      const unclosedComment = `<!-- ${"B".repeat(5000)}`;

      expect(() =>
        imergMod.assertNotUpstreamErrorBody(
          longCommentHtml,
          "application/octet-stream",
          "IMERG",
        ),
      ).toThrow(/HTML\/XML error page/i);
      expect(() =>
        imergMod.assertNotUpstreamErrorBody(
          unclosedComment,
          "application/octet-stream",
          "IMERG",
        ),
      ).toThrow(/HTML\/XML error page/i);
      expect(() =>
        imergMod.assertNotUpstreamErrorBody(
          "<ServiceExceptionReport/>",
          "application/vnd.ogc.se_xml",
          "IMERG",
        ),
      ).toThrow(/error content-type/i);

      await expect(
        imergMod.parseImergPayload(longCommentHtml, {
          contentType: "application/octet-stream",
        }),
      ).rejects.toThrow(/HTML\/XML error page/i);
      await expect(
        hsafMod.parseHsafPayload(longCommentHtml, {
          contentType: "application/octet-stream",
        }),
      ).rejects.toThrow(/HTML\/XML error page/i);
      await expect(
        hsafMod.parseHsafPayload(unclosedComment, {
          contentType: "application/octet-stream",
        }),
      ).rejects.toThrow(/HTML\/XML error page/i);
      expect(() =>
        imergMod.assertNotUpstreamErrorBody(
          "<!-- ok --> 502 Bad Gateway",
          "application/octet-stream",
          "IMERG",
        ),
      ).toThrow(/plain-text error response/i);
    });
  });

  describe("T5-R2-03: Tariki M6 parser strict calendar non-rollover & watermark integrity", () => {
    it("rejects impossible calendar dates and non-ISO strings in both captured items and Facebook page batches", async () => {
      const tarikiMod = await importRepoModule<{
        tarikiPostsFromCapturedItems: (raw: unknown) => {
          posts: Array<{ publishedAt: string }>;
          upstreamPublishedAt: string | null;
        };
        tarikiPostsFromFacebookPage: (
          posts: Array<{ id: string; created_time: string; message: string }>,
        ) => {
          posts: Array<{ publishedAt: string }>;
          upstreamPublishedAt: string | null;
        };
      }>("src/lib/text-sources/tariki.ts");

      for (const bad of IMPOSSIBLE_ISO_DATES) {
        expect(
          () =>
            tarikiMod.tarikiPostsFromCapturedItems([
              {
                postId: "t5-tariki-bad",
                time: bad,
                text: "فيضان بالطريق الوطني رقم 11",
              },
            ]),
          `captured:${bad}`,
        ).toThrow(/Tariki schema invalid/i);

        expect(
          () =>
            tarikiMod.tarikiPostsFromFacebookPage([
              {
                id: "t5-fb-bad",
                created_time: bad,
                message: "فيضان بالطريق الوطني رقم 11",
              },
            ]),
          `facebook:${bad}`,
        ).toThrow(/Tariki schema invalid/i);
      }

      const validLeap = tarikiMod.tarikiPostsFromCapturedItems([
        {
          postId: "t5-tariki-leap",
          time: "2024-02-29T12:00:00Z",
          text: "فيضان بالطريق الوطني رقم 11",
        },
      ]);
      expect(validLeap.upstreamPublishedAt).toBe("2024-02-29T12:00:00.000Z");
      expect(validLeap.posts[0]?.publishedAt).toBe("2024-02-29T12:00:00.000Z");
    });
  });
});
