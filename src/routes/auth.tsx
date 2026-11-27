import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, KeyRound, Mail } from "lucide-react";
import { toast } from "sonner";

import type { AnyLocale } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { authDestination, resolveAuthLocale } from "@/lib/auth-destination";
import { authErrorKey } from "@/lib/auth-errors";
import {
  authMode,
  passwordProblem,
  signupCredentials,
  type AuthMode,
} from "@/lib/auth-flow";
import { titledMeta } from "@/lib/page-meta";
import { APP_ORIGIN } from "@/lib/platform";
import { NadhirMark } from "@/ui/brand";
import { AtlasButton, AtlasInput, AtlasPanel } from "@/ui/primitives";

export const Route = createFileRoute("/auth")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { returnTo: string; mode?: AuthMode; lang?: AnyLocale } => {
    const returnTo = authDestination(search["returnTo"]);
    const lang = resolveAuthLocale(search["lang"], returnTo);
    return {
      returnTo,
      mode: authMode(search["mode"]),
      ...(lang ? { lang } : {}),
    };
  },
  head: () => ({
    meta: titledMeta("account.authMetaTitle", "account.authSubtitle"),
  }),
  component: AuthPage,
});

function AuthPage() {
  const { t, i18n } = useTranslation();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const [mode, setMode] = useState<AuthMode>(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentEmail, setSentEmail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (search.mode) setMode(search.mode);
  }, [search.mode]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user && mode !== "reset") {
        void navigate({ to: search.returnTo || "/alerts", replace: true });
      }
    });
  }, [mode, navigate, search.returnTo]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setBusy(true);
    try {
      const origin =
        typeof window !== "undefined" ? window.location.origin : APP_ORIGIN;
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setErrorMsg(t(authErrorKey(error)));
          return;
        }
        toast.success(t("authKit.signedIn"));
        void navigate({ to: search.returnTo || "/alerts", replace: true });
      } else if (mode === "signup") {
        const problem = passwordProblem(password, confirm);
        if (problem) {
          setErrorMsg(t(problem));
          return;
        }
        const { error } = await supabase.auth.signUp(
          signupCredentials(email, password, name, `${origin}/auth`),
        );
        if (error) {
          setErrorMsg(t(authErrorKey(error)));
          return;
        }
        setSentEmail(true);
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: `${origin}/auth?mode=reset` },
        );
        if (error) {
          setErrorMsg(t(authErrorKey(error)));
          return;
        }
        setSentEmail(true);
      } else if (mode === "reset") {
        const problem = passwordProblem(password, confirm);
        if (problem) {
          setErrorMsg(t(problem));
          return;
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
          setErrorMsg(t(authErrorKey(error)));
          return;
        }
        toast.success(t("authKit.passwordUpdated"));
        void navigate({ to: "/alerts", replace: true });
      } else if (mode === "verify") {
        const { error } = await supabase.auth.resend({
          type: "signup",
          email: email.trim(),
        });
        if (error) {
          setErrorMsg(t(authErrorKey(error)));
          return;
        }
        setSentEmail(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function signInGoogle() {
    setErrorMsg(null);
    const origin =
      typeof window !== "undefined" ? window.location.origin : APP_ORIGIN;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}${search.returnTo || "/alerts"}` },
    });
    if (error) setErrorMsg(t("authKit.googleUnavailable"));
  }

  const titleKey =
    mode === "signup"
      ? "authKit.signupTitle"
      : mode === "forgot"
        ? "authKit.forgotTitle"
        : mode === "reset"
          ? "authKit.resetTitle"
          : mode === "verify"
            ? "authKit.verifyTitle"
            : "authKit.signinTitle";

  const bodyKey =
    mode === "signup"
      ? "authKit.signupBody"
      : mode === "forgot"
        ? "authKit.forgotBody"
        : mode === "reset"
          ? "authKit.resetBody"
          : mode === "verify"
            ? "authKit.verifyBody"
            : "authKit.signinBody";

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-md flex-col justify-center px-4 py-12">
      <AtlasPanel className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <NadhirMark className="h-8 w-8" />
            <span className="font-mono text-xs text-ink-muted">
              {t("common.appName")}
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-ink">
            {t(titleKey)}
          </h1>
          <p className="text-sm text-ink-secondary">{t(bodyKey)}</p>
        </div>

        {sentEmail ? (
          <div className="space-y-4 rounded-xl border border-signal/30 bg-signal-soft p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Mail className="h-4 w-4 text-signal" />
              {t("authKit.checkEmail")}
            </div>
            <p className="text-xs text-ink-secondary leading-relaxed">
              {t("authKit.checkEmailBody")}
            </p>
            <AtlasButton
              variant="secondary"
              size="sm"
              onClick={() => {
                setSentEmail(false);
                setMode("signin");
              }}
            >
              {t("authKit.backSignin")}
            </AtlasButton>
          </div>
        ) : (
          <>
            {(mode === "signin" || mode === "signup") && (
              <div className="space-y-3">
                <AtlasButton
                  variant="secondary"
                  className="w-full"
                  onClick={() => void signInGoogle()}
                >
                  {t("authKit.google")}
                </AtlasButton>
                <div className="flex items-center gap-3 text-xs text-ink-muted">
                  <div className="h-px flex-1 bg-hairline" />
                  <span>{t("authKit.emailDivider")}</span>
                  <div className="h-px flex-1 bg-hairline" />
                </div>
              </div>
            )}

            <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-secondary">
                    {t("authKit.name")}
                  </label>
                  <AtlasInput
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
              )}

              {mode !== "reset" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-secondary">
                    {t("authKit.emailMethod")}
                  </label>
                  <AtlasInput
                    type="email"
                    dir="ltr"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
              )}

              {(mode === "signin" || mode === "signup" || mode === "reset") && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-secondary">
                    {mode === "reset"
                      ? t("authKit.newPassword")
                      : i18n.language === "ar"
                        ? "كلمة المرور"
                        : i18n.language === "fr"
                          ? "Mot de passe"
                          : "Password"}
                  </label>
                  <div className="relative">
                    <AtlasInput
                      type={showPass ? "text" : "password"}
                      dir="ltr"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={
                        mode === "signin" ? "current-password" : "new-password"
                      }
                      className="pe-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      aria-label={
                        showPass
                          ? t("authKit.hidePassword")
                          : t("authKit.showPassword")
                      }
                      className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-ink-muted hover:text-ink cursor-pointer"
                    >
                      {showPass ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {(mode === "signup" || mode === "reset") && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-secondary">
                    {t("authKit.confirmPassword")}
                  </label>
                  <AtlasInput
                    type="password"
                    dir="ltr"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              )}

              {errorMsg && (
                <div
                  role="alert"
                  className="rounded-lg border border-hazard-extreme/35 bg-hazard-extreme-soft px-3 py-2 text-xs text-hazard-extreme"
                >
                  {errorMsg}
                </div>
              )}

              <AtlasButton
                type="submit"
                variant="primary"
                className="w-full"
                disabled={busy}
              >
                <KeyRound className="h-4 w-4" />
                {busy
                  ? t("authKit.working")
                  : mode === "signup"
                    ? t("authKit.signupAction")
                    : mode === "forgot"
                      ? t("authKit.forgotAction")
                      : mode === "reset"
                        ? t("authKit.resetAction")
                        : mode === "verify"
                          ? t("authKit.verifyAction")
                          : t("authKit.signinAction")}
              </AtlasButton>
            </form>

            <div className="flex flex-col gap-2 border-t border-hairline pt-4 text-xs text-ink-secondary">
              {mode === "signin" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setMode("signup")}
                    className="text-start font-medium text-signal hover:underline cursor-pointer"
                  >
                    {t("authKit.createAccount")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="text-start hover:text-ink cursor-pointer"
                  >
                    {t("authKit.forgotLink")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="text-start font-medium text-signal hover:underline cursor-pointer"
                >
                  {t("authKit.backSignin")}
                </button>
              )}
            </div>
          </>
        )}

        <div className="flex items-center justify-between border-t border-hairline pt-3 text-xs text-ink-muted">
          <Link to="/" className="hover:text-ink">
            {t("authKit.backHome")}
          </Link>
        </div>
      </AtlasPanel>
    </div>
  );
}
