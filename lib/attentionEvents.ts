"use client";

export const ATTENTION_REFRESH_EVENT = "studioscrubz:attention-refresh";

export function notifyAttentionRefresh(): void {
  window.dispatchEvent(new Event(ATTENTION_REFRESH_EVENT));
}
