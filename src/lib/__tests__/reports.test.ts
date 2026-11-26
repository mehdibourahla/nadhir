import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createSignedUrlMock,
  fromMock,
  getSessionMock,
  getUserMock,
  removeMock,
  rpcMock,
  storageFromMock,
  uploadMock,
} = vi.hoisted(() => ({
  createSignedUrlMock: vi.fn(),
  fromMock: vi.fn(),
  getSessionMock: vi.fn(),
  getUserMock: vi.fn(),
  removeMock: vi.fn(),
  rpcMock: vi.fn(),
  storageFromMock: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: getSessionMock, getUser: getUserMock },
    from: fromMock,
    rpc: rpcMock,
    storage: { from: storageFromMock },
  },
}));

import * as reports from "@/lib/reports";

const ownerId = "f0240000-0000-4000-8000-000000000001";
const photoId = "f0241000-0000-4000-8000-000000000001";
const photoPath = `${ownerId}/${photoId}.jpg`;
const reportId = "f0242000-0000-4000-8000-000000000001";

const reportInput = {
  kind: "sighting" as const,
  lat: 36.6,
  lon: 4.05,
  note: null,
  observed_at: "2026-09-01T00:00:00.000Z",
};

const jpegBytes = new Uint8Array([
  0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0x00, 0x01, 0x12, 0x34, 0xff, 0xd9,
]);
const jpeg = {
  name: "evidence.jpg",
  size: jpegBytes.byteLength,
  type: "image/jpeg",
  arrayBuffer: async () => jpegBytes.slice().buffer,
} as File;
const uploadDraft = { file: jpeg, objectId: photoId };

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

function thenableFilter(result: QueryResult) {
  const filter: Record<string, unknown> = {};
  for (const method of ["eq", "is", "select"]) {
    filter[method] = vi.fn(() => filter);
  }
  filter["maybeSingle"] = vi.fn(async () => result);
  filter["then"] = (resolve: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(resolve);
  return filter;
}

function reportTable({
  read,
  insert,
  remove,
  events = [],
}: {
  read?: QueryResult;
  insert?: QueryResult;
  remove?: QueryResult;
  events?: string[];
}) {
  return {
    select: vi.fn(() => thenableFilter(read ?? { data: null, error: null })),
    insert: vi.fn(async () => {
      events.push("report-insert");
      return insert ?? { data: null, error: null };
    }),
    delete: vi.fn(() => {
      events.push("report-delete");
      return thenableFilter(remove ?? { data: { id: reportId }, error: null });
    }),
  };
}

describe("report photo boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getUserMock.mockResolvedValue({
      data: { user: { id: ownerId } },
      error: null,
    });
    storageFromMock.mockReturnValue({
      createSignedUrl: createSignedUrlMock,
      remove: removeMock,
      upload: uploadMock,
    });
  });

  it.each([
    "https://attacker.example/photo.jpg",
    `${ownerId}/../${photoId}.jpg`,
    `${ownerId}/${photoId}.gif`,
    `${ownerId}//${photoId}.png`,
  ])("refuses to sign attacker-selected source %s", async (source) => {
    await expect(reports.signedPhotoUrl(source)).resolves.toBeNull();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("signs a canonical private JPEG object key", async () => {
    createSignedUrlMock.mockResolvedValue({
      data: {
        signedUrl: "https://project.supabase.co/storage/v1/signed/photo",
      },
      error: null,
    });

    await expect(reports.signedPhotoUrl(photoPath)).resolves.toBe(
      "https://project.supabase.co/storage/v1/signed/photo",
    );
    expect(createSignedUrlMock).toHaveBeenCalledWith(photoPath, 60 * 30);
  });

  it("does not return a non-network URL from a malformed signing response", async () => {
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "javascript:alert(1)" },
      error: null,
    });

    await expect(reports.signedPhotoUrl(photoPath)).resolves.toBeNull();
  });
});

describe("report photo draft lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:local-photo"),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.spyOn(crypto, "randomUUID").mockReturnValue(photoId);
  });

  it("keeps selection local until report submission", () => {
    const createDraft = Reflect.get(reports, "createReportPhotoDraft") as
      ((file: File) => { objectId: string; previewUrl: string }) | undefined;

    expect(createDraft).toBeTypeOf("function");
    const draft = createDraft?.(jpeg);
    expect(draft?.previewUrl).toBe("blob:local-photo");
    expect(draft?.objectId).toBe(photoId);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("revokes the local preview when selection is removed or abandoned", () => {
    const createDraft = Reflect.get(reports, "createReportPhotoDraft") as
      ((file: File) => { dispose: () => void }) | undefined;
    expect(createDraft).toBeTypeOf("function");

    const draft = createDraft?.(jpeg);
    draft?.dispose();
    draft?.dispose();

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-photo");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("revokes both previews across replacement and unmount", () => {
    vi.mocked(URL.createObjectURL)
      .mockReturnValueOnce("blob:first-photo")
      .mockReturnValueOnce("blob:replacement-photo");

    const first = reports.createReportPhotoDraft(jpeg);
    const replacement = reports.createReportPhotoDraft(jpeg);
    first.dispose();
    replacement.dispose();

    expect(URL.revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:first-photo");
    expect(URL.revokeObjectURL).toHaveBeenNthCalledWith(
      2,
      "blob:replacement-photo",
    );
    expect(removeMock).not.toHaveBeenCalled();
  });
});

describe("report creation photo cleanup", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    getUserMock.mockResolvedValue({
      data: { user: { id: ownerId } },
      error: null,
    });
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "test-access-token" } },
      error: null,
    });
    storageFromMock.mockReturnValue({
      createSignedUrl: createSignedUrlMock,
      remove: removeMock,
      upload: uploadMock,
    });
    fetchMock = vi.fn(async () =>
      Response.json({
        path: photoPath,
        mimeType: "image/jpeg",
        byteLength: 4,
        stripped: true,
        strippedBytes: 0,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  it("creates reports without photos without touching Storage or upload API", async () => {
    const table = reportTable({ insert: { data: null, error: null } });
    fromMock.mockReturnValue(table);

    await reports.createReport(reportInput);

    expect(uploadMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(table.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: ownerId, photo_url: null }),
    );
  });

  it("uploads via /api/private/report-photo (never direct Storage) and stores the returned private key", async () => {
    const table = reportTable({ insert: { data: null, error: null } });
    fromMock.mockReturnValue(table);
    await reports.createReport(reportInput, uploadDraft);

    expect(uploadMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/private/report-photo");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("objectId")).toBe(photoId);
    expect(table.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: ownerId, photo_url: photoPath }),
    );
  });

  it("removes an uploaded object when report creation fails", async () => {
    const events: string[] = [];
    fetchMock.mockImplementation(async () => {
      events.push("photo-upload");
      return Response.json({
        path: photoPath,
        mimeType: "image/jpeg",
        byteLength: 4,
        stripped: true,
        strippedBytes: 0,
      });
    });
    removeMock.mockImplementation(async () => {
      events.push("photo-remove");
      return { data: [], error: null };
    });
    fromMock.mockReturnValue(
      reportTable({
        insert: { data: null, error: { message: "private constraint detail" } },
        events,
      }),
    );
    await expect(
      reports.createReport(reportInput, uploadDraft),
    ).rejects.toMatchObject({ message: "reports.submitFailed" });
    expect(events).toEqual(["photo-upload", "report-insert", "photo-remove"]);
    expect(removeMock).toHaveBeenCalledWith([photoPath]);
  });

  it("reports cleanup failure safely without claiming report success", async () => {
    fromMock.mockReturnValue(
      reportTable({
        insert: { data: null, error: { message: "private insert detail" } },
      }),
    );
    removeMock.mockResolvedValue({
      data: null,
      error: { message: "private storage detail" },
    });
    const failure = await reports
      .createReport(reportInput, uploadDraft)
      .catch((error) => error);

    expect(failure).toMatchObject({ message: "reports.submitCleanupFailed" });
    expect(failure.message).not.toContain("private");
  });

  it("keeps the photo when a lost insert response already committed the report", async () => {
    const table = reportTable({
      read: { data: { id: reportId }, error: null },
    });
    table.insert.mockRejectedValue(new Error("response lost after commit"));
    fromMock.mockReturnValue(table);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(reportId);

    await expect(reports.createReport(reportInput, uploadDraft)).resolves.toBe(
      reportId,
    );
    expect(table.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: reportId, photo_url: photoPath }),
    );
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("preserves the one private object when commit reconciliation also fails", async () => {
    const uncertainQuery = thenableFilter({ data: null, error: null });
    uncertainQuery["maybeSingle"] = vi.fn(async () => {
      throw new Error("reconciliation transport failed");
    });
    fromMock.mockReturnValue({
      insert: vi.fn(async () => {
        throw new Error("insert response lost");
      }),
      select: vi.fn(() => uncertainQuery),
    });

    await expect(
      reports.createReport(reportInput, uploadDraft),
    ).rejects.toMatchObject({ message: "reports.submitUnknown" });
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("maps an upload transport rejection to safe guidance", async () => {
    fetchMock.mockRejectedValue(new Error("private upload transport detail"));
    fromMock.mockReturnValue(reportTable({}));
    await expect(
      reports.createReport(reportInput, uploadDraft),
    ).rejects.toMatchObject({ message: "reports.photoFailed" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("maps HTTP 413 and 415 upload rejections to localized error keys", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "too_large" }, { status: 413 }),
    );
    await expect(
      reports.createReport(reportInput, uploadDraft),
    ).rejects.toMatchObject({ message: "reports.photoTooLarge" });

    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "unsupported_type" }, { status: 415 }),
    );
    await expect(
      reports.createReport(reportInput, uploadDraft),
    ).rejects.toMatchObject({ message: "reports.photoBadType" });
  });

  it("reuses one object key across retry after cleanup failure", async () => {
    fromMock.mockReturnValue(
      reportTable({
        insert: { data: null, error: { message: "private insert detail" } },
      }),
    );
    removeMock
      .mockResolvedValueOnce({
        data: null,
        error: { message: "private cleanup detail" },
      })
      .mockResolvedValueOnce({ data: [], error: null });

    await reports.createReport(reportInput, uploadDraft).catch(() => undefined);
    await reports.createReport(reportInput, uploadDraft).catch(() => undefined);

    expect(uploadMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([, init]) =>
        ((init as RequestInit).body as FormData).get("objectId"),
      ),
    ).toEqual([photoId, photoId]);
    expect(removeMock).toHaveBeenNthCalledWith(1, [photoPath]);
    expect(removeMock).toHaveBeenNthCalledWith(2, [photoPath]);
  });
});

describe("report deletion photo cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getUserMock.mockResolvedValue({
      data: { user: { id: ownerId } },
      error: null,
    });
    storageFromMock.mockReturnValue({
      createSignedUrl: createSignedUrlMock,
      remove: removeMock,
      upload: uploadMock,
    });
  });

  it("removes the private object before deleting its report row", async () => {
    const events: string[] = [];
    removeMock.mockImplementation(async () => {
      events.push("photo-remove");
      return { data: [], error: null };
    });
    fromMock.mockReturnValue(
      reportTable({
        read: {
          data: { id: reportId, user_id: ownerId, photo_url: photoPath },
          error: null,
        },
        remove: { data: { id: reportId }, error: null },
        events,
      }),
    );

    await reports.deleteReport(reportId);

    expect(events).toEqual(["photo-remove", "report-delete"]);
  });

  it("keeps the report row when private object cleanup fails", async () => {
    const table = reportTable({
      read: {
        data: { id: reportId, user_id: ownerId, photo_url: photoPath },
        error: null,
      },
    });
    fromMock.mockReturnValue(table);
    removeMock.mockResolvedValue({
      data: null,
      error: { message: "private storage detail" },
    });

    await expect(reports.deleteReport(reportId)).rejects.toMatchObject({
      message: "reports.deletePhotoCleanupFailed",
    });
    expect(table.delete).not.toHaveBeenCalled();
  });

  it("maps a cleanup transport rejection without deleting the report row", async () => {
    const table = reportTable({
      read: {
        data: { id: reportId, user_id: ownerId, photo_url: photoPath },
        error: null,
      },
    });
    fromMock.mockReturnValue(table);
    removeMock.mockRejectedValue(new Error("private cleanup transport detail"));

    await expect(reports.deleteReport(reportId)).rejects.toMatchObject({
      message: "reports.deletePhotoCleanupFailed",
    });
    expect(table.delete).not.toHaveBeenCalled();
  });
});

describe("flagging and blocking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("flags a report with the chosen reason", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await reports.flagReport(reportId, "offensive");
    expect(rpcMock).toHaveBeenCalledWith("flag_citizen_report", {
      _report: reportId,
      _reason: "offensive",
    });
  });

  it.each([
    ["own_report", "reports.flagOwn"],
    ["report_not_open", "reports.flagClosed"],
    ["flag_rate_limited", "reports.flagRateLimited"],
    ["private database detail", "reports.flagFailed"],
  ])("maps a flag refusal %s to %s", async (message, key) => {
    rpcMock.mockResolvedValue({ data: null, error: { message } });
    await expect(reports.flagReport(reportId, "false")).rejects.toMatchObject({
      name: "ReportMutationError",
      message: key,
    });
  });

  it("hides an author through the report, never by user id", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await reports.blockReportAuthor(reportId);
    expect(rpcMock).toHaveBeenCalledWith("block_report_author", {
      _report: reportId,
    });
  });

  it.each([
    ["own_report", "reports.hideOwn"],
    ["private database detail", "reports.hideFailed"],
  ])("maps a hide refusal %s to %s", async (message, key) => {
    rpcMock.mockResolvedValue({ data: null, error: { message } });
    await expect(reports.blockReportAuthor(reportId)).rejects.toMatchObject({
      message: key,
    });
  });

  it("blocks the reporter behind a report with the moderator's reason", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await reports.blockReporter(reportId, "  repeated false fires ");
    await reports.blockReporter(reportId, null);
    expect(rpcMock).toHaveBeenNthCalledWith(1, "block_reporter", {
      _report: reportId,
      _reason: "repeated false fires",
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "block_reporter", {
      _report: reportId,
      _reason: null,
    });
  });

  it.each([
    ["report_moderator_role_required", "reportsPage.moderateForbidden"],
    ["report_not_found", "reportsPage.moderateGone"],
    ["private database detail", "reportsPage.blockFailed"],
  ])("maps a block refusal %s to %s", async (message, key) => {
    rpcMock.mockResolvedValue({ data: null, error: { message } });
    await expect(reports.blockReporter(reportId, null)).rejects.toMatchObject({
      message: key,
    });
  });

  it("reads flag reasons for moderators and surfaces a refusal", async () => {
    const run = reports.reportFlagsQuery(reportId)
      .queryFn as () => Promise<unknown>;
    rpcMock.mockResolvedValueOnce({
      data: [{ reason: "false", flags: 2 }],
      error: null,
    });
    await expect(run()).resolves.toEqual([{ reason: "false", flags: 2 }]);
    expect(rpcMock).toHaveBeenCalledWith("citizen_report_flag_summary", {
      _report: reportId,
    });
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "report_moderator_role_required" },
    });
    await expect(run()).rejects.toThrow("report_moderator_role_required");
  });

  it("treats a visitor as not the author without querying reports", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    await expect(reports.isOwnReport(reportId)).resolves.toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("recognises the signed-in author through their own row only", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: ownerId } } },
      error: null,
    });
    const filter = thenableFilter({ data: { id: reportId }, error: null });
    fromMock.mockReturnValue({ select: vi.fn(() => filter) });
    await expect(reports.isOwnReport(reportId)).resolves.toBe(true);
    expect(fromMock).toHaveBeenCalledWith("citizen_reports");
    expect(filter["eq"]).toHaveBeenCalledWith("id", reportId);
    expect(filter["eq"]).toHaveBeenCalledWith("user_id", ownerId);
  });
});

describe("moderation attention queue", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("includes user-flagged reports of any open status, not only pending ones", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn> | unknown> = {};
    for (const method of ["select", "order", "range", "eq", "neq", "gt", "or"])
      builder[method] = vi.fn(() => builder);
    builder["then"] = (resolve: (value: QueryResult) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    fromMock.mockReturnValue(builder);
    const run = reports.moderationQueueQuery("attention").queryFn as (context: {
      pageParam: number;
    }) => Promise<unknown>;

    await run({ pageParam: 0 });

    expect(builder["neq"]).toHaveBeenCalledWith("status", "rejected");
    expect(builder["eq"]).not.toHaveBeenCalled();
    expect(builder["or"]).toHaveBeenCalledWith(
      "and(status.eq.pending,publish_state.neq.published),and(status.eq.pending,flagged_at.not.is.null),user_flagged_at.not.is.null",
    );
  });
});
