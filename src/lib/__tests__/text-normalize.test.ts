import { describe, expect, it } from "vitest";

import {
  normalizeArabic,
  resolveCommune,
  resolveWilaya,
} from "@/lib/text-sources/normalize";

const skikda = [
  { id: "bekkouche", name_ar: "بكوش الأخضر", aliases: [] as string[] },
  { id: "azzaba", name_ar: "عزابة", aliases: [] as string[] },
  { id: "ouldja", name_ar: "الولجة بو البلوط", aliases: [] as string[] },
];
const bejaia = [
  { id: "taskriout", name_ar: "تاسقريوت", aliases: [] as string[] },
  { id: "tamridjet", name_ar: "ثامريجث", aliases: [] as string[] },
  { id: "aokas", name_ar: "أوقاس", aliases: [] as string[] },
];
const jijel = [
  { id: "boudria", name_ar: "بودريعة بن ياجيس", aliases: [] as string[] },
  { id: "texenna", name_ar: "تاكسنة", aliases: [] as string[] },
  { id: "chekfa", name_ar: "الشقفة", aliases: [] as string[] },
];
const wilayas = [
  { id: "tizi", name_ar: "تيزي وزو" },
  { id: "setif", name_ar: "سطيف" },
  { id: "eltarf", name_ar: "الطارف" },
  { id: "souk", name_ar: "سوق أهراس" },
];

describe("normalizeArabic", () => {
  it("folds alef, ta marbuta, ya and diacritics", () => {
    expect(normalizeArabic("أُولاد يَحيى")).toBe("اولاد يحيي");
    expect(normalizeArabic("عزابة")).toBe("عزابه");
  });

  it("folds the Algerian gaf letters into qaf", () => {
    expect(normalizeArabic("عين تڤورايت")).toBe(normalizeArabic("عين تقورايت"));
    expect(normalizeArabic("ڨالمة")).toBe(normalizeArabic("قالمة"));
  });

  it("folds the Persian heh and yeh the gazetteer uses into Arabic letters", () => {
    expect(normalizeArabic("البويهي")).toBe(normalizeArabic("البويھي"));
    expect(normalizeArabic("عين الحمام")).toBe(normalizeArabic("عین الحمام"));
  });

  it("drops hashtags, underscores and punctuation", () => {
    expect(normalizeArabic("#تيزي_وزو:")).toBe("تيزي وزو");
  });

  it("elides a leading definite article and folds ث/ت ق/ك ذ/د", () => {
    expect(normalizeArabic("الأخضر")).toBe("اخضر");
    expect(normalizeArabic("تاسكريوت")).toBe(normalizeArabic("تاسقريوت"));
  });
});

describe("resolveCommune", () => {
  it("matches the exact gazetteer spelling", () => {
    expect(resolveCommune("عزابة", skikda)).toEqual({
      id: "azzaba",
      via: "exact",
    });
  });

  it("matches the DGPC spelling through normalisation", () => {
    expect(resolveCommune("بكوش لخضر", skikda)?.id).toBe("bekkouche");
    expect(resolveCommune("الولجة بولبلوط", skikda)?.id).toBe("ouldja");
  });

  it("treats letter folds as exact matches", () => {
    expect(resolveCommune("تامريجت", bejaia)).toEqual({
      id: "tamridjet",
      via: "exact",
    });
  });

  it("matches close spellings fuzzily and reports it", () => {
    expect(resolveCommune("بوذريعة بني ياجيس", jijel)).toEqual({
      id: "boudria",
      via: "fuzzy",
    });
  });

  it("prefers a registered alias over a fuzzy guess", () => {
    const withAlias = jijel.map((c) =>
      c.id === "boudria" ? { ...c, aliases: ["بوذريعة بني ياجيس"] } : c,
    );
    expect(resolveCommune("بوذريعة بني ياجيس", withAlias)).toEqual({
      id: "boudria",
      via: "alias",
    });
  });

  it("ignores a parenthesised locality after the commune name", () => {
    expect(
      resolveCommune("القصر (آيت يوسف)", [
        { id: "kseur", name_ar: "القصر", aliases: [] },
      ]),
    ).toEqual({ id: "kseur", via: "exact" });
  });

  it("refuses status phrases and short fragments", () => {
    expect(resolveCommune("العملية متواصلة", skikda)).toBeNull();
    expect(resolveCommune("لا", skikda)).toBeNull();
  });
});

describe("resolveWilaya", () => {
  it("finds a two-word wilaya inside a header line", () => {
    expect(resolveWilaya("ولاية #تيزي_وزو:", wilayas)).toBe("tizi");
  });

  it("does not match a wilaya name embedded in a longer word", () => {
    expect(resolveWilaya("حريق بلدية عين سوق", wilayas)).toBeNull();
  });

  it("returns the wilaya named after a commune-first sentence", () => {
    expect(
      resolveWilaya("حريق بلدية تيزي نبشار ولاية #سطيف عملية", wilayas),
    ).toBe("setif");
  });
});
