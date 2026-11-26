import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import {
  ANDROID_IMPORTANCE,
  CAPACITOR_IMPORTANCE,
  DEFAULT_LOCAL_NOTIFICATION_EXACT,
  LEGACY_NOTIFICATION_CHANNEL_ID,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_IDS,
  NOTIFICATION_CHANNEL_MAP,
  channelFromFcmData,
  channelSpec,
  isNotificationChannelId,
  resolveNotificationChannel,
} from "@/lib/notification-channels";

describe("notification channel contract", () => {
  it("defines the 6 canonical channel IDs with matching specs and safety constants", () => {
    expect(NOTIFICATION_CHANNEL_IDS).toEqual([
      "alerts_urgent",
      "alerts_official",
      "alerts_earthquakes",
      "alerts_civil",
      "alerts_test",
      "alerts",
    ]);
    expect(LEGACY_NOTIFICATION_CHANNEL_ID).toBe("alerts");
    expect(DEFAULT_LOCAL_NOTIFICATION_EXACT).toBe(false);
    expect(ANDROID_IMPORTANCE).toEqual({ DEFAULT: 3, HIGH: 4 });
    expect(CAPACITOR_IMPORTANCE).toEqual({ DEFAULT: 3, HIGH: 4, MAX: 5 });

    expect(NOTIFICATION_CHANNELS.map((spec) => spec.id)).toEqual([
      ...NOTIFICATION_CHANNEL_IDS,
    ]);
    for (const id of NOTIFICATION_CHANNEL_IDS) {
      expect(NOTIFICATION_CHANNEL_MAP[id]).toBe(channelSpec(id));
      expect(channelSpec(id).visibility).toBe(1);
      expect(channelSpec(id).sound).toBe("default");
    }

    expect(channelSpec("alerts").isLegacyFallback).toBe(true);
    expect(
      NOTIFICATION_CHANNELS.filter((s) => s.isLegacyFallback).map((s) => s.id),
    ).toEqual(["alerts"]);

    expect(Object.isFrozen(NOTIFICATION_CHANNEL_IDS)).toBe(true);
    expect(Object.isFrozen(NOTIFICATION_CHANNELS)).toBe(true);
    for (const spec of NOTIFICATION_CHANNELS) {
      expect(Object.isFrozen(spec)).toBe(true);
    }
    expect(Object.isFrozen(NOTIFICATION_CHANNEL_MAP)).toBe(true);
    expect(Object.getPrototypeOf(NOTIFICATION_CHANNEL_MAP)).toBeNull();
    expect(Object.isFrozen(ANDROID_IMPORTANCE)).toBe(true);
    expect(Object.isFrozen(CAPACITOR_IMPORTANCE)).toBe(true);
  });

  it("returns undefined from channelSpec for prototype-chain keys", () => {
    expect(channelSpec("toString" as never)).toBeUndefined();
    expect(channelSpec("__proto__" as never)).toBeUndefined();
    expect(channelSpec("constructor" as never)).toBeUndefined();
    expect(channelSpec("hasOwnProperty" as never)).toBeUndefined();
  });

  it("resolves every channel name and description key in ar, fr, en and kab with zero em dashes", () => {
    for (const locale of ["ar", "fr", "en", "kab"] as const) {
      const t = i18n.getFixedT(locale);
      for (const spec of NOTIFICATION_CHANNELS) {
        const name = t(spec.i18nNameKey);
        const description = t(spec.i18nDescriptionKey);
        expect(name, `${locale}:${spec.i18nNameKey}`).not.toBe(
          spec.i18nNameKey,
        );
        expect(
          name.trim().length,
          `${locale}:${spec.i18nNameKey}`,
        ).toBeGreaterThan(0);
        expect(name, `${locale}:${spec.i18nNameKey}`).not.toContain("\u2014");

        expect(description, `${locale}:${spec.i18nDescriptionKey}`).not.toBe(
          spec.i18nDescriptionKey,
        );
        expect(
          description.trim().length,
          `${locale}:${spec.i18nDescriptionKey}`,
        ).toBeGreaterThan(0);
        expect(
          description,
          `${locale}:${spec.i18nDescriptionKey}`,
        ).not.toContain("\u2014");
      }
    }
  });

  it("validates channel IDs strictly via isNotificationChannelId", () => {
    for (const id of NOTIFICATION_CHANNEL_IDS) {
      expect(isNotificationChannelId(id)).toBe(true);
    }
    expect(isNotificationChannelId("unknown")).toBe(false);
    expect(isNotificationChannelId("")).toBe(false);
    expect(isNotificationChannelId(null)).toBe(false);
    expect(isNotificationChannelId(undefined)).toBe(false);
    expect(isNotificationChannelId(42)).toBe(false);
  });
});

describe("resolveNotificationChannel", () => {
  it("routes test notifications to alerts_test", () => {
    expect(resolveNotificationChannel({ kind: "test" })).toBe("alerts_test");
    expect(resolveNotificationChannel({ kind: "TEST", phase: "end" })).toBe(
      "alerts_test",
    );
  });

  it("downgrades terminal phases and statuses to alerts_civil", () => {
    for (const phase of ["end", "cancel", "observation_ended"]) {
      expect(
        resolveNotificationChannel({
          kind: "fire",
          severity: "Extreme",
          phase,
        }),
      ).toBe("alerts_civil");
    }
    for (const status of ["cleared", "extinguished", "withdrawn"]) {
      expect(
        resolveNotificationChannel({
          kind: "official",
          severity: "Extreme",
          status,
        }),
      ).toBe("alerts_civil");
    }
  });

  it("routes active fires to alerts_urgent", () => {
    expect(resolveNotificationChannel({ kind: "fire" })).toBe("alerts_urgent");
    expect(
      resolveNotificationChannel({ kind: "fire", severity: "Severe" }),
    ).toBe("alerts_urgent");
  });

  it("routes ONM and weather alerts using the 1..4 ONM_SEVERITY scale", () => {
    // ONM_SEVERITY: Minor=1, Moderate=2, Severe=3, Extreme=4 (defensive >=4 -> urgent)
    expect(
      resolveNotificationChannel({ kind: "onm", severity: "Extreme" }),
    ).toBe("alerts_urgent");
    expect(resolveNotificationChannel({ kind: "onm", severity: 4 })).toBe(
      "alerts_urgent",
    );
    expect(resolveNotificationChannel({ kind: "onm", severity: 5 })).toBe(
      "alerts_urgent",
    );
    expect(
      resolveNotificationChannel({ kind: "weather", severity: "extreme" }),
    ).toBe("alerts_urgent");
    expect(resolveNotificationChannel({ kind: "weather", severity: 4 })).toBe(
      "alerts_urgent",
    );
    expect(resolveNotificationChannel({ kind: "weather", severity: "4" })).toBe(
      "alerts_urgent",
    );

    expect(
      resolveNotificationChannel({ kind: "onm", severity: "Severe" }),
    ).toBe("alerts_official");
    expect(resolveNotificationChannel({ kind: "onm", severity: 3 })).toBe(
      "alerts_official",
    );
    expect(resolveNotificationChannel({ kind: "weather", severity: 3 })).toBe(
      "alerts_official",
    );
    expect(resolveNotificationChannel({ kind: "weather", severity: "3" })).toBe(
      "alerts_official",
    );

    expect(
      resolveNotificationChannel({ kind: "onm", severity: "Moderate" }),
    ).toBe("alerts_civil");
    expect(resolveNotificationChannel({ kind: "onm", severity: 2 })).toBe(
      "alerts_civil",
    );
    expect(resolveNotificationChannel({ kind: "weather", severity: 2 })).toBe(
      "alerts_civil",
    );
    expect(resolveNotificationChannel({ kind: "weather", severity: 1 })).toBe(
      "alerts_civil",
    );
    expect(resolveNotificationChannel({ kind: "weather" })).toBe(
      "alerts_civil",
    );
  });

  it("distinguishes DGPC official fire vs non-fire hazards using AUTHORITY_SEVERITY (Severe=4, Extreme=5)", () => {
    expect(resolveNotificationChannel({ kind: "official" })).toBe(
      "alerts_urgent",
    );
    expect(
      resolveNotificationChannel({ kind: "official", hazard: "fire" }),
    ).toBe("alerts_urgent");
    expect(
      resolveNotificationChannel({
        kind: "official",
        hazard: "flood",
        severity: "Extreme",
      }),
    ).toBe("alerts_urgent");
    expect(
      resolveNotificationChannel({
        kind: "official",
        hazard: "flood",
        severity: 5,
      }),
    ).toBe("alerts_urgent");
    expect(
      resolveNotificationChannel({
        kind: "official",
        hazard: "flood",
        severity: 4,
      }),
    ).toBe("alerts_official");

    for (const hazard of [
      "flood",
      "flooding",
      "storm",
      "weather",
      "road",
      "structure",
      "other",
    ]) {
      expect(
        resolveNotificationChannel({
          kind: "official",
          hazard,
          severity: "Severe",
        }),
        `official hazard=${hazard}`,
      ).toBe("alerts_official");
    }
  });

  it("routes authority warnings to urgent on Extreme (or numeric >= 5) else official", () => {
    expect(
      resolveNotificationChannel({ kind: "authority", severity: "Extreme" }),
    ).toBe("alerts_urgent");
    expect(resolveNotificationChannel({ kind: "authority", severity: 5 })).toBe(
      "alerts_urgent",
    );
    expect(
      resolveNotificationChannel({ kind: "authority", severity: "Severe" }),
    ).toBe("alerts_official");
    expect(resolveNotificationChannel({ kind: "authority", severity: 4 })).toBe(
      "alerts_official",
    );
    expect(resolveNotificationChannel({ kind: "authority" })).toBe(
      "alerts_official",
    );
  });

  it("routes earthquakes by magnitude with watch-zone severity fallback (4=M5+, 3=M4.0-4.9)", () => {
    expect(
      resolveNotificationChannel({ kind: "earthquake", magnitude: 5.0 }),
    ).toBe("alerts_urgent");
    expect(
      resolveNotificationChannel({ kind: "earthquake", magnitude: 6.4 }),
    ).toBe("alerts_urgent");
    expect(
      resolveNotificationChannel({ kind: "earthquake", magnitude: 4.0 }),
    ).toBe("alerts_earthquakes");
    expect(
      resolveNotificationChannel({ kind: "earthquake", magnitude: 4.9 }),
    ).toBe("alerts_earthquakes");
    expect(
      resolveNotificationChannel({ kind: "earthquake", magnitude: 3.9 }),
    ).toBe("alerts_civil");
    expect(
      resolveNotificationChannel({ kind: "earthquake", severity: "Extreme" }),
    ).toBe("alerts_urgent");
    expect(
      resolveNotificationChannel({ kind: "earthquake", severity: 4 }),
    ).toBe("alerts_urgent");
    expect(
      resolveNotificationChannel({ kind: "earthquake", severity: "4" }),
    ).toBe("alerts_urgent");
    expect(
      resolveNotificationChannel({
        kind: "earthquake",
        magnitude: Number.NaN,
        severity: 4,
      }),
    ).toBe("alerts_urgent");
    expect(
      resolveNotificationChannel({ kind: "earthquake", severity: 3 }),
    ).toBe("alerts_earthquakes");
    expect(resolveNotificationChannel({ kind: "earthquake" })).toBe(
      "alerts_earthquakes",
    );
    expect(
      resolveNotificationChannel({ kind: "earthquake", magnitude: Number.NaN }),
    ).toBe("alerts_earthquakes");
  });

  it("routes civil kinds to alerts_civil and unknown kinds to legacy alerts", () => {
    for (const kind of ["road", "citizen", "risk", "civil", "digest"]) {
      expect(resolveNotificationChannel({ kind })).toBe("alerts_civil");
    }
    expect(resolveNotificationChannel({ kind: "unexpected_future_kind" })).toBe(
      "alerts",
    );
    expect(resolveNotificationChannel({ kind: "" })).toBe("alerts");
  });
});

describe("channelFromFcmData", () => {
  it("prefers a valid explicit channel_id", () => {
    expect(
      channelFromFcmData({
        channel_id: "alerts_earthquakes",
        kind: "civil",
      }),
    ).toBe("alerts_earthquakes");
  });

  it("derives channel from FCM string fields when channel_id is missing or invalid", () => {
    expect(
      channelFromFcmData({
        channel_id: "bogus",
        kind: "onm",
        severity: "Extreme",
      }),
    ).toBe("alerts_urgent");
    expect(
      channelFromFcmData({
        kind: "official",
        hazard: "flood",
        severity: "Severe",
      }),
    ).toBe("alerts_official");
    expect(
      channelFromFcmData({
        kind: "earthquake",
        magnitude: "5.3",
      }),
    ).toBe("alerts_urgent");
    expect(
      channelFromFcmData({
        kind: "earthquake",
        magnitude: "4.4",
      }),
    ).toBe("alerts_earthquakes");
    expect(
      channelFromFcmData({
        kind: "earthquake",
        magnitude: "",
      }),
    ).toBe("alerts_earthquakes");
    expect(
      channelFromFcmData({
        kind: "fire",
        phase: "cancel",
      }),
    ).toBe("alerts_civil");
  });

  it("falls back to legacy alerts on malformed, empty, or prototype-inherited payloads", () => {
    expect(channelFromFcmData(null)).toBe("alerts");
    expect(channelFromFcmData(undefined)).toBe("alerts");
    expect(channelFromFcmData("alerts_urgent")).toBe("alerts");
    expect(channelFromFcmData([])).toBe("alerts");
    expect(channelFromFcmData({})).toBe("alerts");

    const inheritedChannel = Object.create({ channel_id: "alerts_urgent" });
    expect(channelFromFcmData(inheritedChannel)).toBe("alerts");

    const inheritedKind = Object.create({ kind: "fire", severity: "Extreme" });
    expect(channelFromFcmData(inheritedKind)).toBe("alerts");
  });
});
