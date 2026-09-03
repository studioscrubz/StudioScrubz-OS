import type { BrowserPushSubscription } from "@/types/pushNotification";

export type MessagingPushPayload = { title: string; body: string; url: string; tag: string };
export type MessagingDeliveryClaim = { id: string } | null;
export type MessagingDeliveryRepository = {
  claim(recipientUserId: string, messageId: string, subscriptionId: string): Promise<MessagingDeliveryClaim>;
  sent(deliveryId: string): Promise<void>;
  failed(deliveryId: string, code: string | null, message: string): Promise<void>;
  revoke(subscriptionId: string): Promise<void>;
};
export type MessagingPushTransport = (subscription: BrowserPushSubscription, payload: MessagingPushPayload) => Promise<void>;

export async function deliverDirectMessagePush(input: {
  recipientUserId: string;
  messageId: string;
  payload: MessagingPushPayload;
  subscriptions: BrowserPushSubscription[];
  repository: MessagingDeliveryRepository;
  send: MessagingPushTransport;
}) {
  const subscriptions = input.subscriptions.filter((subscription) => !subscription.revoked_at);
  const result = { devices: subscriptions.length, sent: 0, failed: 0, duplicates: 0, revoked: 0 };
  for (const subscription of subscriptions) {
    let claim: MessagingDeliveryClaim;
    try { claim = await input.repository.claim(input.recipientUserId, input.messageId, subscription.id); }
    catch { result.failed += 1; continue; }
    if (!claim) { result.duplicates += 1; continue; }
    try {
      await input.send(subscription, input.payload);
      await input.repository.sent(claim.id);
      result.sent += 1;
    } catch (cause) {
      const status = pushStatus(cause); const expired = status === 404 || status === 410;
      await input.repository.failed(claim.id, status ? String(status) : null, safeFailure(cause)).catch(() => undefined);
      if (expired) { await input.repository.revoke(subscription.id).catch(() => undefined); result.revoked += 1; }
      result.failed += 1;
    }
  }
  return result;
}

export function directMessagePushPayload(input: { conversationId: string; senderDisplayName: string | null }): MessagingPushPayload {
  const name = safeSenderName(input.senderDisplayName);
  return {
    title: "StudioScrubz Message",
    body: name ? `New message from ${name}` : "You have a new Direct Message.",
    url: `/messages?conversation=${encodeURIComponent(input.conversationId)}`,
    tag: `message:${stableTag(input.conversationId)}`,
  };
}

function safeSenderName(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed && trimmed.length <= 120 ? trimmed : null;
}
function stableTag(value: string) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
function pushStatus(cause: unknown) { return cause && typeof cause === "object" && "statusCode" in cause && typeof cause.statusCode === "number" ? cause.statusCode : null; }
function safeFailure(cause: unknown) { const message = cause instanceof Error ? cause.message : "Push delivery failed."; return message.replace(/https?:\/\/\S+/g, "[endpoint]").replace(/Bearer\s+\S+/gi, "[credential]").slice(0, 500); }
