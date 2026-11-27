import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Compass, Layers, Radio, ShieldCheck } from "lucide-react";

import type { AnyLocale } from "@/i18n";
import { pageMeta } from "@/lib/page-meta";
import { AtlasPageFooter } from "@/ui/app-shell";
import { AtlasButton, AtlasMasthead, AtlasPanel } from "@/ui/primitives";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: pageMeta("about.metaTitle", "about.metaDescription"),
  }),
  component: AboutPage,
});

function AboutPage() {
  const { i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;

  const pillars = [
    {
      Icon: Radio,
      title:
        locale === "ar"
          ? "مصادر رسمية وأقمار صناعية"
          : locale === "fr"
            ? "Sources officielles et satellites"
            : "Official bulletins & satellites",
      body:
        locale === "ar"
          ? "يجمع نذير بين نشرات الديوان الوطني للأرصاد الجوية (ONM CAP) وتدخلات الحماية المدنية (DGPC) ورصد NASA FIRMS وEUMETSAT MTG FCI وبيانات الزلازل."
          : locale === "fr"
            ? "Nadhir agrège les vigilances officielles ONM (CAP), les bilans DGPC, les détections satellitaires NASA FIRMS et EUMETSAT MTG FCI, ainsi que le suivi sismique."
            : "Nadhir unifies official ONM CAP vigilance bulletins, DGPC civil protection updates, NASA FIRMS and EUMETSAT MTG FCI satellite thermal feeds, and seismic monitoring.",
    },
    {
      Icon: ShieldCheck,
      title:
        locale === "ar"
          ? "الشفافية والصرامة في التصنيف"
          : locale === "fr"
            ? "Rigueur et attribution des sources"
            : "Strict source provenance",
      body:
        locale === "ar"
          ? "لا تُخلط الإشارات الحرارية الأولية بالحرائق المؤكدة. كل حدث يعرض مصدره وتوقيته الدقيق بتوقيت الجزائر."
          : locale === "fr"
            ? "Les signaux thermiques isolés ne sont jamais confondus avec les incendies confirmés. Chaque événement affiche sa source et son horodatage exact."
            : "Uncorroborated thermal anomalies are strictly separated from confirmed incidents. Every alert shows its exact source and Algiers timestamp.",
    },
    {
      Icon: Layers,
      title:
        locale === "ar"
          ? "العمل دون اتصال في الطوارئ"
          : locale === "fr"
            ? "Mode survie hors ligne"
            : "Offline-ready emergency toolkit",
      body:
        locale === "ar"
          ? "حزمة الطوارئ تحفظ موقعك وأقرب المساحات المفتوحة وأرقام النجدة الوطنية (14، 1548، 1055، 1070) للوصول إليها حتى عند انقطاع الشبكة."
          : locale === "fr"
            ? "Le mode survie conserve vos coordonnées, les espaces ouverts proches et les numéros d'urgence algériens (14, 1548, 1055, 1070) hors ligne."
            : "Survival Mode caches your coordinates, nearby open areas, and official Algerian emergency numbers (14, 1548, 1055, 1070) for offline access.",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <Compass className="h-3.5 w-3.5 text-signal" />
            <span>ALGERIA · 69 WILAYAS · 1,541 COMMUNES</span>
          </>
        }
        title={
          locale === "ar"
            ? "عن نذير"
            : locale === "fr"
              ? "À propos de Nadhir"
              : "About Nadhir"
        }
        subtitle={
          locale === "ar"
            ? "منصة وطنية مستقلة للإنذار المبكر ومتابعة المخاطر الطبيعية والطقس في الجزائر."
            : locale === "fr"
              ? "Instrument indépendant d'information civique sur les aléas météorologiques, incendies et séismes en Algérie."
              : "An independent civic awareness instrument tracking weather, wildfires, seismic events, and road disruptions across Algeria."
        }
        actions={
          <Link to="/status">
            <AtlasButton variant="secondary" size="sm">
              {locale === "ar"
                ? "حالة المصادر"
                : locale === "fr"
                  ? "Voir le statut"
                  : "View live status"}
            </AtlasButton>
          </Link>
        }
      />

      <div className="space-y-4">
        {pillars.map(({ Icon, title, body }) => (
          <AtlasPanel key={title} className="flex items-start gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal-soft text-signal">
              <Icon className="h-5 w-5" />
            </span>
            <div className="space-y-1.5">
              <h2 className="font-display text-xl font-semibold text-ink">
                {title}
              </h2>
              <p className="text-sm text-ink-secondary leading-relaxed">
                {body}
              </p>
            </div>
          </AtlasPanel>
        ))}
      </div>

      <AtlasPageFooter />
    </div>
  );
}
