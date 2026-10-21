import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

import {
  completeWithCodex,
  type ChatRequest,
  type CodexEffort,
} from "../src/lib/llm/codex.server";
import {
  completeWithOpenRouter,
  extractMentionsWithLlm,
  type LlmMention,
  type OpenRouterRequest,
} from "../src/lib/text-sources/extract-llm.server";
import { extractItaReport } from "../src/lib/text-sources/ita-extract.server";
import type { CommuneCandidate } from "../src/lib/text-sources/normalize";
import {
  runTextSourceWith,
  type TextSourceStore,
} from "../src/lib/text-sources/pipeline.server";

// --rescore re-reads results.json; otherwise CODEX_AUTH_FILE holds only {access_token, account_id}
const RESCORE = process.argv.includes("--rescore");
const OUT =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ??
  ".agent/runs/2026-10-21-codex-extraction";
const RUNS = 2;
const STOP_AT_PERCENT = 75;
const apiKey = process.env["OPENROUTER_API_KEY"];
const authFile = process.env["CODEX_AUTH_FILE"];
if (!RESCORE && (!apiKey || !authFile)) {
  console.error("needs OPENROUTER_API_KEY and CODEX_AUTH_FILE, or --rescore");
  process.exit(64);
}
const auth = authFile
  ? (JSON.parse(readFileSync(authFile, "utf8")) as {
      access_token: string;
      account_id: string;
      refresh_token?: string;
    })
  : null;
if (auth?.refresh_token) {
  console.error("CODEX_AUTH_FILE must not hold a refresh token");
  process.exit(65);
}
const lease = auth && { token: auth.access_token, account: auth.account_id };

const FIXTURES = "src/lib/__tests__/fixtures";
const admin = JSON.parse(
  readFileSync("data/geo/algeria-admin.json", "utf8"),
) as {
  wilayas: { code: string; name_ar: string }[];
  communes: {
    code: string;
    name_ar: string;
    name_fr: string;
    wilaya_code: string;
  }[];
};
// the production aliases are seeded by migrations, keyed by commune code or French name
const aliases = new Map<string, string[]>();
for (const file of readdirSync("supabase/migrations")) {
  const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
  if (!sql.includes("admin_unit_aliases")) continue;
  const pairs = [
    ...[
      ...sql.matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'(?:\s*,\s*'([^']+)')?/g),
    ].map((m) => [m[1]!, m[3] ?? m[2]!] as const),
    ...[
      ...sql.matchAll(
        /select u\.id, '([^']+)', 'dgpc'\s+from public\.admin_units u\s+where u\.name_fr = '([^']+)'/g,
      ),
    ].map((m) => [m[2]!, m[1]!] as const),
  ];
  for (const [key, alias] of pairs) {
    const commune = admin.communes.find(
      (c) => c.code === key || c.name_fr === key,
    );
    if (commune && /[\u0600-\u06FF]/.test(alias))
      aliases.set(commune.code, [...(aliases.get(commune.code) ?? []), alias]);
  }
}
const gazetteer = {
  wilayas: admin.wilayas.map((w) => ({ id: w.code, name_ar: w.name_ar })),
  communesByWilaya: admin.communes.reduce((byWilaya, c) => {
    const list = byWilaya.get(c.wilaya_code) ?? [];
    list.push({
      id: c.code,
      name_ar: c.name_ar,
      aliases: aliases.get(c.code) ?? [],
    });
    return byWilaya.set(c.wilaya_code, list);
  }, new Map<string, CommuneCandidate[]>()),
};

const bulletins = [
  ...(
    JSON.parse(
      readFileSync(`${FIXTURES}/dgpc-recovery-posts.json`, "utf8"),
    ) as { external_id: string; body: string; published_at: string }[]
  ).map((p) => ({ id: p.external_id, text: p.body, at: p.published_at })),
  ...readdirSync(`${FIXTURES}/dgpc`)
    .filter((f) => f.startsWith("bulletin"))
    .sort()
    .map((f) => ({
      id: f,
      text: readFileSync(`${FIXTURES}/dgpc/${f}`, "utf8"),
      at: "2026-09-01T12:00:00Z",
    })),
];

// synthetic posts; the expected labels are the evaluator's reading of each one
const ita: {
  id: string;
  message: string;
  region: string;
  disposition: string;
  kinds: string[][];
  status?: string;
}[] = [
  {
    id: "roadworks",
    message: "أشغال في البويرة\nاتجاه الجزائر",
    region: "Bouira",
    disposition: "incident_report",
    kinds: [["roadworks"]],
  },
  {
    id: "accident",
    message:
      "حادث مرور على الطريق الوطني رقم 5 ببلدية الأخضرية في اتجاه البويرة، حركة المرور بطيئة",
    region: "Bouira",
    disposition: "incident_report",
    kinds: [["collision"]],
  },
  {
    id: "snow",
    message: "الطريق الوطني رقم 15 مغلق بسبب تساقط الثلوج على مستوى تيكجدة",
    region: "Bouira",
    disposition: "incident_report",
    kinds: [["weather", "road_hazard"]],
  },
  {
    id: "awareness",
    message:
      "تذكير: احترموا السرعة المحددة في الطرق السريعة، السرعة المفرطة سبب رئيسي لحوادث المرور",
    region: "Alger",
    disposition: "general_information",
    kinds: [],
  },
  {
    id: "flood-fr",
    message:
      "Attention : la route de Bab Ezzouar vers Dar El Beida est inondée au niveau de l'échangeur, circulation très difficile",
    region: "Alger",
    disposition: "incident_report",
    kinds: [["flooding"]],
  },
  {
    id: "reopened",
    message:
      "إعادة فتح الطريق الوطني رقم 5 أمام حركة المرور بعد إزالة الأتربة على مستوى الأخضرية",
    region: "Bouira",
    disposition: "incident_report",
    kinds: [["road_hazard", "other", "roadworks"]],
    status: "resolved",
  },
  {
    id: "two-places",
    message:
      "ازدحام مروري كبير على الطريق السيار شرق غرب بمخرج بودواو، وحادث مرور على الطريق الوطني رقم 24 بالرغاية",
    region: "Alger",
    disposition: "incident_report",
    kinds: [["congestion"], ["collision"]],
  },
  {
    id: "past-example",
    message:
      "قبل سنة وقع حادث خطير في منعطف الشريعة بسبب السرعة المفرطة، احذروا عند المرور من هناك",
    region: "Blida",
    disposition: "general_information",
    kinds: [],
  },
];

type Arm = "gemini-2.5-flash" | `gpt-6-luna:${CodexEffort}`;
const ARMS: Arm[] = [
  "gemini-2.5-flash",
  "gpt-6-luna:none",
  "gpt-6-luna:low",
  "gpt-6-luna:medium",
];
let lastUsage: unknown;

function complete(arm: Arm) {
  return async (request: ChatRequest): Promise<string> => {
    if (arm === "gemini-2.5-flash")
      return (
        await completeWithOpenRouter(apiKey!, {
          ...(request as OpenRouterRequest),
          model: "google/gemini-2.5-flash",
        })
      ).content;
    const effort = arm.split(":")[1] as CodexEffort;
    const reply = await completeWithCodex("gpt-6-luna", request, lease!, {
      effort,
    });
    lastUsage = reply.usage;
    const used = Math.max(
      reply.usage.primaryUsed ?? 0,
      reply.usage.secondaryUsed ?? 0,
    );
    if (used >= STOP_AT_PERCENT) {
      console.error(
        `plan usage at ${used}%: stopping to protect the allowance`,
      );
      mkdirSync(OUT, { recursive: true });
      writeFileSync(
        `${OUT}/results.json`,
        JSON.stringify({ lastUsage, rows }, null, 1),
      );
      process.exit(2);
    }
    return reply.text;
  };
}

async function pipelineVerdict(
  mentions: LlmMention[],
  text: string,
  at: string,
): Promise<{ verdict: string; recorded: number; recordedLlm: number }> {
  let failure: string | null = null;
  let recorded = 0;
  let recordedLlm = 0;
  const store: TextSourceStore = {
    loadSource: async (key) => ({
      id: "eval",
      key,
      kind: "telegram_public",
      url: "https://t.me/s/DGPCDZ",
      authority_tier: "national",
      language: "ar",
      wilaya_id: null,
      template: "dgpc_bulletin",
    }),
    knownExternalIds: async () => new Set(),
    insertDocuments: async (rows) =>
      rows.map((r, i) => ({ id: `doc-${i}`, ...r })),
    loadGazetteer: async () => gazetteer,
    insertMentions: async (rows) => {
      recorded += rows.reduce((n, r) => n + r.fire_count, 0);
      recordedLlm += rows
        .filter((r) => r.extractor === "llm")
        .reduce((n, r) => n + r.fire_count, 0);
      return rows.map((r, i) => ({ id: `m-${i}`, ...r, inserted: true }));
    },
    openIncidents: async () => [],
    applyMention: async (id) => ({ id, applied: true }),
    pendingCount: async () => 0,
    listedIncidents: async () => [],
    markUnlisted: async () => {},
    confirmClusters: async (rows) => rows.length,
    retryableDocuments: async () => [],
    recordExtractionFailure: async (_id, message) => {
      failure = message;
    },
    clearExtractionFailure: async () => {},
    insertAdvice: async () => {},
  };
  await runTextSourceWith("dgpc_telegram", {
    now: () => new Date(Date.parse(at) + 3600_000),
    store,
    fetchPosts: async () => [
      {
        externalId: "eval",
        url: "https://t.me/DGPCDZ/0",
        publishedAt: at,
        text,
      },
    ],
    extractLlm: async () => ({ skipped: false, mentions }),
    readSituation: async () => {
      throw new Error("not a bulletin");
    },
  });
  return { verdict: failure ?? "accepted", recorded, recordedLlm };
}

type Row = Record<string, unknown> & {
  task: string;
  arm: Arm;
  run: number;
  id: string;
};
const recorded = RESCORE
  ? (JSON.parse(readFileSync(`${OUT}/results.json`, "utf8")) as {
      lastUsage: unknown;
      rows: Row[];
    })
  : null;
const rows: Row[] = recorded?.rows ?? [];
lastUsage = recorded?.lastUsage ?? null;
async function timed<T>(fn: () => Promise<T>) {
  const start = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - start };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message.slice(0, 200) : String(error),
      ms: Date.now() - start,
    };
  }
}

for (let run = 1; run <= (RESCORE ? 0 : RUNS); run++)
  for (const arm of ARMS) {
    const c = complete(arm);
    for (const b of bulletins) {
      const r = await timed(() =>
        extractMentionsWithLlm(
          { text: b.text, wilayaHint: null, language: "ar" },
          {
            apiKey,
            model: arm,
            complete: async (req) => ({ content: await c(req) }),
          },
        ),
      );
      const mentions =
        "value" in r && !r.value!.skipped ? r.value!.mentions : [];
      rows.push({
        task: "bulletin",
        arm,
        run,
        id: b.id,
        ms: r.ms,
        error: "error" in r ? r.error : null,
        fires: mentions.reduce((n, m) => n + m.count, 0),
        mentions,
      });
      console.log(
        "bulletin",
        arm,
        run,
        b.id,
        r.ms,
        "error" in r ? r.error : "",
      );
    }
    for (const p of ita) {
      const r = await timed(() =>
        extractItaReport(
          {
            id: "808412572528916_1511278197712051",
            uri: "traficalg",
            created_time: "2026-10-21T08:00:00+0000",
            message: p.message,
            region: p.region,
            type: [],
          },
          { apiKey, model: arm, complete: c },
        ),
      );
      const out = "value" in r ? r.value! : null;
      const kinds = out?.incidents.map((i) => i.kind) ?? [];
      const remaining = [...kinds];
      const kindsOk =
        kinds.length === p.kinds.length &&
        p.kinds.every((accepted) => {
          const at = remaining.findIndex((k) => accepted.includes(k));
          return at >= 0 && remaining.splice(at, 1).length === 1;
        });
      const statusOk =
        !p.status || out?.incidents.every((i) => i.current_status === p.status);
      rows.push({
        task: "ita",
        arm,
        run,
        id: p.id,
        ms: r.ms,
        error: "error" in r ? r.error : null,
        correct:
          !!out && out.disposition === p.disposition && kindsOk && !!statusOk,
        output: out,
      });
      console.log("ita", arm, run, p.id, r.ms, "error" in r ? r.error : "");
    }
  }

for (const r of rows.filter((r) => r.task === "bulletin")) {
  const b = bulletins.find((x) => x.id === r.id)!;
  Object.assign(
    r,
    r["error"]
      ? { verdict: "llm error", recorded: 0, recordedLlm: 0 }
      : await pipelineVerdict(r["mentions"] as LlmMention[], b.text, b.at),
  );
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const lines = [
  "| Arm | Run | Bulletins accepted by the pipeline | Fires the model read | Fires the pipeline records | of which from the model | Bulletin errors | ITA correct | ITA errors | Median s |",
  "|---|---|---|---|---|---|---|---|---|---|",
];
for (const arm of ARMS)
  for (let run = 1; run <= RUNS; run++) {
    const b = rows.filter(
      (r) => r.task === "bulletin" && r.arm === arm && r.run === run,
    );
    const i = rows.filter(
      (r) => r.task === "ita" && r.arm === arm && r.run === run,
    );
    lines.push(
      `| ${arm} | ${run} | ${b.filter((r) => r["verdict"] === "accepted").length}/${b.length} | ${b.reduce((n, r) => n + (r["fires"] as number), 0)} | ${b.reduce((n, r) => n + (r["recorded"] as number), 0)} | ${b.reduce((n, r) => n + (r["recordedLlm"] as number), 0)} | ${b.filter((r) => r["error"]).length} | ${i.filter((r) => r["correct"]).length}/${i.length} | ${i.filter((r) => r["error"]).length} | ${(median([...b, ...i].map((r) => r["ms"] as number)) / 1000).toFixed(1)} |`,
    );
  }
mkdirSync(OUT, { recursive: true });
writeFileSync(
  `${OUT}/results.json`,
  JSON.stringify({ lastUsage, rows }, null, 1),
);
writeFileSync(
  `${OUT}/summary.md`,
  `${lines.join("\n")}\n\nPlan usage after the run: ${JSON.stringify(lastUsage)}\n`,
);
console.log(lines.join("\n"));
