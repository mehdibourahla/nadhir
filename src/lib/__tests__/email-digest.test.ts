import { describe, expect, it, vi } from "vitest";

import type { AnyLocale } from "@/i18n";
import {
  toProvenancePayload,
  provenanceForWatchZoneAlert,
} from "@/lib/alert-provenance";
import {
  buildEmailDigestWindowKey,
  classifyResendError,
  createResendEmailTransport,
  deliverZoneEmailDigests,
  escapeHtml,
  getAlgiersHour,
  isDigestScheduleDue,
  isInAlgiersQuietHours,
  isUrgentDigestAlert,
  renderZoneDigestEmail,
  ResendHttpError,
  sanitizeNadhirUrl,
  shouldDeferForQuietHours,
  type DigestAlertItem,
  type EmailDigestStore,
  type PendingEmailDigestUser,
  type ResendEmailInput,
  type ResendEmailTransport,
} from "@/lib/delivery/email-digest.server";

function makeUser(
  overrides: Partial<PendingEmailDigestUser> = {},
): PendingEmailDigestUser {
  return {
    user_id: "u-1",
    email: "nadia@example.invalid",
    display_name: "Nadia",
    locale: "ar",
    email_digest_frequency: "daily",
    email_digest_hour_algiers: 7,
    quiet_hours_start: 22,
    quiet_hours_end: 6,
    last_sent_at: null,
    ...overrides,
  };
}

function makeAlert(overrides: Partial<DigestAlertItem> = {}): DigestAlertItem {
  return {
    id: "a-1",
    kind: "weather",
    severity: 3,
    title: "ONM Severe Rain near Alger Centre",
    body: "Heavy rain observed across wilaya.",
    created_at: "2026-11-25T07:15:00Z",
    zone_id: "z-1",
    zone_name: "Alger Centre",
    source_table: "onm_vigilance",
    source_id: "onm-1",
    payload: {
      onm_severity: "Severe",
      ...toProvenancePayload(
        provenanceForWatchZoneAlert({
          kind: "weather",
          sourceTable: "onm_vigilance",
          severity: "Severe",
          areaLabel: "Alger Centre",
          radiusKm: 10,
          observedAt: "2026-11-25T07:15:00Z",
        }),
      ),
    },
    ...overrides,
  };
}

function makeInMemoryEmailStore(options: {
  pipelineActive?: boolean;
  users: PendingEmailDigestUser[];
  alertsByUser: Record<string, DigestAlertItem[]>;
}) {
  const deliveredAlertIds = new Set<string>();
  const suppressedUsers = new Set<string>();
  const sentDedupeKeys = new Set<string>();
  const deliveries = new Map<
    string,
    {
      id: string;
      userId: string;
      dedupeKey: string;
      alertIds: string[];
      leaseToken: string | null;
      attempts: number;
      state: string;
    }
  >();
  const finishCalls: Array<
    Parameters<EmailDigestStore["finishDigestDelivery"]>[0]
  > = [];
  let seq = 0;

  const store: EmailDigestStore = {
    async isPipelineActive() {
      return options.pipelineActive ?? true;
    },
    async listPendingUsers(limit) {
      return options.users
        .filter((u) => !suppressedUsers.has(u.user_id))
        .slice(0, limit);
    },
    async loadUndeliveredAlerts(userId, limit) {
      return (options.alertsByUser[userId] ?? [])
        .filter((a) => !deliveredAlertIds.has(a.id))
        .slice(0, limit);
    },
    async claimDigestDelivery(input) {
      if (suppressedUsers.has(input.userId)) return null;
      if (sentDedupeKeys.has(input.dedupeKey)) return null;
      const existing = [...deliveries.values()].find(
        (d) => d.dedupeKey === input.dedupeKey,
      );
      if (existing) {
        if (existing.state !== "pending" || existing.attempts >= 5) return null;
        existing.state = "leased";
        existing.attempts += 1;
        existing.leaseToken = `lease-${existing.id}-${existing.attempts}`;
        return {
          id: existing.id,
          lease_token: existing.leaseToken,
          attempts: existing.attempts,
        };
      }
      seq += 1;
      const id = `ed-${seq}`;
      const leaseToken = `lease-${id}-1`;
      deliveries.set(id, {
        id,
        userId: input.userId,
        dedupeKey: input.dedupeKey,
        alertIds: [...input.alertIds],
        leaseToken,
        attempts: 1,
        state: "leased",
      });
      return { id, lease_token: leaseToken, attempts: 1 };
    },
    async finishDigestDelivery(input) {
      finishCalls.push(input);
      const row = deliveries.get(input.id);
      if (!row || row.leaseToken !== input.leaseToken) return false;
      row.leaseToken = null;
      if (input.sent) {
        row.state = "sent";
        sentDedupeKeys.add(row.dedupeKey);
        for (const aid of row.alertIds) deliveredAlertIds.add(aid);
        return true;
      }
      if (input.bounced) {
        row.state = "bounced";
        suppressedUsers.add(row.userId);
        return true;
      }
      if (input.permanent || row.attempts >= 5) {
        row.state = "failed";
        return true;
      }
      row.state = "pending";
      return true;
    },
  };

  return { store, deliveredAlertIds, suppressedUsers, deliveries, finishCalls };
}

describe("HTML escaping & URL sanitization", () => {
  it("escapes HTML special characters and blocks javascript:/data:/foreign URLs", () => {
    expect(escapeHtml(`<script>alert("x&'y")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&amp;&#39;y&quot;)&lt;/script&gt;",
    );
    expect(sanitizeNadhirUrl("javascript:alert(1)")).toBe(
      "https://nadhir.app/alerts",
    );
    expect(sanitizeNadhirUrl("data:text/html,<script>1</script>")).toBe(
      "https://nadhir.app/alerts",
    );
    expect(sanitizeNadhirUrl("https://evil.example/steal")).toBe(
      "https://nadhir.app/alerts",
    );
    expect(sanitizeNadhirUrl("https://nadhir.app/fire/abc-1")).toBe(
      "https://nadhir.app/fire/abc-1",
    );
    expect(sanitizeNadhirUrl("/settings")).toBe("https://nadhir.app/settings");
  });
});

describe("Algiers quiet hours, midnight guard & urgent bypass", () => {
  it("resolves Algiers hour cleanly including midnight (00:xx, never 24)", () => {
    // 23:15 UTC == 00:15 Africa/Algiers
    expect(getAlgiersHour(new Date("2026-11-25T23:15:00Z"))).toBe(0);
    // 11:00 UTC == 12:00 Africa/Algiers
    expect(getAlgiersHour(new Date("2026-11-25T11:00:00Z"))).toBe(12);
  });

  it("handles null, equal, daytime, and overnight quiet-hour windows", () => {
    const midnightAlgiers = new Date("2026-11-25T23:15:00Z"); // 00:15 Algiers
    const noonAlgiers = new Date("2026-11-25T11:00:00Z"); // 12:00 Algiers
    const afternoonAlgiers = new Date("2026-11-25T13:30:00Z"); // 14:30 Algiers

    expect(isInAlgiersQuietHours(null, 6, midnightAlgiers)).toBe(false);
    expect(isInAlgiersQuietHours(22, 22, midnightAlgiers)).toBe(false);
    expect(isInAlgiersQuietHours(22, 6, midnightAlgiers)).toBe(true);
    expect(isInAlgiersQuietHours(22, 6, noonAlgiers)).toBe(false);
    expect(isInAlgiersQuietHours(13, 16, afternoonAlgiers)).toBe(true);
    expect(isInAlgiersQuietHours(13, 16, noonAlgiers)).toBe(false);
  });

  it("bypasses quiet hours for urgent fire, Extreme ONM, urgent official, and M5+ earthquake, while deferring non-urgent alerts", () => {
    const night = new Date("2026-11-25T23:30:00Z"); // 00:30 Algiers (inside 22..6)

    const nonUrgentOnm = makeAlert({
      kind: "weather",
      severity: 3,
      payload: { onm_severity: "Severe" },
    });
    const nonUrgentQuake = makeAlert({
      kind: "earthquake",
      severity: 3,
      payload: { magnitude: 4.3 },
    });
    const roadAlert = makeAlert({ kind: "road", severity: 3, payload: {} });

    expect(isUrgentDigestAlert(nonUrgentOnm)).toBe(false);
    expect(isUrgentDigestAlert(nonUrgentQuake)).toBe(false);
    expect(isUrgentDigestAlert(roadAlert)).toBe(false);
    expect(
      shouldDeferForQuietHours({
        alerts: [nonUrgentOnm, nonUrgentQuake, roadAlert],
        quietStart: 22,
        quietEnd: 6,
        now: night,
      }),
    ).toBe(true);

    const extremeOnm = makeAlert({
      kind: "weather",
      severity: 4,
      payload: { onm_severity: "Extreme" },
    });
    const urgentFire = makeAlert({
      kind: "fire",
      severity: 5,
      payload: { phase: "urgent" },
    });
    const urgentOfficial = makeAlert({
      kind: "official",
      severity: 4,
      payload: { hazard: "flood" },
    });
    const m5Quake = makeAlert({
      kind: "earthquake",
      severity: 4,
      payload: { magnitude: 5.2 },
    });

    for (const urgent of [extremeOnm, urgentFire, urgentOfficial, m5Quake]) {
      expect(isUrgentDigestAlert(urgent)).toBe(true);
      expect(
        shouldDeferForQuietHours({
          alerts: [nonUrgentOnm, urgent],
          quietStart: 22,
          quietEnd: 6,
          now: night,
        }),
      ).toBe(false);
    }
  });

  it("builds deterministic window keys and enforces daily hour schedule unless urgent", () => {
    const morningAlgiers = new Date("2026-11-25T05:30:00Z"); // 06:30 Algiers
    const afterSevenAlgiers = new Date("2026-11-25T06:30:00Z"); // 07:30 Algiers

    expect(buildEmailDigestWindowKey("daily", ["a1"], afterSevenAlgiers)).toBe(
      "daily:2026-11-25",
    );
    expect(buildEmailDigestWindowKey("hourly", ["a1"], afterSevenAlgiers)).toBe(
      "hourly:2026-11-25T07",
    );
    expect(buildEmailDigestWindowKey("immediate", ["b", "a"])).toBe(
      buildEmailDigestWindowKey("immediate", ["a", "b"]),
    );

    expect(
      isDigestScheduleDue({
        frequency: "daily",
        digestHourAlgiers: 7,
        lastSentAt: null,
        urgentBypass: false,
        now: morningAlgiers,
      }),
    ).toBe(false);

    expect(
      isDigestScheduleDue({
        frequency: "daily",
        digestHourAlgiers: 7,
        lastSentAt: null,
        urgentBypass: true,
        now: morningAlgiers,
      }),
    ).toBe(true);

    expect(
      isDigestScheduleDue({
        frequency: "daily",
        digestHourAlgiers: 7,
        lastSentAt: null,
        urgentBypass: false,
        now: afterSevenAlgiers,
      }),
    ).toBe(true);
  });
});

describe("renderZoneDigestEmail", () => {
  it("renders RTL Arabic and LTR FR/EN/KAB HTML + plain-text with strict XSS escaping, verbatim ONM attribution, provenance footer, and manage link", () => {
    const locales: AnyLocale[] = ["ar", "fr", "en", "kab"];
    const xssAlert = makeAlert({
      title: `ONM Rain <script>alert(1)</script> — safe all-clear`,
      body: `Details for "Alger" & <img src=x onerror=alert(1)>`,
      zone_name: `<b>Alger</b>`,
      deep_link: "javascript:alert(1)",
      instruction: "Evacuate via Highway 1 immediately",
    });

    for (const locale of locales) {
      const rendered = renderZoneDigestEmail({
        locale,
        alerts: [xssAlert],
        urgentBypass: true,
      });

      const expectedDir = locale === "ar" ? "rtl" : "ltr";
      expect(rendered.dir).toBe(expectedDir);
      expect(rendered.html).toContain(
        `<html lang="${locale}" dir="${expectedDir}">`,
      );
      expect(rendered.html).toContain(
        expectedDir === "rtl" ? "text-align:right" : "text-align:left",
      );

      // Strictly escaped HTML & blocked javascript: URL
      expect(rendered.html).not.toContain("<script>");
      expect(rendered.html).not.toContain("<img ");
      expect(rendered.html).not.toContain("javascript:");
      expect(rendered.html).toContain("&lt;script&gt;");
      expect(rendered.html).toContain("https://nadhir.app/alerts");
      expect(rendered.html).toContain("https://nadhir.app/settings");
      expect(rendered.text).toContain("https://nadhir.app/settings");

      // ONM attribution verbatim, zero em dashes, zero safe labels, zero Nadhir instructions
      expect(rendered.html).toContain("ONM · Météo Algérie");
      expect(rendered.text).toContain("ONM · Météo Algérie");
      expect(rendered.html).not.toContain("\u2014");
      expect(rendered.text).not.toContain("\u2014");
      expect(rendered.text.toLowerCase()).not.toContain("all-clear");
      expect(rendered.text.toLowerCase()).not.toMatch(/\bsafe\b/);
      expect(rendered.text).not.toContain("Evacuate via Highway 1");

      // Provenance footer + Algiers timestamp + urgent bypass notice
      expect(rendered.provenanceLines).toHaveLength(1);
      expect(rendered.html).toContain(escapeHtml(rendered.provenanceLines[0]!));
      expect(rendered.text).toContain("25/11/2026 08:15");
    }
  });

  it("falls back to provenanceForWatchZoneAlert when legacy alert payload lacks provenance_* keys and preserves NFD ONM attribution", () => {
    const nfdAttr = "ONM · Me\u0301te\u0301o Alge\u0301rie";
    const legacyAlert = makeAlert({
      payload: {
        onm_severity: "Extreme",
        source_key: "onm",
        source_attribution: nfdAttr,
      },
    });
    const rendered = renderZoneDigestEmail({
      locale: "fr",
      alerts: [legacyAlert],
      urgentBypass: false,
    });
    expect(rendered.text).toContain(nfdAttr);
    expect(rendered.provenanceLines[0]).toContain(nfdAttr);
  });
});

describe("classifyResendError & Resend transport", () => {
  it("distinguishes transient 429/5xx, hard bounce suppression, and permanent non-429 4xx", () => {
    expect(
      classifyResendError(
        new ResendHttpError(429, "rate limit", { retryAfterSeconds: 45 }),
      ),
    ).toMatchObject({
      transient: true,
      permanent: false,
      bounced: false,
      retryAfterSeconds: 45,
    });

    expect(
      classifyResendError(new ResendHttpError(502, "bad gateway")),
    ).toMatchObject({ transient: true, permanent: false, bounced: false });

    expect(
      classifyResendError(
        new ResendHttpError(422, "550 5.1.1 user unknown", { bounced: true }),
      ),
    ).toMatchObject({ transient: false, permanent: true, bounced: true });

    expect(
      classifyResendError(new ResendHttpError(401, "invalid api key")),
    ).toMatchObject({ transient: false, permanent: true, bounced: false });
  });

  it("createResendEmailTransport posts Bearer + Idempotency-Key and maps errors without live calls", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "re_ok_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ name: "bounce", message: "550 5.1.1 user unknown" }),
          { status: 422, headers: { "content-type": "application/json" } },
        ),
      );

    const transport = createResendEmailTransport({
      apiKey: "re_test_key",
      apiUrl: "https://api.resend.test/emails",
      fetchImpl: fetchMock,
    });

    const ok = await transport.sendEmail({
      from: "Nadhir <no-reply@nadhir.app>",
      to: "user@example.invalid",
      subject: "Subject",
      html: "<p>Hi</p>",
      text: "Hi",
      idempotencyKey: "email:u1:daily:2026-11-25",
    });
    expect(ok).toEqual({ providerMessageId: "re_ok_1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.test/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_key",
          "Idempotency-Key": "email:u1:daily:2026-11-25",
        }),
      }),
    );

    await expect(
      transport.sendEmail({
        from: "Nadhir <no-reply@nadhir.app>",
        to: "bad@example.invalid",
        subject: "Subject",
        html: "<p>Hi</p>",
        text: "Hi",
        idempotencyKey: "email:u2:daily:2026-11-25",
      }),
    ).rejects.toMatchObject({
      name: "ResendHttpError",
      status: 422,
      bounced: true,
    });
  });
});

describe("deliverZoneEmailDigests pipeline", () => {
  it("honors unconfigured env and env/DB kill switches", async () => {
    expect(await deliverZoneEmailDigests({ env: {} })).toMatchObject({
      unconfigured: true,
      disabled: false,
      sent: 0,
    });
    expect(
      await deliverZoneEmailDigests({ env: { EMAIL_DIGEST_ENABLED: "0" } }),
    ).toMatchObject({ disabled: true, sent: 0 });

    const transport: ResendEmailTransport = { sendEmail: vi.fn() };
    const { store } = makeInMemoryEmailStore({
      pipelineActive: false,
      users: [makeUser()],
      alertsByUser: { "u-1": [makeAlert()] },
    });
    expect(
      await deliverZoneEmailDigests({
        env: {},
        transport,
        store,
        now: new Date("2026-11-25T08:00:00Z"),
      }),
    ).toMatchObject({ disabled: true, sent: 0 });
    expect(transport.sendEmail).not.toHaveBeenCalled();
  });

  it("defers non-urgent alerts during quiet hours without marking delivered, delivers after quiet hours, and deduplicates", async () => {
    const sentInputs: ResendEmailInput[] = [];
    const transport: ResendEmailTransport = {
      sendEmail: vi.fn(async (input) => {
        sentInputs.push(input);
        return { providerMessageId: `re_${sentInputs.length}` };
      }),
    };

    const harness = makeInMemoryEmailStore({
      users: [makeUser({ email_digest_frequency: "immediate" })],
      alertsByUser: { "u-1": [makeAlert()] },
    });

    // 23:30 UTC == 00:30 Algiers (quiet hours 22..6) -> deferred cleanly
    const nightRun = await deliverZoneEmailDigests({
      env: {},
      transport,
      store: harness.store,
      now: new Date("2026-11-25T23:30:00Z"),
    });
    expect(nightRun).toMatchObject({ deferredQuietHours: 1, sent: 0 });
    expect(harness.deliveredAlertIds.size).toBe(0);
    expect(transport.sendEmail).not.toHaveBeenCalled();

    // 07:00 UTC == 08:00 Algiers (outside quiet hours) -> delivered & marked delivered_email=true
    const morningRun = await deliverZoneEmailDigests({
      env: {},
      transport,
      store: harness.store,
      now: new Date("2026-11-26T07:00:00Z"),
    });
    expect(morningRun).toMatchObject({ sent: 1, deferredQuietHours: 0 });
    expect(harness.deliveredAlertIds.has("a-1")).toBe(true);
    expect(sentInputs[0]?.headers?.["List-Unsubscribe"]).toBe(
      "<https://nadhir.app/settings>",
    );

    // Re-running must send 0 duplicates
    const dupRun = await deliverZoneEmailDigests({
      env: {},
      transport,
      store: harness.store,
      now: new Date("2026-11-26T07:05:00Z"),
    });
    expect(dupRun).toMatchObject({ sent: 0 });
    expect(transport.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("bypasses quiet hours immediately for Extreme ONM and M5+ earthquake alerts", async () => {
    const sentInputs: ResendEmailInput[] = [];
    const transport: ResendEmailTransport = {
      sendEmail: vi.fn(async (input) => {
        sentInputs.push(input);
        return { providerMessageId: `re_urgent_${sentInputs.length}` };
      }),
    };
    const harness = makeInMemoryEmailStore({
      users: [makeUser({ email_digest_frequency: "daily", locale: "fr" })],
      alertsByUser: {
        "u-1": [
          makeAlert({
            id: "a-m5",
            kind: "earthquake",
            severity: 4,
            title: "Séisme M5.3 près d'Alger",
            payload: { magnitude: 5.3 },
          }),
        ],
      },
    });

    const nightRun = await deliverZoneEmailDigests({
      env: {},
      transport,
      store: harness.store,
      now: new Date("2026-11-25T23:30:00Z"), // 00:30 Algiers
    });
    expect(nightRun).toMatchObject({ sent: 1, deferredQuietHours: 0 });
    expect(sentInputs[0]?.subject).toContain("[Urgent]");
    expect(sentInputs[0]?.html).toContain("heures silencieuses");
  });

  it("retries transient 429/5xx without marking delivered, fails permanent 4xx, and suppresses hard bounces", async () => {
    // 1. Transient 503 -> retried, alerts NOT marked delivered
    const retryHarness = makeInMemoryEmailStore({
      users: [makeUser({ email_digest_frequency: "immediate" })],
      alertsByUser: { "u-1": [makeAlert({ id: "a-retry" })] },
    });
    const retryTransport: ResendEmailTransport = {
      sendEmail: vi
        .fn()
        .mockRejectedValueOnce(new ResendHttpError(503, "temporary outage"))
        .mockResolvedValueOnce({ providerMessageId: "re_recovered" }),
    };

    const r1 = await deliverZoneEmailDigests({
      env: {},
      transport: retryTransport,
      store: retryHarness.store,
      now: new Date("2026-11-25T08:00:00Z"),
    });
    expect(r1).toMatchObject({ retried: 1, sent: 0, failed: 0 });
    expect(retryHarness.deliveredAlertIds.has("a-retry")).toBe(false);

    const r2 = await deliverZoneEmailDigests({
      env: {},
      transport: retryTransport,
      store: retryHarness.store,
      now: new Date("2026-11-25T08:05:00Z"),
    });
    expect(r2).toMatchObject({ sent: 1, retried: 0 });
    expect(retryHarness.deliveredAlertIds.has("a-retry")).toBe(true);

    // 2. Hard bounce -> suppressed from all future runs
    const bounceHarness = makeInMemoryEmailStore({
      users: [
        makeUser({ user_id: "u-bounce", email_digest_frequency: "immediate" }),
      ],
      alertsByUser: { "u-bounce": [makeAlert({ id: "a-b1" })] },
    });
    const bounceTransport: ResendEmailTransport = {
      sendEmail: vi
        .fn()
        .mockRejectedValue(
          new ResendHttpError(422, "550 5.1.1 user unknown", { bounced: true }),
        ),
    };

    const b1 = await deliverZoneEmailDigests({
      env: {},
      transport: bounceTransport,
      store: bounceHarness.store,
      now: new Date("2026-11-25T08:00:00Z"),
    });
    expect(b1).toMatchObject({ bounced: 1, sent: 0, failed: 0 });
    expect(bounceHarness.suppressedUsers.has("u-bounce")).toBe(true);

    const b2 = await deliverZoneEmailDigests({
      env: {},
      transport: bounceTransport,
      store: bounceHarness.store,
      now: new Date("2026-11-25T09:00:00Z"),
    });
    expect(b2).toMatchObject({ usersChecked: 0, sent: 0 });
    expect(bounceTransport.sendEmail).toHaveBeenCalledTimes(1);
  });
});
