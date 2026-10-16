import { describe, expect, it } from "vitest";

import {
  FCM_LANGS,
  fcmMessageForAlert,
  fcmMessagesForFire,
  fcmMessagesForOnm,
  fcmTopic,
  packTopics,
  userTopic,
} from "@/lib/fcm";

const info = [
  {
    language: "ar-DZ",
    headline: "حريق مؤكد — عزازقة",
    description: "وصف عربي",
  },
  {
    language: "fr-DZ",
    headline: "Incendie confirmé — Azazga",
    description: "desc fr",
  },
  {
    language: "en",
    headline: "Confirmed fire — Azazga",
    description: "desc en",
  },
  { language: "kab", headline: "Times — Azazga", description: "desc kab" },
];

describe("fcmTopic", () => {
  it("names topics per ADR-0004", () => {
    expect(fcmTopic("1503", "ar")).toBe("v1.commune.1503.ar");
  });
});

describe("fcmMessagesForFire", () => {
  const messages = fcmMessagesForFire({
    broadcastId: "b-1",
    severity: "Severe",
    communeCodes: ["1503", "1510"],
    shortId: "DZ7K4A",
    info,
  });

  it("fans out one message per commune and language", () => {
    expect(messages).toHaveLength(2 * FCM_LANGS.length);
    expect(messages.map((m) => m.topic)).toContain("v1.commune.1510.kab");
  });

  it("takes title and body from the CAP info block of the topic language", () => {
    const fr = messages.find((m) => m.topic === "v1.commune.1503.fr")!;
    expect(fr.notification.title).toBe("Incendie confirmé — Azazga");
    expect(fr.notification.body).toBe("desc fr");
    const ar = messages.find((m) => m.topic === "v1.commune.1503.ar")!;
    expect(ar.notification.title).toBe("حريق مؤكد — عزازقة");
  });

  it("replaces the previous notification about the same fire in the tray", () => {
    expect(
      messages.every(
        (m) =>
          m.webpush.notification?.tag === "fire-DZ7K4A" &&
          m.webpush.notification.renotify,
      ),
    ).toBe(true);
  });

  it("deep-links to the fire page", () => {
    expect(messages[0]!.webpush.fcm_options.link).toBe(
      "https://nadhir.app/fire/DZ7K4A",
    );
    expect(messages[0]!.data).toEqual({
      broadcast_id: "b-1",
      severity: "Severe",
      kind: "fire",
      link: "/fire/DZ7K4A",
    });
  });

  it("drops a language with no info block rather than inventing text", () => {
    const partial = fcmMessagesForFire({
      broadcastId: "b-1",
      severity: "Severe",
      communeCodes: ["1503"],
      shortId: "DZ7K4A",
      info: info.slice(0, 2),
    });
    expect(partial).toHaveLength(2);
    expect(partial.every((m) => m.notification.title)).toBe(true);
  });
});

describe("fcmMessagesForOnm", () => {
  const messages = fcmMessagesForOnm({
    broadcastId: "b-2",
    severity: "Extreme",
    communeCodes: ["1503"],
    title: "Rain Extreme warning for the wilaya: Tizi Ouzou",
    headlineFr: "Pluies torrentielles attendues",
    wilayaId: "w15",
    event: "Rain",
  });

  it("relays verbatim with attribution to every language topic", () => {
    expect(messages).toHaveLength(FCM_LANGS.length);
    for (const m of messages) {
      expect(m.notification.title).toContain("ONM");
      expect(m.notification.body).toBe("Pluies torrentielles attendues");
      expect(m.data.kind).toBe("onm");
    }
  });

  it("falls back to the feed title when no French headline exists", () => {
    const bare = fcmMessagesForOnm({
      broadcastId: "b-2",
      severity: "Severe",
      communeCodes: ["1503"],
      title: "Wind Severe warning for the wilaya: Bejaia",
      headlineFr: null,
      wilayaId: null,
      event: "Strong",
    });
    expect(bare[0]!.notification.body).toBe(
      "Wind Severe warning for the wilaya: Bejaia",
    );
  });

  it("replaces the previous bulletin for the same wilaya and phenomenon in the tray", () => {
    expect(messages[0]!.webpush.notification).toEqual({
      tag: "onm-w15-Rain",
      renotify: true,
    });
  });

  it("opens the forecast on the recipient's commune", () => {
    expect(messages[0]!.webpush.fcm_options.link).toBe(
      "https://nadhir.app/forecast?commune=1503",
    );
  });
});

describe("fcmMessagesForAuthority", () => {
  it("relays verbatim with the named authority as attribution", async () => {
    const { fcmMessagesForAuthority } = await import("@/lib/fcm");
    const messages = fcmMessagesForAuthority({
      broadcastId: "b-3",
      severity: "Severe",
      communeCodes: ["1503"],
      source: "Protection Civile",
      body: "Évacuation préventive du douar X ordonnée.",
    });
    expect(messages).toHaveLength(4);
    for (const m of messages) {
      expect(m.notification.title).toBe("Protection Civile");
      expect(m.notification.body).toBe(
        "Évacuation préventive du douar X ordonnée.",
      );
      expect(m.data.kind).toBe("authority");
    }
  });
});

describe("fcmMessageForAlert", () => {
  const alert = {
    id: "a1",
    user_id: "u1",
    kind: "weather",
    title: "ONM warning for Home",
    body: "ONM: “Orages”",
    source_id: "onm1",
    cluster_id: null,
    payload: null,
  };

  it("sends a zone alert to its owner's own topic", () => {
    expect(fcmMessageForAlert(alert, "r").topic).toBe(userTopic("u1"));
    expect(userTopic("u1")).toBe("v1.user.u1");
  });

  it("tags by hazard so a commune broadcast of the same hazard collapses into it", () => {
    expect(fcmMessageForAlert(alert, "r").webpush.notification.tag).toBe(
      "onm1",
    );
    expect(
      fcmMessageForAlert({ ...alert, source_id: null, cluster_id: "c9" }, "r")
        .webpush.notification.tag,
    ).toBe("c9");
  });

  it("carries the alert id and its receipt for the device to confirm arrival", () => {
    expect(fcmMessageForAlert(alert, "sig").data).toEqual({
      alert_id: "a1",
      kind: "weather",
      receipt: "sig",
      link: "/alerts",
    });
  });

  it("opens the fire page for a fire alert and the inbox otherwise", () => {
    expect(fcmMessageForAlert(alert, "r").webpush.fcm_options.link).toBe(
      "https://nadhir.app/alerts",
    );
    expect(
      fcmMessageForAlert(
        {
          ...alert,
          kind: "fire",
          source_id: null,
          cluster_id: "c9",
          payload: { short_id: "DZ1" },
        },
        "r",
      ).webpush.fcm_options.link,
    ).toBe("https://nadhir.app/fire/DZ1");
  });
});

describe("native delivery", () => {
  const [fire] = fcmMessagesForFire({
    broadcastId: "b-1",
    severity: "Severe",
    communeCodes: ["1503"],
    shortId: "DZ7K4A",
    info,
  });

  it("asks Android and iOS for immediate, audible delivery on the alerts channel", () => {
    expect(fire!.android).toEqual({
      priority: "high",
      notification: { channel_id: "alerts", tag: "fire-DZ7K4A" },
    });
    expect(fire!.apns).toEqual({
      headers: { "apns-priority": "10", "apns-collapse-id": "fire-DZ7K4A" },
      payload: {
        aps: { sound: "default", "interruption-level": "time-sensitive" },
      },
    });
  });

  it("tells the app which screen a tap opens", () => {
    expect(fire!.data.link).toBe("/fire/DZ7K4A");
    const [onm] = fcmMessagesForOnm({
      broadcastId: "b-2",
      severity: "Severe",
      communeCodes: ["1503"],
      title: "t",
      headlineFr: null,
      wilayaId: null,
      event: "rain",
    });
    expect(onm!.data.link).toBe("/forecast?commune=1503");
    expect(onm!.android.notification).toEqual({ channel_id: "alerts" });
    expect(onm!.apns.headers).toEqual({ "apns-priority": "10" });
  });

  it("gives a user alert the same delivery and its own collapse key", async () => {
    const message = fcmMessageForAlert(
      {
        id: "a1",
        user_id: "u1",
        kind: "fire",
        title: "t",
        body: "b",
        source_id: null,
        cluster_id: "c9",
        payload: { short_id: "DZ1" },
      },
      "r",
    );
    expect(message.data.link).toBe("/fire/DZ1");
    expect(message.android.notification.tag).toBe("c9");
    expect(message.apns.headers["apns-collapse-id"]).toBe("c9");
  });
});

it("keeps the iOS collapse id within APNs' 64-byte limit", () => {
  const [onm] = fcmMessagesForOnm({
    broadcastId: "b-3",
    severity: "Severe",
    communeCodes: ["1503"],
    title: "t",
    headlineFr: null,
    wilayaId: "8d0e3c1a-4b5f-4c6d-9e7f-0a1b2c3d4e5f",
    event: "Précipitations-exceptionnelles-orageuses",
  });
  const collapse = onm!.apns.headers["apns-collapse-id"]!;
  expect(new TextEncoder().encode(collapse).length).toBeLessThanOrEqual(64);
  expect(collapse.startsWith("onm-8d0e3c1a")).toBe(true);
  expect(onm!.android.notification.tag).toBe(
    "onm-8d0e3c1a-4b5f-4c6d-9e7f-0a1b2c3d4e5f-Précipitations-exceptionnelles-orageuses",
  );
});

it("keeps distinct long ONM tags distinct after shortening the iOS collapse id", () => {
  const wilayaId = "8d0e3c1a-4b5f-4c6d-9e7f-0a1b2c3d4e5f";
  const ids = [
    "Précipitations-exceptionnelles-orageuses",
    "Précipitations-exceptionnelles-neigeuses",
  ].map(
    (event) =>
      fcmMessagesForOnm({
        broadcastId: "b",
        severity: "Severe",
        communeCodes: ["1503"],
        title: "t",
        headlineFr: null,
        wilayaId,
        event,
      })[0]!.apns.headers["apns-collapse-id"]!,
  );
  expect(ids[0]).not.toBe(ids[1]);
  for (const id of ids)
    expect(new TextEncoder().encode(id).length).toBeLessThanOrEqual(64);
});

describe("packTopics", () => {
  it("sends one ONM message per commune across its four language topics", () => {
    const packed = packTopics(
      fcmMessagesForOnm({
        broadcastId: "b-2",
        severity: "Severe",
        communeCodes: ["1503", "1510"],
        title: "Rain",
        headlineFr: "Pluies",
        wilayaId: "w15",
        event: "Rain",
      }),
    );
    expect(packed.map((p) => p.key)).toEqual([
      "'v1.commune.1503.ar' in topics || 'v1.commune.1503.fr' in topics || 'v1.commune.1503.en' in topics || 'v1.commune.1503.kab' in topics",
      "'v1.commune.1510.ar' in topics || 'v1.commune.1510.fr' in topics || 'v1.commune.1510.en' in topics || 'v1.commune.1510.kab' in topics",
    ]);
    expect(packed[1]!.message.webpush.fcm_options.link).toContain("1510");
    expect("topic" in packed[0]!.message).toBe(false);
  });

  it("keeps each language's text apart and caps a condition at five topics", () => {
    const codes = ["1501", "1502", "1503", "1504", "1505", "1506"];
    const packed = packTopics(
      fcmMessagesForFire({
        broadcastId: "b-1",
        severity: "Severe",
        communeCodes: codes,
        shortId: "DZ7K4A",
        info: info.slice(0, 2),
      }),
    );
    expect(packed).toHaveLength(4);
    for (const { key, message } of packed) {
      const lang = message.notification.title.startsWith("حريق") ? "ar" : "fr";
      const topics = key.match(/v1\.commune\.\d+\.\w+/g)!;
      expect(topics.length).toBeLessThanOrEqual(5);
      expect(topics.every((t) => t.endsWith(`.${lang}`))).toBe(true);
    }
    expect(
      packed.find((p) => p.key === "v1.commune.1506.fr")?.message,
    ).toMatchObject({
      topic: "v1.commune.1506.fr",
    });
  });
});
