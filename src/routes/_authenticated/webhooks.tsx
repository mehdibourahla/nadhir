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

const KINDS = ["fire", "weather", "official", "road", "earthquake"];

function WebhooksPage() {
  const { t } = useTranslation();
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
      toast.success("Webhook created");
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
            <span>AUTOMATION</span>
          </>
        }
        title="Webhooks"
        subtitle="Forward signed JSON alert events to your own operational endpoints."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <AtlasPanel className="lg:col-span-5 space-y-4">
          <h2 className="font-display text-xl font-semibold text-ink">
            Add endpoint
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
                Label
              </label>
              <AtlasInput
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Operations Slack"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-secondary">
                HTTPS URL
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
                  <label
                    key={k}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1 text-xs cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedKinds((prev) =>
                          e.target.checked
                            ? [...prev, k]
                            : prev.filter((x) => x !== k),
                        )
                      }
                      className="accent-signal"
                    />
                    <span>{k}</span>
                  </label>
                );
              })}
            </div>
            <AtlasButton
              type="submit"
              variant="primary"
              className="w-full"
              disabled={createMut.isPending}
            >
              <Plus className="h-4 w-4" />
              Create endpoint
            </AtlasButton>
          </form>
        </AtlasPanel>

        <div className="lg:col-span-7 space-y-6">
          <AtlasPanel className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink">
              Active endpoints ({(endpointsQ.data ?? []).length})
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
                          {ep.label}
                        </span>
                        <AtlasBadge tone={ep.active ? "clear" : "neutral"} dot>
                          {ep.active ? "Active" : "Paused"}
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
                        aria-label="Toggle"
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
              Recent deliveries ({deliveries.length})
            </h3>
            <div className="divide-y divide-hairline text-xs">
              {deliveries.slice(0, 15).map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between py-2"
                >
                  <AtlasBadge tone={d.ok ? "clear" : "extreme"}>
                    {d.status_code ?? "ERR"}
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
