import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import type { AnyLocale } from "@/i18n/locales-list";
import type { Earthquake } from "@/lib/earthquakes";
import type { OfficialIncident, OnmVigilance } from "@/lib/nadhir";
import {
  MAX_SHARE_CARD_BYTES,
  fireCardModel,
  onmCardModel,
  parseUniversalSharePath,
  quakeCardModel,
  universalIncidentCardModel,
  wilayaCardModel,
  type EligibleFireClusterInput,
  type ShareKind,
  type UniversalShareCardModel,
} from "@/lib/share-card";
import { closeLocalShareBrowser } from "@/lib/share-cdp.server";
import {
  handleUniversalShareRequest,
  renderUniversalShareCard,
} from "@/lib/share-render.server";
import { shareTranslator } from "@/lib/share-translator";
import type { WilayaSnapshot } from "@/lib/wilaya-data";
import { wilayaBySlug } from "@/lib/wilaya-slugs";

const ALL_KINDS: readonly ShareKind[] = [
  "onm",
  "fire",
  "quake",
  "wilaya",
  "incident",
];
const ALL_LOCALES: readonly AnyLocale[] = ["ar", "fr", "en", "kab"];

function isValidWebp(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 16 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

function isValidJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 16 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

function isValidPng(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function buildModel(kind: ShareKind, lang: AnyLocale): UniversalShareCardModel {
  const t = shareTranslator(lang);
  switch (kind) {
    case "onm": {
      const warning: OnmVigilance = {
        id: "onm-raster-1",
        cap_id: "2.49.0.1.12.0.20261125.099",
        title: "أمطار رعدية غزيرة وهبوب رياح قوية وتساقط ثلوج كثيفة",
        event: "Rain",
        severity: "Extreme",
        urgency: "Immediate",
        certainty: "Observed",
        onset: "2026-11-25T10:00:00Z",
        expires: "2026-11-26T10:00:00Z",
        sent: "2026-11-25T09:30:00Z",
        area_desc: "برج باجي مختار · عين قزام · أولاد جلال · عين الدفلى",
        cap_url: "https://meteo.dz/cap/99",
        wilaya_id: "w-50",
        headline_fr:
          "Pluies orageuses intenses et rafales sur Bordj Badji Mokhtar et In Guezzam",
        superseded_at: null,
        msg_type: "Alert",
        cap_references: null,
        superseded_by: null,
        cancelled_at: null,
      };
      const place = lang === "ar" ? "برج باجي مختار" : "Bordj Badji Mokhtar";
      return onmCardModel(warning, place, t, lang);
    }
    case "fire": {
      const cluster: EligibleFireClusterInput = {
        id: "fire-raster-1",
        short_id: "F-2026-777",
        state: "active",
        first_detected_at: "2026-11-25T08:00:00Z",
        last_detected_at: "2026-11-25T11:30:00Z",
        updated_at: "2026-11-25T11:32:00Z",
        lat: 36.7412,
        lon: 4.3718,
        detection_count: 7,
        sources: ["firms", "fci"],
        confirmed_at: null,
        resolved_at: null,
        suspected_persistent_source: false,
      };
      const place = lang === "ar" ? "عزازقة · تيزي وزو" : "Azazga · Tizi Ouzou";
      return fireCardModel(cluster, "probable", place, t, lang);
    }
    case "quake": {
      const quake: Earthquake & { updated_at?: string | null } = {
        id: "emsc-raster-1",
        occurred_at: "2026-11-25T11:10:00Z",
        updated_at: "2026-11-25T11:12:00Z",
        lat: 36.752,
        lon: 5.084,
        depth_km: 14,
        magnitude: 4.8,
        magnitude_type: "ML",
        region: "Béjaïa, Algeria",
        network: "CRAAG",
        commune_id: null,
        offshore: true,
      };
      const place = lang === "ar" ? "بجاية" : "Béjaïa";
      return quakeCardModel(quake, place, t, lang);
    }
    case "wilaya": {
      const entry = wilayaBySlug("bordj-badji-mokhtar")!;
      const snapshot: WilayaSnapshot = {
        wilaya: entry,
        dataStatus: "ok",
        fetchedAt: "2026-11-25T11:45:00Z",
        communes: [],
        onmWarnings: [],
        officialIncidents: [],
        probableFires: [],
        heatSignalCount: 0,
        earthquakes: [],
        fireDanger: null,
        airportWeather: [],
      };
      return wilayaCardModel(snapshot, t, lang);
    }
    case "incident": {
      const unit = (ar: string, fr: string) => ({
        name_ar: ar,
        name_fr: fr,
        name_en: fr,
        name_kab: fr,
        lat: 36.263,
        lon: 1.968,
      });
      const incident: OfficialIncident = {
        id: "0b5c1f2e-8f4a-4c55-9a51-3f1c2f0c9b10",
        wilaya_id: "w-44",
        commune_id: "c-4401",
        kind: "flood",
        status: "ongoing",
        precision: "commune",
        authority_tier: "national",
        place_text: "RN4",
        first_reported_at: "2026-11-25T09:00:00Z",
        last_reported_at: "2026-11-25T11:00:00Z",
        as_of: "2026-11-25T11:00:00Z",
        updated_at: "2026-11-25T11:05:00Z",
        unlisted_at: null,
        mention_count: 2,
        evidence: "Intervention DGPC",
        commune: unit("عين الدفلى", "Aïn Defla"),
        wilaya: unit("عين الدفلى", "Aïn Defla"),
        latest_mention: {
          document: {
            url: "https://t.me/dgpc/1",
            published_at: "2026-11-25T11:00:00Z",
          },
          source: { label: "Protection Civile" },
        },
      };
      return universalIncidentCardModel(incident, t, lang);
    }
  }
}

describe("real Chromium CDP universal share card rasterizer", () => {
  afterAll(async () => {
    await closeLocalShareBrowser();
  });

  it("renders all 5 kinds × 4 locales = 20 WhatsApp & 20 Facebook WebP cards strictly <= 37,888 bytes", async () => {
    for (const kind of ALL_KINDS) {
      for (const lang of ALL_LOCALES) {
        const model = buildModel(kind, lang);

        const wa = await renderUniversalShareCard(model, {
          format: "whatsapp",
          codec: "webp",
          maxBytes: MAX_SHARE_CARD_BYTES,
        });
        expect(wa, `${kind}/${lang} whatsapp.webp`).not.toBeNull();
        expect(isValidWebp(wa!), `${kind}/${lang} whatsapp magic`).toBe(true);
        expect(
          wa!.byteLength,
          `${kind}/${lang} whatsapp.webp bytes`,
        ).toBeLessThanOrEqual(MAX_SHARE_CARD_BYTES);
        expect(wa!.byteLength).toBeGreaterThan(1_000);

        const fb = await renderUniversalShareCard(model, {
          format: "facebook",
          codec: "webp",
          maxBytes: MAX_SHARE_CARD_BYTES,
        });
        expect(fb, `${kind}/${lang} facebook.webp`).not.toBeNull();
        expect(isValidWebp(fb!), `${kind}/${lang} facebook magic`).toBe(true);
        expect(
          fb!.byteLength,
          `${kind}/${lang} facebook.webp bytes`,
        ).toBeLessThanOrEqual(MAX_SHARE_CARD_BYTES);
        expect(fb!.byteLength).toBeGreaterThan(1_000);
      }
    }
  }, 60_000);

  it("enforces <= 37,888 bytes for worst-case Arabic ONM across JPEG, PNG (indexed), and transparent sticker PNG with real pixel contrast", async () => {
    const worstAr = buildModel("onm", "ar");

    const fbJpeg = await renderUniversalShareCard(worstAr, {
      format: "facebook",
      codec: "jpeg",
      maxBytes: MAX_SHARE_CARD_BYTES,
    });
    expect(fbJpeg).not.toBeNull();
    expect(isValidJpeg(fbJpeg!)).toBe(true);
    expect(fbJpeg!.byteLength).toBeLessThanOrEqual(MAX_SHARE_CARD_BYTES);

    const waPng = await renderUniversalShareCard(worstAr, {
      format: "whatsapp",
      codec: "png",
      maxBytes: MAX_SHARE_CARD_BYTES,
    });
    expect(waPng).not.toBeNull();
    expect(isValidPng(waPng!)).toBe(true);
    expect(waPng!.byteLength).toBeLessThanOrEqual(MAX_SHARE_CARD_BYTES);

    // Decode PNG and verify real non-blank contrasting graphics/text were rendered
    const decodedWa = PNG.sync.read(Buffer.from(waPng!));
    expect(decodedWa.width).toBeGreaterThan(0);
    expect(decodedWa.height).toBeGreaterThan(0);
    let minLuma = 255;
    let maxLuma = 0;
    const distinctColors = new Set<number>();
    for (let i = 0; i < decodedWa.data.length; i += 4) {
      const r = decodedWa.data[i]!;
      const g = decodedWa.data[i + 1]!;
      const b = decodedWa.data[i + 2]!;
      const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      if (luma < minLuma) minLuma = luma;
      if (luma > maxLuma) maxLuma = luma;
      distinctColors.add((r << 16) | (g << 8) | b);
    }
    expect(maxLuma - minLuma).toBeGreaterThan(180);
    expect(distinctColors.size).toBeGreaterThanOrEqual(6);

    const fbPng = await renderUniversalShareCard(worstAr, {
      format: "facebook",
      codec: "png",
      maxBytes: MAX_SHARE_CARD_BYTES,
    });
    expect(fbPng).not.toBeNull();
    expect(isValidPng(fbPng!)).toBe(true);
    expect(fbPng!.byteLength).toBeLessThanOrEqual(MAX_SHARE_CARD_BYTES);

    const stickerPng = await renderUniversalShareCard(worstAr, {
      format: "sticker",
      codec: "png",
      maxBytes: MAX_SHARE_CARD_BYTES,
    });
    expect(stickerPng).not.toBeNull();
    expect(isValidPng(stickerPng!)).toBe(true);
    expect(stickerPng!.byteLength).toBeLessThanOrEqual(MAX_SHARE_CARD_BYTES);
    const decodedSticker = PNG.sync.read(Buffer.from(stickerPng!));
    // Outer margin corner (0,0) is transparent on sticker
    expect(decodedSticker.data[3]).toBe(0);
  }, 45_000);

  it("serves offline wilaya share card end-to-end via handleUniversalShareRequest with HTTP 200 <= 37 KB", async () => {
    const url = new URL(
      "https://nadhir.app/api/public/share/wilaya/alger.whatsapp.webp?lang=ar",
    );
    const parsed = parseUniversalSharePath(url.pathname, url.searchParams);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const res = await handleUniversalShareRequest(
      new Request(url.href),
      parsed.target,
      { cache: null, limit: async () => null },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(isValidWebp(bytes)).toBe(true);
    expect(bytes.byteLength).toBeLessThanOrEqual(MAX_SHARE_CARD_BYTES);
  }, 30_000);
});
