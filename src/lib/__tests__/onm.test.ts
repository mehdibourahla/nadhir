import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  matchWilaya,
  normalizeName,
  parseCapDetail,
  parseOnmFeed,
  sanitizeOnmCapUrl,
} from "@/lib/ingest/onm.server";

const xml = readFileSync(
  join(__dirname, "fixtures", "onm-atom-sample.xml"),
  "utf8",
);

describe("parseOnmFeed", () => {
  it("parses live Atom entries with their CAP summary", () => {
    const entries = parseOnmFeed(xml);
    expect(entries).toHaveLength(4);
    const e = entries[0]!;
    expect(e.cap_id).toBe("urn:oid:2.49.0.1.12.0.2026.8.30.15.54.22.25497");
    expect(e.title).toBe(
      "Rain Moderate warning for the wilaya: SIDI-BEL-ABBÈS",
    );
    expect(e.event).toBe("Rain");
    expect(e.severity).toBe("Moderate");
    expect(e.urgency).toBe("Immediate");
    expect(e.certainty).toBe("Observed");
    expect(e.area_desc).toBe("SIDI-BEL-ABBÈS");
    expect(e.onset).toBe("2026-08-30T18:00:00Z");
    expect(e.expires).toBe("2026-08-31T00:00:00Z");
    expect(e.sent).toBe("2026-08-30T15:54:22Z");
    expect(e.cap_url).toBe(
      "https://ametvigilance.meteo.dz/CAPs/2026.8.30.15.54.22.25497.xml",
    );
  });

  it("returns nothing for a non-feed body", () => {
    expect(parseOnmFeed("<html>maintenance</html>")).toEqual([]);
  });
});

describe("matchWilaya", () => {
  const wilayas = [
    { id: "a", name_fr: "Sidi Bel Abbès" },
    { id: "b", name_fr: "Souk Ahras" },
    { id: "c", name_fr: "Alger" },
  ];

  it("matches ONM's dashed uppercase names to admin_units", () => {
    expect(matchWilaya("SIDI-BEL-ABBÈS", wilayas)?.id).toBe("a");
    expect(matchWilaya("SOUK-AHRAS", wilayas)?.id).toBe("b");
  });

  it("returns null rather than guessing on an unknown name", () => {
    expect(matchWilaya("WILAYA-INCONNUE", wilayas)).toBeNull();
  });

  it("normalizes diacritics and separators identically", () => {
    expect(normalizeName("SIDI-BEL-ABBÈS")).toBe(
      normalizeName("Sidi Bel Abbès"),
    );
  });

  it("matches ONM's MSILA to the apostrophed M'Sila", () => {
    expect(matchWilaya("MSILA", [{ id: "m", name_fr: "M'Sila" }])?.id).toBe(
      "m",
    );
  });

  // ONM publishes TIMIMOUN; admin_units spells it Timimoune in French and
  // Timimoun in English, and an exact match on one column silences the wilaya
  it("falls back to the English spelling when the French one differs", () => {
    expect(
      matchWilaya("TIMIMOUN", [
        { id: "t", name_fr: "Timimoune", name_en: "Timimoun" },
      ])?.id,
    ).toBe("t");
  });

  it("still matches when no English name is recorded", () => {
    expect(
      matchWilaya("ALGER", [{ id: "c", name_fr: "Alger", name_en: null }])?.id,
    ).toBe("c");
  });
});

describe("parseCapDetail", () => {
  const capXml = readFileSync(
    join(__dirname, "fixtures", "onm-cap-sample.xml"),
    "utf8",
  );

  it("extracts the French headline and the area polygon", () => {
    const d = parseCapDetail(capXml)!;
    expect(d.headline_fr).toBe(
      "Avertissement de PLUIE Modéré pour la wilaya : SIDI-BEL-ABBÈS",
    );
    expect(d.polygon!.length).toBeGreaterThan(50);
    expect(d.polygon![0]).toEqual([-1.00398, 35.090229]);
  });

  it("drops the boilerplate no-information instruction", () => {
    expect(parseCapDetail(capXml)!.instruction_fr).toBeNull();
  });

  it("returns null for a non-CAP body", () => {
    expect(parseCapDetail("<html>404</html>")).toBeNull();
  });

  it("extracts CDATA-wrapped headline and instruction cleanly without ReDoS", () => {
    const cdataCap = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <msgType>Alert</msgType>
  <info>
    <headline><![CDATA[Pluies torrentielles & vents forts]]></headline>
    <instruction><![CDATA[Évitez les oueds & passages inondés]]></instruction>
  </info>
</alert>`;
    const detail = parseCapDetail(cdataCap);
    expect(detail).not.toBeNull();
    expect(detail!.headline_fr).toBe("Pluies torrentielles & vents forts");
    expect(detail!.instruction_fr).toBe("Évitez les oueds & passages inondés");
  });
});

describe("Tier 5 ONM feed & CAP URL hardening (T5-02)", () => {
  const CAP_NS = "urn:oasis:names:tc:emergency:cap:1.2";

  it("rejects SSRF CAP URLs and resolves relative /CAPs/*.xml against ametvigilance.meteo.dz", () => {
    expect(
      sanitizeOnmCapUrl("http://169.254.169.254/CAPs/imds.xml"),
    ).toBeNull();
    expect(
      sanitizeOnmCapUrl("https://169.254.169.254/CAPs/imds.xml"),
    ).toBeNull();
    expect(sanitizeOnmCapUrl("https://evil.example/CAPs/spoof.xml")).toBeNull();
    expect(
      sanitizeOnmCapUrl("https://user:pass@ametvigilance.meteo.dz/CAPs/a.xml"),
    ).toBeNull();
    expect(
      sanitizeOnmCapUrl("https://ametvigilance.meteo.dz:8443/CAPs/a.xml"),
    ).toBeNull();
    expect(
      sanitizeOnmCapUrl("https://ametvigilance.meteo.dz/CAPs/../secret.xml"),
    ).toBeNull();
    expect(
      sanitizeOnmCapUrl(
        "https://ametvigilance.meteo.dz/CAPs/a.xml?redirect=http://169.254.169.254",
      ),
    ).toBeNull();
    expect(
      sanitizeOnmCapUrl("https://ametvigilance.meteo.dz/CAPs/a.xml#frag"),
    ).toBeNull();
    expect(
      sanitizeOnmCapUrl("https://ametvigilance.meteo.dz/CAPs/a.xml?"),
    ).toBeNull();
    expect(
      sanitizeOnmCapUrl("https://ametvigilance.meteo.dz/CAPs/a.xml#"),
    ).toBeNull();
    expect(sanitizeOnmCapUrl("/CAPs/relative.xml")).toBe(
      "https://ametvigilance.meteo.dz/CAPs/relative.xml",
    );
    expect(sanitizeOnmCapUrl("https://vigilance.meteo.dz/CAPs/2026.xml")).toBe(
      "https://vigilance.meteo.dz/CAPs/2026.xml",
    );

    const feed = `<feed xmlns:cap="${CAP_NS}">
      <entry>
        <id>urn:oid:ssrf.1</id>
        <title>Rain Severe warning</title>
        <cap:sent>2026-11-25T10:00:00Z</cap:sent>
        <cap:areaDesc>ALGER</cap:areaDesc>
        <link href="http://169.254.169.254/CAPs/imds.xml"/>
      </entry>
      <entry>
        <id>urn:oid:rel.2</id>
        <title>Wind Moderate warning</title>
        <cap:sent>2026-11-25T10:05:00Z</cap:sent>
        <cap:areaDesc>ORAN</cap:areaDesc>
        <link href="/CAPs/relative.xml"/>
      </entry>
    </feed>`;

    const entries = parseOnmFeed(feed);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.cap_url).toBeNull();
    expect(entries[1]!.cap_url).toBe(
      "https://ametvigilance.meteo.dz/CAPs/relative.xml",
    );
  });

  it("skips feed entries with invalid or impossible calendar timestamps in cap:sent, cap:onset, or cap:expires", () => {
    const feed = `<feed xmlns:cap="${CAP_NS}">
      <entry>
        <id>urn:oid:bad.sent</id>
        <title>Rain Severe warning</title>
        <cap:sent>not-a-date</cap:sent>
        <cap:areaDesc>ALGER</cap:areaDesc>
      </entry>
      <entry>
        <id>urn:oid:feb30.sent</id>
        <title>Rain Severe warning</title>
        <cap:sent>2026-02-30T10:00:00Z</cap:sent>
        <cap:areaDesc>ALGER</cap:areaDesc>
      </entry>
      <entry>
        <id>urn:oid:bad.expires</id>
        <title>Rain Severe warning</title>
        <cap:sent>2026-11-25T10:00:00Z</cap:sent>
        <cap:expires>not-a-date</cap:expires>
        <cap:areaDesc>ALGER</cap:areaDesc>
      </entry>
      <entry>
        <id>urn:oid:valid.1</id>
        <title>Rain Severe warning</title>
        <cap:sent>2026-11-25T10:00:00Z</cap:sent>
        <cap:onset>2026-11-25T12:00:00Z</cap:onset>
        <cap:expires>2026-11-25T20:00:00Z</cap:expires>
        <cap:areaDesc>ALGER</cap:areaDesc>
      </entry>
    </feed>`;

    const entries = parseOnmFeed(feed);
    expect(entries.map((e) => e.cap_id)).toEqual(["urn:oid:valid.1"]);
  });
});
