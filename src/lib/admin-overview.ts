import { queryOptions } from "@tanstack/react-query";

import type { Tone } from "@/components/admin/kit/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { ar } from "@/i18n/locales/ar";
import { fr } from "@/i18n/locales/fr";
import { kab } from "@/i18n/locales/kab";
import type { AttentionCounts, AttentionItem } from "./admin-attention";

export type OverviewItem = AttentionItem | "translations_unapplied";
export type OverviewRow = {
  item: OverviewItem;
  count: number;
  oldest: string | null;
  tone: Tone;
  path: string;
};

const ORDER: { item: OverviewItem; tone: Tone; path: string }[] = [
  { item: "broadcasting_off", tone: "bad", path: "/admin/broadcasts" },
  { item: "sources_unhealthy", tone: "bad", path: "/admin/sources" },
  { item: "operational_incidents", tone: "warn", path: "/admin/sources" },
  { item: "ita_review", tone: "warn", path: "/admin/ita" },
  { item: "ita_failed", tone: "warn", path: "/admin/ita" },
  { item: "fires", tone: "warn", path: "/admin/fires" },
  { item: "risk_pending", tone: "warn", path: "/admin/risk" },
  { item: "delivery_backlog", tone: "warn", path: "/admin/broadcasts" },
  { item: "citizen_reports", tone: "neutral", path: "/admin/reports" },
  { item: "source_gaps", tone: "neutral", path: "/admin/sources" },
  { item: "translations", tone: "neutral", path: "/admin/translations" },
  { item: "ideas", tone: "neutral", path: "/admin/ideas" },
  {
    item: "translations_unapplied",
    tone: "neutral",
    path: "/admin/translations",
  },
];

export const OVERVIEW_ITEMS = ORDER.map((entry) => entry.item);

export function overviewRows(
  counts: AttentionCounts,
  unapplied: number,
): OverviewRow[] {
  return ORDER.flatMap((entry) => {
    const found =
      entry.item === "translations_unapplied"
        ? { count: unapplied, oldest: null }
        : counts[entry.item];
    return found && found.count > 0 ? [{ ...entry, ...found }] : [];
  });
}

const BUNDLES: Record<string, object> = { ar, fr, kab };

function readPath(tree: object, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[key]
          : undefined,
      tree,
    );
}

// accepted is not shipped: the text only lands when someone runs apply:translations
export const unappliedTranslationsQuery = queryOptions({
  queryKey: ["admin", "translations", "unapplied"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc(
      "list_translation_suggestions_for_moderation",
      { _status: "accepted" },
    );
    if (error) throw new Error(error.message);
    return (data ?? []).filter((row) => {
      if (row.status !== "accepted" || !row.suggestion) return false;
      const bundle = BUNDLES[row.locale];
      return bundle ? readPath(bundle, row.key_path) !== row.suggestion : false;
    }).length;
  },
  staleTime: 60_000,
});
