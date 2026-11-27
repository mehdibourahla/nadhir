import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  MessageSquare,
  Send,
  ShieldOff,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  ideaCountsQuery,
  ideaQueueQuery,
  moderateIdea,
  replyToIdea,
  type ContributionIdea,
  type IdeaStatus,
  type ReplyAuthorKind,
} from "@/lib/contribute";
import { cn } from "@/lib/utils";
import {
  ADMIN_TONE_BAR,
  AdminBadge,
  AdminFilterTabs,
  AdminHeader,
  AdminQueryState,
  AdminSplitWorkbench,
  AdminWhen,
  type AdminTone,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import { AtlasButton, AtlasSelect, AtlasTextarea } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/ideas")({
  component: IdeasPage,
});

const IDEA_STATUSES: IdeaStatus[] = [
  "pending",
  "published",
  "rejected",
  "spam",
];

function ideaTone(status: IdeaStatus): AdminTone {
  if (status === "published") return "ok";
  if (status === "pending") return "warn";
  if (status === "spam") return "bad";
  return "neutral";
}

function ideaStatusLabel(status: IdeaStatus, t: (k: string) => string): string {
  if (status === "pending") return t("queues.filterPending");
  if (status === "published") return t("queues.filterPublished");
  if (status === "rejected") return t("queues.filterRejected");
  return t("queues.filterSpam");
}

function ideaLaneLabel(lane: string, lang: string): string {
  const map: Record<string, { ar: string; fr: string; en: string }> = {
    local: { ar: "محلي", fr: "Local", en: "Local" },
    audio: { ar: "صوتي", fr: "Audio", en: "Audio" },
    institutional: { ar: "مؤسسي", fr: "Institutionnel", en: "Institutional" },
    science: { ar: "علمي", fr: "Science", en: "Science" },
    language: { ar: "لغات", fr: "Langues", en: "Language" },
    code: { ar: "تقني", fr: "Technique", en: "Code" },
    other: { ar: "أخرى", fr: "Autre", en: "Other" },
  };
  const e = map[lane];
  if (!e) return lane;
  return lang === "ar" ? e.ar : lang === "fr" ? e.fr : e.en;
}

function IdeaInspector({
  idea,
  onDone,
}: {
  idea: ContributionIdea;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation("admin");
  const lang = i18n.language || "en";
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [authorKind, setAuthorKind] = useState<ReplyAuthorKind>("person");

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["contribution-ideas"] }),
      qc.invalidateQueries({ queryKey: ["admin", "attention"] }),
    ]);

  const modMut = useMutation({
    mutationFn: (status: IdeaStatus) => moderateIdea(idea.id, status),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("sources.saved"));
      onDone();
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  const replyMut = useMutation({
    mutationFn: () => replyToIdea(idea.id, reply.trim(), authorKind),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("sources.saved"));
      setReply("");
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <AdminBadge tone={ideaTone(idea.status)} dot>
          {ideaStatusLabel(idea.status, t)}
        </AdminBadge>
        <AdminBadge tone="info">{ideaLaneLabel(idea.lane, lang)}</AdminBadge>
        <AdminBadge tone="neutral">
          {idea.contact ? t("queues.contactLeft") : t("queues.noContact")}
        </AdminBadge>
        <span className="ms-auto text-xs text-ink-muted">
          <AdminWhen at={idea.created_at} />
        </span>
      </div>

      <div className="rounded-xl border border-hairline bg-canvas/60 p-4 text-sm text-ink leading-relaxed whitespace-pre-wrap">
        {cleanCopy(idea.message)}
      </div>

      {idea.contact && (
        <div className="rounded-lg border border-hairline bg-surface-raised/60 px-3 py-2 font-mono text-xs text-ink">
          {cleanCopy(idea.contact)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
        {idea.status !== "published" && (
          <AtlasButton
            variant="primary"
            size="sm"
            disabled={modMut.isPending}
            onClick={() => modMut.mutate("published")}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("queues.publish")}
          </AtlasButton>
        )}
        {idea.status === "published" && (
          <AtlasButton
            variant="secondary"
            size="sm"
            disabled={modMut.isPending}
            onClick={() => modMut.mutate("pending")}
          >
            {t("queues.unpublish")}
          </AtlasButton>
        )}
        {idea.status !== "rejected" && (
          <AtlasButton
            variant="secondary"
            size="sm"
            disabled={modMut.isPending}
            onClick={() => modMut.mutate("rejected")}
          >
            <XCircle className="h-3.5 w-3.5 text-hazard-extreme" />
            {t("queues.reject")}
          </AtlasButton>
        )}
        {idea.status !== "spam" && (
          <AtlasButton
            variant="danger"
            size="sm"
            disabled={modMut.isPending}
            onClick={() => modMut.mutate("spam")}
          >
            <ShieldOff className="h-3.5 w-3.5" />
            {t("queues.spam")}
          </AtlasButton>
        )}
      </div>

      <div className="space-y-3 border-t border-hairline pt-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-ink">
          <MessageSquare className="h-3.5 w-3.5 text-signal" />
          <span>{t("queues.replyLabel")}</span>
        </div>
        <AtlasTextarea
          rows={3}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AtlasSelect
            aria-label={t("queues.replyAuthor")}
            value={authorKind}
            onChange={(e) => setAuthorKind(e.target.value as ReplyAuthorKind)}
            className="w-48"
          >
            <option value="person">{t("queues.repliedByPerson")}</option>
            <option value="agent">{t("queues.repliedByAgent")}</option>
          </AtlasSelect>
          <AtlasButton
            variant="primary"
            size="sm"
            disabled={replyMut.isPending || !reply.trim()}
            onClick={() => replyMut.mutate()}
          >
            <Send className="h-3.5 w-3.5" />
            {t("queues.replySend")}
          </AtlasButton>
        </div>
      </div>
    </div>
  );
}

function IdeasPage() {
  const { t, i18n } = useTranslation("admin");
  const lang = i18n.language || "en";
  const [status, setStatus] = useState<IdeaStatus>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const countsQ = useQuery(ideaCountsQuery);
  const queueQ = useInfiniteQuery(ideaQueueQuery(status));
  const selected = queueQ.data?.find((i) => i.id === selectedId) ?? null;

  const labels: Record<IdeaStatus, string> = {
    pending: t("queues.filterPending"),
    published: t("queues.filterPublished"),
    rejected: t("queues.filterRejected"),
    spam: t("queues.filterSpam"),
  };

  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.review")}
        title={t("ideasPage.title")}
        description={t("ideasPage.description")}
      />

      <div className="mb-5">
        <AdminFilterTabs
          value={status}
          onChange={(next) => {
            setStatus(next);
            setSelectedId(null);
          }}
          options={IDEA_STATUSES.map((s) => ({
            value: s,
            label: labels[s],
            count: countsQ.data?.[s],
          }))}
        />
      </div>

      <AdminQueryState
        query={queueQ}
        isEmpty={(rows) => rows.length === 0}
        empty={t("queues.ideasEmpty")}
      >
        {(rows) => (
          <AdminSplitWorkbench
            detailTitle={t("ideasPage.title")}
            placeholder={t("kit.empty")}
            onClose={() => setSelectedId(null)}
            detail={
              selected ? (
                <IdeaInspector
                  key={selected.id}
                  idea={selected}
                  onDone={() => setSelectedId(null)}
                />
              ) : null
            }
            list={
              <ul className="space-y-2">
                {rows.map((idea) => {
                  const tone = ideaTone(idea.status);
                  const active = idea.id === selectedId;
                  return (
                    <li key={idea.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(idea.id)}
                        className={cn(
                          "flex w-full items-stretch overflow-hidden rounded-xl border text-start transition-colors cursor-pointer",
                          active
                            ? "border-signal bg-signal-soft/40"
                            : "border-hairline bg-surface hover:border-hairline-strong",
                        )}
                      >
                        <span
                          className={cn("w-1 shrink-0", ADMIN_TONE_BAR[tone])}
                        />
                        <div className="flex-1 px-3.5 py-3 space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <AdminBadge tone="info">
                              {ideaLaneLabel(idea.lane, lang)}
                            </AdminBadge>
                            <span className="ms-auto text-[11px] text-ink-muted">
                              <AdminWhen at={idea.created_at} />
                            </span>
                          </div>
                          <div className="line-clamp-2 text-sm text-ink">
                            {cleanCopy(idea.message)}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            }
          />
        )}
      </AdminQueryState>
    </section>
  );
}
