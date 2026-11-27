import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  HeartHandshake,
  Languages,
  Send,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";

import type { AnyLocale } from "@/i18n";
import {
  IDEA_MIN,
  LANES,
  percent,
  publishedIdeasQuery,
  readVoterKey,
  validateIdea,
  type Lane,
} from "@/lib/contribute";
import { getDeficits } from "@/lib/contribute.functions";
import { pageMeta } from "@/lib/page-meta";
import { pageRows } from "@/lib/paging";
import { REVIEWABLE } from "@/lib/translate";
import { AtlasPageFooter } from "@/ui/app-shell";
import { cleanCopy, formatNumber } from "@/ui/format";
import {
  AtlasBadge,
  AtlasButton,
  AtlasInput,
  AtlasMasthead,
  AtlasPanel,
  AtlasSelect,
  AtlasTextarea,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/contribute")({
  head: () => ({
    meta: [
      ...pageMeta("contribute.metaTitle", "contribute.metaDescription"),
      { property: "og:type", content: "website" },
    ],
  }),
  loader: () => getDeficits(),
  component: ContributePage,
});

function ContributePage() {
  const deficits = Route.useLoaderData();
  const { t, i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;
  const qc = useQueryClient();

  const ideasQ = useInfiniteQuery(publishedIdeasQuery);
  const ideas = useMemo(() => pageRows(ideasQ.data), [ideasQ.data]);

  const [lane, setLane] = useState<Lane>("local");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState("");

  const submitMut = useMutation({
    mutationFn: async () => {
      const err = validateIdea({ lane, message, contact, locale, website });
      if (err) throw new Error(err);
      const res = await fetch("/api/public/contribute/idea", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lane,
          message: message.trim(),
          contact: contact.trim() || null,
          locale,
          website,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      setMessage("");
      setContact("");
      toast.success("Contribution received");
      void qc.invalidateQueries({ queryKey: ["contribution-ideas"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const voteMut = useMutation({
    mutationFn: async (ideaId: string) => {
      const res = await fetch("/api/public/contribute/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ideaId, voterKey: readVoterKey() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["contribution-ideas"] }),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <HeartHandshake className="h-3.5 w-3.5 text-signal" />
            <span>OPEN CIVIC EFFORT</span>
          </>
        }
        title={t("nav.contribute")}
        subtitle={
          locale === "ar"
            ? "نذير مبادرة مدنية مفتوحة لتحسين الإنذار المبكر وجودة البيانات واللغات في الجزائر."
            : locale === "fr"
              ? "Nadhir est une initiative civique ouverte pour améliorer l'alerte précoce, les cartes et les langues en Algérie."
              : "Nadhir is an open civic project built to strengthen early warning, local data, and language coverage across Algeria."
        }
        metrics={[
          {
            label: "Verified open areas",
            value: (
              <SafeBdi>
                {percent(deficits.openAreasVerified, deficits.openAreasTotal)}%
              </SafeBdi>
            ),
            detail: `${formatNumber(deficits.openAreasVerified, locale)} / ${formatNumber(deficits.openAreasTotal, locale)}`,
          },
          {
            label: "Communes with fuel data",
            value: (
              <SafeBdi>
                {percent(deficits.communesWithFuel, deficits.communesTotal)}%
              </SafeBdi>
            ),
            detail: `${formatNumber(deficits.communesWithFuel, locale)} / ${formatNumber(deficits.communesTotal, locale)}`,
          },
          {
            label: "Locales shipped",
            value: <SafeBdi>{deficits.localesShipped}</SafeBdi>,
            detail: "AR · FR · EN · KAB",
          },
          {
            label: "Delivery receipts",
            value: (
              <SafeBdi>
                {formatNumber(deficits.deliveryReceipts, locale)}
              </SafeBdi>
            ),
          },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Language Review Portal + Idea Submission */}
        <div className="lg:col-span-5 space-y-6">
          <AtlasPanel className="space-y-4">
            <div className="flex items-center gap-2">
              <Languages className="h-4 w-4 text-signal" />
              <h2 className="font-display text-xl font-semibold text-ink">
                {locale === "ar"
                  ? "مراجعة الترجمات"
                  : locale === "fr"
                    ? "Relire les traductions"
                    : "Review translations"}
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {REVIEWABLE.map((loc) => (
                <Link
                  key={loc}
                  to="/contribute/language/$locale"
                  params={{ locale: loc }}
                  className="flex items-center justify-between rounded-xl border border-hairline bg-surface-raised/60 px-4 py-3 text-sm font-medium text-ink hover:border-signal transition-colors"
                >
                  <span>
                    {loc === "ar"
                      ? "العربية (Arabic)"
                      : loc === "fr"
                        ? "Français (French)"
                        : "Taqbaylit (Kabyle)"}
                  </span>
                  <ArrowRight className="h-4 w-4 text-signal atlas-dir-icon" />
                </Link>
              ))}
            </div>
          </AtlasPanel>

          <AtlasPanel className="space-y-4">
            <h2 className="font-display text-xl font-semibold text-ink">
              {locale === "ar"
                ? "اقترح تحسينًا أو مساهمة"
                : locale === "fr"
                  ? "Proposer une contribution"
                  : "Propose a contribution"}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitMut.mutate();
              }}
              className="space-y-3"
            >
              <AtlasSelect
                value={lane}
                onChange={(e) => setLane(e.target.value as Lane)}
              >
                {LANES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </AtlasSelect>

              <AtlasTextarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={`At least ${IDEA_MIN} characters...`}
                required
              />

              <AtlasInput
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Contact (optional)"
              />

              <input
                type="text"
                name="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden="true"
              />

              <AtlasButton
                type="submit"
                variant="primary"
                className="w-full"
                disabled={
                  submitMut.isPending || message.trim().length < IDEA_MIN
                }
              >
                <Send className="h-4 w-4" />
                Submit
              </AtlasButton>
            </form>
          </AtlasPanel>
        </div>

        {/* Published Community Ideas */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between border-b border-hairline pb-3">
            <h2 className="font-display text-2xl font-semibold text-ink">
              {locale === "ar"
                ? "الأفكار المنشورة"
                : locale === "fr"
                  ? "Idées publiées"
                  : "Published proposals"}
            </h2>
            <SafeBdi className="font-mono text-xs text-ink-muted">
              {ideas.length}
            </SafeBdi>
          </div>

          <div className="divide-y divide-hairline border-y border-hairline bg-surface">
            {ideas.map((idea) => (
              <div
                key={idea.id}
                className="flex items-start justify-between gap-4 p-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <AtlasBadge tone="signal">{idea.lane}</AtlasBadge>
                  <p className="text-sm text-ink leading-relaxed">
                    {cleanCopy(idea.message)}
                  </p>
                </div>
                <AtlasButton
                  variant="secondary"
                  size="sm"
                  onClick={() => voteMut.mutate(idea.id)}
                  disabled={voteMut.isPending}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  <SafeBdi className="font-mono">{idea.score}</SafeBdi>
                </AtlasButton>
              </div>
            ))}
          </div>

          {ideasQ.hasNextPage && (
            <div className="flex justify-center pt-2">
              <AtlasButton
                variant="secondary"
                onClick={() => void ideasQ.fetchNextPage()}
              >
                {t("common.loadMore")}
              </AtlasButton>
            </div>
          )}
        </div>
      </div>

      <AtlasPageFooter />
    </div>
  );
}
