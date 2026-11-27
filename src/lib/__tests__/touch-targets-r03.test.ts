import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

function extractJsxOpeningTags(
  source: string,
  tagNames: readonly string[],
): string[] {
  const tags: string[] = [];
  const pattern = new RegExp(`<(${tagNames.join("|")})\\b`, "g");
  for (const match of source.matchAll(pattern)) {
    const start = match.index;
    let i = start + match[0].length;
    let braceDepth = 0;
    let quote: '"' | "'" | "`" | null = null;
    while (i < source.length) {
      const ch = source[i]!;
      if (quote) {
        if (ch === "\\" && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "{") {
        braceDepth += 1;
      } else if (ch === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (ch === ">" && braceDepth === 0) {
        tags.push(source.slice(start, i + 1));
        break;
      }
      i += 1;
    }
  }
  return tags;
}

describe("antislop R-03 touch-target compliance & auth locale redirect contracts", () => {
  it("enforces >= 44x44px MapLibre attribution links and compact toggle in src/styles.css", () => {
    const css = readSource("src/styles.css");

    const attribLinkBlock = css.match(
      /\.maplibregl-ctrl-attrib\s+a\s*\{[^}]*\}/,
    );
    expect(
      attribLinkBlock,
      "missing .maplibregl-ctrl-attrib a rule",
    ).toBeTruthy();
    expect(attribLinkBlock![0]).toMatch(/min-height:\s*44px/);
    expect(attribLinkBlock![0]).toMatch(/min-width:\s*44px/);
    expect(attribLinkBlock![0]).toMatch(/display:\s*inline-flex/);

    const attribButtonBlock = css.match(
      /\.maplibregl-ctrl-attrib\s+\.maplibregl-ctrl-attrib-button\s*\{[^}]*\}/,
    );
    expect(
      attribButtonBlock,
      "missing .maplibregl-ctrl-attrib-button rule",
    ).toBeTruthy();
    expect(attribButtonBlock![0]).toMatch(/min-height:\s*44px/);
    expect(attribButtonBlock![0]).toMatch(/min-width:\s*44px/);
  });

  it("enforces min-h-11 on Instrument Rail primary nav links and all AtlasPageFooter links", () => {
    const chrome = readSource("src/ui/app-shell.tsx");

    // Primary desktop nav links inside Instrument Rail
    const navMatch = chrome.match(
      /<nav[\s\S]*?aria-label=\{t\("nav\.map"\)\}[\s\S]*?<\/nav>/,
    );
    expect(navMatch, "missing desktop primary nav").toBeTruthy();
    expect(navMatch![0]).toContain("min-h-11");
    expect(navMatch![0]).toContain("min-w-11");

    // AtlasPageFooter links must have unconditional min-h-11 min-w-11
    const footerMatch = chrome.match(
      /export function AtlasPageFooter\(\)[\s\S]*$/,
    );
    expect(footerMatch, "missing AtlasPageFooter").toBeTruthy();
    const footerLinks = [...footerMatch![0].matchAll(/<Link[\s\S]*?>/g)];
    expect(footerLinks.length).toBeGreaterThanOrEqual(6);
    for (const match of footerLinks) {
      expect(match[0]).toContain("min-h-11");
      expect(match[0]).toContain("min-w-11");
      expect(match[0]).not.toContain("pointer-coarse:min-h-11");
    }
  });

  it("enforces >= 44px controls on /settings and push diagnostics without tiny checkboxes", () => {
    const settings = readSource("src/routes/_authenticated/settings.tsx");
    const diagnostics = readSource("src/ui/push-diagnostics.tsx");

    // Zero em dashes in settings.tsx (R-02)
    expect(settings).not.toContain("\u2014");
    expect(diagnostics).not.toContain("\u2014");

    // Zero raw small checkboxes (h-5 w-5) on /settings
    expect(settings).not.toMatch(/type="checkbox"/);

    // Every <input>, <select>, and <button> opening tag in settings.tsx must include min-h-11
    const controlTags = extractJsxOpeningTags(settings, [
      "input",
      "select",
      "button",
    ]);
    expect(controlTags.length).toBeGreaterThanOrEqual(11);
    for (const tag of controlTags) {
      expect(tag, `Control missing min-h-11:\n${tag}`).toContain("min-h-11");
    }

    // Push diagnostics buttons enforce min-h-11 for R-03
    expect(diagnostics).toContain("min-h-11");
  });

  it("wires locale preservation in _authenticated/route.tsx and routes/auth.tsx", () => {
    const authLayout = readSource("src/routes/_authenticated/route.tsx");
    const authRoute = readSource("src/routes/auth.tsx");

    expect(authLayout).toContain("authRedirectSearch");
    expect(authRoute).toContain("resolveAuthLocale");
    expect(authRoute).toMatch(/lang\?:\s*AnyLocale/);
  });
});
