import {
  UNIVERSAL_SHARE_FORMATS,
  type ShareCardIconKind,
  type UniversalShareCardModel,
  type UniversalShareFormat,
} from "@/lib/share-card";

const SAFE_HEX_RE = /^#[0-9a-fA-F]{6}$/;

function safeHex(value: string, fallback: string): string {
  return SAFE_HEX_RE.test(value) ? value : fallback;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hazardIconSvg(kind: ShareCardIconKind, size: number): string {
  const common = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  switch (kind) {
    case "onm":
      return `<svg ${common}><path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12-3 5h4l-3 5"/></svg>`;
    case "fire":
      return `<svg ${common}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`;
    case "quake":
      return `<svg ${common}><path d="M2 12h3l2.5-7 4 14 3.5-10 2.5 3H22"/></svg>`;
    case "wilaya":
      return `<svg ${common}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;
    case "incident":
    default:
      return `<svg ${common}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  }
}

interface LayoutMetrics {
  padX: number;
  padY: number;
  eyebrowPx: number;
  badgePx: number;
  titlePx: number;
  subtitlePx: number;
  metaPx: number;
  footerPx: number;
  iconPx: number;
  titleLines: number;
  subtitleLines: number;
  stripePx: number;
  radiusPx: number;
}

function layoutMetrics(format: UniversalShareFormat): LayoutMetrics {
  switch (format) {
    case "whatsapp":
      return {
        padX: 40,
        padY: 30,
        eyebrowPx: 18,
        badgePx: 17,
        titlePx: 36,
        subtitlePx: 22,
        metaPx: 17,
        footerPx: 18,
        iconPx: 20,
        titleLines: 2,
        subtitleLines: 2,
        stripePx: 8,
        radiusPx: 0,
      };
    case "facebook":
    case "og":
      return {
        padX: 60,
        padY: 46,
        eyebrowPx: 24,
        badgePx: 23,
        titlePx: 52,
        subtitlePx: 30,
        metaPx: 22,
        footerPx: 24,
        iconPx: 26,
        titleLines: 2,
        subtitleLines: 2,
        stripePx: 10,
        radiusPx: 0,
      };
    case "post":
      return {
        padX: 64,
        padY: 64,
        eyebrowPx: 26,
        badgePx: 26,
        titlePx: 58,
        subtitlePx: 34,
        metaPx: 26,
        footerPx: 26,
        iconPx: 30,
        titleLines: 3,
        subtitleLines: 3,
        stripePx: 12,
        radiusPx: 0,
      };
    case "story":
      return {
        padX: 72,
        padY: 160,
        eyebrowPx: 28,
        badgePx: 28,
        titlePx: 66,
        subtitlePx: 38,
        metaPx: 28,
        footerPx: 28,
        iconPx: 32,
        titleLines: 3,
        subtitleLines: 4,
        stripePx: 12,
        radiusPx: 0,
      };
    case "sticker":
      return {
        padX: 34,
        padY: 30,
        eyebrowPx: 16,
        badgePx: 16,
        titlePx: 32,
        subtitlePx: 20,
        metaPx: 15,
        footerPx: 16,
        iconPx: 18,
        titleLines: 2,
        subtitleLines: 2,
        stripePx: 8,
        radiusPx: 32,
      };
  }
}

/**
 * Renders a completely self-contained, offline HTML document for a universal
 * share card (zero external URLs, zero remote fonts, zero scripts).
 */
export function renderUniversalShareCardHtml(
  model: UniversalShareCardModel,
  format: UniversalShareFormat,
): string {
  const { width, height, omitBackground } = UNIVERSAL_SHARE_FORMATS[format];
  const m = layoutMetrics(format);
  const accent = safeHex(model.accentHex, "#57cbb0");
  const badgeBg = safeHex(model.badgeBgHex, "#1e293b");
  const badgeFg = safeHex(model.badgeFgHex, "#ffffff");

  const dir = model.rtl ? "rtl" : "ltr";
  const eyebrowText = escapeHtml(model.eyebrow);
  const eyebrowHtml = model.eyebrowLtr
    ? `<bdi dir="ltr">${eyebrowText}</bdi>`
    : eyebrowText;

  const badgeText = escapeHtml(model.badge);
  const badgeHtml = model.badgeLtr
    ? `<bdi dir="ltr">${badgeText}</bdi>`
    : badgeText;

  const titleHtml = escapeHtml(model.title);
  const subtitleHtml = model.subtitle ? escapeHtml(model.subtitle) : "";
  const coordsHtml = model.coordsLtr
    ? `<bdi dir="ltr" class="coords">${escapeHtml(model.coordsLtr)}</bdi>`
    : "";
  const metaHtml = model.metaLine ? escapeHtml(model.metaLine) : "";
  const timestampHtml = escapeHtml(model.timestamp);
  const disclaimerHtml = model.disclaimer ? escapeHtml(model.disclaimer) : "";
  const footerHtml = `<bdi dir="ltr">${escapeHtml(model.footer)}</bdi>`;
  const iconSvg = hazardIconSvg(model.icon, m.iconPx);
  const brandLabel = model.lang === "ar" ? "نذير" : "Nadhir";

  const bodyBg = omitBackground ? "transparent" : "#101418";
  const cardMargin = omitBackground ? 14 : 0;
  const cardWidth = width - cardMargin * 2;
  const cardHeight = height - cardMargin * 2;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(model.lang)}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${width}, height=${height}, initial-scale=1" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: ${bodyBg};
    color: #ffffff;
    font-family: 'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Geeza Pro', 'SF Arabic', 'Tahoma', 'DejaVu Sans', 'Noto Sans Tifinagh', 'Arial', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    width: ${cardWidth}px;
    height: ${cardHeight}px;
    margin: ${cardMargin}px;
    background: #101418;
    border-top: ${m.stripePx}px solid ${accent};
    border-radius: ${m.radiusPx}px;
    ${omitBackground ? "border-left: 2px solid #24303c; border-right: 2px solid #24303c; border-bottom: 2px solid #24303c;" : ""}
    padding: ${m.padY}px ${m.padX}px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }
  .top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
  }
  .eyebrow {
    font-size: ${m.eyebrowPx}px;
    font-weight: 600;
    color: #cbd5e1;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    background: ${badgeBg};
    color: ${badgeFg};
    font-size: ${m.badgePx}px;
    font-weight: 700;
    line-height: 1.2;
    padding: 8px 14px;
    border-radius: 999px;
    max-width: 60%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: ${format === "whatsapp" || format === "sticker" ? 10 : 16}px;
    min-width: 0;
    overflow: hidden;
  }
  .title {
    font-size: ${m.titlePx}px;
    font-weight: 700;
    line-height: ${model.rtl ? 1.32 : 1.18};
    color: #ffffff;
    display: -webkit-box;
    -webkit-line-clamp: ${m.titleLines};
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
  .subtitle {
    font-size: ${m.subtitlePx}px;
    font-weight: 500;
    line-height: ${model.rtl ? 1.42 : 1.3};
    color: #cbd5e1;
    display: -webkit-box;
    -webkit-line-clamp: ${m.subtitleLines};
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
  .meta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    font-size: ${m.metaPx}px;
    font-weight: 500;
    color: #cbd5e1;
    line-height: 1.35;
  }
  .coords {
    font-family: 'SFMono-Regular', 'Menlo', 'DejaVu Sans Mono', monospace;
    color: #57cbb0;
    font-weight: 600;
  }
  .disclaimer {
    font-size: ${Math.max(13, m.metaPx - 2)}px;
    color: #94a3b8;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .bottom-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-top: ${format === "whatsapp" || format === "sticker" ? 12 : 18}px;
    border-top: 1px solid #24303c;
    min-width: 0;
  }
  .timestamp {
    font-size: ${m.metaPx}px;
    color: #cbd5e1;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    font-size: ${m.footerPx}px;
    font-weight: 700;
    color: #57cbb0;
    letter-spacing: 0.01em;
  }
  .brand-sep {
    color: #64748b;
  }
</style>
</head>
<body>
  <article class="card" data-share-kind="${escapeHtml(model.kind)}" data-share-lang="${escapeHtml(model.lang)}">
    <header class="top-row">
      <div class="eyebrow">${eyebrowHtml}</div>
      <div class="badge">${iconSvg}<span>${badgeHtml}</span></div>
    </header>
    <main class="main">
      <h1 class="title">${titleHtml}</h1>
      ${subtitleHtml ? `<p class="subtitle">${subtitleHtml}</p>` : ""}
      ${
        metaHtml || coordsHtml
          ? `<div class="meta-row">${metaHtml ? `<span>${metaHtml}</span>` : ""}${coordsHtml}</div>`
          : ""
      }
      ${disclaimerHtml ? `<p class="disclaimer">${disclaimerHtml}</p>` : ""}
    </main>
    <footer class="bottom-row">
      <div class="timestamp">${timestampHtml}</div>
      <div class="brand"><span>${escapeHtml(brandLabel)}</span><span class="brand-sep" aria-hidden="true">·</span>${footerHtml}</div>
    </footer>
  </article>
</body>
</html>`;
}
