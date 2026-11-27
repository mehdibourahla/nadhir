import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Locale } from "@/i18n";
import type { Bucket, Hazard } from "@/lib/hazard-history";
import { intlLocale } from "@/lib/nadhir";

export const HAZARD_COLOR: Record<Hazard, string> = {
  fire: "var(--risk-4)",
  weather: "var(--accent)",
  road: "var(--ink-soft)",
};

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number | string; name?: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card-raised px-2.5 py-1.5 text-xs">
      <p className="font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="tabular text-muted-foreground">
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

export function HazardChart({
  rows,
  granularity,
  hazards,
}: {
  rows: Bucket[];
  granularity: "week" | "month";
  hazards: Hazard[];
}) {
  const { t, i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(intlLocale(i18n.language as Locale), {
    ...(granularity === "week" ? { day: "numeric" } : {}),
    month: "short",
    timeZone: "UTC",
  });
  const data = rows.map((row) => ({
    ...row,
    label: format.format(new Date(`${row.start}T00:00:00Z`)),
  }));
  const axis = { stroke: "var(--ink-faint)", fontSize: 11 };

  return (
    <section className="card mt-4 p-4">
      <h2 className="text-base">
        {granularity === "week"
          ? t("history.chartWeek")
          : t("history.chartMonth")}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {hazards.map((hazard) => (
          <li key={hazard} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: HAZARD_COLOR[hazard] }}
            />
            {t(`history.hazard.${hazard}`)}
          </li>
        ))}
      </ul>
      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
          >
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={axis}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={axis}
              allowDecimals={false}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "var(--raised)" }}
            />
            {hazards.map((hazard) => (
              <Bar
                key={hazard}
                dataKey={hazard}
                stackId="hazards"
                name={t(`history.hazard.${hazard}`)}
                fill={HAZARD_COLOR[hazard]}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
