import type { AttentionItem } from "@/types/attention";
import type { BrowserPushSubscription } from "@/types/pushNotification";

export type PushPayload = { title: string; body: string; url: string; tag: string };
export type DeliveryClaim = { id: string } | null;
export type DeliveryRepository = {
  claim(userId: string, attentionKey: string, subscriptionId: string): Promise<DeliveryClaim>;
  sent(deliveryId: string): Promise<void>;
  failed(deliveryId: string, code: string | null, message: string): Promise<void>;
  revoke(subscriptionId: string): Promise<void>;
};
export type PushTransport = (subscription: BrowserPushSubscription, payload: PushPayload) => Promise<void>;

export async function deliverAttentionPushes(input: {
  userId: string;
  items: AttentionItem[];
  subscriptions: BrowserPushSubscription[];
  repository: DeliveryRepository;
  send: PushTransport;
}) {
  const items = input.items.filter(isPushActionable);
  const subscriptions = input.subscriptions.filter((subscription) => !subscription.revoked_at);
  const result = { candidates: items.length, devices: subscriptions.length, sent: 0, failed: 0, duplicates: 0, revoked: 0 };
  for (const item of items) {
    const payload = attentionPushPayload(item);
    for (const subscription of subscriptions) {
      let claim: DeliveryClaim;
      try { claim = await input.repository.claim(input.userId, item.id, subscription.id); }
      catch { result.failed += 1; continue; }
      if (!claim) { result.duplicates += 1; continue; }
      try {
        await input.send(subscription, payload);
        await input.repository.sent(claim.id);
        result.sent += 1;
      } catch (cause) {
        const status = pushStatus(cause); const expired = status === 404 || status === 410;
        await input.repository.failed(claim.id, status ? String(status) : null, safeFailure(cause)).catch(() => undefined);
        if (expired) { await input.repository.revoke(subscription.id).catch(() => undefined); result.revoked += 1; }
        result.failed += 1;
      }
    }
  }
  return result;
}

export function isPushActionable(item: AttentionItem) {
  return !item.attention_state && (item.severity !== "Info" || Boolean(item.communication_context || item.sms_action || item.resolution_label));
}

export function attentionPushPayload(item: AttentionItem): PushPayload {
  return { title: "StudioScrubz Attention", body: pushBody(item), url: safeAttentionUrl(item.action_url), tag: `attention:${stableTag(item.id)}` };
}

export function safeAttentionUrl(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/attention";
  try { const url = new URL(value, "https://studioscrubz.invalid"); return url.origin === "https://studioscrubz.invalid" ? `${url.pathname}${url.search}${url.hash}` : "/attention"; }
  catch { return "/attention"; }
}

function pushBody(item: AttentionItem) {
  if (item.type === "Overdue Invoice") return `${item.entity_label ? `Invoice #${item.entity_label}` : "An invoice"} is overdue.`;
  if (item.type === "Review Request Ready") return `Review request ready${item.description ? ` for ${item.description.split("—")[0].trim()}` : ""}.`;
  return `${item.title}${item.entity_label ? ` — ${item.entity_label}` : ""}.`;
}
function stableTag(value: string) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
function pushStatus(cause: unknown) { return cause && typeof cause === "object" && "statusCode" in cause && typeof cause.statusCode === "number" ? cause.statusCode : null; }
function safeFailure(cause: unknown) { const message = cause instanceof Error ? cause.message : "Push delivery failed."; return message.replace(/https?:\/\/\S+/g, "[endpoint]").replace(/Bearer\s+\S+/gi, "[credential]").slice(0, 500); }
