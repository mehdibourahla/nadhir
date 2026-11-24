import {
  pm10Level,
  smokeLevel,
  SMOKE_TINT,
  type AirHourly,
  type SmokeLevel,
} from "@/lib/air-quality";
import { ONM_EVENTS } from "@/lib/civil-map-geometry";
import type { AdminUnit, OnmVigilance, RiskForecast } from "@/lib/nadhir";
import { ONM_SEVERITY } from "@/lib/zone-hazards";

const OUTLOOK_DAYS = 6;
// ONM issues a warning about 17 h before onset (22.8 h at most, prod 2026-09-25)
const ONM_HORIZON_DAYS = 2;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Algeria keeps UTC+1 all year
export function algiersDate(ms: number): string {
  return new Date(ms + HOUR).toISOString().slice(0, 10);
}

export function outlookDays(nowMs: number): string[] {
  const today = Date.parse(`${algiersDate(nowMs)}T00:00:00Z`);
  return Array.from({ length: OUTLOOK_DAYS }, (_, i) =>
    new Date(today + i * DAY).toISOString().slice(0, 10),
  );
}

const dayStart = (day: string) => Date.parse(`${day}T00:00:00+01:00`);

export type OnmCell =
  | { state: "warning"; level: number; events: string[] }
  | { state: "none" }
  | { state: "not_issued" };

function warningsOn(warnings: OnmVigilance[], day: string) {
  const from = dayStart(day);
  const to = from + DAY;
  const seen = new Map<string, OnmVigilance>();
  for (const w of warnings) {
    if (w.cancelled_at || w.superseded_by || w.msg_type === "Cancel") continue;
    if (!w.expires) continue;
    const start = Date.parse(w.onset ?? w.sent);
    if (start >= to || Date.parse(w.expires) <= from) continue;
    seen.set(`${w.event}|${w.severity}|${w.onset ?? w.expires}`, w);
  }
  return [...seen.values()];
}

export function onmCells(
  warnings: OnmVigilance[],
  wilayaId: string,
  days: string[],
): OnmCell[] {
  const mine = warnings.filter((w) => w.wilaya_id === wilayaId);
  return days.map((day, i) => {
    const active = warningsOn(mine, day);
    if (!active.length)
      return i < ONM_HORIZON_DAYS ? { state: "none" } : { state: "not_issued" };
    return {
      state: "warning",
      level: Math.max(...active.map((w) => ONM_SEVERITY[w.severity] ?? 1)),
      events: [...new Set(active.map((w) => ONM_EVENTS[w.event] ?? "other"))],
    };
  });
}

export type FireCell = {
  level: number;
  fwi: number;
  percentile: number | null;
  fuelLimited: boolean;
} | null;

export function fireCells(rows: RiskForecast[], days: string[]): FireCell[] {
  const byDate = new Map(rows.map((r) => [r.forecast_date, r]));
  return days.map((day) => {
    const row = byDate.get(day);
    return row
      ? {
          level: row.danger_level,
          fwi: row.fwi,
          percentile: row.fwi_percentile,
          fuelLimited: row.fuel_limited,
        }
      : null;
  });
}

export type WeatherCell = {
  tempC: number;
  windKmh: number;
  rainMm: number;
} | null;

export function weatherCells(
  rows: RiskForecast[],
  days: string[],
): WeatherCell[] {
  const byDate = new Map(rows.map((r) => [r.forecast_date, r.components]));
  return days.map((day) => {
    const c = byDate.get(day);
    if (
      !c ||
      typeof c.temp_c !== "number" ||
      typeof c.wind_kmh !== "number" ||
      typeof c.rain_mm !== "number"
    )
      return null;
    return { tempC: c.temp_c, windKmh: c.wind_kmh, rainMm: c.rain_mm };
  });
}

export type AirCell =
  | {
      state: "ok";
      level: SmokeLevel;
      pollutant: "pm2_5" | "pm10";
      pm25: number;
      pm10: number;
    }
  | { state: "beyond" };

const mean = (values: number[]) =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

export function airCells(hourly: AirHourly, days: string[]): AirCell[] {
  return days.map((day) => {
    const pm25: number[] = [];
    const pm10: number[] = [];
    hourly.time.forEach((time, i) => {
      if (!time.startsWith(day)) return;
      const a = hourly.pm2_5[i];
      const b = hourly.pm10[i];
      if (a != null) pm25.push(a);
      if (b != null) pm10.push(b);
    });
    // a 24 h mean from part of a day would understate or overstate the WHO 24 h comparison
    if (pm25.length < 24 || pm10.length < 24) return { state: "beyond" };
    const a = mean(pm25);
    const b = mean(pm10);
    const byPm25 = smokeLevel(a);
    const byPm10 = pm10Level(b);
    const pm10Worse = SMOKE_TINT[byPm10] > SMOKE_TINT[byPm25];
    return {
      state: "ok",
      level: pm10Worse ? byPm10 : byPm25,
      pollutant: pm10Worse ? "pm10" : "pm2_5",
      pm25: a,
      pm10: b,
    };
  });
}

export type WilayaOutlook = {
  wilaya: AdminUnit;
  level: number;
  weather: { level: number; events: string[] } | null;
  fire: number | null;
  targetCommuneId: string;
};

export function nationalRanking(
  units: AdminUnit[],
  todayForecasts: RiskForecast[],
  warnings: OnmVigilance[],
  days: string[],
): WilayaOutlook[] {
  const communes = new Map(
    units.filter((u) => u.level === "commune").map((u) => [u.id, u]),
  );
  const fireTop = new Map<string, { level: number; communeId: string }>();
  for (const f of todayForecasts) {
    if (f.forecast_date !== days[0] || f.fuel_limited) continue;
    const wilayaId = communes.get(f.commune_id)?.parent_id;
    if (!wilayaId) continue;
    const top = fireTop.get(wilayaId);
    if (!top || f.danger_level > top.level)
      fireTop.set(wilayaId, { level: f.danger_level, communeId: f.commune_id });
  }
  const populous = new Map<string, AdminUnit>();
  for (const c of communes.values()) {
    if (!c.parent_id) continue;
    const best = populous.get(c.parent_id);
    if (!best || (c.population ?? 0) > (best.population ?? 0))
      populous.set(c.parent_id, c);
  }

  const rows: WilayaOutlook[] = [];
  for (const wilaya of units.filter((u) => u.level === "wilaya")) {
    const cells = onmCells(
      warnings,
      wilaya.id,
      days.slice(0, ONM_HORIZON_DAYS),
    );
    const warned = cells.filter(
      (c): c is Extract<OnmCell, { state: "warning" }> => c.state === "warning",
    );
    const weather = warned.length
      ? {
          level: Math.max(...warned.map((c) => c.level)),
          events: [...new Set(warned.flatMap((c) => c.events))],
        }
      : null;
    const top = fireTop.get(wilaya.id);
    const fire = top && top.level >= 3 ? top.level : null;
    if (!weather && fire == null) continue;
    const target = top?.communeId ?? populous.get(wilaya.id)?.id;
    if (!target) continue;
    rows.push({
      wilaya,
      level: Math.max(weather?.level ?? 0, fire ?? 0),
      weather,
      fire,
      targetCommuneId: target,
    });
  }
  return rows.sort(
    (a, b) =>
      b.level - a.level ||
      Number(!!b.weather) +
        Number(b.fire != null) -
        (Number(!!a.weather) + Number(a.fire != null)) ||
      a.wilaya.code.localeCompare(b.wilaya.code),
  );
}

export function defaultCommune(
  communes: AdminUnit[],
  fromUrl: string | undefined,
  zones: { commune_id: string | null; created_at: string }[],
  stored: string | null,
): AdminUnit | null {
  if (fromUrl) return communes.find((c) => c.code === fromUrl) ?? null;
  const first = [...zones]
    .filter((z) => z.commune_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  const id = first?.commune_id ?? stored;
  return communes.find((c) => c.id === id) ?? null;
}
