import { describe, expect, it } from "vitest";

import { createWorkerLogger, redactText, sanitizeValue } from "../src/redact";

describe("worker log redaction", () => {
  it("redacts bearer tokens, supabase keys, API keys, JWTs, URL credentials, cookies, and custom secrets", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig12345";
    const input = [
      "Authorization: Bearer tok_super_secret",
      "sb_secret_abc123def",
      "sb_publishable_xyz987",
      "sk-ant-api03-secret999",
      "sk-mistral1234567890",
      jwt,
      "https://postgres:superpass@db.internal:5432/postgres",
      "Cookie: c_user=12345; xs=secret",
      "my-extra-secret-value",
    ].join(" ");

    const redacted = redactText(input, ["my-extra-secret-value"]);
    for (const leaked of [
      "tok_super_secret",
      "sb_secret_abc123def",
      "sb_publishable_xyz987",
      "sk-ant-api03-secret999",
      "sk-mistral1234567890",
      "sig12345",
      "superpass",
      "c_user=12345",
      "my-extra-secret-value",
    ]) {
      expect(redacted).not.toContain(leaked);
    }
  });

  it("redacts sensitive object keys and emits clean JSON via createWorkerLogger", () => {
    const lines: string[] = [];
    const logger = createWorkerLogger(["service-role-xyz"], {
      error: (line) => lines.push(line),
    });

    logger("error", "job failed with service-role-xyz", {
      jobId: "job-1",
      authorization: "Bearer raw-token",
      cookie: "session=abc",
      prompt: "private citizen text",
      nested: { apiKey: "sk-nested-12345678", ok: true },
      error: new Error("failed Bearer leaked123"),
    });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.message).not.toContain("service-role-xyz");
    expect(parsed.authorization).toBe("[REDACTED]");
    expect(parsed.cookie).toBe("[REDACTED]");
    expect(parsed.prompt).toBe("[REDACTED]");
    expect(parsed.nested).toEqual({ apiKey: "[REDACTED]", ok: true });
    expect(parsed.error.message).not.toContain("leaked123");
    expect(sanitizeValue("a".repeat(500))).toMatch(/\.\.\.$/);
  });

  it("redacts all cookies on multi-cookie lines, x-api-key, cf-access-client-secret, Authorization Basic, and chain API keys", () => {
    const cookieLine =
      "Cookie: locale=ar; session_id=SUPER_SECRET_SESSION_999; xs=FB_COOKIE_SECRET_888";
    const redactedCookie = redactText(cookieLine);
    expect(redactedCookie).toBe("Cookie: [REDACTED]");
    expect(redactedCookie).not.toContain("SUPER_SECRET_SESSION_999");
    expect(redactedCookie).not.toContain("FB_COOKIE_SECRET_888");

    const setCookieLine =
      "Set-Cookie: sid=SECRET_A; Path=/; HttpOnly; token=SECRET_B\nnext=safe";
    const redactedSetCookie = redactText(setCookieLine);
    expect(redactedSetCookie).toContain("Set-Cookie: [REDACTED]\nnext=safe");
    expect(redactedSetCookie).not.toContain("SECRET_A");
    expect(redactedSetCookie).not.toContain("SECRET_B");

    const headersLine =
      "x-api-key: raw_anthropic_key_12345 Authorization: Basic dXNlcjpwYXNz cf-access-client-secret: cf_sec_99999 Basic check ok";
    const redactedHeaders = redactText(headersLine);
    expect(redactedHeaders).not.toContain("raw_anthropic_key_12345");
    expect(redactedHeaders).not.toContain("dXNlcjpwYXNz");
    expect(redactedHeaders).not.toContain("cf_sec_99999");
    expect(redactedHeaders).toContain("Basic check ok");

    const lines: string[] = [];
    const logger = createWorkerLogger(
      ["m1str4l_EU_prod_key_998877665544", "firebase_private_key_blob"],
      { error: (line) => lines.push(line) },
    );
    logger("error", "fallback auth failed", {
      detail:
        "key=m1str4l_EU_prod_key_998877665544 sa=firebase_private_key_blob",
    });
    expect(lines[0]).not.toContain("m1str4l_EU_prod_key_998877665544");
    expect(lines[0]).not.toContain("firebase_private_key_blob");
  });
});
