import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { pageMeta } from "@/lib/page-meta";

const POLICY_VERSION = "2026-11-25";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      ...pageMeta("legal.privacyMetaTitle", "legal.privacyMetaDescription"),
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { t } = useTranslation();
  const sections = [
    "collect",
    "use",
    "retention",
    "sharing",
    "app",
    "rights",
    "contact",
  ] as const;

  const anpdpSections = [
    ["legalFrameworkTitle", "legalFrameworkBody"],
    ["minimizationTitle", "minimizationBody"],
    ["crossBorderTitle", "crossBorderBody"],
    ["retentionTitle", "retentionBody"],
    ["anpdpRightsTitle", "anpdpRightsBody"],
  ] as const;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-md border border-border bg-muted px-2.5 py-1 font-medium text-foreground">
          {t("privacyCompliance.badge")}
        </span>
        <span>
          {t("privacyCompliance.policyVersionLabel", {
            version: POLICY_VERSION,
          })}
        </span>
      </div>

      <h1 className="mt-3 text-2xl">{t("legal.privacyTitle")}</h1>

      <div className="panel mt-4 space-y-4 p-5">
        {sections.map((s) => (
          <section key={s}>
            <h2 className="text-base font-semibold">
              {t(`legal.privacy_${s}_title`)}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t(`legal.privacy_${s}_body`)}
            </p>
          </section>
        ))}
      </div>

      <div className="panel mt-5 space-y-4 p-5">
        {anpdpSections.map(([titleKey, bodyKey]) => (
          <section key={titleKey}>
            <h2 className="text-base font-semibold">
              {t(`privacyCompliance.sections.${titleKey}`)}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t(`privacyCompliance.sections.${bodyKey}`)}
            </p>
          </section>
        ))}

        <div className="border-t border-border pt-4">
          <Link
            to="/settings"
            hash="privacy"
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-95"
          >
            {t("privacyCompliance.manageInSettings")}
          </Link>
        </div>
      </div>
    </div>
  );
}
