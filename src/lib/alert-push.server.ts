import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fcmMessageForAlert } from "@/lib/fcm";
import { fcmConfigured, fcmSend } from "@/lib/ingest/fcm.server";
import { pushReceipt } from "@/lib/push-receipt.server";

export type ClaimedPush = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  source_id: string | null;
  cluster_id: string | null;
  payload: unknown;
  push_attempts: number;
  push_claimed_at: string;
  severity?: number | null;
  zone_id?: string | null;
  source_table?: string | null;
  created_at?: string | null;
};

type PushState = "sent" | "pending" | "failed" | "no_device" | "skipped";

const MAX_ATTEMPTS = 5;
const CLAIM_LOST = "alert push claim lost";
const DEVICE_TTL_MS = 60 * 86_400_000;

const store = {
  configured: fcmConfigured,
  claim: async (): Promise<ClaimedPush[]> => {
    const { data, error } = await supabaseAdmin.rpc("claim_alert_pushes", {
      _limit: 50,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as ClaimedPush[];
  },
  withdrawnPushConsent: async (userIds: string[]): Promise<Set<string>> => {
    if (!userIds.length) return new Set();
    const { data, error } = await supabaseAdmin
      .from("privacy_consents")
      .select("user_id")
      .in("user_id", userIds)
      .eq("consent_type", "push_alerts")
      .eq("status", "withdrawn");
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((row) => row.user_id));
  },
  devices: async (userIds: string[]): Promise<Set<string>> => {
    if (!userIds.length) return new Set();
    const { data, error } = await supabaseAdmin
      .from("user_push_devices")
      .select("user_id")
      .in("user_id", userIds)
      .gt("updated_at", new Date(Date.now() - DEVICE_TTL_MS).toISOString());
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((row) => row.user_id));
  },
  send: async (row: ClaimedPush) =>
    fcmSend(fcmMessageForAlert(row, await pushReceipt(row.id))),
  finish: async (row: ClaimedPush, state: PushState) => {
    const { data, error } = await supabaseAdmin
      .from("alerts")
      .update({ push_state: state })
      .eq("id", row.id)
      .eq("push_claimed_at", row.push_claimed_at)
      .select("id");
    if (error) throw new Error(error.message);
    // another run reclaimed this alert after our claim went stale
    if (!data?.length) throw new Error(CLAIM_LOST);
  },
};

export async function drainAlertPushes(
  dependencies: Partial<typeof store> = {},
) {
  const deps = { ...store, ...dependencies };
  if (!deps.configured())
    return {
      pushed: 0,
      pushFailed: 0,
      noDevice: 0,
      consentWithdrawn: 0,
      claimsLost: 0,
    };
  let pushed = 0;
  let pushFailed = 0;
  let noDevice = 0;
  let consentWithdrawn = 0;
  let claimsLost = 0;
  const rows = await deps.claim();
  if (!rows.length) {
    return { pushed, pushFailed, noDevice, consentWithdrawn, claimsLost };
  }
  const uniqueUserIds = [...new Set(rows.map((row) => row.user_id))];
  // Fail-closed defense-in-depth (Law 18-07 / Law 25-11): check push_alerts
  // consent withdrawal before querying devices or sending any FCM payload.
  const withdrawn = await deps.withdrawnPushConsent(uniqueUserIds);
  const eligibleUserIds = uniqueUserIds.filter((uid) => !withdrawn.has(uid));
  const reachable = eligibleUserIds.length
    ? await deps.devices(eligibleUserIds)
    : new Set<string>();
  for (const row of rows) {
    let state: PushState = "sent";
    if (withdrawn.has(row.user_id)) state = "skipped";
    else if (!reachable.has(row.user_id)) state = "no_device";
    else {
      try {
        await deps.send(row);
      } catch {
        pushFailed++;
        state = row.push_attempts >= MAX_ATTEMPTS ? "failed" : "pending";
      }
    }
    try {
      await deps.finish(row, state);
      if (state === "sent") pushed++;
      if (state === "no_device") noDevice++;
      if (state === "skipped") consentWithdrawn++;
    } catch (failure) {
      if (!(failure instanceof Error && failure.message === CLAIM_LOST))
        throw failure;
      claimsLost++;
    }
  }
  return { pushed, pushFailed, noDevice, consentWithdrawn, claimsLost };
}
