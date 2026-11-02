import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

import {
  readDeviceLogin,
  type DeviceLogin,
} from "../src/lib/llm/codex-device-login";

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
let file: string;
let tokens: DeviceLogin;
try {
  ({ file, login: tokens } = readDeviceLogin(home));
} catch (error) {
  console.error((error as Error).message);
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
