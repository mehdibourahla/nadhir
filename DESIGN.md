# Nadhir Atlas Design System

## 1. Product Direction

- **Product:** Live national multi-hazard awareness, weather vigilance, wildfire detection, seismic tracking, and emergency survival toolkit for Algeria across all 69 wilayas and 1,541 communes.
- **Character:** Authoritative, instrument-grade, legible under pressure.
- **World:** Mediterranean maritime navigation charts, Swiss federal meteorological broadcast bulletins, and cockpit electronic flight bags.
- **Moments:** The full-bleed live cartographic radar canvas with Terrain, Satellite, and Night basemaps; proportional 6-day temperature and precipitation bars paired with giant display readings; hairline-divided national figures and the 28-tick telemetry status wall.
- **Signature:** A 68px vertical start-edge Instrument Rail on desktop (auto-mirroring to the right edge in Arabic RTL) and a floating bottom-center Tactical Layer and Basemap Dock carrying live Algiers time (`CET`).

## 2. Explicit Anti-Patterns

- Never ship a horizontal desktop top navbar. Desktop navigation lives exclusively in the 68px start-edge Instrument Rail.
- Never use warm stone backgrounds, terracotta accents, generic charcoal dark mode, or IBM Plex typography.
- Never default the live map to flat washed-out gray Carto Positron without relief, satellite, and dark maritime chart options.
- Never render repetitive ungrouped per-row ONM alert lists or flat horizontal 6-row SaaS forecast tables.
- Never use purple or pink gradients, glowing borders, nested cards inside cards, emoji icons, exclamation marks in UI copy, or em dashes.

## 3. Color Architecture

### Nocturnal Atlas (Dark Mode)

Deep Mediterranean night navy palette calibrated for low-light tactical legibility and long monitoring shifts.

| Token | Value | Usage |
| --- | --- | --- |
| `--atlas-canvas` | `#070D17` | Page backdrop and full-bleed shell canvas |
| `--atlas-surface` | `#0D1626` | Instrument Rail, floating HUD capsules, panels |
| `--atlas-surface-raised` | `#132035` | Hover states, active pills, elevated wells |
| `--atlas-hairline` | `rgba(148, 179, 219, 0.14)` | Crisp 1px structural rules and dividers |
| `--atlas-hairline-strong` | `rgba(148, 179, 219, 0.26)` | Focused controls and active rail indicators |
| `--atlas-ink` | `#EDF3FA` | Primary display and body text (> 14:1 contrast) |
| `--atlas-ink-secondary` | `#8BA1BF` | Secondary copy, timestamps, labels (> 6.5:1 contrast) |
| `--atlas-ink-muted` | `#637B9C` | Quiet metadata and ticks (large/UI non-text or >= 4.5:1 where text) |
| `--atlas-accent` | `#38BDF8` | Radar cyan-cobalt active indicator, focus rings, telemetry |
| `--atlas-accent-ink` | `#04111F` | Ink on solid accent actions |

### Swiss Cartographic Alabaster (Light Mode)

Cool architectural paper palette inspired by Swiss national topographic maps and federal weather bulletins.

| Token | Value | Usage |
| --- | --- | --- |
| `--atlas-canvas` | `#F1F4F9` | Page backdrop |
| `--atlas-surface` | `#FFFFFF` | Instrument Rail, floating HUD capsules, primary sheets |
| `--atlas-surface-raised` | `#E7ECF4` | Subtle tinted wells, metric bands, hover states |
| `--atlas-hairline` | `#D5DFEC` | Crisp 1px hairlines and editorial dividers |
| `--atlas-hairline-strong` | `#B2C2D8` | Strong rules and interactive control borders |
| `--atlas-ink` | `#0A1628` | Deep maritime navy ink (> 15:1 contrast) |
| `--atlas-ink-secondary` | `#475B78` | Secondary labels and metadata (> 6.5:1 contrast) |
| `--atlas-ink-muted` | `#5B6F8C` | Captions and subtle UI text (>= 4.7:1 contrast) |
| `--atlas-accent` | `#0A58FF` | Swiss signal cobalt active state and primary actions |
| `--atlas-accent-ink` | `#FFFFFF` | Ink on solid cobalt actions |

### Semantic Hazard Tokens

Always paired with a visible text label or semantic icon. Never rely on color alone.

| Hazard / State | Light Mode | Dark Mode |
| --- | --- | --- |
| Extreme / Wildfire / Outage | `#E11D48` | `#FB7185` |
| High / ONM Orange / Warning | `#D97706` | `#FBBF24` |
| Moderate / ONM Yellow | `#CA8A04` | `#FACC15` |
| Rain / Flood / Hydrological | `#0284C7` | `#38BDF8` |
| Seismic / Earthquake | `#7C3AED` | `#A78BFA` |
| Clear / Healthy / Safe | `#059669` | `#34D399` |

## 4. Typography

Loaded via Google Fonts in `src/routes/__root.tsx`:

- **Display / Editorial Headlines:** `Fraunces` (optical size, weights `500`, `600`, tracking `-0.02em` to `-0.03em`) for Latin; `Cairo` (weights `700`, `800`, `line-height: 1.3`, `letter-spacing: 0`) for Arabic.
- **UI Body:** `Plus Jakarta Sans` (weights `400`, `500`, `600`, `line-height: 1.5`) for Latin; `Cairo` (weights `400`, `500`, `600`, `line-height: 1.65`, `letter-spacing: 0`) for Arabic.
- **Telemetry / Coordinates / ICAO / FWI / Clock:** `JetBrains Mono` (`font-variant-numeric: tabular-nums`).

### Rules

- Sentence case for interface copy. Editorial edition stamps may use mono metadata without loose letter-spacing on Arabic.
- Zero letter-spacing on Arabic script across every heading, button, and caption.
- No italics on Arabic text.
- Consistent Western digits (`0-9`) across North African Arabic, French, English, and Kabyle views, always rendered with `tabular-nums`.
- Zero em dashes (`U+2014`) anywhere in copy, labels, separators, or documentation. Use middle dot (`·`), colon (`:`), or comma instead.

## 5. Spatial Shell and Navigation

### Desktop (`md+`, >= 768px)

- **68px Vertical Start-Edge Instrument Rail** (`fixed inset-y-0 start-0 w-[68px] z-40`):
  - Automatically mirrors to the right edge in Arabic RTL via logical CSS properties.
  - Top: Custom geometric Nadhir compass-beacon emblem linking to `/`.
  - Center: 6 navigation stops (`Map`, `Forecast`, `History`, `Survival`, `Status`, `Contribute`) plus a quick `Report` trigger. Active item shows a crisp 3px start-edge accent bar and raised tile.
  - Bottom: Compact `AR / FR / EN` locale cycle/menu, `Light / Dark` theme toggle, and Account/Sign-in control.
- Non-map pages offset main content with `md:ps-[68px]`. The live map page (`/`) fills `100vw x 100dvh` beside the rail with zero scroll traps.

### Mobile (`< md`, < 768px)

- Slim 52px top utility header (emblem + search trigger + locale + theme + account).
- Tactile floating **5-item bottom pill dock** (`Map`, `Forecast`, `Survival`, `Alerts`, `More` drawer) with safe-area bottom padding and 44px minimum tap targets.
- On `/`, the situation drawer starts as a compact peek sheet leaving at least 72% unobstructed map canvas.

### Global Command Palette (`Cmd+K` / `Ctrl+K`)

Instant search across all 69 wilayas, 1,541 communes, and active national hazards, jumping directly to the wilaya dossier, forecast view, or map focus.

## 6. Signature Screen Patterns

1. **Live Map (`/`):**
   - Edge-to-edge MapLibre GL map with 3 real switchable basemaps: `Terrain` (Carto Voyager relief), `Satellite` (Esri World Imagery raster tiles with cartographic labels), and `Night` (Carto Dark Matter maritime palette).
   - Start-side floating Briefing Capsule (live status dot, active hazard count, `Cmd+K` search trigger, GPS locate).
   - Collapsible `360px` Grouped Situation Drawer grouping duplicate ONM bulletins by Wilaya into scannable Wilaya Alert Cards with expandable details.
   - Bottom-center Floating Tactical Layer and Basemap Dock with hazard filter pills and live counts, basemap switcher, and live Algiers clock (`HH:mm CET`).
   - End-edge zoom and compass stack clearly separated from MapLibre attribution.
2. **Forecast (`/forecast`):**
   - Asymmetric Apple Weather + MeteoSwiss layout: left column shows giant `56px` current temperature, condition, wind vector, precipitation, horizontal FWI danger meter, WHO PM2.5 air bar, and wilaya dossier link; right column shows a 6-day visual strip with proportional temperature range bars, rain bars, ONM vigilance badges, and FWI indicators.
   - Below: Aviation EFB METAR strip with mono ICAO codes (`DAAG`, `DAOO`, `DAAE`) and a National Wilaya Watchlist grouped by severity tier (`Severe`, `Elevated`, `Watch`).
3. **Wilaya Dossier (`/wilaya/$slug`):**
   - Swiss Civic Broadcast masthead with giant wilaya code (`16`), bilingual Fraunces + Cairo title, live verdict, mono coordinates, and Map / Subscribe actions.
   - Official ONM bulletins rendered as hairline-divided rows with a crisp `4px` start-edge vertical severity bar and validity progress bar.
   - Side telemetry column: FWI gauge, nearest METAR tile, 72h seismic watch, and confirmed/probable fire clusters with strict ADR-0002 attribution.
4. **Hazard History (`/history`):**
   - NYT Graphics editorial header with giant hairline-divided headline figures formatted via `Intl.NumberFormat` (zero boxy KPI cards) and a clean Recharts multi-series chart with inline swatch legend.
5. **System Status (`/status`):**
   - Tactical telemetry wall with health masthead, a **28-tick visual uptime bar** (one tick per live data source colored by status), `Affected sources` pinned above the fold, and a compact 2-column family telemetry ledger.
6. **Emergency Survival (`/survival`, `/survival/areas`, `/survival/checkin`, `/survival/sos`):**
   - High-contrast emergency bar with 1-tap Algerian official numbers (`14` Civil Protection, `1548` Police, `1055` Gendarmerie, `1070` Forests), offline pack status, hazard protocols, nearest safe open areas, family check-in composer, and local SOS queue.

## 7. RTL, Accessibility, and Surface Polish

- Logical CSS properties (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `text-start`, `border-s-*`) across every component so `dir="rtl"` mirrors cleanly.
- Directional icons (chevrons, back arrows) flip in RTL; universal icons (search, phone, clock, compass, flame) never flip.
- Mixed-script strings, coordinates, ICAO codes, and signed values wrap in `<bdi dir="ltr">`.
- Custom themed text selection, focus rings (`2px solid var(--atlas-accent)`), scrollbars, and `tabular-nums` on every numeric column.
- WCAG AA contrast minimum (`>= 4.5:1` body, `>= 3:1` large display and UI controls) in both Nocturnal Atlas dark mode and Swiss Alabaster light mode.
