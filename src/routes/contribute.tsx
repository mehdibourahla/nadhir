import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  ChevronDown,
  Clock,
  Code2,
  FlaskConical,
  KanbanSquare,
  Languages,
  MapPin,
  Mic,
  Search,
  Smartphone,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";

import { EmergencyNumbers } from "@/components/SiteChrome";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { isTurnstileSiteKeyConfigured } from "@/lib/turnstile";
import type { Locale } from "@/i18n";
import {
  IDEA_MAX,
  IDEA_MIN,
  LANES,
  percent,
  publishedIdeasQuery,
  readVoterKey,
  type Deficits,
  type Lane,
} from "@/lib/contribute";
import { getDeficits } from "@/lib/contribute.functions";
import { pageMeta } from "@/lib/page-meta";
import { cn } from "@/lib/utils";
import { pageRows } from "@/lib/paging";
import { LoadMore } from "@/components/LoadMore";

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

const REPO = "https://github.com/mehdibourahla/fire-watcher-pro";

type LaneCard = {
  key: Exclude<Lane, "other" | "code">;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const LANE_CARDS: LaneCard[] = [
  { key: "local", Icon: MapPin },
  { key: "language", Icon: Languages },
  { key: "audio", Icon: Mic },
  { key: "institutional", Icon: Building2 },
  { key: "science", Icon: FlaskConical },
  { key: "research", Icon: Search },
  { key: "coordination", Icon: KanbanSquare },
  { key: "testing", Icon: Smartphone },
];

// Only where reading really is the first step. The other four lanes ask for
// something no GitHub page can accept from a non-developer — a place checked, a
// language read, a voice recorded, an introduction — so they open the box instead.
const LANE_READING: Partial<Record<string, string>> = {
  science: `${REPO}/blob/main/GAPS.md`,
  research: `${REPO}/blob/main/GAPS.md`,
  coordination: `${REPO}/issues`,
};

const BOX_ID = "offer";

function Stat({
  label,
  value,
  total,
  filled,
  sub,
}: {
  label: string;
  value: string;
  total?: string | undefined;
  filled?: number;
  sub: string;
}) {
  return (
    <div className="flex flex-col gap-3 lg:border-s lg:border-border lg:px-6 lg:first:border-s-0 lg:first:ps-0 lg:last:pe-0">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </span>
      <span className="font-display tabular text-[40px] font-semibold leading-none tracking-tight">
        {value}
        {total ? (
          <span className="text-[20px] text-faint"> / {total}</span>
        ) : null}
      </span>
      {filled !== undefined && (
        <div className="h-[3px] overflow-hidden rounded-full bg-raised">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.max(filled, filled > 0 ? 1 : 0)}%` }}
          />
        </div>
      )}
      <span className="text-xs leading-relaxed text-muted-foreground">
        {sub}
      </span>
    </div>
  );
}

function Deficit({ deficits }: { deficits: Deficits }) {
  const { t } = useTranslation();
  const missing = deficits.communesTotal - deficits.communesWithFuel;
  const unknown = t("contribute.unavailable");
  const known = (n: number) => n >= 0;

  return (
    <div className="card mt-10 grid grid-cols-1 gap-8 p-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
      <Stat
        label={t("contribute.statPlaces")}
        value={
          known(deficits.openAreasVerified)
            ? String(deficits.openAreasVerified)
            : "—"
        }
        total={
          known(deficits.openAreasTotal)
            ? deficits.openAreasTotal.toLocaleString()
            : undefined
        }
        filled={percent(deficits.openAreasVerified, deficits.openAreasTotal)}
        sub={
          !known(deficits.openAreasTotal)
            ? unknown
            : deficits.openAreasVerified > 0
              ? t("contribute.statPlacesSubSome", {
                  done: deficits.openAreasVerified,
                })
              : t("contribute.statPlacesSub")
        }
      />
      <Stat
        label={t("contribute.statFuel")}
        value={
          known(deficits.communesWithFuel)
            ? deficits.communesWithFuel.toLocaleString()
            : "—"
        }
        total={
          known(deficits.communesTotal)
            ? deficits.communesTotal.toLocaleString()
            : undefined
        }
        filled={percent(deficits.communesWithFuel, deficits.communesTotal)}
        sub={
          !known(deficits.communesTotal)
            ? unknown
            : missing > 0
              ? t("contribute.statFuelSub", {
                  missing: missing.toLocaleString(),
                })
              : t("contribute.statFuelSubDone")
        }
      />
      <Stat
        label={t("contribute.statAlerts")}
        value={
          known(deficits.deliveryReceipts)
            ? String(deficits.deliveryReceipts)
            : "—"
        }
        sub={
          known(deficits.deliveryReceipts)
            ? t("contribute.statAlertsSub")
            : unknown
        }
      />
      <Stat
        label={t("contribute.statLanguages")}
        value={String(deficits.localesShipped)}
        sub={t("contribute.statLanguagesSub")}
      />
    </div>
  );
}

function LaneGrid({
  deficits,
  onOffer,
}: {
  deficits: Deficits;
  onOffer: (lane: Lane) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {LANE_CARDS.map(({ key, Icon }) => (
        <article key={key} className="card flex flex-col gap-3 p-5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--accent-tint)] text-[var(--accent)]">
            <Icon aria-hidden className="size-[18px]" />
          </span>
          <h3 className="font-display text-[17px] font-semibold leading-snug">
            {t(`contribute.${key}Title`)}
          </h3>
          <span className="self-start rounded-md bg-[var(--accent-tint)] px-2 py-1 text-[11.5px] font-semibold tabular text-[var(--accent)]">
            {t(`contribute.${key}Deficit`, {
              verified:
                deficits.openAreasVerified >= 0
                  ? deficits.openAreasVerified.toLocaleString()
                  : "—",
              total:
                deficits.openAreasTotal >= 0
                  ? deficits.openAreasTotal.toLocaleString()
                  : "—",
            })}
          </span>
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            {t(`contribute.${key}Body`)}
          </p>
          <div className="mt-auto flex flex-col gap-2.5 border-t border-border pt-3.5">
            <span className="text-[11.5px] leading-relaxed text-faint">
              {t("contribute.asks", { what: t(`contribute.${key}Asks`) })}
            </span>
            {key === "language" ? (
              <Link
                to="/contribute/language/$locale"
                params={{ locale: "kab" }}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--accent)]"
              >
                {t(`contribute.${key}Cta`)}
                <ArrowRight aria-hidden className="size-3.5 rtl:rotate-180" />
              </Link>
            ) : LANE_READING[key] ? (
              <a
                href={LANE_READING[key]}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--accent)]"
              >
                {t(`contribute.${key}Cta`)}
                <ArrowRight aria-hidden className="size-3.5 rtl:rotate-180" />
              </a>
            ) : (
              <button
                type="button"
                onClick={() => onOffer(key)}
                className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-[var(--accent)]"
              >
                {t(`contribute.${key}Cta`)}
                <ArrowRight aria-hidden className="size-3.5 rtl:rotate-180" />
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function CodeSection() {
  const { t } = useTranslation();
  const steps = [1, 2, 3, 4] as const;
  return (
    <div className="card mt-24 flex flex-col gap-10 p-8 lg:flex-row lg:gap-14 lg:p-10">
      <div className="flex flex-col gap-3.5 lg:w-[296px] lg:shrink-0">
        <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--accent-tint)] text-[var(--accent)]">
          <Code2 aria-hidden className="size-[18px]" />
        </span>
        <h2 className="font-display text-[26px] font-semibold leading-tight">
          {t("contribute.codeTitle")}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("contribute.codeBody")}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2.5">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            {t("contribute.codeRepo")}
          </a>
          <a
            href={`${REPO}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium"
          >
            {t("contribute.codeIssues")}
          </a>
        </div>
      </div>
      <ol className="flex flex-1 flex-col">
        {steps.map((n) => (
          <li
            key={n}
            className="grid grid-cols-[26px_1fr] gap-4 border-b border-border py-3.5 last:border-b-0"
          >
            <span className="font-display tabular text-sm font-semibold text-[var(--accent)]">
              {n}
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold">
                {t(`contribute.codeStep${n}`)}
              </span>
              <span className="text-[13.5px] leading-relaxed text-muted-foreground">
                {t(`contribute.codeStep${n}Body`)}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Board() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ideas = useInfiniteQuery(publishedIdeasQuery);
  const [mine, setMine] = useState<Record<string, number>>({});
  const [voteToken, setVoteToken] = useState<string | null>(null);
  const [voteResetKey, setVoteResetKey] = useState(0);
  const voteCaptchaRequired = isTurnstileSiteKeyConfigured();

  const vote = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      const res = await fetch("/api/public/contribute/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ideaId: id,
          voterKey: readVoterKey(),
          value,
          ...(voteToken ? { turnstileToken: voteToken } : {}),
        }),
      });
      if (!res.ok) throw new Error("vote failed");
      return (await res.json()) as { ok: true; score: number };
    },
    onSuccess: (_data, variables) => {
      setVoteToken(null);
      setVoteResetKey((prev) => prev + 1);
      setMine((prev) => ({
        ...prev,
        [variables.id]:
          prev[variables.id] === variables.value ? 0 : variables.value,
      }));
      void qc.invalidateQueries({ queryKey: ["contribution-ideas"] });
    },
    onError: () => {
      setVoteToken(null);
      setVoteResetKey((prev) => prev + 1);
    },
  });

  const rows = pageRows(ideas.data);

  return (
    <section className="mt-24">
      <Eyebrow>{t("contribute.boardEyebrow")}</Eyebrow>
      <div className="mt-2.5 flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-2.5">
          <h2 className="font-display text-[30px] font-semibold leading-tight">
            {t("contribute.boardTitle")}
          </h2>
          <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
            {t("contribute.boardLede")}
          </p>
        </div>
        {rows.length > 0 ? (
          <span className="whitespace-nowrap text-[13px] text-muted-foreground">
            {t("contribute.boardSorted")}
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="card mt-6 flex flex-col items-center gap-3 border-dashed p-12 text-center">
          <h3 className="font-display text-[19px] font-semibold">
            {t("contribute.boardEmptyTitle")}
          </h3>
          <p className="max-w-[46ch] text-sm leading-relaxed text-muted-foreground">
            {t("contribute.boardEmptyBody")}
          </p>
        </div>
      ) : (
        <>
          <TurnstileWidget
            action="contribute_vote"
            compact
            resetKey={voteResetKey}
            onVerify={(token) => setVoteToken(token)}
            onExpire={() => setVoteToken(null)}
            onError={() => setVoteToken(null)}
            className="mt-4"
          />
          <ul className="mt-6 flex flex-col gap-3">
            {rows.map((idea) => {
              const voted = mine[idea.id] ?? 0;
              return (
                <li key={idea.id} className="card flex items-start gap-5 p-5">
                  <div className="flex w-11 shrink-0 flex-col items-center">
                    <button
                      type="button"
                      aria-label={t("contribute.voteUp")}
                      disabled={
                        vote.isPending || (voteCaptchaRequired && !voteToken)
                      }
                      onClick={() => vote.mutate({ id: idea.id, value: 1 })}
                      className="rounded-md p-1.5 text-faint transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <ThumbsUp
                        aria-hidden
                        className={cn(
                          "size-4",
                          voted === 1 && "text-[var(--accent)]",
                        )}
                      />
                    </button>
                    <span className="font-display tabular text-lg font-semibold">
                      {idea.score}
                    </span>
                    <button
                      type="button"
                      aria-label={t("contribute.voteDown")}
                      disabled={
                        vote.isPending || (voteCaptchaRequired && !voteToken)
                      }
                      onClick={() => vote.mutate({ id: idea.id, value: -1 })}
                      className="rounded-md p-1.5 text-faint transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <ThumbsDown
                        aria-hidden
                        className={cn(
                          "size-4",
                          voted === -1 && "text-[var(--accent)]",
                        )}
                      />
                    </button>
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <p className="text-[15px] font-medium leading-relaxed">
                      {idea.message}
                    </p>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="rounded-md bg-[var(--accent-tint)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                        {t(`contribute.lane${cap(idea.lane)}`)}
                      </span>
                      {voted !== 0 ? (
                        <span className="text-xs font-medium text-[var(--accent)]">
                          {t("contribute.voted")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <LoadMore query={ideas} />
        </>
      )}

      <p className="mt-4 text-xs leading-relaxed text-faint">
        {t("contribute.voteNote")}
      </p>
    </section>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function IdeaBox({
  lane,
  setLane,
}: {
  lane: string;
  setLane: (lane: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState("");
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const captchaRequired = isTurnstileSiteKeyConfigured();

  const submit = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/public/contribute/idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lane,
          message,
          contact: contact || null,
          locale: i18n.language as Locale,
          website,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        reason?: string;
      };
      if (!body.ok) throw new Error(body.reason ?? "failed");
      return body;
    },
    onSuccess: () => {
      setSent(true);
      setError(null);
      setTurnstileToken(null);
      setTurnstileResetKey((prev) => prev + 1);
    },
    onError: (e: Error) => {
      setTurnstileToken(null);
      setTurnstileResetKey((prev) => prev + 1);
      setError(
        e.message === "rateLimited"
          ? t("contribute.errRateLimited")
          : e.message === "captcha"
            ? t("turnstile.failed")
            : t("contribute.errFailed"),
      );
    },
  });

  const short = message.trim().length < IDEA_MIN;
  const showShort = touched && short;

  if (sent) {
    return (
      <div className="card mt-10 flex flex-col gap-4 p-8 lg:p-10">
        <h2 className="font-display text-[26px] font-semibold">
          {t("contribute.sentTitle")}
        </h2>
        <p className="max-w-[56ch] text-sm leading-relaxed text-muted-foreground">
          {t("contribute.sentBody")}
        </p>
        {!contact ? (
          <p className="max-w-[56ch] text-[13px] leading-relaxed text-faint">
            {t("contribute.sentNoContact")}
          </p>
        ) : null}
        <button
          type="button"
          className="self-start text-sm font-medium text-[var(--accent)] underline underline-offset-4"
          onClick={() => {
            setSent(false);
            setMessage("");
            setContact("");
            setTouched(false);
          }}
        >
          {t("contribute.sentAnother")}
        </button>
      </div>
    );
  }

  return (
    <div
      id={BOX_ID}
      className="card mt-10 flex scroll-mt-20 flex-col gap-10 p-8 lg:flex-row lg:gap-14 lg:p-10"
    >
      <div className="flex flex-col gap-3.5 lg:w-[296px] lg:shrink-0">
        <h2 className="font-display text-[26px] font-semibold leading-tight">
          {t("contribute.boxTitle")}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("contribute.boxBody")}
        </p>
      </div>

      <form
        className="flex flex-1 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (short) return;
          if (captchaRequired && !turnstileToken) return;
          submit.mutate();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium">
            {t("contribute.fieldLane")}
          </span>
          <div className="relative">
            <select
              value={lane}
              onChange={(e) => setLane(e.target.value)}
              className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 text-[13.5px]"
            >
              {LANES.map((l) => (
                <option key={l} value={l}>
                  {t(`contribute.lane${cap(l)}`)}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium">
            {t("contribute.fieldMessage")}
          </span>
          <textarea
            value={message}
            maxLength={IDEA_MAX}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("contribute.fieldMessagePlaceholder")}
            className={cn(
              "min-h-24 rounded-md border border-border bg-background p-3 text-[13.5px] leading-relaxed",
              showShort && "border-[var(--emergency)]",
            )}
          />
          <div className="flex min-h-4 items-center justify-between gap-3">
            <span className="text-xs text-[var(--emergency)]">
              {showShort ? t("contribute.errTooShort") : ""}
            </span>
            <span className="tabular text-xs text-faint">
              {message.trim().length > 0
                ? t("contribute.counter", { count: message.trim().length })
                : ""}
            </span>
          </div>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium">
            {t("contribute.fieldContact")}{" "}
            <span className="font-normal text-faint">
              — {t("contribute.fieldOptional")}
            </span>
          </span>
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={t("contribute.fieldContactPlaceholder")}
            className="h-10 rounded-md border border-border bg-background px-3 text-[13.5px]"
          />
          <span className="text-xs text-faint">
            {t("contribute.fieldContactHelp")}
          </span>
        </label>

        {/* A real person never sees this field; a bot fills every input it finds. */}
        <input
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="absolute -left-[9999px] size-0"
        />

        <TurnstileWidget
          action="contribute_idea"
          resetKey={turnstileResetKey}
          onVerify={(token) => setTurnstileToken(token)}
          onExpire={() => setTurnstileToken(null)}
          onError={() => setTurnstileToken(null)}
        />

        {error ? (
          <p className="text-[13px] text-[var(--emergency)]">{error}</p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
          <span className="max-w-[46ch] text-xs leading-relaxed text-faint">
            {t("contribute.inboxNotice")}
          </span>
          <button
            type="submit"
            disabled={submit.isPending || (captchaRequired && !turnstileToken)}
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {submit.isPending
              ? t("contribute.submitting")
              : t("contribute.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Eyebrow({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
        {children}
      </span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

function ContributePage() {
  const { t, i18n } = useTranslation();
  const deficits = Route.useLoaderData();
  const [lane, setLane] = useState<string>("other");

  const measured = new Date(deficits.measuredAt).toLocaleDateString(
    i18n.language,
    { day: "numeric", month: "long", year: "numeric" },
  );

  const offer = (picked: Lane) => {
    setLane(picked);
    document
      .getElementById(BOX_ID)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="mx-auto max-w-[1160px] px-5 pb-20">
      <header className="flex flex-col gap-5 pt-16">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="h-px w-5 bg-[var(--accent)]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
            {t("contribute.eyebrow")}
          </span>
        </div>
        <h1 className="max-w-[16ch] font-display text-[clamp(34px,6vw,58px)] font-semibold leading-[1.04]">
          {t("contribute.title")}
        </h1>
        <p className="max-w-[62ch] text-[17px] leading-relaxed text-muted-foreground">
          {t("contribute.lede")}
        </p>
      </header>

      <Deficit deficits={deficits} />

      <p className="mt-3.5 flex items-center gap-2 text-xs text-faint">
        <Clock aria-hidden className="size-3.5" />
        {t("contribute.measuredAt", { date: measured })}
      </p>

      <section className="mt-24">
        <Eyebrow>{t("contribute.lanesEyebrow")}</Eyebrow>
        <h2 className="mt-2.5 font-display text-[30px] font-semibold leading-tight">
          {t("contribute.lanesTitle")}
        </h2>
        <p className="mt-2 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          {t("contribute.lanesLede")}
        </p>
        <LaneGrid deficits={deficits} onOffer={offer} />
      </section>

      <CodeSection />
      <Board />
      <IdeaBox lane={lane} setLane={setLane} />

      <section className="mt-20 flex flex-col gap-10 lg:flex-row lg:gap-14">
        <h2 className="font-display text-lg font-semibold leading-snug lg:w-[296px] lg:shrink-0">
          {t("contribute.rulesTitle")}
        </h2>
        <div className="flex flex-1 flex-col gap-4">
          <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
            {t("contribute.rulesBody")}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] font-medium text-[var(--accent)]">
            <a
              href={`${REPO}/blob/main/CONTEXT.md`}
              target="_blank"
              rel="noreferrer"
            >
              {t("contribute.linkGlossary")}
            </a>
            <a
              href={`${REPO}/blob/main/docs/adr/0002-nadhir-informs-authorities-direct.md`}
              target="_blank"
              rel="noreferrer"
            >
              {t("contribute.linkAdr2")}
            </a>
            <a
              href={`${REPO}/blob/main/docs/adr/0003-no-routing-without-spread-and-road-status.md`}
              target="_blank"
              rel="noreferrer"
            >
              {t("contribute.linkAdr3")}
            </a>
            <a
              href={`${REPO}/blob/main/CONTRIBUTING.md`}
              target="_blank"
              rel="noreferrer"
            >
              {t("contribute.linkContributing")}
            </a>
          </div>
        </div>
      </section>

      <div className="mt-10">
        <EmergencyNumbers />
      </div>
    </div>
  );
}
