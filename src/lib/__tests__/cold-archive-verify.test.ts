import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { COLD_TABLES, sha256 } from "../cold-archive";
import {
  assertLoopbackDatabaseUrl,
  assertLoopbackHttpUrl,
  buildDuckdbPgEnv,
  canonicalizeJsonValue,
  COLD_TABLE_CONFIG,
  compareCLocale,
  computeColdCutoff,
  computeKeyDigest,
  isDayEligibleForArchive,
  isIsoDay,
  parseVerifyColdArchiveArgs,
  readBackCanonicalNdjson,
  resolveVerifyMode,
  serializeCanonicalNdjson,
  shiftUtcDay,
  stripIpv6Brackets,
  verifyExportArtifact,
} from "../cold-archive-verify";

describe("cold-archive-verify cutoff math", () => {
  it("registers all 6 cold tables with 90d retention (92d for source_jobs)", () => {
    expect(Object.keys(COLD_TABLE_CONFIG)).toEqual([...COLD_TABLES]);
    expect(COLD_TABLE_CONFIG.weather_snapshots).toEqual({
      dayColumn: "scheduled_at",
      hotDays: 90,
    });
    expect(COLD_TABLE_CONFIG.risk_forecasts).toEqual({
      dayColumn: "created_at",
      hotDays: 90,
    });
    expect(COLD_TABLE_CONFIG.broadcast_audit).toEqual({
      dayColumn: "at",
      hotDays: 90,
    });
    expect(COLD_TABLE_CONFIG.airport_observations).toEqual({
      dayColumn: "observed_at",
      hotDays: 90,
    });
    expect(COLD_TABLE_CONFIG.source_runs).toEqual({
      dayColumn: "started_at",
      hotDays: 90,
    });
    expect(COLD_TABLE_CONFIG.source_jobs).toEqual({
      dayColumn: "created_at",
      hotDays: 92,
    });
  });

  it("computes exact 2026-11-26 cutoff boundaries across all 6 tables", () => {
    for (const table of COLD_TABLES) {
      const cutoff = computeColdCutoff(table, "2026-11-26");
      if (table === "source_jobs") {
        expect(cutoff).toEqual({
          table: "source_jobs",
          asOfDay: "2026-11-26",
          hotDays: 92,
          firstHotDay: "2026-08-26",
          lastEligibleDay: "2026-08-25",
        });
        expect(isDayEligibleForArchive(table, "2026-08-25", "2026-11-26")).toBe(
          true,
        );
        expect(isDayEligibleForArchive(table, "2026-08-26", "2026-11-26")).toBe(
          false,
        );
      } else {
        expect(cutoff).toEqual({
          table,
          asOfDay: "2026-11-26",
          hotDays: 90,
          firstHotDay: "2026-08-28",
          lastEligibleDay: "2026-08-27",
        });
        expect(isDayEligibleForArchive(table, "2026-08-27", "2026-11-26")).toBe(
          true,
        );
        expect(isDayEligibleForArchive(table, "2026-08-28", "2026-11-26")).toBe(
          false,
        );
      }
    }
  });

  it("computes exact 2026-11-27 follow-on cutoff boundaries across all 6 tables", () => {
    for (const table of COLD_TABLES) {
      const cutoff = computeColdCutoff(table, "2026-11-27");
      if (table === "source_jobs") {
        expect(cutoff.lastEligibleDay).toBe("2026-08-26");
        expect(cutoff.firstHotDay).toBe("2026-08-27");
        expect(isDayEligibleForArchive(table, "2026-08-26", "2026-11-27")).toBe(
          true,
        );
        expect(isDayEligibleForArchive(table, "2026-08-27", "2026-11-27")).toBe(
          false,
        );
      } else {
        expect(cutoff.lastEligibleDay).toBe("2026-08-28");
        expect(cutoff.firstHotDay).toBe("2026-08-29");
        expect(isDayEligibleForArchive(table, "2026-08-28", "2026-11-27")).toBe(
          true,
        );
        expect(isDayEligibleForArchive(table, "2026-08-29", "2026-11-27")).toBe(
          false,
        );
      }
    }
  });

  it("handles leap years, month/year rollovers, and rejects invalid calendar dates", () => {
    expect(isIsoDay("2024-02-29")).toBe(true);
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("2026-13-01")).toBe(false);
    expect(isIsoDay("2026-00-10")).toBe(false);
    expect(isIsoDay("2026-11-26; drop table x")).toBe(false);

    expect(shiftUtcDay("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftUtcDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftUtcDay("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftUtcDay("2026-12-31", 1)).toBe("2027-01-01");

    expect(() => shiftUtcDay("2026-02-30", -1)).toThrow(/Invalid ISO UTC day/);
    expect(() => shiftUtcDay("2026-11-26", 1.5)).toThrow(/integer/);
    expect(() => computeColdCutoff("broadcast_audit", "2026-02-29")).toThrow(
      /Invalid asOfDay/,
    );
    expect(() =>
      isDayEligibleForArchive("broadcast_audit", "not-a-day", "2026-11-26"),
    ).toThrow(/Invalid day/);
  });
});

describe("cold-archive-verify C-locale sorting & key_digest", () => {
  it("returns null for an empty ID list", () => {
    expect(computeKeyDigest([])).toBeNull();
  });

  it("matches Postgres COLLATE 'C' UTF-8 byte order and lowercase MD5", () => {
    // In UTF-8 / COLLATE "C": '-' (0x2D) < '0' (0x30) < 'A' (0x41) < '_' (0x5F) < 'a' (0x61)
    // Whereas JS localeCompare often puts '_' before 'A' or 'a' before 'A'.
    const tokens = ["a_id", "A_id", "_id", "-id", "0_id"];
    const sorted = [...tokens].sort(compareCLocale);
    expect(sorted).toEqual(["-id", "0_id", "A_id", "_id", "a_id"]);

    const expectedHash = createHash("md5")
      .update("-id,0_id,A_id,_id,a_id", "utf8")
      .digest("hex");
    expect(computeKeyDigest(tokens)).toBe(expectedHash);
  });

  it("produces identical digest regardless of input UUID order", () => {
    const id1 = "30000000-0000-4000-8000-000000000001";
    const id2 = "30000000-0000-4000-8000-00000000000a";
    const id3 = "10000000-0000-4000-8000-0000000000ff";
    const expected = createHash("md5")
      .update(`${id3},${id1},${id2}`, "utf8")
      .digest("hex");

    expect(computeKeyDigest([id1])).toBe(
      createHash("md5").update(id1, "utf8").digest("hex"),
    );
    expect(computeKeyDigest([id2, id1, id3])).toBe(expected);
    expect(computeKeyDigest([id3, id2, id1])).toBe(expected);
  });
});

describe("cold-archive-verify canonical NDJSON export & verification", () => {
  it("serializes deterministically regardless of row order or object key insertion order", () => {
    const rowsA = [
      {
        id: "b-2",
        meta: { z: 1, a: true },
        ts: new Date("2026-08-27T06:00:00Z"),
        count: 5n,
      },
      {
        id: "a-1",
        meta: { b: [2, 1], a: null },
        raw: new Uint8Array([1, 2, 3]),
      },
    ];
    const rowsB = [
      {
        raw: new Uint8Array([1, 2, 3]),
        meta: { a: null, b: [2, 1] },
        id: "a-1",
      },
      {
        count: 5n,
        ts: new Date("2026-08-27T06:00:00Z"),
        meta: { a: true, z: 1 },
        id: "b-2",
      },
    ];

    const bytesA = serializeCanonicalNdjson(rowsA);
    const bytesB = serializeCanonicalNdjson(rowsB);
    expect(Buffer.compare(bytesA, bytesB)).toBe(0);
    expect(sha256(bytesA)).toBe(sha256(bytesB));

    const summary = readBackCanonicalNdjson(bytesA);
    expect(summary).toEqual({
      rows: 2,
      digest: computeKeyDigest(["a-1", "b-2"]),
    });

    const verified = verifyExportArtifact(bytesA, sha256(bytesA), summary);
    expect(verified.summary).toEqual(summary);
  });

  it("handles empty row arrays and canonicalizes nested values", () => {
    const emptyBytes = serializeCanonicalNdjson([]);
    expect(emptyBytes.byteLength).toBe(0);
    expect(readBackCanonicalNdjson(emptyBytes)).toEqual({
      rows: 0,
      digest: null,
    });
    expect(canonicalizeJsonValue({ b: 1, a: undefined, c: 2n })).toEqual({
      b: 1,
      c: "2",
    });
  });

  it("preserves __proto__ keys without mutating prototype, handles invalid Date and shared refs, and rejects circular refs", () => {
    const withProto = JSON.parse(
      '{"__proto__":{"polluted":true},"a":1,"constructor":"ctor"}',
    ) as Record<string, unknown>;
    const canonical = canonicalizeJsonValue(withProto) as Record<
      string,
      unknown
    >;
    expect(Object.getPrototypeOf(canonical)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(canonical, "__proto__")).toBe(
      true,
    );
    expect(JSON.stringify(canonical)).toBe(
      '{"__proto__":{"polluted":true},"a":1,"constructor":"ctor"}',
    );

    // Invalid Date matches JSON.stringify -> null
    expect(canonicalizeJsonValue(new Date("not-a-date"))).toBeNull();
    expect(
      JSON.stringify(canonicalizeJsonValue({ bad: new Date("invalid") })),
    ).toBe('{"bad":null}');

    // Shared non-circular references serialize cleanly
    const shared = { y: 2, x: 1 };
    expect(
      JSON.stringify(canonicalizeJsonValue({ first: shared, second: shared })),
    ).toBe('{"first":{"x":1,"y":2},"second":{"x":1,"y":2}}');

    // Circular object and array references throw a clean error
    const circularObj: Record<string, unknown> = { a: 1 };
    circularObj["self"] = circularObj;
    expect(() => canonicalizeJsonValue(circularObj)).toThrow(
      /Circular reference/,
    );

    const circularArr: unknown[] = [];
    circularArr.push(circularArr);
    expect(() => canonicalizeJsonValue(circularArr)).toThrow(
      /Circular reference/,
    );
  });

  it("detects SHA-256 tampering, ID tampering, missing/extra rows, invalid UTF-8, and malformed JSON", () => {
    const rows = [
      { id: "id-1", value: "alpha" },
      { id: "id-2", value: "beta" },
    ];
    const bytes = serializeCanonicalNdjson(rows);
    const goodHash = sha256(bytes);
    const goodSummary = readBackCanonicalNdjson(bytes);

    // Flipped byte -> SHA-256 mismatch
    const tamperedBytes = new Uint8Array(bytes);
    tamperedBytes[tamperedBytes.length - 2] =
      (tamperedBytes[tamperedBytes.length - 2] ?? 0) ^ 1;
    expect(() =>
      verifyExportArtifact(tamperedBytes, goodHash, goodSummary),
    ).toThrow(/SHA-256 mismatch/);

    // Modified ID with matching SHA-256 -> digest mismatch
    const wrongIdBytes = serializeCanonicalNdjson([
      { id: "id-1", value: "alpha" },
      { id: "id-9", value: "beta" },
    ]);
    expect(() =>
      verifyExportArtifact(wrongIdBytes, sha256(wrongIdBytes), goodSummary),
    ).toThrow(/Summary mismatch/);

    // Extra row with matching SHA-256 -> row count mismatch
    const extraRowBytes = serializeCanonicalNdjson([
      ...rows,
      { id: "id-3", value: "gamma" },
    ]);
    expect(() =>
      verifyExportArtifact(extraRowBytes, sha256(extraRowBytes), goodSummary),
    ).toThrow(/Summary mismatch/);

    // Invalid UTF-8 bytes
    expect(() =>
      readBackCanonicalNdjson(new Uint8Array([0xff, 0xfe, 0xfd])),
    ).toThrow();

    // Malformed JSON
    expect(() =>
      readBackCanonicalNdjson(new TextEncoder().encode("{not-json\n")),
    ).toThrow(/Malformed JSON/);

    // Non-object JSON or missing id
    expect(() =>
      readBackCanonicalNdjson(new TextEncoder().encode("[1,2,3]\n")),
    ).toThrow(/not a JSON object/);
    expect(() =>
      readBackCanonicalNdjson(new TextEncoder().encode('{"no_id":1}\n')),
    ).toThrow(/missing a non-empty string id/);

    // UTF-8 BOM-only, BOM-prefixed, and CRLF payloads
    expect(() =>
      readBackCanonicalNdjson(new Uint8Array([0xef, 0xbb, 0xbf])),
    ).toThrow(/UTF-8 BOM/);
    const bomPrefixed = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('{"id":"a"}\n'),
    ]);
    expect(() => readBackCanonicalNdjson(bomPrefixed)).toThrow(/UTF-8 BOM/);
    expect(() =>
      readBackCanonicalNdjson(new TextEncoder().encode('{"id":"a"}\r\n')),
    ).toThrow(/LF line endings/);
  });
});

describe("cold-archive-verify loopback-only URL guards", () => {
  it("accepts loopback HTTP and Postgres URLs including whitespace-padded and IPv6 loopback", () => {
    expect(
      assertLoopbackHttpUrl("http://127.0.0.1:54321", "SUPABASE_URL").hostname,
    ).toBe("127.0.0.1");
    expect(
      assertLoopbackHttpUrl("https://localhost:54321", "SUPABASE_URL").hostname,
    ).toBe("localhost");
    expect(
      assertLoopbackHttpUrl("http://[::1]:54321", "SUPABASE_URL").hostname,
    ).toBe("[::1]");
    expect(
      assertLoopbackHttpUrl(
        "http://127.0.0.1:54321/path@segment",
        "SUPABASE_URL",
      ).hostname,
    ).toBe("127.0.0.1");

    expect(
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "DATABASE_URL",
      ).hostname,
    ).toBe("127.0.0.1");
    expect(
      assertLoopbackDatabaseUrl(
        "  postgresql://postgres:postgres@127.0.0.1:54322/postgres  ",
        "DATABASE_URL",
      ).hostname,
    ).toBe("127.0.0.1");
    expect(
      assertLoopbackDatabaseUrl(
        "postgres://postgres:postgres@localhost:54322/postgres?host=127.0.0.1",
        "DATABASE_URL",
      ).hostname,
    ).toBe("localhost");
    expect(
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@[::1]:54322/postgres",
        "DATABASE_URL",
      ).hostname,
    ).toBe("[::1]");
  });

  it("rejects remote hosts, 0.0.0.0, embedded/empty HTTP credentials, libpq override params, and multi-host URLs", () => {
    expect(() =>
      assertLoopbackHttpUrl(
        "https://kuukthyenirwgdfkltlm.supabase.co",
        "SUPABASE_URL",
      ),
    ).toThrow(/local loopback host/);
    expect(() =>
      assertLoopbackHttpUrl("http://0.0.0.0:54321", "SUPABASE_URL"),
    ).toThrow(/local loopback host/);
    expect(() =>
      assertLoopbackHttpUrl("http://127.0.0.1.evil.com", "SUPABASE_URL"),
    ).toThrow(/local loopback host/);
    expect(() =>
      assertLoopbackHttpUrl("http://user:pass@127.0.0.1:54321", "SUPABASE_URL"),
    ).toThrow(/embed credentials/);
    expect(() =>
      assertLoopbackHttpUrl("http://:@127.0.0.1:54321", "SUPABASE_URL"),
    ).toThrow(/embed credentials/);
    expect(() =>
      assertLoopbackHttpUrl("http://@127.0.0.1:54321", "SUPABASE_URL"),
    ).toThrow(/embed credentials/);
    expect(() =>
      assertLoopbackHttpUrl("ftp://127.0.0.1:21", "SUPABASE_URL"),
    ).toThrow(/http: or https:/);

    expect(() =>
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:pw@db.prod.supabase.co:5432/postgres",
        "DATABASE_URL",
      ),
    ).toThrow(/local loopback host/);
    expect(() =>
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@0.0.0.0:54322/postgres",
        "DATABASE_URL",
      ),
    ).toThrow(/local loopback host/);
    expect(() =>
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=db.prod.supabase.co",
        "DATABASE_URL",
      ),
    ).toThrow(/query parameter host/);
    expect(() =>
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres?hostaddr=10.0.0.5",
        "DATABASE_URL",
      ),
    ).toThrow(/query parameter hostaddr/);
    expect(() =>
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres?service=prod",
        "DATABASE_URL",
      ),
    ).toThrow(/query parameter service is forbidden/);
    expect(() =>
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres?SERVICE=prod",
        "DATABASE_URL",
      ),
    ).toThrow(/query parameter SERVICE is forbidden/);
    expect(() =>
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres?servicefile=/tmp/pg_service.conf",
        "DATABASE_URL",
      ),
    ).toThrow(/query parameter servicefile is forbidden/);
    expect(() =>
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres?passfile=/tmp/pgpass",
        "DATABASE_URL",
      ),
    ).toThrow(/query parameter passfile is forbidden/);
    expect(() =>
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslrootcert=/tmp/ca.crt",
        "DATABASE_URL",
      ),
    ).toThrow(/query parameter sslrootcert is forbidden/);
    expect(() =>
      assertLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:54322,db.prod.supabase.co:5432/postgres",
        "DATABASE_URL",
      ),
    ).toThrow(/single loopback host|valid URL/);
    expect(() =>
      assertLoopbackDatabaseUrl("http://127.0.0.1:54322/postgres", "DB"),
    ).toThrow(/postgres: or postgresql:/);
  });

  it("strips IPv6 brackets and builds a sanitized DuckDB libpq env", () => {
    expect(stripIpv6Brackets("[::1]")).toBe("::1");
    expect(stripIpv6Brackets("::1")).toBe("::1");
    expect(stripIpv6Brackets("127.0.0.1")).toBe("127.0.0.1");
    expect(stripIpv6Brackets("localhost")).toBe("localhost");

    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      PGHOSTADDR: "10.0.0.99",
      PGSERVICE: "prod",
      PGSERVICEFILE: "/etc/pg_service.conf",
      PGPASSFILE: "/home/user/.pgpass",
      PGOPTIONS: "-c statement_timeout=1",
      PGSSLROOTCERT: "/etc/ssl/root.crt",
      PGSSLMODE: "verify-full",
    };
    const readerUrl = assertLoopbackDatabaseUrl(
      "postgresql://cold_reader@[::1]:54322/nadhir",
      "READER_DB",
    );
    const sanitized = buildDuckdbPgEnv(baseEnv, readerUrl, "ephemeral-secret");

    expect(sanitized["PATH"]).toBe("/usr/bin");
    expect(sanitized["PGHOST"]).toBe("::1");
    expect(sanitized["PGPORT"]).toBe("54322");
    expect(sanitized["PGUSER"]).toBe("cold_reader");
    expect(sanitized["PGPASSWORD"]).toBe("ephemeral-secret");
    expect(sanitized["PGDATABASE"]).toBe("nadhir");
    expect(sanitized["PGSSLMODE"]).toBe("disable");

    expect("PGHOSTADDR" in sanitized).toBe(false);
    expect("PGSERVICE" in sanitized).toBe(false);
    expect("PGSERVICEFILE" in sanitized).toBe(false);
    expect("PGPASSFILE" in sanitized).toBe(false);
    expect("PGOPTIONS" in sanitized).toBe(false);
    expect("PGSSLROOTCERT" in sanitized).toBe(false);

    // Caller's baseEnv must not be mutated
    expect(baseEnv["PGHOSTADDR"]).toBe("10.0.0.99");
    expect(baseEnv["PGSERVICE"]).toBe("prod");

    // Defaults when port/user/database are omitted
    const minimalUrl = assertLoopbackDatabaseUrl(
      "postgresql://127.0.0.1",
      "READER_DB",
    );
    const minimalEnv = buildDuckdbPgEnv({}, minimalUrl, "pw");
    expect(minimalEnv["PGHOST"]).toBe("127.0.0.1");
    expect(minimalEnv["PGPORT"]).toBe("5432");
    expect(minimalEnv["PGUSER"]).toBe("cold_reader");
    expect(minimalEnv["PGDATABASE"]).toBe("postgres");
    expect(minimalEnv["PGSSLMODE"]).toBe("disable");
  });
});

describe("cold-archive-verify mode resolution & CLI argument parsing", () => {
  it("resolves auto, duckdb, and ts modes accurately", () => {
    expect(resolveVerifyMode("auto", true)).toBe("duckdb");
    expect(resolveVerifyMode("auto", false)).toBe("ts");
    expect(resolveVerifyMode("ts", true)).toBe("ts");
    expect(resolveVerifyMode("ts", false)).toBe("ts");
    expect(resolveVerifyMode("duckdb", true)).toBe("duckdb");
    expect(() => resolveVerifyMode("duckdb", false)).toThrow(/DuckDB CLI/);
  });

  it("parses all CLI flags and defaults and rejects invalid inputs and incompatible flag combinations", () => {
    expect(parseVerifyColdArchiveArgs([])).toEqual({
      dryRun: false,
      asOf: "2026-11-26",
      mode: "auto",
      seed: true,
      json: false,
      help: false,
    });

    expect(
      parseVerifyColdArchiveArgs([
        "--dry-run",
        "--as-of",
        "2026-11-27",
        "--mode",
        "ts",
        "--no-seed",
        "--json",
      ]),
    ).toEqual({
      dryRun: true,
      asOf: "2026-11-27",
      mode: "ts",
      seed: false,
      json: true,
      help: false,
    });

    expect(
      parseVerifyColdArchiveArgs([
        "--as-of=2026-11-26",
        "--no-seed",
        "--mode=duckdb",
        "-h",
      ]),
    ).toEqual({
      dryRun: false,
      asOf: "2026-11-26",
      mode: "duckdb",
      seed: false,
      json: false,
      help: true,
    });

    expect(() => parseVerifyColdArchiveArgs(["--no-seed"])).toThrow(
      /--no-seed can only be used together with --dry-run/,
    );
    expect(() => parseVerifyColdArchiveArgs(["--as-of", "2026-11-27"])).toThrow(
      /--as-of can only be used together with --dry-run/,
    );
    expect(() => parseVerifyColdArchiveArgs(["--as-of=2026-11-26"])).toThrow(
      /--as-of can only be used together with --dry-run/,
    );
    expect(() => parseVerifyColdArchiveArgs(["--as-of", "2026-02-30"])).toThrow(
      /Invalid --as-of/,
    );
    expect(() => parseVerifyColdArchiveArgs(["--mode", "sqlite"])).toThrow(
      /Invalid --mode/,
    );
    expect(() => parseVerifyColdArchiveArgs(["--unknown"])).toThrow(
      /Unknown argument/,
    );
  });
});
