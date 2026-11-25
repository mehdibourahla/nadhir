import { describe, expect, it } from "vitest";

import {
  importRepoModule,
  listRepoFiles,
  readRepoFile,
  repoFileExists,
} from "../lib/env.ts";
import { loadAlgeriaAdmin, loadLoi2606 } from "../lib/fixtures.ts";
import { fetchJson } from "../lib/http.ts";
import { psqlJson } from "../lib/pg.ts";
import { findBannedSafeLabels, findEmDashesInText } from "../lib/playwright.ts";

type TranslationNode = string | { [key: string]: TranslationNode };
type TranslationTree = { [key: string]: TranslationNode };

function flattenTree(
  tree: TranslationTree,
  prefix = "",
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(tree)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      entries.push([fullKey, value]);
    } else if (value && typeof value === "object") {
      entries.push(...flattenTree(value, fullKey));
    }
  }
  return entries;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripTsComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function extractPlaceholders(value: string): string[] {
  return Array.from(value.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g))
    .map((m) => m[1] ?? "")
    .sort();
}

describe("Tier 1 — F1: Clean Branch Sync & Strict Personal/ADR Boundaries", () => {
  it("F1.1: contains zero Paraito, paraito-hub, or carte-hub references across src/, worker/, docs/, and supabase/migrations/", () => {
    const dirs = ["src", "worker", "docs", "supabase/migrations"];
    const forbiddenPatterns: Array<{ label: string; regex: RegExp }> = [
      { label: "paraito", regex: /\bparaito\b/i },
      { label: "paraito-hub", regex: /paraito[-_]?hub/i },
      { label: "carte-hub-tool", regex: /\bcarte[-_](?:hub|card|ledger)\b/i },
      { label: "mcp-paraito", regex: /mcp__paraito/i },
    ];

    const violations: string[] = [];
    for (const dir of dirs) {
      const files = listRepoFiles(dir);
      for (const relPath of files) {
        if (!/\.(ts|tsx|js|mjs|cjs|sql|md|json|yml|yaml)$/i.test(relPath)) {
          continue;
        }
        const content = readRepoFile(relPath);
        for (const { label, regex } of forbiddenPatterns) {
          if (regex.test(content)) {
            violations.push(`${relPath}: matched forbidden "${label}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("F1.2: package.json default dev/test/lint/build scripts never invoke live production deployment or live DB mutation commands", () => {
    const pkgRaw = readRepoFile("package.json");
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const safeLifecycleScripts = [
      "dev",
      "test",
      "lint",
      "build",
      "build:native",
      "typecheck",
    ];
    const dangerousPatterns = [
      /\bwrangler\s+deploy\b/i,
      /\bsupabase\s+db\s+push\b/i,
      /\bsupabase\s+functions\s+deploy\b/i,
      /\bfastlane\s+(?:deploy|release|supply)\b/i,
    ];

    const violations: string[] = [];
    for (const name of safeLifecycleScripts) {
      const cmd = scripts[name];
      if (!cmd) continue;
      for (const pattern of dangerousPatterns) {
        if (pattern.test(cmd)) {
          violations.push(`package.json scripts.${name} runs "${cmd}"`);
        }
      }
    }

    expect(Object.keys(scripts).length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it("F1.3: data/geo/algeria-admin.json contains all 69 wilayas (01..69) and data/geo/loi-26-06.json records 69 wilayas", () => {
    const admin = loadAlgeriaAdmin();
    const loi = loadLoi2606();

    expect(admin.wilayas).toHaveLength(69);
    expect(loi.total_wilayas).toBe(69);

    const codes = admin.wilayas.map((w) => w.code).sort();
    const expectedCodes = Array.from({ length: 69 }, (_, i) =>
      String(i + 1).padStart(2, "0"),
    );
    expect(codes).toEqual(expectedCodes);

    for (const w of admin.wilayas) {
      expect(w.name_ar.trim().length).toBeGreaterThan(0);
      expect(w.name_fr.trim().length).toBeGreaterThan(0);
      expect(Number.isFinite(w.lat)).toBe(true);
      expect(Number.isFinite(w.lon)).toBe(true);
    }
    expect(admin.communes.length).toBeGreaterThanOrEqual(1500);
  });

  it("F1.4: ADR-0001 enforces zero PostGIS extension or geography/geometry columns in supabase/migrations/", () => {
    const migrations = listRepoFiles("supabase/migrations", ".sql");
    expect(migrations.length).toBeGreaterThan(0);

    const postgisViolations: string[] = [];
    const postgisExtensionRe = /\bcreate\s+extension\b[^;]*\bpostgis\b/i;
    const postgisColumnRe =
      /\b(?:public\.|extensions\.)?(?:geography|geometry)\s*\(/i;

    for (const relPath of migrations) {
      const cleaned = stripSqlComments(readRepoFile(relPath));
      if (postgisExtensionRe.test(cleaned)) {
        postgisViolations.push(`${relPath}: creates PostGIS extension`);
      }
      if (postgisColumnRe.test(cleaned)) {
        postgisViolations.push(
          `${relPath}: declares PostGIS geography/geometry column`,
        );
      }
    }

    expect(postgisViolations).toEqual([]);
  });

  it("F1.5: ADR-0006 Current Commune resolver stays strictly on-device with zero server endpoint accepting raw GPS coordinates for commune resolution", () => {
    expect(repoFileExists("src/lib/current-commune.ts")).toBe(true);
    expect(repoFileExists("src/lib/commune-resolver.ts")).toBe(true);

    const currentCommuneSrc = stripTsComments(
      readRepoFile("src/lib/current-commune.ts"),
    );
    expect(currentCommuneSrc).not.toMatch(/\/api\/.*commune/i);
    expect(currentCommuneSrc).not.toMatch(/supabase.*\.from\(/i);

    const apiRoutes = listRepoFiles("src/routes/api", ".ts");
    const gpsCommuneRoutes = apiRoutes.filter((relPath) =>
      /current[-_]?commune|resolve[-_]?commune/i.test(relPath),
    );
    expect(gpsCommuneRoutes).toEqual([]);

    const subscribeRoute = readRepoFile(
      "src/routes/api/public/v1/subscribe.ts",
    );
    expect(subscribeRoute).not.toMatch(/\b(?:lat|lon|latitude|longitude)\b/);
  });
});

describe("Tier 1 — F2: Non-Negotiable Safety, Legal, 4-Locale I18N & Antislop Guards", () => {
  it("F2.1: enforces 100% 4-locale key and placeholder parity across translation, weather (including weatherKab), and track1..4 bundles", async () => {
    const [arMod, frMod, enMod, kabMod, weatherMod] = await Promise.all([
      importRepoModule<{ ar: TranslationTree }>("src/i18n/locales/ar.ts"),
      importRepoModule<{ fr: TranslationTree }>("src/i18n/locales/fr.ts"),
      importRepoModule<{ en: TranslationTree }>("src/i18n/locales/en.ts"),
      importRepoModule<{ kab: TranslationTree }>("src/i18n/locales/kab.ts"),
      importRepoModule<{
        weatherAr: TranslationTree;
        weatherFr: TranslationTree;
        weatherEn: TranslationTree;
        weatherKab: TranslationTree;
      }>("src/i18n/weather.ts"),
    ]);

    const enEntries = new Map(flattenTree(enMod.en));
    const enKeys = Array.from(enEntries.keys()).sort();
    expect(enKeys.length).toBeGreaterThan(100);

    for (const [locale, tree] of [
      ["ar", arMod.ar],
      ["fr", frMod.fr],
      ["kab", kabMod.kab],
    ] as const) {
      const entries = flattenTree(tree);
      const keys = entries.map(([k]) => k).sort();
      expect(keys, `${locale} translation keys must match en`).toEqual(enKeys);
      for (const [key, val] of entries) {
        // Arabic/Kabyle singular & dual plural forms (e.g., _one/_two/_zero)
        // legitimately express count lexically without repeating {{count}}.
        if (/_(zero|one|two)$/.test(key)) continue;
        expect(
          extractPlaceholders(val),
          `${locale} translation.${key} placeholders`,
        ).toEqual(extractPlaceholders(enEntries.get(key) ?? ""));
      }
    }

    expect(weatherMod.weatherKab).toBeDefined();
    const weatherEnEntries = new Map(flattenTree(weatherMod.weatherEn));
    const weatherKeys = Array.from(weatherEnEntries.keys()).sort();
    expect(weatherKeys.length).toBeGreaterThan(10);

    for (const [locale, tree] of [
      ["ar", weatherMod.weatherAr],
      ["fr", weatherMod.weatherFr],
      ["kab", weatherMod.weatherKab],
    ] as const) {
      const entries = flattenTree(tree);
      expect(
        entries.map(([k]) => k).sort(),
        `${locale} weather keys must match en`,
      ).toEqual(weatherKeys);
    }

    for (const track of ["track1", "track2", "track3", "track4"] as const) {
      const [tAr, tFr, tEn, tKab] = await Promise.all([
        importRepoModule<Record<string, TranslationTree>>(
          `src/i18n/modules/${track}/ar.ts`,
        ),
        importRepoModule<Record<string, TranslationTree>>(
          `src/i18n/modules/${track}/fr.ts`,
        ),
        importRepoModule<Record<string, TranslationTree>>(
          `src/i18n/modules/${track}/en.ts`,
        ),
        importRepoModule<Record<string, TranslationTree>>(
          `src/i18n/modules/${track}/kab.ts`,
        ),
      ]);
      const enTree = Object.values(tEn)[0];
      expect(
        enTree,
        `${track}/en.ts must export a translation object`,
      ).toBeTypeOf("object");
      const refKeys = flattenTree(enTree!)
        .map(([k]) => k)
        .sort();
      for (const [loc, mod] of [
        ["ar", tAr],
        ["fr", tFr],
        ["kab", tKab],
      ] as const) {
        const locTree = Object.values(mod)[0];
        expect(
          flattenTree(locTree!)
            .map(([k]) => k)
            .sort(),
          `${track}/${loc} keys must match en`,
        ).toEqual(refKeys);
      }
    }
  });

  it("F2.2: enforces antislop R-02 zero em dashes (\\u2014) across weather, track1..4, and admin UI locales", async () => {
    const [weatherMod, adminAr, adminFr, adminEn, adminKab] = await Promise.all(
      [
        importRepoModule<Record<string, TranslationTree>>(
          "src/i18n/weather.ts",
        ),
        importRepoModule<{ adminAr: TranslationTree }>("src/i18n/admin/ar.ts"),
        importRepoModule<{ adminFr: TranslationTree }>("src/i18n/admin/fr.ts"),
        importRepoModule<{ adminEn: TranslationTree }>("src/i18n/admin/en.ts"),
        importRepoModule<{ adminKab: TranslationTree }>(
          "src/i18n/admin/kab.ts",
        ),
      ],
    );

    const bundles: Array<{ name: string; tree: TranslationTree }> = [
      { name: "weather.ar", tree: weatherMod.weatherAr! },
      { name: "weather.fr", tree: weatherMod.weatherFr! },
      { name: "weather.en", tree: weatherMod.weatherEn! },
      { name: "weather.kab", tree: weatherMod.weatherKab! },
      { name: "admin.ar", tree: adminAr.adminAr },
      { name: "admin.fr", tree: adminFr.adminFr },
      { name: "admin.en", tree: adminEn.adminEn },
      { name: "admin.kab", tree: adminKab.adminKab },
    ];

    for (const track of ["track1", "track2", "track3", "track4"] as const) {
      for (const loc of ["ar", "fr", "en", "kab"] as const) {
        const mod = await importRepoModule<Record<string, TranslationTree>>(
          `src/i18n/modules/${track}/${loc}.ts`,
        );
        const tree = Object.values(mod)[0];
        if (tree) {
          bundles.push({ name: `${track}.${loc}`, tree });
        }
      }
    }

    const emDashHits: string[] = [];
    for (const { name, tree } of bundles) {
      for (const [key, val] of flattenTree(tree)) {
        const report = findEmDashesInText(val);
        if (report.count > 0) {
          emDashHits.push(`${name}.${key}: "${report.excerpts[0]}"`);
        }
      }
    }

    expect(emDashHits).toEqual([]);
  });

  it("F2.3: enforces ADR-0002 & ADR-0003 banned copy rules (no bare safe/safe zone/safe area/Guardian/emergency mode) across all UI locales", async () => {
    const [arMod, frMod, enMod, kabMod] = await Promise.all([
      importRepoModule<{ ar: TranslationTree }>("src/i18n/locales/ar.ts"),
      importRepoModule<{ fr: TranslationTree }>("src/i18n/locales/fr.ts"),
      importRepoModule<{ en: TranslationTree }>("src/i18n/locales/en.ts"),
      importRepoModule<{ kab: TranslationTree }>("src/i18n/locales/kab.ts"),
    ]);

    // Explicit ADR-0002 honesty disclaimers that negate "all-clear" / "safe zone"
    const negatedHonestyDisclaimers: RegExp[] = [
      /not\s+(?:an?\s+)?all[-\s]clear/gi,
      /does\s+not\s+publish\s+[^.\n]*all[-\s]clear/gi,
      /ne\s+signifie\s+pas\s+[^.\n]*zone\s+s[ûu]re/gi,
      /ur\s+d-yemmal\s+ara\s+[^.\n]*zone\s+s[ûu]re/gi,
      /لا\s+يعني\s+[^.\n]*منطقة\s+آمنة/g,
      /لا\s+يعني\s+[^.\n]*المنطقة\s+آمنة/g,
    ];

    const extraBanned: Array<{
      name: string;
      re: RegExp;
      keyScope?: RegExp;
    }> = [
      {
        name: "Guardian (Survival Mode ADR-0003)",
        re: /\bguardian\b/i,
        keyScope: /^(?:survival|emergency|track[1-4])\b/i,
      },
      { name: "emergency mode", re: /\bemergency\s+mode\b/i },
      { name: "mode urgence", re: /\bmode\s+d['’]?urgence\b/i },
    ];

    const violations: string[] = [];
    for (const [locale, tree] of [
      ["ar", arMod.ar],
      ["fr", frMod.fr],
      ["en", enMod.en],
      ["kab", kabMod.kab],
    ] as const) {
      for (const [key, value] of flattenTree(tree)) {
        let scrubbed = value;
        for (const disclaimer of negatedHonestyDisclaimers) {
          scrubbed = scrubbed.replace(disclaimer, " ");
        }
        const safeHits = findBannedSafeLabels(scrubbed);
        if (safeHits.length > 0) {
          violations.push(
            `${locale}.${key}: banned safe label [${safeHits.join(", ")}]`,
          );
        }
        for (const { name, re, keyScope } of extraBanned) {
          if (keyScope && !keyScope.test(key)) continue;
          if (re.test(value)) {
            violations.push(`${locale}.${key}: banned phrase "${name}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("F2.4: enforces ADR-0003 zero evacuation routing, safest-route, or ETA navigation-around-fire logic in src/", () => {
    const srcFiles = listRepoFiles("src").filter(
      (f) =>
        /\.(ts|tsx)$/.test(f) &&
        !f.includes("__tests__") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith(".test.tsx"),
    );
    expect(srcFiles.length).toBeGreaterThan(20);

    const routingPatterns: Array<{ label: string; re: RegExp }> = [
      { label: "evacuationRoute", re: /\bevacuation[-_]?route(?:s|ing)?\b/i },
      { label: "safestRoute", re: /\bsafest[-_]?route\b/i },
      { label: "routeAroundFire", re: /\broute[-_]?around[-_]?fire\b/i },
      {
        label: "routingEngineUrl",
        re: /router\.project-osrm\.org|api\.mapbox\.com\/directions|routes\.googleapis\.com/i,
      },
    ];

    const violations: string[] = [];
    for (const relPath of srcFiles) {
      const code = stripTsComments(readRepoFile(relPath));
      for (const { label, re } of routingPatterns) {
        if (re.test(code)) {
          violations.push(`${relPath}: matched forbidden "${label}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("F2.5: live /api/public/v1/{fires,civil,weather,risk} feeds carry timestamp/age, attribution, and zero banned status labels", async () => {
    const firesRes = await fetchJson<Record<string, unknown>>(
      "/api/public/v1/fires?limit=5",
    );
    expect(firesRes.status).toBe(200);
    expect(typeof firesRes.data.generated_at).toBe("string");
    expect(
      Number.isFinite(Date.parse(String(firesRes.data.generated_at))),
    ).toBe(true);
    expect(String(firesRes.data.licence ?? "")).toMatch(/NASA FIRMS/i);
    expect(findBannedSafeLabels(firesRes.rawText)).toEqual([]);

    const civilRes = await fetchJson<Record<string, unknown>>(
      "/api/public/v1/civil?limit=5",
    );
    expect(civilRes.status).toBe(200);
    expect(typeof civilRes.data.generated_at).toBe("string");
    expect(String(civilRes.data.attribution ?? "").length).toBeGreaterThan(0);
    expect(findBannedSafeLabels(civilRes.rawText)).toEqual([]);

    let weatherCommune = "0601";
    try {
      const seeded = psqlJson<{ code: string }>(`
        SELECT code
        FROM public.admin_units
        WHERE level = 'commune'
        ORDER BY CASE WHEN code = '1601' THEN 0 ELSE 1 END, code
        LIMIT 1
      `);
      if (seeded[0]?.code) {
        weatherCommune = seeded[0].code;
      }
    } catch {
      // Fallback to seeded Akbou (0601) if local Postgres lookup is unavailable
    }

    const weatherRes = await fetchJson<Record<string, unknown>>(
      `/api/public/v1/weather?commune=${encodeURIComponent(weatherCommune)}`,
    );
    expect([200, 503]).toContain(weatherRes.status);
    if (weatherRes.status === 200) {
      expect("stale" in weatherRes.data).toBe(true);
      expect(findBannedSafeLabels(weatherRes.rawText)).toEqual([]);
    }

    const riskRes = await fetchJson<Record<string, unknown>>(
      "/api/public/v1/risk?limit=5",
    );
    expect([200, 503]).toContain(riskRes.status);
    if (riskRes.status === 200) {
      expect(typeof riskRes.data.generated_at).toBe("string");
      expect(String(riskRes.data.licence ?? "")).toMatch(/Open-Meteo/i);
      expect(findBannedSafeLabels(riskRes.rawText)).toEqual([]);
    }
  });

  it("F2.6: ONM attribution is preserved verbatim and never altered in alert provenance and ONM ingestion contracts", async () => {
    const provenanceMod = await importRepoModule<{
      buildAlertProvenance: (input: {
        triggerKind: string;
        areaLabel?: string | null;
        sourceKey: string;
        sourceAttribution?: string | null;
        ruleLabelKey?: string;
        observedAt: string;
      }) => { sourceAttribution: string; sourceKey: string };
      validateProvenanceInvariants: (data: unknown) => string[];
    }>("src/lib/alert-provenance.ts");

    const verbatimOnm = "Office National de la Météorologie (ONM)";
    const valid = provenanceMod.buildAlertProvenance({
      triggerKind: "wilaya_warning",
      areaLabel: "Alger",
      sourceKey: "onm",
      sourceAttribution: verbatimOnm,
      ruleLabelKey: "provenance.rule.onmSevere",
      observedAt: "2026-11-24T12:00:00Z",
    });
    expect(valid.sourceAttribution).toBe(verbatimOnm);
    expect(provenanceMod.validateProvenanceInvariants(valid)).toEqual([]);

    const tampered = {
      ...valid,
      sourceAttribution: "Nadhir Weather Service",
    };
    const violations = provenanceMod.validateProvenanceInvariants(tampered);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join(" ")).toMatch(/ONM/i);
  });

  it("F2.7: NASA FIRMS thermal anomalies alone are never labelled 'confirmed' and never emit Nadhir-voiced Instructions", async () => {
    const fireConfMod = await importRepoModule<{
      fireLevel?: (
        cluster: Record<string, unknown>,
        context?: Record<string, unknown>,
      ) => string;
    }>("src/lib/fire-confidence.ts");

    expect(typeof fireConfMod.fireLevel).toBe("function");

    const loneThermal = fireConfMod.fireLevel!(
      {
        confirmed_at: null,
        detection_count: 1,
        confidence: 55,
        sources: ["VIIRS_SNPP_NRT"],
        max_frp_mw: 12,
      },
      {},
    );
    expect(loneThermal.toLowerCase()).not.toContain("confirmed");

    const capMod = await importRepoModule<{
      buildFireCap: (input: {
        shortId: string;
        lat: number;
        lon: number;
        radiusKm: number;
        confirmed: boolean;
        urgent: boolean;
        areaDesc: string;
        sentAt: Date;
        texts: Array<{
          language: string;
          event: string;
          headline: string;
          description: string;
          instruction: string;
        }>;
      }) => { info: Array<{ certainty: string; instruction: string }> };
    }>("src/lib/cap.ts");

    const unconfirmedCap = capMod.buildFireCap({
      shortId: "F-TEST-01",
      lat: 36.7169,
      lon: 4.0497,
      radiusKm: 15,
      confirmed: false,
      urgent: false,
      areaDesc: "Tizi Ouzou",
      sentAt: new Date("2026-11-24T12:00:00Z"),
      texts: [
        {
          language: "fr-DZ",
          event: "Feu probable",
          headline: "Signal thermique satellite près de Tizi Ouzou",
          description: "Source : NASA FIRMS (anomalie thermique).",
          instruction: "",
        },
      ],
    });
    expect(unconfirmedCap.info[0]?.certainty).not.toBe("Observed");
    expect(unconfirmedCap.info[0]?.instruction).toBe("");
  });

  it("F2.8: ADR-0004 public Telegram relay is strictly restricted to dgpc_telegram official incidents (never ITA media or raw FIRMS)", () => {
    const deliverySrc = readRepoFile("src/lib/ingest/delivery.server.ts");
    const broadcastSrc = readRepoFile("src/lib/ingest/broadcast.server.ts");
    const combined = `${deliverySrc}\n${broadcastSrc}`;

    // Verify Telegram broadcast delivery does not publish ITA community media or unconfirmed FIRMS
    expect(combined).not.toMatch(/sendTelegram[\s\S]{0,300}ita_facebook/i);
    expect(repoFileExists("src/lib/text-sources/telegram-public.ts")).toBe(
      true,
    );
    const tgPublicSrc = readRepoFile("src/lib/text-sources/telegram-public.ts");
    expect(tgPublicSrc).not.toMatch(/ita_facebook/i);
    expect(tgPublicSrc).not.toMatch(/NASA\s+FIRMS/i);
  });
});
