import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { QueryState } from "@/components/admin/kit/QueryState";
import { When } from "@/components/admin/kit/When";
import { Button } from "@/components/ui/button";
import type { Json } from "@/integrations/supabase/types";
import {
  actionKey,
  AUDIT_ACTORS,
  AUDIT_DOMAINS,
  auditChanges,
  auditQuery,
  auditTargetPath,
  type AuditActor,
  type AuditEntry,
} from "@/lib/admin-audit";
import { myRolesQuery } from "@/lib/reports";
import { currentUserIdQuery, membersQuery, type Member } from "@/lib/roles";

const shown = (value: Json | null, none: string) =>
  value === null
    ? none
    : typeof value === "string"
      ? value
      : JSON.stringify(value);

const memberName = (member: Member | undefined) =>
  member ? member.display_name || member.email : null;

function Entry({
  entry,
  me,
  members,
}: {
  entry: AuditEntry;
  me: string | null;
  members: Map<string, Member>;
}) {
  const { t } = useTranslation("admin");
  const role = (entry.after ?? entry.before) as { role?: string } | null;
  const isRole = entry.action.startsWith("role.");
  const target = isRole
    ? (memberName(members.get(entry.target_id ?? "")) ?? t("audit.someone"))
    : null;
  const actor =
    entry.actor_kind === "system"
      ? t("audit.bySystem", { job: entry.actor_label ?? "" })
      : entry.actor_user_id && entry.actor_user_id === me
        ? t("audit.byYou")
        : (memberName(members.get(entry.actor_user_id ?? "")) ??
          t("audit.byPerson"));
  const changes = isRole ? [] : auditChanges(entry);
  const path = auditTargetPath(entry);

  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">
          {t(`audit.action.${actionKey(entry.action)}`, {
            defaultValue: entry.action,
            role: role?.role ? t(`role.${role.role}`) : "",
            member: target,
          })}
        </span>
        <span className="text-xs text-muted-foreground">{actor}</span>
        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
          <When at={entry.at} />
        </span>
      </div>
      {entry.reason ? (
        <p dir="auto" className="mt-1 text-muted-foreground">
          “{entry.reason}”
        </p>
      ) : null}
      {changes.length ? (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-muted-foreground">
          {changes.map((change) => (
            <div key={change.key} className="contents">
              <dt className="font-mono">{change.key}</dt>
              <dd className="break-all">
                {shown(change.before, t("empty.none"))} →{" "}
                {shown(change.after, t("empty.none"))}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {path ? (
        <Link to={path} className="mt-1 inline-block text-xs underline">
          {t(`nav.${path.split("/")[2]}`)}
          {entry.target_id && !isRole
            ? ` · ${entry.target_id.slice(0, 8)}`
            : ""}
        </Link>
      ) : null}
    </li>
  );
}

export function AuditLog() {
  const { t } = useTranslation("admin");
  const [domain, setDomain] = useState<string | null>(null);
  const [actor, setActor] = useState<AuditActor>("user");
  const entries = useInfiniteQuery(auditQuery(domain, actor));
  const me = useQuery(currentUserIdQuery);
  const roles = useQuery(myRolesQuery);
  const members = useQuery({
    ...membersQuery,
    enabled: (roles.data ?? []).includes("admin"),
  });
  const byId = new Map((members.data ?? []).map((m) => [m.id, m]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {AUDIT_ACTORS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={actor === value ? "default" : "outline"}
            aria-pressed={actor === value}
            onClick={() => setActor(value)}
          >
            {t(`audit.actor_${value}`)}
          </Button>
        ))}
        <select
          aria-label={t("audit.domain")}
          className="ms-auto h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={domain ?? ""}
          onChange={(event) => setDomain(event.target.value || null)}
        >
          <option value="">{t("audit.filterAll")}</option>
          {AUDIT_DOMAINS.map((value) => (
            <option key={value} value={value}>
              {t(`audit.domain_${value}`)}
            </option>
          ))}
        </select>
      </div>
      <QueryState
        query={entries}
        rows={6}
        isEmpty={(data) => data.pages.every((page) => page.length === 0)}
        empty={t("audit.empty")}
      >
        {(data) => (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {data.pages.flat().map((entry) => (
                <Entry
                  key={entry.id}
                  entry={entry}
                  me={me.data ?? null}
                  members={byId}
                />
              ))}
            </ul>
          </>
        )}
      </QueryState>
    </div>
  );
}
