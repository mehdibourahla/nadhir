const KNOWN: Record<string, string> = {
  invalid_credentials: "account.errorInvalidCredentials",
  email_not_confirmed: "account.errorEmailNotConfirmed",
  user_already_exists: "account.errorUserExists",
  email_exists: "account.errorUserExists",
  weak_password: "account.errorWeakPassword",
  over_email_send_rate_limit: "account.errorRateLimited",
  over_request_rate_limit: "account.errorRateLimited",
  captcha_failed: "turnstile.failed",
};

// provider messages are English-only and leak transport detail, so only mapped
// codes reach the user; everything else is reported as a service outage
export function authErrorKey(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && KNOWN[code]) return KNOWN[code];
  return "account.errorUnavailable";
}
