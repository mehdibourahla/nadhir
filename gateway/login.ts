import { rmSync } from "node:fs";

import {
  parseDeviceLogin,
  readDeviceLogin,
  type DeviceLogin,
} from "../src/lib/llm/codex-device-login";
import { writeLogin } from "./token-file";

const source = process.argv[2];
const tokenFile =
  process.env["NADHIR_GATEWAY_TOKEN_FILE"] || "/token/login.json";
if (!source) {
  console.error(
    [
      "usage: bun gateway/login.ts <codex-home | ->",
      "",
      "1. export CODEX_HOME=$(mktemp -d) && codex login --device-auth",
      "2. bun gateway/login.ts $CODEX_HOME",
      "   or, into the container's volume:",
      "   docker compose run --rm -T gateway bun gateway/login.ts - < $CODEX_HOME/auth.json",
      "",
      "The login moves into NADHIR_GATEWAY_TOKEN_FILE (mode 600): from then on",
      "only this gateway may refresh it. Delete $CODEX_HOME afterwards.",
    ].join("\n"),
  );
  process.exit(64);
}

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  let login: DeviceLogin;
  let file: string | null = null;
  if (source === "-") login = parseDeviceLogin(await stdin(), "stdin");
  else ({ file, login } = readDeviceLogin(source));
  await writeLogin(tokenFile, login);
  if (file) rmSync(file);
  console.log(
    `wrote the login to ${tokenFile}${file ? ` and deleted ${file}` : ""}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "login failed");
  process.exit(65);
}
