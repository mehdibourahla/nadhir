import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchAllPages } from "@/lib/paginate";
import { archivedFetch } from "@/lib/source-archive.server";

import {
  EMSC_MIN_MAGNITUDE,
  extractEmscWatermark,
  locateEvents,
  parseEmsc,
} from "./emsc";

const EVENTS_URL = "https://www.seismicportal.eu/fdsnws/event/1/query";
// Algeria plus the 100 km margin; locateEvents then keeps only what is near a commune
const BOX = { minlat: "18", maxlat: "38.5", minlon: "-9.7", maxlon: "13" };
// revisions arrive within hours; polling every two minutes, six hours overlaps many runs
const LOOKBACK_MS = 6 * 3_600_000;

export type EmscRun = {
  fetched: number;
  stored: number;
  outside: number;
  error?: string;
};

export type EmscRunWithMeta = EmscRun & {
  upstreamPublishedAt: string | null;
};

const store = {
  fetch: (url: string, updatedafter: string) =>
    archivedFetch(
      "emsc",
      "fdsn_events",
      url,
      { signal: AbortSignal.timeout(20_000) },
      { requestParams: { updatedafter, minmagnitude: EMSC_MIN_MAGNITUDE } },
    ),
  communes: () =>
    fetchAllPages<{ id: string; lat: number; lon: number }>((from, to) =>
      supabaseAdmin
        .from("admin_units")
        .select("id, lat, lon")
        .eq("level", "commune")
        .not("lat", "is", null)
        .order("id")
        .range(from, to),
    ),
  upsert: async (rows: unknown[]) => {
    const { error } = await supabaseAdmin
      .from("earthquakes")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(rows as any, { onConflict: "id" });
    if (error) throw new Error(`earthquakes upsert failed: ${error.message}`);
  },
};

export async function ingestEmscWithMeta(
  dependencies: Partial<typeof store> = {},
  now: () => number = Date.now,
): Promise<EmscRunWithMeta> {
  const deps = { ...store, ...dependencies };
  const updatedafter = new Date(now() - LOOKBACK_MS).toISOString();
  const url = new URL(EVENTS_URL);
  for (const [key, value] of Object.entries({
    format: "json",
    ...BOX,
    minmagnitude: String(EMSC_MIN_MAGNITUDE),
    updatedafter,
    limit: "500",
    orderby: "time",
  }))
    url.searchParams.set(key, value);
  const res = await deps.fetch(url.toString(), updatedafter);
  if (res.status !== 204 && !res.ok)
    return {
      fetched: 0,
      stored: 0,
      outside: 0,
      upstreamPublishedAt: null,
      error: `EMSC ${res.status}`,
    };
  const raw = res.status === 204 ? null : await res.json();
  const rawEvents = parseEmsc(raw);
  // Pre-filter freshness watermark across all fetched EMSC events BEFORE Algeria proximity/M2+ filtering
  const upstreamPublishedAt = extractEmscWatermark(rawEvents);
  if (!rawEvents.length)
    return { fetched: 0, stored: 0, outside: 0, upstreamPublishedAt };
  // Enforce M2.0 floor against raw unrounded magnitudes so M1.95-M1.99 never rounds up to 2.0
  const eligibleEvents = parseEmsc(raw, { minMagnitude: EMSC_MIN_MAGNITUDE });
  const located = eligibleEvents.length
    ? locateEvents(eligibleEvents, await deps.communes(), undefined, {
        minMagnitude: EMSC_MIN_MAGNITUDE,
      })
    : [];
  if (located.length) await deps.upsert(located);
  return {
    fetched: rawEvents.length,
    stored: located.length,
    outside: rawEvents.length - located.length,
    upstreamPublishedAt,
  };
}

export async function ingestEmsc(
  dependencies: Partial<typeof store> = {},
  now: () => number = Date.now,
): Promise<EmscRun> {
  const { upstreamPublishedAt: _watermark, ...run } = await ingestEmscWithMeta(
    dependencies,
    now,
  );
  return run;
}
