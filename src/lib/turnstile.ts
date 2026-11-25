export type TurnstileLanguage = "ar" | "fr" | "en";

export function turnstileLanguage(locale: string): TurnstileLanguage {
  const base = locale.split("-")[0]?.toLowerCase() ?? "en";
  if (base === "ar") return "ar";
  if (base === "fr" || base === "kab") return "fr";
  return "en";
}

export function readConfiguredTurnstileSiteKey(explicit?: string): string {
  const fromProp = explicit?.trim();
  if (fromProp) return fromProp;
  const fromEnv = (
    import.meta.env?.["VITE_TURNSTILE_SITE_KEY"] as string | undefined
  )?.trim();
  return fromEnv ?? "";
}

export function isTurnstileSiteKeyConfigured(siteKey?: string): boolean {
  return readConfiguredTurnstileSiteKey(siteKey).length > 0;
}
