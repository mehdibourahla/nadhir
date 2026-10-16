import type { FcmTarget, FcmUserMessage } from "@/lib/fcm";

const SCOPE =
  "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/cloud-platform";
const TOKEN_TTL_MS = 50 * 60_000;

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
};

function serviceAccount(): ServiceAccount | null {
  const raw = process.env["FIREBASE_SERVICE_ACCOUNT"];
  if (!raw) return null;
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key)
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing required fields");
  return parsed;
}

export function fcmConfigured(): boolean {
  return Boolean(process.env["FIREBASE_SERVICE_ACCOUNT"]);
}

const b64url = (bytes: Uint8Array | string): string => {
  const bin = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function signJwt(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: account.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = account.private_key
    .replace(/-----[A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${b64url(new Uint8Array(signature))}`;
}

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const jwt = await signJwt(account);
  const res = await fetch(account.token_uri, {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  cached = { token: body.access_token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return body.access_token;
}

function requireAccount(): ServiceAccount {
  const account = serviceAccount();
  if (!account) throw new Error("FIREBASE_SERVICE_ACCOUNT not configured");
  return account;
}

export type FcmDeviceTest = {
  token: string;
  notification: { title: string; body: string };
  webpush: { headers: { TTL: string }; fcm_options: { link: string } };
  data: { kind: "test"; test_id: string; receipt: string };
};

export async function fcmSend(
  message: FcmTarget | FcmUserMessage | FcmDeviceTest,
): Promise<void> {
  const account = requireAccount();
  const token = await accessToken(account);
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      signal: AbortSignal.timeout(15_000),
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message }),
    },
  );
  // a topic nobody subscribed yet is not a failure; aborting here would
  // re-send the row's earlier topics next run as duplicates
  if (res.status === 404 && ("topic" in message || "condition" in message))
    return;
  if (!res.ok) throw new Error(`fcm send failed (${res.status})`);
}

export async function fcmSubscribeTopics(
  registrationToken: string,
  topics: string[],
  add: boolean,
): Promise<void> {
  const account = requireAccount();
  const token = await accessToken(account);
  for (const topic of topics) {
    const res = await fetch(
      `https://iid.googleapis.com/iid/v1:${add ? "batchAdd" : "batchRemove"}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          access_token_auth: "true",
        },
        body: JSON.stringify({
          to: `/topics/${topic}`,
          registration_tokens: [registrationToken],
        }),
      },
    );
    const action = add ? "subscribe" : "unsubscribe";
    if (!res.ok)
      throw new Error(`topic ${action} failed (${res.status}) for ${topic}`);

    // the batch endpoint answers 200 and reports a rejected token inside
    // results[]; trusting res.ok alone tells a subscriber they are subscribed
    const body = (await res.json().catch(() => null)) as {
      results?: { error?: string }[];
    } | null;
    const failure = body?.results?.find((r) => r.error)?.error;
    if (failure)
      throw new Error(`topic ${action} rejected for ${topic}: ${failure}`);
  }
}
