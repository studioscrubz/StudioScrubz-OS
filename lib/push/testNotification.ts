import type { BrowserPushSubscription } from "@/types/pushNotification";
import type { PushPayload } from "@/lib/push/delivery";

export const TEST_PUSH_PAYLOAD: PushPayload = { title: "StudioScrubz Test", body: "Push notifications are working on this device.", url: "/settings/notifications", tag: "studioscrubz-push-test" };
export class TestPushError extends Error { readonly status: number; constructor(message: string, status: number) { super(message); this.status = status; } }

export async function sendVerifiedTestNotification(input: { userId: string | null; endpoint: string; loadSubscription: (userId: string, endpoint: string) => Promise<BrowserPushSubscription | null>; send: (subscription: BrowserPushSubscription, payload: PushPayload) => Promise<void>; revoke: (subscriptionId: string) => Promise<void>; failureStatus: (cause: unknown) => number | null }) {
  if (!input.userId) throw new TestPushError("Authentication required.", 401);
  if (!input.endpoint || input.endpoint.length > 4096) throw new TestPushError("The current browser subscription is required.", 400);
  const subscription = await input.loadSubscription(input.userId, input.endpoint);
  if (!subscription || subscription.user_id !== input.userId) throw new TestPushError("Active push subscription not found for this device.", 404);
  if (subscription.revoked_at) throw new TestPushError("Push notifications are disabled for this device.", 409);
  try { await input.send(subscription, TEST_PUSH_PAYLOAD); }
  catch (cause) { const status = input.failureStatus(cause); if (status === 404 || status === 410) await input.revoke(subscription.id).catch(() => undefined); throw new TestPushError(status === 404 || status === 410 ? "This browser subscription expired. Enable notifications again." : "Test notification could not be sent.", 502); }
}
