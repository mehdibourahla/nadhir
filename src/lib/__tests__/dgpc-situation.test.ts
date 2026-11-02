import { describe, expect, it, vi } from "vitest";

import {
  defaultSituationReader,
  readSituation,
  type SituationDependencies,
} from "@/lib/text-sources/dgpc-situation.server";
import { LlmUnavailable } from "@/lib/text-sources/llm-unavailable";

const situationPost = `🚨🚨 الحالة العامة إثر التقلبات الجوية على الساعة 20سا00د – 19/09/2026
◀️◀️ ولايــــــــــــــــــــــة سيدي بلعباس
🔴 بلدية بئر الحمام / بلدية مرحومة
🟢 الطريق الوطني رقم 104 الرابط بين بلديتي بئر الحمام ومرحومة مقطوع أمام حركة المرور بسبب ارتفاع منسوب مياه وادي مرحومة.
#الحماية_المدنية_الجزائرية`;

const relayPost = `🔴 نشرية جوية خاصة (رياح قوية 💨💨)
🚨 تبعًا للنشرية الجوية الخاصة الصادرة عن الديوان الوطني للأرصاد الجوية، تخص هبوب رياح قوية،
📍 الولايات المعنية:
#وهران، #مستغانم، #الشلف.
⚠️ تنبيه:
يُرجى توخي الحيطة والحذر أثناء السياقة، وتثبيت الأشياء العرضة للتطاير، وتفادي التواجد بالقرب من الأشجار واللافتات.`;

const empty = {
  items: [],
  advice_text: null,
  advice_wilayas: [],
  valid_from: null,
  valid_to: null,
};

function answering(payload: unknown): SituationDependencies {
  return {
    model: "m",
    complete: async () => JSON.stringify(payload),
  };
}

describe("readSituation", () => {
  it("keeps a road closure whose evidence is copied from the post", async () => {
    const result = await readSituation(
      situationPost,
      answering({
        ...empty,
        disposition: "situation_report",
        items: [
          {
            hazard: "road",
            wilaya: "سيدي بلعباس",
            commune: "مرحومة",
            place: "الطريق الوطني رقم 104",
            state: "ongoing",
            evidence:
              "الطريق الوطني رقم 104 الرابط بين بلديتي بئر الحمام ومرحومة مقطوع أمام حركة المرور",
          },
          {
            hazard: "flood",
            wilaya: "سيدي بلعباس",
            commune: "بئر الحمام",
            place: null,
            state: "ongoing",
            evidence: "فيضان واد كبير في وسط المدينة",
          },
        ],
      }),
    );
    expect(result.disposition).toBe("situation_report");
    expect(result.items.map((i) => i.hazard)).toEqual(["road"]);
    expect(result.rejected).toBe(1);
  });

  it("keeps the authority's advice only when it is the post's own words", async () => {
    const advice =
      "يُرجى توخي الحيطة والحذر أثناء السياقة، وتثبيت الأشياء العرضة للتطاير، وتفادي التواجد بالقرب من الأشجار واللافتات.";
    const kept = await readSituation(
      relayPost,
      answering({
        ...empty,
        disposition: "weather_relay",
        advice_text: advice,
        advice_wilayas: ["وهران", "مستغانم", "الشلف"],
      }),
    );
    expect(kept.advice?.text).toBe(advice);
    expect(kept.advice?.wilayas).toEqual(["وهران", "مستغانم", "الشلف"]);

    const invented = await readSituation(
      relayPost,
      answering({
        ...empty,
        disposition: "weather_relay",
        advice_text: "ابقوا في منازلكم",
        advice_wilayas: ["وهران"],
      }),
    );
    expect(invented.advice).toBeNull();
    expect(invented.rejected).toBe(1);
  });

  it("drops a validity the model did not write as a timestamp", async () => {
    const result = await readSituation(
      relayPost,
      answering({
        ...empty,
        disposition: "weather_relay",
        advice_text:
          "يُرجى توخي الحيطة والحذر أثناء السياقة، وتثبيت الأشياء العرضة للتطاير",
        advice_wilayas: ["وهران"],
        valid_from: "jeudi 18h",
        valid_to: "2026-09-20T21:00:00+01:00",
      }),
    );
    expect(result.advice).toMatchObject({
      validFrom: null,
      validTo: "2026-09-20T21:00:00+01:00",
    });
  });

  it("publishes nothing from a retrospective post", async () => {
    const result = await readSituation(
      situationPost,
      answering({
        ...empty,
        disposition: "retrospective",
        items: [
          {
            hazard: "road",
            wilaya: null,
            commune: null,
            place: null,
            state: "ongoing",
            evidence: "الطريق الوطني رقم 104",
          },
        ],
      }),
    );
    expect(result.items).toEqual([]);
    expect(result.advice).toBeNull();
  });

  it("fails loudly on a malformed answer, and waits while no gateway is configured", async () => {
    await expect(
      readSituation(situationPost, answering({ disposition: "weird" })),
    ).rejects.toThrow(/unexpected shape/);
    vi.stubEnv("NADHIR_GATEWAY_URL", "");
    try {
      await expect(
        readSituation(situationPost, defaultSituationReader()),
      ).rejects.toBeInstanceOf(LlmUnavailable);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
