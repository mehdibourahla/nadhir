import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState, ErrorState, Skeleton } from "@/components/nadhir/states";
import { Button } from "@/components/ui/button";
import { ZoneCard } from "@/components/zones/ZoneCard";
import { ZoneEditor } from "@/components/zones/ZoneEditor";
import {
  liveZoneContextQuery,
  MAX_ZONES,
  zonesQuery,
  type Zone,
} from "@/lib/account";
import { zoneStatus } from "@/lib/zone-status";
import {
  LIVE_STATES,
  adminUnitsQuery,
  clustersQuery,
  haversineKm,
} from "@/lib/nadhir";

export function ZonesPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: "/_authenticated/zones" });
  const start =
    search.lat !== undefined && search.lon !== undefined
      ? { lat: search.lat, lon: search.lon }
      : null;
  const zones = useQuery(zonesQuery);
  const units = useQuery(adminUnitsQuery);
  const clusters = useQuery(clustersQuery);
  const liveContext = useQuery(liveZoneContextQuery);
  const [statusAt] = useState(() => Date.now());
  const [editing, setEditing] = useState<Zone | null>(null);
  const [open, setOpen] = useState(!!start);

  const unitById = useMemo(
    () => new Map((units.data ?? []).map((unit) => [unit.id, unit])),
    [units.data],
  );
  const live = useMemo(
    () => (clusters.data ?? []).filter((c) => LIVE_STATES.includes(c.state)),
    [clusters.data],
  );
  const list = zones.data ?? [];
  const atLimit = list.length >= MAX_ZONES;

  const edit = (zone: Zone | null) => {
    setEditing(zone);
    setOpen(true);
  };

  const add = (
    <Button disabled={atLimit} onClick={() => edit(null)}>
      <Plus aria-hidden />
      {list.length ? t("account.newZone") : t("account.addFirstZone")}
    </Button>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl">{t("account.zonesTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("account.zonesSubtitle")}
          </p>
          <Link
            to="/settings"
            className="mt-2 inline-block text-sm text-primary underline underline-offset-2"
          >
            {t("account.settingsTitle")}
          </Link>
        </div>
        {list.length ? (
          <div className="text-end">
            {add}
            <p className="tabular mt-1 text-xs text-muted-foreground">
              {atLimit
                ? t("account.zoneLimit")
                : t("account.zoneCount", { used: list.length, max: MAX_ZONES })}
            </p>
          </div>
        ) : null}
      </header>

      <section className="mt-6 space-y-3">
        {zones.isPending ? (
          <>
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </>
        ) : zones.isError ? (
          <ErrorState
            body={t("account.zonesLoadFailed")}
            onRetry={() => void zones.refetch()}
          />
        ) : list.length === 0 ? (
          <EmptyState
            title={t("account.noZonesTitle")}
            body={t("account.noZones")}
            action={<div className="mt-2">{add}</div>}
          />
        ) : (
          list.map((zone, index) => {
            const inside = live
              .map((c) => haversineKm(zone.lat, zone.lon, c.lat, c.lon))
              .filter((km) => km <= zone.radius_km)
              .sort((a, b) => a - b);
            const commune = zone.commune_id
              ? unitById.get(zone.commune_id)
              : undefined;
            return (
              <ZoneCard
                key={zone.id}
                zone={zone}
                commune={commune}
                nearby={{ count: inside.length, nearestKm: inside[0] ?? null }}
                status={
                  liveContext.data
                    ? zoneStatus(
                        {
                          weather: zone.notify_weather,
                          official: zone.notify_official,
                          road: zone.notify_road,
                          citizen: zone.notify_citizen,
                        },
                        {
                          lat: zone.lat,
                          lon: zone.lon,
                          radius_km: zone.radius_km,
                          commune_id: zone.commune_id,
                          communeCode: commune?.code ?? null,
                          wilayaId: commune?.parent_id ?? null,
                        },
                        liveContext.data,
                        statusAt,
                      )
                    : null
                }
                statusFailed={liveContext.isError}
                prepareOffline={index === 0}
                onEdit={() => edit(zone)}
              />
            );
          })
        )}
      </section>

      <ZoneEditor
        open={open}
        zone={editing}
        start={editing ? null : start}
        onOpenChange={setOpen}
      />
    </div>
  );
}
