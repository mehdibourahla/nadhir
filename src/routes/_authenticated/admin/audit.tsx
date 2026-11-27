import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

import {
  AUDIT_ACTORS,
  AUDIT_DOMAINS,
  actionKey,
  auditChanges,
  auditQuery,
  auditTargetPath,
  type AuditActor,
  type AuditEntry,
} from "@/lib/admin-audit";
import { currentUserIdQuery } from "@/lib/roles";
import {
  AdminBadge,
  AdminFilterTabs,
  AdminHeader,
  AdminQueryState,
  AdminWhen,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import { AtlasSelect, SafeBdi } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  component: AuditPage,
});

function AuditRow({
  entry,
  currentUserId,
}: {
  entry: AuditEntry;
  currentUserId: string | null;
}) {
  const { t, i18n } = useTranslation("admin");
  const lang = i18n.language || "en";
  const [expanded, setExpanded] = useState(false);
  const changes = auditChanges(entry);
  const targetPath = auditTargetPath(entry);

  const actorText =
    entry.actor_kind === "system"
      ? t("audit.bySystem", { job: entry.actor_label || "system" })
      : currentUserId && entry.actor_user_id === currentUserId
        ? t("audit.byYou")
        : entry.actor_label || t("audit.byPerson");

  const actionLabel = t(`audit.action.${actionKey(entry.action)}`, {
    defaultValue: entry.action,
    role: t("audit.aRole"),
    member: t("audit.someone"),
  });

  return (
    <li className="px-4 py-3.5 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <AdminBadge tone="info">
              {t(`audit.domain_${entry.domain}`, {
                defaultValue: entry.domain,
              })}
            </AdminBadge>
            <span className="text-sm font-medium text-ink">
              {cleanCopy(actionLabel)}
            </span>
            <span className="text-xs text-ink-muted">
              {cleanCopy(actorText)}
            </span>
          </div>

          {entry.reason && (
            <p className="text-xs text-ink-secondary leading-relaxed">
              {cleanCopy(entry.reason)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 text-xs">
          {targetPath && (
            <Link
              to={targetPath}
              className="inline-flex items-center gap-1 text-signal hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {t(`audit.domain_${entry.domain}`, {
                defaultValue: entry.domain,
              })}
            </Link>
          )}
          <span className="text-ink-muted">
            <AdminWhen at={entry.at} />
          </span>
        </div>
      </div>

      {changes.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-muted hover:text-ink cursor-pointer"
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            <span>
              {lang === "ar"
                ? `${changes.length} تغييرات`
                : lang === "fr"
                  ? `${changes.length} champ${changes.length === 1 ? "" : "s"} modifié${changes.length === 1 ? "" : "s"}`
                  : `${changes.length} field${changes.length === 1 ? "" : "s"} changed`}
            </span>
          </button>

          {expanded && (
            <div
              className="mt-2 overflow-x-auto rounded-lg border border-hairline bg-canvas/70 p-3 font-mono text-[11px]"
              dir="ltr"
            >
              <table className="w-full text-left">
                <tbody className="divide-y divide-hairline">
                  {changes.map((c) => (
                    <tr key={c.key}>
                      <td className="py-1 pe-3 font-semibold text-ink">
                        {c.key}
                      </td>
                      <td className="py-1 pe-3 text-hazard-extreme-ink">
                        {JSON.stringify(c.before)}
                      </td>
                      <td className="py-1 text-hazard-clear-ink">
                        → {JSON.stringify(c.after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function AuditPage() {
  const { t } = useTranslation("admin");
  const [domain, setDomain] = useState<string>("");
  const [actor, setActor] = useState<AuditActor>("user");
  const currentUserQ = useQuery(currentUserIdQuery);
  const query = useInfiniteQuery(auditQuery(domain || null, actor));

  const entries = (query.data?.pages ?? []).flat();

  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.admin")}
        title={t("audit.title")}
        description={t("audit.subtitle")}
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <AdminFilterTabs
          value={actor}
          onChange={setActor}
          options={AUDIT_ACTORS.map((a) => ({
            value: a,
            label: t(`audit.actor_${a}`),
          }))}
        />

        <AtlasSelect
          aria-label={t("audit.domain")}
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className="w-48"
        >
          <option value="">{t("audit.filterAll")}</option>
          {AUDIT_DOMAINS.map((d) => (
            <option key={d} value={d}>
              {t(`audit.domain_${d}`)}
            </option>
          ))}
        </AtlasSelect>
      </div>

      <AdminQueryState
        query={query}
        rows={6}
        isEmpty={() => entries.length === 0}
        empty={t("audit.empty")}
      >
        {() => (
          <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
            <ul className="divide-y divide-hairline">
              {entries.map((entry) => (
                <AuditRow
                  key={entry.id}
                  entry={entry}
                  currentUserId={currentUserQ.data ?? null}
                />
              ))}
            </ul>
            {entries.length > 0 && (
              <div className="border-t border-hairline bg-surface-raised/40 px-4 py-2 text-end font-mono text-[11px] text-ink-muted">
                <SafeBdi>{entries.length}</SafeBdi>
              </div>
            )}
          </div>
        )}
      </AdminQueryState>
    </section>
  );
}
