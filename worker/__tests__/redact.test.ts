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
});
