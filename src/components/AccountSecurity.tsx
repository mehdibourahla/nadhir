import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Mail, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { NATIVE, openOnWeb } from "@/lib/platform";

export function AccountSecurity() {
  const { t } = useTranslation();
  const [userId, setUserId] = useState<string | null>();
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const account = useQuery({
    queryKey: ["account-security", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user?.id === userId ? data.user : null;
    },
  });
  const user = userId && account.data?.id === userId ? account.data : null;
  const providers = [
    ...new Set(user?.identities?.map((identity) => identity.provider) ?? []),
  ];

  return (
    <section
      className="panel mt-5 space-y-4 p-5"
      aria-labelledby="account-security-title"
    >
      <h2
        id="account-security-title"
        className="flex items-center gap-2 text-lg font-semibold"
      >
        <ShieldCheck size={20} aria-hidden="true" />
        {t("authKit.securityTitle")}
      </h2>
      {userId === undefined || (userId && account.isPending) ? (
        <p role="status">{t("common.loading")}</p>
      ) : account.isError ? (
        <div role="alert">
          <p>{t("account.errorUnavailable")}</p>
          <button
            type="button"
            className="mt-2 min-h-11 underline"
            onClick={() => void account.refetch()}
          >
            {t("common.retry")}
          </button>
        </div>
      ) : user ? (
        <>
          <div className="flex items-start gap-3">
            <Mail size={18} className="mt-1 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="break-words font-medium">
                <bdi dir="ltr">{user.email}</bdi>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(
                  user.email_confirmed_at
                    ? "authKit.emailVerified"
                    : "authKit.emailUnverified",
                )}
              </p>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium">
              {t("authKit.signInMethods")}
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {providers.map((provider) => (
                <li
                  key={provider}
                  className="rounded-full border border-border px-3 py-1 text-sm"
                >
                  {provider === "google"
                    ? "Google"
                    : provider === "apple"
                      ? "Apple"
                      : provider === "email"
                        ? t("authKit.emailMethod")
                        : provider}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {t("authKit.passwordSecurityHint")}
            </p>
            {NATIVE ? (
              <button
                type="button"
                onClick={() => openOnWeb("/auth?mode=forgot")}
                className="mt-3 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-secondary"
              >
                {t("authKit.changePassword")}
              </button>
            ) : (
              <Link
                to="/auth"
                search={{ returnTo: "/settings", mode: "forgot" }}
                className="mt-3 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-secondary"
              >
                {t("authKit.changePassword")}
              </Link>
            )}
          </div>
        </>
      ) : (
        <p role="alert">{t("account.errorUnavailable")}</p>
      )}
    </section>
  );
}
