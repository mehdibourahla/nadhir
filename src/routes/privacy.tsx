import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";

import type { AnyLocale } from "@/i18n";
import { pageMeta } from "@/lib/page-meta";
import { AtlasPageFooter } from "@/ui/app-shell";
import { AtlasMasthead, AtlasPanel } from "@/ui/primitives";

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
  const { i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <ShieldCheck className="h-3.5 w-3.5 text-signal" />
            <span>PRIVACY COMMITMENT</span>
          </>
        }
        title={
          locale === "ar"
            ? "سياسة الخصوصية"
            : locale === "fr"
              ? "Politique de confidentialité"
              : "Privacy policy"
        }
        subtitle={
          locale === "ar"
            ? "لا نبيع بياناتك ولا نتتبع موقعك دون موافقة صريحة. الموقع الجغرافي في وضع الطوارئ يبقى على جهازك."
            : locale === "fr"
              ? "Aucune vente de données, aucun suivi publicitaire. Votre position GPS en mode survie reste sur votre appareil."
              : "Zero ad tracking, zero data brokering. Device geolocation in Survival Mode stays strictly on your device."
        }
      />

      <AtlasPanel className="space-y-6 text-sm text-ink-secondary leading-relaxed">
        <section className="space-y-2">
          <h2 className="font-display text-xl font-semibold text-ink">
            1. Public browsing without an account
          </h2>
          <p>
            The live map, 6-day forecast, wilaya dossiers, archive history,
            system status, and Survival Mode require no account and collect no
            personal identifiers.
          </p>
        </section>

        <section className="space-y-2 border-t border-hairline pt-5">
          <h2 className="font-display text-xl font-semibold text-ink">
            2. Account zones & notifications
          </h2>
          <p>
            When you create an account to monitor specific zones, we store only
            your email address, configured zone coordinates, and alert channel
            preferences so we can deliver timely hazard alerts.
          </p>
        </section>

        <section className="space-y-2 border-t border-hairline pt-5">
          <h2 className="font-display text-xl font-semibold text-ink">
            3. Citizen report photo privacy
          </h2>
          <p>
            EXIF metadata (camera model, embedded GPS headers) is stripped from
            uploaded citizen hazard photos before storage.
          </p>
        </section>

        <section className="space-y-2 border-t border-hairline pt-5">
          <h2 className="font-display text-xl font-semibold text-ink">
            4. Your controls
          </h2>
          <p>
            You may export your data or permanently delete your account at any
            time from{" "}
            <Link to="/settings" className="text-signal hover:underline">
              Settings
            </Link>
            .
          </p>
        </section>
      </AtlasPanel>

      <AtlasPageFooter />
    </div>
  );
}
