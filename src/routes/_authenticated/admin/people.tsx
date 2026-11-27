import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Search, ShieldAlert, UserCog } from "lucide-react";
import { toast } from "sonner";

import { myRolesQuery } from "@/lib/reports";
import {
  GRANTABLE_ROLES,
  adminCountQuery,
  adminRevocationGuard,
  applyRoleChanges,
  currentUserIdQuery,
  memberCountsQuery,
  memberDetailQuery,
  membersPageQuery,
  roleChanges,
  roleMutationErrorKey,
  type AppRole,
  type Member,
  type MemberSort,
} from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  AdminBadge,
  AdminConfirmDialog,
  AdminHeader,
  AdminQueryState,
  AdminSplitWorkbench,
  AdminWhen,
} from "@/ui/admin-kit";
import { cleanCopy } from "@/ui/format";
import {
  AtlasButton,
  AtlasInput,
  AtlasPanel,
  AtlasSelect,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin/people")({
  component: PeoplePage,
});

function MemberInspector({ member }: { member: Member }) {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const detailQ = useQuery(memberDetailQuery(member.id));
  const currentUserQ = useQuery(currentUserIdQuery);
  const adminCountQ = useQuery(adminCountQuery);

  const [draftRoles, setDraftRoles] = useState<AppRole[]>(member.roles);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const diff = roleChanges(member.roles, draftRoles);
  const dirty = diff.grant.length > 0 || diff.revoke.length > 0;
  const touchesAdmin =
    diff.grant.includes("admin") || diff.revoke.includes("admin");

  const guard = adminRevocationGuard({
    currentUserId: currentUserQ.data ?? "",
    targetUserId: member.id,
    adminCount: adminCountQ.data ?? 0,
  });

  const mut = useMutation({
    mutationFn: () => applyRoleChanges(member.id, diff),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["roles"] }),
        qc.invalidateQueries({ queryKey: ["my-roles"] }),
      ]);
      toast.success(
        t("people.saved", { name: member.display_name || member.email }),
      );
      setConfirmOpen(false);
    },
    onError: (err) => {
      toast.error(t(roleMutationErrorKey(err)));
    },
  });

  function toggleRole(role: AppRole) {
    if (role === "admin" && member.roles.includes("admin") && guard.disabled) {
      return;
    }
    setDraftRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  const detail = detailQ.data;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="font-display text-lg font-semibold text-ink">
          {cleanCopy(member.display_name || member.email)}
        </div>
        <SafeBdi className="font-mono text-xs text-ink-secondary">
          {member.email}
        </SafeBdi>
        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-ink-muted">
          <span>
            {t("people.joined")}: <AdminWhen at={member.created_at} />
          </span>
          <span>
            {t("people.colLastSeen")}:{" "}
            {member.last_sign_in_at ? (
              <AdminWhen at={member.last_sign_in_at} />
            ) : (
              t("people.neverSignedIn")
            )}
          </span>
        </div>
      </div>

      {/* Roles editor */}
      <div className="space-y-2.5 border-t border-hairline pt-4">
        <div className="flex items-center justify-between">
          <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            {t("people.roles")}
          </h4>
          {dirty && (
            <button
              type="button"
              onClick={() => setDraftRoles(member.roles)}
              className="text-xs font-medium text-signal hover:underline cursor-pointer"
            >
              {t("people.reset")}
            </button>
          )}
        </div>

        <div className="space-y-2">
          {GRANTABLE_ROLES.map((role) => {
            const active = draftRoles.includes(role);
            const locked =
              role === "admin" &&
              member.roles.includes("admin") &&
              guard.disabled;
            return (
              <button
                key={role}
                type="button"
                role="switch"
                aria-checked={active}
                disabled={locked}
                onClick={() => toggleRole(role)}
                className={cn(
                  "flex w-full items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-start transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                  active
                    ? "border-signal/50 bg-signal-soft/40"
                    : "border-hairline bg-surface hover:border-hairline-strong",
                )}
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-semibold text-ink">
                    {t(`role.${role}`)}
                  </div>
                  <div className="text-[11px] text-ink-secondary">
                    {cleanCopy(t(`people.roleHelp_${role}`))}
                  </div>
                </div>
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                    active
                      ? "bg-signal justify-end"
                      : "bg-hairline-strong justify-start",
                  )}
                >
                  <span className="h-4 w-4 rounded-full bg-surface shadow-xs" />
                </span>
              </button>
            );
          })}
        </div>

        {guard.disabled && member.roles.includes("admin") && (
          <p className="text-xs text-hazard-high-ink">
            {cleanCopy(t("people.lastAdminDisabled"))}
          </p>
        )}

        {dirty && (
          <div className="flex justify-end pt-1">
            <AtlasButton
              variant="primary"
              size="sm"
              onClick={() => setConfirmOpen(true)}
            >
              <UserCog className="h-3.5 w-3.5" />
              {t("people.review")}
            </AtlasButton>
          </div>
        )}
      </div>

      {/* Reachability */}
      {detail && (
        <div className="space-y-3 border-t border-hairline pt-4 text-xs">
          <h4 className="font-mono font-semibold uppercase tracking-wider text-ink-secondary">
            {t("people.reachability")}
          </h4>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl border border-hairline bg-surface-raised/50 p-3">
            <div>
              <dt className="text-ink-muted">{t("people.alertEmail")}</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {detail.alert_email ? t("people.yes") : t("people.no")}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">{t("people.alertPush")}</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {detail.alert_push ? t("people.yes") : t("people.no")}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">{t("people.phoneOnFile")}</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {detail.has_phone ? t("people.yes") : t("people.no")}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">{t("people.minDanger")}</dt>
              <dd className="mt-0.5 font-mono text-ink">
                {detail.min_danger_level ?? "-"}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-muted">{t("people.zones")}</dt>
              <dd className="mt-0.5 text-ink">
                {detail.zones.length > 0
                  ? detail.zones
                      .map((z) => z.name || t("people.unnamedZone"))
                      .join(", ")
                  : t("people.noZones")}
              </dd>
            </div>
          </dl>
        </div>
      )}

      <AdminConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("people.confirmTitle", {
          name: member.display_name || member.email,
        })}
        description={
          touchesAdmin
            ? diff.revoke.includes("admin") && guard.needsConfirmation
              ? t("people.confirmSelfAdminRevoke")
              : t("people.adminWarning")
            : undefined
        }
        confirmLabel={t("people.apply")}
        destructive={touchesAdmin}
        reasonMode="none"
        confirmTextToType={touchesAdmin ? member.email : undefined}
        confirmTextHint={
          touchesAdmin
            ? t("people.typeEmail", { email: member.email })
            : undefined
        }
        pending={mut.isPending}
        onConfirm={async () => {
          await mut.mutateAsync();
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          {diff.grant.map((r) => (
            <AdminBadge key={`g-${r}`} tone="ok">
              {t("people.willGrant", { role: t(`role.${r}`) })}
            </AdminBadge>
          ))}
          {diff.revoke.map((r) => (
            <AdminBadge key={`r-${r}`} tone="bad">
              {t("people.willRevoke", { role: t(`role.${r}`) })}
            </AdminBadge>
          ))}
        </div>
      </AdminConfirmDialog>
    </div>
  );
}

function PeoplePage() {
  const { t } = useTranslation("admin");
  const roles = useQuery(myRolesQuery);
  const isAdmin = (roles.data ?? []).includes("admin");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AppRole | "none" | "">("");
  const [sort, setSort] = useState<MemberSort>("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const countsQ = useQuery({ ...memberCountsQuery, enabled: isAdmin });
  const membersQ = useInfiniteQuery({
    ...membersPageQuery(search, roleFilter || null, sort),
    enabled: isAdmin,
  });

  if (!roles.isPending && !isAdmin) {
    return (
      <section>
        <AdminHeader
          eyebrow={t("groups.admin")}
          title={t("people.title")}
          description={t("people.subtitle")}
        />
        <AtlasPanel className="flex items-center gap-3 text-sm text-ink-secondary">
          <ShieldAlert className="h-5 w-5 text-hazard-extreme" />
          <span>{t("people.noAccess")}</span>
        </AtlasPanel>
      </section>
    );
  }

  const rows = membersQ.data ?? [];
  const selected = rows.find((m) => m.id === selectedId) ?? null;

  return (
    <section>
      <AdminHeader
        eyebrow={t("groups.admin")}
        title={t("people.title")}
        description={t("people.subtitle")}
        metrics={
          countsQ.data
            ? [
                {
                  label: t("people.filterAll"),
                  value: <SafeBdi>{countsQ.data.total}</SafeBdi>,
                },
                {
                  label: t("people.roles"),
                  value: <SafeBdi>{countsQ.data.with_role}</SafeBdi>,
                  tone: "signal",
                },
              ]
            : undefined
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52 max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <AtlasInput
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedId(null);
            }}
            placeholder={t("people.search")}
            className="ps-9"
          />
        </div>

        <AtlasSelect
          aria-label={t("people.roles")}
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value as AppRole | "none" | "");
            setSelectedId(null);
          }}
          className="w-44"
        >
          <option value="">{t("people.filterAll")}</option>
          <option value="none">{t("people.filterNoRole")}</option>
          {GRANTABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`role.${r}`)}
            </option>
          ))}
        </AtlasSelect>

        <AtlasSelect
          aria-label={t("people.sort")}
          value={sort}
          onChange={(e) => setSort(e.target.value as MemberSort)}
          className="w-40"
        >
          <option value="newest">{t("people.sortNewest")}</option>
          <option value="oldest">{t("people.sortOldest")}</option>
          <option value="email">{t("people.sortEmail")}</option>
        </AtlasSelect>
      </div>

      <AdminQueryState
        query={membersQ}
        isEmpty={(list) => list.length === 0}
        empty={t("people.empty")}
      >
        {(list) => (
          <AdminSplitWorkbench
            detailTitle={t("people.detail")}
            placeholder={t("people.placeholder")}
            onClose={() => setSelectedId(null)}
            detail={
              selected ? (
                <MemberInspector key={selected.id} member={selected} />
              ) : null
            }
            list={
              <ul className="space-y-2">
                {list.map((m) => {
                  const active = m.id === selectedId;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(m.id)}
                        className={cn(
                          "w-full rounded-xl border px-3.5 py-3 text-start transition-colors cursor-pointer space-y-1.5",
                          active
                            ? "border-signal bg-signal-soft/40"
                            : "border-hairline bg-surface hover:border-hairline-strong",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-ink">
                            {cleanCopy(m.display_name || m.email)}
                          </span>
                          <span className="text-[11px] text-ink-muted shrink-0">
                            {m.last_sign_in_at ? (
                              <AdminWhen at={m.last_sign_in_at} />
                            ) : (
                              t("people.neverSignedIn")
                            )}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {m.roles.length > 0 ? (
                            m.roles.map((r) => (
                              <AdminBadge
                                key={r}
                                tone={r === "admin" ? "bad" : "info"}
                              >
                                {t(`role.${r}`)}
                              </AdminBadge>
                            ))
                          ) : (
                            <span className="text-[11px] text-ink-muted">
                              {t("empty.noRole")}
                            </span>
                          )}
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
