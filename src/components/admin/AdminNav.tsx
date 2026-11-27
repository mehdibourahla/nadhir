import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  Flame,
  Gauge,
  Inbox,
  MapPin,
  Megaphone,
  Languages,
  Lightbulb,
  MessageSquareWarning,
  Newspaper,
  ScrollText,
  Siren,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { ADMIN_GROUPS, type AdminSection } from "@/lib/admin-access";
import { attentionQuery, attentionTotal } from "@/lib/admin-attention";

const ICONS: Record<string, LucideIcon> = {
  overview: Inbox,
  ita: Newspaper,
  fires: Flame,
  reports: MessageSquareWarning,
  translations: Languages,
  ideas: Lightbulb,
  sources: Activity,
  broadcasts: Megaphone,
  risk: Gauge,
  incidents: Siren,
  places: MapPin,
  people: Users,
  audit: ScrollText,
  tools: Wrench,
};

export function AdminNav({
  sections,
  onNavigate,
}: {
  sections: AdminSection[];
  onNavigate?: () => void;
}) {
  const { t } = useTranslation("admin");
  const attention = useQuery(attentionQuery);
  return (
    <nav aria-label={t("shell.title")} className="space-y-5">
      {ADMIN_GROUPS.map((group) => {
        const items = sections.filter((section) => section.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            {group !== "overview" ? (
              <p className="mb-1 px-3 text-xs font-medium text-muted-foreground">
                {t(`groups.${group}`)}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {items.map((section) => {
                const Icon = ICONS[section.key] ?? Inbox;
                const count = attentionTotal(attention.data, section.attention);
                return (
                  <li key={section.key}>
                    <Link
                      to={section.path}
                      onClick={onNavigate}
                      activeOptions={{ exact: section.path === "/admin" }}
                      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                      activeProps={{
                        className: "bg-muted font-medium text-foreground",
                      }}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {t(`nav.${section.key}`)}
                      </span>
                      {count > 0 ? (
                        <span className="rounded-full bg-foreground/10 px-1.5 text-xs tabular-nums text-foreground">
                          {count > 99 ? "99+" : count}
                        </span>
                      ) : null}
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
