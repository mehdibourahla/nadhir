import { describe, expect, it } from "vitest";

import {
  broadcastTexts,
  earthquakeTexts,
  officialHazardTexts,
  officialTexts,
  type BroadcastVars,
} from "@/lib/broadcast-copy";
import { BANNED_STATUS_LABELS } from "@/lib/alert-provenance";
import { NON_FIRE_BROADCAST_KINDS } from "@/lib/broadcast-rules";
import type { BroadcastPhase } from "@/lib/cap";

const vars: BroadcastVars = {
  place: "عزازقة",
  wilaya: "تيزي وزو",
  km: 4.2,
  bearingDeg: 135,
  hotspots: 17,
  hours: 12,
  inside: { ar: [], fr: [], en: [], kab: [] },
};

const PHASES: BroadcastPhase[] = ["initial", "update", "end", "cancel"];

describe("broadcastTexts", () => {
  it("renders every phase in the four subscription languages", () => {
    for (const phase of PHASES) {
      const texts = broadcastTexts(phase, vars);
      expect(texts.map((t) => t.language)).toEqual([
        "ar-DZ",
        "fr-DZ",
        "en",
        "kab",
      ]);
    }
  });

  it("leaves no unfilled template slot in any variant", () => {
    const variants: BroadcastVars[] = [
      vars,
      { ...vars, km: null },
      { ...vars, bearingDeg: null },
      { ...vars, km: null, bearingDeg: null },
    ];
    for (const phase of PHASES)
      for (const v of variants)
        for (const t of broadcastTexts(phase, v)) {
          expect(t.headline).not.toContain("{{");
          expect(t.description).not.toContain("{{");
          expect(t.instruction).not.toContain("{{");
        }
  });

  it("says detected, never confirmed, in Nadhir's own voice", () => {
    const ar = broadcastTexts("initial", vars)[0]!;
    expect(ar.headline).toBe("حريق مرصود بالقمر الاصطناعي — عزازقة، تيزي وزو");
    expect(ar.headline).not.toContain("مؤكد");
    for (const text of broadcastTexts("initial", vars)) {
      expect(text.headline.toLowerCase()).not.toContain("confirm");
      expect(text.description.toLowerCase()).not.toContain("confirm");
    }
    expect(ar.description).toContain("4.2");
    expect(ar.description).toContain("الجنوب الشرقي");
  });

  it("ends observation-honestly, naming the quiet hours, never all-clear", () => {
    const ar = broadcastTexts("end", vars)[0]!;
    expect(ar.headline).toContain("لا رصد جديد");
    expect(ar.description).toContain("12");
    const en = broadcastTexts("end", vars)[2]!;
    expect(en.description.toLowerCase()).not.toContain("all clear");
    expect(en.description.toLowerCase()).not.toContain("safe");
  });

  it("carries the standing-guidance instruction only while the fire is live", () => {
    expect(broadcastTexts("initial", vars)[0]!.instruction).not.toBe("");
    expect(broadcastTexts("update", vars)[1]!.instruction).not.toBe("");
    expect(broadcastTexts("end", vars)[0]!.instruction).toBe("");
    expect(broadcastTexts("cancel", vars)[3]!.instruction).toBe("");
  });

  it("drops the drift sentence when the wind direction is unknown", () => {
    const withDrift = broadcastTexts("initial", vars)[2]!;
    const noDrift = broadcastTexts("initial", {
      ...vars,
      bearingDeg: null,
    })[2]!;
    expect(withDrift.description).toContain("southeast");
    expect(noDrift.description).not.toContain("southeast");
  });
});

describe("inside communes", () => {
  const withInside: BroadcastVars = {
    ...vars,
    inside: {
      ar: ["الميلية"],
      fr: ["El Milia"],
      en: ["El Milia"],
      kab: ["El Milia"],
    },
  };
  const fr = (phase: BroadcastPhase, v: BroadcastVars) =>
    broadcastTexts(phase, v).find((t) => t.language === "fr-DZ")!.description;

  it("names the commune the fire has entered on initial and update", () => {
    for (const phase of ["initial", "update"] as const)
      expect(fr(phase, withInside)).toContain(
        "Détections à l'intérieur de la commune d'El Milia",
      );
    expect(
      fr("initial", {
        ...withInside,
        inside: { ...withInside.inside, fr: ["Texenna"] },
      }),
    ).toContain("de la commune de Texenna");
  });

  it("lists several communes", () => {
    expect(
      fr("update", {
        ...withInside,
        inside: { ...withInside.inside, fr: ["El Milia", "Texenna"] },
      }),
    ).toContain("Détections à l'intérieur des communes : El Milia, Texenna");
  });

  it("says nothing about communes on end and cancel, or when none is inside", () => {
    for (const phase of ["end", "cancel"] as const)
      expect(fr(phase, withInside)).not.toContain("intérieur");
    expect(fr("initial", vars)).not.toContain("intérieur");
  });
});

describe("officialTexts", () => {
  const vars = {
    commune: "Aïn Zouit",
    wilaya: "Skikda",
    source: "الحماية المدنية الجزائرية",
    asOf: "28/08 08:00",
    status: "ongoing" as const,
  };

  it("relays the authority in four languages with its own as-of time", () => {
    const texts = officialTexts(vars, false);
    expect(texts.map((t) => t.language)).toEqual([
      "ar-DZ",
      "fr-DZ",
      "en",
      "kab",
    ]);
    for (const text of texts) {
      expect(text.headline).not.toContain("{{");
      expect(text.description).not.toContain("{{");
      expect(text.description).toContain("28/08 08:00");
      expect(text.instruction).not.toBe("");
    }
    const fr = texts.find((t) => t.language === "fr-DZ")!;
    expect(fr.headline).toContain("Aïn Zouit");
    expect(fr.description).toContain("Opérations en cours");
  });

  it("says plainly when no satellite saw it, and stays silent when one did", () => {
    const unseen = officialTexts(vars, false).find(
      (t) => t.language === "fr-DZ",
    )!;
    expect(unseen.description).toContain("Aucun point chaud satellite");
    const seen = officialTexts(vars, true).find((t) => t.language === "fr-DZ")!;
    expect(seen.description).not.toContain("Aucun point chaud");
  });
});

function assertHonestNonFireCopy(text: {
  headline: string;
  description: string;
  instruction: string;
}) {
  const combined = `${text.headline}\n${text.description}\n${text.instruction}`;
  expect(combined).not.toContain("{{");
  expect(combined).not.toContain("\u2014");
  expect(text.instruction).toBe("");
  const lower = combined.toLowerCase();
  for (const banned of BANNED_STATUS_LABELS) {
    expect(lower).not.toContain(banned.toLowerCase());
  }
  expect(lower).not.toContain("satellite");
  expect(lower).not.toContain("point chaud");
  expect(combined).not.toContain("نقطة حرارية");
}

describe("officialHazardTexts (F8)", () => {
  it("renders all 4 non-fire hazards across initial and end in all 4 locales with zero em dashes, zero banned labels, and empty instruction", () => {
    for (const kind of NON_FIRE_BROADCAST_KINDS) {
      for (const phase of ["initial", "end"] as const) {
        const texts = officialHazardTexts({
          kind,
          phase,
          commune: "Bab El Oued",
          wilaya: "Alger",
          place: "Place des Martyrs",
          source: "DGPC",
          asOf: "24/11 10:15",
          evidence: "Intervention en cours suite à la montée des eaux.",
        });
        expect(texts.map((t) => t.language)).toEqual([
          "ar-DZ",
          "fr-DZ",
          "en",
          "kab",
        ]);
        for (const text of texts) {
          assertHonestNonFireCopy(text);
          expect(text.headline).toContain("Bab El Oued");
          expect(text.description).toContain("24/11 10:15");
          expect(text.description).toContain("DGPC");
        }
      }
    }
  });
});

describe("earthquakeTexts (F9)", () => {
  it("renders onshore and offshore M4+ earthquakes in all 4 locales with zero em dashes, zero safe labels, and empty instruction", () => {
    for (const offshore of [false, true]) {
      const texts = earthquakeTexts({
        magnitude: 4.6,
        place: "Béjaïa",
        wilaya: "Béjaïa",
        depthKm: 10,
        network: "EMSC",
        asOf: "24/11 11:20",
        offshore,
      });
      expect(texts.map((t) => t.language)).toEqual([
        "ar-DZ",
        "fr-DZ",
        "en",
        "kab",
      ]);
      for (const text of texts) {
        assertHonestNonFireCopy(text);
        expect(text.headline).toContain("4.6");
        expect(text.headline).toContain("EMSC");
        expect(text.description).toContain("24/11 11:20");
        expect(text.description).toContain("10");
      }
    }
  });
});
