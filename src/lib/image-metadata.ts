export const MAX_REPORT_PHOTO_BYTES = 8 * 1024 * 1024;

export type AllowedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);
const WEBP_KEEP = new Set([
  "VP8 ",
  "VP8L",
  "VP8X",
  "ALPH",
  "ANIM",
  "ANMF",
  "ICCP",
]);

function assemble(
  bytes: Uint8Array,
  keep: [number, number][],
): Uint8Array<ArrayBuffer> {
  const size = keep.reduce((n, [from, to]) => n + (to - from), 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const [from, to] of keep) {
    out.set(bytes.subarray(from, to), at);
    at += to - from;
  }
  return out;
}

const ICC_MARKER = "ICC_PROFILE\0";

// APP2 carries ICC profiles but also MPF, whose embedded second image keeps its own
// Exif and GPS, so the segment is kept on its payload identifier, not its marker.
function isIccProfile(bytes: Uint8Array, payloadAt: number): boolean {
  if (payloadAt + ICC_MARKER.length > bytes.length) return false;
  for (let k = 0; k < ICC_MARKER.length; k += 1) {
    if (bytes[payloadAt + k] !== ICC_MARKER.charCodeAt(k)) return false;
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let k = 0; k < length; k += 1) {
    out += String.fromCharCode(bytes[offset + k]!);
  }
  return out;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

export function detectImageMimeType(
  bytes: Uint8Array,
): AllowedImageMimeType | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    PNG_SIGNATURE.every((b, index) => bytes[index] === b)
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    asciiAt(bytes, 0, 4) === "RIFF" &&
    asciiAt(bytes, 8, 4) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function imageExtensionForMime(
  mime: AllowedImageMimeType,
): "jpg" | "png" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function normalizeDeclaredMime(raw: string): string {
  const base = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  return base === "image/jpg" ? "image/jpeg" : base;
}

/** Keeps JFIF (APP0) and a real ICC profile (APP2); every other APPn and COM carries
 *  Exif, XMP, IPTC or MPF, which is where the reporter's GPS and device identity live. */
function stripJpeg(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const keep: [number, number][] = [[0, 2]];
  let i = 2;
  let foundEoi = false;

  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error("invalid_image");
    while (i + 1 < bytes.length && bytes[i + 1] === 0xff) {
      i += 1;
    }
    if (i + 1 >= bytes.length) throw new Error("invalid_image");

    const marker = bytes[i + 1]!;
    if (marker === 0xd9) {
      keep.push([i, i + 2]);
      foundEoi = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      keep.push([i, i + 2]);
      i += 2;
      continue;
    }
    if (marker === 0x00 || marker === 0xd8) {
      throw new Error("invalid_image");
    }

    if (i + 4 > bytes.length) throw new Error("invalid_image");
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (length < 2 || i + 2 + length > bytes.length) {
      throw new Error("invalid_image");
    }

    if (marker === 0xda) {
      let j = i + 2 + length;
      let markerStart = -1;
      while (j < bytes.length) {
        if (bytes[j] !== 0xff) {
          j += 1;
          continue;
        }
        const ffStart = j;
        while (j < bytes.length && bytes[j] === 0xff) {
          j += 1;
        }
        if (j >= bytes.length) break;
        const next = bytes[j]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          j += 1;
          continue;
        }
        markerStart = ffStart;
        break;
      }
      if (markerStart === -1) throw new Error("invalid_image");
      keep.push([i, markerStart]);
      i = markerStart;
      continue;
    }

    const isApp = marker >= 0xe1 && marker <= 0xef;
    const drop =
      marker === 0xfe ||
      (isApp &&
        !(
          marker === 0xe2 &&
          length - 2 >= ICC_MARKER.length &&
          isIccProfile(bytes, i + 4)
        ));
    if (!drop) keep.push([i, i + 2 + length]);
    i += 2 + length;
  }

  if (!foundEoi) throw new Error("invalid_image");
  return assemble(bytes, keep);
}

function stripPng(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const keep: [number, number][] = [[0, 8]];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 8;
  let chunkIndex = 0;
  let foundIend = false;

  while (i < bytes.length) {
    if (i + 12 > bytes.length) throw new Error("invalid_image");
    const length = view.getUint32(i, false);
    if (length > 0x7fffffff || i + 12 + length > bytes.length) {
      throw new Error("invalid_image");
    }
    for (let k = 0; k < 4; k += 1) {
      if (!isAsciiLetter(bytes[i + 4 + k]!)) {
        throw new Error("invalid_image");
      }
    }
    const type = asciiAt(bytes, i + 4, 4);
    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) {
      throw new Error("invalid_image");
    }
    if (type === "IEND") {
      if (length !== 0) throw new Error("invalid_image");
      keep.push([i, i + 12]);
      foundIend = true;
      break;
    }
    if (!PNG_DROP.has(type)) {
      keep.push([i, i + 12 + length]);
    }
    i += 12 + length;
    chunkIndex += 1;
  }

  if (!foundIend) throw new Error("invalid_image");
  return assemble(bytes, keep);
}

function stripWebp(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.length < 12) throw new Error("invalid_image");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize < 4 || 8 + riffSize > bytes.length) {
    throw new Error("invalid_image");
  }
  const riffEnd = 8 + riffSize;
  const keptChunks: Uint8Array[] = [];
  let offset = 12;
  let hasImagePayload = false;

  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) throw new Error("invalid_image");
    const fourCC = asciiAt(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const paddedSize = chunkSize + (chunkSize & 1);
    if (offset + 8 + chunkSize > riffEnd) {
      throw new Error("invalid_image");
    }
    if (
      offset + 8 + paddedSize > riffEnd &&
      offset + 8 + chunkSize !== riffEnd
    ) {
      throw new Error("invalid_image");
    }

    if (WEBP_KEEP.has(fourCC)) {
      const chunkOut = new Uint8Array(8 + paddedSize);
      chunkOut.set(bytes.subarray(offset, offset + 8 + chunkSize), 0);
      if (fourCC === "VP8X") {
        if (chunkSize !== 10) throw new Error("invalid_image");
        // Clear EXIF (bit 3 = 0x08) and XMP (bit 2 = 0x04) feature flags.
        chunkOut[8] = chunkOut[8]! & ~(0x08 | 0x04);
      }
      if (fourCC === "VP8 " || fourCC === "VP8L" || fourCC === "ANMF") {
        hasImagePayload = true;
      }
      keptChunks.push(chunkOut);
    }

    offset += 8 + paddedSize;
  }

  if (!hasImagePayload) throw new Error("invalid_image");

  const payloadBytes = keptChunks.reduce(
    (sum, chunk) => sum + chunk.byteLength,
    0,
  );
  const out = new Uint8Array(12 + payloadBytes);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  outView.setUint32(4, out.byteLength - 8, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP

  let cursor = 12;
  for (const chunk of keptChunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}

export function stripImageMetadata(
  bytes: Uint8Array,
  type: string,
): Uint8Array<ArrayBuffer> {
  const normalized = normalizeDeclaredMime(type);
  if (normalized === "image/jpeg") {
    if (
      bytes.length < 4 ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes[2] !== 0xff
    ) {
      throw new Error("unsupported_type");
    }
    return stripJpeg(bytes);
  }
  if (normalized === "image/png") {
    if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
      throw new Error("unsupported_type");
    }
    return stripPng(bytes);
  }
  if (normalized === "image/webp") {
    if (
      bytes.length < 12 ||
      asciiAt(bytes, 0, 4) !== "RIFF" ||
      asciiAt(bytes, 8, 4) !== "WEBP"
    ) {
      throw new Error("unsupported_type");
    }
    return stripWebp(bytes);
  }
  throw new Error("unsupported_type");
}

export interface StrippedReportPhoto {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: AllowedImageMimeType;
  extension: "jpg" | "png" | "webp";
  strippedBytes: number;
}

export function validateAndStripReportPhoto(
  bytes: Uint8Array,
  options?: { declaredMime?: string | null; maxBytes?: number },
): StrippedReportPhoto {
  const maxBytes = options?.maxBytes ?? MAX_REPORT_PHOTO_BYTES;
  if (bytes.byteLength === 0) throw new Error("invalid_image");
  if (bytes.byteLength > maxBytes) throw new Error("too_large");

  const detected = detectImageMimeType(bytes);
  if (!detected) throw new Error("unsupported_type");

  const rawDeclared = options?.declaredMime?.trim() ?? "";
  if (rawDeclared) {
    const normalized = normalizeDeclaredMime(rawDeclared);
    if (normalized !== "application/octet-stream" && normalized !== detected) {
      throw new Error("unsupported_type");
    }
  }

  const cleaned = stripImageMetadata(bytes, detected);
  if (detectImageMimeType(cleaned) !== detected) {
    throw new Error("invalid_image");
  }

  return {
    bytes: cleaned,
    mimeType: detected,
    extension: imageExtensionForMime(detected),
    strippedBytes: Math.max(0, bytes.byteLength - cleaned.byteLength),
  };
}
