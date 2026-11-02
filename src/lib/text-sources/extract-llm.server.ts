import { z } from "zod/v4";
import type { ChatRequest } from "@/lib/llm/codex.server";
import { completeWithGateway, GATEWAY_MODEL } from "@/lib/llm/gateway.server";

const KINDS = ["vegetation", "agricultural", "urban", "unknown"] as const;
const STATUSES = [
  "ongoing",
  "contained",
  "extinguished",
  "monitoring",
  "unknown",
] as const;

const MentionSchema = z.object({
  wilaya: z.string().nullable(),
  commune: z.string().nullable(),
  place: z.string().nullable(),
  kind: z.enum(KINDS),
  status: z.enum(STATUSES),
  count: z.number().int(),
  evidence: z.string(),
});

const ExtractionSchema = z.object({ mentions: z.array(MentionSchema) });

export type LlmMention = z.infer<typeof MentionSchema>;

// hand-written: strict mode rejects the minimum/maximum keywords zod emits
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    mentions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          wilaya: { type: ["string", "null"] },
          commune: { type: ["string", "null"] },
          place: { type: ["string", "null"] },
          kind: { type: "string", enum: [...KINDS] },
          status: { type: "string", enum: [...STATUSES] },
          count: { type: "integer" },
          evidence: { type: "string" },
        },
        required: [
          "wilaya",
          "commune",
          "place",
          "kind",
          "status",
          "count",
          "evidence",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["mentions"],
  additionalProperties: false,
} as const;

export type LlmExtractionInput = {
  text: string;
  wilayaHint: string | null;
  language: string;
};

export type LlmExtractionResult = { mentions: LlmMention[] };

export type LlmExtractionDependencies = {
  model: string;
  complete: (request: ChatRequest) => Promise<string>;
};

const SYSTEM = `You extract wildfire incident mentions from official Algerian civil-protection or forestry posts.
Return only what the post states. Every mention must quote its evidence verbatim from the post.
One mention per named fire location. Do not infer locations that are not written. Ignore urban, vehicle and industrial fires (kind "urban").
Statuses: ongoing (operations continuing), contained (under control / regressing), extinguished (put out), monitoring (guarding, mopping up), unknown.
Kinds: vegetation (forest, scrub, maquis), agricultural (crops, hay, orchards, palm groves), urban, unknown.
Leave commune null when only a locality or a wilaya is named. place is a named locality, never a generic setting or vegetation type: forest, palm grove (واحة نخيل), crops and hay are kinds, so leave place null unless an actual place name follows. A wilaya distribution line such as ولاية بسكرة 01 (حريق واحة نخيل) is one agricultural fire in that wilaya with commune and place null. Names stay in the post's language and spelling. count is the number of fires the sentence attributes to that location, at least 1.`;

// cheaper models sometimes wrap the object in a markdown fence despite the schema
export function stripFence(content: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(content);
  return m ? m[1]! : content;
}

export const LLM_TIMEOUT_MS = 45_000;

function defaultDependencies(): LlmExtractionDependencies {
  return {
    model: GATEWAY_MODEL,
    complete: (request) =>
      completeWithGateway("extract_dgpc", request, {
        timeoutMs: LLM_TIMEOUT_MS,
      }),
  };
}

export async function extractMentionsWithLlm(
  input: LlmExtractionInput,
  deps: LlmExtractionDependencies = defaultDependencies(),
): Promise<LlmExtractionResult> {
  const hint = input.wilayaHint
    ? `The post is filed under wilaya "${input.wilayaHint}"; use it only when the sentence names no other wilaya.\n`
    : "";
  const content = await deps.complete({
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `${hint}Language: ${input.language}\n<post>\n${input.text}\n</post>`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "fire_mentions",
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    },
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(content));
  } catch {
    throw new Error("llm extraction returned non-JSON content");
  }
  const result = ExtractionSchema.safeParse(parsed);
  if (!result.success)
    throw new Error(
      `llm extraction returned an unexpected shape: ${result.error.message.slice(0, 200)}`,
    );
  if (
    result.data.mentions.some(
      (m) => !m.evidence.length || !input.text.includes(m.evidence),
    )
  )
    throw new Error("llm extraction contains unsupported evidence");
  const mentions = result.data.mentions.map((m) => ({
    ...m,
    count: Math.max(1, m.count),
  }));
  return { mentions };
}
