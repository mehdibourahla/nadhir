import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Flag, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { AnyLocale } from "@/i18n";
import { nearestPlace } from "@/lib/civil-map";
import {
  adminUnitsQuery,
  coordLabel,
  relativeTime,
  unitName,
} from "@/lib/nadhir";
import { pageMeta } from "@/lib/page-meta";
import { pageRows } from "@/lib/paging";
import { TILES } from "@/lib/report-tiles";
import {
  createReport,
  deleteReport,
  myReportsQuery,
  publishReport,
  type ReportKind,
} from "@/lib/reports";
import { cn } from "@/lib/utils";
import { AtlasPageFooter } from "@/ui/app-shell";
import { cleanCopy } from "@/ui/format";
import { MiniHazardMap } from "@/ui/hazard-map";
import {
  AtlasBadge,
  AtlasButton,
  AtlasMasthead,
  AtlasPanel,
  AtlasTextarea,
  SafeBdi,
} from "@/ui/primitives";

type ReportSearch = { kind?: ReportKind };
const KINDS = new Set<string>(TILES.map((t) => t.kind));

export const Route = createFileRoute("/_authenticated/report")({
  validateSearch: (search: Record<string, unknown>): ReportSearch => {
    const kind = search["kind"] === "smoke" ? "sighting" : search["kind"];
    return typeof kind === "string" && KINDS.has(kind)
      ? { kind: kind as ReportKind }
      : {};
  },
  head: () => ({
    meta: [
      ...pageMeta("reports.metaTitle", "reports.metaDescription"),
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;
  const search = Route.useSearch();
  const qc = useQueryClient();

  const [kind, setKind] = useState<ReportKind>(search.kind ?? "sighting");
  const [lat, setLat] = useState(36.7538);
  const [lon, setLon] = useState(3.0588);
  const [note, setNote] = useState("");

  const unitsQ = useQuery({ ...adminUnitsQuery, staleTime: 10 * 60_000 });
  const mineQ = useInfiniteQuery(myReportsQuery);
  const myReports = useMemo(() => pageRows(mineQ.data), [mineQ.data]);

  const nearest = useMemo(
    () => nearestPlace(unitsQ.data ?? [], lat, lon),
    [unitsQ.data, lat, lon],
  );

  const submitMut = useMutation({
    mutationFn: async () => {
      const id = await createReport({
        kind,
        lat,
        lon,
        note: note.trim() || null,
        observed_at: new Date().toISOString(),
      });
      await publishReport(id).catch(() => {});
      return id;
    },
    onSuccess: () => {
      setNote("");
      void qc.invalidateQueries({ queryKey: ["reports", "mine"] });
      toast.success("Report submitted");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const deleteMut = useMutation({
    mutationFn: deleteReport,
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["reports", "mine"] }),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <Flag className="h-3.5 w-3.5 text-hazard-extreme" />
            <span>CITIZEN OBSERVATION</span>
          </>
        }
        title={
          locale === "ar"
            ? "الإبلاغ عن خطر ميداني"
            : locale === "fr"
              ? "Signaler un incident"
              : "Report a hazard"
        }
        subtitle={
          locale === "ar"
            ? "في حالات الخطر المباشر اتصل بالحماية المدنية على الرقم 14 أولاً."
            : locale === "fr"
              ? "En cas de danger immédiat, appelez d'abord la Protection Civile au 14."
              : "For immediate life-threatening emergencies, call Civil Protection 14 first."
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <AtlasPanel className="lg:col-span-7 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TILES.map(({ kind: k, Icon }) => {
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-colors cursor-pointer",
                    active
                      ? "border-signal bg-signal-soft text-signal"
                      : "border-hairline bg-surface hover:bg-surface-raised text-ink-secondary",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{k.replace("_", " ")}</span>
                </button>
              );
            })}
          </div>

          <MiniHazardMap
            lat={lat}
            lon={lon}
            zoom={9}
            interactive
            onPick={(pos) => {
              setLat(pos.lat);
              setLon(pos.lon);
            }}
            className="h-64"
          />

          <div className="flex items-center justify-between text-xs text-ink-secondary">
            <span>{nearest ? unitName(nearest, locale) : "Algeria"}</span>
            <SafeBdi className="font-mono">{coordLabel(lat, lon)}</SafeBdi>
          </div>

          <AtlasTextarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Describe what you observe..."
          />

          <AtlasButton
            variant="danger"
            onClick={() => submitMut.mutate()}
            disabled={submitMut.isPending}
          >
            <Send className="h-4 w-4" />
            {submitMut.isPending ? "Submitting..." : "Submit observation"}
          </AtlasButton>
        </AtlasPanel>

        <AtlasPanel className="lg:col-span-5 space-y-4">
          <h2 className="font-display text-xl font-semibold text-ink">
            My reports ({myReports.length})
          </h2>
          {myReports.length === 0 ? (
            <p className="text-sm text-ink-secondary">{t("common.none")}</p>
          ) : (
            <div className="divide-y divide-hairline">
              {myReports.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-3 py-3 text-sm"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <AtlasBadge tone="high">{r.kind}</AtlasBadge>
                      <AtlasBadge tone="neutral">{r.publish_state}</AtlasBadge>
                    </div>
                    {r.note && (
                      <p className="text-xs text-ink-secondary truncate">
                        {cleanCopy(r.note)}
                      </p>
                    )}
                    <div className="font-mono text-[11px] text-ink-muted">
                      {relativeTime(r.created_at, locale)}
                    </div>
                  </div>
                  <AtlasButton
                    variant="ghost"
                    size="icon"
                    aria-label={t("common.delete")}
                    onClick={() => deleteMut.mutate(r.id)}
                  >
                    <Trash2 className="h-4 w-4 text-ink-muted" />
                  </AtlasButton>
                </div>
              ))}
            </div>
          )}
        </AtlasPanel>
      </div>

      <AtlasPageFooter />
    </div>
  );
}
