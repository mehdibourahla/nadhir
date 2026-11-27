export type MapLayers = {
  fires: boolean;
  unverified: boolean;
  official: boolean;
  reports: boolean;
  lightning: boolean;
};

export const DEFAULT_MAP_LAYERS: MapLayers = {
  fires: true,
  unverified: false,
  official: true,
  reports: true,
  lightning: false,
};

// EUMETSAT serves a tile for a week, so the 10-minute window in the URL is what refreshes it
export const lightningWindow = (now: number) => Math.floor(now / 600_000);
export const lightningTiles = (window: number) =>
  "https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetMap" +
  "&layers=mtg_fd:li_afa&styles=&format=image/png&transparent=true&crs=EPSG:3857" +
  `&width=256&height=256&bbox={bbox-epsg-3857}&t=${window}`;
