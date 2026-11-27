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

function reportKindLabel(kind: string, locale: AnyLocale): string {
  const map: Record<string, { ar: string; fr: string; en: string }> = {
    sighting: { ar: "دخان / حريق", fr: "Fumée / Feu", en: "Smoke / Fire" },
    flooding: { ar: "فيضان", fr: "Inondation", en: "Flooding" },
    storm_damage: {
      ar: "أضرار عاصفة",
      fr: "Dégâts tempête",
      en: "Storm damage",
    },
    road_blocked: { ar: "طريق مقطوع", fr: "Route coupée", en: "Road blocked" },
    earthquake: { ar: "هزة أرضية", fr: "Séisme", en: "Earthquake" },
    person_trapped: {
      ar: "شخص عالق",
      fr: "Personne bloquée",
      en: "Person trapped",
    },
    other: { ar: "خطر آخر", fr: "Autre aléa", en: "Other hazard" },
  };
  const e = map[kind];
  if (!e) return kind.replace(/_/g, " ");
  return locale === "ar" ? e.ar : locale === "fr" ? e.fr : e.en;
}

function publishStateLabel(state: string, locale: AnyLocale): string {
  if (state === "published") {
    return locale === "ar" ? "منشور" : locale === "fr" ? "Publié" : "Published";
  }
  if (state === "held") {
    return locale === "ar"
      ? "قيد المراجعة"
      : locale === "fr"
        ? "En attente"
        : "Under review";
  }
  if (state === "classifying") {
    return locale === "ar"
      ? "جاري التحقق"
      : locale === "fr"
        ? "Vérification"
        : "Checking";
  }
  return locale === "ar" ? "خاص" : locale === "fr" ? "Privé" : "Private";
}

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
      toast.success(
        locale === "ar"
          ? "تم إرسال البلاغ"
          : locale === "fr"
            ? "Signalement envoyé"
            : "Report submitted",
      );
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
            <span>
              {locale === "ar"
                ? "رصد مواطن"
                : locale === "fr"
                  ? "OBSERVATION CITOYENNE"
                  : "CITIZEN OBSERVATION"}
            </span>
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
                  aria-pressed={active}
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-colors cursor-pointer",
                    active
                      ? "border-signal bg-signal-soft text-signal"
                      : "border-hairline bg-surface hover:bg-surface-raised text-ink-secondary",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{reportKindLabel(k, locale)}</span>
                </button>
              );
            })}
          </div>

          <MiniHazardMap
            lat={lat}
            lon={lon}
            zoom={9}
            interactive
            markerColor="#DC2626"
            onPick={(pos) => {
              setLat(pos.lat);
              setLon(pos.lon);
            }}
            className="h-64"
          />

          <div className="flex items-center justify-between text-xs text-ink-secondary">
            <span>
              {nearest
                ? unitName(nearest, locale)
                : locale === "ar"
                  ? "الجزائر"
                  : locale === "fr"
                    ? "Algérie"
                    : "Algeria"}
            </span>
            <SafeBdi className="font-mono">{coordLabel(lat, lon)}</SafeBdi>
          </div>

          <AtlasTextarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              locale === "ar"
                ? "صف ما تلاحظه بدقة..."
                : locale === "fr"
                  ? "Décrivez ce que vous observez..."
                  : "Describe what you observe..."
            }
          />

          <AtlasButton
            variant="danger"
            className="min-h-11"
            onClick={() => submitMut.mutate()}
            disabled={submitMut.isPending}
          >
            <Send className="h-4 w-4" />
            {submitMut.isPending
              ? locale === "ar"
                ? "جاري الإرسال..."
                : locale === "fr"
                  ? "Envoi en cours..."
                  : "Submitting..."
              : locale === "ar"
                ? "إرسال البلاغ"
                : locale === "fr"
                  ? "Envoyer le signalement"
                  : "Submit observation"}
          </AtlasButton>
        </AtlasPanel>

        <AtlasPanel className="lg:col-span-5 space-y-4">
          <h2 className="font-display text-xl font-semibold text-ink">
            {locale === "ar"
              ? `بلاغاتي (${myReports.length})`
              : locale === "fr"
                ? `Mes signalements (${myReports.length})`
                : `My reports (${myReports.length})`}
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
                      <AtlasBadge tone="high">
                        {reportKindLabel(r.kind, locale)}
                      </AtlasBadge>
                      <AtlasBadge tone="neutral">
                        {publishStateLabel(r.publish_state, locale)}
                      </AtlasBadge>
                    </div>
                    {r.note && (
                      <p className="text-xs text-ink-secondary truncate">
                        {cleanCopy(r.note)}
                      </p>
                    )}
                    <SafeBdi className="font-mono text-[11px] text-ink-muted">
                      {relativeTime(r.created_at, locale)}
                    </SafeBdi>
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
