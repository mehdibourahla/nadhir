import { useEffect, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createFileRoute,
  useRouterState,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AlertTriangle,
  FileCheck2,
  Flame,
  Gauge,
  History,
  Languages,
  LayoutDashboard,
  Lightbulb,
  MapPin,
  Menu,
  MessageSquareWarning,
  Radio,
  ShieldAlert,
  Users,
  Wrench,
  X,
} from "lucide-react";

import {
  ADMIN_GROUPS,
  sectionsFor,
  type AdminSection,
} from "@/lib/admin-access";
import {
  attentionQuery,
  attentionTotal,
  type AttentionCounts,
} from "@/lib/admin-attention";
import { myRolesQuery } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { cleanCopy } from "@/ui/format";
import { AtlasLoading, AtlasPanel, SafeBdi } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminShell,
});

const SECTION_ICON: Record<string, ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  ita: AlertTriangle,
  fires: Flame,
  reports: MessageSquareWarning,
  translations: Languages,
  ideas: Lightbulb,
  sources: Activity,
  broadcasts: Radio,
  risk: Gauge,
  incidents: FileCheck2,
  places: MapPin,
  people: Users,
  tools: Wrench,
  audit: History,
};

function AdminNavList({
  sections,
  counts,
  pathname,
  onNavigate,
}: {
  sections: AdminSection[];
  counts: AttentionCounts | undefined;
  pathname: string;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation("admin");

  return (
    <nav aria-label={t("shell.title")} className="space-y-5">
      {ADMIN_GROUPS.map((group) => {
        const items = sections.filter((s) => s.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="space-y-1">
            <div className="px-2.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-ink-muted">
              {cleanCopy(t(`groups.${group}`))}
            </div>
            <ul className="space-y-0.5">
              {items.map((section) => {
                const Icon = SECTION_ICON[section.key] ?? LayoutDashboard;
                const badgeCount = attentionTotal(counts, section.attention);
                const active =
                  section.path === "/admin"
                    ? pathname === "/admin" || pathname === "/admin/"
                    : pathname === section.path ||
                      pathname.startsWith(`${section.path}/`);
                return (
                  <li key={section.key}>
                    <Link
                      to={section.path}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-signal-soft text-signal"
                          : "text-ink-secondary hover:bg-surface-raised hover:text-ink",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {cleanCopy(t(`nav.${section.key}`))}
                      </span>
                      {badgeCount > 0 && (
                        <SafeBdi
                          className={cn(
                            "rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                            active
                              ? "bg-signal text-signal-ink"
                              : "bg-hazard-extreme-soft text-hazard-extreme-ink",
                          )}
                        >
                          {badgeCount}
                        </SafeBdi>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function AdminShell() {
  const { t } = useTranslation("admin");
  const roles = useQuery(myRolesQuery);
  const attention = useQuery({
    ...attentionQuery,
    enabled: (roles.data?.length ?? 0) > 0,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (roles.isPending) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-8">
        <AtlasLoading />
      </div>
    );
  }

  const sections = sectionsFor(roles.data ?? []);
  if (sections.length === 0) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <AtlasPanel className="flex items-start gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-hazard-extreme-soft text-hazard-extreme-ink">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <h1 className="font-display text-xl font-semibold text-ink">
              {cleanCopy(t("shell.title"))}
            </h1>
            <p className="text-sm text-ink-secondary leading-relaxed">
              {cleanCopy(t("shell.noAccess"))}
            </p>
          </div>
        </AtlasPanel>
      </main>
    );
  }

  const current =
    [...sections]
      .sort((a, b) => b.path.length - a.path.length)
      .find((s) => pathname === s.path || pathname.startsWith(`${s.path}/`)) ??
    sections[0]!;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-5 md:py-7">
      {/* Mobile / tablet ops menu trigger */}
      <div className="mb-4 flex items-center justify-between gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={t("kit.menu")}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-hairline bg-surface px-3.5 text-sm font-medium text-ink hover:bg-surface-raised transition-colors cursor-pointer"
        >
          <Menu className="h-4 w-4 text-signal" aria-hidden />
          <span>{cleanCopy(t(`nav.${current.key}`))}</span>
        </button>
        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
          {cleanCopy(t("shell.title"))}
        </span>
      </div>

      {/* Mobile slide-over drawer */}
      {menuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={cleanCopy(t("shell.title"))}
          className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-xs md:hidden"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="w-72 max-w-[85vw] h-full overflow-y-auto border-e border-hairline-strong bg-surface p-4 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <span className="font-display text-lg font-semibold text-ink">
                {cleanCopy(t("shell.title"))}
              </span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={t("kit.cancel")}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-raised hover:text-ink cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <AdminNavList
              sections={sections}
              counts={attention.data}
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Desktop Operations Sub-Rail + Content */}
      <div className="flex gap-7 items-start">
        <aside className="sticky top-6 hidden w-56 shrink-0 max-h-[calc(100vh-3rem)] overflow-y-auto rounded-2xl border border-hairline bg-surface p-3 md:block">
          <div className="mb-3 flex items-center justify-between border-b border-hairline px-2 pb-2.5">
            <span className="font-display text-sm font-semibold text-ink">
              {cleanCopy(t("shell.title"))}
            </span>
            <span className="h-2 w-2 rounded-full bg-hazard-clear" />
          </div>
          <AdminNavList
            sections={sections}
            counts={attention.data}
            pathname={pathname}
          />
        </aside>

        <main className="min-w-0 flex-1 pb-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
