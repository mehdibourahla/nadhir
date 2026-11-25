import { describe, expect, it } from "vitest";

import {
  detectImageMimeType,
  stripImageMetadata,
  validateAndStripReportPhoto,
} from "@/lib/image-metadata";

function segment(marker: number, body: number[]): number[] {
  const len = body.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...body];
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function jpegWithExif(): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...segment(0xe1, ascii("Exif\0\0GPS 36.7N 3.0E home address")),
    ...segment(0xfe, ascii("a comment naming the photographer")),
    ...segment(0xdb, [0x00, 0x01, 0x02]),
    ...segment(0xda, [0x00, 0x01]),
    0x12,
    0x34,
    0xff,
    0xd9,
  ]);
}

function chunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [
    (len >> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
    ...ascii(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
}

function pngWithExif(): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", new Array(13).fill(1)),
    ...chunk("eXIf", ascii("GPS 36.7N 3.0E home address")),
    ...chunk("tEXt", ascii("Author\0the photographer")),
    ...chunk("IDAT", [9, 9, 9]),
    ...chunk("IEND", []),
  ]);
}

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("stripImageMetadata", () => {
  it("removes Exif and comments from a JPEG but keeps the image", () => {
    const out = stripImageMetadata(jpegWithExif(), "image/jpeg");

    expect(text(out)).not.toContain("home address");
    expect(text(out)).not.toContain("photographer");
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(text(out.slice(-2))).toBe(text(new Uint8Array([0xff, 0xd9])));
    expect([...out]).toContain(0xda);
  });

  it("removes Exif and text chunks from a PNG but keeps the image", () => {
    const out = stripImageMetadata(pngWithExif(), "image/png");

    expect(text(out)).not.toContain("home address");
    expect(text(out)).not.toContain("photographer");
    expect(text(out)).toContain("IHDR");
    expect(text(out)).toContain("IDAT");
    expect(text(out)).toContain("IEND");
  });

  it("refuses a format it cannot sanitise", () => {
    expect(() =>
      stripImageMetadata(new Uint8Array([0x47, 0x49]), "image/gif"),
    ).toThrow("unsupported_type");
  });

  it("refuses bytes whose signature contradicts the declared type", () => {
    expect(() => stripImageMetadata(pngWithExif(), "image/jpeg")).toThrow(
      "unsupported_type",
    );
  });
});

describe("APP2 segments", () => {
  const jpeg = (app2Body: string) =>
    new Uint8Array([
      0xff,
      0xd8,
      ...segment(0xe2, ascii(app2Body)),
      ...segment(0xda, [0x00, 0x01]),
      0x12,
      0x34,
      0xff,
      0xd9,
    ]);

  it("keeps a real ICC profile", () => {
    const out = stripImageMetadata(
      jpeg("ICC_PROFILE\0colour data"),
      "image/jpeg",
    );
    expect(Buffer.from(out).includes("ICC_PROFILE")).toBe(true);
  });

  it("drops MPF, whose embedded image carries its own GPS", () => {
    const out = stripImageMetadata(
      jpeg("MPF\0second image with GPS 36.7N 3.0E"),
      "image/jpeg",
    );
    const text = Buffer.from(out).toString("latin1");
    expect(text).not.toContain("MPF");
    expect(text).not.toContain("GPS");
  });
});

function webpChunk(fourCC: string, payload: number[]): number[] {
  const len = payload.length;
  const pad = len & 1 ? [0] : [];
  return [
    ...ascii(fourCC),
    len & 0xff,
    (len >> 8) & 0xff,
    (len >> 16) & 0xff,
    (len >> 24) & 0xff,
    ...payload,
    ...pad,
  ];
}

function webpWithMetadata(): Uint8Array {
  // VP8X flags: ICCP (0x20) | EXIF (0x08) | XMP (0x04) = 0x2c
  const vp8x = webpChunk("VP8X", [0x2c, 0, 0, 0, 1, 0, 0, 1, 0, 0]);
  const vp8 = webpChunk("VP8 ", [0x10, 0x20, 0x30, 0x40]);
  const exif = webpChunk(
    "EXIF",
    ascii("Exif\0\0Make=Canon Model=EOS GPSLatitude=36.7525"),
  );
  const xmp = webpChunk(
    "XMP ",
    ascii("<x:xmpmeta>DateTimeOriginal=2026:11:25</x:xmpmeta>"),
  );
  const body = [...ascii("WEBP"), ...vp8x, ...vp8, ...exif, ...xmp];
  const riffLen = body.length;
  return new Uint8Array([
    ...ascii("RIFF"),
    riffLen & 0xff,
    (riffLen >> 8) & 0xff,
    (riffLen >> 16) & 0xff,
    (riffLen >> 24) & 0xff,
    ...body,
    ...ascii("TRAILING_SECRET"),
  ]);
}

describe("hardened JPEG, PNG, and WebP metadata stripping", () => {
  it("strips EXIF, XMP, and trailing bytes from WebP and clears VP8X EXIF/XMP flags", () => {
    const raw = webpWithMetadata();
    const out = stripImageMetadata(raw, "image/webp");
    const decoded = text(out);

    expect(detectImageMimeType(out)).toBe("image/webp");
    expect(decoded).toContain("VP8X");
    expect(decoded).toContain("VP8 ");
    expect(decoded).not.toContain("Canon");
    expect(decoded).not.toContain("36.7525");
    expect(decoded).not.toContain("DateTimeOriginal");
    expect(decoded).not.toContain("TRAILING_SECRET");
    // VP8X chunk starts at offset 12; flags byte is at 12 + 8 = 20.
    // ICCP (0x20) preserved; EXIF (0x08) and XMP (0x04) cleared.
    expect(out[20]).toBe(0x20);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(4, true)).toBe(out.byteLength - 8);
  });

  it("strips PNG tIME, iTXt, zTXt, and trailing bytes after IEND", () => {
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk("IHDR", new Array(13).fill(1)),
      ...chunk("tIME", [0x07, 0xea, 11, 25, 10, 0, 0]),
      ...chunk("iTXt", ascii("XML:com.adobe.xmp\0\0\0\0\0GPS=36.7N")),
      ...chunk("zTXt", ascii("Comment\0\0compressed-camera-id")),
      ...chunk("IDAT", [1, 2, 3, 4]),
      ...chunk("IEND", []),
      ...ascii("POST_IEND_TRAILER"),
    ]);

    const out = stripImageMetadata(png, "image/png");
    const decoded = text(out);
    expect(decoded).not.toContain("tIME");
    expect(decoded).not.toContain("GPS=36.7N");
    expect(decoded).not.toContain("compressed-camera-id");
    expect(decoded).not.toContain("POST_IEND_TRAILER");
    expect(decoded).toContain("IHDR");
    expect(decoded).toContain("IDAT");
    expect(decoded).toContain("IEND");
  });

  it("strips post-scan APP1 metadata and trailing bytes after EOI in JPEG", () => {
    const progressiveJpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xff, // JPEG fill byte before marker
      0xe1,
      0x00,
      0x0a,
      ...ascii("GPS=36.7"),
      ...segment(0xda, [0x00, 0x01]),
      0x11,
      0xff,
      0x00, // stuffed byte inside entropy stream
      0x22,
      ...segment(0xe1, ascii("Exif\0\0POST_SCAN_GPS")),
      0xff,
      0xd9,
      ...ascii("POST_EOI_PAYLOAD"),
    ]);

    const out = stripImageMetadata(progressiveJpeg, "image/jpeg");
    const decoded = text(out);
    expect(decoded).not.toContain("GPS=36.7");
    expect(decoded).not.toContain("POST_SCAN_GPS");
    expect(decoded).not.toContain("POST_EOI_PAYLOAD");
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
  });

  it("rejects truncated/corrupt JPEG, PNG, and WebP buffers", () => {
    expect(() =>
      stripImageMetadata(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x50]),
        "image/jpeg",
      ),
    ).toThrow("invalid_image");
    expect(() =>
      stripImageMetadata(
        new Uint8Array([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a,
          ...chunk("IHDR", new Array(13).fill(1)),
        ]),
        "image/png",
      ),
    ).toThrow("invalid_image");
    expect(() =>
      validateAndStripReportPhoto(
        new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x3e]), // <svg>
        { declaredMime: "image/jpeg" },
      ),
    ).toThrow("unsupported_type");
  });

  it("rejects WebP VP8X chunks whose payload length is not strictly 10 bytes", () => {
    const oversizedVp8x = webpChunk("VP8X", [
      0x2c,
      ...new Array(29).fill(0x41),
    ]);
    const vp8 = webpChunk("VP8 ", [0x10, 0x20, 0x30, 0x40]);
    const body = [...ascii("WEBP"), ...oversizedVp8x, ...vp8];
    const riffLen = body.length;
    const malformedWebp = new Uint8Array([
      ...ascii("RIFF"),
      riffLen & 0xff,
      (riffLen >> 8) & 0xff,
      (riffLen >> 16) & 0xff,
      (riffLen >> 24) & 0xff,
      ...body,
    ]);

    expect(() => stripImageMetadata(malformedWebp, "image/webp")).toThrow(
      "invalid_image",
    );
  });

  it("rejects JPEG 0xFF 0x00 stuffed byte markers outside SOS entropy data", () => {
    const malformedJpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0x00,
      0x00,
      0x0a,
      ...ascii("UNEXPECTED"),
      0xff,
      0xd9,
    ]);

    expect(() => stripImageMetadata(malformedJpeg, "image/jpeg")).toThrow(
      "invalid_image",
    );
  });
});
