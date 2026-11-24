export const track2En = {
  notificationChannels: {
    urgent: {
      name: "Urgent safety alerts",
      description:
        "Extreme ONM warnings, active civil protection incidents, M5+ earthquakes and probable fires.",
    },
    official: {
      name: "Official bulletins",
      description:
        "Severe ONM weather warnings and official flood, storm or road updates.",
    },
    earthquakes: {
      name: "Earthquakes",
      description:
        "M4.0 to M4.9 earthquakes recorded near your followed communes.",
    },
    civil: {
      name: "Civil updates and digests",
      description:
        "General civil updates, road notices and alert lifecycle summaries.",
    },
    test: {
      name: "Notification tests",
      description:
        "Self-test notifications you trigger to verify delivery on this device.",
    },
    legacy: {
      description:
        "Legacy fallback channel kept for compatibility with earlier app versions.",
    },
  },
  provenance: {
    whySeeing: "Why am I seeing this?",
    triggerLabel: "Matched by",
    areaLabel: "Area",
    ruleLabel: "Rule",
    sourceLabel: "Source",
    observedLabel: "Observed",
    statusLabel: "Basis",
    radiusKm: "within {{km}} km",
    trigger: {
      watch_zone: "Your watch zone",
      current_commune: "Your current commune (resolved on device)",
      commune_topic: "Followed commune alerts",
      wilaya_warning: "Wilaya-level bulletin",
      national_feed: "National hazard feed",
      self_test: "Your notification test",
    },
    authority: {
      official: "Official authority",
      probable: "Probable (multi-signal)",
      observed: "Observed sensor data",
      model: "Model estimate",
    },
    rule: {
      onmExtreme: "ONM Extreme weather warning",
      onmSevere: "ONM Severe weather warning",
      onmWarning: "Official ONM weather bulletin",
      dgpcFire: "Official Civil Protection fire incident",
      dgpcNonFire: "Official Civil Protection flood, storm or road bulletin",
      probableFire: "Satellite thermal detection with independent context",
      m4Quake: "Earthquake M4.0+ within 100 km",
      m5Quake: "Earthquake M5.0+ urgent threshold",
      watchZone: "Hazard detected inside your watch zone",
      roadDanger: "Reported road danger or closure",
      civilUpdate: "Public civil-hazard update",
      selfTest: "Manual delivery test initiated by you",
      generic: "Matched active hazard rule for this area",
    },
  },
};

export type Track2Translation = typeof track2En;
