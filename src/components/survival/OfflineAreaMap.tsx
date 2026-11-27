import { useTranslation } from "react-i18next";
import type { SurvivalPack } from "@/lib/survival-pack";

export function OfflineAreaMap({ pack }: { pack: SurvivalPack }) {
  const { t } = useTranslation();
  if (!pack.area_map) return null;
  const polygons =
    pack.area_map.type === "Polygon"
      ? [pack.area_map.coordinates]
      : pack.area_map.coordinates;
  const points = [
    ...polygons.flat(2),
    ...pack.openAreas.map((p) => [p.lon, p.lat]),
    [pack.lon, pack.lat],
  ];
  const west = Math.min(...points.map((p) => p[0]!)),
    east = Math.max(...points.map((p) => p[0]!));
  const south = Math.min(...points.map((p) => p[1]!)),
    north = Math.max(...points.map((p) => p[1]!));
  const x = (lon: number) =>
    15 + ((lon - west) / Math.max(0.01, east - west)) * 330;
  const y = (lat: number) =>
    15 + ((north - lat) / Math.max(0.01, north - south)) * 230;
  return (
    <section className="card p-3">
      <h2 className="text-sm font-semibold">{t("survival.packMap")}</h2>
      <svg
        role="img"
        aria-label={t("survival.packMap")}
        viewBox="0 0 360 260"
        className="mt-2 w-full rounded bg-muted"
      >
        {polygons.map((rings, i) => (
          <path
            key={i}
            d={rings
              .map(
                (ring) =>
                  ring
                    .map((p, j) => `${j ? "L" : "M"}${x(p[0]!)} ${y(p[1]!)}`)
                    .join(" ") + "Z",
              )
              .join(" ")}
            fill="var(--background)"
            stroke="var(--foreground)"
            fillRule="evenodd"
            strokeWidth="1"
          />
        ))}
        {pack.openAreas.map((area) => (
          <circle
            key={area.id}
            cx={x(area.lon)}
            cy={y(area.lat)}
            r="3"
            fill="var(--primary)"
          >
            <title>{area.name}</title>
          </circle>
        ))}
        <path
          d={`M${x(pack.lon) - 5} ${y(pack.lat)}h10 M${x(pack.lon)} ${y(pack.lat) - 5}v10`}
          stroke="var(--foreground)"
          strokeWidth="2"
        >
          <title>{t("survival.packOrigin")}</title>
        </path>
      </svg>
      <p className="mt-2 text-xs">
        {t("survival.packOrigin")}: {pack.zone_name ?? pack.commune}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("survival.packMapNote")}
      </p>
    </section>
  );
}
