import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";

import type { AnyLocale } from "@/i18n";
import { pageMeta } from "@/lib/page-meta";
import { AtlasPageFooter } from "@/ui/app-shell";
import { AtlasMasthead, AtlasPanel } from "@/ui/primitives";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      ...pageMeta("legal.termsMetaTitle", "legal.termsMetaDescription"),
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  const { i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <FileText className="h-3.5 w-3.5 text-signal" />
            <span>TERMS OF USE</span>
          </>
        }
        title={
          locale === "ar"
            ? "شروط الاستخدام"
            : locale === "fr"
              ? "Conditions d'utilisation"
              : "Terms of use"
        }
        subtitle={
          locale === "ar"
            ? "نذير أداة إعلامية مساعدة ولا تحل محل السلطات الرسمية أو الحماية المدنية (14)."
            : locale === "fr"
              ? "Nadhir est un service d'information civique et ne remplace pas les autorités officielles ni la Protection Civile (14)."
              : "Nadhir is an informational awareness instrument and does not replace official authorities or Civil Protection (14)."
        }
      />

      <AtlasPanel className="space-y-6 text-sm text-ink-secondary leading-relaxed">
        <section className="space-y-2">
          <h2 className="font-display text-xl font-semibold text-ink">
            1. Informational purpose
          </h2>
          <p>
            Always follow instructions issued by Algerian Civil Protection
            (DGPC, dial 14), local wilaya authorities, and the National Office
            of Meteorology (ONM). Satellite thermal detections and model
            forecasts carry inherent latency and uncertainty.
          </p>
        </section>

        <section className="space-y-2 border-t border-hairline pt-5">
          <h2 className="font-display text-xl font-semibold text-ink">
            2. Responsible citizen reporting
          </h2>
          <p>
            Submit only genuine field observations. Fabricated emergency reports
            waste public attention and may result in account suspension.
          </p>
        </section>

        <section className="space-y-2 border-t border-hairline pt-5">
          <h2 className="font-display text-xl font-semibold text-ink">
            3. Open API usage
          </h2>
          <p>
            Public JSON endpoints are provided for civic, journalistic, and
            research applications with clear attribution to Nadhir and upstream
            official sources.
          </p>
        </section>
      </AtlasPanel>

      <AtlasPageFooter />
    </div>
  );
}
