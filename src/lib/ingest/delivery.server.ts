import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  fcmMessagesForAuthority,
  fcmMessagesForFire,
  fcmMessagesForOfficial,
  fcmMessagesForOnm,
  packTopics,
  type FcmMessage,
} from "@/lib/fcm";
import { telegramAuthorityHtml, telegramSeverityAllowed } from "@/lib/telegram";
import { fetchAllPages } from "@/lib/paginate";

import { fcmConfigured, fcmSend } from "./fcm.server";
import { sendTelegram, telegramConfigured } from "./telegram.server";

export type DeliveryRun = {
  rows: number;
  sent: number;
  telegramRows: number;
  telegramSent: number;
  telegramChannels: number;
  fcmConfigured: boolean;
  telegramConfigured: boolean;
  disabled: boolean;
};

const FCM_SEND_BUDGET = 500;
type Channel = "fcm" | "telegram";

type PendingRow = {
  id: string;
  lease_token: string;
  kind: string;
  severity: string;
  commune_codes: string[];
  push_codes: string[];
  cluster_id: string | null;
  cap_alert_id: string | null;
  onm_vigilance_id: string | null;
  authority_warning_id: string | null;
};

type CapText = {
  language: string;
  headline: string;
  description: string;
  parameter?: { valueName: string; value: string }[];
};

type DeliveryContext = {
  infoByCap: Map<string, CapText[]>;
  shortIdByCluster: Map<string, string>;
  onmById: Map<
    string,
    {
      title: string;
      headline_fr: string | null;
      wilaya_id: string | null;
      event: string;
    }
  >;
  authorityById: Map<string, { source: string; body: string }>;
};

async function claimDelivery(channel: Channel): Promise<PendingRow | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_broadcast_delivery", {
    _channel: channel,
    _limit: 1,
  });
  if (error) throw new Error(error.message);
  return (data?.[0]?.job as PendingRow | undefined) ?? null;
}

async function renewDelivery(row: PendingRow, channel: Channel) {
  const { data, error } = await supabaseAdmin.rpc("renew_broadcast_delivery", {
    _broadcast_id: row.id,
    _channel: channel,
    _lease_token: row.lease_token,
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error(`${channel} delivery lease lost`);
}

async function finishDelivery(
  row: PendingRow,
  channel: Channel,
  count: number | null,
  failure: string | null = null,
) {
  const { data, error } = await supabaseAdmin.rpc("finish_broadcast_delivery", {
    _broadcast_id: row.id,
    _channel: channel,
    _lease_token: row.lease_token,
    _count: count,
    _error: failure,
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error(`${channel} delivery lease lost`);
}

async function failDelivery(
  row: PendingRow,
  channel: Channel,
  error: unknown,
  errors: string[],
) {
  const message =
    error instanceof Error ? error.message : `${channel} delivery failed`;
  errors.push(message);
  try {
    await finishDelivery(row, channel, null, message);
  } catch (failure) {
    errors.push(
      failure instanceof Error ? failure.message : "delivery release failed",
    );
  }
}

async function loadContext(rows: PendingRow[]): Promise<DeliveryContext> {
  const context: DeliveryContext = {
    infoByCap: new Map(),
    shortIdByCluster: new Map(),
    onmById: new Map(),
    authorityById: new Map(),
  };

  const capIds = rows
    .map((p) => p.cap_alert_id)
    .filter((id): id is string => id !== null);
  if (capIds.length) {
    const { data, error } = await supabaseAdmin
      .from("cap_alerts")
      .select("id, info")
      .in("id", capIds);
    if (error) throw new Error(error.message);
    for (const row of data ?? [])
      context.infoByCap.set(row.id, row.info as CapText[]);
  }

  const clusterIds = rows
    .map((p) => p.cluster_id)
    .filter((id): id is string => id !== null);
  if (clusterIds.length) {
    const { data, error } = await supabaseAdmin
      .from("fire_clusters")
      .select("id, short_id")
      .in("id", clusterIds);
    if (error) throw new Error(error.message);
    for (const row of data ?? [])
      context.shortIdByCluster.set(row.id, row.short_id);
  }

  const onmIds = rows
    .map((p) => p.onm_vigilance_id)
    .filter((id): id is string => id !== null);
  if (onmIds.length) {
    const { data, error } = await supabaseAdmin
      .from("onm_vigilance")
      .select("id, title, headline_fr, wilaya_id, event")
      .in("id", onmIds);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) context.onmById.set(row.id, row);
  }

  const authorityIds = rows
    .map((p) => p.authority_warning_id)
    .filter((id): id is string => id !== null);
  if (authorityIds.length) {
    const { data, error } = await supabaseAdmin
      .from("authority_warnings")
      .select("id, source, body")
      .in("id", authorityIds);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) context.authorityById.set(row.id, row);
  }

  return context;
}

function fcmMessagesFor(
  row: PendingRow,
  context: DeliveryContext,
): FcmMessage[] | null {
  if (row.kind === "fire") {
    const info = row.cap_alert_id
      ? context.infoByCap.get(row.cap_alert_id)
      : null;
    const shortId = row.cluster_id
      ? context.shortIdByCluster.get(row.cluster_id)
      : null;
    if (!info || !shortId) return null;
    return fcmMessagesForFire({
      broadcastId: row.id,
      severity: row.severity,
      communeCodes: row.push_codes,
      shortId,
      info,
    });
  }
  if (row.kind === "onm") {
    const onm = row.onm_vigilance_id
      ? context.onmById.get(row.onm_vigilance_id)
      : null;
    if (!onm) return null;
    return fcmMessagesForOnm({
      broadcastId: row.id,
      severity: row.severity,
      communeCodes: row.push_codes,
      title: onm.title,
      headlineFr: onm.headline_fr,
      wilayaId: onm.wilaya_id,
      event: onm.event,
    });
  }
  if (row.kind === "official") {
    const info = row.cap_alert_id
      ? context.infoByCap.get(row.cap_alert_id)
      : null;
    if (!info) return null;
    return fcmMessagesForOfficial({
      broadcastId: row.id,
      severity: row.severity,
      communeCodes: row.push_codes,
      info,
    });
  }
  if (row.kind === "authority") {
    const warning = row.authority_warning_id
      ? context.authorityById.get(row.authority_warning_id)
      : null;
    if (!warning) return null;
    return fcmMessagesForAuthority({
      broadcastId: row.id,
      severity: row.severity,
      communeCodes: row.push_codes,
      source: warning.source,
      body: warning.body,
    });
  }
  return null;
}

async function deliverFcm(errors: string[]): Promise<{
  rows: number;
  sent: number;
}> {
  let sent = 0;
  let attempts = 0;
  let rows = 0;
  for (
    let claimed = 0;
    claimed < 20 && attempts < FCM_SEND_BUDGET;
    claimed += 1
  ) {
    const row = await claimDelivery("fcm");
    if (!row) break;
    try {
      const context = await loadContext([row]);
      const messages = fcmMessagesFor(row, context);
      if (messages === null) throw new Error("fcm delivery context missing");
      const delivered = await deliveryReceipts(row.id, "fcm");
      let failure: string | null = null;
      const unsent = messages.filter((m) => !delivered.has(m.topic));
      for (const { key, message } of packTopics(unsent)) {
        if (delivered.has(key)) continue;
        if (attempts >= FCM_SEND_BUDGET) {
          failure ??= "budget_exhausted";
          break;
        }
        await renewDelivery(row, "fcm");
        attempts += 1;
        try {
          await fcmSend(message);
        } catch (error) {
          failure = error instanceof Error ? error.message : "fcm send failed";
          errors.push(failure);
          continue;
        }
        sent += 1;
        await recordDelivery(row.id, "fcm", key);
        delivered.add(key);
      }
      await finishDelivery(
        row,
        "fcm",
        failure === null ? messages.length : null,
        failure,
      );
      if (failure === null) rows += 1;
    } catch (error) {
      await failDelivery(row, "fcm", error, errors);
    }
  }
  return { rows, sent };
}

async function deliveryReceipts(
  broadcastId: string,
  channel: "fcm" | "telegram",
) {
  const receipts = await fetchAllPages<{ destination: string }>((from, to) =>
    supabaseAdmin
      .from("broadcast_delivery_receipts")
      .select("destination")
      .eq("broadcast_id", broadcastId)
      .eq("channel", channel)
      .order("destination")
      .range(from, to),
  );
  return new Set(receipts.map((r) => r.destination));
}

async function recordDelivery(
  broadcastId: string,
  channel: "fcm" | "telegram",
  destination: string,
) {
  const { error } = await supabaseAdmin
    .from("broadcast_delivery_receipts")
    .upsert(
      { broadcast_id: broadcastId, channel, destination },
      {
        onConflict: "broadcast_id,channel,destination",
        ignoreDuplicates: true,
      },
    );
  if (error) throw new Error(error.message);
}

function telegramHtmlFor(
  row: PendingRow,
  context: DeliveryContext,
): string | null {
  if (!telegramSeverityAllowed(row.severity)) return null;
  if (row.kind === "official") {
    const info = row.cap_alert_id
      ? context.infoByCap.get(row.cap_alert_id)
      : null;
    const block =
      info?.find((i) => i.language.startsWith("fr")) ?? info?.[0] ?? null;
    return block?.parameter?.some(
      (p) => p.valueName === "source_key" && p.value === "dgpc_telegram",
    )
      ? telegramAuthorityHtml({
          source: block.headline,
          body: block.description,
        })
      : null;
  }
  return null;
}

async function deliverTelegram(errors: string[]): Promise<{
  rows: number;
  sent: number;
  channels: number;
}> {
  const { data: channels, error: channelsError } = await supabaseAdmin
    .from("telegram_channels")
    .select("wilaya_id, chat_id");
  if (channelsError) throw new Error(channelsError.message);
  if (!channels?.length) return { rows: 0, sent: 0, channels: 0 };
  const chatByWilaya = new Map(channels.map((c) => [c.wilaya_id, c.chat_id]));

  let sent = 0;
  let rows = 0;
  for (let claimed = 0; claimed < 20; claimed += 1) {
    const row = await claimDelivery("telegram");
    if (!row) break;
    try {
      const context = await loadContext([row]);
      if (
        row.kind === "official" &&
        (!row.cap_alert_id || !context.infoByCap.has(row.cap_alert_id))
      )
        throw new Error("telegram delivery context missing");
      const html = telegramHtmlFor(row, context);
      const { data: communes, error: communesError } = await supabaseAdmin
        .from("admin_units")
        .select("code, parent_id")
        .eq("level", "commune")
        .in("code", row.commune_codes);
      if (communesError) throw new Error(communesError.message);
      const wilayaByCode = new Map(
        (communes ?? []).map((c) => [c.code, c.parent_id]),
      );
      const wilayaIds = html
        ? [
            ...new Set(
              row.commune_codes
                .map((code) => wilayaByCode.get(code))
                .filter((id): id is string => Boolean(id)),
            ),
          ]
        : [];
      // distinct chats, not distinct wilayas: several wilayas may share one
      // channel (a national channel maps every wilaya to the same chat)
      const chats = [
        ...new Set(
          wilayaIds
            .map((id) => chatByWilaya.get(id))
            .filter((chat): chat is string => Boolean(chat)),
        ),
      ];
      const delivered = chats.length
        ? await deliveryReceipts(row.id, "telegram")
        : new Set<string>();
      let failure: string | null = null;
      for (const chat of chats) {
        if (delivered.has(chat)) continue;
        await renewDelivery(row, "telegram");
        try {
          await sendTelegram(chat, html!);
        } catch (error) {
          failure =
            error instanceof Error ? error.message : "telegram send failed";
          errors.push(failure);
          continue;
        }
        sent += 1;
        await recordDelivery(row.id, "telegram", chat);
      }
      await finishDelivery(
        row,
        "telegram",
        failure === null ? chats.length : null,
        failure,
      );
      if (failure === null) rows += 1;
    } catch (error) {
      await failDelivery(row, "telegram", error, errors);
    }
  }
  return { rows, sent, channels: channels.length };
}

export async function deliverBroadcasts(): Promise<DeliveryRun> {
  // the kill-switch promise is "nothing goes out", so it gates fan-out of
  // already-published rows too, and fails closed like the publisher's gate
  const { data: settings, error: settingsError } = await supabaseAdmin
    .from("broadcast_settings")
    .select("enabled")
    .eq("id", true)
    .single();
  if (settingsError) throw new Error(settingsError.message);
  if (settings.enabled !== true) {
    return {
      rows: 0,
      sent: 0,
      telegramRows: 0,
      telegramSent: 0,
      telegramChannels: 0,
      fcmConfigured: fcmConfigured(),
      telegramConfigured: telegramConfigured(),
      disabled: true,
    };
  }

  const errors: string[] = [];
  const fcmOn = fcmConfigured();
  const telegramOn = telegramConfigured();
  const [fcm, telegram] = await Promise.all([
    fcmOn
      ? deliverFcm(errors).catch((error: unknown) => {
          errors.push(
            error instanceof Error ? error.message : "fcm delivery failed",
          );
          return { rows: 0, sent: 0 };
        })
      : Promise.resolve({ rows: 0, sent: 0 }),
    telegramOn
      ? deliverTelegram(errors).catch((error: unknown) => {
          errors.push(
            error instanceof Error ? error.message : "telegram delivery failed",
          );
          return { rows: 0, sent: 0, channels: 0 };
        })
      : Promise.resolve({ rows: 0, sent: 0, channels: 0 }),
  ]);

  if (errors.length)
    throw new Error(`${errors.length} delivery errors: ${errors[0]}`);

  return {
    rows: fcm.rows,
    sent: fcm.sent,
    telegramRows: telegram.rows,
    telegramSent: telegram.sent,
    telegramChannels: telegram.channels,
    fcmConfigured: fcmOn,
    telegramConfigured: telegramOn,
    disabled: false,
  };
}
