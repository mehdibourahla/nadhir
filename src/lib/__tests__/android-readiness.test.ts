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

function stripXmlComments(xml: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<!--", cursor);
    if (start === -1) {
      out += xml.slice(cursor);
      break;
    }
    out += xml.slice(cursor, start);
    const end = xml.indexOf("-->", start + 4);
    if (end === -1) break;
    cursor = end + 3;
  }
  return out;
}

function stripLineAndBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function parseXmlStrings(xml: string): Map<string, string> {
  const cleaned = stripXmlComments(xml);
  const openTags = cleaned.match(/<resources\b[^>]*>/g) ?? [];
  const closeTags = cleaned.match(/<\/resources>/g) ?? [];
  if (openTags.length !== 1 || closeTags.length !== 1) {
    throw new Error(
      `Expected exactly one <resources>...</resources> block (found ${openTags.length} open, ${closeTags.length} close)`,
    );
  }
  const resourcesMatch = cleaned.match(
    /<resources\b[^>]*>([\s\S]*?)<\/resources>/,
  );
  if (!resourcesMatch || resourcesMatch[1] === undefined) {
    throw new Error("Malformed <resources>...</resources> framing in XML");
  }
  const body = resourcesMatch[1];
  const entries = new Map<string, string>();
  const pattern = /<string\s+name="([^"]+)">([\s\S]*?)<\/string>/g;
  for (const match of body.matchAll(pattern)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      if (entries.has(name)) {
        throw new Error(`Duplicate <string name="${name}"> resource`);
      }
      entries.set(name, value);
    }
  }
  const openStringCount = (body.match(/<string\b/g) ?? []).length;
  const closeStringCount = (body.match(/<\/string>/g) ?? []).length;
  if (openStringCount !== entries.size || closeStringCount !== entries.size) {
    throw new Error(
      `Unbalanced or malformed <string> elements (open=${openStringCount}, close=${closeStringCount}, parsed=${entries.size})`,
    );
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
  const cleaned = stripLineAndBlockComments(source);
  const constants = parseJavaStringConstants(cleaned);
  const specPattern =
    /new\s+Spec\(\s*([A-Z0-9_]+|"[^"]+")\s*,\s*([A-Za-z0-9_.]+)\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*([A-Za-z0-9_.]+)\s*,\s*R\.string\.([a-z0-9_]+)\s*,\s*R\.string\.([a-z0-9_]+)\s*,\s*(true|false)\s*\)/g;

  const specs: ParsedJavaChannelSpec[] = [];
  for (const match of cleaned.matchAll(specPattern)) {
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
  const rawSpecCount = (cleaned.match(/new\s+Spec\s*\(/g) ?? []).length;
  if (rawSpecCount !== specs.length) {
    throw new Error(
      `Failed to parse all Spec(...) definitions in NotificationChannels.java (found ${rawSpecCount}, parsed ${specs.length})`,
    );
  }
  return specs;
}

function activeProguardLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0);
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
  const manifest = stripXmlComments(
    readRepoFile("android/app/src/main/AndroidManifest.xml"),
  );

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
      const escaped = permission.replaceAll(".", "\\.");
      const tagMatch = manifest.match(
        new RegExp(
          `<uses-permission\\b[^>]*android:name="${escaped}"[^>]*\\/>`,
          "s",
        ),
      );
      expect(tagMatch, `missing uses-permission ${permission}`).not.toBeNull();
      expect(
        tagMatch?.[0],
        `required permission ${permission} must not be removed`,
      ).not.toContain('tools:node="remove"');
    }

    const exactAlarmTags = [
      ...manifest.matchAll(
        /<uses-permission\b[^>]*android:name="android\.permission\.SCHEDULE_EXACT_ALARM"[^>]*\/>/gs,
      ),
    ];
    expect(exactAlarmTags).toHaveLength(1);
    expect(exactAlarmTags[0]?.[0]).toContain('tools:node="remove"');
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

    expect(manifest).toMatch(
      /<meta-data\b[^>]*android:name="com\.google\.firebase\.messaging\.default_notification_icon"[^>]*android:resource="@drawable\/ic_stat_nadhir"[^>]*\/>/s,
    );
    expect(manifest).toMatch(
      /<meta-data\b[^>]*android:name="com\.google\.firebase\.messaging\.default_notification_channel_id"[^>]*android:value="alerts"[^>]*\/>/s,
    );

    expect(manifest).toMatch(
      /<receiver[^>]*android:name="\.commune\.CommuneLocationReceiver"[^>]*android:exported="false"/s,
    );
    const bootReceiverMatch = manifest.match(
      /<receiver\b[^>]*android:name="\.commune\.CommuneBootReceiver"[^>]*android:exported="false"[^>]*>([\s\S]*?)<\/receiver>/,
    );
    expect(bootReceiverMatch).not.toBeNull();
    expect(bootReceiverMatch?.[1]).toContain(
      'android:name="android.intent.action.BOOT_COMPLETED"',
    );
    expect(bootReceiverMatch?.[1]).toContain(
      'android:name="android.intent.action.MY_PACKAGE_REPLACED"',
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
    const backupRules = stripXmlComments(
      readRepoFile("android/app/src/main/res/xml/backup_rules.xml"),
    );
    const dataExtractionRules = stripXmlComments(
      readRepoFile("android/app/src/main/res/xml/data_extraction_rules.xml"),
    );
    const networkSecurityConfig = stripXmlComments(
      readRepoFile("android/app/src/main/res/xml/network_security_config.xml"),
    );

    const fullBackupBlocks = [
      ...backupRules.matchAll(
        /<full-backup-content>([\s\S]*?)<\/full-backup-content>/g,
      ),
    ];
    expect(fullBackupBlocks).toHaveLength(1);
    const fullBackupBody = fullBackupBlocks[0]?.[1] ?? "";
    expect(fullBackupBody).not.toMatch(/<include\b/);

    expect(dataExtractionRules).toMatch(
      /<data-extraction-rules>[\s\S]*<\/data-extraction-rules>/,
    );
    const cloudBackupBlocks = [
      ...dataExtractionRules.matchAll(
        /<cloud-backup>([\s\S]*?)<\/cloud-backup>/g,
      ),
    ];
    const deviceTransferBlocks = [
      ...dataExtractionRules.matchAll(
        /<device-transfer>([\s\S]*?)<\/device-transfer>/g,
      ),
    ];
    expect(cloudBackupBlocks).toHaveLength(1);
    expect(deviceTransferBlocks).toHaveLength(1);

    const cloudBackupBody = cloudBackupBlocks[0]?.[1] ?? "";
    const deviceTransferBody = deviceTransferBlocks[0]?.[1] ?? "";
    expect(cloudBackupBody).not.toMatch(/<include\b/);
    expect(deviceTransferBody).not.toMatch(/<include\b/);

    for (const domain of [
      "root",
      "file",
      "database",
      "sharedpref",
      "external",
    ]) {
      const expectedRule = `<exclude domain="${domain}" path="." />`;
      expect(fullBackupBody, `backup_rules.xml missing ${domain}`).toContain(
        expectedRule,
      );
      expect(
        cloudBackupBody,
        `data_extraction_rules.xml <cloud-backup> missing ${domain}`,
      ).toContain(expectedRule);
      expect(
        deviceTransferBody,
        `data_extraction_rules.xml <device-transfer> missing ${domain}`,
      ).toContain(expectedRule);
    }

    expect(networkSecurityConfig).toMatch(
      /<network-security-config>[\s\S]*<\/network-security-config>/,
    );
    expect(networkSecurityConfig).toContain(
      '<base-config cleartextTrafficPermitted="false" />',
    );
    expect(networkSecurityConfig).not.toContain(
      'cleartextTrafficPermitted="true"',
    );
  });
});

describe("Native Android startup notification channels parity", () => {
  const channelsJava = stripLineAndBlockComments(
    readRepoFile(
      "android/app/src/main/java/app/nadhir/NotificationChannels.java",
    ),
  );
  const mainActivityJava = stripLineAndBlockComments(
    readRepoFile("android/app/src/main/java/app/nadhir/MainActivity.java"),
  );
  const bootReceiverJava = stripLineAndBlockComments(
    readRepoFile(
      "android/app/src/main/java/app/nadhir/commune/CommuneBootReceiver.java",
    ),
  );
  const channelsTestJava = stripLineAndBlockComments(
    readRepoFile(
      "android/app/src/test/java/app/nadhir/NotificationChannelsTest.java",
    ),
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

    expect(channelsJava).toContain("context == null");
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

  it("registers channels and plugins in MainActivity before super.onCreate and in CommuneBootReceiver before enabled check", () => {
    const ensureIndex = mainActivityJava.indexOf(
      "NotificationChannels.ensureAll(this);",
    );
    const currentCommuneRegIndex = mainActivityJava.indexOf(
      "registerPlugin(CurrentCommunePlugin.class);",
    );
    const nativeAuthRegIndex = mainActivityJava.indexOf(
      "registerPlugin(NativeAuthPlugin.class);",
    );
    const superOnCreateIndex = mainActivityJava.indexOf(
      "super.onCreate(savedInstanceState);",
    );
    expect(ensureIndex).toBeGreaterThan(-1);
    expect(currentCommuneRegIndex).toBeGreaterThan(-1);
    expect(nativeAuthRegIndex).toBeGreaterThan(-1);
    expect(superOnCreateIndex).toBeGreaterThan(ensureIndex);
    expect(superOnCreateIndex).toBeGreaterThan(currentCommuneRegIndex);
    expect(superOnCreateIndex).toBeGreaterThan(nativeAuthRegIndex);
    expect(
      (mainActivityJava.match(/if\s*\(connectivity\s*!=\s*null\)/g) ?? [])
        .length,
    ).toBeGreaterThanOrEqual(2);

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
    expect(defaultStrings.get("package_name")).toBe("app.nadhir");
    expect(defaultStrings.get("custom_url_scheme")).toBe("app.nadhir");

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
          expect(value).not.toMatch(/^[@?]/);
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
  const buildGradle = stripLineAndBlockComments(
    readRepoFile("android/app/build.gradle"),
  );
  const variablesGradle = readRepoFile("android/variables.gradle");
  const proguardRules = readRepoFile("android/app/proguard-rules.pro");

  it("configures SDK levels, monotonic default versionCode (4..2100000000), trimmed env overrides, and R8 release shrinking", () => {
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

    expect(buildGradle).toMatch(/def\s+maxPlayVersionCode\s*=\s*2100000000\b/);
    const defaultVersionCodeMatch = buildGradle.match(
      /def\s+rawVersionCode\s*=\s*envVersionCode\s*\?:\s*propVersionCode\s*\?:\s*"(\d+)"/,
    );
    expect(defaultVersionCodeMatch).not.toBeNull();
    const defaultVersionCode = Number(defaultVersionCodeMatch?.[1]);
    expect(defaultVersionCode).toBeGreaterThanOrEqual(4);
    expect(defaultVersionCode).toBeLessThanOrEqual(2100000000);

    expect(buildGradle).toMatch(
      /System\.getenv\("NADHIR_ANDROID_VERSION_CODE"\)\?\.toString\(\)\?\.trim\(\)/,
    );
    expect(buildGradle).toMatch(
      /findProperty\("nadhirVersionCode"\)\?\.toString\(\)\?\.trim\(\)/,
    );
    expect(buildGradle).toMatch(
      /System\.getenv\("NADHIR_ANDROID_VERSION_NAME"\)\?\.toString\(\)\?\.trim\(\)/,
    );
    expect(buildGradle).toMatch(
      /findProperty\("nadhirVersionName"\)\?\.toString\(\)\?\.trim\(\)/,
    );
    expect(buildGradle).toMatch(/resolvedVersionCode\s*<\s*1/);
    expect(buildGradle).toMatch(/resolvedVersionCode\s*>\s*maxPlayVersionCode/);

    expect(buildGradle).toContain("minifyEnabled true");
    expect(buildGradle).toContain("shrinkResources true");
    expect(buildGradle).toContain("proguard-android-optimize.txt");
    expect(buildGradle).toContain("'proguard-rules.pro'");
    expect(buildGradle).not.toContain("'proguard-android.txt'");
    expect(buildGradle).not.toContain('"proguard-android.txt"');
  });

  it("loads release signing strictly from env vars with safe partial-env gating, task-graph validation, and zero hardcoded secrets", () => {
    expect(buildGradle).toContain('System.getenv("NADHIR_UPLOAD_STORE")');
    expect(buildGradle).toContain('System.getenv("NADHIR_UPLOAD_PASSWORD")');
    expect(buildGradle).toContain('System.getenv("NADHIR_UPLOAD_KEY_ALIAS")');
    expect(buildGradle).toContain(
      'System.getenv("NADHIR_UPLOAD_KEY_PASSWORD")',
    );

    expect(buildGradle).toMatch(
      /def\s+hasReleaseSigningEnv\s*=\s*!uploadStore\.isEmpty\(\)\s*&&\s*hasUploadStorePassword/,
    );
    expect(buildGradle).toMatch(
      /signingConfigs\s*\{[\s\S]*?release\s*\{[\s\S]*?if\s*\(hasReleaseSigningEnv\)/,
    );
    expect(buildGradle).toMatch(
      /buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?if\s*\(hasReleaseSigningEnv\)\s*\{\s*signingConfig\s+signingConfigs\.release/,
    );

    const releaseTasksMatch = buildGradle.match(
      /def\s+releasePackagingTasks\s*=\s*\[([\s\S]*?)\]\s*as\s*Set/,
    );
    expect(releaseTasksMatch).not.toBeNull();
    const releaseTasksBlock = releaseTasksMatch?.[1] ?? "";
    for (const taskName of [
      "assembleRelease",
      "bundleRelease",
      "packageRelease",
      "packageReleaseBundle",
      "signReleaseBundle",
    ]) {
      expect(
        releaseTasksBlock,
        `missing release packaging task: ${taskName}`,
      ).toContain(`'${taskName}'`);
    }

    const whenReadyMatch = buildGradle.match(
      /gradle\.taskGraph\.whenReady\s*\{[\s\S]*?\n\}/,
    );
    expect(whenReadyMatch).not.toBeNull();
    const whenReadyBlock = whenReadyMatch?.[0] ?? "";
    expect(whenReadyBlock).toContain(
      "releasePackagingTasks.contains(task.name)",
    );
    expect(whenReadyBlock).toContain("GradleException");
    expect(whenReadyBlock).toContain("isFile()");

    expect(buildGradle).not.toMatch(
      /storePassword(?:\s*=\s*|\s*\(\s*|\s+)["'][^"']+["']/,
    );
    expect(buildGradle).not.toMatch(
      /keyPassword(?:\s*=\s*|\s*\(\s*|\s+)["'][^"']+["']/,
    );
    expect(buildGradle).not.toMatch(/\.jks|\.keystore|\.p12/i);
  });

  it("defines active non-comment R8 Full-Mode keep rules for Capacitor, WebView bridges, Ionic libs, auth, commune, and notification channels", () => {
    const activeLines = activeProguardLines(proguardRules);
    const activeText = activeLines.join("\n");

    for (const exactLine of [
      "-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable",
      "-renamesourcefileattribute SourceFile",
      "-keep @interface com.getcapacitor.** { *; }",
      "-keep class com.getcapacitor.Plugin { *; }",
      "-keep public class * extends com.getcapacitor.Plugin { *; }",
      "-keep class com.getcapacitor.Bridge { *; }",
      "-keep class com.getcapacitor.BridgeActivity { *; }",
      "-keep class com.getcapacitor.BridgeWebViewClient { *; }",
      "-keep class com.getcapacitor.BridgeWebChromeClient { *; }",
      "-keep class com.getcapacitor.CapacitorWebView { *; }",
      "-keep class com.getcapacitor.MessageHandler { *; }",
      "-keep class com.getcapacitor.JSObject { *; }",
      "-keep class com.getcapacitor.JSArray { *; }",
      "-keep class com.getcapacitor.PluginCall { *; }",
      "-keep class com.getcapacitor.PluginResult { *; }",
      "-keep class com.getcapacitor.PermissionState { *; }",
      "-keep class com.getcapacitor.plugin.** { *; }",
      "-keep class app.nadhir.MainActivity { *; }",
      "-keep class app.nadhir.NotificationChannels { *; }",
      "-keep class app.nadhir.NotificationChannels$* { *; }",
      "-keep class app.nadhir.auth.NativeAuthPlugin { *; }",
      "-keep class app.nadhir.commune.** { *; }",
      "-keep class io.capawesome.capacitorjs.plugins.firebase.messaging.** { *; }",
      "-keep class com.capacitorjs.plugins.** { *; }",
      "-keep class io.ionic.libs.** { *; }",
    ]) {
      expect(
        activeLines,
        `missing exact ProGuard rule: ${exactLine}`,
      ).toContain(exactLine);
    }

    for (const blockFragment of [
      "-keepclassmembers class * {",
      "@android.webkit.JavascriptInterface <methods>;",
      "-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {",
      "@com.getcapacitor.annotation.PermissionCallback <methods>;",
      "@com.getcapacitor.annotation.ActivityCallback <methods>;",
      "@com.getcapacitor.annotation.Permission <methods>;",
      "@com.getcapacitor.PluginMethod <methods>;",
    ]) {
      expect(
        activeText,
        `missing ProGuard block rule: ${blockFragment}`,
      ).toContain(blockFragment);
    }

    expect(activeText).not.toContain("-dontwarn");
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
    /^([0-9A-F]{2})(:\1){31}$/,
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

    expect(Array.isArray(entry.relation)).toBe(true);
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

  it("contains zero undeclared analytics, crash-reporting, or ad SDKs in package.json, build.gradle, and capacitor.build.gradle", () => {
    const pkg = readRepoFile("package.json");
    const buildGradle = readRepoFile("android/app/build.gradle");
    const capacitorBuildGradle = readRepoFile(
      "android/app/capacitor.build.gradle",
    );
    const combined = `${pkg}\n${buildGradle}\n${capacitorBuildGradle}`;

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

  it("enforces ADR-0002, ADR-0006, and antislop hygiene rules", () => {
    expect(storeListing).not.toContain("\u2014");
    expect(storeListing).not.toMatch(/\bsafe\b/i);
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
      expect(storeListing).toContain(`\`${channelId}\``);
    }
  });
});

const distClientIndex = resolve(ROOT, "dist/client/index.html");

describe.runIf(existsSync(distClientIndex))(
  "Built native bundle (dist/client) assets and server-secret isolation",
  () => {
    it("emits index.html, matching .well-known/assetlinks.json, and geo/communes.v1.json", () => {
      const expectedAssetLinks = readRepoFile(
        "public/.well-known/assetlinks.json",
      );
      expect(existsSync(resolve(ROOT, "dist/client/index.html"))).toBe(true);
      const builtAssetLinksPath = resolve(
        ROOT,
        "dist/client/.well-known/assetlinks.json",
      );
      expect(existsSync(builtAssetLinksPath)).toBe(true);
      expect(readFileSync(builtAssetLinksPath, "utf8")).toBe(
        expectedAssetLinks,
      );
      expect(
        existsSync(resolve(ROOT, "dist/client/geo/communes.v1.json")),
      ).toBe(true);

      const syncedIndexPath = resolve(
        ROOT,
        "android/app/src/main/assets/public/index.html",
      );
      if (existsSync(syncedIndexPath)) {
        expect(
          existsSync(
            resolve(
              ROOT,
              "android/app/src/main/assets/public/geo/communes.v1.json",
            ),
          ),
        ).toBe(true);
        const syncedAssetLinksPath = resolve(
          ROOT,
          "android/app/src/main/assets/public/.well-known/assetlinks.json",
        );
        expect(existsSync(syncedAssetLinksPath)).toBe(true);
        expect(readFileSync(syncedAssetLinksPath, "utf8")).toBe(
          expectedAssetLinks,
        );
      }
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
