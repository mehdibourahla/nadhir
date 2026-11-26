import {
  createFileRoute,
  Link,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
  ShieldCheck,
} from "lucide-react";
import {
  googleSignInAvailable,
  supabase,
} from "@/integrations/supabase/client";
import { authErrorKey } from "@/lib/auth-errors";
import { authDestination, resolveAuthLocale } from "@/lib/auth-destination";
import type { AnyLocale } from "@/i18n";
import {
  authMode,
  callbackDestination,
  passwordProblem,
  recoveryProof,
  signupCredentials,
  type AuthMode,
} from "@/lib/auth-flow";
import { PasswordField, authInputClass } from "@/components/auth/PasswordField";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { isTurnstileSiteKeyConfigured } from "@/lib/turnstile";
import { titledMeta } from "@/lib/page-meta";
import {
  appleSignInAvailable,
  nativeApple,
  nativeGoogle,
  signInCancelled,
} from "@/lib/native-auth";
import { APP_ORIGIN, NATIVE, openOnWeb } from "@/lib/platform";

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
const primary =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground disabled:opacity-60";
const textButton =
  "min-h-11 rounded-md px-2 py-2 text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50";

function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const hash = useLocation({ select: (location) => location.hash });
  const returnTo = callbackDestination(search.returnTo, hash);
  const [mode, setMode] = useState<AuthMode>(
    NATIVE ? "signin" : (search.mode ?? "signin"),
  );
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<"signup" | "recovery" | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [complete, setComplete] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const captchaRequired =
    !NATIVE &&
    isTurnstileSiteKeyConfigured() &&
    (mode === "signup" || mode === "forgot" || mode === "verify");
  const modeRef = useRef(mode);
  const previousSearchMode = useRef(search.mode ?? "signin");
  const requestGeneration = useRef(0);
  modeRef.current = mode;
  useEffect(() => {
    const next = search.mode ?? "signin";
    if (previousSearchMode.current === next) return;
    previousSearchMode.current = next;
    requestGeneration.current += 1;
    setBusy(false);
    setMode(next);
    setError(null);
    setSent(null);
    setComplete(false);
    setPassword("");
    setConfirmation("");
    setCaptchaToken(null);
    setCaptchaResetKey((prev) => prev + 1);
  }, [search.mode]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    let cancelled = false;
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const callbackError =
      url.searchParams.has("error") || fragment.has("error");
    const callbackAttempt =
      url.searchParams.has("code") ||
      fragment.has("access_token") ||
      callbackError;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session && !cancelled) {
        modeRef.current = "reset";
        setMode("reset");
        setRecoveryReady(true);
        setError(null);
      }
      if (event === "SIGNED_OUT" && !cancelled) setRecoveryReady(false);
    });
    void (async () => {
      try {
        // The browser SDK exchanges callback credentials once during initialization.
        const initialized = await supabase.auth.initialize();
        const { data, error: userError } = await supabase.auth.getUser();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        if (cancelled) return;
        if (data.user?.email)
          setEmail((current) => current || data.user.email || "");
        const recovery = data.user && recoveryProof.allows(data.user.id);
        const unconsumedCode = new URL(window.location.href).searchParams.has(
          "code",
        );
        if (callbackAttempt) {
          const cleanParams = new URLSearchParams({
            mode:
              recovery || modeRef.current === "reset"
                ? "reset"
                : modeRef.current,
            returnTo,
          });
          if (search.lang) cleanParams.set("lang", search.lang);
          window.history.replaceState(
            window.history.state,
            "",
            `/auth?${cleanParams}`,
          );
        }
        if (
          callbackError ||
          initialized.error ||
          unconsumedCode ||
          (callbackAttempt && userError)
        ) {
          recoveryProof.clear();
          setRecoveryReady(false);
          setError("authKit.linkInvalid");
        } else if (recovery) {
          setMode("reset");
          setRecoveryReady(true);
        } else if (modeRef.current === "reset") setError("authKit.linkInvalid");
        else if (
          !userError &&
          data.user &&
          ["signin", "signup", "verify"].includes(modeRef.current)
        )
          void navigate({ href: returnTo, replace: true });
      } catch {
        if (!cancelled) setError("account.errorUnavailable");
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate, returnTo]);
  function changeMode(next: AuthMode) {
    if (busy) return;
    // email links complete in the browser, which cannot see the app's PKCE verifier
    if (NATIVE && next !== "signin") {
      openOnWeb(`/auth?${new URLSearchParams({ mode: next })}`);
      return;
    }
    setMode(next);
    setError(null);
    setSent(null);
    setPassword("");
    setConfirmation("");
    setComplete(false);
    setCaptchaToken(null);
    setCaptchaResetKey((prev) => prev + 1);
    void navigate({
      to: "/auth",
      search: {
        mode: next,
        returnTo,
        ...(search.lang ? { lang: search.lang } : {}),
      },
      replace: true,
    });
  }
  function redirectTo(next: AuthMode = "signin") {
    const origin = NATIVE ? APP_ORIGIN : window.location.origin;
    const params = new URLSearchParams({ mode: next, returnTo });
    if (search.lang) params.set("lang", search.lang);
    return `${origin}/auth?${params}`;
  }
  async function sendEmail(kind: "signup" | "recovery") {
    const generation = requestGeneration.current;
    const token = captchaToken?.trim() || undefined;
    const result =
      kind === "signup"
        ? await supabase.auth.resend({
            type: "signup",
            email: email.trim(),
            options: {
              emailRedirectTo: redirectTo(),
              ...(token ? { captchaToken: token } : {}),
            },
          })
        : await supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: redirectTo("reset"),
            ...(token ? { captchaToken: token } : {}),
          });
    if (generation !== requestGeneration.current) return;
    setCaptchaToken(null);
    setCaptchaResetKey((prev) => prev + 1);
    if (result.error) throw result.error;
    setSent(kind);
    setCooldown(60);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const generation = requestGeneration.current;
    setBusy(true);
    setError(null);
    try {
      if (mode === "reset") {
        const problem = passwordProblem(password, confirmation);
        if (problem) {
          setError(problem);
          return;
        }
        const { data, error: validationError } = await supabase.auth.getUser();
        if (generation !== requestGeneration.current) return;
        if (
          validationError ||
          !data.user ||
          !recoveryProof.allows(data.user.id)
        ) {
          setRecoveryReady(false);
          setError("authKit.linkInvalid");
          return;
        }
        const { error: updateError } = await supabase.auth.updateUser({
          password,
        });
        if (generation !== requestGeneration.current) return;
        if (updateError) throw updateError;
        recoveryProof.clear();
        setPassword("");
        setConfirmation("");
        setComplete(true);
      } else if (mode === "forgot" || mode === "verify")
        await sendEmail(mode === "forgot" ? "recovery" : "signup");
      else if (mode === "signup") {
        const problem = passwordProblem(password, confirmation);
        if (problem) {
          setError(problem);
          return;
        }
        const { data, error: signupError } = await supabase.auth.signUp(
          signupCredentials(
            email,
            password,
            name,
            redirectTo(),
            captchaToken ?? undefined,
          ),
        );
        if (generation !== requestGeneration.current) return;
        setCaptchaToken(null);
        setCaptchaResetKey((prev) => prev + 1);
        if (signupError) throw signupError;
        setPassword("");
        setConfirmation("");
        if (data.session) void navigate({ href: returnTo, replace: true });
        else {
          setSent("signup");
          setCooldown(60);
        }
      } else {
        const { error: signinError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (generation !== requestGeneration.current) return;
        if (signinError) throw signinError;
        void navigate({ href: returnTo, replace: true });
      }
    } catch (err) {
      if (generation === requestGeneration.current) setError(authErrorKey(err));
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }
  async function google() {
    const generation = requestGeneration.current;
    setBusy(true);
    setError(null);
    try {
      const available = await googleSignInAvailable();
      if (generation !== requestGeneration.current) return;
      if (!available) {
        setError("authKit.googleUnavailable");
        setBusy(false);
        return;
      }
      if (NATIVE) {
        await nativeGoogle();
        if (generation !== requestGeneration.current) return;
        void navigate({ href: returnTo, replace: true });
        return;
      }
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectTo() },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      if (generation !== requestGeneration.current) return;
      if (!signInCancelled(err)) setError("authKit.googleUnavailable");
      setBusy(false);
    }
  }
  async function apple() {
    const generation = requestGeneration.current;
    setBusy(true);
    setError(null);
    try {
      await nativeApple();
      if (generation !== requestGeneration.current) return;
      void navigate({ href: returnTo, replace: true });
    } catch (err) {
      if (generation !== requestGeneration.current) return;
      if (!signInCancelled(err)) setError(authErrorKey(err));
      setBusy(false);
    }
  }
  const title = complete
    ? "passwordUpdated"
    : sent
      ? "checkEmail"
      : `${mode}Title`;
  const intro = complete
    ? "passwordUpdatedBody"
    : sent
      ? "checkEmailBody"
      : `${mode}Body`;
  return (
    <div className="mx-auto w-full max-w-[480px] px-4 py-8 sm:py-14">
      <Link
        to="/"
        className={`${textButton} mb-5 inline-flex items-center gap-2`}
      >
        <ArrowLeft className="rtl:rotate-180" size={16} />
        {t("authKit.backHome")}
      </Link>
      <div className="panel p-5 sm:p-8">
        <div className="mb-5 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {complete ? <CheckCircle2 /> : sent ? <Mail /> : <ShieldCheck />}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(`authKit.${title}`)}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t(`authKit.${intro}`)}
        </p>
        {error && (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {t(error)}
          </p>
        )}
        {checking ? (
          <p
            role="status"
            className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2 className="animate-spin" size={18} />
            {t("authKit.checking")}
          </p>
        ) : complete ? (
          <a className={`${primary} mt-6`} href={returnTo}>
            {t("authKit.continue")}
          </a>
        ) : sent ? (
          <div className="mt-6 space-y-3" aria-live="polite">
            <p className="break-words text-sm font-medium" dir="auto">
              {email}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("authKit.emailHint")}
            </p>
            {!NATIVE && isTurnstileSiteKeyConfigured() && (
              <TurnstileWidget
                action={`auth_${sent}`}
                resetKey={captchaResetKey}
                onVerify={(token) => setCaptchaToken(token)}
                onExpire={() => setCaptchaToken(null)}
                onError={() => setCaptchaToken(null)}
              />
            )}
            <button
              className={primary}
              disabled={
                busy || cooldown > 0 || (captchaRequired && !captchaToken)
              }
              onClick={() => {
                const generation = requestGeneration.current;
                setBusy(true);
                setError(null);
                void sendEmail(sent)
                  .catch((err) => {
                    if (generation === requestGeneration.current)
                      setError(authErrorKey(err));
                  })
                  .finally(() => {
                    if (generation === requestGeneration.current)
                      setBusy(false);
                  });
              }}
            >
              {cooldown > 0
                ? t("authKit.resendCountdown", { count: cooldown })
                : t("authKit.resend")}
            </button>
            <button
              className={textButton}
              disabled={busy}
              onClick={() => {
                setSent(null);
                setCaptchaToken(null);
                setCaptchaResetKey((prev) => prev + 1);
                setMode(sent === "signup" ? "verify" : "forgot");
              }}
            >
              {t("authKit.changeEmail")}
            </button>
            <button
              disabled={busy}
              className={textButton}
              onClick={() => changeMode("signin")}
            >
              {t("authKit.backSignin")}
            </button>
          </div>
        ) : mode === "reset" && !recoveryReady ? (
          <button
            className={`${primary} mt-6`}
            onClick={() => changeMode("forgot")}
          >
            {t("authKit.requestNewLink")}
          </button>
        ) : (
          <>
            <form onSubmit={submit} className="mt-6 space-y-4" aria-busy={busy}>
              {(mode === "signin" || mode === "signup") && (
                <>
                  {NATIVE && appleSignInAvailable() && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void apple()}
                      className="flex min-h-12 w-full items-center justify-center gap-3 rounded-lg bg-foreground px-4 py-3 text-base font-medium text-background disabled:opacity-60"
                    >
                      <svg
                        aria-hidden="true"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
                      </svg>
                      {t("authKit.apple")}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void google()}
                    className="flex min-h-12 w-full items-center justify-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-base font-medium hover:bg-muted disabled:opacity-60"
                  >
                    <svg
                      aria-hidden="true"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="#4285F4"
                        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M6.4 13.93A6 6 0 0 1 6.09 12c0-.67.11-1.32.31-1.93V7.48H3.06A10 10 0 0 0 2 12c0 1.61.38 3.14 1.06 4.52l3.34-2.59Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.61 9.61 0 0 0 12 2a10 10 0 0 0-8.94 5.48l3.34 2.59c.79-2.36 3-4.12 5.6-4.12Z"
                      />
                    </svg>
                    {t("authKit.google")}
                  </button>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    {t("authKit.emailDivider")}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </>
              )}
              {mode === "signup" && (
                <label className="block text-sm font-medium">
                  {t("authKit.name")}
                  <input
                    className={`${authInputClass} mt-2`}
                    autoComplete="name"
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                </label>
              )}
              {mode !== "reset" && (
                <label className="block text-sm font-medium">
                  {t("account.email")}
                  <input
                    className={`${authInputClass} mt-2`}
                    type="email"
                    required
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </label>
              )}
              {(mode === "signin" || mode === "signup" || mode === "reset") && (
                <PasswordField
                  id="password"
                  label={t(
                    mode === "reset"
                      ? "authKit.newPassword"
                      : "account.password",
                  )}
                  value={password}
                  onChange={setPassword}
                  newPassword={mode !== "signin"}
                  disabled={busy}
                />
              )}
              {(mode === "signup" || mode === "reset") && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t("authKit.passwordHint")}
                  </p>
                  <PasswordField
                    id="confirm-password"
                    label={t("authKit.confirmPassword")}
                    value={confirmation}
                    onChange={setConfirmation}
                    newPassword
                    disabled={busy}
                  />
                </>
              )}
              {mode === "signin" && (
                <div className="text-end">
                  <button
                    type="button"
                    className={textButton}
                    onClick={() => changeMode("forgot")}
                    disabled={busy}
                  >
                    {t("authKit.forgotLink")}
                  </button>
                </div>
              )}
              {!NATIVE &&
                (mode === "signup" ||
                  mode === "forgot" ||
                  mode === "verify") && (
                  <TurnstileWidget
                    action={`auth_${mode}`}
                    resetKey={captchaResetKey}
                    onVerify={(token) => setCaptchaToken(token)}
                    onExpire={() => setCaptchaToken(null)}
                    onError={() => setCaptchaToken(null)}
                  />
                )}
              <button
                disabled={
                  busy ||
                  ((mode === "forgot" || mode === "verify") && cooldown > 0) ||
                  (captchaRequired && !captchaToken)
                }
                className={primary}
              >
                {busy && <Loader2 className="animate-spin" size={18} />}
                {t(busy ? "authKit.working" : `authKit.${mode}Action`)}
              </button>
            </form>
            <div className="mt-5 border-t border-border pt-3 text-center">
              {mode === "signin" ? (
                <>
                  <button
                    className={textButton}
                    disabled={busy}
                    onClick={() => changeMode("signup")}
                  >
                    {t("authKit.createAccount")}
                  </button>
                  <button
                    className={`${textButton} block w-full text-muted-foreground`}
                    disabled={busy}
                    onClick={() => changeMode("verify")}
                  >
                    {t("authKit.verifyLink")}
                  </button>
                </>
              ) : (
                <button
                  className={textButton}
                  disabled={busy}
                  onClick={() => changeMode("signin")}
                >
                  {t("authKit.backSignin")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
        {t("authKit.publicAccess")}
      </p>
    </div>
  );
}
