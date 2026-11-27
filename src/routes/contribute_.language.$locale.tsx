import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, Send } from "lucide-react";
import { toast } from "sonner";

import { headTranslator } from "@/i18n";
import { titledMeta } from "@/lib/page-meta";
import {
  REVIEWABLE,
  countSubmittable,
  markSent,
  readDrafts,
  readReviewerKey,
  rowsFor,
  writeDrafts,
  type DraftMap,
  type ReviewableLocale,
} from "@/lib/translate";
import { AtlasPageFooter } from "@/ui/app-shell";
import {
  AtlasBadge,
  AtlasButton,
  AtlasInput,
  AtlasMasthead,
  AtlasPanel,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/contribute_/language/$locale")({
  beforeLoad: ({ params }) => {
    if (!REVIEWABLE.includes(params.locale as ReviewableLocale))
      throw notFound();
  },
  head: ({ params }) => ({
    meta: titledMeta("translate.title", undefined, {
      language: headTranslator()(`translate.lang_${params.locale}`),
    }),
  }),
  component: TranslationReviewPage,
});

function TranslationReviewPage() {
  const { locale: targetLocale } = Route.useParams();
  const loc = targetLocale as ReviewableLocale;
  const rows = useMemo(() => rowsFor(loc), [loc]);
  const [filter, setFilter] = useState("");
  const [drafts, setDrafts] = useState<DraftMap>(() => readDrafts(loc));

  const currentByPath = useMemo(
    () => new Map(rows.map((r) => [r.path, r.current])),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows.slice(0, 60);
    return rows
      .filter(
        (r) =>
          r.path.toLowerCase().includes(q) ||
          r.source.toLowerCase().includes(q) ||
          r.current.toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [rows, filter]);

  const readyCount = countSubmittable(drafts, (p) => currentByPath.get(p));

  function updateDraft(path: string, suggestion: string) {
    const next: DraftMap = {
      ...drafts,
      [path]: { verdict: "suggested", suggestion },
    };
    setDrafts(next);
    writeDrafts(loc, next);
  }

  function confirmRow(path: string) {
    const next: DraftMap = {
      ...drafts,
      [path]: { verdict: "confirmed" },
    };
    setDrafts(next);
    writeDrafts(loc, next);
  }

  const sendMut = useMutation({
    mutationFn: async () => {
      const items = Object.entries(drafts)
        .filter(([, d]) => !d.sent)
        .map(([key_path, d]) => ({
          key_path,
          verdict: d.verdict,
          suggestion: d.suggestion ?? null,
          source_text: rows.find((r) => r.path === key_path)?.source ?? "",
          current_text: currentByPath.get(key_path) ?? "",
        }));
      const res = await fetch("/api/public/contribute/translation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale: loc,
          reviewerKey: readReviewerKey(),
          items,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      const marked = markSent(drafts, (p) => currentByPath.get(p));
      setDrafts(marked);
      writeDrafts(loc, marked);
      toast.success("Suggestions submitted");
    },
    onError: () => toast.error("Submission failed"),
  });

  const { i18n } = useTranslation();
  const uiLocale = (i18n.language || "ar") as string;

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-5 pb-12">
      <div className="mb-3">
        <Link
          to="/contribute"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-secondary hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5 atlas-dir-icon" />
          {uiLocale === "ar"
            ? "العودة إلى المساهمة"
            : uiLocale === "fr"
              ? "Retour à Contribuer"
              : "Back to Contribute"}
        </Link>
      </div>

      <AtlasMasthead
        edition={
          <>
            <SafeBdi>{loc.toUpperCase()}</SafeBdi>
            <span>·</span>
            <span>
              {uiLocale === "ar"
                ? `${rows.length} نص`
                : uiLocale === "fr"
                  ? `${rows.length} chaînes`
                  : `${rows.length} strings`}
            </span>
          </>
        }
        title={
          uiLocale === "ar"
            ? `مراجعة الترجمة (${loc.toUpperCase()})`
            : uiLocale === "fr"
              ? `Relecture linguistique (${loc.toUpperCase()})`
              : `Language review (${loc.toUpperCase()})`
        }
        actions={
          <AtlasButton
            variant="primary"
            size="sm"
            disabled={readyCount === 0 || sendMut.isPending}
            onClick={() => sendMut.mutate()}
          >
            <Send className="h-3.5 w-3.5" />
            {uiLocale === "ar"
              ? `إرسال (${readyCount})`
              : uiLocale === "fr"
                ? `Envoyer (${readyCount})`
                : `Submit (${readyCount})`}
          </AtlasButton>
        }
      />

      <div className="mb-5">
        <AtlasInput
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={
            uiLocale === "ar"
              ? "ابحث في المفاتيح أو النصوص..."
              : uiLocale === "fr"
                ? "Filtrer les clés ou textes..."
                : "Filter keys or text..."
          }
        />
      </div>

      <div className="space-y-3">
        {filtered.map((row) => {
          const draft = drafts[row.path];
          return (
            <AtlasPanel key={row.path} className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <SafeBdi className="font-mono text-xs text-signal">
                  {row.path}
                </SafeBdi>
                {draft?.sent ? (
                  <AtlasBadge tone="clear">
                    {uiLocale === "ar"
                      ? "تم الإرسال"
                      : uiLocale === "fr"
                        ? "Envoyé"
                        : "Sent"}
                  </AtlasBadge>
                ) : draft?.verdict === "confirmed" ? (
                  <AtlasBadge tone="signal">
                    {uiLocale === "ar"
                      ? "مؤكد"
                      : uiLocale === "fr"
                        ? "Confirmé"
                        : "Confirmed"}
                  </AtlasBadge>
                ) : null}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div
                  dir="ltr"
                  className="rounded-lg bg-surface-raised/60 p-3 text-left text-ink-secondary"
                >
                  <div className="text-[11px] font-mono font-semibold text-ink-secondary mb-1">
                    {uiLocale === "ar"
                      ? "النص الأصلي (EN)"
                      : uiLocale === "fr"
                        ? "SOURCE EN"
                        : "EN SOURCE"}
                  </div>
                  {row.source}
                </div>
                <div className="space-y-2">
                  <AtlasInput
                    dir={loc === "ar" ? "rtl" : "ltr"}
                    value={draft?.suggestion ?? row.current}
                    onChange={(e) => updateDraft(row.path, e.target.value)}
                  />
                  <div className="flex justify-end">
                    <AtlasButton
                      variant="ghost"
                      size="sm"
                      onClick={() => confirmRow(row.path)}
                    >
                      <Check className="h-3.5 w-3.5 text-hazard-clear" />
                      {uiLocale === "ar"
                        ? "تأكيد الترجمة الحالية"
                        : uiLocale === "fr"
                          ? "Confirmer l'actuelle"
                          : "Confirm current"}
                    </AtlasButton>
                  </div>
                </div>
              </div>
            </AtlasPanel>
          );
        })}
      </div>

      <AtlasPageFooter />
    </div>
  );
}
