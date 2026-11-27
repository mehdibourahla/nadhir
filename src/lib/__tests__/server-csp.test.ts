import { describe, expect, it } from "vitest";

import * as server from "@/server";

function build(url: string | undefined, dev = false): string {
  const builder = Reflect.get(server, "buildContentSecurityPolicy") as
    ((url: string | undefined, dev: boolean) => string) | undefined;
  expect(builder).toBeTypeOf("function");
  return builder?.(url, dev) ?? "";
}

describe("report photo content security policy", () => {
  it("allows only the normalized configured Supabase HTTPS origin", () => {
    const csp = build(
      "https://project-ref.supabase.co/storage/v1/object?ignored=true",
    );

    expect(csp).toContain(
      "img-src 'self' data: blob: https://*.cartocdn.com https://server.arcgisonline.com https://view.eumetsat.int https://project-ref.supabase.co",
    );
    expect(csp).not.toContain("/storage/v1/object");
    expect(csp).not.toContain("ignored=true");
  });

  it("allows a configured custom HTTPS origin without broadening to all HTTPS", () => {
    const csp = build("https://storage.example.dz/private/path");

    expect(csp).toContain("https://storage.example.dz");
    expect(csp).not.toMatch(/img-src[^;]*https:\s/);
  });

  it.each([
    "http://127.0.0.1:54821/storage/v1",
    "http://localhost:54321/storage/v1",
  ])("allows the exact configured local origin in development: %s", (url) => {
    const origin = new URL(url).origin;
    const csp = build(url, true);

    expect(csp).toContain(
      `img-src 'self' data: blob: https://*.cartocdn.com https://server.arcgisonline.com https://view.eumetsat.int ${origin}`,
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/plain,hello",
    "ftp://storage.example.dz/photo",
    "http://storage.example.dz/photo",
    "https://user:secret@storage.example.dz/photo",
    "not a URL",
  ])("does not reflect an unsafe configured URL: %s", (url) => {
    const csp = build(url, false);

    expect(csp).not.toContain(url);
    expect(csp).not.toContain("storage.example.dz");
  });

  it("retains the restrictive non-image directives", () => {
    const csp = build("https://project-ref.supabase.co");

    for (const directive of [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "worker-src 'self' blob:",
      "upgrade-insecure-requests",
    ]) {
      expect(csp).toContain(directive);
    }
  });

  it("permits Cloudflare Turnstile script, frame, and connect origins", () => {
    const csp = build("https://project-ref.supabase.co");

    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    );
    expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com");
    expect(csp).toMatch(
      /connect-src[^;]*https:\/\/challenges\.cloudflare\.com/,
    );
  });
});
