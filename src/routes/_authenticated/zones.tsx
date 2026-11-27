import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MapPin, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  MAX_ZONES,
  ZONE_HAZARDS,
  deleteZone,
  liveZoneContextQuery,
  saveZone,
  setZoneActive,
  zoneFailureKey,
  zonesQuery,
  type Zone,
  type ZoneInput,
} from "@/lib/account";
import { nearestPlace } from "@/lib/civil-map";
import { adminUnitsQuery, coordLabel } from "@/lib/nadhir";
import { titledMeta } from "@/lib/page-meta";
import { cn } from "@/lib/utils";
import { zoneStatus } from "@/lib/zone-status";
import { AtlasPageFooter } from "@/ui/app-shell";
import { MiniHazardMap } from "@/ui/hazard-map";
import {
  AtlasBadge,
  AtlasButton,
  AtlasEmpty,
  AtlasInput,
  AtlasLoading,
  AtlasMasthead,
  AtlasPanel,
  SafeBdi,
} from "@/ui/primitives";

type ZonesSearch = {
  lat?: number;
  lon?: number;
};

function coordinate(value: unknown, bound: number): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && Math.abs(n) <= bound ? n : undefined;
}

export const Route = createFileRoute("/_authenticated/zones")({
  validateSearch: (search: Record<string, unknown>): ZonesSearch => {
    const lat = coordinate(search["lat"], 90);
    const lon = coordinate(search["lon"], 180);
    return lat !== undefined && lon !== undefined ? { lat, lon } : {};
  },
  head: () => ({
    meta: titledMeta("nav.account"),
  }),
  component: ZonesPage,
});

function ZonesPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "ar";
  const search = Route.useSearch();
  const qc = useQueryClient();

  const zonesQ = useQuery(zonesQuery);
  const unitsQ = useQuery({ ...adminUnitsQuery, staleTime: 10 * 60_000 });
  const liveCtxQ = useQuery(liveZoneContextQuery);

  const [name, setName] = useState("");
  const [lat, setLat] = useState(search.lat ?? 36.7538);
  const [lon, setLon] = useState(search.lon ?? 3.0588);
  const [radiusKm, setRadiusKm] = useState(25);
  const [hazards, setHazards] = useState({
    notify_fires: true,
    notify_risk: true,
    notify_weather: true,
    notify_official: true,
    notify_road: true,
    notify_citizen: true,
    notify_earthquake: true,
  });

  const saveMut = useMutation({
    mutationFn: (input: ZoneInput) => saveZone(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["zones"] });
      setName("");
      toast.success(
        locale === "ar"
          ? "تم حفظ المنطقة"
          : locale === "fr"
            ? "Zone enregistrée"
            : "Zone saved",
      );
    },
    onError: (err) => toast.error(t(zoneFailureKey(err))),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setZoneActive(id, active),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["zones"] }),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => deleteZone(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["zones"] }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const nearest = nearestPlace(unitsQ.data ?? [], lat, lon);
    saveMut.mutate({
      name:
        name.trim() ||
        nearest?.name_fr ||
        (locale === "ar" ? "منطقتي" : locale === "fr" ? "Ma zone" : "My Zone"),
      lat,
      lon,
      radius_km: radiusKm,
      commune_id: nearest?.id ?? null,
      min_danger_level: 3,
      ...hazards,
    });
  }

  const zones = zonesQ.data ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 pb-12">
      <AtlasMasthead
        edition={
          <>
            <MapPin className="h-3.5 w-3.5 text-signal" />
            <SafeBdi>
              {zones.length} / {MAX_ZONES}{" "}
              {locale === "ar" ? "مناطق" : locale === "fr" ? "ZONES" : "ZONES"}
            </SafeBdi>
          </>
        }
        title={
          locale === "ar"
            ? "مناطق المتابعة"
            : locale === "fr"
              ? "Mes zones suivies"
              : "Monitored zones"
        }
        subtitle={
          locale === "ar"
            ? "حدد مناطقك على الخريطة لتصلك التنبيهات فورًا عند رصد أي خطر قريب."
            : locale === "fr"
              ? "Placez vos zones sur la carte pour recevoir les alertes locales en temps réel."
              : "Pin locations across Algeria to receive instant alerts for nearby hazards."
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <AtlasPanel className="lg:col-span-5 space-y-4">
          <h2 className="font-display text-xl font-semibold text-ink">
            {locale === "ar"
              ? "إضافة منطقة جديدة"
              : locale === "fr"
                ? "Nouvelle zone"
                : "Add monitored zone"}
          </h2>

          <MiniHazardMap
            lat={lat}
            lon={lon}
            zoom={8}
            interactive
            markerColor="#0A58FF"
            onPick={(pos) => {
              setLat(pos.lat);
              setLon(pos.lon);
            }}
            className="h-56"
          />

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-secondary">
                {locale === "ar"
                  ? "اسم المنطقة"
                  : locale === "fr"
                    ? "Nom de la zone"
                    : "Zone name"}
              </label>
              <AtlasInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  locale === "ar"
                    ? "الجزائر، المنزل..."
                    : locale === "fr"
                      ? "Alger, Maison..."
                      : "Algiers, Home..."
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-ink-secondary">
                  {locale === "ar"
                    ? "الإحداثيات"
                    : locale === "fr"
                      ? "Coordonnées"
                      : "Coordinates"}
                </label>
                <div className="min-h-11 flex items-center rounded-[10px] border border-hairline bg-surface-raised px-3 font-mono text-xs text-ink">
                  <SafeBdi>{coordLabel(lat, lon)}</SafeBdi>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-ink-secondary">
                  {locale === "ar"
                    ? `نصف القطر (${radiusKm} كم)`
                    : locale === "fr"
                      ? `Rayon (${radiusKm} km)`
                      : `Radius (${radiusKm} km)`}
                </label>
                <input
                  type="range"
                  min={5}
                  max={80}
                  step={5}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  className="w-full min-h-11 accent-signal"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              {ZONE_HAZARDS.map((h) => {
                const active = hazards[h.key];
                return (
                  <button
                    key={h.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setHazards((prev) => ({
                        ...prev,
                        [h.key]: !prev[h.key],
                      }))
                    }
                    className={cn(
                      "flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 text-xs font-medium transition-colors cursor-pointer text-start",
                      active
                        ? "border-signal/50 bg-signal-soft text-signal"
                        : "border-hairline bg-surface text-ink-secondary hover:bg-surface-raised",
                    )}
                  >
                    <span className="truncate">
                      {t(h.label, {
                        defaultValue: h.key.replace("notify_", ""),
                      })}
                    </span>
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        active ? "bg-signal" : "bg-hairline-strong",
                      )}
                    />
                  </button>
                );
              })}
            </div>

            <AtlasButton
              type="submit"
              variant="primary"
              className="w-full min-h-11"
              disabled={saveMut.isPending || zones.length >= MAX_ZONES}
            >
              <Plus className="h-4 w-4" />
              {locale === "ar"
                ? "حفظ المنطقة"
                : locale === "fr"
                  ? "Enregistrer la zone"
                  : "Save zone"}
            </AtlasButton>
          </form>
        </AtlasPanel>

        <div className="lg:col-span-7 space-y-4">
          {zonesQ.isLoading ? (
            <AtlasLoading />
          ) : zones.length === 0 ? (
            <AtlasEmpty
              title={
                locale === "ar"
                  ? "لم تتم إضافة أي منطقة بعد"
                  : locale === "fr"
                    ? "Aucune zone configurée"
                    : "No zones configured yet"
              }
            />
          ) : (
            <div className="space-y-3">
              {zones.map((z: Zone) => {
                const commune = z.commune_id
                  ? (unitsQ.data ?? []).find((u) => u.id === z.commune_id)
                  : undefined;
                const status = liveCtxQ.data
                  ? zoneStatus(
                      {
                        weather: z.notify_weather,
                        official: z.notify_official,
                        road: z.notify_road,
                        citizen: z.notify_citizen,
                      },
                      {
                        lat: z.lat,
                        lon: z.lon,
                        radius_km: z.radius_km,
                        commune_id: z.commune_id,
                        communeCode: commune?.code ?? null,
                        wilayaId: commune?.parent_id ?? null,
                      },
                      liveCtxQ.data,
                      Date.now(),
                    )
                  : null;
                const activeCount = status
                  ? status.weather.length +
                    status.official +
                    status.road.length +
                    status.citizen.length
                  : 0;

                return (
                  <AtlasPanel
                    key={z.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-lg font-semibold text-ink truncate">
                          <SafeBdi dir="auto">{z.name}</SafeBdi>
                        </span>
                        <AtlasBadge
                          tone={
                            !z.active
                              ? "neutral"
                              : activeCount > 0
                                ? "high"
                                : "clear"
                          }
                          dot
                        >
                          {!z.active
                            ? locale === "ar"
                              ? "متوقف مؤقتًا"
                              : locale === "fr"
                                ? "En pause"
                                : "Paused"
                            : activeCount > 0
                              ? locale === "ar"
                                ? `${activeCount} نشط`
                                : locale === "fr"
                                  ? `${activeCount} actif${activeCount > 1 ? "s" : ""}`
                                  : `${activeCount} active`
                              : locale === "ar"
                                ? "هادئ"
                                : locale === "fr"
                                  ? "Calme"
                                  : "Clear"}
                        </AtlasBadge>
                      </div>
                      <div className="font-mono text-xs text-ink-muted">
                        <SafeBdi>
                          {coordLabel(z.lat, z.lon)} · {z.radius_km} km
                        </SafeBdi>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <AtlasButton
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          toggleMut.mutate({ id: z.id, active: !z.active })
                        }
                      >
                        <Power className="h-3.5 w-3.5" />
                        {z.active
                          ? locale === "ar"
                            ? "إيقاف"
                            : locale === "fr"
                              ? "Pause"
                              : "Pause"
                          : locale === "ar"
                            ? "استئناف"
                            : locale === "fr"
                              ? "Reprendre"
                              : "Resume"}
                      </AtlasButton>
                      <AtlasButton
                        variant="ghost"
                        size="icon"
                        aria-label={t("common.delete")}
                        onClick={() => removeMut.mutate(z.id)}
                      >
                        <Trash2 className="h-4 w-4 text-ink-muted hover:text-hazard-extreme" />
                      </AtlasButton>
                    </div>
                  </AtlasPanel>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <AtlasPageFooter />
    </div>
  );
}
