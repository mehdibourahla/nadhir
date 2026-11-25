import { describe, expect, it } from "vitest";

import { importRepoModule, readRepoFile } from "../lib/env.ts";
import { startMockHttpServer } from "../lib/http.ts";

const CAP_NS = "urn:oasis:names:tc:emergency:cap:1.2";

describe("Tier 5 — Track 2 ONM CAP SSRF, XML & Provenance Hardening", () => {
  describe("T5-02: ONM CAP URL SSRF, relative URLs, strict timestamps & CDATA", () => {
    it("rejects SSRF CAP URLs and resolves relative /CAPs/*.xml URLs safely without throwing in new URL()", async () => {
      const mod = await importRepoModule<{
        parseOnmFeed: (xml: string) => Array<{
          cap_id: string;
          cap_url: string | null;
          sent: string;
        }>;
        sanitizeOnmCapUrl: (href: string) => string | null;
      }>("src/lib/ingest/onm.server.ts");

      const hostile = [
        "http://169.254.169.254/CAPs/imds.xml",
        "https://169.254.169.254/CAPs/imds.xml",
        "http://ametvigilance.meteo.dz/CAPs/insecure.xml",
        "https://user:pass@ametvigilance.meteo.dz/CAPs/creds.xml",
        "https://ametvigilance.meteo.dz.evil.test/CAPs/spoof.xml",
        "https://ametvigilance.meteo.dz/CAPs/../etc/passwd.xml",
        "https://ametvigilance.meteo.dz/CAPs/a.xml?redirect=http://169.254.169.254",
        "https://ametvigilance.meteo.dz/CAPs/a.xml#frag",
        "https://ametvigilance.meteo.dz/CAPs/a.xml?",
        "https://ametvigilance.meteo.dz/CAPs/a.xml#",
      ];
      for (const url of hostile) {
        expect(mod.sanitizeOnmCapUrl(url), url).toBeNull();
      }

      const feed = `<feed xmlns:cap="${CAP_NS}">
        <entry>
          <id>urn:oid:t5.ssrf</id>
          <title>Rain Extreme warning</title>
          <cap:sent>2026-11-25T11:00:00Z</cap:sent>
          <cap:areaDesc>ALGER</cap:areaDesc>
          <link href="http://169.254.169.254/CAPs/imds.xml"/>
        </entry>
        <entry>
          <id>urn:oid:t5.relative</id>
          <title>Wind Severe warning</title>
          <cap:sent>2026-11-25T11:05:00Z</cap:sent>
          <cap:areaDesc>ORAN</cap:areaDesc>
          <link href="/CAPs/rel-2026.xml"/>
        </entry>
      </feed>`;

      const entries = mod.parseOnmFeed(feed);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.cap_url).toBeNull();
      expect(entries[1]!.cap_url).toBe(
        "https://ametvigilance.meteo.dz/CAPs/rel-2026.xml",
      );
      // Confirm backfill URL parsing never throws on resolved relative URL
      expect(() => new URL(entries[1]!.cap_url!)).not.toThrow();
    });

    it("rejects oversized adversarial CAP href payloads in linear time", async () => {
      const mod = await importRepoModule<{
        sanitizeOnmCapUrl: (href: string) => string | null;
      }>("src/lib/ingest/onm.server.ts");

      const started = performance.now();
      expect(
        mod.sanitizeOnmCapUrl(`${"/CAPs/".repeat(25_000)}a.xml`),
      ).toBeNull();
      expect(performance.now() - started).toBeLessThan(50);
    });

    it("skips ONM Atom entries with invalid or impossible calendar timestamps", async () => {
      const mod = await importRepoModule<{
        parseOnmFeed: (xml: string) => Array<{
          cap_id: string;
          sent: string;
          onset: string | null;
          expires: string | null;
        }>;
      }>("src/lib/ingest/onm.server.ts");

      const feed = `<feed xmlns:cap="${CAP_NS}">
        <entry>
          <id>urn:oid:t5.bad-sent</id>
          <title>Rain Moderate warning</title>
          <cap:sent>not-a-date</cap:sent>
          <cap:areaDesc>ALGER</cap:areaDesc>
        </entry>
        <entry>
          <id>urn:oid:t5.feb30</id>
          <title>Rain Moderate warning</title>
          <cap:sent>2026-02-30T12:00:00Z</cap:sent>
          <cap:areaDesc>ALGER</cap:areaDesc>
        </entry>
        <entry>
          <id>urn:oid:t5.bad-onset</id>
          <title>Rain Moderate warning</title>
          <cap:sent>2026-11-25T12:00:00Z</cap:sent>
          <cap:onset>2026-04-31T00:00:00Z</cap:onset>
          <cap:areaDesc>ALGER</cap:areaDesc>
        </entry>
        <entry>
          <id>urn:oid:t5.ok-no-expires</id>
          <title>Rain Severe warning</title>
          <cap:sent>2026-11-25T12:00:00Z</cap:sent>
          <cap:areaDesc>TIPAZA</cap:areaDesc>
        </entry>
      </feed>`;

      const entries = mod.parseOnmFeed(feed);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.cap_id).toBe("urn:oid:t5.ok-no-expires");
      expect(entries[0]!.expires).toBeNull();
    });

    it("extracts CDATA-wrapped CAP headlines and instructions cleanly without ReDoS", async () => {
      const mod = await importRepoModule<{
        parseCapDetail: (xml: string) => {
          headline_fr: string | null;
          instruction_fr: string | null;
        } | null;
      }>("src/lib/ingest/onm.server.ts");

      const xml = `<alert xmlns="${CAP_NS}">
        <msgType>Alert</msgType>
        <info>
          <headline><![CDATA[Pluies torrentielles & vents forts <niveau rouge>]]></headline>
          <instruction><![CDATA[Restez à l'écart des oueds & routes inondées]]></instruction>
        </info>
      </alert>`;
      const parsed = mod.parseCapDetail(xml);
      expect(parsed?.headline_fr).toBe(
        "Pluies torrentielles & vents forts <niveau rouge>",
      );
      expect(parsed?.instruction_fr).toBe(
        "Restez à l'écart des oueds & routes inondées",
      );

      // Unclosed CDATA must fail cleanly without hanging
      const started = performance.now();
      const unclosed = mod.parseCapDetail(
        `<alert xmlns="${CAP_NS}"><info><headline><![CDATA[${"x".repeat(50_000)}</headline></info></alert>`,
      );
      expect(unclosed?.headline_fr).toBeNull();
      expect(performance.now() - started).toBeLessThan(100);
    });

    it("T5-R2-04: blocks HTTP 302 redirect SSRF with redirect: 'manual' (zero hits to internal target)", async () => {
      const archiveMod = await importRepoModule<{
        createArchivedFetch: (store: {
          putObject: (
            path: string,
            bytes: Uint8Array,
            mediaType: string,
          ) => Promise<void>;
          capture: (row: Record<string, unknown>) => Promise<void>;
        }) => (
          sourceKey: string,
          endpoint: string,
          input: RequestInfo | URL,
          init?: RequestInit,
        ) => Promise<Response>;
      }>("src/lib/source-archive.server.ts");

      // Verify onm.server.ts passes redirect: "manual" on both CAP detail & Atom feed fetches
      const onmSource = readRepoFile("src/lib/ingest/onm.server.ts");
      const manualMatches = onmSource.match(/redirect:\s*"manual"/g) ?? [];
      expect(manualMatches.length).toBeGreaterThanOrEqual(2);

      // Empirical local HTTP 302 redirect probe proving internal target hit count === 0
      const internalTarget = await startMockHttpServer(() => ({
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "SECRET_METADATA",
      }));
      const redirector = await startMockHttpServer(() => ({
        status: 302,
        headers: { location: `${internalTarget.url}/latest/meta-data/` },
        body: "",
      }));

      try {
        const archived = archiveMod.createArchivedFetch({
          putObject: async () => undefined,
          capture: async () => undefined,
        });
        const res = await archived(
          "onm",
          "cap_detail",
          `${redirector.url}/CAPs/redirect.xml`,
          { redirect: "manual" },
        );
        expect(res.status).toBe(302);
        expect(res.ok).toBe(false);
        expect(internalTarget.requests).toHaveLength(0);
      } finally {
        await redirector.close();
        await internalTarget.close();
      }
    });
  });

  describe("T5-06: Anchored ONM provenance & em-dash prohibition", () => {
    it("rejects spoofed/negated ONM attributions and banned em dashes in sourceAttribution", async () => {
      const mod = await importRepoModule<{
        validateProvenanceInvariants: (
          data: Record<string, unknown>,
        ) => string[];
      }>("src/lib/alert-provenance.ts");

      for (const badAttr of [
        "Not ONM model output",
        "Fake ONM spoof",
        "Unofficial ONM summary",
        "ONM\nFake",
        "ONM\rFake",
        "ONM\tFake",
      ]) {
        const violations = mod.validateProvenanceInvariants({
          triggerKind: "wilaya_warning",
          areaLabel: "Alger",
          sourceKey: "onm",
          sourceAttribution: badAttr,
          ruleLabelKey: "provenance.rule.onmSevere",
          observedAt: "2026-11-25T12:00:00Z",
          authorityStatus: "official",
        });
        expect(
          violations.some((v) => /ONM/i.test(v)),
          `expected rejection for "${badAttr}"`,
        ).toBe(true);
      }

      const emDashViolations = mod.validateProvenanceInvariants({
        triggerKind: "wilaya_warning",
        areaLabel: "Alger",
        sourceKey: "onm",
        sourceAttribution: "ONM \u2014 Météo Algérie",
        ruleLabelKey: "provenance.rule.onmSevere",
        observedAt: "2026-11-25T12:00:00Z",
        authorityStatus: "official",
      });
      expect(emDashViolations.some((v) => /em dash/i.test(v))).toBe(true);
    });

    it("accepts all canonical AR/FR/EN/KAB ONM attributions verbatim", async () => {
      const mod = await importRepoModule<{
        validateProvenanceInvariants: (
          data: Record<string, unknown>,
        ) => string[];
      }>("src/lib/alert-provenance.ts");

      const validAttributions = [
        "ONM · Météo Algérie",
        "Météo Algérie (ONM)",
        "ONM (Météo Algérie)",
        "Office National de la Météorologie",
        "الديوان الوطني للأرصاد الجوية",
      ];

      for (const attr of validAttributions) {
        const violations = mod.validateProvenanceInvariants({
          triggerKind: "wilaya_warning",
          areaLabel: "Alger",
          sourceKey: "onm",
          sourceAttribution: attr,
          ruleLabelKey: "provenance.rule.onmExtreme",
          observedAt: "2026-11-25T12:00:00Z",
          authorityStatus: "official",
        });
        expect(violations, attr).toEqual([]);
      }
    });
  });
});
