import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import i18n, { type AnyLocale } from "@/i18n";
import { adminAr } from "@/i18n/admin/ar";
import { adminEn } from "@/i18n/admin/en";
import { adminFr } from "@/i18n/admin/fr";
import { adminKab } from "@/i18n/admin/kab";
import { overlay } from "@/i18n/overlay";
import { ar } from "@/i18n/locales/ar";
import { en } from "@/i18n/locales/en";
import { fr } from "@/i18n/locales/fr";
import { kab } from "@/i18n/locales/kab";
import { track1Ar } from "@/i18n/modules/track1/ar";
import { track1En } from "@/i18n/modules/track1/en";
import { track1Fr } from "@/i18n/modules/track1/fr";
import { track1Kab } from "@/i18n/modules/track1/kab";
import { track2Ar } from "@/i18n/modules/track2/ar";
import { track2En } from "@/i18n/modules/track2/en";
import { track2Fr } from "@/i18n/modules/track2/fr";
import { track2Kab } from "@/i18n/modules/track2/kab";
import { track3Ar } from "@/i18n/modules/track3/ar";
import { track3En } from "@/i18n/modules/track3/en";
import { track3Fr } from "@/i18n/modules/track3/fr";
import { track3Kab } from "@/i18n/modules/track3/kab";
import { track4Ar } from "@/i18n/modules/track4/ar";
import { track4En } from "@/i18n/modules/track4/en";
import { track4Fr } from "@/i18n/modules/track4/fr";
import { track4Kab } from "@/i18n/modules/track4/kab";
import { weatherAr, weatherEn, weatherFr, weatherKab } from "@/i18n/weather";
import {
  BANNED_STATUS_LABELS,
  buildAlertProvenance,
  parseProvenancePayload,
  toProvenancePayload,
  validateProvenanceInvariants,
  type AlertProvenanceData,
} from "@/lib/alert-provenance";
import { buildFireCap, capToXml } from "@/lib/cap";
import { renderZoneDigestEmail } from "@/lib/delivery/email-digest.server";
import { formatWhatsappBroadcastMessage } from "@/lib/delivery/whatsapp-channel.server";
import { fcmMessagesForOnm } from "@/lib/fcm";
import { validateMtgFciPushProductId } from "@/lib/ingest/mtg-fci-push";
import {
  createSourceRunners,
  RUNTIME_CONTRACT_KEYS,
  type SourceRunnerDependencies,
} from "@/lib/ingest/source-runners.server";
import type { OnmVigilance } from "@/lib/nadhir";
import {
  DEFAULT_LOCAL_NOTIFICATION_EXACT,
  NOTIFICATION_CHANNEL_IDS,
  NOTIFICATION_CHANNELS,
  type NotificationChannelId,
} from "@/lib/notification-channels";
import { onmCardModel } from "@/lib/share-card";
import type { ClaimedSourceJob, SourceJobResult } from "@/lib/source-jobs";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

type TranslationTree = { [key: string]: string | TranslationTree };

function readRepoFile(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), "utf8");
}

function flattenEntries(
  tree: TranslationTree,
  prefix = "",
): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? flattenEntries(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

function extractPlaceholders(value: string): string[] {
  return [...value.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)]
    .map((match) => match[1]!)
    .sort();
}

function walkFiles(
  dir: string,
  predicate: (relPath: string) => boolean,
): string[] {
  const out: string[] = [];
  const visit = (currentDir: string) => {
    for (const entry of readdirSync(currentDir)) {
      const fullPath = join(currentDir, entry);
      const st = statSync(fullPath);
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === "dist" || entry === ".git") {
          continue;
        }
        visit(fullPath);
      } else {
        const relPath = relative(REPO_ROOT, fullPath).replace(/\\/g, "/");
        if (predicate(relPath)) {
          out.push(relPath);
        }
      }
    }
  };
  visit(dir);
  return out.sort();
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\r\n]*/g, " ");
}

function stripTsComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/[^\r\n]*/g, "$1 ");
}

function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = input.slice(start).trim();
  if (tail.length > 0) parts.push(tail);
  return parts;
}

function listRoadmapMigrations(): string[] {
  const migrationsDir = join(REPO_ROOT, "supabase/migrations");
  return readdirSync(migrationsDir)
    .filter((name) => {
      const match = /^(\d{14})_.*\.sql$/.exec(name);
      return match !== null && match[1]! >= "20261124000000";
    })
    .sort()
    .map((name) => `supabase/migrations/${name}`);
}

/**
 * Strip only documented ADR-0002 honesty disclaimers and the Check-In phrase
 * ("Reported safe at ..."), preserving any banned status label elsewhere.
 */
function stripAllowedSafeDisclaimers(key: string, text: string): string {
  if (key === "contribute.rulesBody") {
    return "";
  }
  return text
    .replace(/\breported safe at\b/gi, " ")
    .replace(/\bno street tiles or safe-route claims\b/gi, " ")
    .replace(
      /\bdoes not mean the incident is over or the area is safe\b/gi,
      " ",
    )
    .replace(/\bdoes not publish a per-commune all-clear\b/gi, " ")
    .replace(/\bdoes not announce an all-clear\b/gi, " ")
    .replace(/\bthis is not an all-clear\b/gi, " ")
    .replace(/\bnot an all-clear\b/gi, " ")
    .replace(/\bne signifie pas[^.\n]*?zone s[uû]re\b/gi, " ")
    .replace(/\bce qui rend un espace ouvert plus s[uû]r\b/gi, " ")
    .replace(/\bif authorities name a refuge\b/gi, " ")
    .replace(/\bsi les autorit[eé]s d[eé]signent un refuge\b/gi, " ")
    .replace(/دون[^.\n]*?ادعاء وجود مسارات آمنة/g, " ")
    .replace(/لا يعني[^.\n]*?أن المنطقة آمنة/g, " ")
    .replace(/رابطًا آمنًا/g, " ");
}

const BANNED_SAFE_STANDALONE_RE =
  /^(?:safe|all[- ]clear|s[uû]re?|آمنة?|yeɣlel)$/i;

const BANNED_SAFE_PHRASE_PATTERNS: readonly RegExp[] = [
  /\bsafe\s+(?:zone|area|status|place|commune|wilaya|route)\b/i,
  /\bmark(?:ed)?\s+as\s+safe\b/i,
  /\bsafety\s+status\b/i,
  /\b(?:is|are|now)\s+safe\b/i,
  /\ball[- ]clear\b/i,
  /\bzone\s+(?:s[uû]re|de\s+s[eé]curit[eé])\b/i,
  /\b(?:statut|état)\s+s[uû]r\b/i,
  /منطقة\s+آمنة/,
  /الوضع\s+آمن/,
  /\bemergency\s+mode\b/i,
  /\bmode\s+d['’]urgence\b/i,
];

function extractJsxTextNodes(tsxSource: string): string[] {
  const withoutComments = stripTsComments(tsxSource);
  const nodes: string[] = [];
  for (const match of withoutComments.matchAll(/>([^<>{}]+)</g)) {
    const raw = (match[1] ?? "").replace(/\s+/g, " ").trim();
    if (raw.length >= 2 && /[\p{L}]/u.test(raw)) {
      nodes.push(raw);
    }
  }
  return nodes;
}

function extractJsxUserStringAttrs(tsxSource: string): string[] {
  const withoutComments = stripTsComments(tsxSource);
  const attrs: string[] = [];
  for (const match of withoutComments.matchAll(
    /\b(?:aria-label|title|placeholder)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
  )) {
    const raw = (match[1] ?? match[2] ?? "").replace(/\s+/g, " ").trim();
    if (raw.length > 0) {
      attrs.push(raw);
    }
  }
  return attrs;
}

const ANDROID_XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function unescapeAndroidXml(raw: string): string {
  return raw
    .replace(/\\(['"])/g, "$1")
    .replace(
      /&(?:amp|lt|gt|quot|apos);/g,
      (entity) => ANDROID_XML_ENTITIES[entity] ?? entity,
    );
}

function parseXmlStrings(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of xml.matchAll(
    /<string\s+name="([^"]+)">([\s\S]*?)<\/string>/g,
  )) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) {
      out.set(name, unescapeAndroidXml(value));
    }
  }
  return out;
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

function parseJavaChannelSpecs(javaSource: string): ParsedJavaChannelSpec[] {
  const constants = new Map<string, string>();
  for (const m of javaSource.matchAll(
    /public\s+static\s+final\s+String\s+([A-Z0-9_]+)\s*=\s*"([^"]+)"\s*;/g,
  )) {
    if (m[1] && m[2]) constants.set(m[1], m[2]);
  }

  const importanceMap: Record<string, number> = {
    "NotificationManager.IMPORTANCE_DEFAULT": 3,
    "NotificationManager.IMPORTANCE_HIGH": 4,
  };
  const visibilityMap: Record<string, number> = {
    "Notification.VISIBILITY_PUBLIC": 1,
  };

  const specs: ParsedJavaChannelSpec[] = [];
  for (const m of javaSource.matchAll(/new\s+Spec\s*\(([\s\S]*?)\)/g)) {
    const body = m[1];
    if (!body) continue;
    const args = body
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (args.length !== 8) continue;
    const [
      idExpr,
      importanceExpr,
      vibrationExpr,
      lightsExpr,
      visibilityExpr,
      nameResExpr,
      descResExpr,
      legacyExpr,
    ] = args;
    if (
      !idExpr ||
      !importanceExpr ||
      !vibrationExpr ||
      !lightsExpr ||
      !visibilityExpr ||
      !nameResExpr ||
      !descResExpr ||
      !legacyExpr
    ) {
      continue;
    }
    const id = constants.get(idExpr) ?? idExpr.replace(/^"|"$/g, "");
    const importance = importanceMap[importanceExpr] ?? -1;
    const visibility = visibilityMap[visibilityExpr] ?? -1;
    specs.push({
      id,
      importance,
      vibration: vibrationExpr === "true",
      lights: lightsExpr === "true",
      visibility,
      nameResKey: nameResExpr.replace(/^R\.string\./, ""),
      descriptionResKey: descResExpr.replace(/^R\.string\./, ""),
      legacyFallback: legacyExpr === "true",
    });
  }
  return specs;
}

function makeMockJob(contractKey: string): ClaimedSourceJob {
  return {
    id: `job-${contractKey}`,
    contract_key: contractKey,
    contract_version: 1,
    trigger_kind: "scheduled",
    idempotency_key: `scheduled:${contractKey}:2026-11-25T12:00:00Z`,
    scheduled_for: "2026-11-25T12:00:00.000Z",
    data_from: "2026-11-25T11:45:00.000Z",
    data_through: "2026-11-25T12:00:00.000Z",
    dispatched_at: null,
    execution_target: "cloudflare",
    state: "running",
    enqueued_by: ["database"],
    available_at: "2026-11-25T12:00:00.000Z",
    attempt_count: 1,
    max_attempts: 3,
    retry_base_seconds: 30,
    retry_until: "2026-11-25T12:30:00.000Z",
    gap_id: null,
    started_at: "2026-11-25T12:00:01.000Z",
    finished_at: null,
    last_error_at: null,
    last_public_reason_code: null,
    created_at: "2026-11-25T12:00:00.000Z",
    updated_at: "2026-11-25T12:00:01.000Z",
  };
}

function makeStubWorkerResult(job: ClaimedSourceJob): SourceJobResult {
  return {
    contractKey: job.contract_key,
    trigger: job.trigger_kind,
    scheduledFor: job.scheduled_for,
    startedAt: job.started_at,
    outcome: "succeeded",
    coverageStatus: "complete",
    upstreamPublishedAt: job.data_through,
    dataFrom: job.data_from,
    dataThrough: job.data_through,
    recordsSeen: 1,
    recordsInserted: 1,
    recordsRejected: 0,
    publicReasonCode: null,
    privateDiagnostic: null,
    retryDisposition: "none",
  };
}

function createMockDependencies(
  overrides: Partial<SourceRunnerDependencies> = {},
): SourceRunnerDependencies {
  return {
    collectWeatherEvidence: vi.fn().mockResolvedValue({
      expected: 1,
      accepted: 1,
      inserted: 1,
      rejected: 0,
    }),
    runItaSource: vi.fn().mockResolvedValue({
      fetched: 1,
      stored: 1,
      extracted: 1,
      failed: 0,
      pending: 0,
      notModified: false,
    }),
    runItaFacebookSource: vi.fn().mockResolvedValue({
      fetched: 1,
      stored: 1,
      newestPostAt: "2026-11-25T11:55:00Z",
    }),
    ingestFirms: vi.fn().mockResolvedValue({
      fetched: 1,
      inserted: 1,
      feeds: ["VIIRS:1"],
      dataFrom: "2026-11-25T11:45:00Z",
      dataThrough: "2026-11-25T12:00:00Z",
    }),
    ingestFci: vi.fn().mockResolvedValue({
      fetched: 1,
      inserted: 1,
      outside: 0,
      filtered: 0,
      latestSlot: "2026-11-25T11:50:00Z",
      ageMinutes: 10,
    }),
    ingestS3: vi.fn().mockResolvedValue({
      fetched: 1,
      inserted: 1,
      outside: 0,
      filtered: 0,
      latestSlot: "2026-11-25T11:50:00Z",
      ageMinutes: 10,
    }),
    ingestOnm: vi.fn().mockResolvedValue({
      fetched: 1,
      stored: 1,
      unmatched: 0,
      detailed: 1,
    }),
    ingestEmsc: vi.fn().mockResolvedValue({
      fetched: 1,
      stored: 1,
      outside: 0,
    }),
    ingestMetar: vi.fn().mockResolvedValue({ fetched: 1, stored: 1 }),
    screenPersistentSources: vi
      .fn()
      .mockResolvedValue({ screened: 1, registry: 1 }),
    fuseDetections: vi.fn().mockResolvedValue({
      processed: 1,
      clustersTouched: 1,
      created: 1,
      resolved: 0,
    }),
    flagPersistentCandidates: vi.fn().mockResolvedValue({ flagged: 0 }),
    enrichClusterWinds: vi.fn().mockResolvedValue(1),
    refreshRiskForecasts: vi
      .fn()
      .mockResolvedValue({ communes: 1, rows: 1, requests: 1 }),
    ingestEffis: vi.fn().mockResolvedValue({ communes: 1, classified: 1 }),
    evaluateAlerts: vi.fn().mockResolvedValue({
      evaluated: 3,
      created: 2,
      suppressed: 1,
      sent: 2,
      failed: 0,
    }),
    publishBroadcasts: vi
      .fn()
      .mockResolvedValue({ published: 1, suppressed: 0 }),
    deliverBroadcasts: vi.fn().mockResolvedValue({
      disabled: false,
      rows: 1,
      sent: 1,
      failed: 0,
      telegramRows: 0,
      telegramSent: 0,
      telegramFailed: 0,
      telegramChannels: 1,
      fcmConfigured: true,
      telegramConfigured: true,
    }),
    drainWebhookDeliveries: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
    runImergSource: vi.fn(async (j) => makeStubWorkerResult(j)),
    runHsafSource: vi.fn(async (j) => makeStubWorkerResult(j)),
    runTarikiSource: vi.fn(async (j) => makeStubWorkerResult(j)),
    runCraagSource: vi.fn(async (j) => makeStubWorkerResult(j)),
    runMtgFciPushSource: vi.fn(async (j) => makeStubWorkerResult(j)),
    runMtgLightningSource: vi.fn(async (j) => makeStubWorkerResult(j)),
    runGwisBurnedAreasSource: vi.fn(async (j) => makeStubWorkerResult(j)),
    runClmsNdviSwiSource: vi.fn(async (j) => makeStubWorkerResult(j)),
    runGhslPopulationSource: vi.fn(async (j) => makeStubWorkerResult(j)),
    ...overrides,
  };
}

describe("Invariant 1 — 4-locale parity (ar/fr/en/kab), placeholders, and zero em dashes", () => {
  const namespaces: Array<{
    name: string;
    en: TranslationTree;
    others: Record<"ar" | "fr" | "kab", TranslationTree>;
  }> = [
    {
      name: "translation",
      en: en as unknown as TranslationTree,
      others: {
        ar: ar as unknown as TranslationTree,
        fr: fr as unknown as TranslationTree,
        kab: kab as unknown as TranslationTree,
      },
    },
    {
      name: "weather",
      en: weatherEn as unknown as TranslationTree,
      others: {
        ar: weatherAr as unknown as TranslationTree,
        fr: weatherFr as unknown as TranslationTree,
        kab: weatherKab as unknown as TranslationTree,
      },
    },
    {
      name: "modules/track1",
      en: track1En as unknown as TranslationTree,
      others: {
        ar: track1Ar as unknown as TranslationTree,
        fr: track1Fr as unknown as TranslationTree,
        kab: track1Kab as unknown as TranslationTree,
      },
    },
    {
      name: "modules/track2",
      en: track2En as unknown as TranslationTree,
      others: {
        ar: track2Ar as unknown as TranslationTree,
        fr: track2Fr as unknown as TranslationTree,
        kab: track2Kab as unknown as TranslationTree,
      },
    },
    {
      name: "modules/track3",
      en: track3En as unknown as TranslationTree,
      others: {
        ar: track3Ar as unknown as TranslationTree,
        fr: track3Fr as unknown as TranslationTree,
        kab: track3Kab as unknown as TranslationTree,
      },
    },
    {
      name: "modules/track4",
      en: track4En as unknown as TranslationTree,
      others: {
        ar: track4Ar as unknown as TranslationTree,
        fr: track4Fr as unknown as TranslationTree,
        kab: track4Kab as unknown as TranslationTree,
      },
    },
    {
      name: "admin",
      en: adminEn as unknown as TranslationTree,
      others: {
        ar: adminAr as unknown as TranslationTree,
        fr: adminFr as unknown as TranslationTree,
        kab: overlay(adminFr, adminKab) as unknown as TranslationTree,
      },
    },
  ];

  it("enforces 100% key parity, {{placeholder}} parity, non-empty strings, and zero em dashes across all 4 locales and namespaces", () => {
    let totalEntriesChecked = 0;
    const violations: string[] = [];

    for (const ns of namespaces) {
      const enEntries = flattenEntries(ns.en);
      if (ns.name !== "modules/track1") {
        expect(enEntries.length, `${ns.name} en keys`).toBeGreaterThan(0);
      }
      const enMap = new Map(enEntries);
      const enKeys = [...enMap.keys()].sort();

      for (const [key, value] of enEntries) {
        totalEntriesChecked += 1;
        if (value.trim().length === 0) {
          violations.push(`empty value: ${ns.name}.en.${key}`);
        }
        if (value.includes("\u2014")) {
          violations.push(`em dash: ${ns.name}.en.${key}`);
        }
      }

      for (const [locale, tree] of Object.entries(ns.others)) {
        const entries = flattenEntries(tree);
        const localeKeys = entries.map(([k]) => k).sort();
        const localeSet = new Set(localeKeys);

        for (const k of enKeys) {
          if (!localeSet.has(k)) {
            violations.push(`missing key: ${ns.name}.${locale}.${k}`);
          }
        }
        for (const k of localeKeys) {
          if (!enMap.has(k)) {
            violations.push(`extra key: ${ns.name}.${locale}.${k}`);
          }
        }

        for (const [key, value] of entries) {
          totalEntriesChecked += 1;
          if (value.trim().length === 0) {
            violations.push(`empty value: ${ns.name}.${locale}.${key}`);
          }
          if (value.includes("\u2014")) {
            violations.push(`em dash: ${ns.name}.${locale}.${key}`);
          }
          const expected = extractPlaceholders(enMap.get(key) ?? "");
          const actual = extractPlaceholders(value);
          // Arabic *_one singular forms legitimately omit explicit {{count}}.
          const expectedEffective =
            locale === "ar" && key.endsWith("_one") && !actual.includes("count")
              ? expected.filter((token) => token !== "count")
              : expected;
          if (JSON.stringify(actual) !== JSON.stringify(expectedEffective)) {
            violations.push(
              `placeholder mismatch: ${ns.name}.${locale}.${key} got [${actual.join(",")}] expected [${expectedEffective.join(",")}]`,
            );
          }
        }
      }
    }

    expect(totalEntriesChecked).toBeGreaterThan(4_000);
    expect(violations).toEqual([]);
  });

  it("wires weatherKab cleanly into i18n kab weather namespace", () => {
    expect(i18n.getFixedT("kab", "weather")("pageTitle")).toBe(
      weatherKab.pageTitle,
    );
  });
});

describe("Invariant 2 — Zero bare 'safe' status labels (ADR-0002) and Survival Mode voice (ADR-0003)", () => {
  it("contains zero banned status labels or Survival Mode voice violations across all 4 locales and namespaces", () => {
    const tables: Array<{ label: string; tree: TranslationTree }> = [
      { label: "translation.ar", tree: ar as unknown as TranslationTree },
      { label: "translation.fr", tree: fr as unknown as TranslationTree },
      { label: "translation.en", tree: en as unknown as TranslationTree },
      { label: "translation.kab", tree: kab as unknown as TranslationTree },
      { label: "weather.ar", tree: weatherAr as unknown as TranslationTree },
      { label: "weather.fr", tree: weatherFr as unknown as TranslationTree },
      { label: "weather.en", tree: weatherEn as unknown as TranslationTree },
      { label: "weather.kab", tree: weatherKab as unknown as TranslationTree },
      { label: "track1.ar", tree: track1Ar as unknown as TranslationTree },
      { label: "track1.fr", tree: track1Fr as unknown as TranslationTree },
      { label: "track1.en", tree: track1En as unknown as TranslationTree },
      { label: "track1.kab", tree: track1Kab as unknown as TranslationTree },
      { label: "track2.ar", tree: track2Ar as unknown as TranslationTree },
      { label: "track2.fr", tree: track2Fr as unknown as TranslationTree },
      { label: "track2.en", tree: track2En as unknown as TranslationTree },
      { label: "track2.kab", tree: track2Kab as unknown as TranslationTree },
      { label: "track3.ar", tree: track3Ar as unknown as TranslationTree },
      { label: "track3.fr", tree: track3Fr as unknown as TranslationTree },
      { label: "track3.en", tree: track3En as unknown as TranslationTree },
      { label: "track3.kab", tree: track3Kab as unknown as TranslationTree },
      { label: "track4.ar", tree: track4Ar as unknown as TranslationTree },
      { label: "track4.fr", tree: track4Fr as unknown as TranslationTree },
      { label: "track4.en", tree: track4En as unknown as TranslationTree },
      { label: "track4.kab", tree: track4Kab as unknown as TranslationTree },
      { label: "admin.ar", tree: adminAr as unknown as TranslationTree },
      { label: "admin.fr", tree: adminFr as unknown as TranslationTree },
      { label: "admin.en", tree: adminEn as unknown as TranslationTree },
      { label: "admin.kab", tree: adminKab as unknown as TranslationTree },
    ];

    let entriesScanned = 0;
    const violations: string[] = [];

    for (const { label, tree } of tables) {
      for (const [key, value] of flattenEntries(tree)) {
        entriesScanned += 1;
        const cleaned = stripAllowedSafeDisclaimers(key, value).trim();
        if (cleaned.length === 0) continue;

        if (BANNED_SAFE_STANDALONE_RE.test(cleaned)) {
          violations.push(`standalone banned label: ${label}.${key}=${value}`);
        }
        for (const pattern of BANNED_SAFE_PHRASE_PATTERNS) {
          if (pattern.test(cleaned)) {
            violations.push(
              `banned phrase (${pattern.source}): ${label}.${key}=${value}`,
            );
          }
        }
        if (
          /^(?:survival|emergency|track[1-4])\./i.test(key) &&
          /\bguardian\b/i.test(cleaned)
        ) {
          violations.push(
            `banned Survival Mode term "Guardian": ${label}.${key}=${value}`,
          );
        }
      }
    }

    expect(entriesScanned).toBeGreaterThan(4_000);
    expect(violations).toEqual([]);
  });

  it("contains zero hardcoded bare 'safe' status labels or em dashes in component and route JSX text nodes and user-facing attributes", () => {
    const tsxFiles = [
      ...walkFiles(
        join(REPO_ROOT, "src/components"),
        (rel) => rel.endsWith(".tsx") && !rel.includes("__tests__"),
      ),
      ...walkFiles(
        join(REPO_ROOT, "src/routes"),
        (rel) => rel.endsWith(".tsx") && !rel.includes("__tests__"),
      ),
    ];
    expect(tsxFiles.length).toBeGreaterThan(40);

    const violations: string[] = [];
    for (const relPath of tsxFiles) {
      const content = readRepoFile(relPath);
      const stringsToScan = [
        ...extractJsxTextNodes(content).map((text) => ({
          kind: "text",
          text,
        })),
        ...extractJsxUserStringAttrs(content).map((text) => ({
          kind: "attr",
          text,
        })),
      ];
      for (const { kind, text } of stringsToScan) {
        if (text.includes("\u2014")) {
          violations.push(`${relPath} (${kind}): em dash in "${text}"`);
        }
        const cleaned = stripAllowedSafeDisclaimers("", text).trim();
        if (cleaned.length === 0) continue;
        if (BANNED_SAFE_STANDALONE_RE.test(cleaned)) {
          violations.push(`${relPath} (${kind}): standalone "${text}"`);
        }
        for (const pattern of BANNED_SAFE_PHRASE_PATTERNS) {
          if (pattern.test(cleaned)) {
            violations.push(`${relPath} (${kind}): "${text}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("rejects every label in BANNED_STATUS_LABELS at runtime in validateProvenanceInvariants", () => {
    expect(BANNED_STATUS_LABELS.length).toBeGreaterThanOrEqual(8);

    for (const banned of BANNED_STATUS_LABELS) {
      const candidate: AlertProvenanceData = {
        triggerKind: "wilaya_warning",
        areaLabel: "Alger",
        sourceKey: "onm",
        sourceAttribution: "ONM · Météo Algérie",
        ruleLabelKey: "provenance.rule.onmSevere",
        observedAt: "2026-11-25T10:00:00Z",
        authorityStatus:
          banned as unknown as AlertProvenanceData["authorityStatus"],
      };
      const violations = validateProvenanceInvariants(candidate);
      expect(
        violations.some((msg) => /banned status label/i.test(msg)),
        `expected validateProvenanceInvariants to reject "${banned}", got: ${violations.join("; ")}`,
      ).toBe(true);
    }
  });
});

describe("Invariant 3 — Zero evacuation routing or safest-route logic (ADR-0003)", () => {
  const ROUTING_PATTERNS: readonly RegExp[] = [
    /\bevacuation[-_]?route(?:s|ing)?\b/i,
    /\bsafest[-_]?route\b/i,
    /\broute[-_]?around[-_]?fire\b/i,
    /router\.project-osrm\.org/i,
    /api\.mapbox\.com\/directions/i,
    /routes\.googleapis\.com/i,
    /\bopenrouteservice\b/i,
    /\bvalhalla\b/i,
    /\bgraphhopper\b/i,
  ];

  it("contains zero evacuation routing or external route-navigation engines in src/ and worker/", () => {
    const sourceFiles = [
      ...walkFiles(
        join(REPO_ROOT, "src"),
        (rel) =>
          /\.(?:ts|tsx)$/.test(rel) &&
          !rel.includes("__tests__") &&
          !rel.endsWith(".test.ts") &&
          !rel.endsWith(".test.tsx"),
      ),
      ...walkFiles(
        join(REPO_ROOT, "worker"),
        (rel) =>
          /\.(?:ts|tsx)$/.test(rel) &&
          !rel.includes("__tests__") &&
          !rel.endsWith(".test.ts") &&
          !rel.endsWith(".test.tsx"),
      ),
    ];

    expect(sourceFiles.length).toBeGreaterThan(50);

    const violations: string[] = [];
    for (const relPath of sourceFiles) {
      const stripped = stripTsComments(readRepoFile(relPath));
      for (const pattern of ROUTING_PATTERNS) {
        if (pattern.test(stripped)) {
          violations.push(`${relPath} matched ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("Invariant 4 — Zero PostGIS types or extensions in all roadmap migrations (ADR-0001)", () => {
  const POSTGIS_PATTERNS: readonly RegExp[] = [
    /\bpostgis\b/i,
    /\bST_[A-Za-z]+\b/,
    /\b(?:public\.|extensions\.)?geography\b/i,
    /\b(?:public\.|extensions\.)?geometry\b/i,
  ];

  it("scans all roadmap migrations >= 20261124000000 (comment-stripped) and confirms zero PostGIS usage", () => {
    const migrations = listRoadmapMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(9);

    const violations: string[] = [];
    for (const relPath of migrations) {
      const stripped = stripSqlComments(readRepoFile(relPath));
      for (const pattern of POSTGIS_PATTERNS) {
        if (pattern.test(stripped)) {
          violations.push(`${relPath} matched ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("Invariant 5 — Explicit REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated and SECURITY DEFINER search_path in all roadmap migrations", () => {
  it("verifies every created SQL function (public.* and private.*, RPCs and triggers) explicitly revokes PUBLIC, anon, authenticated and pins search_path on SECURITY DEFINER", () => {
    const migrations = listRoadmapMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(9);
    expect(
      migrations.some((m) =>
        m.includes("20261125010000_enforce_email_digest_consent_withdrawal"),
      ),
    ).toBe(true);
    expect(
      migrations.some((m) =>
        m.includes("20261125020000_enforce_push_alerts_consent_withdrawal"),
      ),
    ).toBe(true);

    let totalFunctions = 0;
    const unrevoked: string[] = [];
    const unpinnedSearchPath: string[] = [];

    for (const relPath of migrations) {
      const stripped = stripSqlComments(readRepoFile(relPath));
      const createdFunctions = new Set<string>();

      for (const match of stripped.matchAll(
        /\bcreate\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.[a-z0-9_]+)\s*\(([\s\S]*?)\bas\s+\$/gi,
      )) {
        const fnName = match[1]?.toLowerCase();
        const header = match[2] ?? "";
        if (fnName) {
          createdFunctions.add(fnName);
          if (
            /\bsecurity\s+definer\b/i.test(header) &&
            !/\bset\s+search_path\s*=\s*''/i.test(header)
          ) {
            unpinnedSearchPath.push(`${relPath}: ${fnName}`);
          }
        }
      }

      const revokedFunctions = new Set<string>();
      for (const match of stripped.matchAll(
        /\brevoke\s+all\s+on\s+function\s+([\s\S]*?)\s+from\s+([^;]+);/gi,
      )) {
        const fnListRaw = match[1] ?? "";
        const rolesRaw = (match[2] ?? "").toLowerCase();
        const roles = new Set(
          rolesRaw
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean),
        );
        if (
          !roles.has("public") ||
          !roles.has("anon") ||
          !roles.has("authenticated")
        ) {
          continue;
        }
        for (const item of splitTopLevelCommas(fnListRaw)) {
          const fnMatch = /^((?:public|private)\.[a-z0-9_]+)\s*\(/i.exec(item);
          if (fnMatch?.[1]) {
            revokedFunctions.add(fnMatch[1].toLowerCase());
          }
        }
      }

      totalFunctions += createdFunctions.size;
      for (const fnName of createdFunctions) {
        if (!revokedFunctions.has(fnName)) {
          unrevoked.push(`${relPath}: ${fnName}`);
        }
      }
    }

    expect(totalFunctions).toBeGreaterThanOrEqual(36);
    expect(unrevoked).toEqual([]);
    expect(unpinnedSearchPath).toEqual([]);
  });
});

describe("Invariant 6 — Zero forbidden external-company / hub / workflow references in origin/main..HEAD", () => {
  // Construct patterns dynamically so this guard file never embeds literal brand tokens.
  const brand = String.fromCharCode(112, 97, 114, 97, 105, 116, 111);
  const workflowTool = String.fromCharCode(99, 97, 114, 116, 101);
  const forbiddenRefRe = new RegExp(
    `\\b${brand}\\b|${brand}[-_]?hub|mcp__${brand}|\\b${workflowTool}[-_](?:hub|card|ledger)\\b`,
    "i",
  );
  const forbiddenRuntimeE2eRe = new RegExp(
    `(?:import\\s[^;\\n]*${brand}|from\\s+["'][^"']*${brand}|require\\([^)]*${brand}|https?:\\/\\/[^\\s"']*${brand}|mcp__${brand}__[a-z0-9_]+\\s*\\(|call_mcp_tool[^\\n]*${brand})`,
    "i",
  );
  const LOCKED_E2E_NEGATIVE_GUARD_FILES = new Set([
    "tests/e2e/tier1/01-invariants-i18n.e2e.test.ts",
    "tests/e2e/tier2/01-archive-worker-android-boundaries.e2e.test.ts",
    "tests/e2e/tier3/cross-feature-pairwise.e2e.test.ts",
  ]);

  function listChangedFiles(): string[] {
    const collect = (args: string[]): string[] => {
      const stdout = execFileSync("git", args, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    };

    const tryCollect = (args: string[]): string[] | null => {
      try {
        return collect(args);
      } catch {
        return null;
      }
    };

    const branchDiff = tryCollect(["diff", "--name-only", "origin/main..HEAD"]);
    const workingDiff = [
      ...collect(["diff", "--name-only"]),
      ...collect(["diff", "--cached", "--name-only"]),
    ];

    // On shallow CI clones (fetch-depth: 1) where origin/main is absent, or on
    // push-to-main runs where origin/main..HEAD is empty, scan every tracked
    // repository file (strictly broader than the branch diff).
    const candidates =
      branchDiff !== null && branchDiff.length > 0
        ? [...branchDiff, ...workingDiff]
        : [...collect(["ls-files"]), ...workingDiff];

    return [...new Set(candidates)]
      .filter((relPath) => {
        const fullPath = join(REPO_ROOT, relPath);
        try {
          return existsSync(fullPath) && statSync(fullPath).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  }

  it("enforces zero literal matches across all non-tests/e2e changed files in origin/main..HEAD and working tree", () => {
    const changedFiles = listChangedFiles();
    const nonE2eFiles = changedFiles.filter(
      (rel) => !rel.startsWith("tests/e2e/"),
    );

    expect(nonE2eFiles.length).toBeGreaterThan(100);

    const violations: string[] = [];
    for (const relPath of nonE2eFiles) {
      if (
        /\.(?:png|jpg|jpeg|webp|ico|woff2?|ttf|otf|pdf|zip)$/i.test(relPath)
      ) {
        continue;
      }
      const content = readRepoFile(relPath);
      if (forbiddenRefRe.test(content)) {
        violations.push(relPath);
      }
    }

    expect(violations).toEqual([]);
  });

  it("confirms tests/e2e/** contains zero imports, URLs, or MCP invocations of the forbidden brand and restricts negative guard patterns to the 3 locked guard files", () => {
    const e2eFiles = walkFiles(join(REPO_ROOT, "tests/e2e"), () => true);
    expect(e2eFiles.length).toBeGreaterThanOrEqual(27);

    const unexpectedLiteralFiles: string[] = [];
    const runtimeViolations: string[] = [];

    for (const relPath of e2eFiles) {
      const content = readRepoFile(relPath);
      if (forbiddenRuntimeE2eRe.test(content)) {
        runtimeViolations.push(relPath);
      }
      if (
        forbiddenRefRe.test(content) &&
        !LOCKED_E2E_NEGATIVE_GUARD_FILES.has(relPath)
      ) {
        unexpectedLiteralFiles.push(relPath);
      }
    }

    expect(runtimeViolations).toEqual([]);
    expect(unexpectedLiteralFiles).toEqual([]);
  });
});

describe("Invariant 7 — Zero PR #31 banned artifacts across src/, worker/, roadmap migrations, docs/, and runtime validation", () => {
  const ACTIVE_PR31_CODE_PATTERNS: readonly RegExp[] = [
    /\bsource\s*:\s*["']eumetsat_fci["']/i,
    /\bproduct(?:_id|Id)?\s*:\s*["'][^"']*0665/i,
    /https?:\/\/[^\s"'`]*0665/i,
    /\bfunction\s+\w*(?:rotate\w*Bearing|burnCircle|fuelRecovery|logisticCalib)/i,
    /\b(?:const|let|var)\s+\w*(?:burnCircle|fuelRecovery|logisticCalib)\b/i,
  ];

  it("forbids PR #31 artifacts in all comment-stripped roadmap migrations", () => {
    const migrations = listRoadmapMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(9);

    const violations: string[] = [];
    for (const relPath of migrations) {
      const stripped = stripSqlComments(readRepoFile(relPath));
      if (/'eumetsat_fci'/i.test(stripped)) {
        violations.push(`${relPath}: eumetsat_fci in SQL`);
      }
      if (/EO:EUM:DAT:0665/i.test(stripped)) {
        violations.push(`${relPath}: EO:EUM:DAT:0665 in SQL`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("forbids active PR #31 product requests, source keys, or synthetic algorithms in src/ and worker/", () => {
    const sourceFiles = [
      ...walkFiles(
        join(REPO_ROOT, "src"),
        (rel) =>
          /\.(?:ts|tsx)$/.test(rel) &&
          !rel.includes("__tests__") &&
          !rel.endsWith(".test.ts") &&
          !rel.endsWith(".test.tsx"),
      ),
      ...walkFiles(
        join(REPO_ROOT, "worker"),
        (rel) =>
          /\.(?:ts|tsx)$/.test(rel) &&
          !rel.includes("__tests__") &&
          !rel.endsWith(".test.ts") &&
          !rel.endsWith(".test.tsx"),
      ),
    ];

    expect(sourceFiles.length).toBeGreaterThan(50);

    const violations: string[] = [];
    for (const relPath of sourceFiles) {
      const stripped = stripTsComments(readRepoFile(relPath));
      for (const pattern of ACTIVE_PR31_CODE_PATTERNS) {
        if (pattern.test(stripped)) {
          violations.push(`${relPath} matched ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("documents permanent PR #31 exclusion in docs/m6-new-source-gate.md without introducing active usage in other tracked docs", () => {
    const gateDoc = readRepoFile("docs/m6-new-source-gate.md");
    expect(gateDoc).toMatch(/PR #31 Exclusion/i);
    expect(gateDoc).toMatch(/EO:EUM:DAT:0665/);
    expect(gateDoc).toMatch(/eumetsat_fci/);

    const trackedDocs = execFileSync("git", ["ls-files", "docs/"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) => line.length > 0 && line !== "docs/m6-new-source-gate.md",
      );

    expect(trackedDocs.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const relPath of trackedDocs) {
      const content = readRepoFile(relPath);
      if (
        /https?:\/\/[^\s]*0665/i.test(content) ||
        /\bsource\s*[:=]\s*["']?eumetsat_fci\b/i.test(content)
      ) {
        violations.push(relPath);
      }
    }
    expect(violations).toEqual([]);
  });

  it("hard-rejects EO:EUM:DAT:0665 and eumetsat_fci at runtime while accepting L2P FRP (EO:EUM:DAT:0662)", () => {
    expect(() =>
      validateMtgFciPushProductId(
        "EO:EUM:DAT:0665:MTG-I1-FCI-L1C-HRFI-20260815T132000Z",
      ),
    ).toThrow(/0665|prohibited/i);

    expect(() =>
      validateMtgFciPushProductId(
        "EO:EUM:DAT:0662:MTG-I1-FCI-L2P-FRP-20260815T132000Z",
        undefined,
        "eumetsat_fci",
      ),
    ).toThrow(/eumetsat_fci|prohibited/i);

    expect(
      validateMtgFciPushProductId(
        "EO:EUM:DAT:0662:MTG-I1-FCI-L2P-FRP-20260815T132000Z",
        "L2P",
        "mtg_fci_push",
      ),
    ).toBe("EO:EUM:DAT:0662:MTG-I1-FCI-L2P-FRP-20260815T132000Z");
  });
});

describe("Invariant 8 — 1:1 parity across all 6 canonical Android notification channels", () => {
  const CHANNEL_RES_KEY_BY_ID: Record<
    NotificationChannelId,
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

  it("matches all 6 channels 1:1 between notification-channels.ts and NotificationChannels.java", () => {
    const javaSource = readRepoFile(
      "android/app/src/main/java/app/nadhir/NotificationChannels.java",
    );
    const javaSpecs = parseJavaChannelSpecs(javaSource);

    expect(NOTIFICATION_CHANNEL_IDS).toHaveLength(6);
    expect(NOTIFICATION_CHANNELS).toHaveLength(6);
    expect(javaSpecs).toHaveLength(6);
    expect(javaSpecs.map((s) => s.id)).toEqual([...NOTIFICATION_CHANNEL_IDS]);

    for (let i = 0; i < NOTIFICATION_CHANNELS.length; i++) {
      const tsSpec = NOTIFICATION_CHANNELS[i]!;
      const javaSpec = javaSpecs[i]!;
      const expectedRes = CHANNEL_RES_KEY_BY_ID[tsSpec.id];

      expect(javaSpec.id).toBe(tsSpec.id);
      expect(javaSpec.importance).toBe(tsSpec.androidImportance);
      expect(javaSpec.vibration).toBe(tsSpec.vibration);
      expect(javaSpec.lights).toBe(tsSpec.lights);
      expect(javaSpec.visibility).toBe(tsSpec.visibility);
      expect(javaSpec.legacyFallback).toBe(tsSpec.isLegacyFallback);
      expect(javaSpec.nameResKey).toBe(expectedRes.name);
      expect(javaSpec.descriptionResKey).toBe(expectedRes.description);
    }
  });

  it("matches all 6 channel names and descriptions across all 4 Android strings.xml locales", () => {
    const localeFiles: Array<{ locale: AnyLocale; path: string }> = [
      { locale: "en", path: "android/app/src/main/res/values/strings.xml" },
      { locale: "ar", path: "android/app/src/main/res/values-ar/strings.xml" },
      { locale: "fr", path: "android/app/src/main/res/values-fr/strings.xml" },
      {
        locale: "kab",
        path: "android/app/src/main/res/values-b+kab/strings.xml",
      },
    ];

    let checkedPairs = 0;
    for (const { locale, path } of localeFiles) {
      const strings = parseXmlStrings(readRepoFile(path));
      const t = i18n.getFixedT(locale);
      for (const spec of NOTIFICATION_CHANNELS) {
        const resKeys = CHANNEL_RES_KEY_BY_ID[spec.id];
        expect(strings.get(resKeys.name), `${locale}:${resKeys.name}`).toBe(
          t(spec.i18nNameKey),
        );
        expect(
          strings.get(resKeys.description),
          `${locale}:${resKeys.description}`,
        ).toBe(t(spec.i18nDescriptionKey));
        checkedPairs += 1;
      }
    }

    expect(checkedPairs).toBe(24);
  });

  it("enforces DEFAULT_LOCAL_NOTIFICATION_EXACT === false and NOTIFICATION_CHANNELS iteration in push-native.ts", () => {
    expect(DEFAULT_LOCAL_NOTIFICATION_EXACT).toBe(false);
    const pushNativeSource = readRepoFile("src/lib/push-native.ts");
    expect(pushNativeSource).toContain(
      "isExactNotification: DEFAULT_LOCAL_NOTIFICATION_EXACT",
    );
    expect(pushNativeSource).toContain(
      "for (const spec of NOTIFICATION_CHANNELS)",
    );
  });
});

describe("Invariant 9 — Alert & source provenance timestamp/age and verbatim ONM attribution across all builders", () => {
  const ONM_VERBATIM = "ONM · Météo Algérie";
  const OBSERVED_AT = "2026-11-25T10:30:00.000Z";
  const LOCALES: readonly AnyLocale[] = ["ar", "fr", "en", "kab"];

  it("preserves verbatim ONM attribution through provenance build/serialize/parse round-trip and rejects tampering or invalid timestamps", () => {
    for (const attribution of [
      ONM_VERBATIM,
      "Office National de la Météorologie (ONM)",
    ]) {
      const built = buildAlertProvenance({
        triggerKind: "wilaya_warning",
        areaLabel: "Alger",
        sourceKey: "onm",
        sourceAttribution: attribution,
        ruleLabelKey: "provenance.rule.onmExtreme",
        observedAt: OBSERVED_AT,
        authorityStatus: "official",
      });
      expect(validateProvenanceInvariants(built)).toEqual([]);
      const payload = toProvenancePayload(built);
      expect(payload["provenance_source"]).toBe(attribution);
      expect(payload["provenance_observed_at"]).toBe(OBSERVED_AT);
      const parsed = parseProvenancePayload(payload);
      expect(parsed).not.toBeNull();
      expect(parsed?.sourceAttribution).toBe(attribution);
      expect(parsed?.observedAt).toBe(OBSERVED_AT);
    }

    const tampered = buildAlertProvenance({
      triggerKind: "wilaya_warning",
      areaLabel: "Alger",
      sourceKey: "onm",
      sourceAttribution: "Weather Model Estimate",
      ruleLabelKey: "provenance.rule.onmExtreme",
      observedAt: OBSERVED_AT,
      authorityStatus: "official",
    });
    expect(
      validateProvenanceInvariants(tampered).some((v) =>
        /ONM attribution/i.test(v),
      ),
    ).toBe(true);

    const invalidDate = buildAlertProvenance({
      triggerKind: "wilaya_warning",
      areaLabel: "Alger",
      sourceKey: "onm",
      sourceAttribution: ONM_VERBATIM,
      ruleLabelKey: "provenance.rule.onmExtreme",
      observedAt: "not-a-timestamp",
      authorityStatus: "official",
    });
    expect(
      validateProvenanceInvariants(invalidDate).some((v) =>
        /observedAt/i.test(v),
      ),
    ).toBe(true);
  });

  it("embeds verbatim ONM attribution, valid timestamp, and canonical Android channel in fcmMessagesForOnm", () => {
    const extremeMessages = fcmMessagesForOnm({
      broadcastId: "brd-onm-extreme",
      severity: "Extreme",
      communeCodes: ["1601"],
      title: "Pluie",
      headlineFr: "Pluies torrentielles sur Alger",
      wilayaId: "16",
      event: "Rain",
      observedAt: OBSERVED_AT,
      areaLabel: "Alger",
    });
    expect(extremeMessages).toHaveLength(4);
    for (const msg of extremeMessages) {
      expect(msg.notification.title).toBe(ONM_VERBATIM);
      expect(msg.data["provenance_source"]).toBe(ONM_VERBATIM);
      expect(msg.data["provenance_observed_at"]).toBe(OBSERVED_AT);
      expect(msg.android.notification.channel_id).toBe("alerts_urgent");
    }

    const severeMessages = fcmMessagesForOnm({
      broadcastId: "brd-onm-severe",
      severity: "Severe",
      communeCodes: ["1601"],
      title: "Vent",
      headlineFr: "Vents forts sur Alger",
      wilayaId: "16",
      event: "Wind",
      observedAt: OBSERVED_AT,
      areaLabel: "Alger",
    });
    expect(severeMessages).toHaveLength(4);
    for (const msg of severeMessages) {
      expect(msg.android.notification.channel_id).toBe("alerts_official");
      expect(msg.data["provenance_source"]).toBe(ONM_VERBATIM);
    }
  });

  it("emits valid Algiers CAP 1.2 timestamps and enforces unconfirmed fire honesty in buildFireCap + capToXml", () => {
    const alert = buildFireCap({
      shortId: "F-2026-01",
      lat: 36.75,
      lon: 3.05,
      radiusKm: 5,
      urgent: false,
      confirmed: false,
      areaDesc: "Chréa, Blida",
      sentAt: new Date(OBSERVED_AT),
      texts: [
        {
          language: "fr-DZ",
          event: "Incendie probable",
          headline: "Incendie probable signalé par satellite près de Chréa",
          description: "Source: NASA FIRMS, observé à 11:30 heure d'Alger.",
          instruction: "",
        },
      ],
    });

    expect(alert.sent).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+01:00$/);
    expect(alert.info[0]?.certainty).not.toBe("Observed");
    expect(alert.info[0]?.instruction).toBe("");
    const xml = capToXml(alert);
    expect(xml).toContain(`<sent>${alert.sent}</sent>`);
    expect(xml).toContain(`<effective>${alert.info[0]!.effective}</effective>`);
    expect(xml).toContain(`<expires>${alert.info[0]!.expires}</expires>`);
  });

  it("preserves verbatim ONM attribution, Algiers timestamp, provenance footer, and zero em dashes in WhatsApp broadcasts", () => {
    for (const locale of LOCALES) {
      const formatted = formatWhatsappBroadcastMessage({
        locale,
        candidate: {
          id: "brd-wa-onm-1",
          kind: "onm",
          phase: "initial",
          severity: "Extreme",
          sourceKey: "onm",
          sourceAttribution: ONM_VERBATIM,
          authorityStatus: "official",
          observedAt: OBSERVED_AT,
          headline: "Pluies torrentielles sur la wilaya d'Alger",
          areaLabel: "Alger",
        },
      });
      expect(formatted.text, `${locale} WhatsApp ONM attribution`).toContain(
        ONM_VERBATIM,
      );
      expect(formatted.algiersTimestamp.length).toBeGreaterThan(0);
      expect(formatted.provenanceFooter.length).toBeGreaterThan(0);
      expect(formatted.text).not.toContain("\u2014");
      expect(formatted.text).not.toMatch(/\bsafe\s+(?:zone|area|status)\b/i);
    }
  });

  it("preserves verbatim ONM attribution, Algiers timestamp, and provenance footer in Resend zone email digests", () => {
    for (const locale of LOCALES) {
      const rendered = renderZoneDigestEmail({
        locale,
        urgentBypass: true,
        alerts: [
          {
            id: "alert-email-onm-1",
            kind: "onm",
            severity: 4,
            title: "Pluies torrentielles sur Alger",
            body: "Bulletin météorologique spécial en cours.",
            created_at: OBSERVED_AT,
            zone_name: "Alger Centre",
            source_table: "onm_vigilance",
            payload: {
              provenance_trigger: "wilaya_warning",
              provenance_area: "Alger Centre",
              provenance_source_key: "onm",
              provenance_source: ONM_VERBATIM,
              provenance_rule: "provenance.rule.onmExtreme",
              provenance_observed_at: OBSERVED_AT,
              provenance_authority: "official",
            },
          },
        ],
      });

      expect(rendered.html, `${locale} email html ONM`).toContain(ONM_VERBATIM);
      expect(rendered.text, `${locale} email text ONM`).toContain(ONM_VERBATIM);
      expect(rendered.provenanceLines.length).toBe(1);
      expect(rendered.provenanceLines[0]!.length).toBeGreaterThan(0);
      expect(rendered.html).not.toContain("\u2014");
      expect(rendered.text).not.toContain("\u2014");
    }
  });

  it("preserves verbatim ONM attribution and Algiers timestamps in onmCardModel across all 4 locales", () => {
    const warning: OnmVigilance = {
      id: "onm-card-1",
      cap_id: "urn:oid:2.49.0.1.12.2026.11.25.1",
      title: "أمطار رعدية غزيرة",
      event: "Rain",
      severity: "Extreme",
      urgency: "Immediate",
      certainty: "Observed",
      onset: OBSERVED_AT,
      expires: "2026-11-25T22:00:00.000Z",
      sent: OBSERVED_AT,
      area_desc: "Alger",
      cap_url: "https://meteo.dz/cap/1.xml",
      wilaya_id: "16",
      headline_fr: "Pluies orageuses intenses sur Alger",
      superseded_at: null,
      msg_type: "Alert",
      cap_references: null,
      superseded_by: null,
      cancelled_at: null,
    };

    for (const locale of LOCALES) {
      const t = i18n.getFixedT(locale);
      const model = onmCardModel(
        warning,
        "Alger",
        (key, vars) => (vars ? t(key, vars) : t(key)),
        locale,
      );
      expect(model.eyebrow, `${locale} onmCardModel eyebrow`).toBe(
        ONM_VERBATIM,
      );
      expect(model.timestamp.length).toBeGreaterThan(0);
      expect(model.metaLine.length).toBeGreaterThan(0);
      expect(model.title).not.toContain("\u2014");
      expect(model.subtitle).not.toContain("\u2014");
      expect(model.timestamp).not.toContain("\u2014");
    }
  });
});

describe("Invariant 10 — Cross-track integration, source contracts, Track 2 delivery wiring, worker redaction, and routeTree parity (D2)", () => {
  it("reconciles all 28 migration-seeded source_contracts 100% against RUNTIME_CONTRACT_KEYS (26) + dgpc_telegram + geo", () => {
    const migrationDir = join(REPO_ROOT, "supabase/migrations");
    const migrationFiles = readdirSync(migrationDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(migrationFiles.length).toBe(176);

    const activeContracts = new Set<string>();
    for (const file of migrationFiles) {
      const stripped = stripSqlComments(
        readFileSync(join(migrationDir, file), "utf8"),
      );

      for (const insertMatch of stripped.matchAll(
        /insert\s+into\s+(?:public\.)?source_contracts\s*\([^)]*\)\s*values\s*([\s\S]*?)(?:on\s+conflict|;)/gi,
      )) {
        const valuesBlock = insertMatch[1] ?? "";
        for (const tuple of splitTopLevelCommas(valuesBlock)) {
          const keyMatch = /^\s*\(\s*'([a-z0-9_]+)'/i.exec(tuple);
          if (keyMatch?.[1]) {
            activeContracts.add(keyMatch[1]);
          }
        }
      }

      for (const selectMatch of stripped.matchAll(
        /insert\s+into\s+(?:public\.)?source_contracts\s*\([^)]*\)\s*select\s+'([a-z0-9_]+)'/gi,
      )) {
        if (selectMatch[1]) {
          activeContracts.add(selectMatch[1]);
        }
      }

      if (
        /delete\s+from\s+(?:public\.)?source_contracts\s+where\s+key\s+like\s+'rss\\_%/i.test(
          stripped,
        )
      ) {
        for (const key of [...activeContracts]) {
          if (key.startsWith("rss_")) activeContracts.delete(key);
        }
      }
    }

    expect(activeContracts.size).toBe(28);
    expect(RUNTIME_CONTRACT_KEYS).toHaveLength(26);

    const accountedFor = new Set<string>([
      ...RUNTIME_CONTRACT_KEYS,
      "dgpc_telegram", // dynamic text_sources runner
      "geo", // non-scheduled reference contract
    ]);

    const orphanedInDb = [...activeContracts]
      .filter((k) => !accountedFor.has(k))
      .sort();
    const deadInRuntime = [...accountedFor]
      .filter((k) => !activeContracts.has(k))
      .sort();

    expect(orphanedInDb).toEqual([]);
    expect(deadInRuntime).toEqual([]);
  });

  it("wires deliverEmailDigests into alert_evaluation and deliverWhatsappChannel into broadcast_delivery with fault isolation", async () => {
    const deliverEmailDigests = vi.fn().mockResolvedValue({
      sent: 4,
      deferredQuietHours: 1,
      failed: 0,
      bounced: 0,
      unconfigured: false,
      disabled: false,
    });
    const deliverWhatsappChannel = vi.fn().mockResolvedValue({
      sent: 2,
      retried: 1,
      failed: 0,
      unconfigured: false,
      disabled: false,
    });

    const runners = createSourceRunners(
      createMockDependencies({
        deliverEmailDigests,
        deliverWhatsappChannel,
      }),
    );

    const alertResult = await runners.alert_evaluation(
      makeMockJob("alert_evaluation"),
    );
    expect(deliverEmailDigests).toHaveBeenCalledTimes(1);
    expect(alertResult.outcome).toBe("succeeded");
    expect(alertResult.qualityChecks).toMatchObject({
      email_digest_sent: 4,
      email_digest_deferred_quiet: 1,
      email_digest_failed: 0,
      email_digest_bounced: 0,
      email_digest_unconfigured: false,
      email_digest_disabled: false,
    });

    const broadcastResult = await runners.broadcast_delivery(
      makeMockJob("broadcast_delivery"),
    );
    expect(deliverWhatsappChannel).toHaveBeenCalledTimes(1);
    expect(broadcastResult.outcome).toBe("succeeded");
    expect(broadcastResult.qualityChecks).toMatchObject({
      whatsapp_sent: 2,
      whatsapp_retried: 1,
      whatsapp_failed: 0,
      whatsapp_unconfigured: false,
      whatsapp_disabled: false,
    });

    // Verify Track 2 delivery faults never break core alert evaluation or FCM/Telegram broadcast delivery.
    const isolatedRunners = createSourceRunners(
      createMockDependencies({
        deliverEmailDigests: vi
          .fn()
          .mockRejectedValue(new Error("Resend temporary outage")),
        deliverWhatsappChannel: vi
          .fn()
          .mockRejectedValue(new Error("WhatsApp temporary outage")),
      }),
    );
    const isolatedAlert = await isolatedRunners.alert_evaluation(
      makeMockJob("alert_evaluation"),
    );
    expect(isolatedAlert.outcome).toBe("succeeded");
    expect(isolatedAlert.qualityChecks).toMatchObject({
      email_digest_error: true,
    });

    const isolatedBroadcast = await isolatedRunners.broadcast_delivery(
      makeMockJob("broadcast_delivery"),
    );
    expect(isolatedBroadcast.outcome).toBe("succeeded");
    expect(isolatedBroadcast.qualityChecks).toMatchObject({
      whatsapp_error: true,
    });
  });

  it("redacts all Track 1-4 runtime secret env keys in worker/src/index.ts", () => {
    const workerEntry = readRepoFile("worker/src/index.ts");
    const requiredSecrets = [
      "config.supabaseServiceRoleKey",
      "NADHIR_GATEWAY_ACCESS_CLIENT_SECRET",
      "LLM_FALLBACK_API_KEY",
      "fallbackConfig(process.env)",
      "FIREBASE_SERVICE_ACCOUNT",
      "FIRMS_MAP_KEY",
      "EUMETSAT_CONSUMER_SECRET",
      "EUMETSAT_PUSH_TOKEN",
      "CDSE_CLIENT_SECRET",
      "CDSE_ACCESS_TOKEN",
      "NASA_EARTHDATA_TOKEN",
      "TELEGRAM_BOT_TOKEN",
      "WHATSAPP_ACCESS_TOKEN",
      "RESEND_API_KEY",
      "TURNSTILE_SECRET_KEY",
    ];

    expect(requiredSecrets).toHaveLength(15);
    const missing = requiredSecrets.filter(
      (token) => !workerEntry.includes(token),
    );
    expect(missing).toEqual([]);
  });

  it("maintains exact 1:1 parity between all 70 route files under src/routes/ and src/routeTree.gen.ts", () => {
    const routeFiles = walkFiles(
      join(REPO_ROOT, "src/routes"),
      (rel) => /\.(?:ts|tsx)$/.test(rel) && !rel.includes("__tests__"),
    ).map((rel) =>
      rel.replace(/^src\/routes\//, "").replace(/\.(?:ts|tsx)$/, ""),
    );

    expect(routeFiles).toHaveLength(70);

    const routeTree = readRepoFile("src/routeTree.gen.ts");
    const importedRoutes = new Set<string>();
    for (const match of routeTree.matchAll(
      /from\s+['"]\.\/routes\/([^'"]+)['"]/g,
    )) {
      if (match[1]) importedRoutes.add(match[1]);
    }

    expect(importedRoutes.size).toBe(70);
    const missing = routeFiles.filter((r) => !importedRoutes.has(r));
    const stale = [...importedRoutes].filter((r) => !routeFiles.includes(r));
    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
  });
});
