import { queryOptions, infiniteQueryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { firstPage, nextOffset, pageRange } from "@/lib/paging";
import { apiUrl } from "@/lib/platform";

export type Alert = {
  id: string;
  zone_id: string | null;
  kind:
    | "fire"
    | "risk"
    | "weather"
    | "official"
    | "road"
    | "citizen"
    | "earthquake";
  severity: number;
  cluster_id: string | null;
  commune_id: string | null;
  source_table?: string | null;
  source_id: string | null;
  title: string;
  body: string;
  distance_km: number | null;
  payload:
    | ({
        phase?: "new" | "urgent" | "growth" | "observation_ended";
        short_id?: string;
        state?: string;
        danger_level?: number;
        expires_at?: string;
        map_event?: string;
        hazard?: string;
        authority?: string;
        onm_severity?: string;
        magnitude?: number;
        occurred_at?: string;
        last_detected_at?: string;
      } & Record<string, unknown>)
    | null;
  read_at: string | null;
  created_at: string;
};

export const alertsQuery = infiniteQueryOptions({
  queryKey: ["alerts"],
  initialPageParam: firstPage,
  getNextPageParam: nextOffset,
  queryFn: async ({ pageParam }) => {
    const { data, error } = await supabase
      .from("alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(...pageRange(pageParam));
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Alert[];
  },
});

export const unreadAlertsQuery = queryOptions({
  queryKey: ["alerts", "unread"],
  queryFn: async () => {
    const { count, error } = await supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  },
});

export async function markAllAlertsRead() {
  const { error } = await supabase
    .from("alerts")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

export const alertFiresQuery = (ids: string[]) => {
  const sorted = [...new Set(ids)].sort();
  return queryOptions({
    queryKey: ["alert-fires", sorted],
    enabled: sorted.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fire_clusters")
        .select("id, state, last_detected_at, resolved_at")
        .in("id", sorted);
      if (error) throw new Error(error.message);
      return new Map((data ?? []).map((fire) => [fire.id, fire]));
    },
  });
};

export async function markAlertsRead(ids: string[], read: boolean) {
  if (!ids.length) return;
  const { error } = await supabase
    .from("alerts")
    .update({ read_at: read ? new Date().toISOString() : null })
    .in("id", ids);
  if (error) throw new Error(error.message);
}

export async function deleteAlerts(ids: string[]) {
  const { error } = await supabase.from("alerts").delete().in("id", ids);
  if (error) throw new Error(error.message);
}

export async function runAlertCheck() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("no_session");
  const res = await fetch(apiUrl("/api/private/alert-check"), {
    method: "POST",
    headers: { authorization: `Bearer ${data.session.access_token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`alert check failed (${res.status})`);
}
