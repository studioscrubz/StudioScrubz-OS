import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendWebPush } from "@/lib/push/server";
import { deliverDirectMessagePush, directMessagePushPayload, type MessagingDeliveryRepository } from "@/lib/push/messagingDelivery";
import type { BrowserPushSubscription } from "@/types/pushNotification";

export async function processDirectMessagePush(input: {
  recipientUserId: string;
  messageId: string;
  conversationId: string;
  senderDisplayName: string | null;
}) {
  const db = createSupabaseAdminClient();
  const { data: subscriptions, error } = await db
    .from("browser_push_subscriptions")
    .select("*")
    .eq("user_id", input.recipientUserId)
    .is("revoked_at", null);
  if (error) throw new Error("Push recipient devices could not be loaded.");
  const devices = (subscriptions ?? []) as BrowserPushSubscription[];
  if (!devices.length) return { devices: 0, sent: 0, failed: 0, duplicates: 0, revoked: 0 };
  const payload = directMessagePushPayload({ conversationId: input.conversationId, senderDisplayName: input.senderDisplayName });
  const repository = deliveryRepository(db);
  return deliverDirectMessagePush({
    recipientUserId: input.recipientUserId,
    messageId: input.messageId,
    payload,
    subscriptions: devices,
    repository,
    send: sendWebPush,
  });
}

function deliveryRepository(db: ReturnType<typeof createSupabaseAdminClient>): MessagingDeliveryRepository {
  return {
    async claim(recipientUserId, messageId, subscriptionId) {
      const { data, error } = await db.from("messaging_push_deliveries").insert({
        recipient_user_id: recipientUserId, message_id: messageId, browser_push_subscription_id: subscriptionId,
        delivery_status: "Pending", attempt_count: 1, last_attempt_at: new Date().toISOString(),
      }).select("id").single();
      if (error?.code === "23505") return null;
      if (error || !data) throw new Error("Messaging push delivery could not be claimed.");
      return { id: data.id };
    },
    async sent(id) {
      const { error } = await db.from("messaging_push_deliveries").update({ delivery_status: "Sent", sent_at: new Date().toISOString(), failure_code: null, failure_message: null }).eq("id", id);
      if (error) throw new Error("Messaging push delivery status could not be saved.");
    },
    async failed(id, code, message) {
      await db.from("messaging_push_deliveries").update({ delivery_status: "Failed", failure_code: code, failure_message: message }).eq("id", id);
    },
    async revoke(id) {
      await db.from("browser_push_subscriptions").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    },
  };
}
