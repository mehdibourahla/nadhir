import { PNG } from "pngjs";

// Genuine 16x16 patterned baseline RGB JPEG generated via sharp (294 bytes).
const BASE_PATTERNED_JPEG_BASE64 =
  "/9j/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIs" +
  "IxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy" +
  "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR" +
  "CAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAABgf/xAAYEAEAAwEA" +
  "AAAAAAAAAAAAAAAFACIxof/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAYEQADAQEA" +
  "AAAAAAAAAAAAAAAAAwUhMf/aAAwDAQACEQMRAD8Am5wGUi44DKciQ4DKci44DKQp" +
  "og3uaf/Z";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export interface ExifMetadataOptions {
  make?: string;
  model?: string;
  dateTime?: string;
  latitude?: number;
  longitude?: number;
  comment?: string;
  includeIccProfile?: boolean;
  author?: string;
}

export interface ImageMetadataInspection {
  format: "jpeg" | "png" | "webp" | "unknown";
  hasExif: boolean;
  hasGps: boolean;
  hasCameraTags: boolean;
  hasTextChunks: boolean;
  markers: string[];
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function toAsciiNullTerminated(value: string): Uint8Array {
  const clean = value.endsWith("\0") ? value : `${value}\0`;
  return new TextEncoder().encode(clean);
}

function decimalToDmsRationals(
  decimalDegrees: number,
): [number, number, number, number, number, number] {
  const abs = Math.abs(decimalDegrees);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const secondsScaled = Math.round((minutesFloat - minutes) * 60 * 100);
  return [degrees, 1, minutes, 1, secondsScaled, 100];
}

/**
 * Builds a standards-compliant Little-Endian TIFF block containing:
 * - IFD0: Make (0x010F), Model (0x0110), DateTime (0x0132), GPSInfoIFDPointer (0x8825)
 * - GPS IFD: GPSLatitudeRef (0x0001), GPSLatitude (0x0002),
 *            GPSLongitudeRef (0x0003), GPSLongitude (0x0004)
 */
function buildExifTiffPayload(options: ExifMetadataOptions = {}): Uint8Array {
  const makeBytes = toAsciiNullTerminated(options.make ?? "Samsung");
  const modelBytes = toAsciiNullTerminated(options.model ?? "Galaxy A55");
  const dateTimeBytes = toAsciiNullTerminated(
    options.dateTime ?? "2026:11:24 14:30:00",
  );
  const lat = options.latitude ?? 36.7538;
  const lon = options.longitude ?? 3.0588;
  const latRef = lat >= 0 ? "N" : "S";
  const lonRef = lon >= 0 ? "E" : "W";
  const latDms = decimalToDmsRationals(lat);
  const lonDms = decimalToDmsRationals(lon);

  const headerSize = 8;
  const ifd0Count = 4;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const ifd0DataStart = headerSize + ifd0Size;

  const makeOffset = ifd0DataStart;
  const modelOffset = makeOffset + makeBytes.byteLength;
  const dateTimeOffset = modelOffset + modelBytes.byteLength;
  const rawGpsIfdOffset = dateTimeOffset + dateTimeBytes.byteLength;
  const gpsIfdOffset =
    rawGpsIfdOffset % 2 === 0 ? rawGpsIfdOffset : rawGpsIfdOffset + 1;

  const gpsCount = 4;
  const gpsIfdSize = 2 + gpsCount * 12 + 4;
  const latDataOffset = gpsIfdOffset + gpsIfdSize;
  const lonDataOffset = latDataOffset + 24;
  const totalSize = lonDataOffset + 24;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);

  // TIFF Header: "II", 42, offset to IFD0 = 8
  buf[0] = 0x49;
  buf[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, headerSize, true);

  // IFD0
  let cursor = headerSize;
  view.setUint16(cursor, ifd0Count, true);
  cursor += 2;

  const writeIfdEntry = (
    tag: number,
    type: number,
    count: number,
    valueOrOffset: number,
  ): void => {
    view.setUint16(cursor, tag, true);
    view.setUint16(cursor + 2, type, true);
    view.setUint32(cursor + 4, count, true);
    view.setUint32(cursor + 8, valueOrOffset, true);
    cursor += 12;
  };

  // Tag 0x010F: Make (ASCII = 2)
  writeIfdEntry(0x010f, 2, makeBytes.byteLength, makeOffset);
  // Tag 0x0110: Model (ASCII = 2)
  writeIfdEntry(0x0110, 2, modelBytes.byteLength, modelOffset);
  // Tag 0x0132: DateTime (ASCII = 2)
  writeIfdEntry(0x0132, 2, dateTimeBytes.byteLength, dateTimeOffset);
  // Tag 0x8825: GPSInfoIFDPointer (LONG = 4)
  writeIfdEntry(0x8825, 4, 1, gpsIfdOffset);
  // Next IFD offset = 0
  view.setUint32(cursor, 0, true);

  buf.set(makeBytes, makeOffset);
  buf.set(modelBytes, modelOffset);
  buf.set(dateTimeBytes, dateTimeOffset);

  // GPS IFD
  cursor = gpsIfdOffset;
  view.setUint16(cursor, gpsCount, true);
  cursor += 2;

  // Tag 0x0001: GPSLatitudeRef (inline ASCII "N\0\0\0")
  view.setUint16(cursor, 0x0001, true);
  view.setUint16(cursor + 2, 2, true);
  view.setUint32(cursor + 4, 2, true);
  buf[cursor + 8] = latRef.charCodeAt(0);
  buf[cursor + 9] = 0x00;
  cursor += 12;

  // Tag 0x0002: GPSLatitude (3 RATIONALs = 5)
  writeIfdEntry(0x0002, 5, 3, latDataOffset);

  // Tag 0x0003: GPSLongitudeRef (inline ASCII "E\0\0\0")
  view.setUint16(cursor, 0x0003, true);
  view.setUint16(cursor + 2, 2, true);
  view.setUint32(cursor + 4, 2, true);
  buf[cursor + 8] = lonRef.charCodeAt(0);
  buf[cursor + 9] = 0x00;
  cursor += 12;

  // Tag 0x0004: GPSLongitude (3 RATIONALs = 5)
  writeIfdEntry(0x0004, 5, 3, lonDataOffset);

  // Next IFD offset = 0
  view.setUint32(cursor, 0, true);

  // Write GPS rationals
  const writeRationals = (
    offset: number,
    values: [number, number, number, number, number, number],
  ): void => {
    for (let i = 0; i < 6; i += 1) {
      view.setUint32(offset + i * 4, values[i] ?? 0, true);
    }
  };
  writeRationals(latDataOffset, latDms);
  writeRationals(lonDataOffset, lonDms);

  return buf;
}

function buildJpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.byteLength + 2;
  const out = new Uint8Array(2 + length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = (length >> 8) & 0xff;
  out[3] = length & 0xff;
  out.set(payload, 4);
  return out;
}

export function createJpegWithExif(
  options: ExifMetadataOptions = {},
): Uint8Array {
  const base = Uint8Array.from(
    Buffer.from(BASE_PATTERNED_JPEG_BASE64, "base64"),
  );
  const exifHeader = new TextEncoder().encode("Exif\0\0");
  const tiff = buildExifTiffPayload(options);
  const app1Payload = concatBytes([exifHeader, tiff]);
  const app1Segment = buildJpegSegment(0xe1, app1Payload);

  const commentText =
    options.comment ?? "Captured near Algiers 36.7538, 3.0588";
  const comSegment = buildJpegSegment(
    0xfe,
    new TextEncoder().encode(commentText),
  );

  const segments: Uint8Array[] = [base.subarray(0, 2), app1Segment];

  if (options.includeIccProfile) {
    const iccHeader = new TextEncoder().encode("ICC_PROFILE\0");
    const iccData = new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x00, 0x10]);
    segments.push(buildJpegSegment(0xe2, concatBytes([iccHeader, iccData])));
  }

  segments.push(comSegment, base.subarray(2));
  return concatBytes(segments);
}

const CRC32_TABLE = (() => {
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

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i += 1) {
    c = (CRC32_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.byteLength);
  view.setUint32(8 + data.byteLength, crc32(crcInput), false);
  return out;
}

export function createPngWithExif(
  options: ExifMetadataOptions = {},
): Uint8Array {
  const png = new PNG({ width: 16, height: 16 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = (x * 16) & 0xff;
      png.data[idx + 1] = (y * 16) & 0xff;
      png.data[idx + 2] = ((x + y) * 8) & 0xff;
      png.data[idx + 3] = 255;
    }
  }
  const cleanPng = Uint8Array.from(PNG.sync.write(png));

  // Locate the first IDAT chunk so we inject eXIf (plus tEXt/iTXt) BEFORE IDAT
  // (right after IHDR), ensuring libpng / sharp().metadata().exif parses all EXIF bytes.
  const view = new DataView(
    cleanPng.buffer,
    cleanPng.byteOffset,
    cleanPng.byteLength,
  );
  let offset = 8;
  let insertOffset = cleanPng.byteLength;
  while (offset + 12 <= cleanPng.byteLength) {
    const chunkLen = view.getUint32(offset, false);
    const chunkType = String.fromCharCode(
      ...cleanPng.subarray(offset + 4, offset + 8),
    );
    if (chunkType === "IDAT" || chunkType === "IEND") {
      insertOffset = offset;
      break;
    }
    offset += 12 + chunkLen;
  }

  const encoder = new TextEncoder();
  const tiff = buildExifTiffPayload(options);
  const exifChunk = buildPngChunk("eXIf", tiff);
  const authorChunk = buildPngChunk(
    "tEXt",
    encoder.encode(`Author\0${options.author ?? "Citizen Reporter"}`),
  );
  const cameraChunk = buildPngChunk(
    "tEXt",
    encoder.encode(
      `Camera\0${options.make ?? "Samsung"} ${options.model ?? "Galaxy A55"}`,
    ),
  );
  const gpsChunk = buildPngChunk(
    "tEXt",
    encoder.encode(
      `GPS\0${options.latitude ?? 36.7538},${options.longitude ?? 3.0588}`,
    ),
  );
  const itxtChunk = buildPngChunk(
    "iTXt",
    encoder.encode(
      `Comment\0\0\0\0\0${options.comment ?? "Algiers citizen report photo"}`,
    ),
  );

  return concatBytes([
    cleanPng.subarray(0, insertOffset),
    exifChunk,
    authorChunk,
    cameraChunk,
    gpsChunk,
    itxtChunk,
    cleanPng.subarray(insertOffset),
  ]);
}

export function createSpoofedMimePayload(): Uint8Array {
  return new TextEncoder().encode(
    '<!DOCTYPE html><html><body><script>alert("spoofed")</script></body></html>',
  );
}

function parseTiffForMetadata(tiff: Uint8Array): {
  validTiff: boolean;
  hasGps: boolean;
  hasCameraTags: boolean;
} {
  if (tiff.byteLength < 8) {
    return { validTiff: false, hasGps: false, hasCameraTags: false };
  }
  const b0 = tiff[0];
  const b1 = tiff[1];
  const littleEndian = b0 === 0x49 && b1 === 0x49;
  const bigEndian = b0 === 0x4d && b1 === 0x4d;
  if (!littleEndian && !bigEndian) {
    return { validTiff: false, hasGps: false, hasCameraTags: false };
  }

  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const magic = view.getUint16(2, littleEndian);
  if (magic !== 42) {
    return { validTiff: false, hasGps: false, hasCameraTags: false };
  }

  const ifd0Offset = view.getUint32(4, littleEndian);
  if (ifd0Offset + 2 > tiff.byteLength) {
    return { validTiff: true, hasGps: false, hasCameraTags: false };
  }

  let hasGps = false;
  let hasCameraTags = false;
  const entryCount = view.getUint16(ifd0Offset, littleEndian);
  for (let i = 0; i < entryCount; i += 1) {
    const entryPos = ifd0Offset + 2 + i * 12;
    if (entryPos + 12 > tiff.byteLength) break;
    const tag = view.getUint16(entryPos, littleEndian);
    if (tag === 0x010f || tag === 0x0110) {
      hasCameraTags = true;
    }
    if (tag === 0x8825) {
      hasGps = true;
    }
  }

  return { validTiff: true, hasGps, hasCameraTags };
}

function isIccProfilePayload(bytes: Uint8Array, start: number): boolean {
  const marker = "ICC_PROFILE\0";
  if (start + marker.length > bytes.byteLength) return false;
  for (let i = 0; i < marker.length; i += 1) {
    if (bytes[start + i] !== marker.charCodeAt(i)) return false;
  }
  return true;
}

function detectFormat(bytes: Uint8Array): "jpeg" | "png" | "webp" | "unknown" {
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "jpeg";
  }
  if (
    bytes.byteLength >= 8 &&
    PNG_SIGNATURE.every((value, idx) => bytes[idx] === value)
  ) {
    return "png";
  }
  if (
    bytes.byteLength >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return "unknown";
}

export function inspectImageForMetadata(
  bytes: Uint8Array,
): ImageMetadataInspection {
  const format = detectFormat(bytes);
  const markers: string[] = [];
  let hasExif = false;
  let hasGps = false;
  let hasCameraTags = false;
  let hasTextChunks = false;

  if (format === "jpeg") {
    let i = 2;
    while (i < bytes.byteLength) {
      if (bytes[i] !== 0xff) break;
      // Skip 0xFF marker prefix and all consecutive ISO/IEC 10918-1 0xFF fill bytes.
      while (i < bytes.byteLength && bytes[i] === 0xff) {
        i += 1;
      }
      if (i >= bytes.byteLength) break;

      const marker = bytes[i] ?? 0;
      i += 1;

      if (marker === 0xd9 || marker === 0xda) {
        markers.push(marker === 0xd9 ? "EOI" : "SOS");
        break;
      }

      // Skip byte-stuffed 0x00 and lengthless standalone markers:
      // TEM (0x01), RST0..RST7 (0xD0..0xD7), SOI (0xD8).
      if (
        marker === 0x00 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd8)
      ) {
        continue;
      }

      if (i + 2 > bytes.byteLength) break;
      const segLength = ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
      if (segLength < 2) break;
      const payloadStart = i + 2;
      const payloadEnd = Math.min(i + segLength, bytes.byteLength);
      const payload = bytes.subarray(payloadStart, payloadEnd);

      if (marker === 0xe0) {
        markers.push("APP0");
      } else if (marker === 0xe1) {
        markers.push("APP1");
        const asciiHead = new TextDecoder("latin1").decode(
          payload.subarray(0, Math.min(32, payload.byteLength)),
        );
        if (asciiHead.startsWith("Exif\0\0")) {
          hasExif = true;
          const parsed = parseTiffForMetadata(payload.subarray(6));
          if (parsed.hasGps) hasGps = true;
          if (parsed.hasCameraTags) hasCameraTags = true;
        } else if (asciiHead.includes("ns.adobe.com/xap")) {
          hasExif = true;
          hasTextChunks = true;
        } else {
          hasExif = true;
        }
      } else if (marker === 0xe2) {
        if (isIccProfilePayload(bytes, payloadStart)) {
          markers.push("APP2-ICC");
        } else {
          markers.push("APP2-OTHER");
          hasExif = true;
        }
      } else if (marker >= 0xe3 && marker <= 0xef) {
        markers.push(`APP${marker - 0xe0}`);
        hasExif = true;
      } else if (marker === 0xfe) {
        markers.push("COM");
        hasTextChunks = true;
      }

      i += segLength;
    }
  } else if (format === "png") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    while (offset + 12 <= bytes.byteLength) {
      const length = view.getUint32(offset, false);
      const type = String.fromCharCode(
        ...bytes.subarray(offset + 4, offset + 8),
      );
      markers.push(type);
      const dataStart = offset + 8;
      const dataEnd = Math.min(dataStart + length, bytes.byteLength);
      const payload = bytes.subarray(dataStart, dataEnd);

      if (type === "eXIf") {
        hasExif = true;
        const parsed = parseTiffForMetadata(payload);
        if (parsed.hasGps) hasGps = true;
        if (parsed.hasCameraTags) hasCameraTags = true;
      } else if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
        hasTextChunks = true;
        const decoded = new TextDecoder("latin1").decode(payload).toLowerCase();
        if (decoded.includes("gps")) hasGps = true;
        if (
          decoded.includes("camera") ||
          decoded.includes("samsung") ||
          decoded.includes("model")
        ) {
          hasCameraTags = true;
        }
      }

      if (type === "IEND") break;
      offset += 12 + length;
    }
  } else if (format === "webp") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    while (offset + 8 <= bytes.byteLength) {
      const fourcc = String.fromCharCode(...bytes.subarray(offset, offset + 4));
      const chunkSize = view.getUint32(offset + 4, true);
      markers.push(fourcc.trim());
      const payloadStart = offset + 8;
      const payloadEnd = Math.min(payloadStart + chunkSize, bytes.byteLength);
      const payload = bytes.subarray(payloadStart, payloadEnd);

      if (fourcc === "EXIF") {
        hasExif = true;
        const startOffset = new TextDecoder("latin1")
          .decode(payload.subarray(0, 6))
          .startsWith("Exif\0\0")
          ? 6
          : 0;
        const parsed = parseTiffForMetadata(payload.subarray(startOffset));
        if (parsed.hasGps) hasGps = true;
        if (parsed.hasCameraTags) hasCameraTags = true;
      } else if (fourcc === "XMP ") {
        hasTextChunks = true;
        hasExif = true;
      }

      offset += 8 + chunkSize + (chunkSize % 2);
    }
  }

  return {
    format,
    hasExif,
    hasGps,
    hasCameraTags,
    hasTextChunks,
    markers,
  };
}
