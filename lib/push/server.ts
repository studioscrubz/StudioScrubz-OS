import "server-only";
import webPush from "web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { attentionItemsForProfile, loadAttentionServerSnapshot } from "@/lib/attention/server";
import { deliverAttentionPushes, isPushActionable, type DeliveryRepository, type PushPayload } from "@/lib/push/delivery";
import type { UserProfile } from "@/types/auth";
import type { BrowserPushSubscription } from "@/types/pushNotification";

export async function processAttentionPushes() {
  const db = createSupabaseAdminClient();
  const [{ data: profiles, error: profileError }, { data: subscriptions, error: subscriptionError }, { data: checkpoints, error: checkpointError }, { data: preferences, error: preferenceError }, snapshot] = await Promise.all([
    db.from("user_profiles").select("*").eq("is_active", true),
    db.from("browser_push_subscriptions").select("*").is("revoked_at", null),
    db.from("attention_push_checkpoints").select("browser_push_subscription_id"),
    db.from("notification_preferences").select("user_id,disabled_attention_categories"),
    loadAttentionServerSnapshot(db),
  ]);
  if (profileError || subscriptionError || checkpointError || preferenceError) throw new Error("Push recipients could not be loaded.");
  const activeSubscriptions = (subscriptions ?? []) as BrowserPushSubscription[];
  const initialized = new Set((checkpoints ?? []).map((row) => row.browser_push_subscription_id));
  const totals = { users: 0, candidates: 0, sent: 0, failed: 0, duplicates: 0, revoked: 0 };
  const repository = deliveryRepository(db);
  const disabledByUser = new Map((preferences ?? []).map((row) => [row.user_id, new Set(row.disabled_attention_categories)]));
  for (const profile of (profiles ?? []) as UserProfile[]) {
    const allDevices = activeSubscriptions.filter((subscription) => subscription.user_id === profile.id);
    if (!allDevices.length) continue;
    totals.users += 1;
    try {
      const disabled = disabledByUser.get(profile.id);
      const items = attentionItemsForProfile(profile, snapshot).filter((item) => !disabled?.has(item.category));
      const newDevices = allDevices.filter((subscription) => !initialized.has(subscription.id));
      if (newDevices.length) await initializeDevices(db, profile.id, items, newDevices);
      const devices = allDevices.filter((subscription) => initialized.has(subscription.id));
      if (!devices.length) continue;
      const result = await deliverAttentionPushes({ userId: profile.id, items, subscriptions: devices, repository, send: sendWebPush });
      for (const key of ["candidates", "sent", "failed", "duplicates", "revoked"] as const) totals[key] += result[key];
    } catch (cause) { totals.failed += 1; console.error("Attention push user processing failed", safeServerError(cause)); }
  }
  return totals;
}

async function initializeDevices(db: ReturnType<typeof createSupabaseAdminClient>, userId: string, items: ReturnType<typeof attentionItemsForProfile>, devices: BrowserPushSubscription[]) {
  const actionable = items.filter(isPushActionable);
  const deliveries = devices.flatMap((device) => actionable.map((item) => ({ user_id: userId, attention_key: item.id, browser_push_subscription_id: device.id, delivery_status: "Suppressed" as const, attempt_count: 1, last_attempt_at: new Date().toISOString() })));
  if (deliveries.length) { const { error } = await db.from("attention_push_deliveries").upsert(deliveries, { onConflict: "user_id,attention_key,browser_push_subscription_id", ignoreDuplicates: true }); if (error) throw new Error("Push subscription baseline could not be saved."); }
  const { error } = await db.from("attention_push_checkpoints").upsert(devices.map((device) => ({ browser_push_subscription_id: device.id, user_id: userId })), { onConflict: "browser_push_subscription_id", ignoreDuplicates: true });
  if (error) throw new Error("Push subscription baseline could not be completed.");
}

export async function sendWebPush(subscription: BrowserPushSubscription, payload: PushPayload) {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) throw new Error("Web Push server configuration is incomplete.");
  webPush.setVapidDetails(subject, publicKey, privateKey);
  await webPush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), { TTL: 3600 });
}

export function webPushStatus(cause: unknown) {
  return cause && typeof cause === "object" && "statusCode" in cause && typeof cause.statusCode === "number" ? cause.statusCode : null;
}

function deliveryRepository(db: ReturnType<typeof createSupabaseAdminClient>): DeliveryRepository {
  return {
    async claim(userId, attentionKey, subscriptionId) {
      const { data, error } = await db.from("attention_push_deliveries").insert({ user_id: userId, attention_key: attentionKey, browser_push_subscription_id: subscriptionId, delivery_status: "Pending", attempt_count: 1, last_attempt_at: new Date().toISOString() }).select("id").single();
      if (error?.code === "23505") return null;
      if (error || !data) throw new Error("Push delivery could not be claimed.");
      return { id: data.id };
    },
    async sent(id) { const { error } = await db.from("attention_push_deliveries").update({ delivery_status: "Sent", sent_at: new Date().toISOString(), failure_code: null, failure_message: null }).eq("id", id); if (error) throw new Error("Push delivery status could not be saved."); },
    async failed(id, code, message) { await db.from("attention_push_deliveries").update({ delivery_status: "Failed", failure_code: code, failure_message: message }).eq("id", id); },
    async revoke(id) { await db.from("browser_push_subscriptions").update({ revoked_at: new Date().toISOString() }).eq("id", id); },
  };
}

function safeServerError(cause: unknown) { return cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/g, "[endpoint]").slice(0, 300) : "Push processing failed."; }
