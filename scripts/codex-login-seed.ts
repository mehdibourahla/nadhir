import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const home = process.argv[2];
if (!home) {
  console.error(
    [
      "usage: bun run scripts/codex-login-seed.ts <codex-home>",
      "",
      "1. export CODEX_HOME=$(mktemp -d) && codex login --device-auth",
      "2. bun run scripts/codex-login-seed.ts $CODEX_HOME",
      "",
      "The login is moved into the nadhir Worker secret CODEX_LOGIN_SEED and deleted",
      "here: from then on only the CodexLogin Durable Object may refresh it.",
    ].join("\n"),
  );
  process.exit(64);
}
// two holders of one grant race on refresh-token rotation and the login dies
if (resolve(home) === resolve(homedir(), ".codex")) {
  console.error("refusing ~/.codex: Nadhir needs its own device login");
  process.exit(65);
}

const file = join(home, "auth.json");
const tokens = (
  JSON.parse(readFileSync(file, "utf8")) as {
    tokens?: {
      refresh_token?: string;
      access_token?: string;
      id_token?: string;
      account_id?: string;
    };
  }
).tokens;
if (!tokens?.refresh_token || !tokens.account_id) {
  console.error(`${file} holds no ChatGPT login (refresh_token, account_id)`);
  process.exit(65);
}

const put = spawnSync(
  "bunx",
  ["wrangler", "secret", "put", "CODEX_LOGIN_SEED", "--name", "nadhir"],
  {
    input: JSON.stringify({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      id_token: tokens.id_token,
      account_id: tokens.account_id,
    }),
    stdio: ["pipe", "inherit", "inherit"],
  },
);
if (put.status !== 0) {
  console.error("wrangler secret put failed; the login file was kept");
  process.exit(put.status ?? 1);
}
rmSync(file);
console.log(`seeded CODEX_LOGIN_SEED and deleted ${file}`);
