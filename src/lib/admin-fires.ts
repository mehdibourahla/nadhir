import { useQuery, infiniteQueryOptions } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Tone } from "@/components/admin/kit/StatusBadge";

import { supabase } from "@/integrations/supabase/client";
import type { AnyLocale } from "@/i18n";
import { adminUnitsQuery, unitName } from "@/lib/nadhir";
import { firstPage, nextOffset, pageRange, pageRows } from "@/lib/paging";

const FIRE_STATES = [
  "unconfirmed",
  "active",
  "contained_guess",
  "extinguished",
  "false_positive",
] as const;

export type FireState = (typeof FIRE_STATES)[number];

export const RESOLUTION_REASONS = [
  "flare",
  "glint",
  "industry",
  "agri_burn",
  "out_of_area",
  "other",
] as const;

export type ResolutionReason = (typeof RESOLUTION_REASONS)[number];

export type UnresolvedFire = {
  id: string;
  short_id: string;
  lat: number;
  lon: number;
  state: string;
  confidence: number | null;
  detection_count: number | null;
  first_detected_at: string;
  last_detected_at: string;
  updated_at: string;
  max_frp_mw: number | null;
  sources: string[] | null;
  commune_id: string | null;
  wilaya_id: string | null;
};

// the same bar admin_attention_counts uses, so the page and the count agree
const STRONG_FIRE_CONFIDENCE = 0.6;

export const unresolvedFiresQuery = (strongOnly: boolean) =>
  infiniteQueryOptions({
    queryKey: ["admin", "fires", "unresolved", strongOnly],
    initialPageParam: firstPage,
    getNextPageParam: nextOffset,
    select: pageRows,
    queryFn: async ({ pageParam }): Promise<UnresolvedFire[]> => {
      let query = supabase
        .from("fire_clusters")
        .select(
          "id, short_id, lat, lon, state, confidence, detection_count, first_detected_at, last_detected_at, updated_at, max_frp_mw, sources, commune_id, wilaya_id",
        )
        .is("resolved_at", null)
        .in("state", ["unconfirmed", "active", "contained_guess"])
        .order("confidence", { ascending: false })
        .order("id")
        .range(...pageRange(pageParam));
      if (strongOnly) query = query.gte("confidence", STRONG_FIRE_CONFIDENCE);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as UnresolvedFire[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

export async function resolveFire(input: {
  id: string;
  state: FireState;
  reason: ResolutionReason | null;
  note: string | null;
  expectedUpdatedAt: string;
}) {
  const { error } = await supabase.rpc("resolve_fire", {
    _cluster: input.id,
    _state: input.state,
    _reason: input.reason,
    _note: input.note,
    _expected_updated_at: input.expectedUpdatedAt,
  });
  if (error) throw new Error(error.message);
}

export const FIRE_STATE_TONE: Record<string, Tone> = {
  active: "bad",
  unconfirmed: "warn",
  contained_guess: "neutral",
};

export function usePlace() {
  const units = useQuery(adminUnitsQuery);
  const locale = useTranslation().i18n.language as AnyLocale;
  const names = useMemo(
    () =>
      new Map(
        (units.data ?? []).map((unit) => [unit.id, unitName(unit, locale)]),
      ),
    [units.data, locale],
  );
  return (fire: UnresolvedFire) =>
    [fire.commune_id, fire.wilaya_id]
      .map((id) => (id ? names.get(id) : undefined))
      .filter(Boolean)
      .join(" — ") || `${fire.lat.toFixed(3)}, ${fire.lon.toFixed(3)}`;
}
