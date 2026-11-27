import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { EmergencyNumbers } from "@/components/SiteChrome";
import { pageMeta } from "@/lib/page-meta";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: pageMeta("about.metaTitle", "about.metaDescription"),
  }),
  component: AboutPage,
});

const SOURCES = [
  {
    name: "NASA FIRMS (VIIRS / MODIS)",
    licence: "Public domain",
    url: "https://www.earthdata.nasa.gov/data/tools/firms",
  },
  {
    name: "EUMETSAT Meteosat MTG FCI",
    licence: "EUMETSAT open data",
    url: "https://www.eumetsat.int/",
  },
  {
    name: "Copernicus Sentinel-3 SLSTR",
    url: "https://view.eumetsat.int/",
  },
  {
    name: "Open-Meteo weather",
    licence: "CC-BY 4.0",
    url: "https://open-meteo.com/",
  },
  {
    name: "Copernicus EFFIS / GWIS",
    url: "https://forest-fire.emergency.copernicus.eu/",
  },
  {
    name: "ONM — الديوان الوطني للأرصاد الجوية",
    url: "https://ametvigilance.meteo.dz/",
  },
  {
    name: "Protection Civile (DGPC) — الحماية المدنية",
    url: "https://t.me/DGPCDZ",
  },
  {
    name: "EMSC — earthquakes",
    url: "https://www.emsc-csem.org/",
  },
  {
    name: "OpenStreetMap",
    licence: "ODbL",
    url: "https://www.openstreetmap.org/copyright",
  },
];

function Section({ title, body }: { title: string; body: string }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </section>
  );
}

function AboutPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-[820px] px-4 py-8">
      <h1 className="text-2xl">{t("about.title")}</h1>
      <p className="mt-2 text-sm font-medium">{t("about.independent")}</p>
      <Section title={t("about.missionTitle")} body={t("about.mission")} />
      <Section title={t("about.howTitle")} body={t("about.how")} />
      <Section title={t("about.dangerTitle")} body={t("about.danger")} />
      <Section title={t("about.limitsTitle")} body={t("about.limits")} />
      <Section title={t("about.dataTitle")} body={t("about.data")} />

      <ul className="panel mt-4 divide-y divide-border text-sm">
        {SOURCES.map((s) => (
          <li
            key={s.name}
            className="flex flex-wrap items-center justify-between gap-2 p-3"
          >
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2"
            >
              {s.name}
            </a>
            {s.licence && (
              <span className="text-xs text-muted-foreground">{s.licence}</span>
            )}
          </li>
        ))}
      </ul>

      <Link
        to="/contribute"
        className="card mt-6 flex flex-wrap items-center justify-between gap-4 p-5 transition-colors hover:border-[var(--accent)]"
      >
        <span className="flex flex-col gap-1">
          <span className="font-display text-[17px] font-semibold">
            {t("about.contributeTitle")}
          </span>
          <span className="max-w-[58ch] text-sm text-muted-foreground">
            {t("about.contributeBody")}
          </span>
        </span>
        <span className="inline-flex h-9 shrink-0 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          {t("about.contributeCta")}
        </span>
      </Link>

      <div className="mt-6">
        <EmergencyNumbers />
      </div>
    </div>
  );
}
