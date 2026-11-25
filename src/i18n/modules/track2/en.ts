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
  pushTest: {
    title: "Test my notifications",
    subtitle:
      "Send one test notification to this device on the Notification tests channel. This is not a hazard alert.",
    sendButton: "Send test notification",
    sending: "Sending test notification...",
    waiting: "Waiting for delivery confirmation ({{seconds}}s remaining)...",
    confirmReceived: "I received it",
    notReceivedYet: "Not received yet",
    received: "Test notification received at {{time}}.",
    sendAnother: "Send another test",
    timeoutTitle: "No delivery confirmation after {{seconds}}s",
    timeoutBody:
      "If the notification did not appear, check Android battery optimization, Do Not Disturb, and Nadhir notification channels below.",
    openGuide: "Open Android battery guide",
    channelNote:
      "Delivered on the Notification tests channel so urgent alerts stay distinct.",
    webNote:
      "In a web browser, keep notifications allowed in your browser and OS settings. On Android phones, check the battery guide below if alerts arrive late.",
    permissionDenied:
      "Notifications are blocked on this device. Allow notifications in your system or browser settings, then try again.",
    unsupported: "Push notifications are not supported in this browser.",
    unconfigured: "Push delivery is temporarily unavailable.",
    tryAgain: "Try again",
    errors: {
      unsupported: "Push notifications are not supported on this device.",
      unconfigured: "Push delivery is not configured right now.",
      denied:
        "Notification permission was denied. Enable notifications in settings and retry.",
      signIn: "Sign in again to test notifications on your account.",
      deviceNotRegistered:
        "Enable notifications for this device above first so Nadhir can verify this device belongs to your account.",
      rateLimited:
        "Too many test requests. Please wait {{seconds}}s before trying again.",
      invalid: "Could not validate this device token. Reload and try again.",
      providerFailed:
        "The notification provider rejected this test. Refresh notifications and try again.",
      unavailable:
        "Notification test is temporarily unavailable. Please try again shortly.",
    },
  },
  oemBattery: {
    title: "Android battery guide (if alerts are delayed)",
    subtitle:
      "Many Android phones pause background apps to save battery. Adjust these settings for your phone brand.",
    toggleShow: "Show steps",
    toggleHide: "Hide steps",
    intro:
      "Follow the steps for your device so Nadhir can deliver urgent hazard alerts while the screen is locked.",
    channelsHint:
      "Also check Settings > Apps > Nadhir > Notifications and keep Urgent safety alerts, Official bulletins, Earthquakes, and Notification tests enabled.",
    tabListLabel: "Choose your Android phone manufacturer",
    stepNumber: "Step {{n}}",
    hmsCaveat:
      "Huawei devices shipped without Google Play Services (HMS only) cannot receive Firebase push notifications natively. Use the Nadhir web app or official Telegram and WhatsApp channels.",
    oems: {
      xiaomi: {
        name: "Xiaomi / Redmi / POCO",
        subtitle: "MIUI / HyperOS",
        steps: {
          s1: "Open Settings > Apps > Manage apps > Nadhir and turn on Autostart.",
          s2: "On the same Nadhir app screen, open Battery saver and select No restrictions.",
          s3: "Open Notifications on Nadhir's app screen and allow lock screen alerts, sound, vibration, and Urgent safety alerts.",
          s4: "If alerts still pause, open the Security app > Battery, confirm Nadhir has no restrictions, and lock Nadhir in Recent Apps.",
        },
      },
      samsung: {
        name: "Samsung Galaxy",
        subtitle: "OneUI",
        steps: {
          s1: "Open Settings > Apps > Nadhir > Battery and select Unrestricted.",
          s2: "Open Settings > Battery > Background usage limits > Never auto sleeping apps, tap +, and add Nadhir.",
          s3: "In Background usage limits, check Sleeping apps and Deep sleeping apps and remove Nadhir if it appears.",
          s4: "Open Settings > Apps > Nadhir > Notifications > Notification categories and enable sound and pop-up for Urgent safety alerts and Official bulletins.",
        },
      },
      huawei: {
        name: "Huawei / Honor",
        subtitle: "EMUI / MagicOS",
        steps: {
          s1: "Open Settings > Battery > App launch, find Nadhir, turn off Manage automatically, and enable Auto-launch, Secondary launch, and Run in background.",
          s2: "Open Settings > Apps > Apps > menu > Special access > Battery optimization > All apps > Nadhir and choose Don't allow.",
          s3: "Open Settings > Notifications > Nadhir and allow notifications, banners, and lock screen alerts.",
          s4: "If your Huawei model has no Google Play Services (HMS only), native Firebase push cannot work; use the web app or official Telegram and WhatsApp channels.",
        },
      },
      oppo: {
        name: "Oppo / Realme",
        subtitle: "ColorOS / Realme UI",
        steps: {
          s1: "Open Settings > Apps > App management > Nadhir > Battery usage and enable Allow foreground activity, Allow background activity, and Allow auto-launch.",
          s2: "Open Settings > Battery > More settings > Optimize battery use > Nadhir and select Don't optimize.",
          s3: "In Settings > Battery > More settings, disable Sleep standby optimization so overnight alerts are not delayed.",
          s4: "Open Settings > Apps > App management > Nadhir > Manage notifications and allow lock screen alerts, banners, and sound.",
        },
      },
      tecno: {
        name: "Tecno / Infinix",
        subtitle: "HiOS / XOS",
        steps: {
          s1: "Open Phone Master (or Settings > App management > Auto-start management) and enable Nadhir.",
          s2: "Open Settings > Battery Lab (or Battery) > Battery settings > Battery optimization > All apps > Nadhir and choose Don't optimize.",
          s3: "Open Phone Master > Toolbox > App Freeze (or Battery Lab > App power consumption) and verify Nadhir is unfrozen and allowed in background.",
          s4: "Open Settings > Notification center > Nadhir and allow notifications, lock screen alerts, and sound.",
        },
      },
    },
  },
};

export type Track2Translation = typeof track2En;
