import { FIRE_KINDS, isFireKind } from "@/lib/text-sources/merge";
import { fireLevel, type FireContext } from "@/lib/fire-confidence";
import { fireContexts } from "@/lib/ingest/fire-context.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { MIN_CONFIDENCE } from "@/lib/alerts-rules";
import {
  broadcastTexts,
  earthquakeTexts,
  officialHazardTexts,
  officialTexts,
  type OfficialVars,
} from "@/lib/broadcast-copy";
import {
  BROADCAST_END_AFTER_HOURS,
  EARTHQUAKE_BROADCAST_FRESH_HOURS,
  EARTHQUAKE_BROADCAST_MIN_MAGNITUDE,
  EARTHQUAKE_BROADCAST_RADIUS_KM,
  NON_FIRE_BROADCAST_KINDS,
  OFFICIAL_FIRE_FRESH_HOURS,
  REOPEN_WINDOW_HOURS,
  applyDailyLimit,
  coverageOf,
  downwindAdditions,
  earthquakeSeverity,
  evaluateOfficialIncidentBroadcast,
  fireSeverity,
  fuelLimitedCodes,
  insideCommunes,
  isNonFireBroadcastKind,
  onmRelayPlan,
  onmUpdateMaterialChange,
  onmWarningIsCurrent,
  planFireBroadcast,
  pushCodesFor,
  setThreadCoverage,
  targetCommunes,
  targetCommunesForEarthquake,
  type CommuneShape,
  type OnmWarning,
  type OpenThread,
} from "@/lib/broadcast-rules";
import {
  buildBroadcastCap,
  buildEarthquakeCap,
  buildOfficialCap,
  officialCapCategory,
  parseCapMsgType,
  type BroadcastPhase,
} from "@/lib/cap";
import { coordLabel, fireStage, haversineKm } from "@/lib/nadhir";
import { fetchAllPages } from "@/lib/paginate";

import { algiersClock, algiersToday } from "./algiers-date";
import { PIXEL_GRID } from "./fusion-geometry";

export type BroadcastRun = { published: number; suppressed: number };

const OPEN_THREAD_WINDOW_DAYS = 30;
const GEOM_PREFILTER_KM = 80;
const FRESH_DETECTIONS_MIN = 30;
const ONM_RELAYED_LOOKBACK_HOURS = 72;
const HOUR = 3600_000;

type ClusterRow = {
  id: string;
  short_id: string;
  state: string;
  lat: number;
  lon: number;
  confidence: number;
  detection_count: number;
  spread_bearing_deg: number | null;
  first_detected_at: string;
  last_detected_at: string;
  nearest_settlement_id: string | null;
  nearest_settlement_km: number | null;
  commune_id: string | null;
  max_frp_mw: number | null;
  confirmed_at: string | null;
};

type Unit = {
  id: string;
  code: string;
  name_fr: string;
  name_ar: string;
  name_en: string;
  name_kab: string;
  parent_id: string | null;
  lat: number;
  lon: number;
};

async function auditRow(row: {
  action: "published" | "suppressed";
  reason: string;
  kind?: string;
  cluster_id?: string | null;
  onm_vigilance_id?: string | null;
  phase?: string;
  severity?: string;
  commune_codes?: string[];
  payload?: Json;
}) {
  const { error } = await supabaseAdmin.from("broadcast_audit").insert(row);
  if (error) throw new Error(`broadcast_audit insert failed: ${error.message}`);
}

async function loadSentToday(): Promise<Map<string, number>> {
  const todayRows = await fetchAllPages<{ push_codes: string[] | null }>(
    (from, to) =>
      supabaseAdmin
        .from("broadcasts")
        .select("push_codes")
        .in("phase", ["initial", "update"])
        .gte("created_at", `${algiersToday()}T00:00:00+01:00`)
        .order("id")
        .range(from, to),
  );
  const sentToday = new Map<string, number>();
  for (const row of todayRows)
    for (const code of row.push_codes ?? [])
      sentToday.set(code, (sentToday.get(code) ?? 0) + 1);
  return sentToday;
}

async function runRelays(sentToday: Map<string, number>): Promise<number> {
  let relayed = 0;
  relayed += await relayOnmWarnings(sentToday);
  relayed += await relayAuthorityWarnings(sentToday);
  relayed += await relayOfficialIncidents(sentToday);
  relayed += await relayEarthquakes(sentToday);
  return relayed;
}

export async function publishBroadcasts(): Promise<BroadcastRun> {
  // fail closed: a missing or unreadable kill-switch row must stop publishing
  const { data: settings, error: settingsError } = await supabaseAdmin
    .from("broadcast_settings")
    .select("enabled")
    .eq("id", true)
    .single();
  if (settingsError) throw new Error(settingsError.message);

  if (settings.enabled !== true) {
    // one audit row per outage, not one per 15-minute run
    const { data: last } = await supabaseAdmin
      .from("broadcast_audit")
      .select("action, reason")
      .order("at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!(last?.action === "suppressed" && last.reason === "kill_switch"))
      await auditRow({ action: "suppressed", reason: "kill_switch" });
    return { published: 0, suppressed: 1 };
  }

  const sentToday = await loadSentToday();

  const windowStart = new Date(
    Date.now() - OPEN_THREAD_WINDOW_DAYS * 86400_000,
  ).toISOString();
  const recent = await fetchAllPages<{
    cluster_id: string | null;
    phase: string;
    severity: string;
    commune_codes: string[];
    inside_codes: string[];
    created_at: string;
  }>((from, to) =>
    supabaseAdmin
      .from("broadcasts")
      .select(
        "cluster_id, phase, severity, commune_codes, inside_codes, created_at",
      )
      .eq("kind", "fire")
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  const now = Date.now();
  const latestByCluster = new Map<string, OpenThread>();
  for (const b of recent) {
    if (!b.cluster_id || latestByCluster.has(b.cluster_id)) continue;
    latestByCluster.set(b.cluster_id, {
      phase: b.phase,
      severity: b.severity,
      communeCodes: b.commune_codes,
      insideCodes: b.inside_codes,
      atMs: Date.parse(b.created_at),
    });
  }
  const openClusterIds = [...latestByCluster.entries()]
    .filter(
      ([, b]) =>
        b.phase === "initial" ||
        b.phase === "update" ||
        (b.phase === "end" && now - b.atMs < REOPEN_WINDOW_HOURS * HOUR),
    )
    .map(([id]) => id);
  const coverage = coverageOf(latestByCluster);

  const clusterFields =
    "id, short_id, state, lat, lon, confidence, detection_count, spread_bearing_deg, first_detected_at, last_detected_at, nearest_settlement_id, nearest_settlement_km, commune_id, max_frp_mw, confirmed_at";
  const { data: confirmed, error: confirmedError } = await supabaseAdmin
    .from("fire_clusters")
    .select(clusterFields)
    .eq("state", "active")
    .gte("confidence", MIN_CONFIDENCE);
  if (confirmedError) throw new Error(confirmedError.message);

  const byId = new Map<string, ClusterRow>(
    (confirmed ?? []).map((c) => [c.id, c]),
  );
  const missingOpen = openClusterIds.filter((id) => !byId.has(id));
  if (missingOpen.length) {
    const { data: openRows, error: openError } = await supabaseAdmin
      .from("fire_clusters")
      .select(clusterFields)
      .in("id", missingOpen);
    if (openError) throw new Error(openError.message);
    for (const c of openRows ?? []) byId.set(c.id, c);
  }
  const clusters = [...byId.values()];
  if (!clusters.length) {
    const relayed = await runRelays(sentToday);
    return { published: relayed, suppressed: 0 };
  }

  const units = await fetchAllPages<Unit & { level: string }>((from, to) =>
    supabaseAdmin
      .from("admin_units")
      .select(
        "id, code, name_fr, name_ar, name_en, name_kab, parent_id, lat, lon, level",
      )
      .order("code")
      .order("id")
      .range(from, to),
  );
  const communes = units.filter((u) => u.level === "commune");
  const unitById = new Map(units.map((u) => [u.id, u]));
  const unitByCode = new Map(units.map((u) => [u.code, u]));
  const nameOf = (
    code: string,
    field: "name_ar" | "name_fr" | "name_en" | "name_kab",
  ) => unitByCode.get(code)?.[field] || unitByCode.get(code)?.name_fr || code;

  const pointsByCluster = new Map<string, { lat: number; lon: number }[]>();
  {
    const ids = clusters.map((c) => c.id);
    const since = new Date(now - FRESH_DETECTIONS_MIN * 60_000).toISOString();
    for (let i = 0; i < ids.length; i += 100) {
      const rows = await fetchAllPages<{
        cluster_id: string;
        lat: number;
        lon: number;
      }>((from, to) =>
        supabaseAdmin
          .from("detections")
          .select("cluster_id, lat, lon")
          .in("cluster_id", ids.slice(i, i + 100))
          .gte("created_at", since)
          .order("id")
          .range(from, to),
      );
      const seen = new Set<string>();
      for (const r of rows) {
        const key = `${r.cluster_id}:${Math.round(r.lat / PIXEL_GRID)}:${Math.round(r.lon / PIXEL_GRID)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const bucket = pointsByCluster.get(r.cluster_id) ?? [];
        bucket.push({ lat: r.lat, lon: r.lon });
        pointsByCluster.set(r.cluster_id, bucket);
      }
    }
  }

  const shortlist = communes.filter((c) =>
    clusters.some(
      (f) => haversineKm(f.lat, f.lon, c.lat, c.lon) <= GEOM_PREFILTER_KM,
    ),
  );
  const geomById = new Map<string, CommuneShape["geom"]>();
  const landcoverById = new Map<
    string,
    Parameters<typeof fuelLimitedCodes>[0][number]["landcover"]
  >();
  for (let i = 0; i < shortlist.length; i += 50) {
    const ids = shortlist.slice(i, i + 50).map((c) => c.id);
    const { data, error } = await supabaseAdmin
      .from("admin_units")
      .select("id, geom, landcover")
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      geomById.set(row.id, row.geom as CommuneShape["geom"]);
      landcoverById.set(
        row.id,
        row.landcover as Parameters<
          typeof fuelLimitedCodes
        >[0][number]["landcover"],
      );
    }
  }
  const shapes: (CommuneShape & { id: string })[] = shortlist.map((c) => ({
    id: c.id,
    code: c.code,
    lat: c.lat,
    lon: c.lon,
    geom: geomById.get(c.id) ?? null,
  }));
  const shapeByCode = new Map(shapes.map((s) => [s.code, s]));
  const fuelLimited = fuelLimitedCodes(
    shortlist.map((c) => ({
      code: c.code,
      landcover: landcoverById.get(c.id) ?? null,
    })),
  );

  const settlementIds = clusters
    .map((c) => c.nearest_settlement_id)
    .filter((id): id is string => id !== null);
  const settlementName = new Map<string, string>();
  if (settlementIds.length) {
    const { data } = await supabaseAdmin
      .from("settlements")
      .select("id, name")
      .in("id", settlementIds);
    for (const s of data ?? []) settlementName.set(s.id, s.name);
  }

  const chains = new Map<string, { identifier: string; sent: string }[]>();
  const { data: capRows, error: capError } = await supabaseAdmin
    .from("cap_alerts")
    .select("cluster_id, identifier, sent")
    .in(
      "cluster_id",
      clusters.map((c) => c.id),
    )
    .like("identifier", "nadhir-brd-%")
    .order("sent", { ascending: true });
  if (capError) throw new Error(capError.message);
  for (const row of capRows ?? []) {
    if (!row.cluster_id) continue;
    const chain = chains.get(row.cluster_id) ?? [];
    chain.push({ identifier: row.identifier, sent: row.sent });
    chains.set(row.cluster_id, chain);
  }

  let published = 0;
  const errors: string[] = [];
  // without context no new thread starts, but open threads must still update and end
  const contexts = await fireContexts(clusters).catch((error: unknown) => {
    errors.push(
      error instanceof Error ? error.message : "fire context unavailable",
    );
    return new Map<string, FireContext>();
  });

  for (const cluster of clusters) {
    const open = latestByCluster.get(cluster.id) ?? null;
    const severity = fireSeverity(
      cluster.nearest_settlement_km,
      cluster.max_frp_mw,
    );
    const targets = targetCommunes(
      {
        lat: cluster.lat,
        lon: cluster.lon,
        communeCode: cluster.commune_id
          ? (unitById.get(cluster.commune_id)?.code ?? null)
          : null,
      },
      shapes,
    );
    const inside = insideCommunes(
      pointsByCluster.get(cluster.id) ?? [],
      targets,
      shapeByCode,
    );
    const additions =
      open && (open.phase === "initial" || open.phase === "update")
        ? downwindAdditions(
            {
              lat: cluster.lat,
              lon: cluster.lon,
              spreadBearing: cluster.spread_bearing_deg,
            },
            open.communeCodes,
            targets,
            shapeByCode,
          )
        : [];

    const plan = planFireBroadcast({
      state: cluster.state,
      confidence: cluster.confidence,
      lastDetectedMs: Date.parse(cluster.last_detected_at),
      nowMs: now,
      severity,
      open,
      targets,
      additions,
      inside,
      fuelLimited,
      eligible: contexts.has(cluster.id)
        ? fireLevel(fireStage(cluster), contexts.get(cluster.id)!) !==
          "heat_signal"
        : false,
    });
    if (!plan) continue;

    // one failing cluster must not silence the clusters after it, nor skip the relays
    try {
      const phase: BroadcastPhase = plan.action;
      const closed = phase === "end" || phase === "cancel";
      const messageSeverity = closed
        ? ((open?.severity ?? severity) as "Extreme" | "Severe")
        : severity;
      const covered =
        plan.action === "initial" || plan.action === "update"
          ? plan.codes
          : (open?.communeCodes ?? []);
      const insideCodes =
        plan.action === "initial" || plan.action === "update"
          ? plan.inside
          : (open?.insideCodes ?? []);
      const rose = pushCodesFor({
        clusterId: cluster.id,
        action: plan.action,
        codes: covered,
        inside: insideCodes,
        previous: open,
        coverage,
      });
      const { allowed: pushed, dropped } = applyDailyLimit(
        rose,
        sentToday,
        closed || messageSeverity === "Extreme",
      );

      const commune = cluster.commune_id
        ? unitById.get(cluster.commune_id)
        : null;
      const wilaya = commune?.parent_id
        ? unitById.get(commune.parent_id)
        : null;
      const place =
        (cluster.nearest_settlement_id
          ? settlementName.get(cluster.nearest_settlement_id)
          : null) ??
        commune?.name_fr ??
        coordLabel(cluster.lat, cluster.lon);

      const chain = chains.get(cluster.id) ?? [];
      const cap = buildBroadcastCap({
        shortId: cluster.short_id,
        seq: chain.length + 1,
        phase,
        lat: cluster.lat,
        lon: cluster.lon,
        severity: messageSeverity,
        confirmed: cluster.confirmed_at !== null,
        areaDesc:
          [commune?.name_fr, wilaya?.name_fr].filter(Boolean).join(", ") ||
          place,
        sentAt: new Date(),
        texts: broadcastTexts(phase, {
          place,
          wilaya: wilaya?.name_fr ?? "",
          km: cluster.nearest_settlement_km,
          bearingDeg: cluster.spread_bearing_deg,
          hotspots: cluster.detection_count,
          hours: BROADCAST_END_AFTER_HOURS,
          inside: {
            ar: insideCodes.map((code) => nameOf(code, "name_ar")),
            fr: insideCodes.map((code) => nameOf(code, "name_fr")),
            en: insideCodes.map((code) => nameOf(code, "name_en")),
            kab: insideCodes.map((code) => nameOf(code, "name_kab")),
          },
        }),
        references: chain,
      });

      const { data: capRow, error: capInsertError } = await supabaseAdmin
        .from("cap_alerts")
        .insert({
          identifier: cap.identifier,
          sender: cap.sender,
          sent: cap.sent,
          status: cap.status,
          msg_type: cap.msgType,
          scope: cap.scope,
          cap_references: cap.references ?? null,
          cluster_id: cluster.id,
          info: cap.info,
        })
        .select("id")
        .single();
      if (capInsertError)
        throw new Error(`cap_alerts insert failed: ${capInsertError.message}`);

      const { error: broadcastError } = await supabaseAdmin
        .from("broadcasts")
        .insert({
          kind: "fire",
          phase,
          cluster_id: cluster.id,
          cap_alert_id: capRow.id,
          severity: messageSeverity,
          commune_codes: covered,
          push_codes: pushed,
          inside_codes: insideCodes,
        });
      if (broadcastError)
        throw new Error(`broadcasts insert failed: ${broadcastError.message}`);

      published += 1;
      const thread: OpenThread = {
        phase,
        severity: messageSeverity,
        communeCodes: covered,
        insideCodes,
        atMs: now,
      };
      latestByCluster.set(cluster.id, thread);
      setThreadCoverage(coverage, cluster.id, thread);
      if (!closed)
        for (const code of pushed)
          sentToday.set(code, (sentToday.get(code) ?? 0) + 1);
      await auditRow({
        action: "published",
        reason: pushed.length ? phase : "silent",
        kind: "fire",
        cluster_id: cluster.id,
        phase,
        severity: messageSeverity,
        commune_codes: covered,
        payload: {
          identifier: cap.identifier,
          pushed,
          ...(dropped.length ? { rate_limited: dropped } : {}),
          ...(plan.action === "update"
            ? { added: plan.added, inside: plan.inside }
            : {}),
          ...(plan.action === "initial" ? { inside: plan.inside } : {}),
        },
      });
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : `cluster ${cluster.short_id}`,
      );
    }
  }

  published += await runRelays(sentToday);

  if (errors.length)
    throw new Error(
      `${errors.length} clusters failed to publish: ${errors[0]}`,
    );

  return { published, suppressed: 0 };
}

async function relayAuthorityWarnings(
  sentToday: Map<string, number>,
): Promise<number> {
  // recent window: unbounded growth would eventually hit the 1000-row page cap
  const { data: warnings, error } = await supabaseAdmin
    .from("authority_warnings")
    .select("id, severity, wilaya_id, commune_codes")
    .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString());
  if (error) throw new Error(error.message);
  if (!warnings?.length) return 0;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("broadcasts")
    .select("authority_warning_id")
    .eq("kind", "authority")
    .in(
      "authority_warning_id",
      warnings.map((w) => w.id),
    );
  if (existingError) throw new Error(existingError.message);
  const done = new Set((existing ?? []).map((b) => b.authority_warning_id));
  const pending = warnings.filter((w) => !done.has(w.id));
  if (!pending.length) return 0;

  const communes = await fetchAllPages<{
    code: string;
    parent_id: string | null;
  }>((from, to) =>
    supabaseAdmin
      .from("admin_units")
      .select("code, parent_id")
      .eq("level", "commune")
      .order("code")
      .order("id")
      .range(from, to),
  );
  const codesByWilaya = new Map<string, string[]>();
  for (const c of communes) {
    if (!c.parent_id) continue;
    const bucket = codesByWilaya.get(c.parent_id) ?? [];
    bucket.push(c.code);
    codesByWilaya.set(c.parent_id, bucket);
  }

  let published = 0;
  for (const warning of pending) {
    const codes = warning.commune_codes?.length
      ? warning.commune_codes
      : warning.wilaya_id
        ? (codesByWilaya.get(warning.wilaya_id) ?? [])
        : [];
    if (!codes.length) continue;
    const severity = warning.severity as "Extreme" | "Severe";
    const { allowed: pushCodes, dropped } = applyDailyLimit(
      codes,
      sentToday,
      severity === "Extreme",
    );
    const { error: insertError } = await supabaseAdmin
      .from("broadcasts")
      .insert({
        kind: "authority",
        phase: "initial",
        authority_warning_id: warning.id,
        severity,
        commune_codes: codes,
        push_codes: pushCodes,
        hazard: "authority",
        source_key: "authority",
      });
    if (insertError)
      throw new Error(
        `authority broadcast insert failed: ${insertError.message}`,
      );
    for (const code of pushCodes)
      sentToday.set(code, (sentToday.get(code) ?? 0) + 1);
    published += 1;
    await auditRow({
      action: "published",
      reason: "authority_relay",
      kind: "authority",
      phase: "initial",
      severity,
      commune_codes: codes,
      payload: {
        authority_warning_id: warning.id,
        ...(dropped.length ? { rate_limited: dropped } : {}),
      },
    });
  }
  return published;
}

const OFFICIAL_COVERED_HOURS = 12;

type OfficialIncidentRow = {
  id: string;
  kind: string;
  commune_id: string | null;
  wilaya_id: string;
  place_text: string | null;
  status: string;
  as_of: string;
  last_reported_at?: string | null;
  evidence: string | null;
  unlisted_at: string | null;
  latest_mention_id: string | null;
};

type OfficialBroadcastRow = {
  id?: string;
  official_incident_id: string | null;
  phase?: string;
  cap_alert_id?: string | null;
  fcm_delivered_at?: string | null;
  telegram_delivered_at?: string | null;
};

type MentionSourceRow = {
  id: string;
  text_sources: {
    label: string;
    key: string;
    authority_tier?: string | null;
  } | null;
  source_documents?: {
    body: string | null;
    published_at?: string | null;
  } | null;
};

async function relayOfficialIncidents(
  sentToday: Map<string, number>,
): Promise<number> {
  const nowMs = Date.now();
  const since = new Date(
    nowMs - OFFICIAL_FIRE_FRESH_HOURS * HOUR,
  ).toISOString();
  const { data: incidents, error } = await supabaseAdmin
    .from("official_incidents")
    .select(
      "id, kind, commune_id, wilaya_id, place_text, status, as_of, last_reported_at, evidence, unlisted_at, latest_mention_id",
    )
    .not("commune_id", "is", null)
    .in("kind", [...FIRE_KINDS, ...NON_FIRE_BROADCAST_KINDS])
    .gte("as_of", since);
  if (error) throw new Error(error.message);
  if (!incidents?.length) return 0;

  const { data: already, error: alreadyError } = await supabaseAdmin
    .from("broadcasts")
    .select(
      "id, official_incident_id, phase, cap_alert_id, fcm_delivered_at, telegram_delivered_at",
    )
    .eq("kind", "official")
    .in(
      "official_incident_id",
      incidents.map((i) => i.id),
    );
  if (alreadyError) throw new Error(alreadyError.message);

  const initialByIncident = new Map<string, OfficialBroadcastRow>();
  const closedIncidentIds = new Set<string>();
  for (const b of (already ?? []) as OfficialBroadcastRow[]) {
    if (!b.official_incident_id) continue;
    const phase = b.phase ?? "initial";
    if (phase === "end" || phase === "cancel") {
      closedIncidentIds.add(b.official_incident_id);
    } else if (!initialByIncident.has(b.official_incident_id)) {
      initialByIncident.set(b.official_incident_id, b);
    }
  }

  const candidates = (incidents as OfficialIncidentRow[]).filter((incident) => {
    if (closedIncidentIds.has(incident.id)) return false;
    const initial = initialByIncident.get(incident.id);
    if (!initial) return true;
    return incident.status === "cleared" || incident.status === "extinguished";
  });
  if (!candidates.length) return 0;

  const units = await fetchAllPages<{
    id: string;
    code: string;
    name_fr: string;
    name_ar: string;
    name_en: string;
    name_kab: string | null;
  }>((from, to) =>
    supabaseAdmin
      .from("admin_units")
      .select("id, code, name_fr, name_ar, name_en, name_kab")
      .order("code")
      .order("id")
      .range(from, to),
  );
  const unitById = new Map(units.map((u) => [u.id, u]));

  const coveredSince = new Date(
    nowMs - OFFICIAL_COVERED_HOURS * HOUR,
  ).toISOString();
  const { data: liveThreads, error: liveError } = await supabaseAdmin
    .from("broadcasts")
    .select("inside_codes")
    .eq("kind", "fire")
    .in("phase", ["initial", "update"])
    .gte("created_at", coveredSince);
  if (liveError) throw new Error(liveError.message);
  const covered = new Set(
    (liveThreads ?? []).flatMap((row) => row.inside_codes ?? []),
  );

  const mentionInfo = new Map<
    string,
    {
      label: string;
      key: string;
      authorityTier: string | null;
      documentBody: string | null | undefined;
    }
  >();
  const mentionIds = candidates
    .map((i) => i.latest_mention_id)
    .filter((id): id is string => id !== null);
  if (mentionIds.length) {
    const { data, error: sourceError } = await supabaseAdmin
      .from("incident_mentions")
      .select(
        "id, text_sources(label, key, authority_tier), source_documents(body, published_at)",
      )
      .in("id", mentionIds);
    if (sourceError) throw new Error(sourceError.message);
    for (const row of (data ?? []) as unknown as MentionSourceRow[]) {
      if (row.text_sources?.label) {
        mentionInfo.set(row.id, {
          label: row.text_sources.label,
          key: row.text_sources.key,
          authorityTier: row.text_sources.authority_tier ?? null,
          documentBody:
            row.source_documents === undefined
              ? undefined
              : (row.source_documents?.body ?? null),
        });
      }
    }
  }

  // Load initial CAP references for any incident that may emit a 'cleared' end notice
  const initialCapIds = candidates
    .map((i) => initialByIncident.get(i.id)?.cap_alert_id ?? null)
    .filter((id): id is string => id !== null);
  const capRefById = new Map<string, { identifier: string; sent: string }>();
  if (initialCapIds.length) {
    const { data: capRows, error: capRefError } = await supabaseAdmin
      .from("cap_alerts")
      .select("id, identifier, sent")
      .in("id", initialCapIds);
    if (capRefError) throw new Error(capRefError.message);
    for (const r of capRows ?? []) {
      capRefById.set(r.id, { identifier: r.identifier, sent: r.sent });
    }
  }

  let published = 0;
  for (const incident of candidates) {
    const commune = incident.commune_id
      ? unitById.get(incident.commune_id)
      : null;
    const wilaya = unitById.get(incident.wilaya_id);
    const source = incident.latest_mention_id
      ? mentionInfo.get(incident.latest_mention_id)
      : undefined;
    const initial = initialByIncident.get(incident.id);
    const initialDelivered = Boolean(
      initial &&
      (initial.fcm_delivered_at != null ||
        initial.telegram_delivered_at != null),
    );
    const kind = incident.kind ?? "vegetation";

    const decision = evaluateOfficialIncidentBroadcast({
      kind,
      status: incident.status,
      communeCode: commune?.code ?? null,
      asOfMs: Date.parse(incident.as_of),
      nowMs,
      unlistedAt: incident.unlisted_at,
      sourceKey: source?.key ?? null,
      authorityTier: source?.authorityTier ?? null,
      evidence: incident.evidence,
      documentBody: source?.documentBody,
      hasInitialBroadcast: Boolean(initial),
      initialDelivered,
      hasEndBroadcast: closedIncidentIds.has(incident.id),
    });
    if (decision.action === "suppress" || !commune) continue;

    const isFire = isFireKind(kind);
    const phase = decision.action;
    const label = source?.label ?? "Protection Civile";
    const key = source?.key ?? null;
    const areaDesc = [commune.name_fr, wilaya?.name_fr]
      .filter(Boolean)
      .join(", ");

    const fireStatus = (
      incident.status === "cleared"
        ? "extinguished"
        : [
              "ongoing",
              "contained",
              "extinguished",
              "monitoring",
              "unknown",
            ].includes(incident.status)
          ? incident.status
          : "ongoing"
    ) as OfficialVars["status"];

    const texts = isFire
      ? officialTexts(
          {
            commune: commune.name_fr,
            wilaya: wilaya?.name_fr ?? "",
            source: label,
            asOf: algiersClock(incident.as_of),
            status: fireStatus,
          },
          false,
        )
      : officialHazardTexts({
          kind: isNonFireBroadcastKind(kind) ? kind : "flood",
          phase,
          commune: commune.name_fr,
          wilaya: wilaya?.name_fr ?? "",
          place: incident.place_text,
          source: label,
          asOf: algiersClock(incident.as_of),
          evidence: incident.evidence,
        });

    const initialRef = initial?.cap_alert_id
      ? capRefById.get(initial.cap_alert_id)
      : undefined;

    const cap = buildOfficialCap({
      incidentId: incident.id,
      areaDesc,
      sentAt: new Date(nowMs),
      asOf: new Date(incident.as_of),
      texts,
      category: officialCapCategory(kind),
      severity: "Severe",
      phase,
      expiresHours: isFire ? 24 : 12,
      references: initialRef ? [initialRef] : [],
    });

    const capParams: { valueName: string; value: string }[] = [
      ...(key ? [{ valueName: "source_key", value: key }] : []),
      { valueName: "source_attribution", value: label },
      { valueName: "hazard_kind", value: isFire ? "fire" : kind },
      { valueName: "incident_status", value: incident.status },
      { valueName: "broadcast_phase", value: phase },
      { valueName: "observed_at", value: incident.as_of },
      { valueName: "area_label", value: areaDesc },
      { valueName: "official_incident_id", value: incident.id },
    ];

    const { data: capRow, error: capError } = await supabaseAdmin
      .from("cap_alerts")
      .insert({
        identifier: cap.identifier,
        sender: cap.sender,
        sent: cap.sent,
        status: cap.status,
        msg_type: cap.msgType,
        scope: cap.scope,
        cap_references: cap.references ?? null,
        info: cap.info.map((info) => ({
          ...info,
          parameter: capParams,
        })),
      })
      .select("id")
      .single();
    if (capError)
      throw new Error(`official cap insert failed: ${capError.message}`);

    // Satellite fire coverage suppresses duplicate fire official pushes ONLY — never non-fire hazards
    const candidatePush =
      isFire && phase === "initial" && covered.has(commune.code)
        ? []
        : [commune.code];
    const { allowed: pushCodes, dropped } = applyDailyLimit(
      candidatePush,
      sentToday,
      phase === "end",
    );

    const { data: row, error: insertError } = await supabaseAdmin
      .from("broadcasts")
      .insert({
        kind: "official",
        phase,
        official_incident_id: incident.id,
        cap_alert_id: capRow.id,
        severity: "Severe",
        commune_codes: [commune.code],
        push_codes: pushCodes,
        hazard: isFire ? "fire" : kind,
        source_key: key,
        metadata: {
          official_incident_id: incident.id,
          hazard_kind: kind,
          incident_status: incident.status,
          source_attribution: label,
          observed_at: incident.as_of,
          area_label: areaDesc,
          phase,
        },
      })
      .select("id")
      .single();
    if (insertError)
      throw new Error(
        `official broadcast insert failed: ${insertError.message}`,
      );
    if (phase === "initial") {
      for (const code of pushCodes)
        sentToday.set(code, (sentToday.get(code) ?? 0) + 1);
    }
    published += 1;
    await auditRow({
      action: "published",
      reason: phase === "end" ? "official_cleared" : "official_relay",
      kind: "official",
      phase,
      severity: "Severe",
      commune_codes: [commune.code],
      payload: {
        official_incident_id: incident.id,
        broadcast_id: row.id,
        hazard_kind: kind,
        headline: texts[0]?.headline ?? "",
        ...(dropped.length ? { rate_limited: dropped } : {}),
      },
    });
  }
  return published;
}

type EarthquakeRow = {
  id: string;
  occurred_at: string;
  lat: number;
  lon: number;
  depth_km: number | null;
  magnitude: number;
  magnitude_type: string | null;
  region: string | null;
  network: string | null;
  commune_id: string | null;
  offshore: boolean;
};

/**
 * Feature F9: Accountless M4+ earthquake commune topic fan-out (100 km radius via ADR-0001
 * haversineKm). Zero per-subscriber PII: reads only public earthquakes + admin_units.
 * Upward revision crossing M4.0 pushes once; already-pushed M4+ never double-pushes;
 * downward revision below M4.0 never retracts or sends "safe"/all-clear.
 */
async function relayEarthquakes(
  sentToday: Map<string, number>,
): Promise<number> {
  const nowMs = Date.now();
  const since = new Date(
    nowMs - EARTHQUAKE_BROADCAST_FRESH_HOURS * HOUR,
  ).toISOString();
  const { data: quakes, error } = await supabaseAdmin
    .from("earthquakes")
    .select(
      "id, occurred_at, lat, lon, depth_km, magnitude, magnitude_type, region, network, commune_id, offshore",
    )
    .gte("magnitude", EARTHQUAKE_BROADCAST_MIN_MAGNITUDE)
    .gte("occurred_at", since);
  if (error) throw new Error(error.message);

  const eligible = ((quakes ?? []) as EarthquakeRow[]).filter((q) => {
    const occurredMs = Date.parse(q.occurred_at);
    return (
      Number.isFinite(occurredMs) &&
      occurredMs <= nowMs &&
      Number(q.magnitude) >= EARTHQUAKE_BROADCAST_MIN_MAGNITUDE
    );
  });
  if (!eligible.length) return 0;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("broadcasts")
    .select("earthquake_id")
    .eq("kind", "earthquake")
    .in(
      "earthquake_id",
      eligible.map((q) => q.id),
    );
  if (existingError) throw new Error(existingError.message);
  const done = new Set((existing ?? []).map((b) => b.earthquake_id));
  const pending = eligible.filter((q) => !done.has(q.id));
  if (!pending.length) return 0;

  const units = await fetchAllPages<{
    id: string;
    code: string;
    level: string;
    parent_id: string | null;
    name_fr: string;
    lat: number | null;
    lon: number | null;
  }>((from, to) =>
    supabaseAdmin
      .from("admin_units")
      .select("id, code, level, parent_id, name_fr, lat, lon")
      .order("code")
      .order("id")
      .range(from, to),
  );
  const unitById = new Map(units.map((u) => [u.id, u]));
  const unitByCode = new Map(units.map((u) => [u.code, u]));
  const communes = units.filter(
    (u): u is typeof u & { lat: number; lon: number } =>
      u.level === "commune" && u.lat !== null && u.lon !== null,
  );
  if (!communes.length) return 0;

  let published = 0;
  for (const quake of pending) {
    const codes = targetCommunesForEarthquake(
      { lat: quake.lat, lon: quake.lon },
      communes,
      EARTHQUAKE_BROADCAST_RADIUS_KM,
    );
    if (!codes.length) continue;

    const magnitude = Number(quake.magnitude);
    const severity = earthquakeSeverity(magnitude);
    const { allowed: pushCodes, dropped } = applyDailyLimit(
      codes,
      sentToday,
      severity === "Extreme",
    );

    const nearestCommune =
      (quake.commune_id ? unitById.get(quake.commune_id) : null) ??
      unitByCode.get(codes[0]!) ??
      null;
    const wilaya = nearestCommune?.parent_id
      ? unitById.get(nearestCommune.parent_id)
      : null;
    const place =
      nearestCommune?.name_fr ??
      quake.region?.trim() ??
      coordLabel(quake.lat, quake.lon);
    const areaDesc =
      [nearestCommune?.name_fr, wilaya?.name_fr].filter(Boolean).join(", ") ||
      place;
    const network = quake.network?.trim() || "EMSC";

    const texts = earthquakeTexts({
      magnitude,
      place,
      wilaya: wilaya?.name_fr ?? null,
      depthKm: quake.depth_km,
      network,
      asOf: algiersClock(quake.occurred_at),
      offshore: quake.offshore,
    });
    const cap = buildEarthquakeCap({
      earthquakeId: quake.id,
      magnitude,
      lat: quake.lat,
      lon: quake.lon,
      radiusKm: EARTHQUAKE_BROADCAST_RADIUS_KM,
      areaDesc,
      occurredAt: new Date(quake.occurred_at),
      sentAt: new Date(nowMs),
      texts,
    });

    const capParams: { valueName: string; value: string }[] = [
      { valueName: "source_key", value: "emsc" },
      { valueName: "source_attribution", value: network },
      { valueName: "hazard_kind", value: "earthquake" },
      { valueName: "magnitude", value: magnitude.toFixed(1) },
      { valueName: "observed_at", value: quake.occurred_at },
      { valueName: "area_label", value: areaDesc },
      { valueName: "earthquake_id", value: quake.id },
    ];

    const { data: capRow, error: capError } = await supabaseAdmin
      .from("cap_alerts")
      .insert({
        identifier: cap.identifier,
        sender: cap.sender,
        sent: cap.sent,
        status: cap.status,
        msg_type: cap.msgType,
        scope: cap.scope,
        info: cap.info.map((info) => ({
          ...info,
          parameter: capParams,
        })),
      })
      .select("id")
      .single();
    if (capError)
      throw new Error(`earthquake cap insert failed: ${capError.message}`);

    const { data: row, error: insertError } = await supabaseAdmin
      .from("broadcasts")
      .insert({
        kind: "earthquake",
        phase: "initial",
        earthquake_id: quake.id,
        cap_alert_id: capRow.id,
        severity,
        commune_codes: codes,
        push_codes: pushCodes,
        hazard: "earthquake",
        source_key: "emsc",
        metadata: {
          earthquake_id: quake.id,
          magnitude,
          depth_km: quake.depth_km,
          network,
          offshore: quake.offshore,
          occurred_at: quake.occurred_at,
          area_label: areaDesc,
        },
      })
      .select("id")
      .single();
    if (insertError)
      throw new Error(
        `earthquake broadcast insert failed: ${insertError.message}`,
      );

    for (const code of pushCodes)
      sentToday.set(code, (sentToday.get(code) ?? 0) + 1);
    published += 1;
    await auditRow({
      action: "published",
      reason: "earthquake_relay",
      kind: "earthquake",
      phase: "initial",
      severity,
      commune_codes: codes,
      payload: {
        earthquake_id: quake.id,
        magnitude,
        broadcast_id: row.id,
        pushed: pushCodes.length,
        ...(dropped.length ? { rate_limited: dropped } : {}),
      },
    });
  }
  return published;
}

type OnmCandidateRow = {
  id: string;
  cap_id?: string | null;
  msg_type?: string | null;
  referenced_cap_ids?: string[] | null;
  area_desc?: string | null;
  geocodes?: string[] | null;
  severity: string;
  wilaya_id: string | null;
  event: string | null;
  instruction_fr?: string | null;
  sent: string;
  onset: string | null;
  expires: string | null;
  cancelled_at?: string | null;
  superseded_by?: string | null;
};

async function relayOnmWarnings(
  sentToday: Map<string, number>,
): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: warnings, error } = await supabaseAdmin
    .from("onm_vigilance")
    .select(
      "id, cap_id, msg_type, referenced_cap_ids, area_desc, geocodes, severity, wilaya_id, event, instruction_fr, sent, onset, expires, cancelled_at, superseded_by",
    )
    .in("severity", ["Severe", "Extreme"])
    .not("wilaya_id", "is", null)
    .is("superseded_at", null)
    .is("cancelled_at", null)
    .is("superseded_by", null)
    .neq("msg_type", "Cancel")
    .or(`expires.is.null,expires.gt.${nowIso}`);
  if (error) throw new Error(error.message);
  if (!warnings?.length) return 0;

  const toWarning = (row: OnmCandidateRow): OnmWarning => ({
    id: row.id,
    wilayaId: row.wilaya_id!,
    event: row.event ?? "",
    severity: row.severity,
    sentMs: Date.parse(row.sent),
    onsetMs: row.onset === null ? null : Date.parse(row.onset),
    expiresMs: row.expires === null ? null : Date.parse(row.expires),
    ...(row.cap_id ? { capId: row.cap_id } : {}),
    msgType: parseCapMsgType(row.msg_type) ?? "Alert",
    referencedCapIds: row.referenced_cap_ids ?? [],
    areaDesc: row.area_desc ?? null,
    geocodes: row.geocodes ?? [],
    instructionFr: row.instruction_fr ?? null,
    cancelledAtMs: row.cancelled_at ? Date.parse(row.cancelled_at) : null,
    supersededBy: row.superseded_by ?? null,
  });

  const relayedSince = new Date(
    Date.now() - ONM_RELAYED_LOOKBACK_HOURS * HOUR,
  ).toISOString();
  const { data: relayedRows, error: relayedError } = await supabaseAdmin
    .from("broadcasts")
    .select(
      "onm_vigilance_id, onm_vigilance(id, cap_id, msg_type, referenced_cap_ids, area_desc, geocodes, severity, wilaya_id, event, instruction_fr, sent, onset, expires, cancelled_at, superseded_by)",
    )
    .eq("kind", "onm")
    .gte("created_at", relayedSince);
  if (relayedError) throw new Error(relayedError.message);
  const relayed = (relayedRows ?? [])
    .map((row) => row.onm_vigilance as OnmCandidateRow | null)
    .filter(
      (row): row is OnmCandidateRow => row !== null && row.wilaya_id !== null,
    )
    .map(toWarning);
  const relayedIds = new Set(relayed.map((w) => w.id));

  const { relay, suppressed } = onmRelayPlan(
    (warnings as OnmCandidateRow[])
      .filter((w) => !relayedIds.has(w.id))
      .map(toWarning)
      .filter((warning) => onmWarningIsCurrent(warning, Date.parse(nowIso))),
    relayed,
  );
  const { data: logged, error: loggedError } = suppressed.length
    ? await supabaseAdmin.rpc("onm_suppressions_logged", {
        _ids: suppressed.map((w) => w.id),
      })
    : { data: [], error: null };
  if (loggedError) throw new Error(loggedError.message);
  const loggedIds = new Set(logged);
  for (const warning of suppressed.filter((w) => !loggedIds.has(w.id)))
    await auditRow({
      action: "suppressed",
      reason: "onm_duplicate",
      kind: "onm",
      onm_vigilance_id: warning.id,
      severity: warning.severity,
    });
  if (!relay.length) return 0;

  const communes = await fetchAllPages<{
    code: string;
    parent_id: string | null;
  }>((from, to) =>
    supabaseAdmin
      .from("admin_units")
      .select("code, parent_id")
      .eq("level", "commune")
      .order("code")
      .order("id")
      .range(from, to),
  );
  const codesByWilaya = new Map<string, string[]>();
  for (const c of communes) {
    if (!c.parent_id) continue;
    const bucket = codesByWilaya.get(c.parent_id) ?? [];
    bucket.push(c.code);
    codesByWilaya.set(c.parent_id, bucket);
  }

  let published = 0;
  const seenForReasons = [...relayed];
  for (const warning of relay) {
    const codes = codesByWilaya.get(warning.wilayaId) ?? [];
    if (!codes.length) continue;
    const severity = warning.severity as "Extreme" | "Severe";
    const phase: BroadcastPhase =
      warning.msgType === "Update" ? "update" : "initial";
    const refIds = new Set(warning.referencedCapIds ?? []);
    const priors = refIds.size
      ? seenForReasons.filter((p) => p.capId != null && refIds.has(p.capId))
      : seenForReasons.filter(
          (p) => p.wilayaId === warning.wilayaId && p.event === warning.event,
        );
    const changeReasons =
      phase === "update"
        ? onmUpdateMaterialChange(warning, priors).reasons
        : [];

    const { allowed: pushCodes, dropped } = applyDailyLimit(
      codes,
      sentToday,
      severity === "Extreme",
    );

    const { error: insertError } = await supabaseAdmin
      .from("broadcasts")
      .insert({
        kind: "onm",
        phase,
        onm_vigilance_id: warning.id,
        severity,
        commune_codes: codes,
        push_codes: pushCodes,
        hazard: "weather",
        source_key: "onm",
        metadata: {
          cap_id: warning.capId ?? null,
          msg_type: warning.msgType ?? "Alert",
          event: warning.event,
          area_desc: warning.areaDesc ?? null,
          expires_is_internal_deadline: warning.expiresMs === null,
          ...(changeReasons.length ? { change_reasons: changeReasons } : {}),
        },
      });
    if (insertError)
      throw new Error(`onm broadcast insert failed: ${insertError.message}`);
    for (const code of pushCodes)
      sentToday.set(code, (sentToday.get(code) ?? 0) + 1);
    seenForReasons.push(warning);
    published += 1;
    await auditRow({
      action: "published",
      reason: phase === "update" ? "onm_update" : "onm_relay",
      kind: "onm",
      onm_vigilance_id: warning.id,
      phase,
      severity,
      commune_codes: codes,
      payload: {
        cap_id: warning.capId ?? null,
        msg_type: warning.msgType ?? "Alert",
        referenced_cap_ids: warning.referencedCapIds ?? [],
        ...(changeReasons.length ? { change_reasons: changeReasons } : {}),
        expires_is_internal_deadline: warning.expiresMs === null,
        ...(dropped.length ? { rate_limited: dropped } : {}),
      },
    });
  }
  return published;
}
