import { describe, expect, it, vi } from "vitest";

import {
  detectImageMimeType,
  MAX_REPORT_PHOTO_BYTES,
  stripImageMetadata,
} from "@/lib/image-metadata";
import {
  handleReportPhotoUpload,
  type ReportPhotoDeps,
} from "@/lib/report-photo.server";

const USER_ID = "f0480000-0000-4000-8000-000000000001";
const OBJECT_ID = "f0481000-0000-4000-8000-000000000099";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

function jpegSegment(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}

function pngChunk(type: string, payload: number[]): number[] {
  const len = payload.length;
  return [
    (len >> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
    ...ascii(type),
    ...payload,
    0,
    0,
    0,
    0,
  ];
}

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

function buildJpegWithRichExif(): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...jpegSegment(0xe0, ascii("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00")),
    ...jpegSegment(
      0xe1,
      ascii(
        "Exif\0\0Make=Samsung Model=Galaxy-S24 DateTimeOriginal=2026:11:25 10:15:00 GPSLatitude=36.7538N GPSLongitude=3.0588E",
      ),
    ),
    ...jpegSegment(
      0xe1,
      ascii(
        "http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPSAltitude=142m</x:xmpmeta>",
      ),
    ),
    ...jpegSegment(0xfe, ascii("Comment: private reporter address")),
    ...jpegSegment(0xdb, [0x00, 0x01, 0x02]),
    ...jpegSegment(0xda, [0x00, 0x01]),
    0xaa,
    0xbb,
    0xff,
    0xd9,
  ]);
}

function buildPngWithRichMetadata(): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk("IHDR", new Array(13).fill(1)),
    ...pngChunk(
      "eXIf",
      ascii(
        "MM\0*Make=Apple Model=iPhone16 DateTimeOriginal=2026:11:25 GPSLatitude=36.7538 GPSLongitude=3.0588",
      ),
    ),
    ...pngChunk("tEXt", ascii("Camera\0Sony Alpha 7")),
    ...pngChunk(
      "iTXt",
      ascii("XML:com.adobe.xmp\0\0\0\0\0<xmp>GPS=36.75,3.05</xmp>"),
    ),
    ...pngChunk("tIME", [0x07, 0xea, 11, 25, 11, 0, 0]),
    ...pngChunk("IDAT", [0x08, 0x1d, 0x01, 0x02]),
    ...pngChunk("IEND", []),
  ]);
}

function buildWebpWithRichMetadata(): Uint8Array {
  const vp8x = webpChunk("VP8X", [0x0c, 0, 0, 0, 1, 0, 0, 1, 0, 0]);
  const vp8l = webpChunk("VP8L", [0x2f, 0x00, 0x00, 0x00, 0x10]);
  const exif = webpChunk(
    "EXIF",
    ascii(
      "Exif\0\0Make=Xiaomi Model=14Pro DateTimeOriginal=2026:11:25 GPSLatitude=36.7538 GPSLongitude=3.0588",
    ),
  );
  const xmp = webpChunk(
    "XMP ",
    ascii("<x:xmpmeta>CameraOwner=Reporter</x:xmpmeta>"),
  );
  const body = [...ascii("WEBP"), ...vp8x, ...vp8l, ...exif, ...xmp];
  const riffSize = body.length;
  return new Uint8Array([
    ...ascii("RIFF"),
    riffSize & 0xff,
    (riffSize >> 8) & 0xff,
    (riffSize >> 16) & 0xff,
    (riffSize >> 24) & 0xff,
    ...body,
  ]);
}

function makeUploadRequest(
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
  options?: { bearer?: string | null; objectId?: string },
): Request {
  const form = new FormData();
  const copy = new Uint8Array(fileBytes.byteLength);
  copy.set(fileBytes);
  form.append("file", new File([copy.buffer], fileName, { type: mimeType }));
  if (options?.objectId !== undefined) {
    form.append("objectId", options.objectId);
  }
  const headers = new Headers();
  if (options?.bearer !== null) {
    headers.set("authorization", `Bearer ${options?.bearer ?? "valid-jwt"}`);
  }
  return new Request("https://nadhir.app/api/private/report-photo", {
    method: "POST",
    headers,
    body: form,
  });
}

function createDeps() {
  const uploaded: Array<{
    path: string;
    bytes: Uint8Array<ArrayBuffer>;
    contentType: string;
  }> = [];
  const deps: ReportPhotoDeps = {
    getUser: vi.fn(async () => ({
      data: { user: { id: USER_ID } },
      error: null,
    })),
    consumeRateLimit: vi.fn(async () => ({ data: true, error: null })),
    hasWithdrawnCitizenReportsConsent: vi.fn(async () => ({
      withdrawn: false,
      error: null,
    })),
    uploadObject: vi.fn(async (path, bytes, contentType) => {
      uploaded.push({ path, bytes, contentType });
      return { error: null };
    }),
    randomUuid: () => OBJECT_ID,
  };
  return { deps, uploaded };
}

describe("F23 server-side EXIF stripping (/api/private/report-photo)", () => {
  it.each([
    {
      label: "JPEG",
      bytes: buildJpegWithRichExif(),
      fileName: "fire.jpg",
      mime: "image/jpeg",
      ext: "jpg",
      forbidden: [
        "Samsung",
        "Galaxy-S24",
        "DateTimeOriginal",
        "36.7538",
        "3.0588",
        "GPSAltitude",
        "private reporter address",
      ],
    },
    {
      label: "PNG",
      bytes: buildPngWithRichMetadata(),
      fileName: "flood.png",
      mime: "image/png",
      ext: "png",
      forbidden: [
        "Apple",
        "iPhone16",
        "DateTimeOriginal",
        "36.7538",
        "3.0588",
        "Sony Alpha 7",
        "tIME",
      ],
    },
    {
      label: "WebP",
      bytes: buildWebpWithRichMetadata(),
      fileName: "storm.webp",
      mime: "image/webp",
      ext: "webp",
      forbidden: [
        "Xiaomi",
        "14Pro",
        "DateTimeOriginal",
        "36.7538",
        "3.0588",
        "CameraOwner",
      ],
    },
  ])(
    "strips all GPS/camera/XMP/comment metadata from $label both in stripImageMetadata and handleReportPhotoUpload",
    async ({ bytes, fileName, mime, ext, forbidden }) => {
      const direct = stripImageMetadata(bytes, mime);
      const directText = latin1(direct);
      expect(detectImageMimeType(direct)).toBe(mime);
      for (const token of forbidden) {
        expect(directText).not.toContain(token);
      }

      const { deps, uploaded } = createDeps();
      const response = await handleReportPhotoUpload(
        makeUploadRequest(bytes, fileName, mime, { objectId: OBJECT_ID }),
        deps,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = (await response.json()) as {
        path: string;
        mimeType: string;
        byteLength: number;
        stripped: boolean;
        strippedBytes: number;
      };

      expect(body.path).toBe(`${USER_ID}/${OBJECT_ID}.${ext}`);
      expect(body.mimeType).toBe(mime);
      expect(body.stripped).toBe(true);
      expect(body.strippedBytes).toBeGreaterThan(0);
      expect(uploaded).toHaveLength(1);
      expect(uploaded[0]?.path).toBe(`${USER_ID}/${OBJECT_ID}.${ext}`);
      expect(uploaded[0]?.contentType).toBe(mime);
      expect(uploaded[0]?.bytes.byteLength).toBe(body.byteLength);
      expect(detectImageMimeType(uploaded[0]!.bytes)).toBe(mime);

      const storedText = latin1(uploaded[0]!.bytes);
      for (const token of forbidden) {
        expect(storedText).not.toContain(token);
      }
    },
  );

  it("rejects unauthenticated requests with 401 and zero Storage writes", async () => {
    const { deps, uploaded } = createDeps();
    const res = await handleReportPhotoUpload(
      makeUploadRequest(buildJpegWithRichExif(), "fire.jpg", "image/jpeg", {
        bearer: null,
      }),
      deps,
    );
    expect(res.status).toBe(401);
    expect(uploaded).toHaveLength(0);
  });

  it("rejects spoofed MIME types (HTML/SVG/PDF/GIF claiming image/jpeg) with 415 and zero Storage writes", async () => {
    const { deps, uploaded } = createDeps();
    const payloads = [
      {
        bytes: new TextEncoder().encode(
          "<html><script>alert(1)</script></html>",
        ),
        mime: "image/jpeg",
      },
      {
        bytes: new TextEncoder().encode(
          "<svg xmlns='http://www.w3.org/2000/svg'/>",
        ),
        mime: "image/svg+xml",
      },
      {
        bytes: new TextEncoder().encode("%PDF-1.7\n1 0 obj"),
        mime: "image/jpeg",
      },
      {
        bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
        mime: "image/gif",
      },
    ];

    for (const sample of payloads) {
      const res = await handleReportPhotoUpload(
        makeUploadRequest(sample.bytes, "bad.jpg", sample.mime),
        deps,
      );
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: "unsupported_type" });
    }
    expect(uploaded).toHaveLength(0);
  });

  it("rejects corrupt/truncated JPEG and invalid objectId with 400 and zero Storage writes", async () => {
    const { deps, uploaded } = createDeps();

    const corrupt = await handleReportPhotoUpload(
      makeUploadRequest(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, 0x01]),
        "corrupt.jpg",
        "image/jpeg",
      ),
      deps,
    );
    expect(corrupt.status).toBe(400);
    expect(await corrupt.json()).toEqual({ error: "invalid_image" });

    const badId = await handleReportPhotoUpload(
      makeUploadRequest(buildJpegWithRichExif(), "fire.jpg", "image/jpeg", {
        objectId: "../other-user/evil",
      }),
      deps,
    );
    expect(badId.status).toBe(400);
    expect(await badId.json()).toEqual({ error: "invalid_request" });
    expect(uploaded).toHaveLength(0);
  });

  it("rejects oversized payloads (> 8 MiB) with 413 and zero Storage writes", async () => {
    const { deps, uploaded } = createDeps();
    const big = new Uint8Array(MAX_REPORT_PHOTO_BYTES + 16);
    big.set([0xff, 0xd8, 0xff, 0xd9], 0);

    const res = await handleReportPhotoUpload(
      makeUploadRequest(big, "huge.jpg", "image/jpeg"),
      deps,
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
    expect(uploaded).toHaveLength(0);
  });

  it("enforces rate limiting with 429 and zero Storage writes", async () => {
    const { deps, uploaded } = createDeps();
    deps.consumeRateLimit = vi.fn(async () => ({ data: false, error: null }));

    const res = await handleReportPhotoUpload(
      makeUploadRequest(buildJpegWithRichExif(), "fire.jpg", "image/jpeg"),
      deps,
    );
    expect(res.status).toBe(429);
    expect(uploaded).toHaveLength(0);
  });

  it("blocks uploads with 403 when citizen_reports consent is withdrawn and fails closed with 503 on DB error (T5-R2-01)", async () => {
    const { deps, uploaded } = createDeps();
    deps.hasWithdrawnCitizenReportsConsent = vi.fn(async () => ({
      withdrawn: true,
      error: null,
    }));

    const withdrawnRes = await handleReportPhotoUpload(
      makeUploadRequest(buildJpegWithRichExif(), "fire.jpg", "image/jpeg"),
      deps,
    );
    expect(withdrawnRes.status).toBe(403);
    expect(await withdrawnRes.json()).toEqual({ error: "consent_withdrawn" });
    expect(uploaded).toHaveLength(0);

    deps.hasWithdrawnCitizenReportsConsent = vi.fn(async () => ({
      withdrawn: false,
      error: { message: "db connection failed" },
    }));
    const errorRes = await handleReportPhotoUpload(
      makeUploadRequest(buildJpegWithRichExif(), "fire.jpg", "image/jpeg"),
      deps,
    );
    expect(errorRes.status).toBe(503);
    expect(await errorRes.json()).toEqual({ error: "consent_unavailable" });
    expect(uploaded).toHaveLength(0);
  });
});
