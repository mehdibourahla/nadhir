import { describe, expect, it } from "vitest";

import {
  importRepoModule,
  listRepoFiles,
  readRepoFile,
  repoFileExists,
} from "../lib/env.ts";
import {
  createJpegWithExif,
  createPngWithExif,
  createSpoofedMimePayload,
  inspectImageForMetadata,
} from "../lib/exif.ts";
import {
  buildClmsFixture,
  buildCraagBulletin,
  buildEmscEvent,
  buildGhslFixture,
  buildGwisFixture,
  buildImergFixture,
  buildMtgFciFixture,
  buildMtgLightningFixture,
  buildTarikiPost,
} from "../lib/fixtures.ts";
import {
  fetchBytes,
  fetchJson,
  fetchText,
  startMockHttpServer,
} from "../lib/http.ts";
import { decodeRasterDimensions } from "../lib/image.ts";
import { assertPgReachable, psqlJson } from "../lib/pg.ts";

type AnyFn = (...args: unknown[]) => unknown;

function findCallable(
  mod: Record<string, unknown>,
  names: string[],
): AnyFn | null {
  for (const name of names) {
    const candidate = mod[name];
    if (typeof candidate === "function") {
      return candidate as AnyFn;
    }
  }
  return null;
}

function findFirstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (repoFileExists(p)) return p;
  }
  return null;
}

describe("Tier 1 — F18: Observed 30-Min Satellite Rainfall (NASA IMERG Early / H-SAF)", () => {
  it("F18.1: source_contracts registers IMERG / H-SAF contract with M6-1 fields and execution_target='worker'", () => {
    assertPgReachable();

    const rows = psqlJson<{
      key: string;
      version: number;
      cadence_minutes: number;
      licence: string;
      attribution: string;
      execution_target: string;
    }>(`
      SELECT key, version, cadence_minutes, licence, attribution, execution_target
      FROM public.source_contracts
      WHERE key ILIKE '%imerg%' OR key ILIKE '%hsaf%' OR key ILIKE '%rainfall%'
      ORDER BY key
    `);

    expect(rows.length).toBeGreaterThan(0);
    const contract = rows[0]!;
    expect(contract.version).toBeGreaterThanOrEqual(1);
    expect(contract.cadence_minutes).toBeLessThanOrEqual(60);
    expect(contract.licence.trim().length).toBeGreaterThan(0);
    expect(contract.attribution.trim().length).toBeGreaterThan(0);
    expect(contract.execution_target).toBe("worker");
  });

  it("F18.2: pure IMERG / H-SAF parser decodes 30-minute observed rainfall rates (mm/h and mm/30min) over Algeria bounds", async () => {
    const modPath = findFirstExisting([
      "src/lib/ingest/imerg.ts",
      "src/lib/ingest/imerg.server.ts",
      "src/lib/ingest/hsaf.ts",
      "src/lib/ingest/satellite-rainfall.ts",
    ]);
    expect(modPath, "IMERG/H-SAF parser module must exist").not.toBeNull();

    const mod = await importRepoModule<Record<string, unknown>>(modPath!);
    const parseFn = findCallable(mod, [
      "parseImergPayload",
      "parseImergGrid",
      "parseImergObservations",
      "parseSatelliteRainfall",
      "parseHsafPayload",
      "parseImerg",
    ]);
    expect(parseFn, `Parser export missing in ${modPath}`).not.toBeNull();

    const fixture = buildImergFixture();
    const producerPayload = {
      valid_time: fixture.windowEnd,
      published_time: fixture.windowEnd,
      window_minutes: 30,
      observation_kind: "satellite_observed",
      cells: fixture.cells.map((cell) => ({
        lat: cell.lat,
        lon: cell.lon,
        rate_mm_h: cell.mmPerHour,
        accum_mm_30m: cell.mm30m,
      })),
    };
    const parsed = (await parseFn!(producerPayload)) as {
      observations?: Array<{
        lat: number;
        lon: number;
        rateMmH: number;
        accumMm30m: number;
      }>;
    };
    expect(parsed).toBeTruthy();
    expect(parsed.observations?.length).toBeGreaterThanOrEqual(2);
    const algiersObs = parsed.observations?.find(
      (o) => Math.abs(o.lat - 36.75) < 0.05 && Math.abs(o.lon - 3.05) < 0.05,
    );
    expect(algiersObs).toBeDefined();
    expect(algiersObs?.rateMmH).toBeCloseTo(56.8, 1);
    expect(algiersObs?.accumMm30m).toBeCloseTo(28.4, 1);
  });

  it("F18.3: observed satellite precipitation stays strictly distinct from Open-Meteo model rainfall", () => {
    const modPath = findFirstExisting([
      "src/lib/ingest/imerg.ts",
      "src/lib/ingest/imerg.server.ts",
      "src/lib/ingest/hsaf.ts",
      "src/lib/ingest/satellite-rainfall.ts",
    ]);
    expect(modPath).not.toBeNull();
    const src = readRepoFile(modPath!);

    expect(src).toMatch(/observed|satellite|imerg|h-saf|hsaf/i);
    // Must never overwrite weather_snapshots (Open-Meteo model forecasts)
    expect(src).not.toMatch(
      /\.from\(["']weather_snapshots["']\)\.(?:insert|upsert|update)/,
    );
  });

  it("F18.4: real-schema IMERG / H-SAF fixture files exist under src/lib/__tests__/fixtures/", () => {
    const fixtureFiles = listRepoFiles("src/lib/__tests__/fixtures");
    const matching = fixtureFiles.filter((f) => /imerg|hsaf|rainfall/i.test(f));
    expect(matching.length).toBeGreaterThan(0);
  });

  it("F18.5: IMERG / H-SAF ingestion enforces idempotent 30-min slot deduplication with zero duplicate rows", () => {
    const migrations = listRepoFiles("supabase/migrations", ".sql")
      .filter((f) => f.includes("2026112404") || /imerg|hsaf|rain/i.test(f))
      .map((f) => readRepoFile(f))
      .join("\n");
    const modPath = findFirstExisting([
      "src/lib/ingest/imerg.server.ts",
      "src/lib/ingest/imerg.ts",
      "src/lib/ingest/hsaf.server.ts",
    ]);
    expect(modPath).not.toBeNull();
    const combined = `${migrations}\n${readRepoFile(modPath!)}`;

    expect(combined).toMatch(/unique|primary key|on conflict|upsert/i);
    expect(combined).toMatch(/imerg|hsaf|rainfall/i);
  });
});

describe("Tier 1 — F19: Hardened Gendarmerie Tariki Road-Danger Source", () => {
  it("F19.1: tariki_facebook is registered in source_contracts as a national official source targeting 'worker'", () => {
    assertPgReachable();

    const rows = psqlJson<{
      key: string;
      attribution: string;
      execution_target: string;
    }>(`
      SELECT key, attribution, execution_target
      FROM public.source_contracts
      WHERE key = 'tariki_facebook'
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.execution_target).toBe("worker");
    expect(rows[0]?.attribution).toMatch(/Gendarmerie|Tariki/i);
  });

  it("F19.2: Tariki parser accepts road danger posts (flood/snow/rockfall closures) and filters out non-danger noise (road works, convoys, heavy-trucks-only)", async () => {
    const modPath = findFirstExisting([
      "src/lib/text-sources/tariki.ts",
      "src/lib/text-sources/tariki.server.ts",
    ]);
    expect(modPath, "Tariki parser module must exist").not.toBeNull();

    const mod = await importRepoModule<Record<string, unknown>>(modPath!);
    const filterFn = findCallable(mod, [
      "classifyTarikiPostPreFilter",
      "classifyTarikiPost",
      "isTarikiRoadDanger",
      "isTarikiDangerPost",
      "parseTarikiPost",
      "extractTarikiRoadDanger",
    ]);
    expect(
      filterFn,
      `Tariki classifier/parser missing in ${modPath}`,
    ).not.toBeNull();

    const floodPost = buildTarikiPost({ kind: "flood_closure" });
    const snowPost = buildTarikiPost({ kind: "snow_closure" });
    const rockfallPost = buildTarikiPost({ kind: "rockfall_closure" });
    const worksPost = buildTarikiPost({ kind: "road_works" });
    const convoyPost = buildTarikiPost({ kind: "convoy" });
    const trucksPost = buildTarikiPost({ kind: "heavy_trucks_only" });

    const isAccepted = (res: unknown): boolean => {
      if (typeof res === "boolean") return res;
      if (typeof res === "string") {
        if (res === "candidate") return true;
        if (res.startsWith("ignore")) return false;
      }
      if (res && typeof res === "object") {
        const rec = res as Record<string, unknown>;
        if (typeof rec.accepted === "boolean") return rec.accepted;
        if (typeof rec.isDanger === "boolean") return rec.isDanger;
        if (typeof rec.dangerous === "boolean") return rec.dangerous;
        if (typeof rec.include === "boolean") return rec.include;
        if (rec.kind && rec.kind !== "ignore" && rec.kind !== "noise") {
          return true;
        }
      }
      return Boolean(res);
    };

    expect(isAccepted(filterFn!(floodPost.rawText))).toBe(true);
    expect(isAccepted(filterFn!(snowPost.rawText))).toBe(true);
    expect(isAccepted(filterFn!(rockfallPost.rawText))).toBe(true);

    expect(isAccepted(filterFn!(worksPost.rawText))).toBe(false);
    expect(isAccepted(filterFn!(convoyPost.rawText))).toBe(false);
    expect(isAccepted(filterFn!(trucksPost.rawText))).toBe(false);
  });

  it("F19.3: Tariki attribution renders 'Gendarmerie Nationale (Tariki)' dynamically and never hardcodes 'Protection Civile'", () => {
    const modPath = findFirstExisting([
      "src/lib/text-sources/tariki.ts",
      "src/lib/text-sources/tariki.server.ts",
    ]);
    expect(modPath).not.toBeNull();
    const src = readRepoFile(modPath!);

    expect(src).toMatch(/Gendarmerie Nationale.*Tariki|Tariki/i);
    expect(src).not.toMatch(/attribution\s*[:=]\s*["']Protection Civile/i);
  });

  it("F19.4: verbatim quote guard accepts valid Tariki quotes normalized across tatweel (\\u0640), emoji, and hashtags", async () => {
    const situationMod = await importRepoModule<{
      comparable: (s: string) => string;
      copiedFrom: (span: string, post: string) => boolean;
    }>("src/lib/text-sources/dgpc-situation.server.ts");

    expect(typeof situationMod.comparable).toBe("function");
    expect(typeof situationMod.copiedFrom).toBe("function");

    const noisy = buildTarikiPost({ kind: "tatweel_hashtag_emoji" });
    const normalized = situationMod.comparable(noisy.rawText);
    expect(normalized).not.toContain("\u0640");
    expect(normalized).not.toContain("#");
    expect(normalized).not.toContain("_");
    expect(normalized).not.toContain("🚨");
    expect(normalized).toContain("الطريق الوطني رقم 11");
    expect(normalized).toContain("مغلق بسبب الفيضان بولاية تيبازة");

    // Verbatim quote guard must accept true contiguous spans after tatweel/emoji/hashtag normalization
    expect(
      situationMod.copiedFrom(
        "الطريق الوطني رقم 11 طريقي RN11 مغلق بسبب الفيضان بولاية تيبازة",
        noisy.rawText,
      ),
    ).toBe(true);
    expect(
      situationMod.copiedFrom("مغلق بسبب الفيضان بولاية تيبازة", noisy.rawText),
    ).toBe(true);
    // And reject fabricated quotes not present in the post
    expect(situationMod.copiedFrom("حريق غابة في بجاية", noisy.rawText)).toBe(
      false,
    );
  });

  it("F19.5: Tariki road-danger source never grants 'confirmed' status to wildfire incidents", () => {
    const tarikiFiles = [
      "src/lib/text-sources/tariki.ts",
      "src/lib/text-sources/tariki.server.ts",
    ].filter((f) => repoFileExists(f));
    expect(tarikiFiles.length).toBeGreaterThan(0);

    const combined = tarikiFiles.map((f) => readRepoFile(f)).join("\n");
    expect(combined).not.toMatch(/confirmed_at\s*[:=]\s*new Date/i);
    expect(combined).not.toMatch(/state\s*[:=]\s*["']confirmed["']/i);
  });
});

describe("Tier 1 — F20: CRAAG Official Earthquake Attribution Matcher + EMSC M2+ Feed", () => {
  it("F20.1: EMSC adapter retains M2+ real-time feed filter and ingests buildEmscEvent()", async () => {
    const emscMod = await importRepoModule<{
      EMSC_MIN_MAGNITUDE: number;
      parseEmsc: (body: unknown) => Array<{
        id: string;
        magnitude: number;
        lat: number;
        lon: number;
      }>;
    }>("src/lib/ingest/emsc.ts");

    expect(emscMod.EMSC_MIN_MAGNITUDE).toBe(2);

    const ev = buildEmscEvent({ mag: 2.4, lat: 36.7525, lon: 5.0556 });
    const parsed = emscMod.parseEmsc({
      type: "FeatureCollection",
      features: [
        {
          ...ev,
          properties: {
            ...ev.properties,
            unid: ev.id,
            evtype: "ke",
          },
        },
      ],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(ev.id);
    expect(parsed[0]?.magnitude).toBe(2.4);

    const emscServerSrc = readRepoFile("src/lib/ingest/emsc.server.ts");
    expect(emscServerSrc).toMatch(/minmagnitude[\s\S]*EMSC_MIN_MAGNITUDE/);
  });

  it("F20.2: CRAAG contract is registered in source_contracts under M6-1 as national official seismological authority", () => {
    assertPgReachable();

    const rows = psqlJson<{
      key: string;
      attribution: string;
      execution_target: string;
    }>(`
      SELECT key, attribution, execution_target
      FROM public.source_contracts
      WHERE key ILIKE '%craag%'
    `);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.execution_target).toBe("worker");
    expect(rows[0]?.attribution).toMatch(/CRAAG/i);
  });

  it("F20.3: CRAAG spatio-temporal matcher links official CRAAG bulletin to matching EMSC event with CRAAG attribution and URL", async () => {
    const modPath = findFirstExisting([
      "src/lib/ingest/craag.ts",
      "src/lib/ingest/craag.server.ts",
    ]);
    expect(modPath, "CRAAG matcher module must exist").not.toBeNull();

    const mod = await importRepoModule<Record<string, unknown>>(modPath!);
    const matchFn = findCallable(mod, [
      "matchCraagBulletin",
      "matchCraagToEmsc",
      "matchCraagEvent",
      "reconcileCraagWithEmsc",
    ]);
    expect(
      matchFn,
      `CRAAG matcher export missing in ${modPath}`,
    ).not.toBeNull();

    const emsc = buildEmscEvent({
      id: "20261124_0000046",
      time: "2026-11-24T13:42:18Z",
      lat: 36.7525,
      lon: 5.0556,
      mag: 4.6,
    });
    const craag = buildCraagBulletin({
      eventTime: "2026-11-24T13:42:20Z",
      lat: 36.751,
      lon: 5.058,
      magnitude: 4.6,
    });

    const emscRecord = {
      id: emsc.id,
      occurred_at: emsc.properties.time,
      lat: emsc.properties.lat,
      lon: emsc.properties.lon,
      magnitude: emsc.properties.mag,
      depth_km: emsc.properties.depth,
    };
    const craagRecord = {
      bulletinId: "craag-20261124-01",
      observedAt: craag.eventTime,
      occurred_at: craag.eventTime,
      eventTime: craag.eventTime,
      lat: craag.lat,
      lon: craag.lon,
      magnitude: craag.magnitude,
      magnitudeType: "ml",
      depthKm: craag.depthKm,
      depth_km: craag.depthKm,
      place: craag.locationFr,
      location_fr: craag.locationFr,
      location_ar: craag.locationAr,
      sourceUrl: craag.bulletinUrl,
      url: craag.bulletinUrl,
      bulletinUrl: craag.bulletinUrl,
      attribution: "CRAAG",
    };

    const matched = matchFn!(craagRecord, [emscRecord]);
    expect(matched).toBeTruthy();
    const serialized = JSON.stringify(matched);
    expect(serialized).toContain(emsc.id);
  });

  it("F20.4: unmatched standalone official CRAAG bulletin is handled cleanly without fabricating EMSC IDs", async () => {
    const modPath = findFirstExisting([
      "src/lib/ingest/craag.ts",
      "src/lib/ingest/craag.server.ts",
    ]);
    expect(modPath).not.toBeNull();

    const mod = await importRepoModule<Record<string, unknown>>(modPath!);
    const matchFn = findCallable(mod, [
      "matchCraagBulletin",
      "matchCraagToEmsc",
      "matchCraagEvent",
      "reconcileCraagWithEmsc",
    ]);
    expect(matchFn).not.toBeNull();

    const distantEmsc = {
      id: "20261124_far_away",
      occurred_at: "2026-11-24T01:00:00Z",
      lat: 22.785,
      lon: 5.5228,
      magnitude: 3.1,
    };
    const craag = buildCraagBulletin({
      eventTime: "2026-11-24T13:42:20Z",
      lat: 36.751,
      lon: 5.058,
      magnitude: 4.6,
    });

    const result = matchFn!(
      {
        bulletinId: "craag-20261124-02",
        observedAt: craag.eventTime,
        occurred_at: craag.eventTime,
        eventTime: craag.eventTime,
        lat: craag.lat,
        lon: craag.lon,
        depthKm: craag.depthKm,
        magnitude: craag.magnitude,
        magnitudeType: "ml",
        place: craag.locationFr,
        sourceUrl: craag.bulletinUrl,
        url: craag.bulletinUrl,
        attribution: "CRAAG",
      },
      [distantEmsc],
    );

    expect(result).toBeNull();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("20261124_far_away");
  });

  it("F20.5: earthquake attribution remains Information (never 'confirmed damage' or Nadhir-voiced Instruction)", () => {
    const modPath = findFirstExisting([
      "src/lib/ingest/craag.ts",
      "src/lib/ingest/craag.server.ts",
    ]);
    expect(modPath).not.toBeNull();
    const src = readRepoFile(modPath!);

    expect(src).not.toMatch(/confirmed\s+damage/i);
    expect(src).not.toMatch(/evacuate\s+immediately/i);
  });
});

describe("Tier 1 — F21: 5 Post-Worker Scientific Sources + M6 Gate & national-sources-only", () => {
  it("F21.1: mtg_fci_push has contract + parser + isInWatchArea guard and NEVER references banned L1c EO:EUM:DAT:0665", async () => {
    assertPgReachable();
    const contracts = psqlJson<{ key: string; execution_target: string }>(`
      SELECT key, execution_target FROM public.source_contracts
      WHERE key ILIKE '%mtg_fci%' OR key ILIKE '%fci_push%'
    `);
    expect(contracts.length).toBeGreaterThan(0);

    const modPath = findFirstExisting([
      "src/lib/ingest/mtg-fci-push.ts",
      "src/lib/ingest/mtg-fci-push.server.ts",
      "src/lib/ingest/mtg-fci.ts",
      "src/lib/ingest/fci.server.ts",
    ]);
    expect(modPath).not.toBeNull();
    const src = readRepoFile(modPath!);
    expect(src).toMatch(/isInWatchArea|watchArea|algeria/i);

    const fciMod = await importRepoModule<{
      MTG_FCI_PUSH_ATTRIBUTION: string;
      validateMtgFciPushProductId: (id: string) => string;
      parseMtgFciPushJson: (payload: unknown) => unknown;
    }>("src/lib/ingest/mtg-fci-push.ts");
    expect(fciMod.MTG_FCI_PUSH_ATTRIBUTION).not.toContain("EO:EUM:DAT:0665");
    expect(() => fciMod.validateMtgFciPushProductId("EO:EUM:DAT:0665")).toThrow(
      /prohibited/i,
    );
    expect(() =>
      fciMod.parseMtgFciPushJson({
        product_id: "EO:EUM:DAT:0665",
        slot_time: "2026-11-24T12:00:00Z",
        published_at: "2026-11-24T12:02:00Z",
        features: [],
      }),
    ).toThrow(/prohibited/i);
    expect(fciMod.validateMtgFciPushProductId("EO:EUM:DAT:0662")).toContain(
      "0662",
    );

    const fixture = buildMtgFciFixture();
    expect(fixture.cadenceMinutes).toBeLessThanOrEqual(5);
  });

  it("F21.2: mtg_lightning (MTG LI L2) has contract + parser and is explicitly NOT labelled an observed wildfire", async () => {
    assertPgReachable();
    const contracts = psqlJson<{ key: string; execution_target: string }>(`
      SELECT key, execution_target FROM public.source_contracts
      WHERE key ILIKE '%lightning%' OR key ILIKE '%mtg_li%'
    `);
    expect(contracts.length).toBeGreaterThan(0);
    expect(contracts[0]?.execution_target).toBe("worker");

    const modPath = findFirstExisting([
      "src/lib/ingest/mtg-lightning.ts",
      "src/lib/ingest/mtg-lightning.server.ts",
      "src/lib/ingest/lightning.ts",
    ]);
    expect(modPath, "MTG Lightning module must exist").not.toBeNull();

    const liMod = await importRepoModule<{
      MTG_LIGHTNING_ATTRIBUTION: string;
      parseMtgLightningJson: (payload: unknown) => {
        observations: Array<{
          observationKind: string;
          isWildfire: boolean;
        }>;
      };
    }>("src/lib/ingest/mtg-lightning.ts");
    expect(liMod.MTG_LIGHTNING_ATTRIBUTION).not.toMatch(
      /observed\s+wildfire|confirmed\s+fire/i,
    );
    expect(() =>
      liMod.parseMtgLightningJson({
        published_at: "2026-11-24T12:00:00Z",
        is_observed_wildfire: true,
        features: [],
      }),
    ).toThrow(/not an observed wildfire/i);

    const fixture = buildMtgLightningFixture();
    expect(fixture.flashes.length).toBeGreaterThan(0);
    const parsed = liMod.parseMtgLightningJson({
      published_at: fixture.slotTime,
      product_type: "L2-LFL",
      flashes: fixture.flashes.map((f, idx) => ({
        flash_id: `fl-${idx + 1}`,
        observed_at: fixture.slotTime,
        lat: f.lat,
        lon: f.lon,
        radiance: f.radianceJ,
      })),
    });
    expect(parsed.observations.length).toBeGreaterThan(0);
    for (const obs of parsed.observations) {
      expect(obs.observationKind).toBe("lightning_observation");
      expect(obs.isWildfire).toBe(false);
    }
  });

  it("F21.3: gwis (GWIS NRT Burned Areas) has contract + parser, CC BY 4.0 attribution, and observational-estimate caveat", async () => {
    assertPgReachable();
    const contracts = psqlJson<{
      key: string;
      licence: string;
      execution_target: string;
    }>(`
      SELECT key, licence, execution_target FROM public.source_contracts
      WHERE key ILIKE '%gwis%'
    `);
    expect(contracts.length).toBeGreaterThan(0);
    expect(contracts[0]?.execution_target).toBe("worker");
    expect(contracts[0]?.licence).toMatch(/CC[\s-]?BY/i);

    const modPath = findFirstExisting([
      "src/lib/ingest/gwis.ts",
      "src/lib/ingest/gwis.server.ts",
    ]);
    expect(modPath, "GWIS module must exist").not.toBeNull();
    const src = readRepoFile(modPath!);
    expect(src).toMatch(/FIRMS|estimate|observational|burned/i);
    expect(src).not.toMatch(/fuelRecoveryCurve|inventedRecovery/i);

    const fixture = buildGwisFixture();
    expect(fixture.burnedAreaHa).toBeGreaterThan(0);
  });

  it("F21.4: clms (CLMS NDVI v3 & SWI v4) has contract + parser and stays distinct from calibrated fuel availability", async () => {
    assertPgReachable();
    const contracts = psqlJson<{ key: string; execution_target: string }>(`
      SELECT key, execution_target FROM public.source_contracts
      WHERE key ILIKE '%clms%' OR key ILIKE '%ndvi%'
    `);
    expect(contracts.length).toBeGreaterThan(0);
    expect(contracts[0]?.execution_target).toBe("worker");

    const modPath = findFirstExisting([
      "src/lib/ingest/clms.ts",
      "src/lib/ingest/clms.server.ts",
    ]);
    expect(modPath, "CLMS module must exist").not.toBeNull();
    const src = readRepoFile(modPath!);
    expect(src).toMatch(/ndvi/i);
    expect(src).toMatch(/swi/i);

    const fixture = buildClmsFixture();
    expect(fixture.swi).toBeGreaterThan(0);
  });

  it("F21.5: ghsl (GHSL GHS-POP R2023A) has contract + parser and labels exposure as 'modeled residents' (never 'people currently present')", async () => {
    assertPgReachable();
    const contracts = psqlJson<{ key: string; execution_target: string }>(`
      SELECT key, execution_target FROM public.source_contracts
      WHERE key ILIKE '%ghsl%'
    `);
    expect(contracts.length).toBeGreaterThan(0);
    expect(contracts[0]?.execution_target).toBe("worker");

    const modPath = findFirstExisting([
      "src/lib/ingest/ghsl.ts",
      "src/lib/ingest/ghsl.server.ts",
    ]);
    expect(modPath, "GHSL module must exist").not.toBeNull();

    const ghslMod = await importRepoModule<{
      GHSL_ATTRIBUTION: string;
      GHSL_EXPOSURE_LABEL: string;
      parseGhslJson: (payload: unknown) => unknown;
    }>("src/lib/ingest/ghsl.ts");
    expect(ghslMod.GHSL_ATTRIBUTION).toMatch(/modeled|modelled|resident/i);
    expect(ghslMod.GHSL_EXPOSURE_LABEL).toBe("modeled_residents");
    expect(ghslMod.GHSL_ATTRIBUTION).not.toMatch(
      /people\s+currently\s+present/i,
    );
    expect(() =>
      ghslMod.parseGhslJson({
        epoch_year: 2025,
        resolution_m: 100,
        published_at: "2026-11-24T00:00:00Z",
        exposure_label: "people currently present",
        communes: [],
      }),
    ).toThrow(/rejected|modeled_residents/i);
    expect(() =>
      ghslMod.parseGhslJson({
        epoch_year: 2025,
        resolution_m: 100,
        published_at: "2026-11-24T00:00:00Z",
        is_live_occupancy: true,
        communes: [],
      }),
    ).toThrow(/not live occupancy|people currently present/i);

    const fixture = buildGhslFixture();
    expect(fixture.populationWithin5km).toBeGreaterThan(0);
  });

  it("F21.6: docs/m6-new-source-gate.md exists and verifies M6-1..M6-7 and national-sources-only for all 8 Track 4 sources", () => {
    expect(repoFileExists("docs/m6-new-source-gate.md")).toBe(true);
    const doc = readRepoFile("docs/m6-new-source-gate.md");

    for (const gate of [
      "M6-1",
      "M6-2",
      "M6-3",
      "M6-4",
      "M6-5",
      "M6-6",
      "M6-7",
    ]) {
      expect(doc, `m6-new-source-gate.md must check ${gate}`).toContain(gate);
    }
    expect(doc).toMatch(/national-sources-only/i);

    for (const source of [
      /imerg|h-saf|hsaf/i,
      /tariki/i,
      /craag/i,
      /mtg.*fci|fci/i,
      /lightning|mtg.*li/i,
      /gwis/i,
      /clms|ndvi/i,
      /ghsl/i,
    ]) {
      expect(doc).toMatch(source);
    }
  });

  it("F21.7: enforces national-sources-only rule with zero per-wilaya or per-commune Algerian scraper contracts in source_contracts", () => {
    assertPgReachable();

    const contracts = psqlJson<{ key: string; label: string }>(`
      SELECT key, label FROM public.source_contracts ORDER BY key
    `);
    expect(contracts.length).toBeGreaterThan(0);

    const localScraperRe =
      /(?:^|_)(?:wilaya|commune|apc|daira)_(?:\d{2}|alger|oran|bejaia|tizi|setif|blida|constantine|tipaza|annaba)/i;
    const violations = contracts.filter(
      (c) => localScraperRe.test(c.key) || localScraperRe.test(c.label),
    );
    expect(violations).toEqual([]);
  });
});

describe("Tier 1 — F22: Law 18-07 / Law 25-11 (ANPDP) Privacy Compliance Hardening", () => {
  it("F22.1: /privacy renders Law 18-07, Law 25-11, and ANPDP disclosures in all 4 locales (ar, fr, en, kab)", async () => {
    for (const lang of ["ar", "fr", "en", "kab"] as const) {
      const res = await fetchText(`/privacy?lang=${lang}`);
      expect(res.status, `/privacy?lang=${lang} must return 200`).toBe(200);
      expect(res.text).toMatch(/18-07/);
      expect(res.text).toMatch(/25-11/);
      expect(res.text).toMatch(/ANPDP|السلطة الوطنية لحماية المعطيات/);
    }
  });

  it("F22.2: /privacy and i18n disclose cross-border transfers (EU/Supabase/Cloudflare/Firebase/Resend) and data-subject rights", async () => {
    const res = await fetchText("/privacy?lang=fr");
    expect(res.status).toBe(200);
    const privacySrc = readRepoFile("src/routes/privacy.tsx");
    const track4Fr = readRepoFile("src/i18n/modules/track4/fr.ts");
    const combined = `${res.text}\n${privacySrc}\n${track4Fr}`;

    expect(combined).toMatch(/Supabase/i);
    expect(combined).toMatch(/Cloudflare/i);
    expect(combined).toMatch(/Firebase/i);
    expect(combined).toMatch(/Resend/i);
    expect(combined).toMatch(
      /acc[èe]s|rectification|effacement|opposition|portabilit/i,
    );
  });

  it("F22.3: privacy-consent.server.ts and /api/private/privacy-consent persist versioned consent recording & withdrawal", async () => {
    expect(repoFileExists("src/lib/privacy-consent.server.ts")).toBe(true);
    const consentRoutePath = findFirstExisting([
      "src/routes/api/private/privacy-consent.ts",
      "src/routes/api/private/privacy.consent.ts",
    ]);
    expect(
      consentRoutePath,
      "privacy-consent API route must exist",
    ).not.toBeNull();

    const mod = await importRepoModule<Record<string, unknown>>(
      "src/lib/privacy-consent.server.ts",
    );
    expect(Object.keys(mod).length).toBeGreaterThan(0);

    const unauthRes = await fetchText("/api/private/privacy-consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "2026-11", granted: true }),
    });
    expect([401, 403]).toContain(unauthRes.status);
  });

  it("F22.4: /api/private/privacy-export enforces authentication and exports structured personal data JSON", async () => {
    const exportRoutePath = findFirstExisting([
      "src/routes/api/private/privacy-export.ts",
      "src/routes/api/private/privacy.export.ts",
    ]);
    expect(
      exportRoutePath,
      "privacy-export API route must exist",
    ).not.toBeNull();

    const routeSrc = readRepoFile(exportRoutePath!);
    const helperSrc = readRepoFile("src/lib/privacy-consent.server.ts");
    expect(routeSrc).toMatch(/handlePrivacyExport/);
    expect(`${routeSrc}\n${helperSrc}`).toMatch(/auth|session|user|getUser/i);

    const unauthRes = await fetchText("/api/private/privacy-export", {
      method: "GET",
    });
    expect([401, 403, 405]).toContain(unauthRes.status);
  });

  it("F22.5: docs/privacy-anpdp-compliance.md maps Law 18-07 / Law 25-11 statutory obligations and data-minimization controls", () => {
    expect(repoFileExists("docs/privacy-anpdp-compliance.md")).toBe(true);
    const doc = readRepoFile("docs/privacy-anpdp-compliance.md");

    expect(doc).toMatch(/18-07/);
    expect(doc).toMatch(/25-11/);
    expect(doc).toMatch(/ANPDP/);
    expect(doc).toMatch(/minimi[sz]ation|ADR-0006|on-device/i);
  });
});

describe("Tier 1 — F23: Server-Side EXIF Stripping for User Uploads", () => {
  it("F23.1: strips ALL GPS, Make, Model, DateTime, and COM metadata from JPEG bytes", async () => {
    const mod = await importRepoModule<{
      stripImageMetadata: (bytes: Uint8Array, type: string) => Uint8Array;
    }>("src/lib/image-metadata.ts");

    const dirtyJpeg = createJpegWithExif({
      make: "Samsung",
      model: "Galaxy A55",
      latitude: 36.7538,
      longitude: 3.0588,
      comment: "Secret reporter location",
    });
    const before = inspectImageForMetadata(dirtyJpeg);
    expect(before.hasExif).toBe(true);
    expect(before.hasGps).toBe(true);
    expect(before.hasCameraTags).toBe(true);
    expect(before.hasTextChunks).toBe(true);

    const cleaned = mod.stripImageMetadata(dirtyJpeg, "image/jpeg");
    const after = inspectImageForMetadata(cleaned);
    expect(after.format).toBe("jpeg");
    expect(after.hasExif).toBe(false);
    expect(after.hasGps).toBe(false);
    expect(after.hasCameraTags).toBe(false);
    expect(after.hasTextChunks).toBe(false);
  });

  it("F23.2: strips ALL eXIf, tEXt, and iTXt metadata chunks from PNG bytes", async () => {
    const mod = await importRepoModule<{
      stripImageMetadata: (bytes: Uint8Array, type: string) => Uint8Array;
    }>("src/lib/image-metadata.ts");

    const dirtyPng = createPngWithExif({
      author: "Citizen Reporter",
      make: "Xiaomi",
      model: "Redmi Note 13",
      latitude: 36.75,
      longitude: 3.05,
    });
    const before = inspectImageForMetadata(dirtyPng);
    expect(before.hasExif).toBe(true);
    expect(before.hasGps).toBe(true);
    expect(before.hasTextChunks).toBe(true);

    const cleaned = mod.stripImageMetadata(dirtyPng, "image/png");
    const after = inspectImageForMetadata(cleaned);
    expect(after.format).toBe("png");
    expect(after.hasExif).toBe(false);
    expect(after.hasGps).toBe(false);
    expect(after.hasCameraTags).toBe(false);
    expect(after.hasTextChunks).toBe(false);
  });

  it("F23.3: sanitized JPEG and PNG outputs remain valid decodable non-blank raster images", async () => {
    const mod = await importRepoModule<{
      stripImageMetadata: (bytes: Uint8Array, type: string) => Uint8Array;
    }>("src/lib/image-metadata.ts");

    const cleanedJpeg = mod.stripImageMetadata(
      createJpegWithExif(),
      "image/jpeg",
    );
    const jpegInfo = await decodeRasterDimensions(cleanedJpeg);
    expect(jpegInfo.format).toBe("jpeg");
    expect(jpegInfo.width).toBe(16);
    expect(jpegInfo.height).toBe(16);
    expect(jpegInfo.isBlank).toBe(false);

    const cleanedPng = mod.stripImageMetadata(createPngWithExif(), "image/png");
    const pngInfo = await decodeRasterDimensions(cleanedPng);
    expect(pngInfo.format).toBe("png");
    expect(pngInfo.width).toBe(16);
    expect(pngInfo.height).toBe(16);
    expect(pngInfo.isBlank).toBe(false);
  });

  it("F23.4: /api/private/report-photo upload route exists, enforces auth, and invokes server-side EXIF stripping before Storage write", async () => {
    expect(repoFileExists("src/routes/api/private/report-photo.ts")).toBe(true);
    expect(repoFileExists("src/lib/report-photo.server.ts")).toBe(true);

    const routeSrc = readRepoFile("src/routes/api/private/report-photo.ts");
    const helperSrc = readRepoFile("src/lib/report-photo.server.ts");
    const metadataSrc = readRepoFile("src/lib/image-metadata.ts");
    expect(`${routeSrc}\n${helperSrc}`).toMatch(/validateAndStripReportPhoto/);
    expect(metadataSrc).toMatch(
      /export function validateAndStripReportPhoto[\s\S]*stripImageMetadata/,
    );
    expect(`${routeSrc}\n${helperSrc}`).toMatch(/auth|getUser|session/i);

    const unauthRes = await fetchBytes("/api/private/report-photo", {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: Buffer.from(createJpegWithExif()),
    });
    expect([401, 403]).toContain(unauthRes.status);
  });

  it("F23.5: preserves valid ICC profile while stripping GPS/camera tags and rejects spoofed MIME payloads", async () => {
    const mod = await importRepoModule<{
      stripImageMetadata: (bytes: Uint8Array, type: string) => Uint8Array;
    }>("src/lib/image-metadata.ts");

    const withIcc = createJpegWithExif({ includeIccProfile: true });
    const cleaned = mod.stripImageMetadata(withIcc, "image/jpeg");
    const after = inspectImageForMetadata(cleaned);
    expect(after.hasExif).toBe(false);
    expect(after.hasGps).toBe(false);
    expect(after.markers).toContain("APP2-ICC");

    const spoofed = createSpoofedMimePayload();
    expect(() => mod.stripImageMetadata(spoofed, "image/jpeg")).toThrow();
    expect(() => mod.stripImageMetadata(spoofed, "image/png")).toThrow();
  });
});

describe("Tier 1 — F24: Cloudflare Turnstile CAPTCHA Protection", () => {
  type TurnstileMod = Record<string, unknown>;

  it("F24.1: src/lib/turnstile.server.ts verifies a valid token against mocked local siteverify server", async () => {
    const mod = await importRepoModule<TurnstileMod>(
      "src/lib/turnstile.server.ts",
    );
    const verifyFn = findCallable(mod, [
      "verifyTurnstileToken",
      "verifyTurnstile",
    ]);
    expect(
      verifyFn,
      "turnstile.server.ts must export verifyTurnstileToken/verifyTurnstile",
    ).not.toBeNull();

    const mockVerify = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        action: "citizen_report",
        hostname: "nadhir.app",
      }),
    }));

    try {
      const res = (await verifyFn!({
        token: "valid-turnstile-token-123",
        secretKey: "test-turnstile-secret",
        secret: "test-turnstile-secret",
        verifyUrl: `${mockVerify.url}/turnstile/v0/siteverify`,
        endpoint: `${mockVerify.url}/turnstile/v0/siteverify`,
        expectedAction: "citizen_report",
        expectedHostname: "nadhir.app",
      })) as { ok?: boolean; success?: boolean };

      expect(Boolean(res?.ok ?? res?.success)).toBe(true);
      expect(mockVerify.requests.length).toBe(1);
    } finally {
      await mockVerify.close();
    }
  });

  it("F24.2: blocks missing or invalid Turnstile token with fail-closed behavior when configured", async () => {
    const mod = await importRepoModule<TurnstileMod>(
      "src/lib/turnstile.server.ts",
    );
    const verifyFn = findCallable(mod, [
      "verifyTurnstileToken",
      "verifyTurnstile",
    ]);
    expect(verifyFn).not.toBeNull();

    const mockVerify = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        success: false,
        "error-codes": ["invalid-input-response"],
      }),
    }));

    try {
      const missingRes = (await verifyFn!({
        token: "",
        secretKey: "test-turnstile-secret",
        secret: "test-turnstile-secret",
        verifyUrl: `${mockVerify.url}/turnstile/v0/siteverify`,
        endpoint: `${mockVerify.url}/turnstile/v0/siteverify`,
      })) as { ok?: boolean; success?: boolean };
      expect(Boolean(missingRes?.ok ?? missingRes?.success)).toBe(false);

      const invalidRes = (await verifyFn!({
        token: "forged-token",
        secretKey: "test-turnstile-secret",
        secret: "test-turnstile-secret",
        verifyUrl: `${mockVerify.url}/turnstile/v0/siteverify`,
        endpoint: `${mockVerify.url}/turnstile/v0/siteverify`,
      })) as { ok?: boolean; success?: boolean };
      expect(Boolean(invalidRes?.ok ?? invalidRes?.success)).toBe(false);
      expect(mockVerify.requests.length).toBe(1);
    } finally {
      await mockVerify.close();
    }
  });

  it("F24.3: rejects Turnstile token when returned action or hostname mismatches expected values", async () => {
    const mod = await importRepoModule<TurnstileMod>(
      "src/lib/turnstile.server.ts",
    );
    const verifyFn = findCallable(mod, [
      "verifyTurnstileToken",
      "verifyTurnstile",
    ]);
    expect(verifyFn).not.toBeNull();

    const mockVerify = await startMockHttpServer(() => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        action: "wrong_action",
        hostname: "evil.example",
      }),
    }));

    try {
      const res = (await verifyFn!({
        token: "mismatched-token",
        secretKey: "test-turnstile-secret",
        secret: "test-turnstile-secret",
        verifyUrl: `${mockVerify.url}/turnstile/v0/siteverify`,
        endpoint: `${mockVerify.url}/turnstile/v0/siteverify`,
        expectedAction: "citizen_report",
        expectedHostname: "nadhir.app",
      })) as { ok?: boolean; success?: boolean };

      expect(Boolean(res?.ok ?? res?.success)).toBe(false);
      expect(mockVerify.requests.length).toBe(1);
    } finally {
      await mockVerify.close();
    }
  });

  it("F24.4: src/components/TurnstileWidget.tsx exists and wires cf-turnstile-response into forms", () => {
    expect(repoFileExists("src/components/TurnstileWidget.tsx")).toBe(true);
    const widgetSrc = readRepoFile("src/components/TurnstileWidget.tsx");
    expect(widgetSrc).toMatch(/turnstile/i);
    expect(widgetSrc).toMatch(/cf-turnstile-response|onVerify|onToken|token/i);
  });

  it("F24.5: abuse-prone write endpoints invoke Turnstile verification while read-only hazard feeds never require CAPTCHA", async () => {
    const writeCandidates = [
      "src/routes/api/public/contribute/idea.ts",
      "src/routes/api/public/contribute/translation.ts",
      "src/routes/api/private/report-publish.ts",
      "src/lib/report-publish.server.ts",
      "src/lib/contribute.server.ts",
      "src/routes/auth.tsx",
    ].filter((f) => repoFileExists(f));
    const combinedWrite = writeCandidates
      .map((f) => readRepoFile(f))
      .join("\n");
    expect(combinedWrite).toMatch(/turnstile|Turnstile/i);

    // Read-only public hazard feeds must remain open without CAPTCHA
    const firesRes = await fetchJson<Record<string, unknown>>(
      "/api/public/v1/fires?limit=2",
    );
    expect(firesRes.status).toBe(200);
    const civilRes = await fetchJson<Record<string, unknown>>(
      "/api/public/v1/civil?limit=2",
    );
    expect(civilRes.status).toBe(200);
  });
});
