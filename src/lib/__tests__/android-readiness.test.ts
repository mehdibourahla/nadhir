import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import capacitorConfig from "../../../capacitor.config";
import i18n from "@/i18n";
import {
  ANDROID_IMPORTANCE,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_IDS,
} from "@/lib/notification-channels";

const ROOT = resolve(__dirname, "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function parseXmlStrings(xml: string): Map<string, string> {
  const entries = new Map<string, string>();
  const pattern = /<string\s+name="([^"]+)">([\s\S]*?)<\/string>/g;
  for (const match of xml.matchAll(pattern)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      entries.set(name, value);
    }
  }
  return entries;
}

function parseJavaStringConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  const pattern =
    /public\s+static\s+final\s+String\s+([A-Z0-9_]+)\s*=\s*"([^"]+)"\s*;/g;
  for (const match of source.matchAll(pattern)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      constants.set(name, value);
    }
  }
  return constants;
}

interface ParsedJavaChannelSpec {
  id: string;
  importance: number;
  vibration: boolean;
  lights: boolean;
  visibility: number;
  nameResKey: string;
  descriptionResKey: string;
  legacyFallback: boolean;
}

const IMPORTANCE_MAP: Record<string, number> = {
  "NotificationManager.IMPORTANCE_DEFAULT": ANDROID_IMPORTANCE.DEFAULT,
  "NotificationManager.IMPORTANCE_HIGH": ANDROID_IMPORTANCE.HIGH,
};

const VISIBILITY_MAP: Record<string, number> = {
  "Notification.VISIBILITY_PUBLIC": 1,
};

function parseJavaChannelSpecs(source: string): ParsedJavaChannelSpec[] {
  const constants = parseJavaStringConstants(source);
  const specPattern =
    /new\s+Spec\(\s*([A-Z0-9_]+|"[^"]+")\s*,\s*([A-Za-z0-9_.]+)\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*([A-Za-z0-9_.]+)\s*,\s*R\.string\.([a-z0-9_]+)\s*,\s*R\.string\.([a-z0-9_]+)\s*,\s*(true|false)\s*\)/g;

  const specs: ParsedJavaChannelSpec[] = [];
  for (const match of source.matchAll(specPattern)) {
    const [
      ,
      rawId,
      rawImportance,
      rawVibration,
      rawLights,
      rawVisibility,
      nameResKey,
      descriptionResKey,
      rawLegacy,
    ] = match;

    if (
      rawId === undefined ||
      rawImportance === undefined ||
      rawVibration === undefined ||
      rawLights === undefined ||
      rawVisibility === undefined ||
      nameResKey === undefined ||
      descriptionResKey === undefined ||
      rawLegacy === undefined
    ) {
      throw new Error(
        "Incomplete Spec(...) match in NotificationChannels.java",
      );
    }

    const id = rawId.startsWith('"')
      ? rawId.slice(1, -1)
      : (constants.get(rawId) ?? rawId);
    const importance = IMPORTANCE_MAP[rawImportance];
    const visibility = VISIBILITY_MAP[rawVisibility];

    if (importance === undefined) {
      throw new Error(`Unknown Java importance expression: ${rawImportance}`);
    }
    if (visibility === undefined) {
      throw new Error(`Unknown Java visibility expression: ${rawVisibility}`);
    }

    specs.push({
      id,
      importance,
      vibration: rawVibration === "true",
      lights: rawLights === "true",
      visibility,
      nameResKey,
      descriptionResKey,
      legacyFallback: rawLegacy === "true",
    });
  }
  return specs;
}

function activeProguardLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

const CHANNEL_RES_KEY_BY_ID: Record<
  string,
  { name: string; description: string }
> = {
  alerts_urgent: {
    name: "notification_channel_urgent_name",
    description: "notification_channel_urgent_description",
  },
  alerts_official: {
    name: "notification_channel_official_name",
    description: "notification_channel_official_description",
  },
  alerts_earthquakes: {
    name: "notification_channel_earthquakes_name",
    description: "notification_channel_earthquakes_description",
  },
  alerts_civil: {
    name: "notification_channel_civil_name",
    description: "notification_channel_civil_description",
  },
  alerts_test: {
    name: "notification_channel_test_name",
    description: "notification_channel_test_description",
  },
  alerts: {
    name: "notification_channel_legacy_name",
    description: "notification_channel_legacy_description",
  },
};

describe("Android manifest and security XML hardening", () => {
  const manifest = readRepoFile("android/app/src/main/AndroidManifest.xml");

  it("declares required permissions and strips Play-rejected SCHEDULE_EXACT_ALARM", () => {
    expect(manifest).toContain(
      'xmlns:tools="http://schemas.android.com/tools"',
    );
    for (const permission of [
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.RECEIVE_BOOT_COMPLETED",
    ]) {
      expect(manifest).toContain(`android:name="${permission}"`);
    }

    expect(manifest).toMatch(
      /<uses-permission[^>]*android:name="android\.permission\.SCHEDULE_EXACT_ALARM"[^>]*tools:node="remove"[^>]*\/>/s,
    );
  });

  it("hardens application backup, cleartext traffic, RTL, notification metadata, and component exports", () => {
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:fullBackupContent="@xml/backup_rules"');
    expect(manifest).toContain(
      'android:dataExtractionRules="@xml/data_extraction_rules"',
    );
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toContain(
      'android:networkSecurityConfig="@xml/network_security_config"',
    );
    expect(manifest).toContain('android:supportsRtl="true"');

    expect(manifest).toContain(
      'android:name="com.google.firebase.messaging.default_notification_icon"',
    );
    expect(manifest).toContain('android:resource="@drawable/ic_stat_nadhir"');
    expect(manifest).toContain(
      'android:name="com.google.firebase.messaging.default_notification_channel_id"',
    );
    expect(manifest).toContain('android:value="alerts"');

    expect(manifest).toMatch(
      /<receiver[^>]*android:name="\.commune\.CommuneLocationReceiver"[^>]*android:exported="false"/s,
    );
    expect(manifest).toMatch(
      /<receiver[^>]*android:name="\.commune\.CommuneBootReceiver"[^>]*android:exported="false"/s,
    );
    expect(manifest).toMatch(
      /<provider[^>]*android:name="androidx\.core\.content\.FileProvider"[^>]*android:exported="false"/s,
    );
  });

  it("keeps MainActivity auth callback filter and avoids unscoped https App Links capturing /auth or web-only routes", () => {
    expect(manifest).toMatch(
      /<data\s+android:scheme="app\.nadhir"\s+android:host="auth"\s+android:path="\/callback"\s*\/>/,
    );

    const httpsFilters = manifest.match(
      /<intent-filter[^>]*>[\s\S]*?android:scheme="https"[\s\S]*?<\/intent-filter>/g,
    );
    expect(httpsFilters).toBeNull();
  });

  it("ships explicit backup_rules, data_extraction_rules, and network_security_config XML files", () => {
    const backupRules = readRepoFile(
      "android/app/src/main/res/xml/backup_rules.xml",
    );
    const dataExtractionRules = readRepoFile(
      "android/app/src/main/res/xml/data_extraction_rules.xml",
    );
    const networkSecurityConfig = readRepoFile(
      "android/app/src/main/res/xml/network_security_config.xml",
    );

    for (const domain of [
      "root",
      "file",
      "database",
      "sharedpref",
      "external",
    ]) {
      expect(backupRules).toContain(`<exclude domain="${domain}" path="." />`);
      expect(dataExtractionRules).toContain(
        `<exclude domain="${domain}" path="." />`,
      );
    }
    expect(dataExtractionRules).toContain("<cloud-backup>");
    expect(dataExtractionRules).toContain("<device-transfer>");
    expect(networkSecurityConfig).toContain(
      '<base-config cleartextTrafficPermitted="false" />',
    );
  });
});

describe("Native Android startup notification channels parity", () => {
  const channelsJava = readRepoFile(
    "android/app/src/main/java/app/nadhir/NotificationChannels.java",
  );
  const mainActivityJava = readRepoFile(
    "android/app/src/main/java/app/nadhir/MainActivity.java",
  );
  const bootReceiverJava = readRepoFile(
    "android/app/src/main/java/app/nadhir/commune/CommuneBootReceiver.java",
  );
  const channelsTestJava = readRepoFile(
    "android/app/src/test/java/app/nadhir/NotificationChannelsTest.java",
  );

  it("mirrors every canonical channel in NOTIFICATION_CHANNELS in exact order and properties", () => {
    const parsedSpecs = parseJavaChannelSpecs(channelsJava);
    expect(parsedSpecs).toHaveLength(NOTIFICATION_CHANNELS.length);
    expect(parsedSpecs.map((spec) => spec.id)).toEqual([
      ...NOTIFICATION_CHANNEL_IDS,
    ]);

    for (let i = 0; i < NOTIFICATION_CHANNELS.length; i++) {
      const canonical = NOTIFICATION_CHANNELS[i];
      const nativeSpec = parsedSpecs[i];
      expect(canonical).toBeDefined();
      expect(nativeSpec).toBeDefined();
      if (!canonical || !nativeSpec) continue;

      const expectedRes = CHANNEL_RES_KEY_BY_ID[canonical.id];
      expect(expectedRes).toBeDefined();
      if (!expectedRes) continue;

      expect(nativeSpec.id).toBe(canonical.id);
      expect(nativeSpec.importance).toBe(canonical.androidImportance);
      expect(nativeSpec.vibration).toBe(canonical.vibration);
      expect(nativeSpec.lights).toBe(canonical.lights);
      expect(nativeSpec.visibility).toBe(canonical.visibility);
      expect(nativeSpec.legacyFallback).toBe(canonical.isLegacyFallback);
      expect(nativeSpec.nameResKey).toBe(expectedRes.name);
      expect(nativeSpec.descriptionResKey).toBe(expectedRes.description);
    }

    expect(channelsJava).toContain(
      "Build.VERSION.SDK_INT < Build.VERSION_CODES.O",
    );
    expect(channelsJava).toContain("if (manager == null) return;");
    expect(channelsJava).toContain("AudioAttributes.USAGE_NOTIFICATION");
    expect(channelsJava).toContain("AudioAttributes.CONTENT_TYPE_SONIFICATION");
    expect(channelsJava).toContain("Settings.System.DEFAULT_NOTIFICATION_URI");
    expect(channelsJava).toContain(
      "manager.createNotificationChannels(channels)",
    );
  });

  it("registers channels in MainActivity before super.onCreate and in CommuneBootReceiver before enabled check", () => {
    const ensureIndex = mainActivityJava.indexOf(
      "NotificationChannels.ensureAll(this);",
    );
    const superOnCreateIndex = mainActivityJava.indexOf(
      "super.onCreate(savedInstanceState);",
    );
    expect(ensureIndex).toBeGreaterThan(-1);
    expect(superOnCreateIndex).toBeGreaterThan(ensureIndex);
    expect(mainActivityJava).toContain("if (connectivity != null)");

    expect(bootReceiverJava).toContain(
      "import app.nadhir.NotificationChannels;",
    );
    const bootEnsureIndex = bootReceiverJava.indexOf(
      "NotificationChannels.ensureAll(context);",
    );
    const enabledCheckIndex = bootReceiverJava.indexOf(
      "if (!CommuneTracker.enabled(context)) return;",
    );
    expect(bootEnsureIndex).toBeGreaterThan(-1);
    expect(enabledCheckIndex).toBeGreaterThan(bootEnsureIndex);
  });

  it("includes plain JUnit 4 NotificationChannelsTest covering all 6 channels", () => {
    expect(channelsTestJava).toContain("package app.nadhir;");
    expect(channelsTestJava).toContain("import org.junit.Test;");
    expect(channelsTestJava).not.toContain("Robolectric");
    expect(channelsTestJava).not.toContain("Mockito");
    for (const id of NOTIFICATION_CHANNEL_IDS) {
      expect(channelsTestJava).toContain(`"${id}"`);
    }
  });

  it("provides exact 4-locale strings.xml channel names and descriptions matching i18n with valid XML", () => {
    const localeFiles: Array<{
      locale: "en" | "ar" | "fr" | "kab";
      path: string;
    }> = [
      { locale: "en", path: "android/app/src/main/res/values/strings.xml" },
      { locale: "ar", path: "android/app/src/main/res/values-ar/strings.xml" },
      { locale: "fr", path: "android/app/src/main/res/values-fr/strings.xml" },
      {
        locale: "kab",
        path: "android/app/src/main/res/values-b+kab/strings.xml",
      },
    ];

    const defaultStrings = parseXmlStrings(
      readRepoFile("android/app/src/main/res/values/strings.xml"),
    );
    for (const coreKey of [
      "app_name",
      "title_activity_main",
      "package_name",
      "custom_url_scheme",
    ]) {
      expect(defaultStrings.has(coreKey), `missing ${coreKey}`).toBe(true);
    }

    for (const { locale, path } of localeFiles) {
      const xml = readRepoFile(path);
      const strings = parseXmlStrings(xml);
      const t = i18n.getFixedT(locale);

      for (const spec of NOTIFICATION_CHANNELS) {
        const resKeys = CHANNEL_RES_KEY_BY_ID[spec.id];
        expect(resKeys).toBeDefined();
        if (!resKeys) continue;

        const expectedName = t(spec.i18nNameKey);
        const expectedDescription = t(spec.i18nDescriptionKey);

        const actualName = strings.get(resKeys.name);
        const actualDescription = strings.get(resKeys.description);

        expect(actualName, `${locale}:${resKeys.name}`).toBe(expectedName);
        expect(actualDescription, `${locale}:${resKeys.description}`).toBe(
          expectedDescription,
        );

        for (const value of [actualName ?? "", actualDescription ?? ""]) {
          expect(value).not.toContain("\u2014");
          expect(value).not.toMatch(/\bsafe\b/i);
          expect(value).not.toMatch(/(?<!\\)['"]/);
          expect(value).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
          expect(value).not.toContain("<");
          expect(value).not.toContain(">");
        }
      }
    }
  });
});

describe("Gradle and ProGuard / R8 release hardening", () => {
  const buildGradle = readRepoFile("android/app/build.gradle");
  const variablesGradle = readRepoFile("android/variables.gradle");
  const proguardRules = readRepoFile("android/app/proguard-rules.pro");

  it("configures SDK levels, monotonic default versionCode >= 4, env overrides, and R8 release shrinking", () => {
    expect(buildGradle).toContain('namespace = "app.nadhir"');
    expect(buildGradle).toContain('applicationId "app.nadhir"');

    const minSdk = Number(
      variablesGradle.match(/minSdkVersion\s*=\s*(\d+)/)?.[1],
    );
    const compileSdk = Number(
      variablesGradle.match(/compileSdkVersion\s*=\s*(\d+)/)?.[1],
    );
    const targetSdk = Number(
      variablesGradle.match(/targetSdkVersion\s*=\s*(\d+)/)?.[1],
    );
    expect(minSdk).toBeGreaterThanOrEqual(24);
    expect(compileSdk).toBeGreaterThanOrEqual(35);
    expect(targetSdk).toBeGreaterThanOrEqual(35);

    const defaultVersionCodeMatch = buildGradle.match(
      /NADHIR_ANDROID_VERSION_CODE[\s\S]*?:\s*"(\d+)"/,
    );
    expect(defaultVersionCodeMatch).not.toBeNull();
    expect(Number(defaultVersionCodeMatch?.[1])).toBeGreaterThanOrEqual(4);
    expect(buildGradle).toContain("nadhirVersionCode");
    expect(buildGradle).toContain("NADHIR_ANDROID_VERSION_NAME");
    expect(buildGradle).toContain("nadhirVersionName");

    expect(buildGradle).toContain("minifyEnabled true");
    expect(buildGradle).toContain("shrinkResources true");
    expect(buildGradle).toContain("proguard-android-optimize.txt");
    expect(buildGradle).not.toContain("'proguard-android.txt'");
    expect(buildGradle).not.toContain('"proguard-android.txt"');
  });

  it("loads release signing strictly from env vars with task-graph validation and zero hardcoded secrets", () => {
    expect(buildGradle).toContain('System.getenv("NADHIR_UPLOAD_STORE")');
    expect(buildGradle).toContain('System.getenv("NADHIR_UPLOAD_PASSWORD")');
    expect(buildGradle).toContain('System.getenv("NADHIR_UPLOAD_KEY_ALIAS")');
    expect(buildGradle).toContain(
      'System.getenv("NADHIR_UPLOAD_KEY_PASSWORD")',
    );
    expect(buildGradle).toContain("gradle.taskGraph.whenReady");
    expect(buildGradle).toContain("assembleRelease");
    expect(buildGradle).toContain("bundleRelease");
    expect(buildGradle).toContain("GradleException");

    expect(buildGradle).not.toMatch(/storePassword\s+["'][^"']+["']/);
    expect(buildGradle).not.toMatch(/keyPassword\s+["'][^"']+["']/);
    expect(buildGradle).not.toMatch(/\.jks|\.keystore/i);
  });

  it("defines active non-comment R8 keep rules for Capacitor, WebView bridges, auth, commune, and notification channels", () => {
    const activeText = activeProguardLines(proguardRules).join("\n");
    for (const ruleFragment of [
      "-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable",
      "-renamesourcefileattribute SourceFile",
      "@android.webkit.JavascriptInterface <methods>;",
      "@com.getcapacitor.annotation.CapacitorPlugin",
      "@com.getcapacitor.PluginMethod",
      "@com.getcapacitor.annotation.PermissionCallback",
      "@com.getcapacitor.annotation.ActivityCallback",
      "@com.getcapacitor.annotation.Permission",
      "extends com.getcapacitor.Plugin",
      "app.nadhir.MainActivity",
      "app.nadhir.NotificationChannels",
      "app.nadhir.NotificationChannels$*",
      "app.nadhir.auth.NativeAuthPlugin",
      "app.nadhir.commune.**",
      "io.capawesome.capacitorjs.plugins.firebase.messaging.**",
      "com.capacitorjs.plugins.**",
    ]) {
      expect(activeText, `missing ProGuard rule: ${ruleFragment}`).toContain(
        ruleFragment,
      );
    }
  });
});

describe("Digital Asset Links metadata (public/.well-known/assetlinks.json)", () => {
  const PLACEHOLDER = "REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT";
  const SHA256_REGEX = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
  const FAKE_HEX_PATTERNS = [
    /^00:00:00:00/,
    /^FF:FF:FF:FF/,
    /^AA:BB:CC:DD/,
    /^12:34:56:78/,
    /^DE:AD:BE:EF/,
  ];

  it("matches Google Digital Asset Links schema with valid fingerprint or explicit placeholder", () => {
    const raw = readRepoFile("public/.well-known/assetlinks.json");
    const parsed = JSON.parse(raw) as Array<{
      relation?: unknown;
      target?: {
        namespace?: unknown;
        package_name?: unknown;
        sha256_cert_fingerprints?: unknown;
      };
    }>;

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);

    const entry = parsed[0];
    expect(entry).toBeDefined();
    if (!entry) return;

    expect(entry.relation).toContain(
      "delegate_permission/common.handle_all_urls",
    );
    expect(entry.target?.namespace).toBe("android_app");
    expect(entry.target?.package_name).toBe("app.nadhir");

    const fingerprints = entry.target?.sha256_cert_fingerprints;
    expect(Array.isArray(fingerprints)).toBe(true);
    expect((fingerprints as unknown[]).length).toBeGreaterThanOrEqual(1);

    for (const fp of fingerprints as unknown[]) {
      expect(typeof fp).toBe("string");
      const str = fp as string;
      const isValid = str === PLACEHOLDER || SHA256_REGEX.test(str);
      expect(isValid, `invalid sha256_cert_fingerprint: ${str}`).toBe(true);
      for (const fakePattern of FAKE_HEX_PATTERNS) {
        expect(str).not.toMatch(fakePattern);
      }
    }
  });
});

describe("Capacitor config and zero undeclared tracking/ad SDKs", () => {
  it("enforces production appId, webDir, no mixed content, and no dev server.url", () => {
    expect(capacitorConfig.appId).toBe("app.nadhir");
    expect(capacitorConfig.webDir).toBe("dist/client");
    expect(capacitorConfig.android?.allowMixedContent).toBe(false);
    expect(capacitorConfig.server?.url).toBeUndefined();
  });

  it("contains zero undeclared analytics, crash-reporting, or ad SDKs in package.json and build.gradle", () => {
    const pkg = readRepoFile("package.json");
    const buildGradle = readRepoFile("android/app/build.gradle");
    const combined = `${pkg}\n${buildGradle}`;

    for (const bannedSdk of [
      "firebase-analytics",
      "firebase-crashlytics",
      "play-services-ads",
      "@sentry/",
      "posthog-js",
      "mixpanel",
    ]) {
      expect(combined, `unexpected SDK found: ${bannedSdk}`).not.toContain(
        bannedSdk,
      );
    }
  });
});

describe("Store listing and Google Play compliance documentation", () => {
  const storeListing = readRepoFile("docs/store-listing.md");

  it("enforces ADR-0002, ADR-0006, antislop, and personal-project hygiene rules", () => {
    expect(storeListing).not.toContain("\u2014");
    expect(storeListing).not.toMatch(/\bsafe\b/i);
    expect(storeListing).not.toMatch(/\bparaito\b/i);
    expect(storeListing).not.toMatch(/\btracking\b/i);
    expect(storeListing).not.toMatch(/\blive location\b/i);
    expect(storeListing).not.toMatch(/\bnear me\b/i);
    expect(storeListing.toLowerCase()).toContain(
      "following never sends your exact position",
    );
  });

  it("documents Data Safety, Background Location disclosure, Play Review notes, release checklist, all 6 channels, and all 4 operational journeys", () => {
    for (const requiredFragment of [
      "## Google Play Data Safety",
      "## Google Play Background Location Disclosure (ACCESS_BACKGROUND_LOCATION)",
      "## Google Play Review Notes and App Content (Android)",
      "## Android Play Production Release and Operational Checklist",
      "DELETE /api/private/account",
      "https://nadhir.app/privacy",
      "Also follow where I am",
      "PRIORITY_BALANCED_POWER_ACCURACY",
      "communes.v1.json",
      "nadhir-background-location.mp4",
      "NADHIR_ANDROID_VERSION_CODE",
      "NADHIR_UPLOAD_STORE",
      "SCHEDULE_EXACT_ALARM",
      'allowBackup="false"',
      "public/.well-known/assetlinks.json",
      "https://nadhir.app/.well-known/assetlinks.json",
      "https://www.nadhir.app/.well-known/assetlinks.json",
      "Background push arrival",
      "Tap-to-open navigation",
      "Offline and restart resilience",
      "Denied permission journeys",
      "two consecutive clean",
    ]) {
      expect(
        storeListing,
        `docs/store-listing.md missing: ${requiredFragment}`,
      ).toContain(requiredFragment);
    }

    for (const channelId of NOTIFICATION_CHANNEL_IDS) {
      expect(storeListing).toContain(channelId);
    }
  });
});

const distClientIndex = resolve(ROOT, "dist/client/index.html");

describe.runIf(existsSync(distClientIndex))(
  "Built native bundle (dist/client) assets and server-secret isolation",
  () => {
    it("emits index.html, matching .well-known/assetlinks.json, and geo/communes.v1.json", () => {
      expect(existsSync(resolve(ROOT, "dist/client/index.html"))).toBe(true);
      const builtAssetLinksPath = resolve(
        ROOT,
        "dist/client/.well-known/assetlinks.json",
      );
      expect(existsSync(builtAssetLinksPath)).toBe(true);
      expect(readFileSync(builtAssetLinksPath, "utf8")).toBe(
        readRepoFile("public/.well-known/assetlinks.json"),
      );
      expect(
        existsSync(resolve(ROOT, "dist/client/geo/communes.v1.json")),
      ).toBe(true);
    });

    it("contains zero server-only secrets or admin client references across dist/client/assets/*.js", () => {
      const assetsDir = resolve(ROOT, "dist/client/assets");
      const jsFiles = readdirSync(assetsDir).filter((file) =>
        file.endsWith(".js"),
      );
      expect(jsFiles.length).toBeGreaterThan(0);

      const forbiddenTokens = [
        "SUPABASE_SERVICE_ROLE_KEY",
        "LLM_FALLBACK_API_KEY",
        "FIREBASE_SERVICE_ACCOUNT",
        "NADHIR_CRON_SECRET",
        "TELEGRAM_BOT_TOKEN",
        "supabaseAdmin",
        "createSupabaseAdminClient",
        "@tanstack/react-start/server-only",
      ];

      for (const file of jsFiles) {
        const content = readFileSync(resolve(assetsDir, file), "utf8");
        for (const token of forbiddenTokens) {
          expect(content, `leaked token ${token} in ${file}`).not.toContain(
            token,
          );
        }
      }
    });
  },
);
