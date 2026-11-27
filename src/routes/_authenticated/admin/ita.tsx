import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, RefreshCw, Send, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";

import type { AnyLocale } from "@/i18n";
import { attentionQuery, attentionTotal } from "@/lib/admin-attention";
import {
  civilAttentionQuery,
  dismissCivilInvestigation,
  itaReportsQuery,
  retryItaReport,
  type CivilAttention,
} from "@/lib/admin-ita";
import type { CivilHazard, CivilPublication } from "@/lib/civil-publication";
import {
  civilPublicationsQuery,
  publishItaPublication,
  reviseCivilPublication,
} from "@/lib/civil-publication-client";
import { adminUnitsQuery, unitName } from "@/lib/nadhir";
import { cn } from "@/lib/utils";
import {
  ADMIN_TONE_BAR,
  AdminBadge,
  AdminConfirmDialog,
  AdminFilterTabs,
  AdminHeader,
  AdminQueryState,
  AdminSplitWorkbench,
  AdminWhen,
  type AdminTone,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import {
  AtlasButton,
  AtlasInput,
  AtlasPanel,
  AtlasSelect,
  AtlasTextarea,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/ita")({
  component: ItaPage,
});

const CIVIL_HAZARDS: CivilHazard[] = [
  "fire",
  "weather",
  "flood",
  "road",
  "other",
];

function defaultExpiresInput(): string {
  const d = new Date(Date.now() + 12 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ItaQueueInspector({
  work,
  onDone,
}: {
  work: CivilAttention;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation("admin");
  const locale = (i18n.language || "fr") as AnyLocale;
  const qc = useQueryClient();
  const unitsQ = useQuery(adminUnitsQuery);

  const [hazard, setHazard] = useState<CivilHazard>("road");
  const [summary, setSummary] = useState(work.summary);
  const [areaSearch, setAreaSearch] = useState("");
  const [areaId, setAreaId] = useState("");
  const [expiresLocal, setExpiresLocal] = useState(defaultExpiresInput);
  const [reason, setReason] = useState("");
  const [dismissOpen, setDismissOpen] = useState(false);

  const alreadyPublished = work.report.civil_publications.some(
    (p) => p.incident_index === work.incident_index,
  );
  const tooOld =
    Date.now() - Date.parse(work.report.published_at) > 72 * 3_600_000;

  const matchingAreas = useMemo(() => {
    const q = areaSearch.trim().toLowerCase();
    const list = unitsQ.data ?? [];
    if (!q) return list.slice(0, 30);
    return list
      .filter((u) =>
        [u.name_fr, u.name_ar, u.name_en, u.code]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q)),
      )
      .slice(0, 30);
  }, [unitsQ.data, areaSearch]);

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["admin", "civil-attention"] }),
      qc.invalidateQueries({ queryKey: ["civil-publications"] }),
      qc.invalidateQueries({ queryKey: ["admin", "attention"] }),
    ]);

  const publishMut = useMutation({
    mutationFn: () =>
      publishItaPublication({
        reportId: work.report_id,
        incidentIndex: work.incident_index,
        hazard,
        summary: summary.trim(),
        areaId,
        expiresAt: new Date(expiresLocal).toISOString(),
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("publication.saved"));
      onDone();
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  const dismissMut = useMutation({
    mutationFn: (dismissReason: string) =>
      dismissCivilInvestigation(work.id, dismissReason),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("ita.dismissed"));
      setDismissOpen(false);
      onDone();
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AdminBadge tone={work.state === "failed" ? "bad" : "warn"} dot>
            {t(`publication.agent.${work.state}`, { defaultValue: work.state })}
          </AdminBadge>
          <span className="text-xs font-medium text-ink-secondary">
            {work.report.source_page}
          </span>
        </div>
        {work.report.source_url && (
          <a
            href={work.report.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-signal hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("ita.openPost")}
          </a>
        )}
      </div>

      <div className="rounded-xl border border-hairline bg-canvas/60 p-3.5 text-sm text-ink leading-relaxed whitespace-pre-wrap">
        {cleanCopy(work.report.body)}
      </div>

      {work.error && (
        <div className="rounded-xl border border-hazard-extreme/35 bg-hazard-extreme-soft/40 p-3 text-xs text-hazard-extreme-ink">
          {cleanCopy(work.error)}
        </div>
      )}

      {alreadyPublished ? (
        <div className="rounded-xl border border-hairline bg-surface-raised/60 p-3 text-xs text-ink-secondary">
          {t("ita.alreadyPublished")}
        </div>
      ) : tooOld ? (
        <div className="rounded-xl border border-hazard-high/35 bg-hazard-high-soft/40 p-3 text-xs text-hazard-high-ink">
          {t("publication.tooOld")}
        </div>
      ) : (
        <div className="space-y-3 border-t border-hairline pt-4">
          <p className="text-xs text-ink-muted leading-relaxed">
            {cleanCopy(t("publication.policy"))}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-secondary">
                {t("publication.hazard")}
              </label>
              <AtlasSelect
                value={hazard}
                onChange={(e) => setHazard(e.target.value as CivilHazard)}
              >
                {CIVIL_HAZARDS.map((h) => (
                  <option key={h} value={h}>
                    {t(`publication.hazards.${h}`)}
                  </option>
                ))}
              </AtlasSelect>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-secondary">
                {t("publication.expires")}
              </label>
              <AtlasInput
                type="datetime-local"
                value={expiresLocal}
                onChange={(e) => setExpiresLocal(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-ink-secondary">
              {t("publication.summary")}
            </label>
            <AtlasTextarea
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-ink-secondary">
              {t("publication.area")}
            </label>
            <AtlasInput
              value={areaSearch}
              onChange={(e) => setAreaSearch(e.target.value)}
              placeholder={t("ita.searchArea")}
            />
            <AtlasSelect
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
            >
              <option value="">{t("publication.chooseArea")}</option>
              {matchingAreas.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} · {unitName(u, locale)} ({u.level})
                </option>
              ))}
            </AtlasSelect>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-ink-secondary">
              {t("publication.reason")} *
            </label>
            <AtlasInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("kit.reasonHint")}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <AtlasButton
              variant="primary"
              size="sm"
              disabled={
                publishMut.isPending ||
                !summary.trim() ||
                !areaId ||
                !reason.trim()
              }
              onClick={() => publishMut.mutate()}
            >
              <Send className="h-3.5 w-3.5" />
              {t("publication.publish")}
            </AtlasButton>
            <AtlasButton
              variant="secondary"
              size="sm"
              onClick={() => setDismissOpen(true)}
            >
              <XCircle className="h-3.5 w-3.5 text-hazard-extreme" />
              {t("ita.dismiss")}
            </AtlasButton>
          </div>
        </div>
      )}

      {(alreadyPublished || tooOld) && (
        <div className="pt-2">
          <AtlasButton
            variant="secondary"
            size="sm"
            onClick={() => setDismissOpen(true)}
          >
            <XCircle className="h-3.5 w-3.5 text-hazard-extreme" />
            {t("ita.dismiss")}
          </AtlasButton>
        </div>
      )}

      <AdminConfirmDialog
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        title={t("ita.dismiss")}
        description={t("ita.dismissDescription")}
        confirmLabel={t("ita.dismiss")}
        destructive
        reasonMode="required"
        pending={dismissMut.isPending}
        onConfirm={async (r) => {
          await dismissMut.mutateAsync(r);
        }}
      />
    </div>
  );
}

function ItaPublicationsTab() {
  const { t, i18n } = useTranslation("admin");
  const locale = (i18n.language || "fr") as AnyLocale;
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [withdrawTarget, setWithdrawTarget] = useState<CivilPublication | null>(
    null,
  );
  const pubsQ = useQuery(civilPublicationsQuery(true, page));

  const withdrawMut = useMutation({
    mutationFn: ({ pub, reason }: { pub: CivilPublication; reason: string }) =>
      reviseCivilPublication({
        id: pub.id,
        expectedRevision: pub.revision,
        action: "withdraw",
        reason,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["civil-publications"] });
      toast.success(t("publication.saved"));
      setWithdrawTarget(null);
    },
    onError: () => toast.error(t("sources.actionFailed")),
  });

  return (
    <div className="space-y-4">
      <AdminQueryState
        query={pubsQ}
        isEmpty={(rows) => rows.length === 0}
        empty={t("ita.publicationsEmpty")}
      >
        {(rows) => (
          <ul className="space-y-2.5">
            {rows.map((pub) => {
              const tone: AdminTone =
                pub.state === "published"
                  ? "ok"
                  : pub.state === "withdrawn"
                    ? "bad"
                    : "neutral";
              return (
                <li
                  key={pub.id}
                  className="flex items-stretch overflow-hidden rounded-xl border border-hairline bg-surface"
                >
                  <span className={cn("w-1 shrink-0", ADMIN_TONE_BAR[tone])} />
                  <div className="flex flex-1 flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <AdminBadge tone={tone} dot>
                          {t(`publication.${pub.state}`, {
                            defaultValue: pub.state,
                          })}
                        </AdminBadge>
                        <AdminBadge tone="info">
                          {t(`publication.hazards.${pub.hazard}`, {
                            defaultValue: pub.hazard,
                          })}
                        </AdminBadge>
                        {pub.area && (
                          <span className="text-xs font-medium text-ink">
                            {unitName(pub.area, locale)}
                          </span>
                        )}
                        <span className="text-[11px] text-ink-muted">
                          <AdminWhen at={pub.updated_at} />
                        </span>
                      </div>
                      <p className="text-sm text-ink">
                        {cleanCopy(pub.summary)}
                      </p>
                    </div>

                    {pub.state === "published" && (
                      <AtlasButton
                        variant="danger"
                        size="sm"
                        onClick={() => setWithdrawTarget(pub)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("publication.withdraw")}
                      </AtlasButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AdminQueryState>

      <div className="flex items-center justify-end gap-2">
        <AtlasButton
          variant="secondary"
          size="sm"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          {t("publication.previous")}
        </AtlasButton>
        <AtlasButton
          variant="secondary"
          size="sm"
          disabled={(pubsQ.data?.length ?? 0) < 500}
          onClick={() => setPage((p) => p + 1)}
        >
          {t("publication.next")}
        </AtlasButton>
      </div>

      <AdminConfirmDialog
        open={withdrawTarget !== null}
        onOpenChange={(o) => !o && setWithdrawTarget(null)}
        title={t("publication.withdraw")}
        description={t("publication.withdrawConfirm")}
        confirmLabel={t("publication.withdraw")}
        destructive
        reasonMode="required"
        pending={withdrawMut.isPending}
        onConfirm={async (reason) => {
          if (withdrawTarget)
            await withdrawMut.mutateAsync({ pub: withdrawTarget, reason });
        }}
      />
    </div>
  );
}

function ItaFeedTab() {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [exhaustedOnly, setExhaustedOnly] = useState(false);
  const feedQ = useInfiniteQuery(itaReportsQuery(exhaustedOnly));

  const retryMut = useMutation({
    mutationFn: (id: string) => retryItaReport(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "ita", "feed"] });
      toast.success(t("ita.retryQueued"));
    },
    onError: () => toast.error(t("ita.retryFailed")),
  });

  return (
    <div className="space-y-4">
      <button
        type="button"
        role="switch"
        aria-checked={exhaustedOnly}
        onClick={() => setExhaustedOnly((v) => !v)}
        className="inline-flex min-h-11 items-center gap-2.5 rounded-xl border border-hairline bg-surface px-3.5 text-xs font-medium text-ink hover:bg-surface-raised cursor-pointer"
      >
        <span
          className={cn(
            "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
            exhaustedOnly
              ? "bg-signal justify-end"
              : "bg-hairline-strong justify-start",
          )}
        >
          <span className="h-4 w-4 rounded-full bg-surface shadow-xs" />
        </span>
        <span>{t("ita.exhaustedOnly")}</span>
      </button>

      <AdminQueryState
        query={feedQ}
        isEmpty={(rows) => rows.length === 0}
        empty={t("ita.feedEmpty")}
      >
        {(rows) => (
          <ul className="space-y-2.5">
            {rows.map((report) => {
              const failed =
                report.extraction === null && report.extraction_attempts >= 5;
              const extracted = report.extraction !== null;
              return (
                <li key={report.id}>
                  <AtlasPanel className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <AdminBadge
                          tone={failed ? "bad" : extracted ? "ok" : "warn"}
                        >
                          {failed
                            ? t("ita.extraction.failed")
                            : extracted
                              ? t("ita.extraction.extracted")
                              : t("ita.extraction.pending")}
                        </AdminBadge>
                        <span className="text-xs font-medium text-ink-secondary">
                          {report.source_page}
                        </span>
                        <SafeBdi className="text-[11px] font-mono text-ink-muted">
                          <AdminWhen at={report.published_at} />
                        </SafeBdi>
                      </div>
                      {failed && (
                        <AtlasButton
                          variant="secondary"
                          size="sm"
                          disabled={retryMut.isPending}
                          onClick={() => retryMut.mutate(report.id)}
                        >
                          <RefreshCw className="h-3.5 w-3.5 text-signal" />
                          {t("ita.retry")}
                        </AtlasButton>
                      )}
                    </div>
                    <p className="text-xs text-ink-secondary line-clamp-3 leading-relaxed">
                      {cleanCopy(report.body)}
                    </p>
                  </AtlasPanel>
                </li>
              );
            })}
          </ul>
        )}
      </AdminQueryState>
    </div>
  );
}

function ItaPage() {
  const { t } = useTranslation("admin");
  const [tab, setTab] = useState<"queue" | "publications" | "feed">("queue");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const attention = useQuery(attentionQuery);
  const queueQ = useInfiniteQuery(civilAttentionQuery);
  const waiting = attentionTotal(attention.data, ["ita_review", "ita_failed"]);
  const selected = queueQ.data?.find((w) => w.id === selectedId) ?? null;

  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.review")}
        title={t("ita.title")}
        description={t("ita.description")}
      />

      <div className="mb-5">
        <AdminFilterTabs
          value={tab}
          onChange={(next) => {
            setTab(next);
            setSelectedId(null);
          }}
          options={[
            {
              value: "queue",
              label: t("ita.tabs.queue"),
              count: waiting > 0 ? waiting : undefined,
            },
            { value: "publications", label: t("ita.tabs.publications") },
            { value: "feed", label: t("ita.tabs.feed") },
          ]}
        />
      </div>

      {tab === "queue" && (
        <AdminQueryState
          query={queueQ}
          isEmpty={(rows) => rows.length === 0}
          empty={t("ita.queueEmpty")}
        >
          {(rows) => (
            <AdminSplitWorkbench
              detailTitle={t("ita.detail")}
              placeholder={t("ita.placeholder")}
              onClose={() => setSelectedId(null)}
              detail={
                selected ? (
                  <ItaQueueInspector
                    key={selected.id}
                    work={selected}
                    onDone={() => setSelectedId(null)}
                  />
                ) : null
              }
              list={
                <ul className="space-y-2">
                  {rows.map((work) => {
                    const tone: AdminTone =
                      work.state === "failed" ? "bad" : "warn";
                    const active = work.id === selectedId;
                    return (
                      <li key={work.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(work.id)}
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
                          <div className="flex-1 px-3.5 py-3 space-y-1.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <AdminBadge tone={tone}>
                                {t(`publication.agent.${work.state}`, {
                                  defaultValue: work.state,
                                })}
                              </AdminBadge>
                              <span className="ms-auto text-[11px] text-ink-muted">
                                <AdminWhen at={work.updated_at} />
                              </span>
                            </div>
                            <div className="truncate text-sm font-medium text-ink">
                              {cleanCopy(work.summary || work.report.body)}
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
      )}

      {tab === "publications" && <ItaPublicationsTab />}
      {tab === "feed" && <ItaFeedTab />}
    </section>
  );
}
