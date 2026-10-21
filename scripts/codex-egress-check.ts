import {
  CodexUnavailable,
  completeWithCodex,
} from "../src/lib/llm/codex.server";
import { routeLogin } from "../src/lib/llm/subscription.server";

const url = process.env["NADHIR_APP_URL"];
const secret = process.env["NADHIR_CRON_SECRET"];
const model = process.env["CODEX_MODEL"] || "gpt-6-luna";
if (!url || !secret) {
  console.error("needs NADHIR_APP_URL and NADHIR_CRON_SECRET");
  process.exit(64);
}

const login = routeLogin(url, secret);
const lease = await login.lease();
if (lease.status !== "ready") {
  console.log(JSON.stringify({ ok: false, lease }));
  process.exit(1);
}
try {
  const reply = await completeWithCodex(
    model,
    {
      messages: [
        { role: "system", content: "Answer in the schema." },
        { role: "user", content: "Reply with ok." },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "egress_check",
          strict: true,
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
          },
        },
      },
    },
    lease,
    { effort: "none" },
  );
  const { pausedSeconds } = await login.report(lease.token, {
    ok: true,
    usage: reply.usage,
  });
  console.log(
    JSON.stringify({ ok: true, model, usage: reply.usage, pausedSeconds }),
  );
} catch (error) {
  if (!(error instanceof CodexUnavailable)) throw error;
  const { pausedSeconds } = await login.report(lease.token, {
    ok: false,
    reason: error.reason,
    status: error.status,
    retryAfter: error.retryAfter,
  });
  console.log(
    JSON.stringify({ ok: false, reason: error.reason, pausedSeconds }),
  );
  process.exit(1);
}
