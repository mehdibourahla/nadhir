import { describe, expect, it, vi } from "vitest";

import { accessVerifier, sameSecret } from "../auth";

const NOW = Date.UTC(2026, 10, 2, 12);
const TEAM = "nadhir.cloudflareaccess.com";
const AUD = "aud-tag";
const CREDS = { clientId: "id-1.access", clientSecret: "secret-1" };

const headers = (values: Record<string, string>) => new Headers(values);
const service = {
  "cf-access-client-id": CREDS.clientId,
  "cf-access-client-secret": CREDS.clientSecret,
};

const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(bytes).toString("base64url");

async function signer() {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    kid: "k1",
  };
  const fetch = vi.fn(async (url: string) => {
    expect(url).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
    return Response.json({ keys: [jwk] });
  });
  const sign = async (
    claims: Record<string, unknown>,
    header: Record<string, unknown> = { alg: "RS256", kid: "k1" },
  ) => {
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(input),
    );
    return `${input}.${b64url(new Uint8Array(signature))}`;
  };
  return { fetch, sign };
}

const valid = {
  aud: [AUD],
  iss: `https://${TEAM}`,
  exp: NOW / 1000 + 300,
  nbf: NOW / 1000 - 10,
};

describe("service token", () => {
  it("refuses to start without one", () => {
    expect(() => accessVerifier({ clientId: "", clientSecret: "" })).toThrow();
  });

  it.each([
    ["no headers", {}],
    ["the id alone", { "cf-access-client-id": CREDS.clientId }],
    ["a wrong secret", { ...service, "cf-access-client-secret": "secret-2" }],
    ["a wrong id", { ...service, "cf-access-client-id": "id-2.access" }],
    ["a secret prefix", { ...service, "cf-access-client-secret": "secret" }],
  ])("rejects %s", async (_name, values) => {
    expect(await accessVerifier(CREDS)(headers(values))).toBe(false);
  });

  it("accepts the configured pair", async () => {
    expect(await accessVerifier(CREDS)(headers(service))).toBe(true);
  });

  it("compares without short-circuiting on length", () => {
    expect(sameSecret("a", "a")).toBe(true);
    expect(sameSecret("a", "ab")).toBe(false);
    expect(sameSecret(null, "a")).toBe(false);
    expect(sameSecret("", "")).toBe(false);
  });
});

describe("Access JWT", () => {
  it("is required once a team domain and audience are configured", async () => {
    const { fetch, sign } = await signer();
    const verify = accessVerifier(
      { ...CREDS, teamDomain: TEAM, audience: AUD },
      { fetch: fetch as never, now: () => NOW },
    );
    expect(await verify(headers(service))).toBe(false);
    expect(
      await verify(
        headers({ ...service, "cf-access-jwt-assertion": await sign(valid) }),
      ),
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["another audience", { ...valid, aud: ["other"] }, undefined],
    [
      "another issuer",
      { ...valid, iss: "https://evil.cloudflareaccess.com" },
      undefined,
    ],
    ["an expired token", { ...valid, exp: NOW / 1000 - 1 }, undefined],
    ["a future token", { ...valid, nbf: NOW / 1000 + 600 }, undefined],
    ["an unknown key", valid, { alg: "RS256", kid: "k9" }],
    ["alg none", valid, { alg: "none", kid: "k1" }],
  ])("rejects %s", async (_name, claims, header) => {
    const { fetch, sign } = await signer();
    const verify = accessVerifier(
      { ...CREDS, teamDomain: TEAM, audience: AUD },
      { fetch: fetch as never, now: () => NOW },
    );
    const token = await sign(claims, header);
    expect(
      await verify(headers({ ...service, "cf-access-jwt-assertion": token })),
    ).toBe(false);
  });

  it("rejects a tampered payload and a valid JWT without the service token", async () => {
    const { fetch, sign } = await signer();
    const verify = accessVerifier(
      { ...CREDS, teamDomain: TEAM, audience: AUD },
      { fetch: fetch as never, now: () => NOW },
    );
    const token = await sign(valid);
    const [head, , signature] = token.split(".");
    const forged = `${head}.${b64url(JSON.stringify({ ...valid, aud: [AUD, "x"] }))}.${signature}`;
    expect(
      await verify(headers({ ...service, "cf-access-jwt-assertion": forged })),
    ).toBe(false);
    expect(await verify(headers({ "cf-access-jwt-assertion": token }))).toBe(
      false,
    );
  });

  it("fails closed when the certs cannot be fetched", async () => {
    const verify = accessVerifier(
      { ...CREDS, teamDomain: TEAM, audience: AUD },
      {
        fetch: (async () => {
          throw new TypeError("offline");
        }) as never,
        now: () => NOW,
      },
    );
    expect(
      await verify(
        headers({
          ...service,
          "cf-access-jwt-assertion": `${b64url(JSON.stringify({ alg: "RS256", kid: "k1" }))}.${b64url("{}")}.c2ln`,
        }),
      ),
    ).toBe(false);
  });
});
