import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { LiveContext } from "@/lib/zone-status";

export type EmailDigestFrequency = "off" | "immediate" | "hourly" | "daily";

export type Profile = {
  id: string;
  display_name: string | null;
  locale: string;
  phone: string | null;
  alert_email: boolean;
  alert_push: boolean;
  email_digest_frequency?: EmailDigestFrequency;
  email_digest_hour_algiers?: number;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  min_danger_level: number;
};

export type ProfileSettingsInput = Pick<
  Profile,
  | "display_name"
  | "phone"
  | "locale"
  | "alert_email"
  | "alert_push"
  | "email_digest_frequency"
  | "email_digest_hour_algiers"
  | "quiet_hours_start"
  | "quiet_hours_end"
  | "min_danger_level"
>;

class ProfileSettingsError extends Error {
  override cause?: unknown;

  constructor(cause?: unknown) {
    super("account.saveFailed");
    this.name = "ProfileSettingsError";
    this.cause = cause;
  }
}

export type Zone = {
  id: string;
  user_id: string;
  name: string;
  lat: number;
  lon: number;
  radius_km: number;
  commune_id: string | null;
  min_danger_level: number;
  notify_fires: boolean;
  notify_risk: boolean;
  notify_weather: boolean;
  notify_official: boolean;
  notify_road: boolean;
  notify_citizen: boolean;
  notify_earthquake: boolean;
  active: boolean;
  created_at: string;
};

export const zonesQuery = queryOptions({
  queryKey: ["zones"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("zones")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Zone[];
  },
});

export const liveZoneContextQuery = queryOptions({
  queryKey: ["zones", "live-context"],
  refetchInterval: 300_000,
  queryFn: async (): Promise<LiveContext> => {
    const now = new Date().toISOString();
    const since = new Date(Date.now() - 72 * 3_600_000).toISOString();
    const [weather, official, road, citizen, stations] = await Promise.all([
      supabase
        .from("onm_vigilance")
        .select(
          "id, event, severity, expires, wilaya_id, area:onm_areas(polygon)",
        )
        .is("superseded_at", null)
        .is("cancelled_at", null)
        .is("superseded_by", null)
        .neq("msg_type", "Cancel")
        .gt("expires", now)
        .lte("sent", now)
        .limit(1000),
      supabase
        .from("official_incidents")
        .select("id, commune_id, wilaya_id, last_reported_at")
        .is("unlisted_at", null)
        .gt("last_reported_at", since)
        .limit(1000),
      supabase
        .from("civil_publications")
        .select("id, area_id, summary, expires_at")
        .eq("hazard", "road")
        .eq("state", "published")
        .gt("expires_at", now)
        .limit(1000),
      supabase
        .from("hazard_reports")
        .select("id, hazard, lat, lon, expires_at, witnesses")
        .gt("witnesses", 0)
        .gt("expires_at", now)
        .limit(1000),
      supabase
        .from("airport_weather")
        .select("station, name, lat, lon, observed_at, visibility_m, weather"),
    ]);
    for (const result of [weather, official, road, citizen, stations])
      if (result.error) throw new Error(result.error.message);
    return {
      weather: (weather.data ?? []).flatMap(({ area, ...w }) =>
        w.expires
          ? [
              {
                ...w,
                expires: w.expires,
                polygon: Array.isArray(area?.polygon)
                  ? (area.polygon as [number, number][])
                  : null,
              },
            ]
          : [],
      ),
      official: official.data ?? [],
      road: road.data ?? [],
      stations: (stations.data ?? []).flatMap((s) =>
        s.station && s.lat !== null && s.lon !== null && s.observed_at
          ? [
              {
                ...s,
                station: s.station,
                lat: s.lat,
                lon: s.lon,
                observed_at: s.observed_at,
              },
            ]
          : [],
      ),
      citizen: (citizen.data ?? []).flatMap((c) =>
        c.id && c.lat !== null && c.lon !== null && c.expires_at
          ? [
              {
                id: c.id,
                hazard: c.hazard,
                lat: c.lat,
                lon: c.lon,
                expires_at: c.expires_at,
                witnesses: c.witnesses ?? 0,
              },
            ]
          : [],
      ),
    };
  },
});

export const MAX_ZONES = 10;

// the limit_zones trigger's message is the one save failure a user can act on
export function zoneFailureKey(failure: unknown): string {
  return failure instanceof Error &&
    failure.message.startsWith("Zone limit reached")
    ? "account.zoneLimit"
    : "account.zoneSaveFailed";
}

export const ZONE_HAZARDS = [
  { key: "notify_fires", label: "account.notifyFires" },
  { key: "notify_risk", label: "account.notifyRisk" },
  { key: "notify_weather", label: "account.notifyWeather" },
  { key: "notify_official", label: "account.notifyOfficial" },
  { key: "notify_road", label: "account.notifyRoad" },
  { key: "notify_citizen", label: "account.notifyCitizen" },
  { key: "notify_earthquake", label: "account.notifyEarthquake" },
] as const;

export type ZoneHazardKey = (typeof ZONE_HAZARDS)[number]["key"];

// the zone form prefilled this point until 2026-09-24; zones still on it were never placed
export const isDefaultPoint = (zone: Pick<Zone, "lat" | "lon">) =>
  zone.lat === 36.7 && zone.lon === 4.05;

export type ZoneInput = Pick<
  Zone,
  | "name"
  | "lat"
  | "lon"
  | "radius_km"
  | "commune_id"
  | "min_danger_level"
  | ZoneHazardKey
>;

export async function saveZone(input: ZoneInput, id?: string) {
  if (id) {
    const { error } = await supabase.from("zones").update(input).eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("no session");
  const { error } = await supabase
    .from("zones")
    .insert({ ...input, user_id: auth.user.id });
  if (error) throw new Error(error.message);
}

export async function setZoneActive(id: string, active: boolean) {
  const { error } = await supabase
    .from("zones")
    .update({ active })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteZone(id: string) {
  const { error } = await supabase.from("zones").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export const profileQuery = queryOptions({
  queryKey: ["profile"],
  queryFn: async () => {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as unknown as Profile | null;
  },
});

export async function saveProfileSettings(input: ProfileSettingsInput) {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new ProfileSettingsError(authError);

  const { error } = await supabase
    .from("profiles")
    .update(input)
    .eq("id", auth.user.id);
  if (error) throw new ProfileSettingsError(error);
}
