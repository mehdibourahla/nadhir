import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AdminNav } from "@/components/admin/AdminNav";
import { useEndSide } from "@/hooks/use-end-side";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { sectionsFor } from "@/lib/admin-access";
import { myRolesQuery } from "@/lib/reports";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminShell,
});

function AdminShell() {
  const { t } = useTranslation("admin");
  const roles = useQuery(myRolesQuery);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const side = useEndSide() === "right" ? "left" : "right";

  if (roles.isPending)
    return (
      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-8">
        <Skeleton className="hidden h-96 w-56 md:block" />
        <Skeleton className="h-96 flex-1" />
      </div>
    );

  const sections = sectionsFor(roles.data ?? []);
  if (sections.length === 0)
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">{t("shell.noAccess")}</p>
      </main>
    );

  const current =
    [...sections]
      .sort((a, b) => b.path.length - a.path.length)
      .find((s) => pathname === s.path || pathname.startsWith(`${s.path}/`)) ??
    sections[0]!;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:py-8">
      <div className="mb-4 flex items-center gap-2 md:hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMenuOpen(true)}
          aria-label={t("kit.menu")}
        >
          <Menu aria-hidden />
          {t(`nav.${current.key}`)}
        </Button>
      </div>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side={side} className="w-72 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("shell.title")}</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <AdminNav
              sections={sections}
              onNavigate={() => setMenuOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
      <div className="flex gap-8">
        <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] w-56 shrink-0 overflow-y-auto md:block">
          <AdminNav sections={sections} />
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
      <Toaster position="bottom-center" />
    </div>
  );
}
