import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CalendarDays,
  Check,
  MapPin,
  Menu,
  Monitor,
  Moon,
  Settings,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useTranslation } from "react-i18next";

import { BrandMark } from "@/components/BrandMark";
import { AccountMenu } from "@/components/AccountMenu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SubscribeSheet } from "@/components/nadhir/SubscribeSheet";
import { RISK_LEVELS, riskSolid } from "@/components/nadhir/risk-visuals";
import {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  RTL_LOCALES,
  applyLocale,
} from "@/i18n";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { dangerLevelKey } from "@/lib/nadhir";
import {
  applyTheme,
  nextTheme,
  readThemeCookie,
  type Theme,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { canReachPanel } from "@/lib/admin-access";

const PRIMARY_NAV = [
  { to: "/", key: "nav.map" },
  { to: "/forecast", key: "nav.forecast" },
  { to: "/history", key: "nav.history" },
  { to: "/status", key: "nav.status" },
  { to: "/about", key: "nav.about" },
  { to: "/contribute", key: "nav.contribute" },
] as const;

const ADMIN_NAV = { to: "/admin", key: "nav.admin" } as const;
const ACCOUNT_NAV = [
  { to: "/zones", key: "nav.account" },
  { to: "/alerts", key: "nav.alerts" },
  { to: "/settings", key: "nav.settings" },
] as const;

const TABS = [
  { to: "/", key: "nav.map", Icon: MapPin },
  { to: "/forecast", key: "nav.forecast", Icon: CalendarDays },
  { to: "/alerts", key: "nav.alerts", Icon: Bell },
  { to: "/settings", key: "nav.settings", Icon: Settings },
] as const;

function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const current =
    i18n.language === "kab"
      ? "kab"
      : (LOCALES.find((locale) => locale === i18n.language) ?? LOCALES[0]);
  const rtl = (RTL_LOCALES as readonly string[]).includes(current);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${t("nav.language")}: ${LOCALE_LABELS[current]}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {LOCALE_SHORT_LABELS[current]}
      </PopoverTrigger>
      <PopoverContent
        align={rtl ? "start" : "end"}
        sideOffset={8}
        collisionPadding={12}
        className="w-56 rounded-2xl p-1.5"
        aria-label={t("nav.language")}
        aria-describedby={undefined}
      >
        <div className="space-y-1">
          {LOCALES.map((locale) => (
            <button
              key={locale}
              type="button"
              lang={locale}
              onClick={() => {
                applyLocale(locale);
                setOpen(false);
              }}
              aria-pressed={current === locale}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start text-sm transition-colors",
                current === locale
                  ? "bg-[var(--accent-tint)] text-[var(--accent)]"
                  : "hover:bg-muted",
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-current/15 text-xs font-semibold">
                {LOCALE_SHORT_LABELS[locale]}
              </span>
              <span dir="auto">{LOCALE_LABELS[locale]}</span>
              {current === locale ? (
                <Check aria-hidden className="ms-auto size-4" />
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

function ThemeToggle() {
  const { t } = useTranslation();
  // Starts at "system" and syncs on mount so SSR and hydration render the same icon.
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => setTheme(readThemeCookie()), []);
  const Icon = THEME_ICON[theme];
  const label = t(
    theme === "system"
      ? "nav.themeSystem"
      : theme === "light"
        ? "nav.themeLight"
        : "nav.themeDark",
  );
  return (
    <button
      type="button"
      onClick={() => {
        const next = nextTheme(theme);
        applyTheme(next);
        setTheme(next);
      }}
      aria-label={label}
      title={label}
      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}

function SubscribeBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("push.bell")}
        title={t("push.bell")}
        className="flex size-11 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--accent)] text-[var(--accent)] transition-colors hover:bg-[var(--accent-tint)]"
      >
        <Bell aria-hidden className="size-4" />
      </button>
      {open ? (
        <SubscribeSheet open={open} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/** Below lg the inline nav is hidden, so without this the only way to any page
 * that is not a bottom tab is the footer. */
function MobileNav({ hasPanelAccess }: { hasPanelAccess: boolean }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  // the sheet has no logical side, so it must follow the locale or it opens from
  // the opposite edge to the button that summoned it in Arabic
  const side = RTL_LOCALES.includes(
    i18n.language as (typeof RTL_LOCALES)[number],
  )
    ? "right"
    : "left";
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={t("nav.menu")}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Menu aria-hidden className="size-5" />
      </SheetTrigger>
      <SheetContent side={side} className="w-[17rem] p-0">
        <SheetHeader className="border-b border-border py-3 pe-12 ps-4 text-start">
          <SheetTitle className="font-display text-base">
            {t("nav.menu")}
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-0.5 p-2" aria-label={t("nav.menu")}>
          <Link
            to="/survival"
            onClick={() => setOpen(false)}
            className="mb-1 flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"
            style={{
              backgroundColor: "var(--emergency-surface)",
              borderColor: "var(--emergency)",
              color: "var(--emergency-ink)",
            }}
          >
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            <span>{t("track3.emergency.openSheet")}</span>
          </Link>
          {[
            ...PRIMARY_NAV,
            ...ACCOUNT_NAV,
            ...(hasPanelAccess ? [ADMIN_NAV] : []),
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:font-medium [&.active]:text-foreground"
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

export function SiteHeader() {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const userId = user?.id ?? null;
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const roles = useQuery({
    queryKey: ["roles", "navigation", userId],
    enabled: userId !== null,
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return data.map((row) => row.role);
    },
  });
  const hasPanelAccess =
    userId !== null && !roles.isError && canReachPanel(roles.data ?? []);
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-0.5 px-1 sm:gap-3 sm:px-4">
        <MobileNav hasPanelAccess={hasPanelAccess} />
        <Link
          to="/"
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 sm:justify-start sm:gap-2"
        >
          <BrandMark className="h-7 w-7 shrink-0 rounded-[7px]" />
          {/* below 360px the wordmark plus the controls no longer fit; the logo carries it */}
          <span className="truncate font-display text-lg font-semibold max-[359px]:hidden">
            {t("common.appName")}
          </span>
          <span className="hidden text-xs text-muted-foreground xl:inline">
            {t("common.tagline")}
          </span>
        </Link>

        <nav
          className="ms-4 hidden items-center gap-1 lg:flex"
          aria-label={t("nav.map")}
        >
          {(hasPanelAccess ? [...PRIMARY_NAV, ADMIN_NAV] : PRIMARY_NAV).map(
            (item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:font-medium [&.active]:text-foreground"
              >
                {t(item.key)}
              </Link>
            ),
          )}
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-0.5 sm:gap-2">
          <Link
            to="/survival"
            aria-label={t("track3.emergency.headerChipLabel")}
            className="hidden min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold sm:inline-flex"
            style={{
              backgroundColor: "var(--emergency-surface)",
              borderColor: "var(--emergency)",
              color: "var(--emergency-ink)",
            }}
          >
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            <span dir="ltr" className="tabular-nums font-bold">
              {t("track3.emergency.headerChip")}
            </span>
          </Link>
          <LanguageSwitcher />
          <SubscribeBell />
          <ThemeToggle />
          <AccountMenu user={user} hasPanelAccess={hasPanelAccess} />
        </div>
      </div>
    </header>
  );
}

export function BottomTabs() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("nav.map")}
      className="sticky bottom-0 z-20 grid grid-cols-4 border-t border-border bg-surface lg:hidden"
    >
      {TABS.map(({ to, key, Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: to === "/" }}
          className="flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] text-muted-foreground [&.active]:text-[var(--accent)]"
        >
          <Icon aria-hidden className="size-5 shrink-0" />
          <span className="max-w-full truncate">{t(key)}</span>
        </Link>
      ))}
    </nav>
  );
}

export function EmergencyNumbers({
  compact = false,
  showSheetLink = true,
}: {
  compact?: boolean;
  showSheetLink?: boolean;
}) {
  const { t } = useTranslation();
  const numbers = [
    { label: t("emergency.civil"), number: "14" },
    { label: t("emergency.forest"), number: "1070" },
    { label: t("emergency.general"), number: "112" },
  ];

  return (
    <section
      className={cn("rounded-xl px-4 py-3", compact ? "text-xs" : "text-sm")}
      style={{ backgroundColor: "var(--emergency-surface)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          className="flex items-center gap-2 font-medium"
          style={{ color: "var(--emergency-ink)", fontFamily: "inherit" }}
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {t("emergency.title")}
        </h2>
        {showSheetLink ? (
          <Link
            to="/survival"
            className="inline-flex min-h-11 items-center rounded-md px-2 text-xs font-semibold underline underline-offset-2"
            style={{ color: "var(--emergency-ink)" }}
          >
            {t("track3.emergency.openSheet")}
          </Link>
        ) : null}
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {numbers.map((n) => (
          <li key={n.number} className="flex items-center">
            <a
              href={`tel:${n.number}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--emergency-ink)" }}
            >
              <span>{n.label}</span>
              <span dir="ltr" className="tabular-nums font-bold underline">
                {n.number}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RiskLegend({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">
        {t("risk.legend")}
      </span>
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
        {RISK_LEVELS.map((level) => (
          <li key={level} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{
                backgroundColor: riskSolid(level),
                boxShadow: "0 0 0 1.5px var(--mark-ring)",
              }}
            />
            <span className="tabular text-muted-foreground">{level}</span>
            <span>{t(`risk.${dangerLevelKey(level)}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs text-muted-foreground">
        <span>{t("common.appName")}</span>
        <Link
          to="/about"
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 hover:text-foreground"
        >
          {t("nav.about")}
        </Link>
        <Link
          to="/developers"
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 hover:text-foreground"
        >
          {t("nav.developers")}
        </Link>
        <Link
          to="/status"
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 hover:text-foreground"
        >
          {t("nav.status")}
        </Link>
        <Link
          to="/contribute"
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 font-semibold text-[var(--accent)] hover:opacity-80"
        >
          {t("nav.contribute")}
        </Link>
        <Link
          to="/terms"
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 hover:text-foreground"
        >
          {t("legal.terms")}
        </Link>
        <Link
          to="/privacy"
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 hover:text-foreground"
        >
          {t("legal.privacy")}
        </Link>
        <span className="ms-auto">{t("about.attribution")}</span>
      </div>
    </footer>
  );
}
