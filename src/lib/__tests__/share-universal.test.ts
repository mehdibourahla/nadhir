import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";

import type { AnyLocale } from "@/i18n/locales-list";
import type { Earthquake } from "@/lib/earthquakes";
import type { FireContext } from "@/lib/fire-confidence";
import type { OfficialIncident, OnmVigilance } from "@/lib/nadhir";
import {
  MAX_SHARE_CARD_BYTES,
  extractRawPathname,
  fireCardModel,
  isEligibleEarthquake,
  isEligibleOfficialIncident,
  isEligibleOnmWarning,
  isEligibleProbableFire,
  onmCardModel,
  parseUniversalSharePath,
  quakeCardModel,
  shareCardLocale,
  universalIncidentCardModel,
  universalShareImagePath,
  wilayaCardModel,
  type EligibleFireClusterInput,
  type UniversalShareCardModel,
} from "@/lib/share-card";
import { renderUniversalShareCardHtml } from "@/lib/share-card-html";
import { quantizePngToIndexed } from "@/lib/share-png-quantize.server";
import {
  handleUniversalShareRequest,
  loadFireModel,
  loadUniversalShareModel,
} from "@/lib/share-render.server";
import { shareTranslator } from "@/lib/share-translator";
import { FIRE_KINDS } from "@/lib/text-sources/merge";
import type { WilayaSnapshot } from "@/lib/wilaya-data";
import { WILAYA_REGISTRY, wilayaBySlug } from "@/lib/wilaya-slugs";

const NOW_MS = Date.parse("2026-11-25T12:00:00Z");
const ALL_LOCALES: readonly AnyLocale[] = ["ar", "fr", "en", "kab"];

function makeOnm(over: Partial<OnmVigilance> = {}): OnmVigilance {
  return {
    id: "onm-uuid-1",
    cap_id: "2.49.0.1.12.0.20261125.001",
    title: "أمطار رعدية غزيرة وهبوب رياح قوية",
    event: "Rain",
    severity: "Extreme",
    urgency: "Immediate",
    certainty: "Observed",
    onset: "2026-11-25T10:00:00Z",
    expires: "2026-11-26T10:00:00Z",
    sent: "2026-11-25T09:30:00Z",
    area_desc: "برج باجي مختار · عين قزام · أولاد جلال · عين الدفلى",
    cap_url: "https://meteo.dz/cap/1",
    wilaya_id: "w-16",
    headline_fr: "Pluies orageuses intenses et vents forts",
    superseded_at: null,
    msg_type: "Alert",
    cap_references: null,
    superseded_by: null,
    cancelled_at: null,
    ...over,
  };
}

function makeFire(
  over: Partial<EligibleFireClusterInput> = {},
): EligibleFireClusterInput {
  return {
    id: "fire-uuid-1",
    short_id: "F-2026-042",
    state: "active",
    first_detected_at: "2026-11-25T09:00:00Z",
    last_detected_at: "2026-11-25T11:30:00Z",
    updated_at: "2026-11-25T11:35:00Z",
    lat: 36.7123,
    lon: 4.0512,
    detection_count: 5,
    sources: ["firms", "fci"],
    confirmed_at: null,
    resolved_at: null,
    suspected_persistent_source: false,
    ...over,
  };
}

function makeQuake(
  over: Partial<Earthquake & { updated_at?: string | null }> = {},
): Earthquake & { updated_at?: string | null } {
  return {
    id: "emsc-20261125-001",
    occurred_at: "2026-11-25T11:15:00Z",
    updated_at: "2026-11-25T11:18:00Z",
    lat: 36.752,
    lon: 5.084,
    depth_km: 12,
    magnitude: 4.8,
    magnitude_type: "ML",
    region: "Béjaïa, Northern Algeria",
    network: "CRAAG",
    commune_id: null,
    offshore: false,
    ...over,
  };
}

function makeIncident(over: Partial<OfficialIncident> = {}): OfficialIncident {
  const unit = (nameAr: string, nameFr: string) => ({
    name_ar: nameAr,
    name_fr: nameFr,
    name_en: nameFr,
    name_kab: nameFr,
    lat: 36.75,
    lon: 3.05,
  });
  return {
    id: "0b5c1f2e-8f4a-4c55-9a51-3f1c2f0c9b10",
    wilaya_id: "w-16",
    commune_id: "c-1601",
    kind: "flood",
    status: "ongoing",
    precision: "commune",
    authority_tier: "national",
    place_text: "Oued El Harrach",
    first_reported_at: "2026-11-25T09:00:00Z",
    last_reported_at: "2026-11-25T11:00:00Z",
    as_of: "2026-11-25T11:00:00Z",
    updated_at: "2026-11-25T11:05:00Z",
    unlisted_at: null,
    mention_count: 2,
    evidence: "DGPC flood intervention",
    commune: unit("الحراش", "El Harrach"),
    wilaya: unit("الجزائر", "Alger"),
    latest_mention: {
      document: {
        url: "https://t.me/dgpc/42",
        published_at: "2026-11-25T11:00:00Z",
      },
      source: { label: "Protection Civile (DGPC)" },
    },
    ...over,
  };
}

function makeWilayaSnapshot(
  slug = "alger",
  over: Partial<WilayaSnapshot> = {},
): WilayaSnapshot {
  const wilaya = wilayaBySlug(slug)!;
  return {
    wilaya,
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
    ...over,
  };
}

describe("parseUniversalSharePath & extractRawPathname", () => {
  it("parses M3B canonical wilaya URL and all 4 locales", () => {
    for (const lang of ALL_LOCALES) {
      const url = new URL(
        `https://nadhir.app/api/public/share/wilaya/alger.whatsapp.webp?lang=${lang}`,
      );
      const parsed = parseUniversalSharePath(
        extractRawPathname(url.href),
        url.searchParams,
      );
      expect(parsed).toEqual({
        ok: true,
        target: {
          kind: "wilaya",
          id: "alger",
          format: "whatsapp",
          codec: "webp",
          lang,
          v: null,
        },
      });
    }
  });

  it("parses dotted ONM CAP OIDs via right-to-left suffix parsing", () => {
    const parsed = parseUniversalSharePath(
      "/api/public/share/onm/2.49.0.1.12.0.20261125.whatsapp.webp",
      new URLSearchParams("lang=fr"),
    );
    expect(parsed).toEqual({
      ok: true,
      target: {
        kind: "onm",
        id: "2.49.0.1.12.0.20261125",
        format: "whatsapp",
        codec: "webp",
        lang: "fr",
        v: null,
      },
    });

    const noExt = parseUniversalSharePath(
      "/api/public/share/onm/2.49.0.1.12.0.20261125.facebook",
      new URLSearchParams("lang=kab"),
    );
    expect(noExt).toEqual({
      ok: true,
      target: {
        kind: "onm",
        id: "2.49.0.1.12.0.20261125",
        format: "facebook",
        codec: "webp",
        lang: "kab",
        v: null,
      },
    });
  });

  it("parses 3-segment slash URLs and preserves default codecs per format", () => {
    expect(
      parseUniversalSharePath(
        "/api/public/share/incident/abc-123/og",
        new URLSearchParams("lang=en&v=1.100"),
      ),
    ).toEqual({
      ok: true,
      target: {
        kind: "incident",
        id: "abc-123",
        format: "og",
        codec: "jpeg",
        lang: "en",
        v: "1.100",
      },
    });

    expect(
      parseUniversalSharePath(
        "/api/public/share/quake/emsc-1/facebook.jpg",
        new URLSearchParams("lang=ar"),
      ),
    ).toEqual({
      ok: true,
      target: {
        kind: "quake",
        id: "emsc-1",
        format: "facebook",
        codec: "jpeg",
        lang: "ar",
        v: null,
      },
    });

    expect(
      parseUniversalSharePath(
        "/api/public/share/fire/F-42/whatsapp.png",
        new URLSearchParams(""),
      ),
    ).toEqual({
      ok: true,
      target: {
        kind: "fire",
        id: "F-42",
        format: "whatsapp",
        codec: "png",
        lang: "ar",
        v: null,
      },
    });
  });

  it("rejects unknown kinds and path traversal / smuggling with HTTP 404", () => {
    const cases = [
      "/api/public/share/",
      "/api/public/share/unknown/alger.whatsapp.webp",
      "/api/public/share/ONM/123.whatsapp.webp",
      "/api/public/share/citizen/123.whatsapp.webp",
      "/api/public/share/wilaya/%2e%2e/alger.whatsapp.webp",
      "/api/public/share/wilaya/a/../alger.whatsapp.webp",
      "/api/public/share/wilaya/alger%2fbad.whatsapp.webp",
      "/api/public/share/wilaya/alger%5cbad.whatsapp.webp",
      "/api/public/share/wilaya/alger%00.whatsapp.webp",
      "/api/public/share/wilaya/.whatsapp.webp",
      `/api/public/share/wilaya/${"a".repeat(201)}.whatsapp.webp`,
      "/api/public/share/wilaya/alger/whatsapp/extra",
    ];
    for (const raw of cases) {
      const result = parseUniversalSharePath(raw, new URLSearchParams());
      expect(result.ok, raw).toBe(false);
      if (!result.ok) {
        expect(result.status, raw).toBe(404);
      }
    }
  });

  it("rejects invalid formats and unknown extensions with HTTP 400", () => {
    const cases = [
      "/api/public/share/wilaya/alger",
      "/api/public/share/wilaya/alger.webp",
      "/api/public/share/wilaya/alger.gif",
      "/api/public/share/wilaya/alger.whatsapp.svg",
      "/api/public/share/wilaya/alger.bogus.webp",
      "/api/public/share/incident/abc/gif",
      "/api/public/share/incident/abc/whatsapp.gif",
      "/api/public/share/incident/abc/whatsapp.webp.extra",
    ];
    for (const raw of cases) {
      const result = parseUniversalSharePath(raw, new URLSearchParams());
      expect(result.ok, raw).toBe(false);
      if (!result.ok) {
        expect(result.status, raw).toBe(400);
      }
    }
  });

  it("resolves ?lang=ar|fr|en|kab cleanly via shareCardLocale and builds canonical paths", () => {
    expect(shareCardLocale("ar")).toBe("ar");
    expect(shareCardLocale("FR")).toBe("fr");
    expect(shareCardLocale(" en ")).toBe("en");
    expect(shareCardLocale("kab")).toBe("kab");
    expect(shareCardLocale("es")).toBe("ar");
    expect(shareCardLocale(null)).toBe("ar");
    expect(universalShareImagePath("wilaya", "alger", "whatsapp", "kab")).toBe(
      "/api/public/share/wilaya/alger.whatsapp.webp?lang=kab",
    );
  });
});

describe("ADR-0002 strict eligibility & 5-entity models", () => {
  it("enforces ONM active-only eligibility and preserves verbatim ONM attribution + localized severity", () => {
    const active = makeOnm();
    expect(isEligibleOnmWarning(active, NOW_MS)).toBe(true);
    expect(
      isEligibleOnmWarning(
        makeOnm({ superseded_at: "2026-11-25T10:00:00Z" }),
        NOW_MS,
      ),
    ).toBe(false);
    expect(
      isEligibleOnmWarning(
        makeOnm({ cancelled_at: "2026-11-25T10:00:00Z" }),
        NOW_MS,
      ),
    ).toBe(false);
    expect(
      isEligibleOnmWarning(makeOnm({ superseded_by: "other" }), NOW_MS),
    ).toBe(false);
    expect(isEligibleOnmWarning(makeOnm({ msg_type: "Cancel" }), NOW_MS)).toBe(
      false,
    );
    expect(isEligibleOnmWarning(makeOnm({ msg_type: "cancel" }), NOW_MS)).toBe(
      false,
    );
    expect(
      isEligibleOnmWarning(
        makeOnm({ expires: "2026-11-25T11:59:59Z" }),
        NOW_MS,
      ),
    ).toBe(false);
    expect(
      isEligibleOnmWarning(makeOnm({ expires: "not-a-date" }), NOW_MS),
    ).toBe(false);
    expect(isEligibleOnmWarning(makeOnm({ sent: "bad" }), NOW_MS)).toBe(false);

    for (const lang of ALL_LOCALES) {
      const model = onmCardModel(
        active,
        "الجزائر",
        shareTranslator(lang),
        lang,
      );
      expect(model.eyebrow).toBe("ONM · Météo Algérie");
      expect(model.eyebrowLtr).toBe(true);
      if (lang !== "en") {
        expect(model.badge).not.toMatch(/\bExtreme\b/);
        expect(model.badge).not.toMatch(/\bSevere\b/);
      }
      expect(model.footer).toBe("nadhir.app");
    }
  });

  it("enforces Probable Fire eligibility: rejects heat_signal, candidate, extinguished, false_positive, persistent, resolved, and media-confirmed", () => {
    const forestCtx: FireContext = {
      forestFraction: 0.45,
      dangerLevel: 3,
      nearbySighting: false,
      officialMention: false,
    };
    const emptyCtx: FireContext = {
      forestFraction: 0.01,
      dangerLevel: 2,
      nearbySighting: false,
      officialMention: false,
    };

    // Probable fire passes with "probable" (NEVER "confirmed")
    expect(isEligibleProbableFire(makeFire(), forestCtx, null)).toBe(
      "probable",
    );

    // Heat signal (no context) -> rejected
    expect(isEligibleProbableFire(makeFire(), emptyCtx, null)).toBeNull();

    // Candidate (`state: "unconfirmed"`) -> rejected even with forest context
    expect(
      isEligibleProbableFire(
        makeFire({ state: "unconfirmed" }),
        forestCtx,
        null,
      ),
    ).toBeNull();

    // Extinguished / false_positive / resolved_at -> rejected
    expect(
      isEligibleProbableFire(
        makeFire({ state: "extinguished" }),
        forestCtx,
        null,
      ),
    ).toBeNull();
    expect(
      isEligibleProbableFire(
        makeFire({ state: "false_positive" }),
        forestCtx,
        null,
      ),
    ).toBeNull();
    expect(
      isEligibleProbableFire(
        makeFire({ resolved_at: "2026-11-25T11:40:00Z" }),
        forestCtx,
        null,
      ),
    ).toBeNull();

    // Suspected persistent industrial source -> rejected unless non-media official confirmation
    expect(
      isEligibleProbableFire(
        makeFire({ suspected_persistent_source: true }),
        forestCtx,
        null,
      ),
    ).toBeNull();

    // Media/ITA mention NEVER grants "confirmed"
    expect(
      isEligibleProbableFire(
        makeFire({ confirmed_at: "2026-11-25T11:00:00Z" }),
        emptyCtx,
        "media",
      ),
    ).toBeNull();
    expect(
      isEligibleProbableFire(
        makeFire({ confirmed_at: "2026-11-25T11:00:00Z" }),
        forestCtx,
        "media",
      ),
    ).toBe("probable");

    // Empty or unparseable confirmed_at NEVER grants "confirmed"
    expect(
      isEligibleProbableFire(makeFire({ confirmed_at: "" }), emptyCtx, null),
    ).toBeNull();
    expect(
      isEligibleProbableFire(
        makeFire({ confirmed_at: "   " }),
        emptyCtx,
        "national",
      ),
    ).toBeNull();
    expect(
      isEligibleProbableFire(
        makeFire({ confirmed_at: "not-a-date" }),
        emptyCtx,
        "national",
      ),
    ).toBeNull();
    expect(
      isEligibleProbableFire(
        makeFire({ confirmed_at: "" }),
        forestCtx,
        "national",
      ),
    ).toBe("probable");

    // Non-official authority tiers ("citizen", "unknown", "") NEVER grant "confirmed"
    for (const badTier of ["citizen", "unknown", ""]) {
      expect(
        isEligibleProbableFire(
          makeFire({ confirmed_at: "2026-11-25T11:00:00Z" }),
          emptyCtx,
          badTier,
        ),
      ).toBeNull();
      expect(
        isEligibleProbableFire(
          makeFire({ confirmed_at: "2026-11-25T11:00:00Z" }),
          forestCtx,
          badTier,
        ),
      ).toBe("probable");
    }

    // Official national authority DOES grant "confirmed"
    expect(
      isEligibleProbableFire(
        makeFire({ confirmed_at: "2026-11-25T11:00:00Z" }),
        emptyCtx,
        "national",
      ),
    ).toBe("confirmed");
    expect(
      isEligibleProbableFire(
        makeFire({ confirmed_at: "2026-11-25T11:00:00Z" }),
        emptyCtx,
        "forestry",
      ),
    ).toBe("confirmed");

    // Probable fire card badge NEVER says "confirmed"
    for (const lang of ALL_LOCALES) {
      const model = fireCardModel(
        makeFire(),
        "probable",
        "Azazga",
        shareTranslator(lang),
        lang,
      );
      expect(model.badge.toLowerCase()).not.toContain("confirmed");
      expect(model.badge.toLowerCase()).not.toContain("confirmé");
      expect(model.badge).not.toContain("مؤكّد");
      expect(model.eyebrow).toContain("NASA FIRMS");
      expect(model.eyebrow).toContain("EUMETSAT MTG FCI");
      expect(model.coordsLtr).toBe("36.7123°N, 4.0512°E");
    }
  });

  it("enforces Earthquake eligibility and preserves CRAAG/EMSC attribution without 0-for-missing depth", () => {
    expect(isEligibleEarthquake(makeQuake())).toBe(true);
    expect(isEligibleEarthquake(makeQuake({ magnitude: 0 }))).toBe(false);
    expect(isEligibleEarthquake(makeQuake({ magnitude: Number.NaN }))).toBe(
      false,
    );
    expect(isEligibleEarthquake(makeQuake({ lat: Number.NaN }))).toBe(false);
    expect(isEligibleEarthquake(makeQuake({ occurred_at: "bad" }))).toBe(false);

    const modelNoDepth = quakeCardModel(
      makeQuake({ depth_km: null, offshore: true, network: "CRAAG" }),
      "Béjaïa",
      shareTranslator("en"),
      "en",
    );
    expect(modelNoDepth.eyebrow).toBe("CRAAG");
    expect(modelNoDepth.badge).toBe("M4.8");
    expect(modelNoDepth.metaLine).not.toContain("0 km");
    expect(modelNoDepth.metaLine).toContain("Offshore");

    // Empty placeLabel + empty region must NOT duplicate localized "Earthquake" in subtitle
    const modelNoPlace = quakeCardModel(
      makeQuake({ region: "" }),
      null,
      shareTranslator("en"),
      "en",
    );
    expect(modelNoPlace.title).toBe("Earthquake");
    expect(modelNoPlace.subtitle).toBe("");
  });

  it("enforces Official Incident eligibility (rejects authority_tier=media)", () => {
    expect(isEligibleOfficialIncident(makeIncident())).toBe(true);
    expect(
      isEligibleOfficialIncident(makeIncident({ authority_tier: "media" })),
    ).toBe(false);
    expect(isEligibleOfficialIncident(makeIncident({ as_of: "invalid" }))).toBe(
      false,
    );
  });

  it("supports ALL 69 wilayas offline with honest empty/unavailable state (never 'Safe') and handles Aflou kab fallback", async () => {
    expect(WILAYA_REGISTRY).toHaveLength(69);
    for (const entry of WILAYA_REGISTRY) {
      const snap = makeWilayaSnapshot(entry.slug, {
        dataStatus: "unavailable",
      });
      const model = wilayaCardModel(snap, shareTranslator("en"), "en");
      expect(model.id).toBe(entry.slug);
      expect(model.badge.toLowerCase()).not.toContain("safe");
      expect(model.subtitle.toLowerCase()).not.toContain("safe");
      expect(model.coordsLtr).toMatch(/°N, .*°[EW]/);
    }

    // Active ONM on wilaya leads with verbatim "ONM · Météo Algérie"
    const activeSnap = makeWilayaSnapshot("alger", {
      onmWarnings: [makeOnm()],
    });
    const activeModel = wilayaCardModel(
      activeSnap,
      shareTranslator("ar"),
      "ar",
    );
    expect(activeModel.eyebrow).toBe("ONM · Météo Algérie");

    // Wilaya 59 (aflou) in kab includes readable (Aflou) alongside Tifinagh
    const aflouKab = wilayaCardModel(
      makeWilayaSnapshot("aflou"),
      shareTranslator("kab"),
      "kab",
    );
    expect(aflouKab.title).toContain("Aflou");

    // Unknown wilaya slug -> null (404)
    expect(
      await loadUniversalShareModel("wilaya", "unknown-99", "ar", NOW_MS),
    ).toBeNull();

    // 2-digit code lookup works too
    const byCode = await loadUniversalShareModel("wilaya", "16", "fr", NOW_MS);
    expect(byCode?.id).toBe("alger");
  });
});

describe("renderUniversalShareCardHtml (security, RTL, ADR-0002, zero em dash)", () => {
  it("escapes XSS payloads, emits zero external URLs/scripts, and strips em dashes", () => {
    const model = onmCardModel(
      makeOnm({
        title: '<script>alert("xss")</script> — "quote" & <img onerror=1>',
        headline_fr: "<script>alert(1)</script> — Orages",
        area_desc: "<b>Alger</b> — Tipaza",
      }),
      'Wilaya <svg onload="x">',
      shareTranslator("ar"),
      "ar",
    );
    const html = renderUniversalShareCardHtml(model, "whatsapp");

    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).not.toContain("https://");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("\u2014");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("ONM · Météo Algérie");
    expect(html).toContain("nadhir.app");

    // Never wrap Arabic text inside <bdi dir="ltr">
    const ltrBdis = [
      ...html.matchAll(/<bdi\b[^>]*dir="ltr"[^>]*>([\s\S]*?)<\/bdi>/g),
    ].map((m) => m[1]!);
    expect(ltrBdis.length).toBeGreaterThanOrEqual(2);
    for (const content of ltrBdis) {
      expect(content).not.toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("sets dir=ltr for fr, en, kab and never renders 'safe' as a status label", () => {
    const emptySnap = makeWilayaSnapshot("alger", { dataStatus: "ok" });
    for (const lang of ALL_LOCALES) {
      const model = wilayaCardModel(emptySnap, shareTranslator(lang), lang);
      const html = renderUniversalShareCardHtml(model, "facebook");
      expect(html).toContain(`dir="${lang === "ar" ? "rtl" : "ltr"}"`);
      expect(html).not.toContain("\u2014");
      expect(html).not.toMatch(/\bSafe\b/);
      expect(html).not.toMatch(/\bSûr\b/);
      expect(html).not.toContain("آمن");
    }
  });
});

describe("quantizePngToIndexed", () => {
  it("quantizes opaque and transparent RGBA PNGs cleanly and preserves dimensions and alpha", () => {
    const src = new PNG({ width: 120, height: 60 });
    for (let y = 0; y < src.height; y += 1) {
      for (let x = 0; x < src.width; x += 1) {
        const idx = (y * src.width + x) * 4;
        const corner = x < 10 && y < 10;
        src.data[idx] = corner ? 0 : (x * 2) % 255;
        src.data[idx + 1] = corner ? 0 : (y * 4) % 255;
        src.data[idx + 2] = corner ? 0 : 120;
        src.data[idx + 3] = corner ? 0 : 255;
      }
    }
    const raw = PNG.sync.write(src);
    const quantized = quantizePngToIndexed(raw, 16);

    // Valid PNG magic bytes
    expect([...quantized.slice(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);

    const decoded = PNG.sync.read(Buffer.from(quantized));
    expect(decoded.width).toBe(120);
    expect(decoded.height).toBe(60);
    // Transparent corner preserved via tRNS chunk
    expect(decoded.data[3]).toBe(0);
    // Opaque center pixel stays opaque
    const centerOff = (30 * 120 + 60) * 4;
    expect(decoded.data[centerOff + 3]).toBe(255);
  });
});

describe("handleUniversalShareRequest (GET, HEAD, cache, rate-limit, errors)", () => {
  const sampleModel: UniversalShareCardModel = universalIncidentCardModel(
    makeIncident(),
    shareTranslator("fr"),
    "fr",
  );
  const parsedTarget = {
    kind: "incident" as const,
    id: sampleModel.id,
    format: "whatsapp" as const,
    codec: "webp" as const,
    lang: "fr" as const,
    v: sampleModel.version,
  };

  it("renders once, caches, supports HEAD with empty body, and checks rate limit only on miss", async () => {
    const store = new Map<string, Response>();
    const cache = {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => {
        store.set(req.url, res);
      },
    };
    const render = vi.fn(async () => new Uint8Array([0x52, 0x49, 0x46, 0x46]));
    const limit = vi.fn(async () => null);

    const req = new Request(
      `https://nadhir.app/api/public/share/incident/${sampleModel.id}.whatsapp.webp?lang=fr&v=${sampleModel.version}`,
    );
    const res1 = await handleUniversalShareRequest(req, parsedTarget, {
      loadModel: async () => sampleModel,
      render,
      cache,
      limit,
    });
    expect(res1.status).toBe(200);
    expect(res1.headers.get("content-type")).toBe("image/webp");
    expect(res1.headers.get("cache-control")).toContain("immutable");
    expect(res1.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res1.headers.get("access-control-allow-origin")).toBe("*");
    expect(res1.headers.get("content-length")).toBe("4");
    expect((await res1.arrayBuffer()).byteLength).toBe(4);
    expect(render).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledTimes(1);

    const headReq = new Request(req.url, { method: "HEAD" });
    const resHead = await handleUniversalShareRequest(headReq, parsedTarget, {
      loadModel: async () => sampleModel,
      render,
      cache,
      limit,
    });
    expect(resHead.status).toBe(200);
    expect(resHead.headers.get("content-type")).toBe("image/webp");
    expect((await resHead.arrayBuffer()).byteLength).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when model is null, 501 when renderer returns null, and 503 on render throw", async () => {
    const req = new Request(
      "https://nadhir.app/api/public/share/fire/F-1.whatsapp.webp?lang=ar",
    );
    const res404 = await handleUniversalShareRequest(req, parsedTarget, {
      loadModel: async () => null,
      render: async () => new Uint8Array([1]),
      cache: null,
      limit: async () => null,
    });
    expect(res404.status).toBe(404);

    const res501 = await handleUniversalShareRequest(req, parsedTarget, {
      loadModel: async () => sampleModel,
      render: async () => null,
      cache: null,
      limit: async () => null,
    });
    expect(res501.status).toBe(501);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const res503 = await handleUniversalShareRequest(req, parsedTarget, {
      loadModel: async () => sampleModel,
      render: async () => {
        throw new Error("boom");
      },
      cache: null,
      limit: async () => null,
    });
    expect(res503.status).toBe(503);
    expect(res503.headers.get("retry-after")).toBe("30");
    expect(MAX_SHARE_CARD_BYTES).toBe(37_888);
  });

  it("returns HTTP 503 with retry-after, no-store, CORS, nosniff and skips cache when loadModel throws", async () => {
    const put = vi.fn(async () => {});
    const match = vi.fn(async () => undefined);
    const render = vi.fn(async () => new Uint8Array([1]));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const req = new Request(
      `https://nadhir.app/api/public/share/incident/${sampleModel.id}.whatsapp.webp?lang=fr`,
    );
    const res = await handleUniversalShareRequest(req, parsedTarget, {
      loadModel: async () => {
        throw new Error("postgrest connection refused");
      },
      render,
      cache: { match, put },
      limit: async () => null,
    });

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(match).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});

type MockRow = Record<string, unknown>;
type RecordedQuery = {
  table: string;
  select: string | null;
  filters: { op: string; col: string; val: unknown }[];
};

function createMockFireSupabase(fixtures: {
  fire_clusters?: MockRow[];
  official_incidents?: MockRow[];
  incident_mentions?: MockRow[];
  mentionError?: { message: string } | null;
  admin_units?: MockRow[];
  hazard_reports?: MockRow[];
}) {
  const queries: RecordedQuery[] = [];
  const tables: Record<string, MockRow[]> = {
    fire_clusters: fixtures.fire_clusters ?? [],
    official_incidents: fixtures.official_incidents ?? [],
    incident_mentions: fixtures.incident_mentions ?? [],
    admin_units: fixtures.admin_units ?? [],
    hazard_reports: fixtures.hazard_reports ?? [],
    risk_publication_checkpoint: [],
  };

  const makeBuilder = (table: string) => {
    const record: RecordedQuery = { table, select: null, filters: [] };
    queries.push(record);
    let maxRows: number | null = null;

    const evaluate = () => {
      if (table === "incident_mentions" && fixtures.mentionError) {
        return { data: null, error: fixtures.mentionError };
      }
      let rows = [...(tables[table] ?? [])];
      for (const f of record.filters) {
        rows = rows.filter((row) => {
          const v = row[f.col];
          switch (f.op) {
            case "eq":
              return v === f.val;
            case "neq":
              return v !== f.val;
            case "is":
              return v === f.val;
            case "in":
              return Array.isArray(f.val) && f.val.includes(v);
            case "gte":
              return typeof v === "string" && typeof f.val === "string"
                ? v >= f.val
                : Number(v) >= Number(f.val);
            case "lte":
              return typeof v === "string" && typeof f.val === "string"
                ? v <= f.val
                : Number(v) <= Number(f.val);
            default:
              return true;
          }
        });
      }
      if (maxRows !== null) rows = rows.slice(0, maxRows);
      return { data: rows, error: null };
    };

    const builder = {
      select(cols: string) {
        record.select = cols;
        return builder;
      },
      eq(col: string, val: unknown) {
        record.filters.push({ op: "eq", col, val });
        return builder;
      },
      neq(col: string, val: unknown) {
        record.filters.push({ op: "neq", col, val });
        return builder;
      },
      is(col: string, val: unknown) {
        record.filters.push({ op: "is", col, val });
        return builder;
      },
      in(col: string, val: unknown) {
        record.filters.push({ op: "in", col, val });
        return builder;
      },
      gte(col: string, val: unknown) {
        record.filters.push({ op: "gte", col, val });
        return builder;
      },
      lte(col: string, val: unknown) {
        record.filters.push({ op: "lte", col, val });
        return builder;
      },
      limit(n: number) {
        maxRows = n;
        return builder;
      },
      maybeSingle() {
        const res = evaluate();
        if (res.error) return Promise.resolve({ data: null, error: res.error });
        const rows = res.data as MockRow[];
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: { data: MockRow[] | null; error: unknown }) => TResult1)
          | null,
        onrejected?: ((reason: unknown) => TResult2) | null,
      ) {
        return Promise.resolve(evaluate()).then(onfulfilled, onrejected);
      },
    };
    return builder;
  };

  return {
    queries,
    client: {
      from: (table: string) => makeBuilder(table),
      rpc: () => makeBuilder("risk_forecasts"),
    } as unknown as Parameters<typeof loadFireModel>[3],
  };
}

describe("loadFireModel (ADR-0002 corroboration, multi-cluster ambiguity, mention guards)", () => {
  const wilayaUnit = {
    id: "w-15",
    level: "wilaya",
    code: "15",
    name_ar: "تيزي وزو",
    name_fr: "Tizi Ouzou",
    name_en: "Tizi Ouzou",
    name_kab: "Tizi Wezzu",
    parent_id: null,
    forest_fraction: 0.02,
  };
  const lowForestCommune = {
    id: "c-1501",
    level: "commune",
    code: "1501",
    name_ar: "عزازقة",
    name_fr: "Azazga",
    name_en: "Azazga",
    name_kab: "Iɛeẓẓugen",
    parent_id: "w-15",
    forest_fraction: 0.02,
  };

  const baseClusterRow = (over: MockRow = {}): MockRow => ({
    ...makeFire({
      id: "fire-heat-1",
      short_id: "F-HEAT-1",
      state: "active",
      confirmed_at: null,
      last_detected_at: "2026-11-25T10:30:00Z",
    }),
    commune_id: "c-1501",
    wilaya_id: "w-15",
    confirmed_mention_id: null,
    ...over,
  });

  it("does NOT promote a satellite heat_signal on wilaya-level DGPC flood/storm/road or commune-level incidents", async () => {
    const mock = createMockFireSupabase({
      fire_clusters: [baseClusterRow()],
      admin_units: [wilayaUnit, lowForestCommune],
      official_incidents: [
        {
          wilaya_id: "w-15",
          commune_id: null,
          kind: "flood",
          authority_tier: "national",
          first_reported_at: "2026-11-25T10:00:00Z",
        },
        {
          wilaya_id: "w-15",
          commune_id: null,
          kind: "storm",
          authority_tier: "national",
          first_reported_at: "2026-11-25T10:05:00Z",
        },
        {
          wilaya_id: "w-15",
          commune_id: null,
          kind: "road",
          authority_tier: "national",
          first_reported_at: "2026-11-25T10:10:00Z",
        },
        {
          wilaya_id: "w-15",
          commune_id: "c-1501",
          kind: "vegetation",
          authority_tier: "national",
          first_reported_at: "2026-11-25T10:15:00Z",
        },
      ],
    });

    const model = await loadFireModel("F-HEAT-1", "en", NOW_MS, mock.client);
    expect(model).toBeNull();

    const incQuery = mock.queries.find((q) => q.table === "official_incidents");
    expect(incQuery).toBeDefined();
    expect(incQuery?.filters).toContainEqual({
      op: "in",
      col: "kind",
      val: [...FIRE_KINDS],
    });
    expect(incQuery?.filters).toContainEqual({
      op: "is",
      col: "commune_id",
      val: null,
    });
    expect(incQuery?.filters).toContainEqual({
      op: "neq",
      col: "authority_tier",
      val: "media",
    });
  });

  it("rejects BOTH heat signals when 2 active clusters share a wilaya with 1 wilaya-level fire incident", async () => {
    const f1 = baseClusterRow({
      id: "fire-heat-1",
      short_id: "F-HEAT-1",
      last_detected_at: "2026-11-25T10:30:00Z",
    });
    const f2 = baseClusterRow({
      id: "fire-heat-2",
      short_id: "F-HEAT-2",
      last_detected_at: "2026-11-25T10:45:00Z",
    });
    const fireIncident = {
      wilaya_id: "w-15",
      commune_id: null,
      kind: "vegetation",
      authority_tier: "national",
      first_reported_at: "2026-11-25T10:00:00Z",
    };

    const mock1 = createMockFireSupabase({
      fire_clusters: [f1, f2],
      admin_units: [wilayaUnit, lowForestCommune],
      official_incidents: [fireIncident],
    });
    const mock2 = createMockFireSupabase({
      fire_clusters: [f1, f2],
      admin_units: [wilayaUnit, lowForestCommune],
      official_incidents: [fireIncident],
    });

    expect(
      await loadFireModel("F-HEAT-1", "en", NOW_MS, mock1.client),
    ).toBeNull();
    expect(
      await loadFireModel("F-HEAT-2", "en", NOW_MS, mock2.client),
    ).toBeNull();
  });

  it("promotes 1 unique active cluster in a wilaya with 1 wilaya-level fire incident to 'probable' (NEVER 'confirmed')", async () => {
    const mock = createMockFireSupabase({
      fire_clusters: [baseClusterRow()],
      admin_units: [wilayaUnit, lowForestCommune],
      official_incidents: [
        {
          wilaya_id: "w-15",
          commune_id: null,
          kind: "vegetation",
          authority_tier: "national",
          first_reported_at: "2026-11-25T10:00:00Z",
        },
      ],
    });

    const model = await loadFireModel("F-HEAT-1", "en", NOW_MS, mock.client);
    expect(model).not.toBeNull();
    expect(model?.badge).toBe("Probable fire");
    expect(model?.badge.toLowerCase()).not.toContain("confirmed");
    expect(model?.eyebrow).not.toContain("DGPC");
  });

  it("fails closed when confirmed_mention_id lookup errors, is missing, or has a non-official tier", async () => {
    const confirmedRow = baseClusterRow({
      confirmed_at: "2026-11-25T10:20:00Z",
      confirmed_mention_id: "mention-1",
    });

    const mockError = createMockFireSupabase({
      fire_clusters: [confirmedRow],
      admin_units: [wilayaUnit, lowForestCommune],
      mentionError: { message: "db error" },
    });
    expect(
      await loadFireModel("F-HEAT-1", "en", NOW_MS, mockError.client),
    ).toBeNull();

    const mockMissing = createMockFireSupabase({
      fire_clusters: [confirmedRow],
      admin_units: [wilayaUnit, lowForestCommune],
      incident_mentions: [],
    });
    expect(
      await loadFireModel("F-HEAT-1", "en", NOW_MS, mockMissing.client),
    ).toBeNull();

    const mockCitizen = createMockFireSupabase({
      fire_clusters: [confirmedRow],
      admin_units: [wilayaUnit, lowForestCommune],
      incident_mentions: [
        {
          id: "mention-1",
          source: { authority_tier: "citizen", label: "Community Report" },
        },
      ],
    });
    expect(
      await loadFireModel("F-HEAT-1", "en", NOW_MS, mockCitizen.client),
    ).toBeNull();
  });

  it("uses official confirming source label (e.g. 'DGF') in eyebrow instead of hardcoded 'DGPC'", async () => {
    const confirmedRow = baseClusterRow({
      confirmed_at: "2026-11-25T10:20:00Z",
      confirmed_mention_id: "mention-dgf",
    });
    const mockDgf = createMockFireSupabase({
      fire_clusters: [confirmedRow],
      admin_units: [wilayaUnit, lowForestCommune],
      incident_mentions: [
        {
          id: "mention-dgf",
          source: { authority_tier: "forestry", label: "DGF" },
        },
      ],
    });

    const model = await loadFireModel("F-HEAT-1", "en", NOW_MS, mockDgf.client);
    expect(model).not.toBeNull();
    expect(model?.eyebrow).toContain("DGF");
    expect(model?.eyebrow).not.toContain("DGPC");
    expect(model?.eyebrowLtr).toBe(true);
  });
});
