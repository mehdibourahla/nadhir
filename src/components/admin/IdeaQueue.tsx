import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Locale } from "@/i18n";
import {
  ideaQueueQuery,
  moderateIdea,
  replyToIdea,
  type IdeaStatus,
  type ReplyAuthorKind,
  ideaCountsQuery,
} from "@/lib/contribute";
import { relativeTime } from "@/lib/nadhir";
import { LoadMore } from "@/components/LoadMore";

function laneKey(lane: string) {
  return `contribute.lane${lane.charAt(0).toUpperCase()}${lane.slice(1)}`;
}

export function IdeaQueue({ locale }: { locale: Locale }) {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [filter, setFilter] = useState<IdeaStatus>("pending");
  const queue = useInfiniteQuery(ideaQueueQuery(filter));
  const counts = useQuery(ideaCountsQuery);

  const act = useMutation({
    mutationFn: ({ id, status }: { id: string; status: IdeaStatus }) =>
      moderateIdea(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contribution-ideas"] }),
  });

  const rows = queue.data ?? [];
  const countOf = (s: IdeaStatus) => counts.data?.[s] ?? 0;

  const filters: { key: IdeaStatus; label: string }[] = [
    { key: "pending", label: t("queues.filterPending") },
    { key: "published", label: t("queues.filterPublished") },
    { key: "rejected", label: t("queues.filterRejected") },
    { key: "spam", label: t("queues.filterSpam") },
  ];

  return (
    <section className="mt-4">
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={
              filter === f.key
                ? "rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                : "rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground"
            }
          >
            {f.label} ({countOf(f.key)})
          </button>
        ))}
      </div>

      {queue.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {t("queues.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {t("queues.ideasEmpty")}
        </p>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {rows.map((idea) => (
              <li key={idea.id} className="card flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-md bg-[var(--accent-tint)] px-2 py-0.5 font-semibold text-[var(--accent)]">
                    {t(laneKey(idea.lane))}
                  </span>
                  <span>{relativeTime(idea.created_at, locale)}</span>
                  <span aria-hidden>·</span>
                  <span>
                    {idea.contact
                      ? t("queues.contactLeft")
                      : t("queues.noContact")}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{idea.locale}</span>
                </div>

                <p className="whitespace-pre-line text-sm leading-relaxed">
                  {idea.message}
                </p>

                {idea.contact ? (
                  <p className="text-xs text-muted-foreground">
                    {idea.contact}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  {idea.status === "published" ? (
                    <button
                      type="button"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({ id: idea.id, status: "pending" })
                      }
                      className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      {t("queues.unpublish")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({ id: idea.id, status: "published" })
                      }
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {t("queues.publish")}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={act.isPending}
                    onClick={() =>
                      act.mutate({ id: idea.id, status: "rejected" })
                    }
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-[var(--emergency)] disabled:opacity-50"
                  >
                    {t("queues.reject")}
                  </button>
                  <button
                    type="button"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ id: idea.id, status: "spam" })}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-[var(--emergency)] disabled:opacity-50"
                  >
                    {t("queues.spam")}
                  </button>
                </div>
                <IdeaReply idea={idea} locale={locale} />
              </li>
            ))}
          </ul>
          <LoadMore query={queue} />
        </>
      )}
    </section>
  );
}

function IdeaReply({
  idea,
  locale,
}: {
  idea: {
    id: string;
    reply: string | null;
    replied_at: string | null;
    reply_author_kind: ReplyAuthorKind | null;
  };
  locale: Locale;
}) {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<ReplyAuthorKind>("person");

  const send = useMutation({
    mutationFn: () => replyToIdea(idea.id, draft, kind),
    onSuccess: () => {
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["contribution-ideas"] });
    },
  });

  if (idea.reply) {
    return (
      <p className="rounded-md border border-border bg-muted/40 p-3 text-xs">
        <span className="font-medium">
          {idea.reply_author_kind === "agent"
            ? t("queues.repliedByAgent")
            : t("queues.repliedByPerson")}
        </span>{" "}
        <span className="text-muted-foreground">
          {relativeTime(idea.replied_at ?? "", locale)}
        </span>
        <br />
        {idea.reply}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        className="text-xs text-muted-foreground"
        htmlFor={`reply-${idea.id}`}
      >
        {t("queues.replyLabel")}
      </label>
      <textarea
        id={`reply-${idea.id}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-border bg-background p-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("queues.replyAuthor")}
          value={kind}
          onChange={(e) => setKind(e.target.value as ReplyAuthorKind)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="person">{t("queues.repliedByPerson")}</option>
          <option value="agent">{t("queues.repliedByAgent")}</option>
        </select>
        <button
          type="button"
          disabled={send.isPending || draft.trim().length === 0}
          onClick={() => send.mutate()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {t("queues.replySend")}
        </button>
        {send.isError ? (
          <span className="text-xs text-[var(--emergency)]">
            {(send.error as Error).message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
