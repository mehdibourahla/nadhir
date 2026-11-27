import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Pencil,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  REVIEWABLE,
  SUGGESTION_MAX,
  countSubmittable,
  groupRows,
  isSubmittable,
  markSent,
  readDrafts,
  readReviewerKey,
  rowsFor,
  summarise,
  writeDrafts,
  type Draft,
  type DraftMap,
  type MyStatus,
  type MyStatusMap,
  type ReviewableLocale,
  type StringRow,
} from "@/lib/translate";
import { cn } from "@/lib/utils";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { isTurnstileSiteKeyConfigured } from "@/lib/turnstile";
import { titledMeta } from "@/lib/page-meta";
import { headTranslator } from "@/i18n";

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
  component: ReviewPage,
});

type Filter = "all" | "todo" | "changed" | "confirmed" | "mine";

function StatusBadge({ status }: { status: MyStatus | undefined }) {
  const { t } = useTranslation();
  if (!status) return null;
  const tone =
    status.status === "accepted"
      ? "bg-[var(--accent-tint)] text-[var(--accent)]"
      : status.status === "rejected"
        ? "bg-muted text-muted-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span className="flex flex-col gap-1">
      <span
        className={cn(
          "self-start rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
          tone,
        )}
      >
        {t(`translate.status_${status.status}`)}
      </span>
      {status.moderationNote ? (
        <span className="text-[11.5px] leading-relaxed text-faint">
          {status.moderationNote}
        </span>
      ) : null}
    </span>
  );
}

function Row({
  row,
  draft,
  status,
  rtl,
  onChange,
}: {
  row: StringRow;
  draft: Draft | undefined;
  status: MyStatus | undefined;
  rtl: boolean;
  onChange: (next: Draft | undefined) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sent = draft?.sent === true;
  const suggesting = !sent && (open || draft?.verdict === "suggested");
  const confirmed = !sent && draft?.verdict === "confirmed";

  return (
    <li
      className={cn(
        "grid gap-3 border-b border-border px-4 py-4 last:border-b-0 md:grid-cols-[1fr_1fr_auto] md:items-start md:gap-5",
        confirmed && "bg-[var(--accent-tint)]/40",
        sent && "bg-muted/30",
      )}
    >
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10.5px] leading-none text-faint">
          {row.path}
        </span>
        <span dir="ltr" className="text-[13.5px] leading-relaxed">
          {row.source}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span
          dir={rtl ? "rtl" : "ltr"}
          className={cn(
            "text-[13.5px] leading-relaxed",
            suggesting ? "text-faint line-through" : "text-muted-foreground",
          )}
        >
          {row.current || "—"}
        </span>

        {sent ? (
          <div className="flex flex-col gap-1.5">
            {draft?.verdict === "suggested" ? (
              <span
                dir={rtl ? "rtl" : "ltr"}
                className="text-[13.5px] font-medium leading-relaxed"
              >
                {draft.suggestion}
              </span>
            ) : (
              <span className="text-[13px] text-muted-foreground">
                {t("translate.youConfirmed")}
              </span>
            )}
            <StatusBadge status={status} />
          </div>
        ) : null}

        {suggesting ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              autoFocus={open && !draft}
              dir={rtl ? "rtl" : "ltr"}
              maxLength={SUGGESTION_MAX}
              value={draft?.suggestion ?? ""}
              onChange={(e) =>
                onChange({ verdict: "suggested", suggestion: e.target.value })
              }
              placeholder={t("translate.suggestionPlaceholder")}
              className="min-h-16 w-full rounded-md border border-[var(--accent)] bg-background p-2.5 text-[13.5px] leading-relaxed"
            />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onChange(undefined);
              }}
              className="self-start text-xs text-muted-foreground underline underline-offset-2"
            >
              {t("translate.discard")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 md:flex-col md:items-stretch">
        {!sent ? (
          <button
            type="button"
            aria-pressed={confirmed}
            onClick={() =>
              onChange(confirmed ? undefined : { verdict: "confirmed" })
            }
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
              confirmed
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <Check aria-hidden className="size-3.5" />
            {t("translate.looksRight")}
          </button>
        ) : null}
        {!suggesting ? (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              onChange({ verdict: "suggested", suggestion: row.current });
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Pencil aria-hidden className="size-3.5" />
            {sent ? t("translate.revise") : t("translate.suggest")}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function ReviewPage() {
  const { t } = useTranslation();
  const locale = Route.useParams().locale as ReviewableLocale;
  const rtl = locale === "ar";

  const rows = useMemo(() => rowsFor(locale), [locale]);
  const [drafts, setDrafts] = useState<DraftMap>(() => readDrafts(locale));
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [name, setName] = useState("");
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<MyStatusMap>({});

  const loadStatuses = useCallback(async () => {
    const reviewerKey = readReviewerKey();
    if (!reviewerKey) return;
    try {
      const res = await fetch("/api/public/contribute/my-translations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, reviewerKey }),
      });
      const body = (await res.json()) as {
        rows: {
          keyPath: string;
          status: string;
          moderationNote: string | null;
          suggestion: string | null;
        }[];
      };
      const map: MyStatusMap = {};
      for (const row of body.rows ?? []) {
        map[row.keyPath] = {
          status: row.status as MyStatus["status"],
          suggestion: row.suggestion,
          moderationNote: row.moderationNote,
        };
      }
      setStatuses(map);
    } catch {
      // no statuses is a quieter failure than a broken page
    }
  }, [locale]);

  useEffect(() => {
    void loadStatuses();
  }, [loadStatuses]);

  const update = (path: string, next: Draft | undefined) => {
    setDrafts((prev) => {
      const copy = { ...prev };
      if (next) copy[path] = next;
      else delete copy[path];
      writeDrafts(locale, copy);
      return copy;
    });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const draft = drafts[row.path];
      if (filter === "todo" && draft) return false;
      if (filter === "mine" && !draft?.sent) return false;
      if (filter === "changed" && draft?.verdict !== "suggested") return false;
      if (filter === "confirmed" && draft?.verdict !== "confirmed")
        return false;
      if (!q) return true;
      return (
        row.source.toLowerCase().includes(q) ||
        row.current.toLowerCase().includes(q) ||
        row.path.toLowerCase().includes(q)
      );
    });
  }, [rows, drafts, filter, query]);

  const groups = useMemo(() => groupRows(visible), [visible]);
  const currentFor = useMemo(() => {
    const byPath = new Map(rows.map((r) => [r.path, r.current]));
    return (path: string) => byPath.get(path);
  }, [rows]);

  const pending = countSubmittable(drafts, currentFor);
  const reviewed = Object.keys(drafts).length;
  const tally = summarise(drafts, statuses);

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const captchaRequired = isTurnstileSiteKeyConfigured();

  const submit = useMutation({
    mutationFn: async () => {
      const payload = Object.entries(drafts)
        .filter(([path, d]) => isSubmittable(d, currentFor(path)))
        .map(([path, d]) => {
          const row = rows.find((r) => r.path === path);
          return {
            keyPath: path,
            sourceText: row?.source ?? "",
            currentText: row?.current ?? "",
            suggestion: d.suggestion ?? null,
            verdict: d.verdict,
            note: d.note ?? null,
          };
        });
      const res = await fetch("/api/public/contribute/translation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          reviewerKey: readReviewerKey(),
          reviewerName: name || null,
          rows: payload,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        saved?: number;
        reason?: string;
      };
      if (!body.ok) throw new Error(body.reason ?? "failed");
      return body.saved ?? 0;
    },
    onSuccess: (saved) => {
      setSent(saved);
      setError(null);
      setTurnstileToken(null);
      setTurnstileResetKey((prev) => prev + 1);
      // marked rather than deleted: the reviewer must still see what they sent
      setDrafts((prev) => {
        const next = markSent(prev, currentFor);
        writeDrafts(locale, next);
        return next;
      });
      void loadStatuses();
    },
    onError: (e: Error) => {
      setTurnstileToken(null);
      setTurnstileResetKey((prev) => prev + 1);
      setError(
        e.message === "rateLimited"
          ? t("translate.errRateLimited")
          : e.message === "captcha"
            ? t("turnstile.failed")
            : t("translate.errFailed"),
      );
    },
  });

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: t("translate.filterAll") },
    { key: "todo", label: t("translate.filterTodo") },
    { key: "changed", label: t("translate.filterChanged") },
    { key: "confirmed", label: t("translate.filterConfirmed") },
    { key: "mine", label: t("translate.filterMine") },
  ];

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-44 pt-10 lg:pb-32">
      <Link
        to="/contribute"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3.5 rtl:rotate-180" />
        {t("translate.back")}
      </Link>

      <header className="mt-5 flex flex-col gap-4">
        <h1 className="font-display text-[clamp(28px,5vw,40px)] font-semibold leading-tight">
          {t("translate.title", { language: t(`translate.lang_${locale}`) })}
        </h1>
        <p className="max-w-[68ch] text-[15px] leading-relaxed text-muted-foreground">
          {t("translate.lede")}
        </p>
      </header>

      <div className="card mt-7 flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-sm font-medium">
            {t("translate.progress", { done: reviewed, total: rows.length })}
          </span>
          <span className="tabular text-xs text-faint">
            {Math.round((reviewed / rows.length) * 100)}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-raised">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${(reviewed / rows.length) * 100}%` }}
          />
        </div>
        {tally.reviewed > 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs">
            {tally.accepted > 0 ? (
              <span className="font-medium text-[var(--accent)]">
                {t("translate.tallyAccepted", { count: tally.accepted })}
              </span>
            ) : null}
            {tally.awaiting > 0 ? (
              <span className="text-muted-foreground">
                {t("translate.tallyAwaiting", { count: tally.awaiting })}
              </span>
            ) : null}
            {tally.rejected > 0 ? (
              <span className="text-muted-foreground">
                {t("translate.tallyRejected", { count: tally.rejected })}
              </span>
            ) : null}
            {tally.unsent > 0 ? (
              <span className="text-muted-foreground">
                {t("translate.tallyUnsent", { count: tally.unsent })}
              </span>
            ) : null}
          </div>
        ) : null}

        <p className="text-xs leading-relaxed text-faint">
          {tally.reviewed > tally.unsent
            ? t("translate.sentKept")
            : t("translate.draftNote")}
        </p>
      </div>

      <div className="sticky top-14 z-10 -mx-5 mt-6 flex flex-wrap items-center gap-2 border-b border-border bg-ground/95 px-5 py-3 backdrop-blur">
        <div className="relative flex-1 md:max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint"
          />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenGroups({});
            }}
            placeholder={t("translate.search")}
            className="h-9 w-full rounded-md border border-border bg-background ps-9 pe-3 text-[13.5px]"
          />
        </div>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              filter === f.key
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">
          {t("translate.noMatches")}
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {groups.map((group) => {
            const collapsed = !(openGroups[group.key] ?? query.trim() !== "");
            const done = group.rows.filter((r) => drafts[r.path]).length;
            return (
              <section key={group.key} className="card overflow-hidden">
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((p) => ({ ...p, [group.key]: collapsed }))
                  }
                  aria-expanded={!collapsed}
                  className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-muted"
                >
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      collapsed && "-rotate-90 rtl:rotate-90",
                    )}
                  />
                  <span className="flex flex-col">
                    <span className="font-display text-[15px] font-semibold">
                      {t(`translate.group_${group.key}`)}
                    </span>
                    <span className="font-mono text-[10.5px] text-faint">
                      {group.key}
                    </span>
                  </span>
                  <span className="tabular ms-auto text-xs text-muted-foreground">
                    {done} / {group.rows.length}
                  </span>
                </button>
                {!collapsed ? (
                  <ul className="border-t border-border">
                    {group.rows.map((row) => (
                      <Row
                        key={row.path}
                        row={row}
                        draft={drafts[row.path]}
                        status={statuses[row.path]}
                        rtl={rtl}
                        onChange={(next) => update(row.path, next)}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {/* bottom-14 clears the 56px mobile tab bar, which is lg:hidden and covers Send */}
      {pending > 0 || sent > 0 ? (
        <div className="fixed inset-x-0 bottom-14 z-20 border-t border-border bg-surface/95 backdrop-blur lg:bottom-0">
          <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2 px-5 py-3 sm:gap-3">
            {sent > 0 ? (
              <>
                <Check aria-hidden className="size-4 text-[var(--accent)]" />
                <span className="text-sm">
                  {t("translate.sent", { count: sent })}
                </span>
                <button
                  type="button"
                  onClick={() => setSent(0)}
                  className="ms-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                  aria-label={t("common.dismiss")}
                >
                  <X aria-hidden className="size-4" />
                </button>
              </>
            ) : (
              <>
                <span className="order-1 text-sm font-medium">
                  {t("translate.pending", { count: pending })}
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("translate.namePlaceholder")}
                  className="order-3 h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-[13px] sm:order-2 sm:w-40 sm:flex-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setDrafts({});
                    writeDrafts(locale, {});
                  }}
                  aria-label={t("translate.clear")}
                  title={t("translate.clear")}
                  className="order-4 inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground sm:order-3"
                >
                  <RotateCcw aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={
                    submit.isPending || (captchaRequired && !turnstileToken)
                  }
                  onClick={() => submit.mutate()}
                  className="order-2 ms-auto inline-flex min-h-11 shrink-0 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-60 sm:order-4"
                >
                  {submit.isPending
                    ? t("translate.sending")
                    : t("translate.send")}
                </button>
              </>
            )}
          </div>
          {pending > 0 && sent === 0 ? (
            <div className="mx-auto max-w-[1100px] px-5 pb-2">
              <TurnstileWidget
                action="contribute_translation"
                compact
                resetKey={turnstileResetKey}
                onVerify={(token) => setTurnstileToken(token)}
                onExpire={() => setTurnstileToken(null)}
                onError={() => setTurnstileToken(null)}
              />
            </div>
          ) : null}
          {error ? (
            <p className="mx-auto max-w-[1100px] px-5 pb-3 text-[13px] text-[var(--emergency)]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
