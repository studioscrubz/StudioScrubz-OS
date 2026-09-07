import type { AttentionItem } from "@/types/attention";

export function actionableAttentionCount(items: AttentionItem[]): number {
  return items.filter(item => !item.attention_state && (item.severity === "Attention" || item.severity === "Urgent")).length;
}

let revision = 0;
let pending = Promise.resolve();
export function beginAppBadgeSync(): number { return ++revision; }

export function setAppNotificationBadge(count: number, request = beginAppBadgeSync()): Promise<void> {
  pending = pending.then(async () => {
    if (request !== revision || typeof navigator === "undefined") return;
    if (count > 0) {
      if ("setAppBadge" in navigator) await navigator.setAppBadge(count);
    } else if ("clearAppBadge" in navigator) await navigator.clearAppBadge();
  }).catch(() => { /* Badging must never interrupt the app. */ });
  return pending;
}

export function clearAppNotificationBadge(): Promise<void> {
  return setAppNotificationBadge(0);
}
