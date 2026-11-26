import { PNG } from "pngjs";
import sharp from "sharp";

export const SHARE_CARD_MAX_BYTES = 37_888; // 37 * 1024

export type ImageFormat = "png" | "jpeg" | "webp" | "unknown";

export interface DecodedRasterInfo {
  format: ImageFormat;
  width: number;
  height: number;
  channels: number;
  distinctPixelSamples: number;
  isBlank: boolean;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function detectImageFormat(bytes: Uint8Array): ImageFormat {
  if (
    bytes.byteLength >= 8 &&
    PNG_MAGIC.every((byte, idx) => bytes[idx] === byte)
  ) {
    return "png";
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return "unknown";
}

function countDistinctRgbaSamples(
  rgba: Uint8Array,
  width: number,
  height: number,
): number {
  const totalPixels = width * height;
  if (totalPixels === 0) return 0;

  // Sample up to ~4096 evenly spaced pixels for fast entropy/non-blank check.
  const step = Math.max(1, Math.floor(totalPixels / 4096));
  const seen = new Set<string>();
  for (let p = 0; p < totalPixels; p += step) {
    const idx = p * 4;
    const key = `${rgba[idx] ?? 0},${rgba[idx + 1] ?? 0},${rgba[idx + 2] ?? 0},${rgba[idx + 3] ?? 0}`;
    seen.add(key);
    if (seen.size >= 64) {
      break;
    }
  }
  return seen.size;
}

export async function decodeRasterDimensions(
  bytes: Uint8Array,
): Promise<DecodedRasterInfo> {
  const format = detectImageFormat(bytes);
  if (format === "unknown") {
    throw new Error(
      `Cannot decode image: unrecognized magic bytes (length=${bytes.byteLength})`,
    );
  }

  if (format === "png") {
    const decoded = PNG.sync.read(Buffer.from(bytes));
    const distinctPixelSamples = countDistinctRgbaSamples(
      decoded.data,
      decoded.width,
      decoded.height,
    );
    return {
      format,
      width: decoded.width,
      height: decoded.height,
      channels: 4,
      distinctPixelSamples,
      isBlank: distinctPixelSamples < 2,
    };
  }

  const { data, info } = await sharp(Buffer.from(bytes))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const distinctPixelSamples = countDistinctRgbaSamples(
    data,
    info.width,
    info.height,
  );
  return {
    format,
    width: info.width,
    height: info.height,
    channels: info.channels,
    distinctPixelSamples,
    isBlank: distinctPixelSamples < 2,
  };
}

export async function assertValidShareCardImage(
  bytes: Uint8Array,
  maxBytes = SHARE_CARD_MAX_BYTES,
): Promise<DecodedRasterInfo> {
  if (bytes.byteLength === 0) {
    throw new Error("Share card image is empty (0 bytes)");
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `Share card exceeds byte budget: ${bytes.byteLength} bytes > ${maxBytes} bytes (${(maxBytes / 1024).toFixed(0)} KB)`,
    );
  }

  const format = detectImageFormat(bytes);
  if (format === "unknown") {
    throw new Error(
      `Share card payload is not a valid PNG, JPEG, or WebP raster (length=${bytes.byteLength})`,
    );
  }

  const decoded = await decodeRasterDimensions(bytes);
  if (decoded.width <= 0 || decoded.height <= 0) {
    throw new Error(
      `Share card decoded with invalid dimensions: ${decoded.width}x${decoded.height}`,
    );
  }
  if (decoded.isBlank) {
    throw new Error(
      `Share card appears blank/solid-color (${decoded.distinctPixelSamples} distinct pixel sample across ${decoded.width}x${decoded.height})`,
    );
  }

  return decoded;
}
