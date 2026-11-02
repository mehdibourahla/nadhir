import { accessVerifier } from "./auth";
import { createGateway } from "./gateway";
import { MAX_BODY_BYTES, PLAN_PAUSE_CEILING } from "./policy";
import { fileLogin, loginStatus } from "./token-file";

declare const Bun: {
  serve(options: {
    port: number;
    hostname: string;
    maxRequestBodySize: number;
    fetch: (request: Request) => Promise<Response>;
  }): { port: number };
};

const env = (name: string) => process.env[name] || undefined;
const tokenFile = env("NADHIR_GATEWAY_TOKEN_FILE") ?? "/token/login.json";

const handle = createGateway({
  model: env("NADHIR_GATEWAY_MODEL") ?? "gpt-6-luna",
  login: fileLogin(tokenFile, { usageCeiling: PLAN_PAUSE_CEILING }),
  status: () => loginStatus(tokenFile, Date.now()),
  authorized: accessVerifier({
    clientId: env("NADHIR_GATEWAY_ACCESS_CLIENT_ID") ?? "",
    clientSecret: env("NADHIR_GATEWAY_ACCESS_CLIENT_SECRET"),
    teamDomain: env("NADHIR_GATEWAY_ACCESS_TEAM_DOMAIN"),
    audience: env("NADHIR_GATEWAY_ACCESS_AUD"),
  }),
});

const server = Bun.serve({
  port: Number(env("NADHIR_GATEWAY_PORT") ?? 8080),
  hostname: "0.0.0.0",
  maxRequestBodySize: MAX_BODY_BYTES,
  fetch: (request) =>
    handle(request).catch(() =>
      Response.json({ reason: "upstream" }, { status: 502 }),
    ),
});
console.log(
  JSON.stringify({ message: "gateway listening", port: server.port }),
);
