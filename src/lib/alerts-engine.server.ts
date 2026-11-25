import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  provenanceForWatchZoneAlert,
  toProvenancePayload,
} from "@/lib/alert-provenance";
import {
  ALERTING_STATES,
  DOWNWIND_HALF_ANGLE_DEG,
  LIVE_STATES,
  MIN_CONFIDENCE,
  SETTLEMENT_EMERGENCY_KM,
  SEVERITY,
  compass,
  downwindOf,
  inQuietHours,
} from "@/lib/alerts-rules";
import { buildFireCap, fireCapIdentifier } from "@/lib/cap";
import { algiersToday } from "@/lib/ingest/algiers-date";
import {
  bearingBetween,
  coordLabel,
  haversineKm,
  fireStage,
  publishedRiskTarget,
} from "@/lib/nadhir";
import { fireLevel, type FireContext } from "@/lib/fire-confidence";
import { fireContexts } from "@/lib/ingest/fire-context.server";
import { fetchAllPages } from "@/lib/paginate";
import {
  zoneLifecycle,
  type ZoneFireHistory,
  type ZoneStateEvent,
} from "@/lib/zone-lifecycle";
import { drainAlertPushes } from "@/lib/alert-push.server";
import { publishWaitingReports } from "@/lib/report-publication.server";
import { officialPhase } from "@/lib/incident-lifecycle";
import { adviceFor } from "@/lib/weather-advice";
import {
  hazardAlerts,
  QUAKE_ALERT_MAGNITUDE,
  type HazardContext,
} from "@/lib/zone-hazard-alerts";

type Copy = {
  fireTitle: string;
  fireBody: string;
  urgentTitle: string;
  urgentBody: string;
  clearTitle: string;
  clearBody: string;
  growthTitle: string;
  growthBody: string;
  riskTitle: string;
  riskBody: string;
  capEvent: string;
  capDescription: string;
  capInstruction: string;
};

/** RFC 3066 tags for the CAP <language> element. */
const CAP_LANGUAGE: Record<string, string> = {
  ar: "ar-DZ",
  fr: "fr-DZ",
  en: "en",
  kab: "kab",
};

const COPY: Record<string, Copy> = {
  ar: {
    fireTitle: "حريق قرب {{zone}}",
    fireBody:
      "تم رصد حريق على بعد {{km}} كم من {{zone}}. تابع التعليمات وابتعد عن مسار الدخان.",
    urgentTitle: "عاجل: حريق يقترب من {{zone}}",
    urgentBody:
      "حريق على بعد {{km}} كم من {{zone}} والرياح تدفعه نحو {{bearing}}. استعد للإخلاء واتصل بالحماية المدنية على 14.",
    clearTitle: "انتهت الرصود قرب {{zone}}",
    clearBody:
      "آخر رصد بالقمر الصناعي قرب {{zone}}: {{observed}}. غياب الرصد لا يؤكد إخماد الحريق أو سلامة المكان.",
    growthTitle: "زيادة الرصد قرب {{zone}}",
    growthBody:
      "تضاعفت المساحة المقدرة أو القدرة الإشعاعية المرصودة قرب {{zone}}. رصد بالقمر الصناعي: {{observed}}.",
    riskTitle: "خطر حرائق مرتفع في {{zone}}",
    riskBody: "مستوى الخطر اليوم {{level}}/5 في {{zone}}. تجنّب إشعال النار.",
    capEvent: "حريق غابات",
    capDescription:
      "حريق مشتعل قرب {{place}}، تم رصده عبر الأقمار الاصطناعية وتجري متابعته.",
    capInstruction:
      "ابتعد عن الدخان، واتبع تعليمات السلطات المحلية، واتصل بالحماية المدنية على 14 إذا هدّد الحريق أشخاصًا أو منازل.",
  },
  fr: {
    fireTitle: "Incendie près de {{zone}}",
    fireBody:
      "Un foyer a été détecté à {{km}} km de {{zone}}. Restez à l'écart de la fumée.",
    urgentTitle: "Urgent : incendie approchant {{zone}}",
    urgentBody:
      "Incendie à {{km}} km de {{zone}}, poussé par le vent vers {{bearing}}. Préparez-vous à évacuer et appelez la Protection Civile au 14.",
    clearTitle: "Fin des observations près de {{zone}}",
    clearBody:
      "Dernière détection satellite près de {{zone}} : {{observed}}. L’absence de détection ne confirme ni l’extinction ni la sécurité des lieux.",
    growthTitle: "Progression observée près de {{zone}}",
    growthBody:
      "La surface estimée ou la puissance radiative observée a doublé près de {{zone}}. Observation satellite : {{observed}}.",
    riskTitle: "Danger d'incendie élevé à {{zone}}",
    riskBody:
      "Niveau de danger {{level}}/5 aujourd'hui à {{zone}}. N'allumez aucun feu.",
    capEvent: "Feu de forêt",
    capDescription:
      "Un incendie brûle près de {{place}}. Il a été détecté par satellite et fait l'objet d'un suivi.",
    capInstruction:
      "Éloignez-vous de la fumée, suivez les consignes des autorités locales et appelez la Protection Civile au 14 si le feu menace des personnes ou des habitations.",
  },
  en: {
    fireTitle: "Fire near {{zone}}",
    fireBody:
      "A fire was detected {{km}} km from {{zone}}. Stay clear of the smoke path.",
    urgentTitle: "Urgent: fire approaching {{zone}}",
    urgentBody:
      "Fire {{km}} km from {{zone}}, wind pushing it {{bearing}}. Prepare to leave and call Civil Protection on 14.",
    clearTitle: "Observations ended near {{zone}}",
    clearBody:
      "Last satellite detection near {{zone}}: {{observed}}. Absence of detections does not confirm extinction or safety.",
    growthTitle: "Growth observed near {{zone}}",
    growthBody:
      "Estimated area or observed radiative power has doubled near {{zone}}. Satellite observation: {{observed}}.",
    riskTitle: "High fire danger at {{zone}}",
    riskBody:
      "Today's danger level is {{level}}/5 at {{zone}}. Do not light any fire.",
    capEvent: "Wildfire",
    capDescription:
      "A fire is burning near {{place}}. It was detected by satellite and is being tracked.",
    capInstruction:
      "Stay away from the smoke, follow instructions from local authorities, and call Civil Protection on 14 if the fire threatens people or homes.",
  },
  kab: {
    fireTitle: "Times ɣer {{zone}}",
    fireBody:
      "Times tettwaf ɣef {{km}} km si {{zone}}. Ḥader iman-ik seg dexxan.",
    urgentTitle: "Aɣewwaṛ: times tettqerrib ɣer {{zone}}",
    urgentBody:
      "Times ɣef {{km}} km si {{zone}}, aḍu yessedday-itt ɣer {{bearing}}. Heggi iman-ik i tuffɣa, siwel i Tɣellist Tagdudant ɣef 14.",
    clearTitle: "Taggara n iwaliyen ɣer {{zone}}",
    clearBody:
      "Awali aneggaru s uḍfar n igenwan ɣer {{zone}}: {{observed}}. Ulac awali ur d-yemmal ara belli texsi tmessi neɣ d aɣellès.",
    growthTitle: "Timɣer tettwawali ɣer {{zone}}",
    growthBody:
      "Tajumma yettwaḥesben neɣ tazmert n tmessi tettwawalin tuɣal d snat n tikal ɣer {{zone}}. Awali s uḍfar n igenwan: {{observed}}.",
    riskTitle: "Ayefki n times ɣer {{zone}}",
    riskBody:
      "Aswir n uɣilif ass-a d {{level}}/5 deg {{zone}}. Ur sserɣay ara times.",
    capEvent: "Times n teẓgi",
    capDescription:
      "Times tettreɣ ɣer {{place}}. Tettwaf s uḍfar n igenwan yerna tettwaḍfaṛ.",
    capInstruction:
      "Ḥader iman-ik seg dexxan, ḍfer iwellihen n yidebbaren idiganen, tsiwleḍ i Tɣellist Tagdudant ɣef 14 ma tessexlaɛ times imdanen neɣ ixxamen.",
  },
};

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    String(vars[k] ?? ""),
  );
}

type CapEvent = {
  clusterId: string;
  shortId: string;
  lat: number;
  lon: number;
  confirmed: boolean;
  urgent: boolean;
  place: string;
};

/** One CAP object per fire event, shared by every alert raised for it. */
async function ensureCapAlerts(
  events: CapEvent[],
): Promise<Map<string, string>> {
  if (!events.length) return new Map();
  const sentAt = new Date();

  const payload = events.map((event) => {
    const cap = buildFireCap({
      shortId: event.shortId,
      lat: event.lat,
      lon: event.lon,
      radiusKm: SETTLEMENT_EMERGENCY_KM,
      confirmed: event.confirmed,
      urgent: event.urgent,
      areaDesc: event.place,
      sentAt,
      texts: Object.entries(CAP_LANGUAGE).map(([locale, language]) => {
        const copy = COPY[locale] ?? COPY["ar"]!;
        return {
          language,
          event: copy.capEvent,
          headline: fill(event.urgent ? copy.urgentTitle : copy.fireTitle, {
            zone: event.place,
          }),
          description: fill(copy.capDescription, { place: event.place }),
          instruction: copy.capInstruction,
        };
      }),
    });

    return {
      identifier: cap.identifier,
      sender: cap.sender,
      sent: cap.sent,
      status: cap.status,
      msg_type: cap.msgType,
      scope: cap.scope,
      cluster_id: event.clusterId,
      info: cap.info,
    };
  });

  const { error } = await supabaseAdmin
    .from("cap_alerts")
    .upsert(payload, { onConflict: "identifier", ignoreDuplicates: true });
  if (error) throw new Error(error.message);

  const { data, error: readError } = await supabaseAdmin
    .from("cap_alerts")
    .select("id, identifier")
    .in(
      "identifier",
      payload.map((p) => p.identifier),
    );
  if (readError) throw new Error(readError.message);

  return new Map((data ?? []).map((row) => [row.identifier, row.id]));
}

export type AlertRun = {
  evaluated: number;
  created: number;
  suppressed: number;
  sent?: number;
  failed?: number;
  pushed?: number;
  pushFailed?: number;
  noDevice?: number;
  claimsLost?: number;
};

const AUTHORITY_WINDOW_MS = 24 * 3_600_000;

async function loadHazardContext(
  communeIds: string[],
  now: Date,
): Promise<HazardContext> {
  const iso = now.toISOString();
  const [units, weather, official, authority, road] = await Promise.all([
    communeIds.length
      ? supabaseAdmin
          .from("admin_units")
          .select("id, code, parent_id")
          .in("id", communeIds)
      : Promise.resolve({ data: [], error: null }),
    fetchAllPages<{
      id: string;
      severity: string;
      event: string;
      onset: string | null;
      title: string;
      headline_fr: string | null;
      area: { polygon: unknown } | null;
      wilaya_id: string | null;
      expires: string | null;
      sent: string;
      episode_id: string;
      episode_peak: number;
    }>((from, to) =>
      supabaseAdmin
        .from("onm_vigilance")
        .select(
          "id, severity, event, onset, title, headline_fr, area:onm_areas(polygon), wilaya_id, expires, sent, episode_id, episode_peak",
        )
        .is("superseded_at", null)
        .is("cancelled_at", null)
        .is("superseded_by", null)
        .neq("msg_type", "Cancel")
        .gt("expires", iso)
        .lte("sent", iso)
        .order("id")
        .range(from, to),
    ).then((data) => ({ data, error: null })),
    supabaseAdmin
      .from("official_incidents")
      .select(
        "id, kind, commune_id, wilaya_id, place_text, status, last_reported_at, unlisted_at, latest_mention:incident_mentions!official_incidents_latest_mention_fkey(source:text_sources(key, label))",
      )
      .is("unlisted_at", null),
    supabaseAdmin
      .from("authority_warnings")
      .select(
        "id, source, body, severity, wilaya_id, commune_codes, created_at",
      )
      .gte(
        "created_at",
        new Date(now.getTime() - AUTHORITY_WINDOW_MS).toISOString(),
      ),
    supabaseAdmin
      .from("civil_publications")
      .select("id, summary, area_id, source_name, expires_at, updated_at")
      .eq("state", "published")
      .eq("hazard", "road")
      .gt("expires_at", iso),
  ]);
  for (const result of [units, weather, official, authority, road])
    if (result.error) throw new Error(result.error.message);
  const { data: advice, error: adviceError } = await supabaseAdmin
    .from("official_weather_advice")
    .select("id, advice, wilaya_ids, valid_from, valid_to, created_at")
    .gt("created_at", new Date(now.getTime() - 3 * 86_400_000).toISOString())
    .limit(500);
  if (adviceError) throw new Error(adviceError.message);
  // an earthquake is news for hours, not days: a zone created today is not told about yesterday's
  const { data: earthquakes, error: quakeError } = await supabaseAdmin
    .from("earthquakes")
    .select("id, occurred_at, lat, lon, magnitude, network, offshore")
    .gte("magnitude", QUAKE_ALERT_MAGNITUDE)
    .gt("occurred_at", new Date(now.getTime() - 3 * 3_600_000).toISOString());
  if (quakeError) throw new Error(quakeError.message);

  const reports = await fetchAllPages<{
    id: string;
    user_id: string;
    hazard: string | null;
    summary: string | null;
    lat: number;
    lon: number;
    expires_at: string;
    observed_at?: string | null;
  }>((from, to) =>
    supabaseAdmin
      .from("citizen_reports")
      .select("id, user_id, hazard, summary, lat, lon, expires_at, observed_at")
      .or("publish_state.eq.published,status.eq.approved")
      .neq("status", "rejected")
      .neq("kind", "person_trapped")
      .is("flagged_at", null)
      .gt("expires_at", iso)
      .order("id")
      .range(from, to),
  );
  const votes: { report_id: string; user_id: string }[] = [];
  // chunked so the id list stays well under gateway URL limits
  for (let i = 0; i < reports.length; i += 100) {
    const ids = reports.slice(i, i + 100).map((r) => r.id);
    votes.push(
      ...(await fetchAllPages<{ report_id: string; user_id: string }>(
        (from, to) =>
          supabaseAdmin
            .from("report_witnesses")
            .select("report_id, user_id")
            .eq("vote", "seen")
            .in("report_id", ids)
            .order("report_id")
            .order("user_id")
            .range(from, to),
      )),
    );
  }
  return {
    communes: new Map(
      (units.data ?? []).map((u) => [
        u.id,
        { code: u.code, wilayaId: u.parent_id },
      ]),
    ),
    weather: (weather.data ?? []).flatMap(
      ({ episode_id: episode, episode_peak: peak, area, ...w }) =>
        w.expires
          ? [
              {
                ...w,
                expires: w.expires,
                alert_key: `weather:${episode}:${peak}`,
                advice: adviceFor(w, advice ?? [])?.advice ?? null,
                polygon: Array.isArray(area?.polygon)
                  ? (area.polygon as [number, number][])
                  : null,
              },
            ]
          : [],
    ),
    official: (official.data ?? [])
      .filter((i) => officialPhase(i, now.getTime()) === "live")
      .map((i) => {
        const mention = i.latest_mention as unknown as {
          source?: { key?: string | null; label?: string | null } | null;
        } | null;
        return {
          id: i.id,
          kind: i.kind,
          commune_id: i.commune_id,
          wilaya_id: i.wilaya_id,
          place_text: i.place_text,
          last_reported_at: i.last_reported_at,
          source_key: mention?.source?.key ?? null,
          source_label: mention?.source?.label ?? null,
        };
      }),
    authority: authority.data ?? [],
    road: road.data ?? [],
    earthquakes: (earthquakes ?? []).map((q) => ({
      ...q,
      magnitude: Number(q.magnitude),
    })),
    citizen: reports.map((r) => ({
      id: r.id,
      reporter: r.user_id,
      hazard: r.hazard,
      summary: r.summary,
      lat: r.lat,
      lon: r.lon,
      expires_at: r.expires_at,
      observed_at: r.observed_at ?? null,
      witnesses: votes
        .filter((v) => v.report_id === r.id)
        .map((v) => v.user_id),
    })),
  };
}

export async function evaluateAlerts(userId?: string): Promise<AlertRun> {
  if (!userId) await publishWaitingReports();
  let zoneQuery = supabaseAdmin.from("zones").select("*").eq("active", true);
  if (userId) zoneQuery = zoneQuery.eq("user_id", userId);
  const { data: zones, error: zonesError } = await zoneQuery;
  if (zonesError) throw new Error(zonesError.message);
  if (!zones?.length) return { evaluated: 0, created: 0, suppressed: 0 };

  const allUserIds = [...new Set(zones.map((z) => z.user_id))];
  // Fail-closed (Law 18-07 / Law 25-11): exclude watch zones belonging to users
  // who withdrew zone_alerts consent before matching hazards, creating alerts,
  // or triggering alerts_enqueue_webhooks.
  const withdrawnZoneAlertUsers = new Set<string>();
  for (let i = 0; i < allUserIds.length; i += 500) {
    const batch = allUserIds.slice(i, i + 500);
    const { data: withdrawnConsents, error: consentError } = await supabaseAdmin
      .from("privacy_consents")
      .select("user_id")
      .in("user_id", batch)
      .eq("consent_type", "zone_alerts")
      .eq("status", "withdrawn");
    if (consentError) throw new Error(consentError.message);
    for (const row of withdrawnConsents ?? []) {
      withdrawnZoneAlertUsers.add(row.user_id);
    }
  }
  const eligibleZones = zones.filter(
    (z) => !withdrawnZoneAlertUsers.has(z.user_id),
  );
  if (!eligibleZones.length) return { evaluated: 0, created: 0, suppressed: 0 };

  const userIds = [...new Set(eligibleZones.map((z) => z.user_id))];
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .in("id", userIds);
  if (profilesError) throw new Error(profilesError.message);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const { data: allLive, error: liveError } = await supabaseAdmin
    .from("fire_clusters")
    .select(
      "id, short_id, state, lat, lon, confidence, spread_bearing_deg, first_detected_at, last_detected_at, confirmed_at, est_area_ha, max_frp_mw, commune_id",
    )
    .in("state", LIVE_STATES);
  if (liveError) throw new Error(liveError.message);
  const now = new Date();
  const liveIds = (allLive ?? []).map((c) => c.id);
  const history = liveIds.length
    ? await fetchAllPages<ZoneFireHistory>((from, to) =>
        supabaseAdmin
          .from("alerts")
          .select("id, user_id, zone_id, cluster_id, created_at, payload")
          .in("user_id", userIds)
          .in("cluster_id", liveIds)
          .eq("kind", "fire")
          .order("id")
          .range(from, to),
      )
    : [];
  if (history.length >= 40_000)
    throw new Error("Zone alert history exceeds pagination limit");
  const quietClusterIds = (allLive ?? [])
    .filter((c) => c.state === "contained_guess")
    .map((c) => c.id);
  const stateEvents = quietClusterIds.length
    ? await fetchAllPages<ZoneStateEvent>((from, to) =>
        supabaseAdmin
          .from("cluster_events")
          .select("id, cluster_id, event, at, payload")
          .in("cluster_id", quietClusterIds)
          .eq("event", "state:contained_guess")
          .order("id")
          .range(from, to),
      )
    : [];

  const alertable = (allLive ?? []).filter((c) =>
    ALERTING_STATES.includes(c.state),
  );

  // urgent alerts are not gated, so a context failure must not stop them
  let contextError: unknown = null;
  const contexts = await fireContexts(alertable).catch((error: unknown) => {
    contextError = error;
    return new Map<string, FireContext>();
  });
  const probable = new Set(
    alertable
      .filter((c) => {
        const context = contexts.get(c.id);
        return !!context && fireLevel(fireStage(c), context) !== "heat_signal";
      })
      .map((c) => c.id),
  );

  // R3 gates on how close the fire actually is; the centroid understates that by
  // kilometres for a spread-out fire, which silently skips the emergency escalation.
  const frontByCluster = new Map<string, { lat: number; lon: number }[]>();
  if (alertable.length) {
    const points = await fetchAllPages<{
      cluster_id: string | null;
      lat: number;
      lon: number;
    }>((from, to) =>
      supabaseAdmin
        .from("detections")
        .select("cluster_id, lat, lon")
        .in(
          "cluster_id",
          alertable.map((c) => c.id),
        )
        .range(from, to),
    );
    for (const p of points) {
      if (!p.cluster_id) continue;
      const bucket = frontByCluster.get(p.cluster_id);
      if (bucket) bucket.push({ lat: p.lat, lon: p.lon });
      else frontByCluster.set(p.cluster_id, [{ lat: p.lat, lon: p.lon }]);
    }
  }

  const settlements = await fetchAllPages<{
    id: string;
    name: string;
    lat: number;
    lon: number;
  }>((from, to) =>
    supabaseAdmin
      .from("settlements")
      .select("id, name, lat, lon")
      .range(from, to),
  );

  const today = algiersToday();
  const communeIds = [
    ...new Set(eligibleZones.map((z) => z.commune_id).filter(Boolean)),
  ] as string[];
  const { data: checkpoint, error: checkpointError } = communeIds.length
    ? await supabaseAdmin
        .from("risk_publication_checkpoint")
        .select("coverage_status, snapshot_id, base_date, published_at")
        .eq("key", "local_fwi")
        .maybeSingle()
    : { data: null, error: null };
  const target = checkpointError
    ? null
    : publishedRiskTarget(checkpoint, today);
  const { data: forecasts, error: forecastError } = target
    ? await supabaseAdmin
        .from("risk_forecasts")
        .select("commune_id, forecast_date, danger_level, fuel_limited")
        .eq("source", "local_fwi")
        .eq("snapshot_id", target.snapshotId)
        .eq("forecast_date", target.forecastDate)
        .eq("horizon_days", target.horizon)
        .in("commune_id", communeIds)
    : {
        data: [] as {
          commune_id: string;
          danger_level: number;
          fuel_limited: boolean;
        }[],
        error: null,
      };
  const forecastByCommune = new Map(
    (forecastError ? [] : (forecasts ?? [])).map((f) => [f.commune_id, f]),
  );

  const placeByCluster = new Map<string, string>();
  for (const cluster of alertable) {
    let best: { name: string; km: number } | null = null;
    for (const s of settlements) {
      const km = haversineKm(cluster.lat, cluster.lon, s.lat, s.lon);
      if (!best || km < best.km) best = { name: s.name, km };
    }
    placeByCluster.set(
      cluster.id,
      best ? best.name : coordLabel(cluster.lat, cluster.lon),
    );
  }

  const capEvents = new Map<string, CapEvent>();
  const rows: Record<string, unknown>[] = [];
  let suppressed = 0;

  for (const zone of eligibleZones) {
    const profile = profileById.get(zone.user_id);
    const copy = COPY[profile?.locale ?? "ar"] ?? COPY["ar"]!;
    const quiet = inQuietHours(
      profile?.quiet_hours_start ?? null,
      profile?.quiet_hours_end ?? null,
    );

    if (zone.notify_fires) {
      for (const cluster of (allLive ?? []).filter(
        (c) => c.state === "contained_guess",
      )) {
        const lifecycle = zoneLifecycle(
          cluster,
          history,
          stateEvents,
          zone.user_id,
          zone.id,
          now,
        );
        if (!lifecycle) continue;
        if (quiet) {
          suppressed += 1;
          continue;
        }
        rows.push({
          user_id: zone.user_id,
          zone_id: zone.id,
          cluster_id: cluster.id,
          kind: "fire",
          severity: SEVERITY.info,
          dedupe_key: lifecycle.key,
          title: fill(copy.clearTitle, { zone: zone.name }),
          body: fill(copy.clearBody, {
            zone: zone.name,
            observed: cluster.last_detected_at,
          }),
          payload: {
            phase: lifecycle.phase,
            event_id: lifecycle.event_id,
            short_id: cluster.short_id,
            state: cluster.state,
            last_detected_at: cluster.last_detected_at,
            est_area_ha: cluster.est_area_ha,
            max_frp_mw: cluster.max_frp_mw,
            ...toProvenancePayload(
              provenanceForWatchZoneAlert({
                kind: "fire",
                phase: lifecycle.phase,
                confirmed: cluster.confirmed_at !== null,
                areaLabel: zone.name,
                radiusKm: zone.radius_km,
                observedAt: cluster.last_detected_at,
              }),
            ),
          },
        });
      }
      // spec R1: the floor is per-user; the column may predate its migration
      const floor =
        (profile as { min_confidence?: number } | undefined)?.min_confidence ??
        MIN_CONFIDENCE;
      for (const cluster of alertable) {
        if (cluster.confidence < floor) continue;
        const zoneFront = frontByCluster.get(cluster.id) ?? [
          { lat: cluster.lat, lon: cluster.lon },
        ];
        let km = Infinity;
        for (const p of zoneFront) {
          const one = haversineKm(zone.lat, zone.lon, p.lat, p.lon);
          if (one < km) km = one;
        }
        if (km > zone.radius_km) continue;
        const growth = zoneLifecycle(
          cluster,
          history,
          [],
          zone.user_id,
          zone.id,
          now,
        );
        if (growth?.phase === "growth") {
          if (quiet) suppressed += 1;
          else
            rows.push({
              user_id: zone.user_id,
              zone_id: zone.id,
              cluster_id: cluster.id,
              kind: "fire",
              severity: SEVERITY.warning,
              dedupe_key: growth.key,
              title: fill(copy.growthTitle, { zone: zone.name }),
              body: fill(copy.growthBody, {
                zone: zone.name,
                observed: cluster.last_detected_at,
              }),
              distance_km: km,
              payload: {
                phase: "growth",
                short_id: cluster.short_id,
                state: cluster.state,
                est_area_ha: cluster.est_area_ha,
                max_frp_mw: cluster.max_frp_mw,
                last_detected_at: cluster.last_detected_at,
                ...toProvenancePayload(
                  provenanceForWatchZoneAlert({
                    kind: "fire",
                    phase: "growth",
                    confirmed: cluster.confirmed_at !== null,
                    areaLabel: zone.name,
                    radiusKm: zone.radius_km,
                    observedAt: cluster.last_detected_at,
                  }),
                ),
              },
            });
        }

        // R3: nearest settlement inside the fire's downwind cone escalates to emergency
        let urgent: { name: string; bearing: number } | null = null;
        const front = frontByCluster.get(cluster.id) ?? [
          { lat: cluster.lat, lon: cluster.lon },
        ];
        for (const s of settlements) {
          let sKm = Infinity;
          for (const p of front) {
            const one = haversineKm(p.lat, p.lon, s.lat, s.lon);
            if (one < sKm) sKm = one;
          }
          if (sKm > SETTLEMENT_EMERGENCY_KM) continue;
          const bearing = bearingBetween(
            cluster.lat,
            cluster.lon,
            s.lat,
            s.lon,
          );
          if (!downwindOf(cluster.spread_bearing_deg, bearing)) continue;
          urgent = { name: s.name, bearing };
          break;
        }

        // a settlement downwind is danger to life, so only the "new" tier waits for context
        if (!urgent && !probable.has(cluster.id)) continue;

        const severity = urgent ? SEVERITY.emergency : SEVERITY.warning;
        if (quiet && severity < SEVERITY.emergency) {
          suppressed += 1;
          continue;
        }

        const capIdentifier = fireCapIdentifier(cluster.short_id, !!urgent);
        if (!capEvents.has(capIdentifier)) {
          capEvents.set(capIdentifier, {
            clusterId: cluster.id,
            shortId: cluster.short_id,
            lat: cluster.lat,
            lon: cluster.lon,
            confirmed: cluster.confirmed_at !== null,
            urgent: !!urgent,
            place: placeByCluster.get(cluster.id) ?? cluster.short_id,
          });
        }

        rows.push({
          cap_identifier: capIdentifier,
          user_id: zone.user_id,
          zone_id: zone.id,
          kind: "fire",
          severity,
          cluster_id: cluster.id,
          dedupe_key: `fire:${zone.id}:${cluster.id}:${urgent ? "urgent" : "new"}`,
          title: fill(urgent ? copy.urgentTitle : copy.fireTitle, {
            zone: zone.name,
          }),
          body: fill(urgent ? copy.urgentBody : copy.fireBody, {
            zone: zone.name,
            km: km.toFixed(1),
            bearing: urgent ? compass(urgent.bearing) : "",
          }),
          distance_km: km,
          payload: {
            phase: urgent ? "urgent" : "new",
            est_area_ha: cluster.est_area_ha,
            max_frp_mw: cluster.max_frp_mw,
            last_detected_at: cluster.last_detected_at,
            short_id: cluster.short_id,
            state: cluster.state,
            confidence: cluster.confidence,
            ...(urgent ? { settlement: urgent.name } : {}),
            ...toProvenancePayload(
              provenanceForWatchZoneAlert({
                kind: "fire",
                phase: urgent ? "urgent" : "new",
                confirmed: cluster.confirmed_at !== null,
                areaLabel: zone.name,
                radiusKm: zone.radius_km,
                observedAt: cluster.last_detected_at,
              }),
            ),
          },
        });
      }
    }

    if (zone.notify_risk && zone.commune_id) {
      const forecast = forecastByCommune.get(zone.commune_id);
      const threshold = Math.max(
        zone.min_danger_level,
        profile?.min_danger_level ?? 1,
      );
      if (
        forecast &&
        !forecast.fuel_limited &&
        forecast.danger_level >= threshold
      ) {
        if (quiet) {
          suppressed += 1;
        } else {
          rows.push({
            user_id: zone.user_id,
            zone_id: zone.id,
            kind: "risk",
            severity: forecast.danger_level,
            commune_id: zone.commune_id,
            dedupe_key: `risk:${zone.id}:${today}:${forecast.danger_level}`,
            title: fill(copy.riskTitle, { zone: zone.name }),
            body: fill(copy.riskBody, {
              zone: zone.name,
              level: forecast.danger_level,
            }),
            payload: {
              forecast_date: today,
              danger_level: forecast.danger_level,
              ...toProvenancePayload(
                provenanceForWatchZoneAlert({
                  kind: "risk",
                  areaLabel: zone.name,
                  radiusKm: zone.radius_km,
                  observedAt: checkpoint?.published_at ?? now.toISOString(),
                }),
              ),
            },
          });
        }
      }
    }
  }

  const hazards = hazardAlerts(
    eligibleZones,
    await loadHazardContext(communeIds, now),
    (owner) => {
      const profile = profileById.get(owner);
      return {
        locale: profile?.locale ?? "ar",
        quiet: inQuietHours(
          profile?.quiet_hours_start ?? null,
          profile?.quiet_hours_end ?? null,
        ),
        minLevel: profile?.min_danger_level ?? 1,
      };
    },
  );
  rows.push(...hazards.rows);
  suppressed += hazards.suppressed;

  if (!rows.length) {
    const push = await drainAlertPushes();
    if (contextError) throw contextError;
    return { evaluated: eligibleZones.length, created: 0, suppressed, ...push };
  }

  const capIdByIdentifier = await ensureCapAlerts([...capEvents.values()]);
  const alertRows = rows.map((row) => {
    const { cap_identifier: identifier, ...rest } = row as {
      cap_identifier?: string;
    };
    return {
      ...rest,
      cap_alert_id: identifier
        ? (capIdByIdentifier.get(identifier) ?? null)
        : null,
    };
  });

  const { data: inserted, error } = await supabaseAdmin
    .from("alerts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert(alertRows as any, {
      onConflict: "user_id,dedupe_key",
      ignoreDuplicates: true,
    })
    .select("*");
  if (error) throw new Error(error.message);

  let delivered = { sent: 0, failed: 0 };
  if (inserted?.length) {
    const { drainWebhookDeliveries } = await import("@/lib/webhooks.server");
    delivered = await drainWebhookDeliveries();
  }
  const push = await drainAlertPushes();
  if (contextError) throw contextError;

  return {
    evaluated: eligibleZones.length,
    created: inserted?.length ?? 0,
    suppressed,
    ...delivered,
    ...push,
  };
}
