import { expect, it, vi } from "vitest";
import { extractItaReport } from "../text-sources/ita-extract.server";
import { LlmUnavailable } from "../text-sources/llm-unavailable";
type ExtractionRequest = Parameters<
  NonNullable<Parameters<typeof extractItaReport>[1]>["complete"]
>[0];
const post = {
  id: "808412572528916_1511278197712051",
  uri: "traficalg",
  created_time: "2026-09-08T18:35:11+0000",
  message: "أشغال في البويرة\nاتجاه الجزائر",
  region: "Bouira",
  type: ["iTravaux"],
};
const output = {
  disposition: "incident_report",
  incidents: [
    {
      kind: "roadworks",
      summary_fr: "Travaux à Bouira en direction d’Alger.",
      evidence: "أشغال في البويرة",
      location_text: "البويرة",
      location_evidence: "في البويرة",
      direction_text: "الجزائر",
      direction_evidence: "اتجاه الجزائر",
      current_status: "unknown",
      status_evidence: null,
      region_assessment: "consistent",
      review_reasons: [],
    },
  ],
  review_reasons: [],
};
const deps = (value: unknown) => ({
  apiKey: "test",
  model: "test",
  complete: vi.fn(async (_request: ExtractionRequest) => JSON.stringify(value)),
});
it("retains grounded LLM interpretation and requests strict output", async () => {
  const d = deps(output);
  expect(await extractItaReport(post, d)).toEqual(output);
  expect(d.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      response_format: expect.objectContaining({ type: "json_schema" }),
    }),
  );
});
it("rejects invented evidence", async () => {
  await expect(
    extractItaReport(
      post,
      deps({
        ...output,
        incidents: [{ ...output.incidents[0], evidence: "invented" }],
      }),
    ),
  ).rejects.toThrow("evidence");
});
it("repairs joined status quotes with one grounded LLM correction", async () => {
  const message =
    "🚨🚨 متابعة : يتم رفع وازاحة الشاحنتين محل الحادث بالطريق السيار شرق غرب قبل محطة الخدمات بابور سطيف اتجاه الجزائر حركة السير بطيئة في القطاع.";
  const incident = {
    ...output.incidents[0],
    evidence: "يتم رفع وازاحة الشاحنتين محل الحادث",
    location_text: "قبل محطة الخدمات بابور سطيف",
    location_evidence: "قبل محطة الخدمات بابور سطيف",
    current_status: "ongoing",
    status_evidence:
      "يتم رفع وازاحة الشاحنتين محل الحادث ... حركة السير بطيئة في القطاع.",
  };
  const corrected = {
    ...output,
    incidents: [
      { ...incident, status_evidence: "حركة السير بطيئة في القطاع." },
    ],
  };
  const d = deps({ ...output, incidents: [incident] });
  d.complete
    .mockResolvedValueOnce(JSON.stringify({ ...output, incidents: [incident] }))
    .mockResolvedValueOnce(JSON.stringify(corrected));
  expect(await extractItaReport({ ...post, message }, d)).toEqual(corrected);
  expect(d.complete).toHaveBeenCalledTimes(2);
  expect(d.complete).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("unsupported status evidence"),
        }),
      ]),
    }),
  );
});
it("stops after one failed repair instead of accepting unsupported evidence", async () => {
  const d = deps({
    ...output,
    incidents: [{ ...output.incidents[0], evidence: "invented" }],
  });
  await expect(extractItaReport(post, d)).rejects.toThrow(
    "unsupported event evidence",
  );
  expect(d.complete).toHaveBeenCalledTimes(2);
});
it("identifies the omitted-word location quotes and supplies the source for correction", async () => {
  const message =
    "🚨🚨 \n\nحادث مرور بالطريق الوطني رقم 12 بين تيزي وزو بين إعكورن وأدكار .";
  const invalidQuote = "الطريق الوطني رقم 12 بين إعكورن وأدكار";
  const sourceQuote = "الطريق الوطني رقم 12 بين تيزي وزو بين إعكورن وأدكار";
  const incident = {
    ...output.incidents[0],
    kind: "collision",
    summary_fr: "Accident entre Yakouren et Azazga.",
    evidence: "حادث مرور",
    location_text: invalidQuote,
    location_evidence: invalidQuote,
    direction_text: null,
    direction_evidence: null,
    region_assessment: "unverified",
  };
  const corrected = {
    ...output,
    incidents: [
      {
        ...incident,
        summary_fr:
          "Accident sur la route nationale 12 entre إعكورن et أدكار, dans le secteur mentionné de تيزي وزو.",
        location_text: sourceQuote,
        location_evidence: sourceQuote,
      },
    ],
  };
  const d = deps(corrected);
  d.complete.mockResolvedValueOnce(
    JSON.stringify({ ...output, incidents: [incident] }),
  );
  expect(await extractItaReport({ ...post, message }, d)).toEqual(corrected);
  const feedback = d.complete.mock.calls[1]?.[0].messages.at(-1)?.content ?? "";
  expect(feedback).toContain("incidents[0].location_evidence");
  expect(feedback).toContain("incidents[0].location_text");
  expect(feedback).toContain(invalidQuote);
  expect(feedback).toContain(message.replace(/\s+/gu, " ").trim());
  expect(feedback).toContain("place names verbatim");
  expect(d.complete).toHaveBeenCalledTimes(2);

  const repeated = deps({ ...output, incidents: [incident] });
  await expect(
    extractItaReport({ ...post, message }, repeated),
  ).rejects.toThrow("incidents[0].location_text");
  expect(repeated.complete).toHaveBeenCalledTimes(3);
});
it("asks the LLM to preserve the report with an unknown location after repeated Arabic quote failure", async () => {
  const message = "كان غالق الطريق ورام للفارماسي لي فالاستقلال";
  const incident = {
    ...output.incidents[0],
    evidence: "كان غالق الطريق",
    location_text: "الفارماسي لي فالاستقلال",
    location_evidence: "الفارماسي لي فالاستقلال",
    direction_text: null,
    direction_evidence: null,
  };
  const uncertain = {
    ...output,
    incidents: [
      {
        ...incident,
        summary_fr: "Un véhicule aurait bloqué la route. Lieu non confirmé.",
        location_text: null,
        location_evidence: null,
        region_assessment: "unverified",
        review_reasons: ["Lieu non confirmé par une citation exacte."],
      },
    ],
  };
  const d = deps({ ...output, incidents: [incident] });
  d.complete
    .mockResolvedValueOnce(JSON.stringify({ ...output, incidents: [incident] }))
    .mockResolvedValueOnce(JSON.stringify({ ...output, incidents: [incident] }))
    .mockResolvedValueOnce(JSON.stringify(uncertain));
  expect(await extractItaReport({ ...post, message }, d)).toEqual(uncertain);
  expect(d.complete).toHaveBeenCalledTimes(3);
  expect(d.complete.mock.calls[2]?.[0].messages.at(-1)?.content).toContain(
    "incidents[0].location",
  );
});
it.each(["missing review", "claimed region", "lost incident"])(
  "rejects uncertainty fallback with %s",
  async (defect) => {
    const rejected = {
      ...output,
      incidents: [
        {
          ...output.incidents[0],
          location_text: "invented",
          location_evidence: "invented",
        },
      ],
    };
    const uncertain = {
      ...output,
      incidents:
        defect === "lost incident"
          ? []
          : [
              {
                ...output.incidents[0],
                location_text: null,
                location_evidence: null,
                region_assessment:
                  defect === "claimed region" ? "consistent" : "unverified",
                review_reasons:
                  defect === "missing review" ? [] : ["Lieu non confirmé."],
              },
            ],
    };
    const d = deps(rejected);
    d.complete
      .mockResolvedValueOnce(JSON.stringify(rejected))
      .mockResolvedValueOnce(JSON.stringify(rejected))
      .mockResolvedValueOnce(JSON.stringify(uncertain));
    await expect(extractItaReport(post, d)).rejects.toThrow();
    expect(d.complete).toHaveBeenCalledTimes(3);
  },
);
it("shares the report deadline with its repair request", async () => {
  const invalid = {
    ...output,
    incidents: [{ ...output.incidents[0], evidence: "invented" }],
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        choices: [{ message: { content: JSON.stringify(invalid) } }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        choices: [{ message: { content: JSON.stringify(output) } }],
      }),
    );
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  vi.stubGlobal("fetch", request);
  try {
    expect(await extractItaReport(post)).toEqual(output);
    expect(request.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(request.mock.calls[1]?.[1].signal).toBe(
      request.mock.calls[0]?.[1].signal,
    );
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
it("reports exhausted credits and a dropped connection as a provider outage", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  try {
    vi.stubGlobal("fetch", async () => new Response("", { status: 402 }));
    await expect(extractItaReport(post)).rejects.toBeInstanceOf(LlmUnavailable);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(extractItaReport(post)).rejects.toBeInstanceOf(LlmUnavailable);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it("requires evidence for a claimed current status", async () => {
  await expect(
    extractItaReport(
      post,
      deps({
        ...output,
        incidents: [{ ...output.incidents[0], current_status: "resolved" }],
      }),
    ),
  ).rejects.toThrow("status");
});
it("requires direction and location evidence separately", async () => {
  await expect(
    extractItaReport(
      post,
      deps({
        ...output,
        incidents: [{ ...output.incidents[0], direction_evidence: null }],
      }),
    ),
  ).rejects.toThrow("direction");
});
it("rejects invalid JSON shape and missing key visibly", async () => {
  await expect(extractItaReport(post, deps([]))).rejects.toThrow();
  await expect(
    extractItaReport(post, { ...deps(output), apiKey: undefined }),
  ).rejects.toThrow("OPENROUTER_API_KEY");
});
it("does not silently discard incidents in irrelevant reports", async () => {
  await expect(
    extractItaReport(
      post,
      deps({ ...output, disposition: "general_information" }),
    ),
  ).rejects.toThrow("disposition");
});
