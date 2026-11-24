import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OnmVigilance } from "@/lib/nadhir";
import { PAGE_SIZE } from "@/lib/paginate";

const fields =
  "id, cap_id, title, event, severity, urgency, certainty, onset, expires, sent, area_desc, cap_url, wilaya_id, headline_fr, superseded_at, msg_type, cap_references, superseded_by, cancelled_at";

export const weatherOnmQuery = (wilayaId: string | null | undefined) =>
  queryOptions({
    queryKey: ["weather_onm", wilayaId],
    enabled: !!wilayaId,
    retry: false,
    refetchInterval: 300_000,
    queryFn: async ({ signal }) => {
      if (!wilayaId) throw new Error("Weather warnings require a wilaya");
      const capturedAt = new Date().toISOString();
      const pages = async (bounds?: { start: string; end: string }) => {
        const rows: OnmVigilance[] = [];
        for (let page = 0; page < 40; page++) {
          let query = supabase
            .from("onm_vigilance")
            .select(fields)
            .eq("wilaya_id", wilayaId)
            .lte("sent", capturedAt)
            .neq("msg_type", "Cancel")
            .is("cancelled_at", null);
          query = bounds
            ? query.gt("expires", bounds.start).lt("onset", bounds.end)
            : query
                .gt("expires", capturedAt)
                .is("superseded_at", null)
                .is("superseded_by", null);
          const { data, error } = await query
            .order("sent", { ascending: false })
            .order("id")
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
            .abortSignal(signal);
          if (error) throw new Error(error.message);
          rows.push(...(data ?? []));
          if ((data?.length ?? 0) < PAGE_SIZE) return rows;
        }
        throw new Error("Weather warning pagination limit reached");
      };
      const current = await pages();
      const valid = current.filter(
        (warning) =>
          warning.onset &&
          warning.expires &&
          Number.isFinite(Date.parse(warning.onset)) &&
          Number.isFinite(Date.parse(warning.expires)) &&
          Date.parse(warning.expires) > Date.parse(warning.onset),
      );
      if (!valid.length)
        return { warnings: current, historyUnavailable: false };
      const start = new Date(
        Math.min(...valid.map((warning) => Date.parse(warning.onset!))),
      ).toISOString();
      const end = new Date(
        Math.max(...valid.map((warning) => Date.parse(warning.expires!))),
      ).toISOString();
      try {
        const history = await pages({ start, end });
        return {
          warnings: [
            ...new Map(
              [...current, ...history].map((warning) => [warning.id, warning]),
            ).values(),
          ],
          historyUnavailable: false,
        };
      } catch (error) {
        if (signal.aborted) throw error;
        return { warnings: current, historyUnavailable: true };
      }
    },
  });
