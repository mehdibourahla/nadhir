import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import {
  ALERT_TRIGGER_KINDS,
  AUTHORITY_STATUSES,
  BANNED_STATUS_LABELS,
  KNOWN_SOURCE_ATTRIBUTIONS,
  PROVENANCE_RULE_KEYS,
  buildAlertProvenance,
  formatLocalizedProvenanceDigest,
  formatProvenanceDigestLine,
  isValidObservedAt,
  isValidRadiusKm,
  normalizeAreaLabel,
  parseProvenancePayload,
  provenanceForBroadcast,
  provenanceForSelfTest,
  provenanceForWatchZoneAlert,
  toProvenancePayload,
  validateProvenanceInvariants,
  type AlertProvenanceData,
} from "@/lib/alert-provenance";

const SAMPLE_ISO = "2026-11-24T12:30:00Z";

describe("buildAlertProvenance", () => {
  it("preserves non-empty ONM attribution verbatim without altering wording", () => {
    const onmText = "ONM · Météo Algérie (BMS Pluie #42)";
    const built = buildAlertProvenance({
      triggerKind: "wilaya_warning",
      areaLabel: "Tizi Ouzou",
      sourceKey: "onm",
      sourceAttribution: `  ${onmText}  `,
      ruleLabelKey: "provenance.rule.onmExtreme",
      observedAt: SAMPLE_ISO,
      authorityStatus: "official",
    });

    expect(built.sourceAttribution).toBe(onmText);
    expect(built.areaLabel).toBe("Tizi Ouzou");
    expect(built.authorityStatus).toBe("official");
    expect(validateProvenanceInvariants(built)).toEqual([]);
  });

  it("falls back to canonical source attribution when blank, and degrades empty or em-dash area to null", () => {
    const built = buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: "\u2014",
      radiusKm: -5,
      sourceKey: "dgpc_telegram",
      sourceAttribution: "   ",
      ruleLabelKey: "",
      observedAt: SAMPLE_ISO,
    });

    expect(built.sourceAttribution).toBe(
      KNOWN_SOURCE_ATTRIBUTIONS["dgpc_telegram"],
    );
    expect(built.areaLabel).toBeNull();
    expect(built.radiusKm).toBeNull();
    expect(built.ruleLabelKey).toBe("provenance.rule.generic");
    expect(built.authorityStatus).toBeUndefined();
    expect(validateProvenanceInvariants(built)).toEqual([]);
  });

  it("rejects 'safe', Unicode NFD equivalents, and all banned status labels on authorityStatus", () => {
    for (const banned of [...BANNED_STATUS_LABELS, "su\u0302r", "  SAFE  "]) {
      const built = buildAlertProvenance({
        triggerKind: "national_feed",
        areaLabel: "Alger",
        sourceKey: "emsc",
        ruleLabelKey: "provenance.rule.m4Quake",
        observedAt: SAMPLE_ISO,
        authorityStatus: banned,
      });
      expect(built.authorityStatus, `banned=${banned}`).toBeUndefined();
    }
  });

  it("hardens KNOWN_SOURCE_ATTRIBUTIONS against prototype keys, case-folds lookups, and freezes constants", () => {
    expect(Object.getPrototypeOf(KNOWN_SOURCE_ATTRIBUTIONS)).toBeNull();
    expect(Object.isFrozen(KNOWN_SOURCE_ATTRIBUTIONS)).toBe(true);
    expect(Object.isFrozen(ALERT_TRIGGER_KINDS)).toBe(true);
    expect(Object.isFrozen(AUTHORITY_STATUSES)).toBe(true);
    expect(Object.isFrozen(PROVENANCE_RULE_KEYS)).toBe(true);
    expect(Object.isFrozen(BANNED_STATUS_LABELS)).toBe(true);

    for (const protoKey of [
      "__proto__",
      "toString",
      "constructor",
      "valueOf",
      "hasOwnProperty",
    ]) {
      const built = buildAlertProvenance({
        triggerKind: "national_feed",
        sourceKey: protoKey,
        sourceAttribution: "",
        observedAt: SAMPLE_ISO,
      });
      expect(typeof built.sourceAttribution, protoKey).toBe("string");
      expect(built.sourceAttribution, protoKey).toBe(protoKey);
      expect(validateProvenanceInvariants(built), protoKey).toEqual([]);

      const payload = toProvenancePayload(built);
      expect(typeof payload["provenance_source"], protoKey).toBe("string");
      expect(payload["provenance_source"], protoKey).toBe(protoKey);
    }

    const uppercaseOnm = buildAlertProvenance({
      triggerKind: "wilaya_warning",
      areaLabel: "Alger",
      sourceKey: "ONM",
      sourceAttribution: "",
      observedAt: SAMPLE_ISO,
    });
    expect(uppercaseOnm.sourceAttribution).toBe("ONM · Météo Algérie");
    expect(validateProvenanceInvariants(uppercaseOnm)).toEqual([]);
  });

  it("closes em-dash smuggling in areaLabel and lone-em-dash sourceAttribution while keeping verbatim ONM intact", () => {
    expect(normalizeAreaLabel("Alger \u2014 Centre")).toBe("Alger · Centre");
    expect(normalizeAreaLabel("\u2014\u2014")).toBeNull();
    expect(normalizeAreaLabel("  \u2014  ")).toBeNull();
    expect(normalizeAreaLabel("\u2014 Alger")).toBe("Alger");
    expect(normalizeAreaLabel("Alger \u2014")).toBe("Alger");
    expect(normalizeAreaLabel("\u2014 Alger \u2014")).toBe("Alger");
    expect(normalizeAreaLabel("·")).toBeNull();
    expect(normalizeAreaLabel(" · \u2014 · ")).toBeNull();
    expect(normalizeAreaLabel("Alger \u2014 \u2014 Oran")).toBe("Alger · Oran");
    expect(normalizeAreaLabel("Alger · \u2014 · Oran")).toBe("Alger · Oran");

    const builtArea = buildAlertProvenance({
      triggerKind: "commune_topic",
      areaLabel: "Alger \u2014 Centre",
      sourceKey: "dgpc_telegram",
      sourceAttribution: "\u2014\u2014",
      observedAt: SAMPLE_ISO,
    });
    expect(builtArea.areaLabel).toBe("Alger · Centre");
    expect(builtArea.areaLabel).not.toContain("\u2014");
    expect(builtArea.sourceAttribution).toBe("DGPC");
    expect(validateProvenanceInvariants(builtArea)).toEqual([]);

    const verbatimOnm =
      "ONM · Météo Algérie · BMS Pluie/Orages N°42 (Niveau 3 · Rouge)";
    const builtOnm = buildAlertProvenance({
      triggerKind: "wilaya_warning",
      areaLabel: "Tizi Ouzou",
      sourceKey: "onm",
      sourceAttribution: verbatimOnm,
      observedAt: SAMPLE_ISO,
    });
    expect(builtOnm.sourceAttribution).toBe(verbatimOnm);
    expect(validateProvenanceInvariants(builtOnm)).toEqual([]);

    const onmWithEmDash = buildAlertProvenance({
      triggerKind: "wilaya_warning",
      areaLabel: "Tizi Ouzou",
      sourceKey: "onm",
      sourceAttribution: "ONM \u2014 Météo Algérie",
      observedAt: SAMPLE_ISO,
    });
    expect(onmWithEmDash.sourceAttribution).toBe("ONM \u2014 Météo Algérie");
    expect(
      validateProvenanceInvariants(onmWithEmDash).some((v) =>
        /em dash/i.test(v),
      ),
    ).toBe(true);
  });

  it("normalizes adversarial repeated middot, em-dash, and whitespace areaLabels in strictly linear time", () => {
    const middotAttack = `x${"  ·  ".repeat(500)}y`;
    const emDashAttack = `x${" \u2014 ".repeat(500)}y`;
    const spaceAttack = `x${" ".repeat(10_000)}y`;

    const start = performance.now();
    expect(normalizeAreaLabel(middotAttack)).toBe("x · y");
    expect(normalizeAreaLabel(emDashAttack)).toBe("x · y");
    expect(normalizeAreaLabel(spaceAttack)).toBe(spaceAttack);

    const parsedMiddot = parseProvenancePayload({
      provenance_trigger: "commune_topic",
      provenance_area: middotAttack,
      provenance_source_key: "dgpc_telegram",
      provenance_observed_at: SAMPLE_ISO,
    });
    const parsedEmDash = parseProvenancePayload({
      provenance_trigger: "commune_topic",
      provenance_area: emDashAttack,
      provenance_source_key: "dgpc_telegram",
      provenance_observed_at: SAMPLE_ISO,
    });
    const elapsedMs = performance.now() - start;

    expect(parsedMiddot?.areaLabel).toBe("x · y");
    expect(parsedEmDash?.areaLabel).toBe("x · y");
    expect(parsedEmDash?.areaLabel).not.toContain("\u2014");
    expect(elapsedMs).toBeLessThan(50);
  });
});

describe("validateProvenanceInvariants", () => {
  it("detects em dashes, banned status labels, altered ONM attribution and bad timestamps", () => {
    const bad: AlertProvenanceData = {
      triggerKind: "wilaya_warning",
      areaLabel: "Alger \u2014 Centre",
      radiusKm: 0,
      sourceKey: "onm",
      sourceAttribution: "Weather agency",
      ruleLabelKey: "provenance.rule\u2014bad",
      observedAt: "not-a-timestamp",
      authorityStatus:
        "safe" as unknown as AlertProvenanceData["authorityStatus"],
    };

    const violations = validateProvenanceInvariants(bad);
    expect(violations.some((v) => v.includes("areaLabel"))).toBe(true);
    expect(violations.some((v) => v.includes("ruleLabelKey"))).toBe(true);
    expect(violations.some((v) => v.includes("ONM"))).toBe(true);
    expect(violations.some((v) => v.includes("banned status label"))).toBe(
      true,
    );
    expect(violations.some((v) => v.includes("observedAt"))).toBe(true);
    expect(violations.some((v) => v.includes("radiusKm"))).toBe(true);
  });

  it("accepts official Arabic and full French ONM attributions and rejects lone em-dash or non-string sourceAttribution", () => {
    for (const validOnm of [
      "ONM · Météo Algérie",
      "الديوان الوطني للأرصاد الجوية",
      "الديوان الوطني للأرصاد الجوية".normalize("NFD"),
      "الديوان الوطني للأرصاد الجوية · نشرة جوية خاصة",
      "Office National de la Météorologie",
      "Office National de la Me\u0301te\u0301orologie",
      "Office National de la Meteorologie",
      "Météo Algérie (ONM)",
      "ONM (Météo Algérie)",
    ]) {
      const built = buildAlertProvenance({
        triggerKind: "wilaya_warning",
        areaLabel: "Alger",
        sourceKey: "onm",
        sourceAttribution: validOnm,
        ruleLabelKey: "provenance.rule.onmSevere",
        observedAt: SAMPLE_ISO,
        authorityStatus: "official",
      });
      expect(built.sourceAttribution).toBe(validOnm);
      expect(validateProvenanceInvariants(built), validOnm).toEqual([]);
    }

    for (const spoofedOnm of [
      "Not ONM model output",
      "Fake ONM spoof",
      "Unofficial ONM summary",
    ]) {
      const violations = validateProvenanceInvariants({
        triggerKind: "wilaya_warning",
        areaLabel: "Alger",
        sourceKey: "onm",
        sourceAttribution: spoofedOnm,
        ruleLabelKey: "provenance.rule.onmSevere",
        observedAt: SAMPLE_ISO,
        authorityStatus: "official",
      });
      expect(
        violations.some((v) => /ONM/i.test(v)),
        `expected spoofed ONM attribution "${spoofedOnm}" to be rejected`,
      ).toBe(true);
    }

    const loneEmDashSource: AlertProvenanceData = {
      triggerKind: "national_feed",
      areaLabel: "Alger",
      radiusKm: null,
      sourceKey: "dgpc_telegram",
      sourceAttribution: "\u2014",
      ruleLabelKey: "provenance.rule.dgpcFire",
      observedAt: SAMPLE_ISO,
    };
    expect(
      validateProvenanceInvariants(loneEmDashSource).some((v) =>
        v.includes("sourceAttribution must be non-empty"),
      ),
    ).toBe(true);

    const corruptedNonString: AlertProvenanceData = {
      triggerKind: "national_feed",
      areaLabel: "Alger",
      radiusKm: null,
      sourceKey: "emsc",
      sourceAttribution: Object.prototype as unknown as string,
      ruleLabelKey: "provenance.rule.m4Quake",
      observedAt: SAMPLE_ISO,
    };
    expect(() =>
      validateProvenanceInvariants(corruptedNonString),
    ).not.toThrow();
    expect(
      validateProvenanceInvariants(corruptedNonString).some((v) =>
        v.includes("sourceAttribution must be non-empty"),
      ),
    ).toBe(true);

    const nfdBanned: AlertProvenanceData = {
      triggerKind: "national_feed",
      areaLabel: "Alger",
      radiusKm: null,
      sourceKey: "emsc",
      sourceAttribution: "EMSC",
      ruleLabelKey: "provenance.rule.m4Quake",
      observedAt: SAMPLE_ISO,
      authorityStatus:
        "su\u0302r" as unknown as AlertProvenanceData["authorityStatus"],
    };
    expect(
      validateProvenanceInvariants(nfdBanned).some((v) =>
        v.includes("banned status label"),
      ),
    ).toBe(true);
  });

  it("validates strict ISO-8601 timestamps and real calendar dates via isValidObservedAt", () => {
    expect(isValidObservedAt(SAMPLE_ISO)).toBe(true);
    expect(isValidObservedAt("2026-11-24T12:30:00.123456Z")).toBe(true);
    expect(isValidObservedAt("2026-11-24T12:30:00+01:00")).toBe(true);
    expect(isValidObservedAt("2026-11-24T12:30:00+0100")).toBe(true);
    expect(isValidObservedAt("2024-02-29T12:00:00Z")).toBe(true);

    expect(isValidObservedAt("")).toBe(false);
    expect(isValidObservedAt("   ")).toBe(false);
    expect(isValidObservedAt("invalid-date")).toBe(false);
    expect(isValidObservedAt("1")).toBe(false);
    expect(isValidObservedAt("2026")).toBe(false);
    expect(isValidObservedAt("hello 2026")).toBe(false);
    expect(isValidObservedAt("2026-11-24")).toBe(false);
    expect(isValidObservedAt("2026-11-24T12:30:00")).toBe(false);
    expect(isValidObservedAt("2026-02-29T00:00:00Z")).toBe(false);
    expect(isValidObservedAt("2026-02-31T00:00:00Z")).toBe(false);
    expect(isValidObservedAt("2026-04-31T00:00:00Z")).toBe(false);
    expect(isValidObservedAt("2026-11-24T24:00:00Z")).toBe(false);
    expect(isValidObservedAt("2026-11-24T12:00:00+25:00")).toBe(false);
    expect(isValidObservedAt(null)).toBe(false);
    expect(isValidObservedAt(undefined)).toBe(false);
    expect(isValidObservedAt(12345)).toBe(false);
  });

  it("validates positive finite radius values via isValidRadiusKm", () => {
    expect(isValidRadiusKm(25)).toBe(true);
    expect(isValidRadiusKm(0.5)).toBe(true);
    expect(isValidRadiusKm(0)).toBe(false);
    expect(isValidRadiusKm(-5)).toBe(false);
    expect(isValidRadiusKm(Number.NaN)).toBe(false);
    expect(isValidRadiusKm(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidRadiusKm("25")).toBe(false);
    expect(isValidRadiusKm(null)).toBe(false);
  });
});

describe("toProvenancePayload and parseProvenancePayload", () => {
  it("round-trips full watch_zone provenance through string-only FCM data payload", () => {
    const original = buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: "Béjaïa",
      radiusKm: 25,
      sourceKey: "firms",
      sourceAttribution: "NASA FIRMS",
      ruleLabelKey: "provenance.rule.probableFire",
      observedAt: SAMPLE_ISO,
      authorityStatus: "probable",
    });

    const payload = toProvenancePayload(original);
    for (const value of Object.values(payload)) {
      expect(typeof value).toBe("string");
    }
    expect(payload).toEqual({
      provenance_trigger: "watch_zone",
      provenance_area: "Béjaïa",
      provenance_radius_km: "25",
      provenance_source_key: "firms",
      provenance_source: "NASA FIRMS",
      provenance_rule: "provenance.rule.probableFire",
      provenance_observed_at: SAMPLE_ISO,
      provenance_authority: "probable",
    });

    const parsed = parseProvenancePayload(payload);
    expect(parsed).toEqual(original);
  });

  it("round-trips degraded payloads without radiusKm or authorityStatus", () => {
    const original = buildAlertProvenance({
      triggerKind: "self_test",
      areaLabel: null,
      sourceKey: "nadhir_test",
      ruleLabelKey: "provenance.rule.selfTest",
      observedAt: SAMPLE_ISO,
    });

    const payload = toProvenancePayload(original);
    expect(payload["provenance_radius_km"]).toBeUndefined();
    expect(payload["provenance_authority"]).toBeUndefined();
    expect(payload["provenance_area"]).toBe("");

    const parsed = parseProvenancePayload(payload);
    expect(parsed).toEqual(original);
  });

  it("returns null on malformed payloads or invalid triggers and strips banned statuses", () => {
    expect(parseProvenancePayload(null)).toBeNull();
    expect(parseProvenancePayload("invalid")).toBeNull();
    expect(parseProvenancePayload([])).toBeNull();
    expect(
      parseProvenancePayload({
        provenance_trigger: "unknown_trigger",
        provenance_source_key: "onm",
      }),
    ).toBeNull();
    expect(
      parseProvenancePayload({
        provenance_trigger: "wilaya_warning",
        provenance_source_key: "   ",
      }),
    ).toBeNull();

    const sanitized = parseProvenancePayload({
      provenance_trigger: "commune_topic",
      provenance_area: "\u2014",
      provenance_source_key: "emsc",
      provenance_source: "EMSC",
      provenance_rule: "provenance.rule.m4Quake",
      provenance_observed_at: SAMPLE_ISO,
      provenance_authority: "safe",
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized?.areaLabel).toBeNull();
    expect(sanitized?.authorityStatus).toBeUndefined();

    const protoSource = parseProvenancePayload({
      provenance_trigger: "national_feed",
      provenance_source_key: "__proto__",
      provenance_observed_at: SAMPLE_ISO,
    });
    expect(protoSource).not.toBeNull();
    expect(typeof protoSource?.sourceAttribution).toBe("string");
    expect(protoSource?.sourceAttribution).toBe("__proto__");
    expect(validateProvenanceInvariants(protoSource!)).toEqual([]);

    const inherited = Object.create({
      provenance_trigger: "national_feed",
      provenance_source_key: "onm",
      provenance_observed_at: SAMPLE_ISO,
    });
    expect(parseProvenancePayload(inherited)).toBeNull();

    // Missing, blank, or malformed provenance_observed_at returns null so callers can fall back cleanly
    for (const badObservedAt of [
      undefined,
      "",
      "   ",
      "not-a-date",
      "2026-02-31T00:00:00Z",
    ]) {
      const partial: Record<string, unknown> = {
        provenance_trigger: "watch_zone",
        provenance_source_key: "onm",
        provenance_source: "ONM · Météo Algérie",
        provenance_rule: "provenance.rule.onmExtreme",
      };
      if (badObservedAt !== undefined) {
        partial["provenance_observed_at"] = badObservedAt;
      }
      expect(
        parseProvenancePayload(partial),
        `observedAt=${String(badObservedAt)}`,
      ).toBeNull();
    }
  });
});

describe("formatProvenanceDigestLine", () => {
  it("formats middot-separated digest copy with zero em dashes and radius support", () => {
    const watch = buildAlertProvenance({
      triggerKind: "watch_zone",
      areaLabel: "Azazga",
      radiusKm: 15,
      sourceKey: "dgpc_telegram",
      ruleLabelKey: "provenance.rule.dgpcFire",
      observedAt: SAMPLE_ISO,
      authorityStatus: "official",
    });

    const line = formatProvenanceDigestLine(watch, {
      trigger: "Your watch zone",
      rule: "Official Civil Protection fire incident",
      areaFallback: "Not recorded",
      timeLabel: "24/11 13:30",
      radiusLabel: "within 15 km",
    });

    expect(line).toBe(
      "DGPC · Your watch zone · Azazga (within 15 km) · Official Civil Protection fire incident · 24/11 13:30",
    );
    expect(line).not.toContain("\u2014");

    const degraded = buildAlertProvenance({
      triggerKind: "national_feed",
      areaLabel: null,
      sourceKey: "onm",
      ruleLabelKey: "provenance.rule.onmSevere",
      observedAt: SAMPLE_ISO,
    });
    const degradedLine = formatProvenanceDigestLine(degraded, {
      trigger: "National hazard feed",
      rule: "ONM Severe weather warning",
      areaFallback: "Not recorded",
      timeLabel: "24/11 13:30",
    });
    expect(degradedLine).toContain("ONM · Météo Algérie");
    expect(degradedLine).toContain("Not recorded");
    expect(degradedLine).not.toContain("\u2014");

    for (const badRadius of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const hostile: AlertProvenanceData = {
        triggerKind: "watch_zone",
        areaLabel: "Alger \u2014 Centre",
        radiusKm: badRadius,
        sourceKey: "dgpc_telegram",
        sourceAttribution: "DGPC",
        ruleLabelKey: "provenance.rule.dgpcFire",
        observedAt: SAMPLE_ISO,
      };
      const hostileLine = formatProvenanceDigestLine(hostile, {
        trigger: "Your watch zone",
        rule: "Official Civil Protection fire incident",
        areaFallback: "Not recorded",
        timeLabel: "24/11 13:30",
        radiusLabel: `within ${String(badRadius)} km`,
      });
      expect(hostileLine, `radius=${String(badRadius)}`).not.toContain(
        "within",
      );
      expect(hostileLine, `radius=${String(badRadius)}`).toContain(
        "Alger · Centre",
      );
      expect(hostileLine, `radius=${String(badRadius)}`).not.toContain(
        "\u2014",
      );
    }
  });
});

describe("provenance i18n keys across all 4 locales", () => {
  it("resolves every trigger kind, authority status and rule key in ar, fr, en and kab", () => {
    const bannedSet = new Set(BANNED_STATUS_LABELS.map((s) => s.toLowerCase()));

    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      const keys = [
        "provenance.whySeeing",
        "provenance.triggerLabel",
        "provenance.areaLabel",
        "provenance.ruleLabel",
        "provenance.sourceLabel",
        "provenance.observedLabel",
        "provenance.statusLabel",
        ...ALERT_TRIGGER_KINDS.map((k) => `provenance.trigger.${k}`),
        ...AUTHORITY_STATUSES.map((k) => `provenance.authority.${k}`),
        ...PROVENANCE_RULE_KEYS,
      ];

      for (const key of keys) {
        const value = t(key);
        expect(value, `${locale}:${key}`).not.toBe(key);
        expect(value.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
        expect(value, `${locale}:${key}`).not.toContain("\u2014");
        expect(
          bannedSet.has(value.trim().toLowerCase()),
          `${locale}:${key}`,
        ).toBe(false);
      }

      const radius = t("provenance.radiusKm", { km: 25 });
      expect(radius, `${locale}:radiusKm`).toContain("25");
      expect(radius, `${locale}:radiusKm`).not.toContain("\u2014");
    }
  });
});

describe("domain provenance builders, area cap and M2C localized digest helper", () => {
  it("caps provenance_area and non-ONM provenance_source safely without splitting UTF-16 surrogates or altering verbatim ONM attributions", () => {
    const hasLoneSurrogate = (value: string) => {
      for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = value.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) i += 1;
          else return true;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          return true;
        }
      }
      return false;
    };
    const longArea = "Tizi Ouzou ".repeat(40);
    const longEmojiArea = "🔥".repeat(500);
    const longNonOnmSource = "السلطة المحلية — ".repeat(400);
    const longEmojiSource = "🚨".repeat(500);

    for (const verbatimOnm of [
      "ONM · Météo Algérie",
      "Office National de la Météorologie",
      "الديوان الوطني للأرصاد الجوية",
      "ONM · Météo Algérie (BMS Pluie Exceptionnelle #2026-11-25-ALGER-TIZI-OUZOU)",
    ]) {
      const built = provenanceForBroadcast({
        kind: "onm",
        severity: "Extreme",
        areaLabel: longArea,
        sourceAttribution: verbatimOnm,
        observedAt: SAMPLE_ISO,
      });
      const payload = toProvenancePayload(built);
      expect(
        Array.from(payload["provenance_area"]!).length,
      ).toBeLessThanOrEqual(240);
      expect(payload["provenance_source"]).toBe(verbatimOnm);
      expect(validateProvenanceInvariants(built)).toEqual([]);
    }

    const nonOnmArabic = provenanceForBroadcast({
      kind: "official",
      hazard: "flood",
      areaLabel: longEmojiArea,
      sourceKey: "dgpc_telegram",
      sourceAttribution: longNonOnmSource,
      observedAt: SAMPLE_ISO,
    });
    const payloadAr = toProvenancePayload(nonOnmArabic);
    expect(
      Array.from(payloadAr["provenance_area"]!).length,
    ).toBeLessThanOrEqual(240);
    expect(
      new TextEncoder().encode(payloadAr["provenance_area"]!).byteLength,
    ).toBeLessThanOrEqual(512);
    expect(hasLoneSurrogate(payloadAr["provenance_area"]!)).toBe(false);
    expect(
      Array.from(payloadAr["provenance_source"]!).length,
    ).toBeLessThanOrEqual(240);
    expect(
      new TextEncoder().encode(payloadAr["provenance_source"]!).byteLength,
    ).toBeLessThanOrEqual(512);
    expect(payloadAr["provenance_source"]).not.toContain("\u2014");
    expect(hasLoneSurrogate(payloadAr["provenance_source"]!)).toBe(false);

    const nonOnmEmoji = provenanceForBroadcast({
      kind: "authority",
      areaLabel: longEmojiArea,
      sourceAttribution: longEmojiSource,
      observedAt: SAMPLE_ISO,
    });
    const payloadEmoji = toProvenancePayload(nonOnmEmoji);
    expect(
      new TextEncoder().encode(payloadEmoji["provenance_source"]!).byteLength,
    ).toBeLessThanOrEqual(512);
    expect(hasLoneSurrogate(payloadEmoji["provenance_source"]!)).toBe(false);
  });

  it("builds valid provenance for all broadcast, watch-zone, and self-test variants", () => {
    const samples = [
      provenanceForBroadcast({
        kind: "fire",
        confirmed: false,
        areaLabel: "Azazga",
        observedAt: SAMPLE_ISO,
      }),
      provenanceForBroadcast({
        kind: "official",
        hazard: "flood",
        areaLabel: "Bab El Oued",
        observedAt: SAMPLE_ISO,
      }),
      provenanceForBroadcast({
        kind: "earthquake",
        magnitude: 4.5,
        areaLabel: "Béjaïa",
        observedAt: SAMPLE_ISO,
      }),
      provenanceForBroadcast({
        kind: "authority",
        sourceAttribution: "Wilaya d'Alger",
        observedAt: SAMPLE_ISO,
      }),
      provenanceForWatchZoneAlert({
        kind: "risk",
        areaLabel: "Home",
        radiusKm: 15,
        observedAt: SAMPLE_ISO,
      }),
      provenanceForWatchZoneAlert({
        kind: "road",
        sourceAttribution: "Gendarmerie Nationale (Tariki)",
        areaLabel: "RN5",
        radiusKm: 10,
        observedAt: SAMPLE_ISO,
      }),
      provenanceForWatchZoneAlert({
        kind: "citizen",
        areaLabel: "Home",
        radiusKm: 5,
        observedAt: SAMPLE_ISO,
      }),
      provenanceForSelfTest(SAMPLE_ISO),
    ];

    for (const sample of samples) {
      expect(validateProvenanceInvariants(sample)).toEqual([]);
      const roundTrip = parseProvenancePayload(toProvenancePayload(sample));
      expect(roundTrip).not.toBeNull();
      expect(validateProvenanceInvariants(roundTrip!)).toEqual([]);
    }
    expect(KNOWN_SOURCE_ATTRIBUTIONS["local_fwi"]).toBe("Nadhir FWI");
    expect(KNOWN_SOURCE_ATTRIBUTIONS["citizen_reports"]).toBe("Citizen report");
    expect(KNOWN_SOURCE_ATTRIBUTIONS["metar"]).toBe("METAR");
    expect(KNOWN_SOURCE_ATTRIBUTIONS["authority"]).toBe("Official authority");
  });

  it("formats localized provenance digest lines cleanly across ar, fr, en and kab for M2C", () => {
    const prov = provenanceForWatchZoneAlert({
      kind: "official",
      hazard: "flood",
      areaLabel: "Bab El Oued",
      radiusKm: 12,
      observedAt: SAMPLE_ISO,
    });
    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      const line = formatLocalizedProvenanceDigest(
        prov,
        (key, vars) => String(t(key, vars as Record<string, string>)),
        "13:30 UTC+1",
      );
      expect(line, locale).toContain("DGPC");
      expect(line, locale).toContain("Bab El Oued");
      expect(line, locale).toContain("12");
      expect(line, locale).toContain("13:30 UTC+1");
      expect(line, locale).not.toContain("\u2014");
      expect(line, locale).not.toContain("{{");
    }
  });
});
