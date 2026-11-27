import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LocateFixed, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { LocationPicker, type PickerTarget } from "@/components/LocationPicker";
import {
  RISK_ICON,
  RISK_LEVELS,
  riskInk,
  riskTint,
} from "@/components/nadhir/risk-visuals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useEndSide } from "@/hooks/use-end-side";
import { useIsMobile } from "@/hooks/use-mobile";
import { RTL_LOCALES, type Locale } from "@/i18n";
import {
  isDefaultPoint,
  saveZone,
  ZONE_HAZARDS,
  type Zone,
  type ZoneHazardKey,
  zoneFailureKey,
} from "@/lib/account";
import { findPlaces, nearestPlace } from "@/lib/civil-map";
import {
  adminUnitsQuery,
  dangerLevelKey,
  unitName,
  type AdminUnit,
} from "@/lib/nadhir";
import { cn } from "@/lib/utils";

const NORTHERN_ALGERIA = { lat: 36.2, lon: 3.6, zoom: 6 };

type Start = { lat: number; lon: number } | null;

function Editor({
  zone,
  start,
  onDone,
}: {
  zone: Zone | null;
  start: Start;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const qc = useQueryClient();
  const units = useQuery(adminUnitsQuery);
  const [target, setTarget] = useState<PickerTarget>(() =>
    zone
      ? { lat: zone.lat, lon: zone.lon, zoom: 10, key: 0 }
      : start
        ? { ...start, zoom: 11, key: 0 }
        : { ...NORTHERN_ALGERIA, key: 0 },
  );
  const [point, setPoint] = useState({ lat: target.lat, lon: target.lon });
  const [placed, setPlaced] = useState(zone ? !isDefaultPoint(zone) : !!start);
  const [picked, setPicked] = useState<AdminUnit | null>(null);
  const [radius, setRadius] = useState(zone?.radius_km ?? 10);
  const [typedName, setTypedName] = useState<string | null>(zone?.name ?? null);
  const [level, setLevel] = useState(zone?.min_danger_level ?? 3);
  const [follows, setFollows] = useState(
    () =>
      Object.fromEntries(
        ZONE_HAZARDS.map(({ key }) => [key, zone?.[key] ?? true]),
      ) as Record<ZoneHazardKey, boolean>,
  );
  const [query, setQuery] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationFailed, setLocationFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nearest = useMemo(
    () => nearestPlace(units.data ?? [], point.lat, point.lon),
    [units.data, point],
  );
  const unitById = useMemo(
    () => new Map((units.data ?? []).map((unit) => [unit.id, unit])),
    [units.data],
  );
  const commune = picked?.level === "commune" ? picked : nearest;
  const results = useMemo(
    () => findPlaces(units.data ?? [], query, locale).slice(0, 6),
    [units.data, query, locale],
  );
  const autoName = picked ?? (placed ? nearest : null);
  const name = typedName ?? (autoName ? unitName(autoName, locale) : "");

  const jump = (
    lat: number,
    lon: number,
    zoom: number,
    unit: AdminUnit | null,
  ) => {
    setTarget((prev) => ({ lat, lon, zoom, key: prev.key + 1 }));
    setPoint({ lat, lon });
    setPlaced(true);
    setPicked(unit);
  };

  const locate = (asked: boolean) => {
    if (!navigator.geolocation) {
      if (asked) setLocationFailed(true);
      return;
    }
    setLocating(asked);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setLocationFailed(false);
        jump(position.coords.latitude, position.coords.longitude, 11, null);
      },
      () => {
        setLocating(false);
        if (asked) setLocationFailed(true);
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const locateRef = useRef(locate);
  locateRef.current = locate;
  useEffect(() => {
    if (zone || start || !navigator.permissions) return;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (status.state === "granted") locateRef.current(false);
      })
      .catch(() => undefined);
  }, [zone, start]);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await saveZone(
        {
          name: name.trim(),
          lat: point.lat,
          lon: point.lon,
          radius_km: radius,
          commune_id: commune?.id ?? null,
          min_danger_level: level,
          ...follows,
        },
        zone?.id,
      );
      await qc.invalidateQueries({ queryKey: ["zones"] });
      onDone();
    } catch (failure) {
      console.error(failure);
      setError(t(zoneFailureKey(failure)));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative h-[42dvh] shrink-0 lg:h-72">
        <LocationPicker
          target={target}
          radiusKm={radius}
          label={t("account.zoneMap")}
          onMove={(next, byUser) => {
            setPoint(next);
            if (!byUser) return;
            setPlaced(true);
            setPicked(null);
          }}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        <div className="space-y-2">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("account.zoneSearch")}
              aria-label={t("account.zoneSearch")}
              className="ps-9"
            />
          </div>
          {query.trim() ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {results.length === 0 ? (
                <li className="px-3 py-2 text-muted-foreground">
                  {t("account.zoneSearchEmpty")}
                </li>
              ) : (
                results.map((unit) => (
                  <li key={unit.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-start hover:bg-muted"
                      onClick={() => {
                        jump(
                          unit.lat,
                          unit.lon,
                          unit.level === "commune" ? 11 : 8,
                          unit,
                        );
                        setQuery("");
                      }}
                    >
                      {unitName(unit, locale)}
                      <span className="ms-2 text-xs text-muted-foreground">
                        {unit.level === "wilaya"
                          ? t("account.zoneWilaya")
                          : unit.parent_id && unitById.get(unit.parent_id)
                            ? unitName(unitById.get(unit.parent_id)!, locale)
                            : null}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locating}
            onClick={() => locate(true)}
          >
            <LocateFixed aria-hidden />
            {locating ? t("account.locating") : t("account.useLocation")}
          </Button>
          {locationFailed ? (
            <p className="text-muted-foreground">
              {t("account.locationFailed")}
            </p>
          ) : null}
          <p
            role="status"
            className={cn(!placed && "font-medium text-foreground")}
          >
            {!placed
              ? t("account.placeHint")
              : commune
                ? t("account.zoneCommuneAuto", {
                    name: unitName(commune, locale),
                  })
                : t("account.zoneNoCommune")}
          </p>
        </div>

        <label className="block space-y-2">
          <span className="font-medium">
            {t("account.radius", { km: radius })}
          </span>
          <Slider
            min={2}
            max={60}
            step={1}
            value={[radius]}
            dir={RTL_LOCALES.includes(locale) ? "rtl" : "ltr"}
            onValueChange={([value]) => setRadius(value ?? radius)}
            aria-label={t("account.radius", { km: radius })}
          />
        </label>

        <label className="block space-y-1">
          <span className="font-medium">{t("account.zoneName")}</span>
          <Input
            value={name}
            maxLength={80}
            onChange={(event) => setTypedName(event.target.value)}
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="font-medium">{t("account.minLevel")}</legend>
          <div role="radiogroup" className="flex flex-wrap gap-2">
            {RISK_LEVELS.map((value) => {
              const Icon = RISK_ICON[value];
              const selected = level === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setLevel(value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                    selected
                      ? "ring-2 ring-(--accent) ring-offset-2 ring-offset-background"
                      : "opacity-70",
                  )}
                  style={{
                    backgroundColor: riskTint(value),
                    color: riskInk(value),
                  }}
                >
                  <Icon aria-hidden className="size-3.5" />
                  <span className="tabular">{value}</span>
                  {t(`risk.${dangerLevelKey(value)}`)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">{t("account.follows")}</legend>
          {ZONE_HAZARDS.map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center justify-between gap-3"
            >
              <span>{t(label)}</span>
              <Switch
                checked={follows[key]}
                onCheckedChange={(checked) =>
                  setFollows((prev) => ({ ...prev, [key]: checked }))
                }
              />
            </label>
          ))}
        </fieldset>

        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          className="w-full"
          disabled={!placed || !name.trim() || pending}
          onClick={() => void save()}
        >
          {pending ? t("common.loading") : t("account.saveZone")}
        </Button>
      </div>
    </div>
  );
}

export function ZoneEditor({
  open,
  zone,
  start,
  onOpenChange,
}: {
  open: boolean;
  zone: Zone | null;
  start: Start;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const endSide = useEndSide();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : endSide}
        className={cn(
          "flex flex-col gap-0 p-0",
          mobile ? "h-[100dvh]" : "w-full sm:max-w-md",
        )}
      >
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>
            {zone ? t("account.editZone") : t("account.newZone")}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("account.placeHint")}
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <Editor
            key={zone?.id ?? "new"}
            zone={zone}
            start={start}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
