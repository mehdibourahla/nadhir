import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type DeviceLogin = {
  refresh_token: string;
  access_token?: string | undefined;
  id_token?: string | undefined;
  account_id: string;
};

// the auth.json a `codex login --device-auth` writes into its own CODEX_HOME
export function parseDeviceLogin(json: string, source: string): DeviceLogin {
  let tokens: Partial<DeviceLogin> | undefined;
  try {
    tokens = (JSON.parse(json) as { tokens?: Partial<DeviceLogin> }).tokens;
  } catch {
    throw new Error(`${source} is not a Codex login file`);
  }
  if (!tokens?.refresh_token || !tokens.account_id)
    throw new Error(
      `${source} holds no ChatGPT login (refresh_token, account_id)`,
    );
  return {
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    id_token: tokens.id_token,
    account_id: tokens.account_id,
  };
}

export function readDeviceLogin(home: string): {
  file: string;
  login: DeviceLogin;
} {
  // two holders of one grant race on refresh-token rotation and the login dies
  if (resolve(home) === resolve(homedir(), ".codex"))
    throw new Error("refusing ~/.codex: Nadhir needs its own device login");
  const file = join(home, "auth.json");
  let json: string;
  try {
    json = readFileSync(file, "utf8");
  } catch {
    throw new Error(`${file} is not readable`);
  }
  return { file, login: parseDeviceLogin(json, file) };
}
