import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { adminAr } from "@/i18n/admin/ar";
import { adminEn } from "@/i18n/admin/en";
import { adminFr } from "@/i18n/admin/fr";
import { adminKab } from "@/i18n/admin/kab";
import { ar } from "@/i18n/locales/ar";
import { en } from "@/i18n/locales/en";
import { fr } from "@/i18n/locales/fr";
import { kab } from "@/i18n/locales/kab";
import { track1Ar } from "@/i18n/modules/track1/ar";
import { track1En } from "@/i18n/modules/track1/en";
import { track1Fr } from "@/i18n/modules/track1/fr";
import { track1Kab } from "@/i18n/modules/track1/kab";
import { track2Ar } from "@/i18n/modules/track2/ar";
import { track2En } from "@/i18n/modules/track2/en";
import { track2Fr } from "@/i18n/modules/track2/fr";
import { track2Kab } from "@/i18n/modules/track2/kab";
import { track3Ar } from "@/i18n/modules/track3/ar";
import { track3En } from "@/i18n/modules/track3/en";
import { track3Fr } from "@/i18n/modules/track3/fr";
import { track3Kab } from "@/i18n/modules/track3/kab";
import { track4Ar } from "@/i18n/modules/track4/ar";
import { track4En } from "@/i18n/modules/track4/en";
import { track4Fr } from "@/i18n/modules/track4/fr";
import { track4Kab } from "@/i18n/modules/track4/kab";
import { weatherAr, weatherEn, weatherFr, weatherKab } from "@/i18n/weather";

type Tree = { [k: string]: string | Tree };

function flatten(obj: Tree, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null
      ? flatten(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

function flattenEntries(obj: Tree, prefix = ""): Array<[string, string]> {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null
      ? flattenEntries(v, `${prefix}${k}.`)
      : [[`${prefix}${k}`, v]],
  );
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)]
    .map((m) => m[1]!)
    .sort();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return entry === "ui" ? [] : walk(p);
    return /\.tsx?$/.test(p) && !p.includes("__tests__") ? [p] : [];
  });
}

const KEYS = new Set(flatten(en as unknown as Tree));
const ADMIN_KEYS = new Set(flatten(adminEn as unknown as Tree));
const WEATHER_KEYS = new Set(flatten(weatherEn));
const NAMESPACES = {
  translation: KEYS,
  admin: ADMIN_KEYS,
  weather: WEATHER_KEYS,
};
const QUALIFIED_KEYS = new Set(
  Object.entries(NAMESPACES).flatMap(([namespace, keys]) =>
    [...keys].map((key) => `${namespace}:${key}`),
  ),
);

describe("locale parity", () => {
  it("weather translations have 100% key and placeholder parity across ar, fr, en and kab", () => {
    const enEntries = new Map(flattenEntries(weatherEn as unknown as Tree));
    for (const [name, table] of Object.entries({
      ar: weatherAr,
      fr: weatherFr,
      kab: weatherKab,
    })) {
      const tree = table as unknown as Tree;
      expect(flatten(tree).sort(), `${name} weather keys`).toEqual(
        [...WEATHER_KEYS].sort(),
      );
      for (const [key, value] of flattenEntries(tree)) {
        const expectedPlaceholders = placeholders(enEntries.get(key) ?? "");
        expect(
          placeholders(value),
          `${name} weather.${key} placeholders`,
        ).toEqual(expectedPlaceholders);
      }
    }
    expect(i18n.getFixedT("kab", "weather")("pageTitle")).toBe(
      weatherKab.pageTitle,
    );
  });

  const locales = { ar, fr, kab } as unknown as Record<string, Tree>;
  for (const [name, table] of Object.entries(locales)) {
    it(`${name} has exactly the same keys as en`, () => {
      const theirs = new Set(flatten(table));
      expect([...KEYS].filter((k) => !theirs.has(k))).toEqual([]);
      expect([...theirs].filter((k) => !KEYS.has(k))).toEqual([]);
    });
  }

  it("modular track bundles have 100% key parity across ar, fr, en and kab", () => {
    const tracks: Array<{
      name: string;
      en: Tree;
      others: Record<string, Tree>;
    }> = [
      {
        name: "track1",
        en: track1En as unknown as Tree,
        others: {
          ar: track1Ar as unknown as Tree,
          fr: track1Fr as unknown as Tree,
          kab: track1Kab as unknown as Tree,
        },
      },
      {
        name: "track2",
        en: track2En as unknown as Tree,
        others: {
          ar: track2Ar as unknown as Tree,
          fr: track2Fr as unknown as Tree,
          kab: track2Kab as unknown as Tree,
        },
      },
      {
        name: "track3",
        en: track3En as unknown as Tree,
        others: {
          ar: track3Ar as unknown as Tree,
          fr: track3Fr as unknown as Tree,
          kab: track3Kab as unknown as Tree,
        },
      },
      {
        name: "track4",
        en: track4En as unknown as Tree,
        others: {
          ar: track4Ar as unknown as Tree,
          fr: track4Fr as unknown as Tree,
          kab: track4Kab as unknown as Tree,
        },
      },
    ];

    for (const track of tracks) {
      const expected = flatten(track.en).sort();
      const enEntries = new Map(flattenEntries(track.en));
      for (const [locale, bundle] of Object.entries(track.others)) {
        expect(flatten(bundle).sort(), `${track.name}.${locale}`).toEqual(
          expected,
        );
        for (const [key, value] of flattenEntries(bundle)) {
          expect(
            placeholders(value),
            `${track.name}.${locale}.${key} placeholders`,
          ).toEqual(placeholders(enEntries.get(key) ?? ""));
        }
      }
    }
  });

  it("enforces R-02 zero em dashes and non-empty strings across weather, track modules and admin", () => {
    const tables: Array<[string, Tree]> = [
      ["weather.en", weatherEn as unknown as Tree],
      ["weather.fr", weatherFr as unknown as Tree],
      ["weather.ar", weatherAr as unknown as Tree],
      ["weather.kab", weatherKab as unknown as Tree],
      ["track1.en", track1En as unknown as Tree],
      ["track1.fr", track1Fr as unknown as Tree],
      ["track1.ar", track1Ar as unknown as Tree],
      ["track1.kab", track1Kab as unknown as Tree],
      ["track2.en", track2En as unknown as Tree],
      ["track2.fr", track2Fr as unknown as Tree],
      ["track2.ar", track2Ar as unknown as Tree],
      ["track2.kab", track2Kab as unknown as Tree],
      ["track3.en", track3En as unknown as Tree],
      ["track3.fr", track3Fr as unknown as Tree],
      ["track3.ar", track3Ar as unknown as Tree],
      ["track3.kab", track3Kab as unknown as Tree],
      ["track4.en", track4En as unknown as Tree],
      ["track4.fr", track4Fr as unknown as Tree],
      ["track4.ar", track4Ar as unknown as Tree],
      ["track4.kab", track4Kab as unknown as Tree],
      ["admin.en", adminEn as unknown as Tree],
      ["admin.fr", adminFr as unknown as Tree],
      ["admin.ar", adminAr as unknown as Tree],
      ["admin.kab", adminKab as unknown as Tree],
    ];

    const violations: string[] = [];
    for (const [label, table] of tables) {
      for (const [key, value] of flattenEntries(table)) {
        if (value.trim().length === 0) {
          violations.push(`${label}.${key}: empty string`);
        }
        if (value.includes("\u2014")) {
          violations.push(`${label}.${key}: contains em dash`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("head titles", () => {
  const BRAND: Record<string, string> = {
    en: "Nadhir",
    fr: "Nadhir",
    kab: "Nadhir",
    ar: "نذير",
  };

  // titledMeta appends the brand, so a page key carrying it renders it twice
  it("no titledMeta key repeats the brand", () => {
    const keys = new Set<string>();
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/titledMeta\(\s*"([a-zA-Z0-9_.]+)"/g))
        keys.add(m[1]!);
    }
    expect(keys.size).toBeGreaterThan(0);

    const duplicated: string[] = [];
    for (const [lng, brand] of Object.entries(BRAND)) {
      const t = i18n.getFixedT(lng);
      for (const key of keys) {
        const title = t("meta.titleTemplate", { page: t(key) });
        if (title.split(brand).length - 1 > 1)
          duplicated.push(`${lng} ${key}: ${title}`);
      }
    }
    expect(duplicated).toEqual([]);
  });
});

describe("counted labels", () => {
  const COUNTED = [
    "map.fireCount",
    "history.unlocated",
    "history.fireCount",
    "history.weatherCount",
    "history.roadCount",
    "status.degradedCount",
    "account.zoneFires",
    "reports.points",
    "reports.toNext",
    "reports.witnessCount",
  ];

  it("uses singular grammar for one in English", () => {
    const t = i18n.getFixedT("en");
    expect(t("map.fireCount", { count: 1 })).toBe("1 fire");
    expect(t("map.fireCount", { count: 3 })).toBe("3 fires");
    expect(t("history.fireCount", { count: 1 })).toBe("1 fire");
  });

  // Arabic has plural categories en never generates; a missing one renders the key
  it("never renders a raw key for any locale or count", () => {
    for (const lng of ["ar", "fr", "en", "kab"]) {
      const t = i18n.getFixedT(lng);
      for (const key of COUNTED) {
        for (const count of [0, 1, 2, 3, 11, 100]) {
          expect(t(key, { count, km: "1.0" })).not.toBe(key);
        }
      }
    }
  });
});

describe("every referenced key exists", () => {
  it("no component references a missing translation key", () => {
    const missing: string[] = [];
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      const namespaces = [
        ...src.matchAll(/useTranslation\(\s*"([a-z]+)"\s*\)/g),
      ].map((match) => match[1]);
      if (/useTranslation\(\s*\)/.test(src) || !namespaces.length)
        namespaces.push("translation");
      const known = new Set([
        ...QUALIFIED_KEYS,
        ...namespaces.flatMap((namespace) => [
          ...(NAMESPACES[namespace as keyof typeof NAMESPACES] ?? []),
        ]),
      ]);
      for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.:]+)"/g)) {
        const key = m[1]!;
        if (!known.has(key)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("no route head references a missing translation key", () => {
    const missing: string[] = [];
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(
        /\b(?:pageMeta|titledMeta)\(\s*"([a-zA-Z0-9_.:]+)"(?:\s*,\s*"([a-zA-Z0-9_.:]+)")?/g,
      )) {
        for (const key of [m[1], m[2]]) {
          if (key && !KEYS.has(key) && !QUALIFIED_KEYS.has(key))
            missing.push(`${file}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
