import { deflateSync } from "node:zlib";

import { PNG } from "pngjs";

interface RgbaEntry {
  r: number;
  g: number;
  b: number;
  a: number;
  count: number;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(typeBytes: Uint8Array, data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < typeBytes.length; i += 1) {
    c = CRC_TABLE[(c ^ typeBytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ]);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(typeBytes, data), false);
  return out;
}

interface ColorBox {
  entries: RgbaEntry[];
  totalCount: number;
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
  aMin: number;
  aMax: number;
}

function buildBox(entries: RgbaEntry[]): ColorBox {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  let aMin = 255;
  let aMax = 0;
  let totalCount = 0;
  for (const e of entries) {
    totalCount += e.count;
    if (e.r < rMin) rMin = e.r;
    if (e.r > rMax) rMax = e.r;
    if (e.g < gMin) gMin = e.g;
    if (e.g > gMax) gMax = e.g;
    if (e.b < bMin) bMin = e.b;
    if (e.b > bMax) bMax = e.b;
    if (e.a < aMin) aMin = e.a;
    if (e.a > aMax) aMax = e.a;
  }
  return {
    entries,
    totalCount,
    rMin,
    rMax,
    gMin,
    gMax,
    bMin,
    bMax,
    aMin,
    aMax,
  };
}

function boxRange(box: ColorBox): number {
  return Math.max(
    box.rMax - box.rMin,
    box.gMax - box.gMin,
    box.bMax - box.bMin,
    box.aMax - box.aMin,
  );
}

function splitBox(box: ColorBox): [ColorBox, ColorBox] | null {
  if (box.entries.length < 2) return null;
  const rRange = box.rMax - box.rMin;
  const gRange = box.gMax - box.gMin;
  const bRange = box.bMax - box.bMin;
  const aRange = box.aMax - box.aMin;
  const maxRange = Math.max(rRange, gRange, bRange, aRange);
  if (maxRange === 0) return null;

  const sorted = [...box.entries].sort((x, y) => {
    if (maxRange === aRange) return x.a - y.a;
    if (maxRange === rRange) return x.r - y.r;
    if (maxRange === gRange) return x.g - y.g;
    return x.b - y.b;
  });

  const half = box.totalCount / 2;
  let acc = 0;
  let splitIdx = 1;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    acc += sorted[i]!.count;
    splitIdx = i + 1;
    if (acc >= half) break;
  }

  return [
    buildBox(sorted.slice(0, splitIdx)),
    buildBox(sorted.slice(splitIdx)),
  ];
}

function averageBox(box: ColorBox): RgbaEntry {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let aSum = 0;
  let count = 0;
  for (const e of box.entries) {
    rSum += e.r * e.count;
    gSum += e.g * e.count;
    bSum += e.b * e.count;
    aSum += e.a * e.count;
    count += e.count;
  }
  const denom = Math.max(1, count);
  return {
    r: Math.round(rSum / denom),
    g: Math.round(gSum / denom),
    b: Math.round(bSum / denom),
    a: Math.round(aSum / denom),
    count,
  };
}

function selectPalette(entries: RgbaEntry[], maxColors: number): RgbaEntry[] {
  if (entries.length === 0) {
    return [{ r: 16, g: 20, b: 24, a: 255, count: 1 }];
  }
  if (entries.length <= maxColors) {
    return entries;
  }

  const boxes: ColorBox[] = [buildBox(entries)];
  while (boxes.length < maxColors) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i]!;
      if (box.entries.length < 2) continue;
      const range = boxRange(box);
      if (range === 0) continue;
      const score = range * Math.sqrt(box.totalCount);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const split = splitBox(boxes[bestIdx]!);
    if (!split) break;
    boxes.splice(bestIdx, 1, split[0], split[1]);
  }

  return boxes.map(averageBox);
}

/**
 * Quantizes an arbitrary RGBA PNG to a compact indexed-palette PNG (`PLTE` +
 * optional `tRNS`) compressed with zlib level 9. Pure JS (zero native deps),
 * safe on Cloudflare Workers (`nodejs_compat`), Node, and Bun.
 */
export function quantizePngToIndexed(
  pngBytes: Uint8Array,
  maxColors: number,
): Uint8Array<ArrayBuffer> {
  const clampedColors = Math.max(2, Math.min(256, Math.round(maxColors)));
  const decoded = PNG.sync.read(Buffer.from(pngBytes));
  const { width, height, data } = decoded;
  const pixelCount = width * height;

  // Quantize into 5-bit RGB + 4-bit alpha histogram buckets for fast median-cut
  const buckets = new Map<
    number,
    { rSum: number; gSum: number; bSum: number; aSum: number; count: number }
  >();
  let hasAlpha = false;

  for (let i = 0; i < pixelCount; i += 1) {
    const off = i * 4;
    const r = data[off]!;
    const g = data[off + 1]!;
    const b = data[off + 2]!;
    const a = data[off + 3]!;
    if (a < 255) hasAlpha = true;

    const key =
      a < 8
        ? -1
        : ((r >> 3) << 14) | ((g >> 3) << 9) | ((b >> 3) << 4) | (a >> 4);
    const existing = buckets.get(key);
    if (existing) {
      existing.rSum += r;
      existing.gSum += g;
      existing.bSum += b;
      existing.aSum += a;
      existing.count += 1;
    } else {
      buckets.set(key, { rSum: r, gSum: g, bSum: b, aSum: a, count: 1 });
    }
  }

  const transparentBucket = buckets.get(-1);
  if (transparentBucket) buckets.delete(-1);

  const opaqueEntries: RgbaEntry[] = [];
  for (const b of buckets.values()) {
    opaqueEntries.push({
      r: Math.round(b.rSum / b.count),
      g: Math.round(b.gSum / b.count),
      b: Math.round(b.bSum / b.count),
      a: Math.round(b.aSum / b.count),
      count: b.count,
    });
  }

  const palette: RgbaEntry[] = [];
  if (transparentBucket) {
    palette.push({ r: 0, g: 0, b: 0, a: 0, count: transparentBucket.count });
  }
  const remainingSlots = Math.max(1, clampedColors - palette.length);
  palette.push(...selectPalette(opaqueEntries, remainingSlots));

  const bitDepth = palette.length <= 16 ? 4 : 8;
  const rowBytes = bitDepth === 4 ? Math.ceil(width / 2) : width;
  const rawScanlines = new Uint8Array(height * (1 + rowBytes));

  const nearestCache = new Map<number, number>();
  const nearestIndex = (r: number, g: number, b: number, a: number): number => {
    if (a < 8 && transparentBucket) return 0;
    const key = ((r >> 3) << 14) | ((g >> 3) << 9) | ((b >> 3) << 4) | (a >> 4);
    const cached = nearestCache.get(key);
    if (cached !== undefined) return cached;

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i += 1) {
      const p = palette[i]!;
      const dr = r - p.r;
      const dg = g - p.g;
      const db = b - p.b;
      const da = a - p.a;
      const dist = dr * dr + dg * dg + db * db + da * da * 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
        if (dist === 0) break;
      }
    }
    nearestCache.set(key, bestIdx);
    return bestIdx;
  };

  for (let y = 0; y < height; y += 1) {
    const rowOutStart = y * (1 + rowBytes);
    rawScanlines[rowOutStart] = 0; // Filter type 0 (None)
    if (bitDepth === 4) {
      for (let x = 0; x < width; x += 2) {
        const off1 = (y * width + x) * 4;
        const idx1 = nearestIndex(
          data[off1]!,
          data[off1 + 1]!,
          data[off1 + 2]!,
          data[off1 + 3]!,
        );
        let idx2 = 0;
        if (x + 1 < width) {
          const off2 = off1 + 4;
          idx2 = nearestIndex(
            data[off2]!,
            data[off2 + 1]!,
            data[off2 + 2]!,
            data[off2 + 3]!,
          );
        }
        rawScanlines[rowOutStart + 1 + (x >> 1)] = (idx1 << 4) | idx2;
      }
    } else {
      for (let x = 0; x < width; x += 1) {
        const off = (y * width + x) * 4;
        rawScanlines[rowOutStart + 1 + x] = nearestIndex(
          data[off]!,
          data[off + 1]!,
          data[off + 2]!,
          data[off + 3]!,
        );
      }
    }
  }

  // IHDR
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = bitDepth;
  ihdrData[9] = 3; // Indexed-color
  ihdrData[10] = 0; // Compression method 0
  ihdrData[11] = 0; // Filter method 0
  ihdrData[12] = 0; // No interlace

  // PLTE
  const plteData = new Uint8Array(palette.length * 3);
  for (let i = 0; i < palette.length; i += 1) {
    const p = palette[i]!;
    plteData[i * 3] = p.r;
    plteData[i * 3 + 1] = p.g;
    plteData[i * 3 + 2] = p.b;
  }

  // Optional tRNS when any palette entry has alpha < 255
  const chunks: Uint8Array[] = [
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdrData),
    makeChunk("PLTE", plteData),
  ];

  if (hasAlpha && palette.some((p) => p.a < 255)) {
    const trnsData = new Uint8Array(palette.length);
    for (let i = 0; i < palette.length; i += 1) {
      trnsData[i] = palette[i]!.a;
    }
    chunks.push(makeChunk("tRNS", trnsData));
  }

  const compressed = deflateSync(rawScanlines, { level: 9 });
  chunks.push(
    makeChunk(
      "IDAT",
      new Uint8Array(
        compressed.buffer,
        compressed.byteOffset,
        compressed.byteLength,
      ),
    ),
  );
  chunks.push(makeChunk("IEND", new Uint8Array(0)));

  const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const output = new Uint8Array(new ArrayBuffer(totalLength));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
