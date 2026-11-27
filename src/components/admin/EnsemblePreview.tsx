import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchEnsemblePreview } from "@/lib/ensemble-preview";
import type { MemberRange } from "@/lib/ensemble";

const range = (value: MemberRange) =>
  `${value.min.toFixed(1)} – ${value.max.toFixed(1)}`;

export function EnsemblePreview() {
  const { t } = useTranslation("admin");
  const [code, setCode] = useState("");
  const preview = useMutation({
    mutationFn: fetchEnsemblePreview,
    retry: false,
  });
  const result = preview.data;
  return (
    <section className="mt-8" aria-labelledby="ensemble-title">
      <h2 id="ensemble-title" className="text-sm font-medium">
        {t("sources.ensemble.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("sources.ensemble.description")}
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          preview.mutate(code);
        }}
      >
        <label className="text-sm">
          {t("sources.ensemble.communeCode")}
          <input
            className="ms-2 rounded border border-border bg-background px-2 py-1"
            value={code}
            disabled={preview.isPending}
            pattern="[0-9]{4}"
            maxLength={4}
            required
            inputMode="numeric"
            placeholder="0601"
            onChange={(event) => {
              setCode(event.target.value);
              preview.reset();
            }}
          />
        </label>
        <button
          type="submit"
          disabled={preview.isPending || !/^\d{4}$/.test(code)}
          className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50"
        >
          {t(
            preview.isPending
              ? "sources.ensemble.loading"
              : "sources.ensemble.submit",
          )}
        </button>
      </form>
      {preview.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t(`sources.ensemble.${preview.error.message}`, {
            defaultValue: t("sources.ensemble.unavailable"),
          })}
        </p>
      )}
      {result && !preview.isPending && !preview.error && (
        <div className="mt-3">
          <p className="text-sm">
            {t("sources.ensemble.retrieved", {
              name: result.commune.name_fr,
              code: result.commune.code,
              time: result.fetched_at,
            })}
          </p>
          <p className="text-sm">
            {t("sources.ensemble.forecastDate", {
              date: result.hours[0]?.valid_at.slice(0, 10),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("sources.ensemble.metadata", {
              lat: result.grid.latitude,
              lon: result.grid.longitude,
            })}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                {t("sources.ensemble.caption")}
              </caption>
              <thead>
                <tr className="text-start">
                  <th scope="col">{t("sources.ensemble.validTime")}</th>
                  <th scope="col">{t("sources.ensemble.temperature")}</th>
                  <th scope="col">{t("sources.ensemble.precipitation")}</th>
                  <th scope="col">{t("sources.ensemble.wind")}</th>
                </tr>
              </thead>
              <tbody>
                {result.hours.map((hour) => (
                  <tr key={hour.valid_at} className="border-t border-border">
                    <th scope="row" className="py-1 font-normal">
                      {hour.valid_at.slice(11, 16)}
                    </th>
                    <td className="text-center">
                      {range(hour.temperature_2m)}
                    </td>
                    <td className="text-center">{range(hour.precipitation)}</td>
                    <td className="text-center">
                      {range(hour.wind_speed_10m)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="mt-2 text-xs">
            <summary>{t("sources.ensemble.members")}</summary>
            <pre className="mt-2 max-h-64 overflow-auto">
              {JSON.stringify(result.hours, null, 2)}
            </pre>
          </details>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        <a
          className="underline"
          href="https://open-meteo.com/en/docs/ensemble-api"
        >
          Open-Meteo / DWD ICON
        </a>{" "}
        · {t("sources.ensemble.attribution")}
      </p>
    </section>
  );
}
