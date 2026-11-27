import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Bell,
  CloudSun,
  Compass,
  Flag,
  HeartHandshake,
  History,
  LogIn,
  LogOut,
  Map as MapIcon,
  MapPin,
  Menu,
  Moon,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  User,
  Webhook,
  X,
} from "lucide-react";

import {
  LOCALES,
  LOCALE_SHORT_LABELS,
  applyLocale,
  type AnyLocale,
  type Locale,
} from "@/i18n";
import { applyTheme, readThemeCookie, type Theme } from "@/lib/theme";
import { supabase } from "@/integrations/supabase/client";
import { unreadAlertsQuery } from "@/lib/alerts";
import { myRolesQuery } from "@/lib/reports";
import { signOutAccount } from "@/lib/sign-out";
import { cn } from "@/lib/utils";
import { NadhirMark } from "@/ui/brand";
import { PlaceSearchDialog } from "@/ui/place-search";
import { SafeBdi } from "@/ui/primitives";

type ShellProps = {
  children: ReactNode;
  fullBleed?: boolean;
};

type NavItem = {
  to: "/" | "/forecast" | "/history" | "/survival" | "/status" | "/contribute";
  labelKey: string;
  fallback: string;
  Icon: typeof MapIcon;
  match: (pathname: string) => boolean;
};

const RAIL_ITEMS: NavItem[] = [
  {
    to: "/",
    labelKey: "nav.map",
    fallback: "Map",
    Icon: MapIcon,
    match: (p) => p === "/",
  },
  {
    to: "/forecast",
    labelKey: "nav.forecast",
    fallback: "Forecast",
    Icon: CloudSun,
    match: (p) => p.startsWith("/forecast") || p.startsWith("/wilaya"),
  },
  {
    to: "/history",
    labelKey: "nav.history",
    fallback: "History",
    Icon: History,
    match: (p) => p.startsWith("/history"),
  },
  {
    to: "/survival",
    labelKey: "nav.survival",
    fallback: "Survival",
    Icon: ShieldAlert,
    match: (p) => p.startsWith("/survival"),
  },
  {
    to: "/status",
    labelKey: "nav.status",
    fallback: "Status",
    Icon: Activity,
    match: (p) => p.startsWith("/status"),
  },
  {
    to: "/contribute",
    labelKey: "nav.contribute",
    fallback: "Contribute",
    Icon: HeartHandshake,
    match: (p) => p.startsWith("/contribute"),
  },
];

export function AtlasShell({ children, fullBleed = false }: ShellProps) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;
  const location = useLocation();
  const navigate = useNavigate();

  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const isDarkNow = () => document.documentElement.classList.contains("dark");
    setDark(isDarkNow());
    const observer = new MutationObserver(() => setDark(isDarkNow()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setUserEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const unreadQuery = useQuery({
    ...unreadAlertsQuery,
    enabled: Boolean(userEmail),
    staleTime: 60_000,
  });

  const rolesQuery = useQuery({
    ...myRolesQuery,
    enabled: Boolean(userEmail),
    staleTime: 5 * 60_000,
  });

  const hasAdminRole = (rolesQuery.data ?? []).some(
    (r) => r === "admin" || r === "report_moderator" || r === "operator",
  );
  const unreadCount = unreadQuery.data ?? 0;

  function toggleTheme() {
    const next: Theme = dark ? "light" : "dark";
    applyTheme(next);
    setDark(next === "dark");
  }

  function cycleLocale() {
    const idx = LOCALES.indexOf(locale as Locale);
    const next = LOCALES[(idx + 1) % LOCALES.length] ?? "ar";
    applyLocale(next);
  }

  async function handleSignOut() {
    setAccountOpen(false);
    setMoreOpen(false);
    await signOutAccount();
    setUserEmail(null);
    void navigate({ to: "/" });
  }

  const localeCode = LOCALE_SHORT_LABELS[locale] ?? "AR";

  const railLabel = (item: NavItem) => {
    if (item.to === "/")
      return locale === "ar" ? "الخريطة" : locale === "fr" ? "Carte" : "Map";
    if (item.to === "/forecast")
      return locale === "ar"
        ? "التوقعات"
        : locale === "fr"
          ? "Météo"
          : "Forecast";
    if (item.to === "/history")
      return locale === "ar"
        ? "الأرشيف"
        : locale === "fr"
          ? "Archive"
          : "History";
    if (item.to === "/survival")
      return locale === "ar"
        ? "طوارئ"
        : locale === "fr"
          ? "Urgence"
          : "Survival";
    if (item.to === "/status")
      return locale === "ar" ? "الحالة" : locale === "fr" ? "Statut" : "Status";
    return t(item.labelKey, { defaultValue: item.fallback });
  };

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      {/* Desktop 68px Vertical Start-Edge Instrument Rail (zero top navbar) */}
      <aside
        aria-label={t("nav.menu")}
        className="hidden md:flex fixed inset-y-0 start-0 z-40 w-[68px] flex-col items-center justify-between border-e border-hairline bg-surface py-3"
      >
        <div className="flex flex-col items-center gap-3 w-full">
          <Link
            to="/"
            aria-label={t("common.appName")}
            className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-surface-raised"
          >
            <NadhirMark className="h-8 w-8" />
          </Link>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={t("weather:outlook.searchPlace")}
            title="⌘K"
            className="flex h-9 w-11 flex-col items-center justify-center rounded-lg border border-hairline bg-surface-raised/70 text-ink-secondary hover:border-hairline-strong hover:text-ink transition-colors cursor-pointer"
          >
            <Search className="h-4 w-4" />
          </button>

          <nav className="flex flex-col items-center gap-1 w-full px-1.5 pt-1">
            {RAIL_ITEMS.map((item) => {
              const active = item.match(location.pathname);
              const Icon = item.Icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex w-full flex-col items-center justify-center gap-1 rounded-xl py-2 px-1 transition-colors",
                    active
                      ? "bg-signal-soft text-signal"
                      : "text-ink-secondary hover:bg-surface-raised hover:text-ink",
                  )}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-2 start-0 w-[3px] rounded-e-full bg-signal"
                    />
                  )}
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  <span className="text-[10px] font-medium leading-[1.35] truncate max-w-[60px] px-0.5">
                    {railLabel(item)}
                  </span>
                </Link>
              );
            })}

            <div className="my-1.5 h-px w-8 bg-hairline" />

            <Link
              to="/report"
              aria-current={
                location.pathname.startsWith("/report") ? "page" : undefined
              }
              className={cn(
                "relative flex w-full flex-col items-center justify-center gap-1 rounded-xl py-2 px-1 transition-colors",
                location.pathname.startsWith("/report")
                  ? "bg-hazard-extreme-soft text-hazard-extreme"
                  : "text-hazard-extreme hover:bg-hazard-extreme-soft",
              )}
            >
              <Flag className="h-[17px] w-[17px]" strokeWidth={1.85} />
              <span className="text-[10px] font-medium leading-[1.35] truncate max-w-[60px] px-0.5">
                {locale === "ar"
                  ? "بلاغ"
                  : locale === "fr"
                    ? "Signaler"
                    : "Report"}
              </span>
            </Link>
          </nav>
        </div>

        <div className="flex flex-col items-center gap-1.5 w-full px-1.5">
          <button
            type="button"
            onClick={cycleLocale}
            aria-label="Switch language"
            className="flex h-8 w-11 items-center justify-center rounded-lg border border-hairline bg-surface-raised/50 font-mono text-[11px] font-semibold text-ink hover:border-hairline-strong transition-colors cursor-pointer"
          >
            <SafeBdi>{localeCode}</SafeBdi>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="flex h-8 w-11 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-raised hover:text-ink transition-colors cursor-pointer"
          >
            {dark ? (
              <Sun className="h-[17px] w-[17px]" strokeWidth={1.75} />
            ) : (
              <Moon className="h-[17px] w-[17px]" strokeWidth={1.75} />
            )}
          </button>

          {userEmail ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountOpen((v) => !v)}
                aria-label={t("nav.accountMenu")}
                className="relative flex h-9 w-11 items-center justify-center rounded-xl bg-surface-raised text-ink hover:bg-signal-soft hover:text-signal transition-colors cursor-pointer"
              >
                <User className="h-[18px] w-[18px]" strokeWidth={1.75} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 end-1.5 h-2 w-2 rounded-full bg-hazard-extreme" />
                )}
              </button>

              {accountOpen && (
                <div className="absolute bottom-0 start-[62px] z-50 w-56 rounded-2xl border border-hairline-strong bg-surface p-2 shadow-2xl">
                  <div className="border-b border-hairline px-3 py-2 mb-1">
                    <div className="text-xs font-medium text-ink truncate">
                      <SafeBdi>{userEmail}</SafeBdi>
                    </div>
                  </div>
                  <Link
                    to="/alerts"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-ink hover:bg-surface-raised"
                  >
                    <span className="flex items-center gap-2.5">
                      <Bell className="h-4 w-4 text-ink-secondary" />
                      {locale === "ar"
                        ? "التنبيهات"
                        : locale === "fr"
                          ? "Alertes"
                          : "Alerts"}
                    </span>
                    {unreadCount > 0 && (
                      <span className="rounded-md bg-hazard-extreme px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white tabular-nums">
                        {unreadCount}
                      </span>
                    )}
                  </Link>
                  <Link
                    to="/zones"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink hover:bg-surface-raised"
                  >
                    <MapPin className="h-4 w-4 text-ink-secondary" />
                    {locale === "ar"
                      ? "مناطقي"
                      : locale === "fr"
                        ? "Mes zones"
                        : "My zones"}
                  </Link>
                  <Link
                    to="/webhooks"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink hover:bg-surface-raised"
                  >
                    <Webhook className="h-4 w-4 text-ink-secondary" />
                    Webhooks
                  </Link>
                  <Link
                    to="/settings"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink hover:bg-surface-raised"
                  >
                    <Settings className="h-4 w-4 text-ink-secondary" />
                    {t("nav.settings")}
                  </Link>
                  {hasAdminRole && (
                    <Link
                      to="/admin"
                      onClick={() => setAccountOpen(false)}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-signal hover:bg-signal-soft"
                    >
                      <Compass className="h-4 w-4" />
                      {t("nav.admin")}
                    </Link>
                  )}
                  <div className="my-1 h-px bg-hairline" />
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-hazard-extreme hover:bg-hazard-extreme-soft cursor-pointer"
                  >
                    <LogOut className="h-4 w-4" />
                    {locale === "ar"
                      ? "تسجيل الخروج"
                      : locale === "fr"
                        ? "Déconnexion"
                        : "Sign out"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/auth"
              search={{ returnTo: "/alerts" }}
              aria-label={t("authKit.signinAction")}
              className="flex h-9 w-11 items-center justify-center rounded-xl bg-surface-raised text-ink-secondary hover:bg-signal hover:text-signal-ink transition-colors"
            >
              <LogIn className="h-[17px] w-[17px]" strokeWidth={1.75} />
            </Link>
          )}
        </div>
      </aside>

      {/* Mobile Slim Top Header (< md) */}
      {!fullBleed && (
        <header className="md:hidden sticky top-0 z-30 flex h-[52px] items-center justify-between border-b border-hairline bg-surface/95 backdrop-blur-sm px-3">
          <Link to="/" className="flex items-center gap-2">
            <NadhirMark className="h-7 w-7" />
            <span className="font-display text-base font-semibold text-ink">
              {t("common.appName")}
            </span>
          </Link>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label={t("weather:outlook.searchPlace")}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-raised cursor-pointer"
            >
              <Search className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={cycleLocale}
              aria-label="Switch language"
              className="flex h-8 px-2 items-center justify-center rounded-lg border border-hairline font-mono text-[11px] font-semibold text-ink cursor-pointer"
            >
              <SafeBdi>{localeCode}</SafeBdi>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-raised cursor-pointer"
            >
              {dark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
            <Link
              to={userEmail ? "/settings" : "/auth"}
              aria-label={t("nav.accountMenu")}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-raised text-ink"
            >
              {userEmail ? (
                <User className="h-4 w-4" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
            </Link>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <main
        className={cn(
          "md:ps-[68px]",
          fullBleed
            ? "h-dvh w-full overflow-hidden"
            : "min-h-dvh pb-24 md:pb-12",
        )}
      >
        {children}
      </main>

      {/* Mobile Floating 5-Tab Bottom Pill Dock (< md) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-3 inset-x-3 z-40 mx-auto max-w-md rounded-full border border-hairline-strong bg-surface-hud backdrop-blur-md px-2 py-1.5 shadow-xl"
      >
        <div className="grid grid-cols-5 items-center">
          <Link
            to="/"
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[10px] font-medium transition-colors",
              location.pathname === "/"
                ? "bg-signal-soft text-signal"
                : "text-ink-secondary",
            )}
          >
            <MapIcon className="h-[18px] w-[18px]" strokeWidth={1.8} />
            <span>
              {locale === "ar" ? "الخريطة" : locale === "fr" ? "Carte" : "Map"}
            </span>
          </Link>

          <Link
            to="/forecast"
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[10px] font-medium transition-colors",
              location.pathname.startsWith("/forecast") ||
                location.pathname.startsWith("/wilaya")
                ? "bg-signal-soft text-signal"
                : "text-ink-secondary",
            )}
          >
            <CloudSun className="h-[18px] w-[18px]" strokeWidth={1.8} />
            <span>
              {locale === "ar"
                ? "التوقعات"
                : locale === "fr"
                  ? "Météo"
                  : "Forecast"}
            </span>
          </Link>

          <Link
            to="/survival"
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[10px] font-medium transition-colors",
              location.pathname.startsWith("/survival")
                ? "bg-[#DC2626] text-white"
                : "text-ink-secondary",
            )}
          >
            <ShieldAlert className="h-[18px] w-[18px]" strokeWidth={1.8} />
            <span>
              {locale === "ar"
                ? "طوارئ"
                : locale === "fr"
                  ? "Urgence"
                  : "Survival"}
            </span>
          </Link>

          <Link
            to={userEmail ? "/alerts" : "/auth"}
            className={cn(
              "relative flex flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[10px] font-medium transition-colors",
              location.pathname.startsWith("/alerts")
                ? "bg-signal-soft text-signal"
                : "text-ink-secondary",
            )}
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.8} />
            <span>
              {locale === "ar"
                ? "تنبيهات"
                : locale === "fr"
                  ? "Alertes"
                  : "Alerts"}
            </span>
            {unreadCount > 0 && (
              <span className="absolute top-1 end-4 h-2 w-2 rounded-full bg-hazard-extreme" />
            )}
          </Link>

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[10px] font-medium text-ink-secondary cursor-pointer"
          >
            <Menu className="h-[18px] w-[18px]" strokeWidth={1.8} />
            <span>
              {locale === "ar" ? "المزيد" : locale === "fr" ? "Plus" : "More"}
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile More Drawer */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-end"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMoreOpen(false);
          }}
        >
          <div className="w-full rounded-t-3xl border-t border-hairline-strong bg-surface p-5 pb-8 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <NadhirMark className="h-7 w-7" />
                <span className="font-display text-lg font-semibold text-ink">
                  {t("common.appName")}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label={t("common.close")}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-raised text-ink-secondary cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  to: "/history" as const,
                  icon: History,
                  label:
                    locale === "ar"
                      ? "الأرشيف"
                      : locale === "fr"
                        ? "Historique"
                        : "History",
                },
                {
                  to: "/status" as const,
                  icon: Activity,
                  label:
                    locale === "ar"
                      ? "حالة المصادر"
                      : locale === "fr"
                        ? "Statut"
                        : "Status",
                },
                {
                  to: "/report" as const,
                  icon: Flag,
                  label:
                    locale === "ar"
                      ? "إرسال بلاغ"
                      : locale === "fr"
                        ? "Signaler"
                        : "Report",
                },
                {
                  to: "/contribute" as const,
                  icon: HeartHandshake,
                  label: t("nav.contribute"),
                },
                {
                  to: "/zones" as const,
                  icon: MapPin,
                  label:
                    locale === "ar"
                      ? "مناطقي"
                      : locale === "fr"
                        ? "Mes zones"
                        : "My zones",
                },
                {
                  to: "/settings" as const,
                  icon: Settings,
                  label: t("nav.settings"),
                },
              ].map((entry) => {
                const Icon = entry.icon;
                return (
                  <Link
                    key={entry.to}
                    to={entry.to}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-raised/60 px-3.5 py-3 text-sm font-medium text-ink"
                  >
                    <Icon className="h-4 w-4 text-signal shrink-0" />
                    <span className="truncate">{entry.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3 text-xs text-ink-secondary">
              <div className="flex items-center gap-3">
                <Link to="/about" onClick={() => setMoreOpen(false)}>
                  {locale === "ar"
                    ? "حول"
                    : locale === "fr"
                      ? "À propos"
                      : "About"}
                </Link>
                <Link to="/developers" onClick={() => setMoreOpen(false)}>
                  API
                </Link>
                <Link to="/privacy" onClick={() => setMoreOpen(false)}>
                  {locale === "ar"
                    ? "الخصوصية"
                    : locale === "fr"
                      ? "Confidentialité"
                      : "Privacy"}
                </Link>
                <Link to="/terms" onClick={() => setMoreOpen(false)}>
                  {locale === "ar"
                    ? "الشروط"
                    : locale === "fr"
                      ? "Conditions"
                      : "Terms"}
                </Link>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={cycleLocale}
                  className="rounded-lg border border-hairline px-2.5 py-1.5 font-mono text-xs font-semibold text-ink cursor-pointer"
                >
                  <SafeBdi>{localeCode}</SafeBdi>
                </button>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="rounded-lg border border-hairline p-1.5 text-ink cursor-pointer"
                  aria-label="Toggle theme"
                >
                  {dark ? (
                    <Sun className="h-3.5 w-3.5" />
                  ) : (
                    <Moon className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PlaceSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

export function AtlasPageFooter() {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;
  const currentTheme = readThemeCookie();

  return (
    <footer
      data-theme={currentTheme}
      className="mt-16 border-t border-hairline py-6 text-xs text-ink-secondary"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <NadhirMark className="h-5 w-5" />
          <span className="font-medium text-ink">{t("common.appName")}</span>
          <span className="text-ink-muted">·</span>
          <span>{t("common.tagline")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Link to="/about" className="hover:text-ink transition-colors">
            {locale === "ar" ? "حول" : locale === "fr" ? "À propos" : "About"}
          </Link>
          <Link to="/status" className="hover:text-ink transition-colors">
            {locale === "ar" ? "الحالة" : locale === "fr" ? "Statut" : "Status"}
          </Link>
          <Link to="/developers" className="hover:text-ink transition-colors">
            {locale === "ar"
              ? "المطورون"
              : locale === "fr"
                ? "Développeurs"
                : "Developers"}
          </Link>
          <Link to="/privacy" className="hover:text-ink transition-colors">
            {locale === "ar"
              ? "الخصوصية"
              : locale === "fr"
                ? "Confidentialité"
                : "Privacy"}
          </Link>
          <Link to="/terms" className="hover:text-ink transition-colors">
            {locale === "ar"
              ? "الشروط"
              : locale === "fr"
                ? "Conditions"
                : "Terms"}
          </Link>
        </div>
      </div>
    </footer>
  );
}
