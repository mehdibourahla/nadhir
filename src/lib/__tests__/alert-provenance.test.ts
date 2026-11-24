import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import {
  ALERT_TRIGGER_KINDS,
  AUTHORITY_STATUSES,
  BANNED_STATUS_LABELS,
  KNOWN_SOURCE_ATTRIBUTIONS,
  PROVENANCE_RULE_KEYS,
  buildAlertProvenance,
  formatProvenanceDigestLine,
  isValidObservedAt,
  parseProvenancePayload,
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

  it("rejects 'safe' and all banned status labels on authorityStatus", () => {
    for (const banned of BANNED_STATUS_LABELS) {
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

  it("validates ISO timestamps accurately via isValidObservedAt", () => {
    expect(isValidObservedAt(SAMPLE_ISO)).toBe(true);
    expect(isValidObservedAt("2026-11-24T12:30:00+01:00")).toBe(true);
    expect(isValidObservedAt("")).toBe(false);
    expect(isValidObservedAt("   ")).toBe(false);
    expect(isValidObservedAt("invalid-date")).toBe(false);
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
