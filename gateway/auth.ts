import { createHash, timingSafeEqual } from "node:crypto";

const CERTS_TTL_MS = 3_600_000;

export type AccessConfig = {
  clientId: string;
  // Access strips the service-token headers, so behind Access only the JWT can carry them
  clientSecret?: string | undefined;
  teamDomain?: string | undefined;
  audience?: string | undefined;
};

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function sameSecret(given: string | null, expected: string): boolean {
  // hashing first makes the comparison length-independent
  return timingSafeEqual(digest(given ?? ""), digest(expected)) && !!given;
}

function decodeSegment(segment: string): unknown {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
}

type Jwk = JsonWebKey & { kid?: string };

export function accessVerifier(
  config: AccessConfig,
  deps: { fetch?: typeof fetch; now?: () => number } = {},
) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const team = config.teamDomain?.replace(/^https:\/\//, "").replace(/\/$/, "");
  const audience = config.audience;
  const behindAccess = !!team && !!audience;
  if (!config.clientId || (!behindAccess && !config.clientSecret))
    throw new Error("Access service token is not configured");
  let certs: { keys: Map<string, CryptoKey>; at: number } | null = null;

  async function keys(): Promise<Map<string, CryptoKey>> {
    if (certs && now() - certs.at < CERTS_TTL_MS) return certs.keys;
    const res = await doFetch(`https://${team}/cdn-cgi/access/certs`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Access certs HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const map = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || jwk.kty !== "RSA") continue;
      map.set(
        jwk.kid,
        await crypto.subtle.importKey(
          "jwk",
          jwk,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        ),
      );
    }
    certs = { keys: map, at: now() };
    return map;
  }

  async function verifyJwt(token: string | null): Promise<boolean> {
    const parts = token?.split(".");
    if (!parts || parts.length !== 3) return false;
    const [head, body, signature] = parts as [string, string, string];
    let header: { alg?: string; kid?: string };
    let claims: {
      aud?: string | string[];
      iss?: string;
      exp?: number;
      nbf?: number;
      common_name?: string;
    };
    try {
      header = decodeSegment(head) as typeof header;
      claims = decodeSegment(body) as typeof claims;
    } catch {
      return false;
    }
    if (header.alg !== "RS256" || !header.kid) return false;
    let key = (await keys()).get(header.kid);
    if (!key && certs) {
      // a rotated key: refetch once
      certs = null;
      key = (await keys()).get(header.kid);
    }
    if (!key) return false;
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
      new TextEncoder().encode(`${head}.${body}`),
    );
    if (!valid) return false;
    const seconds = now() / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return (
      audiences.includes(audience) &&
      claims.iss === `https://${team}` &&
      typeof claims.exp === "number" &&
      claims.exp > seconds &&
      (claims.nbf === undefined || claims.nbf <= seconds + 60) &&
      sameSecret(claims.common_name ?? null, config.clientId)
    );
  }

  return async function authorized(headers: Headers): Promise<boolean> {
    if (behindAccess) {
      try {
        return await verifyJwt(headers.get("cf-access-jwt-assertion"));
      } catch {
        return false;
      }
    }
    // both compares always run, so a wrong id and a wrong secret take the same time
    const id = sameSecret(headers.get("cf-access-client-id"), config.clientId);
    const secret = sameSecret(
      headers.get("cf-access-client-secret"),
      config.clientSecret ?? "",
    );
    return id && secret;
  };
}
