import type { User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronDown, LoaderCircle, LogOut } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { authDestination } from "@/lib/auth-destination";
import { signOutAccount } from "@/lib/sign-out";

export function AccountMenu({
  user,
  hasPanelAccess,
}: {
  user: User | null | undefined;
  hasPanelAccess: boolean;
}) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [open, setOpen] = useState(false);
  const profile = useQuery({
    queryKey: ["profile", "navigation", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      const scope = await signOutAccount();
      await queryClient.cancelQueries();
      queryClient.clear();
      setOpen(false);
      if (scope === "local") toast.warning(t("authKit.localSignedOut"));
      else toast.success(t("authKit.signedOut"));
      await navigate({ to: "/", replace: true });
    } catch {
      setSignOutError(true);
      toast.error(t("authKit.signOutFailed"));
    } finally {
      setSigningOut(false);
    }
  }

  if (user === undefined) {
    return (
      <span
        role="status"
        className="flex size-9 shrink-0 items-center justify-center"
      >
        <LoaderCircle
          aria-hidden
          className="size-4 animate-spin text-muted-foreground"
        />
        <span className="sr-only">{t("common.loading")}</span>
      </span>
    );
  }

  if (!user) {
    return (
      <Link
        to="/auth"
        search={{
          returnTo: authDestination(
            location.pathname === "/auth"
              ? new URLSearchParams(location.searchStr).get("returnTo")
              : location.href,
          ),
        }}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-primary px-2.5 py-2 text-xs font-medium text-primary-foreground sm:px-3 sm:text-sm"
      >
        {t("account.signIn")}
      </Link>
    );
  }

  const name =
    [
      profile.data?.display_name,
      user.user_metadata?.["full_name"],
      user.user_metadata?.["name"],
      user.email?.split("@")[0],
    ]
      .find(
        (value): value is string => typeof value === "string" && !!value.trim(),
      )
      ?.trim() ?? t("nav.accountMenu");

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} dir={i18n.dir()}>
      <DropdownMenuTrigger
        aria-label={t("authKit.accountMenuLabel", { name })}
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border p-1 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pe-2"
      >
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {Array.from(name)[0]?.toLocaleUpperCase()}
        </span>
        <span className="hidden max-w-24 truncate xl:inline">
          <bdi>{name}</bdi>
        </span>
        <ChevronDown aria-hidden className="hidden size-3.5 sm:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel className="space-y-1 px-3 py-2">
          <p className="text-xs font-normal text-muted-foreground">
            {t("authKit.signedIn")}
          </p>
          <p className="truncate">
            <bdi>{name}</bdi>
          </p>
          {user.email ? (
            <p
              dir="ltr"
              className="truncate text-start text-xs font-normal text-muted-foreground"
            >
              {user.email}
            </p>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {[
          { to: "/zones", key: "nav.account" },
          { to: "/alerts", key: "nav.alerts" },
          { to: "/settings", key: "nav.settings" },
          ...(hasPanelAccess ? [{ to: "/admin", key: "nav.admin" }] : []),
        ].map((item) => (
          <DropdownMenuItem key={item.to} className="min-h-11" asChild>
            <Link to={item.to}>{t(item.key)}</Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-11"
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
        >
          {signingOut ? (
            <LoaderCircle aria-hidden className="animate-spin" />
          ) : (
            <LogOut aria-hidden />
          )}
          {t(signingOut ? "authKit.signingOut" : "account.signOut")}
        </DropdownMenuItem>
        {signOutError ? (
          <p role="alert" className="px-2 py-2 text-xs text-destructive">
            {t("authKit.signOutFailed")}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
