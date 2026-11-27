import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { titledMeta } from "@/lib/page-meta";

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

function Endpoint({
  method,
  path,
  desc,
  params,
}: {
  method: string;
  path: string;
  desc: string;
  params: string[];
}) {
  return (
    <div className="border-t border-border py-3">
      <p className="font-mono text-sm">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">
          {method}
        </span>{" "}
        {path}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
        {params.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

function DevelopersPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-[900px] px-4 py-6">
      <h1 className="text-2xl">{t("dev.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("dev.subtitle")}</p>

      <section className="panel mt-5 p-4">
        <h2 className="text-base">{t("dev.endpoints")}</h2>
        <Endpoint
          method="GET"
          path="/api/public/v1/weather"
          desc={t("dev.weatherDesc")}
          params={["commune=<commune code>"]}
        />
        <Endpoint
          method="GET"
          path="/api/public/v1/fires"
          desc={t("dev.firesDesc")}
          params={[
            "state=active|unconfirmed|contained_guess|extinguished",
            "since=ISO timestamp",
            "limit=1..500",
            "offset",
            "format=json|geojson",
          ]}
        />
        <Endpoint
          method="GET"
          path="/api/public/v1/risk"
          desc={t("dev.riskDesc")}
          params={[
            "horizon=0..5",
            "commune=<commune code>",
            "limit=1..1000",
            "offset",
          ]}
        />
        <Endpoint
          method="GET"
          path="/api/public/v1/stats"
          desc={t("dev.statsDesc")}
          params={[]}
        />
        <Endpoint
          method="GET"
          path="/api/public/v1/"
          desc={t("dev.indexDesc")}
          params={[]}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          {t("dev.rateLimit")}
        </p>
      </section>

      <section className="panel mt-5 p-4">
        <h2 className="text-base">{t("dev.webhooks")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("dev.webhooksDesc")}
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-secondary p-3 text-xs">
          {`POST <your endpoint>
X-Nadhir-Signature: sha256=<hex hmac of the raw body>
Content-Type: application/json

{
  "type": "alert.fire",
  "alert": { "id": "...", "kind": "fire", "severity": 5,
             "title": "...", "body": "...", "distance_km": 4.2 },
  "sent_at": "2026-08-28T12:00:00.000Z"
}`}
        </pre>
        <p className="mt-3 text-sm">
          <Link
            to="/webhooks"
            className="text-primary underline underline-offset-2"
          >
            {t("dev.manage")}
          </Link>
        </p>
      </section>

      <section className="panel mt-5 p-4">
        <h2 className="text-base">{t("dev.licence")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("dev.licenceBody")}
        </p>
      </section>
    </div>
  );
}
