import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Code2, ExternalLink } from "lucide-react";

import type { AnyLocale } from "@/i18n";
import { titledMeta } from "@/lib/page-meta";
import { AtlasPageFooter } from "@/ui/app-shell";
import {
  AtlasBadge,
  AtlasButton,
  AtlasMasthead,
  AtlasPanel,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/developers")({
  head: () => ({
    meta: [
      ...titledMeta("dev.title", "dev.subtitle"),
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DevelopersPage,
});

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/public/v1/status",
    desc: "Live ingestion freshness and source health summary across all feeds.",
  },
  {
    method: "GET",
    path: "/api/public/v1/fires",
    desc: "Active 72-hour satellite fire clusters with stage, FRP, and wind context.",
  },
  {
    method: "GET",
    path: "/api/public/v1/weather",
    desc: "Active non-superseded ONM CAP weather vigilance bulletins.",
  },
  {
    method: "GET",
    path: "/api/public/v1/risk",
    desc: "Current published commune-level Fire Weather Index (FWI) danger levels.",
  },
  {
    method: "GET",
    path: "/api/public/v1/civil",
    desc: "Published civil hazard advisories including road disruptions.",
  },
  {
    method: "GET",
    path: "/api/public/v1/stats",
    desc: "National summary counters and coverage metrics.",
  },
] as const;

function DevelopersPage() {
  const { i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <Code2 className="h-3.5 w-3.5 text-signal" />
            <span>PUBLIC API · V1 · JSON</span>
          </>
        }
        title={
          locale === "ar"
            ? "واجهة برمجة التطبيقات للمطورين"
            : locale === "fr"
              ? "API publique & Développeurs"
              : "Developers & Public API"
        }
        subtitle={
          locale === "ar"
            ? "نقاط نهاية JSON مفتوحة لدمج بيانات المخاطر وحالة المصادر في تطبيقاتك."
            : locale === "fr"
              ? "Points d'accès JSON ouverts pour intégrer les vigilances, incendies et statuts de sources."
              : "Open read-only JSON endpoints for civic tools, newsrooms, and research integrations."
        }
        actions={
          <Link to="/webhooks">
            <AtlasButton variant="primary" size="sm">
              Manage webhooks
            </AtlasButton>
          </Link>
        }
      />

      <div className="divide-y divide-hairline border-y border-hairline bg-surface">
        {ENDPOINTS.map((ep) => (
          <div
            key={ep.path}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4"
          >
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2.5">
                <AtlasBadge tone="signal">
                  <SafeBdi className="font-mono">{ep.method}</SafeBdi>
                </AtlasBadge>
                <SafeBdi className="font-mono text-sm font-semibold text-ink">
                  {ep.path}
                </SafeBdi>
              </div>
              <p className="text-xs text-ink-secondary">{ep.desc}</p>
            </div>
            <a
              href={ep.path}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-signal hover:underline shrink-0"
            >
              JSON
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ))}
      </div>

      <AtlasPanel className="mt-6 space-y-2">
        <div className="font-mono text-xs text-ink-muted">EXAMPLE</div>
        <pre
          dir="ltr"
          className="overflow-x-auto rounded-xl bg-surface-raised p-4 font-mono text-xs text-ink"
        >
          curl -s https://nadhir.app/api/public/v1/status | jq .
        </pre>
      </AtlasPanel>

      <AtlasPageFooter />
    </div>
  );
}
