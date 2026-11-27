import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { algiersTime } from "@/lib/nadhir";
import {
  createWebhook,
  deleteWebhook,
  updateWebhook,
  webhookDeliveriesQuery,
  webhookEndpointsQuery,
} from "@/lib/webhooks";
import { titledMeta } from "@/lib/page-meta";
import { pageRows } from "@/lib/paging";
import { LoadMore } from "@/components/LoadMore";

export const Route = createFileRoute("/_authenticated/webhooks")({
  head: () => ({
    meta: titledMeta("webhooks.title", "webhooks.subtitle"),
  }),
  component: WebhooksPage,
});

const KINDS = ["fire", "risk"] as const;

function WebhooksPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const endpoints = useQuery(webhookEndpointsQuery);
  const deliveries = useInfiniteQuery(webhookDeliveriesQuery);
  const deliveryRows = pageRows(deliveries.data);

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kinds, setKinds] = useState<string[]>(["fire", "risk"]);
  const [minSeverity, setMinSeverity] = useState(3);
  const [revealed, setRevealed] = useState<string | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["webhooks"] });
  };

  const create = useMutation({
    mutationFn: () =>
      createWebhook({
        label: label.trim(),
        url: url.trim(),
        kinds,
        min_severity: minSeverity,
      }),
    onSuccess: () => {
      setLabel("");
      setUrl("");
      invalidate();
      toast.success(t("webhooks.created"));
    },
    onError: (e: Error) => toast.error(t(e.message)),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      updateWebhook(v.id, { active: v.active }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(t(e.message)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteWebhook(id),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(t(e.message)),
  });

  const validUrl = /^https:\/\/.+/.test(url.trim());
  const hasKinds = kinds.length > 0;

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6">
      <h1 className="text-2xl">{t("webhooks.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("webhooks.subtitle")}
      </p>

      <section className="panel mt-5 p-4">
        <h2 className="text-base">{t("webhooks.add")}</h2>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!validUrl || !label.trim() || !hasKinds) return;
            create.mutate();
          }}
        >
          <label className="text-sm">
            {t("webhooks.label")}
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
              required
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="text-sm">
            {t("webhooks.url")}
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.org/hooks/nadhir"
              required
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <fieldset className="text-sm">
            <legend>{t("webhooks.kinds")}</legend>
            <div className="mt-1 flex gap-3">
              {KINDS.map((k) => (
                <label key={k} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={kinds.includes(k)}
                    onChange={(e) =>
                      setKinds((prev) =>
                        e.target.checked
                          ? [...prev, k]
                          : prev.filter((x) => x !== k),
                      )
                    }
                  />
                  {t(`webhooks.kind_${k}`)}
                </label>
              ))}
            </div>
            {!hasKinds ? (
              <p className="mt-1 text-xs text-destructive">
                {t("webhooks.kindsRequired")}
              </p>
            ) : null}
          </fieldset>
          <label className="text-sm">
            {t("webhooks.minSeverity")}
            <select
              value={minSeverity}
              onChange={(e) => setMinSeverity(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
            >
              {[1, 2, 3, 4, 5].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={
                !validUrl || !label.trim() || !hasKinds || create.isPending
              }
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {create.isPending ? t("webhooks.saving") : t("webhooks.save")}
            </button>
            {url && !validUrl ? (
              <span className="ms-3 text-xs text-muted-foreground">
                {t("webhooks.httpsOnly")}
              </span>
            ) : null}
          </div>
        </form>
      </section>

      <section className="panel mt-5 divide-y divide-border">
        {(endpoints.data ?? []).length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t("webhooks.empty")}
          </p>
        ) : null}
        {(endpoints.data ?? []).map((e) => (
          <div key={e.id} className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{e.label}</span>
              <span className="text-xs text-muted-foreground">
                {e.last_attempt_at
                  ? t("webhooks.lastAttempt", {
                      time: algiersTime(e.last_attempt_at),
                      status: e.last_status ?? "—",
                    })
                  : t("webhooks.neverSent")}
              </span>
            </div>
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {e.url}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {e.kinds.map((k) => t(`webhooks.kind_${k}`)).join(" · ")} ·{" "}
              {t("webhooks.minSeverity")} {e.min_severity}
            </p>
            {e.last_error ? (
              <p className="mt-1 text-xs text-destructive">{e.last_error}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => toggle.mutate({ id: e.id, active: !e.active })}
                className="rounded-md border border-input px-2 py-1 hover:bg-secondary"
              >
                {e.active ? t("webhooks.pause") : t("webhooks.resume")}
              </button>
              <button
                type="button"
                onClick={() => setRevealed(revealed === e.id ? null : e.id)}
                className="rounded-md border border-input px-2 py-1 hover:bg-secondary"
              >
                {t("webhooks.showSecret")}
              </button>
              <button
                type="button"
                onClick={() => remove.mutate(e.id)}
                className="rounded-md border border-input px-2 py-1 text-destructive hover:bg-secondary"
              >
                {t("webhooks.delete")}
              </button>
              {revealed === e.id ? (
                <code className="break-all text-[11px]">{e.secret}</code>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <section className="panel mt-5 p-4">
        <h2 className="text-base">{t("webhooks.deliveries")}</h2>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {deliveryRows.length === 0 ? (
            <li>{t("webhooks.noDeliveries")}</li>
          ) : null}
          {deliveryRows.map((d) => (
            <li key={d.id} className="tabular">
              {algiersTime(d.created_at)} ·{" "}
              {d.ok ? "200 OK" : `${d.status_code ?? "ERR"} ${d.error ?? ""}`}
            </li>
          ))}
        </ul>
        <LoadMore query={deliveries} />
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        {t("webhooks.signatureNote")}
      </p>
    </div>
  );
}
