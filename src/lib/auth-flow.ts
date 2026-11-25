import { authDestination } from "./auth-destination";

export type AuthMode = "signin" | "signup" | "forgot" | "reset" | "verify";
export function signupCredentials(
  email: string,
  password: string,
  name: string,
  emailRedirectTo: string,
  captchaToken?: string,
) {
  const options: {
    emailRedirectTo: string;
    data: { full_name: string };
    captchaToken?: string;
  } = { emailRedirectTo, data: { full_name: name.trim() } };
  if (captchaToken?.trim()) options.captchaToken = captchaToken.trim();
  return {
    email: email.trim(),
    password,
    options,
  };
}
export function authMode(value: unknown): AuthMode {
  return ["signup", "forgot", "reset", "verify"].includes(String(value))
    ? (value as AuthMode)
    : "signin";
}

export function callbackDestination(destination: unknown, hash: string) {
  const safe = authDestination(destination);
  if (!hash || safe.includes("#") || /[=&]/.test(hash)) return safe;
  return authDestination(`${safe}#${hash}`);
}

export function createRecoveryProof() {
  let userId: string | null = null;
  return {
    observe(event: string, id: string | null) {
      if (event === "PASSWORD_RECOVERY") userId = id;
      else if (event === "SIGNED_OUT" || (id && id !== userId)) userId = null;
    },
    allows(id: string) {
      return userId === id;
    },
    clear() {
      userId = null;
    },
  };
}

// A reload requires a fresh email link; query flags and stored sessions are not recovery proof.
export const recoveryProof = createRecoveryProof();

export function passwordProblem(password: string, confirmation: string) {
  if (password.length < 8) return "authKit.passwordShort";
  if (password !== confirmation) return "authKit.passwordMismatch";
  return null;
}
