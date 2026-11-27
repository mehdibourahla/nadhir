import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Plus, Power, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";

import { algiersTime } from "@/lib/nadhir";
import { titledMeta } from "@/lib/page-meta";
import { pageRows } from "@/lib/paging";
import { cn } from "@/lib/utils";
import {
  createWebhook,
  deleteWebhook,
  updateWebhook,
  webhookDeliveriesQuery,
  webhookEndpointsQuery,
} from "@/lib/webhooks";
import { AtlasPageFooter } from "@/ui/app-shell";
import {
  AtlasBadge,
  AtlasButton,
  AtlasInput,
  AtlasLoading,
  AtlasMasthead,
  AtlasPanel,
  SafeBdi,
} from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated/webhooks")({
  head: () => ({
    meta: titledMeta("webhooks.title", "webhooks.subtitle"),
  }),
  component: WebhooksPage,
});

const KINDS = ["fire", "weather", "official", "road", "earthquake"] as const;

function webhookKindLabel(k: string, locale: string): string {
  const map: Record<string, { ar: string; fr: string; en: string }> = {
    fire: { ar: "حرائق", fr: "Incendies", en: "Fires" },
    weather: { ar: "أرصاد ONM", fr: "Météo ONM", en: "Weather" },
    official: { ar: "رسمي", fr: "Officiel", en: "Official" },
    road: { ar: "طرقات", fr: "Routes", en: "Roads" },
    earthquake: { ar: "زلازل", fr: "Séismes", en: "Earthquakes" },
  };
  const e = map[k];
  if (!e) return k;
  return locale === "ar" ? e.ar : locale === "fr" ? e.fr : e.en;
}

function WebhooksPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "ar";
  const qc = useQueryClient();

  const endpointsQ = useQuery(webhookEndpointsQuery);
  const deliveriesQ = useInfiniteQuery(webhookDeliveriesQuery);
  const deliveries = useMemo(
    () => pageRows(deliveriesQ.data),
    [deliveriesQ.data],
  );

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<string[]>([
    "fire",
    "weather",
  ]);

  const createMut = useMutation({
    mutationFn: () =>
      createWebhook({
        label: label.trim() || "Webhook",
        url: url.trim(),
        kinds: selectedKinds,
        min_severity: 2,
      }),
    onSuccess: () => {
      setLabel("");
      setUrl("");
      void qc.invalidateQueries({ queryKey: ["webhooks"] });
      toast.success(
        locale === "ar"
          ? "تم إنشاء نقطة الربط"
          : locale === "fr"
            ? "Webhook créé"
            : "Webhook created",
      );
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      updateWebhook(id, { active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  const delMut = useMutation({
    mutationFn: deleteWebhook,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <Webhook className="h-3.5 w-3.5 text-signal" />
            <span>
              {locale === "ar"
                ? "الربط الآلي"
                : locale === "fr"
                  ? "AUTOMATISATION"
                  : "AUTOMATION"}
            </span>
          </>
        }
        title={
          locale === "ar"
            ? "روابط Webhooks"
            : locale === "fr"
              ? "Webhooks"
              : "Webhooks"
        }
        subtitle={
          locale === "ar"
            ? "استقبل إشعارات JSON موقّعة تلقائيًا على خوادمك التشغيلية."
            : locale === "fr"
              ? "Transférez des événements JSON signés vers vos propres points de terminaison."
              : "Forward signed JSON alert events to your own operational endpoints."
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <AtlasPanel className="lg:col-span-5 space-y-4">
          <h2 className="font-display text-xl font-semibold text-ink">
            {locale === "ar"
              ? "إضافة نقطة ربط"
              : locale === "fr"
                ? "Ajouter un point de terminaison"
                : "Add endpoint"}
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-secondary">
                {locale === "ar"
                  ? "التسمية"
                  : locale === "fr"
                    ? "Nom"
                    : "Label"}
              </label>
              <AtlasInput
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={
                  locale === "ar"
                    ? "غرفة العمليات"
                    : locale === "fr"
                      ? "Salle d'opérations"
                      : "Operations Slack"
                }
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-secondary">
                {locale === "ar"
                  ? "رابط HTTPS"
                  : locale === "fr"
                    ? "URL HTTPS"
                    : "HTTPS URL"}
              </label>
              <AtlasInput
                type="url"
                dir="ltr"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                required
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => {
                const checked = selectedKinds.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={checked}
                    onClick={() =>
                      setSelectedKinds((prev) =>
                        checked ? prev.filter((x) => x !== k) : [...prev, k],
                      )
                    }
                    className={cn(
                      "inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-medium transition-colors cursor-pointer",
                      checked
                        ? "border-signal/50 bg-signal-soft text-signal"
                        : "border-hairline bg-surface text-ink-secondary hover:bg-surface-raised",
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        checked ? "bg-signal" : "bg-hairline-strong",
                      )}
                    />
                    <span>{webhookKindLabel(k, locale)}</span>
                  </button>
                );
              })}
            </div>
            <AtlasButton
              type="submit"
              variant="primary"
              className="w-full min-h-11"
              disabled={createMut.isPending}
            >
              <Plus className="h-4 w-4" />
              {locale === "ar"
                ? "إنشاء نقطة الربط"
                : locale === "fr"
                  ? "Créer le point de terminaison"
                  : "Create endpoint"}
            </AtlasButton>
          </form>
        </AtlasPanel>

        <div className="lg:col-span-7 space-y-6">
          <AtlasPanel className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink">
              {locale === "ar"
                ? `نقاط الربط النشطة (${(endpointsQ.data ?? []).length})`
                : locale === "fr"
                  ? `Points de terminaison actifs (${(endpointsQ.data ?? []).length})`
                  : `Active endpoints (${(endpointsQ.data ?? []).length})`}
            </h2>
            {endpointsQ.isLoading ? (
              <AtlasLoading />
            ) : (
              <div className="divide-y divide-hairline">
                {(endpointsQ.data ?? []).map((ep) => (
                  <div
                    key={ep.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink">
                          <SafeBdi dir="auto">{ep.label}</SafeBdi>
                        </span>
                        <AtlasBadge tone={ep.active ? "clear" : "neutral"} dot>
                          {ep.active
                            ? locale === "ar"
                              ? "نشط"
                              : locale === "fr"
                                ? "Actif"
                                : "Active"
                            : locale === "ar"
                              ? "متوقف"
                              : locale === "fr"
                                ? "En pause"
                                : "Paused"}
                        </AtlasBadge>
                      </div>
                      <SafeBdi className="block truncate font-mono text-xs text-ink-muted">
                        {ep.url}
                      </SafeBdi>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <AtlasButton
                        variant="ghost"
                        size="icon"
                        aria-label={
                          ep.active
                            ? locale === "ar"
                              ? "إيقاف"
                              : locale === "fr"
                                ? "Mettre en pause"
                                : "Pause"
                            : locale === "ar"
                              ? "تفعيل"
                              : locale === "fr"
                                ? "Activer"
                                : "Resume"
                        }
                        onClick={() =>
                          toggleMut.mutate({ id: ep.id, active: !ep.active })
                        }
                      >
                        <Power className="h-4 w-4" />
                      </AtlasButton>
                      <AtlasButton
                        variant="ghost"
                        size="icon"
                        aria-label={t("common.delete")}
                        onClick={() => delMut.mutate(ep.id)}
                      >
                        <Trash2 className="h-4 w-4 text-ink-muted" />
                      </AtlasButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AtlasPanel>

          <AtlasPanel className="space-y-3">
            <h3 className="font-display text-lg font-semibold text-ink">
              {locale === "ar"
                ? `آخر عمليات التسليم (${deliveries.length})`
                : locale === "fr"
                  ? `Livraisons récentes (${deliveries.length})`
                  : `Recent deliveries (${deliveries.length})`}
            </h3>
            <div className="divide-y divide-hairline text-xs">
              {deliveries.slice(0, 15).map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between py-2"
                >
                  <AtlasBadge tone={d.ok ? "clear" : "extreme"}>
                    <SafeBdi>{d.status_code ?? "ERR"}</SafeBdi>
                  </AtlasBadge>
                  <SafeBdi className="font-mono text-ink-muted">
                    {algiersTime(d.created_at)}
                  </SafeBdi>
                </div>
              ))}
            </div>
          </AtlasPanel>
        </div>
      </div>

      <AtlasPageFooter />
    </div>
  );
}
