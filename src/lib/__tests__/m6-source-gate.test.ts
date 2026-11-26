import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { RUNTIME_CONTRACT_KEYS } from "@/lib/ingest/source-runners.server";

const REPO_ROOT = resolve(process.cwd());

const TRACK4_CONTRACTS = [
  "imerg_rainfall",
  "hsaf_rainfall",
  "tariki_facebook",
  "craag_earthquakes",
  "mtg_fci_push",
  "mtg_lightning",
  "gwis_burned_areas",
  "clms_ndvi_swi",
  "ghsl_population",
] as const;

const TRACK4_MIGRATIONS = [
  "supabase/migrations/20261124040000_m4a_rainfall_tariki_craag.sql",
  "supabase/migrations/20261124044000_m4b_scientific_sources_m6_gate.sql",
] as const;

const TRACK4_ADAPTER_FILES = [
  "src/lib/ingest/imerg.ts",
  "src/lib/ingest/imerg.server.ts",
  "src/lib/ingest/hsaf.ts",
  "src/lib/ingest/hsaf.server.ts",
  "src/lib/text-sources/tariki.ts",
  "src/lib/text-sources/tariki.server.ts",
  "src/lib/ingest/craag.ts",
  "src/lib/ingest/craag.server.ts",
  "src/lib/ingest/mtg-fci-push.ts",
  "src/lib/ingest/mtg-fci-push.server.ts",
  "src/lib/ingest/mtg-lightning.ts",
  "src/lib/ingest/mtg-lightning.server.ts",
  "src/lib/ingest/gwis.ts",
  "src/lib/ingest/gwis.server.ts",
  "src/lib/ingest/clms.ts",
  "src/lib/ingest/clms.server.ts",
  "src/lib/ingest/ghsl.ts",
  "src/lib/ingest/ghsl.server.ts",
] as const;

const REQUIRED_FIXTURES: Record<
  (typeof TRACK4_CONTRACTS)[number],
  readonly string[]
> = {
  imerg_rainfall: [
    "imerg-sample.json",
    "imerg-dry-slot.json",
    "imerg-schema-error.json",
    "imerg-upstream-html-error.html",
  ],
  hsaf_rainfall: [
    "hsaf-sample.json",
    "hsaf-dry-slot.json",
    "hsaf-schema-error.json",
    "hsaf-upstream-html-error.html",
  ],
  tariki_facebook: [
    "tariki-posts.json",
    "tariki-empty-window.json",
    "tariki-schema-error.json",
    "tariki-login-wall.html",
  ],
  craag_earthquakes: [
    "craag-bulletins-fr.html",
    "craag-bulletins-ar.html",
    "craag-empty-table.html",
    "craag-schema-error.html",
    "craag-maintenance-error.html",
  ],
  mtg_fci_push: [
    "mtg-fci-push-sample.json",
    "mtg-fci-push-empty-window.json",
    "mtg-fci-push-l1c-0665-error.json",
    "mtg-fci-push-upstream-html-error.html",
  ],
  mtg_lightning: [
    "mtg-lightning-sample.json",
    "mtg-lightning-empty-window.json",
    "mtg-lightning-schema-error.json",
    "mtg-lightning-upstream-html-error.html",
  ],
  gwis_burned_areas: [
    "gwis-burned-areas-sample.geojson",
    "gwis-burned-areas-empty-window.geojson",
    "gwis-burned-areas-schema-error.json",
    "gwis-burned-areas-upstream-html-error.html",
  ],
  clms_ndvi_swi: [
    "clms-ndvi-swi-sample.json",
    "clms-ndvi-swi-empty-window.json",
    "clms-ndvi-swi-schema-error.json",
    "clms-ndvi-swi-upstream-html-error.html",
  ],
  ghsl_population: [
    "ghsl-population-sample.json",
    "ghsl-population-empty-window.json",
    "ghsl-population-schema-error.json",
    "ghsl-population-upstream-html-error.html",
  ],
};

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), "utf8");
}

describe("M6 New-Source Gate automated compliance suite (Track 4)", () => {
  const migrationSql = TRACK4_MIGRATIONS.map((p) => readRepoFile(p)).join("\n");
  const m6Doc = readRepoFile("docs/m6-new-source-gate.md");

  it("M6-1: registers all 9 Track 4 worker contracts in SQL migrations, RUNTIME_CONTRACT_KEYS, and docs/m6-new-source-gate.md", () => {
    for (const key of TRACK4_CONTRACTS) {
      expect(migrationSql).toContain(`'${key}'`);
      expect(RUNTIME_CONTRACT_KEYS).toContain(key);
      expect(m6Doc).toContain(`\`${key}\``);
    }
    expect(m6Doc).toContain("M6-1");
    expect(m6Doc).toContain("M6-7");
    expect(m6Doc).toContain("national-sources-only");
    expect(m6Doc).toContain("emsc");
  });

  it("M6-2: provides valid, empty-window, schema-error, and HTML-error fixtures on disk for all 9 Track 4 sources", () => {
    for (const key of TRACK4_CONTRACTS) {
      const files = REQUIRED_FIXTURES[key];
      expect(files.length).toBeGreaterThanOrEqual(4);
      for (const file of files) {
        const fullPath = resolve(REPO_ROOT, "src/lib/__tests__/fixtures", file);
        expect(existsSync(fullPath), `Missing fixture: ${file}`).toBe(true);
      }
    }
  });

  it("M6-5 (ADR-0001): contains zero PostGIS types, functions, or extensions in Track 4 migrations", () => {
    for (const path of TRACK4_MIGRATIONS) {
      const sqlNoComments = readRepoFile(path)
        .replace(/--[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(sqlNoComments).not.toMatch(/\bpostgis\b/i);
      expect(sqlNoComments).not.toMatch(/\bST_[A-Za-z]+/);
      expect(sqlNoComments).not.toMatch(/\bgeography\s*\(/i);
      expect(sqlNoComments).not.toMatch(/\bgeometry\s*\(/i);
    }
  });

  it("M6-6 (SQL Security): every function created in Track 4 migrations executes explicit REVOKE ALL FROM public, anon, authenticated", () => {
    const fnRegex =
      /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi;
    for (const path of TRACK4_MIGRATIONS) {
      const sql = readRepoFile(path);
      const matches = [...sql.matchAll(fnRegex)];
      expect(matches.length).toBeGreaterThan(0);
      for (const m of matches) {
        const fnName = m[1]!;
        const revokeRegex = new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+public\\.${fnName}\\s*\\([\\s\\S]*?\\)\\s*from\\s+public,\\s*anon,\\s*authenticated;`,
          "i",
        );
        expect(
          revokeRegex.test(sql),
          `Missing explicit REVOKE ALL ... FROM public, anon, authenticated for ${fnName} in ${path}`,
        ).toBe(true);
      }
    }
  });

  it("M6-6 (national-sources-only): zero per-wilaya or per-commune scraping URLs in Track 4 adapters or migrations", () => {
    const subNationalPatterns = [
      /facebook\.com\/(?:dgpc|protection\.civile|tariki)[._-](?:wilaya|alger|oran|setif|tizi|bejaia|blida|annaba|constantine|\d{2})/i,
      /wilaya[_-]?\d{2}\.dz/i,
    ];
    for (const relPath of [...TRACK4_ADAPTER_FILES, ...TRACK4_MIGRATIONS]) {
      const content = readRepoFile(relPath);
      for (const pattern of subNationalPatterns) {
        expect(
          pattern.test(content),
          `Sub-national source pattern matched in ${relPath}`,
        ).toBe(false);
      }
    }
  });

  it("M6-7 (PR #31 exclusions): runtime code never writes eumetsat_fci, polls EO:EUM:DAT:0665, or computes PR #31 artifacts", () => {
    // Migrations must never allow 'eumetsat_fci' in detections or request EO:EUM:DAT:0665 as a target product
    expect(migrationSql).not.toMatch(
      /check\s*\(\s*source\s+in\s*\([^)]*eumetsat_fci/i,
    );
    expect(migrationSql).not.toMatch(/'EO:EUM:DAT:0665'/);

    for (const relPath of TRACK4_ADAPTER_FILES) {
      const content = readRepoFile(relPath);
      // Never write source: "eumetsat_fci"
      expect(content).not.toMatch(/source\s*:\s*["']eumetsat_fci["']/);
      // Never request EO:EUM:DAT:0665 in requestParams or URLs
      expect(content).not.toMatch(/product\s*:\s*["'][^"']*0665/);
      expect(content).not.toMatch(/https?:\/\/[^\s"']*0665/);
      // Never compute rotated downwind bearing, hard-coded burn circles, or logistic calibration
      expect(content).not.toMatch(
        /function\s+\w*(?:rotate|burnCircle|fuelRecovery|logisticCalib)/i,
      );
    }
  });

  it("M6-7 (Web Standard runtime): zero node: imports and zero Buffer. usage in Track 4 ingest/text-source modules", () => {
    for (const relPath of TRACK4_ADAPTER_FILES) {
      const content = readRepoFile(relPath);
      expect(content, `node: import found in ${relPath}`).not.toMatch(
        /from\s+["']node:/,
      );
      expect(content, `Buffer. usage found in ${relPath}`).not.toMatch(
        /\bBuffer\./,
      );
    }
  });

  it("M6-1 / antislop R-02: zero em dashes (U+2014) in Track 4 migrations and docs/m6-new-source-gate.md", () => {
    for (const relPath of [
      ...TRACK4_MIGRATIONS,
      "docs/m6-new-source-gate.md",
    ]) {
      const content = readRepoFile(relPath);
      expect(
        content.includes("\u2014"),
        `Em dash U+2014 found in ${relPath}`,
      ).toBe(false);
    }
  });
});
