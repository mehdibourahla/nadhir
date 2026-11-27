import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MemberDetail } from "@/components/admin/MemberDetail";
import { QueryState } from "@/components/admin/kit/QueryState";
import { SplitView } from "@/components/admin/kit/SplitView";
import { StatusBadge } from "@/components/admin/kit/StatusBadge";
import { When } from "@/components/admin/kit/When";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  adminCountQuery,
  adminRevocationGuard,
  applyRoleChanges,
  currentUserIdQuery,
  GRANTABLE_ROLES,
  memberCountsQuery,
  membersPageQuery,
  type MemberSort,
  roleChanges,
  roleMutationErrorKey,
  type AppRole,
  type Member,
  type RoleChanges,
} from "@/lib/roles";
import { cn } from "@/lib/utils";

type RoleFilter = AppRole | "none" | null;

const heldRoles = (member: Member) =>
  member.roles.filter((role) => GRANTABLE_ROLES.includes(role));

const nameOf = (member: Member) => member.display_name || member.email;

function RoleDialog({
  member,
  changes,
  selfRevokesAdmin,
  open,
  onOpenChange,
}: {
  member: Member;
  changes: RoleChanges;
  selfRevokesAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const grantsAdmin = changes.grant.includes("admin");
  const blocked =
    pending ||
    (grantsAdmin && typed.trim().toLowerCase() !== member.email.toLowerCase());

  const change = (next: boolean) => {
    if (pending) return;
    onOpenChange(next);
    if (!next) {
      setTyped("");
      setError(null);
    }
  };

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await applyRoleChanges(member.id, changes);
      toast.success(t("people.saved", { name: nameOf(member) }));
      setPending(false);
      change(false);
    } catch (failure) {
      setPending(false);
      setError(t(roleMutationErrorKey(failure)));
    } finally {
      await qc.invalidateQueries({ queryKey: ["roles"] });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("people.confirmTitle", { name: nameOf(member) })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <ul className="space-y-1">
              {changes.grant.map((role) => (
                <li key={role}>
                  {t("people.willGrant", { role: t(`role.${role}`) })}
                </li>
              ))}
              {changes.revoke.map((role) => (
                <li key={role}>
                  {t("people.willRevoke", { role: t(`role.${role}`) })}
                </li>
              ))}
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {selfRevokesAdmin ? (
          <p className="text-sm text-emergency">
            {t("people.confirmSelfAdminRevoke")}
          </p>
        ) : null}
        {grantsAdmin ? (
          <label className="block text-sm">
            <span className="text-emergency">{t("people.adminWarning")}</span>
            <span className="mt-2 block font-medium">
              {t("people.typeEmail", { email: member.email })}
            </span>
            <Input
              className="mt-1"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("kit.cancel")}
          </AlertDialogCancel>
          <Button
            variant={
              grantsAdmin || selfRevokesAdmin ? "destructive" : "default"
            }
            disabled={blocked}
            onClick={() => void save()}
          >
            {pending ? t("kit.working") : t("people.apply")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MemberPanel({
  member,
  me,
  adminCount,
}: {
  member: Member;
  me: string;
  adminCount: number;
}) {
  const { t } = useTranslation("admin");
  const held = heldRoles(member);
  const [next, setNext] = useState<AppRole[]>(held);
  const [confirming, setConfirming] = useState(false);
  const guard = adminRevocationGuard({
    currentUserId: me,
    targetUserId: member.id,
    adminCount,
  });
  const changes = roleChanges(held, next);
  const dirty = changes.grant.length + changes.revoke.length > 0;

  return (
    <div className="space-y-6 text-sm">
      <div>
        <p className="font-medium">{nameOf(member)}</p>
        {member.display_name ? (
          <p className="text-muted-foreground">{member.email}</p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {t("people.joined")} <When at={member.created_at} />
        </p>
      </div>
      <fieldset className="space-y-3">
        <legend className="font-medium">{t("people.roles")}</legend>
        {GRANTABLE_ROLES.map((role) => {
          const locked =
            role === "admin" && held.includes("admin") && guard.disabled;
          return (
            <label key={role} className="flex items-start gap-3">
              <Checkbox
                className="mt-0.5"
                checked={next.includes(role)}
                disabled={locked}
                onCheckedChange={(checked) =>
                  setNext((prev) =>
                    checked
                      ? [...prev, role]
                      : prev.filter((value) => value !== role),
                  )
                }
              />
              <span>
                <span className="block capitalize">{t(`role.${role}`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {locked
                    ? t("people.lastAdminDisabled")
                    : t(`people.roleHelp_${role}`)}
                </span>
              </span>
            </label>
          );
        })}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            disabled={!dirty}
            onClick={() => setConfirming(true)}
          >
            {t("people.review")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty}
            onClick={() => setNext(held)}
          >
            {t("people.reset")}
          </Button>
        </div>
      </fieldset>
      <RoleDialog
        member={member}
        changes={changes}
        selfRevokesAdmin={
          guard.needsConfirmation && changes.revoke.includes("admin")
        }
        open={confirming}
        onOpenChange={setConfirming}
      />
      <div className="border-t border-border pt-4">
        <MemberDetail userId={member.id} />
      </div>
    </div>
  );
}

export function PeopleDirectory() {
  const { t } = useTranslation("admin");
  const [search, setSearch] = useState("");
  const [needle, setNeedle] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(null);
  const [sort, setSort] = useState<MemberSort>("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const members = useInfiniteQuery(membersPageQuery(needle, roleFilter, sort));
  const counts = useQuery(memberCountsQuery);
  const adminCount = useQuery(adminCountQuery);
  const me = useQuery(currentUserIdQuery);

  const rows = members.data ?? [];
  const selected = rows.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("people.counts", {
          total: counts.data?.total ?? 0,
          withRole: counts.data?.with_role ?? 0,
          shown: rows[0]?.matching ?? 0,
        })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          className="h-8 w-full max-w-xs"
          placeholder={t("people.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label={t("people.sort")}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={sort}
          onChange={(event) => setSort(event.target.value as MemberSort)}
        >
          <option value="newest">{t("people.sortNewest")}</option>
          <option value="oldest">{t("people.sortOldest")}</option>
          <option value="email">{t("people.sortEmail")}</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        {([null, ...GRANTABLE_ROLES, "none"] as RoleFilter[]).map((value) => (
          <Button
            key={value ?? "all"}
            size="sm"
            variant={roleFilter === value ? "default" : "outline"}
            aria-pressed={roleFilter === value}
            className="capitalize"
            onClick={() => setRoleFilter(value)}
          >
            {value === null
              ? t("people.filterAll")
              : value === "none"
                ? t("people.filterNoRole")
                : t(`role.${value}`)}
          </Button>
        ))}
      </div>
      <QueryState
        query={members}
        rows={6}
        isEmpty={() => rows.length === 0}
        empty={t("people.empty")}
      >
        {() => (
          <SplitView
            detailTitle={t("people.detail")}
            placeholder={t("people.placeholder")}
            onClose={() => setSelectedId(null)}
            detail={
              selected && me.data && adminCount.data !== undefined ? (
                <MemberPanel
                  key={`${selected.id}:${heldRoles(selected).join(",")}`}
                  member={selected}
                  me={me.data}
                  adminCount={adminCount.data}
                />
              ) : null
            }
            list={
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("people.colMember")}</TableHead>
                      <TableHead>{t("people.roles")}</TableHead>
                      <TableHead className="hidden sm:table-cell">
                        {t("people.zones")}
                      </TableHead>
                      <TableHead className="hidden sm:table-cell">
                        {t("people.colLastSeen")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((m) => (
                      <TableRow
                        key={m.id}
                        className={cn(
                          "cursor-pointer",
                          m.id === selectedId && "bg-muted",
                        )}
                        onClick={() => setSelectedId(m.id)}
                      >
                        <TableCell className="max-w-56">
                          <button
                            type="button"
                            className="block w-full truncate text-start font-medium"
                            onClick={() => setSelectedId(m.id)}
                          >
                            {nameOf(m)}
                          </button>
                          {m.display_name ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {m.email}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-wrap gap-1">
                            {heldRoles(m).length ? (
                              heldRoles(m).map((role) => (
                                <StatusBadge
                                  key={role}
                                  tone={role === "admin" ? "warn" : "neutral"}
                                  className="capitalize"
                                >
                                  {t(`role.${role}`)}
                                </StatusBadge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {t("empty.noRole")}
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="hidden tabular-nums sm:table-cell">
                          {m.zone_count}
                        </TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                          {m.last_sign_in_at ? (
                            <When at={m.last_sign_in_at} />
                          ) : (
                            t("people.neverSignedIn")
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            }
          />
        )}
      </QueryState>
    </div>
  );
}
