import { getSupabaseClient } from "@/lib/supabase/client";
import type { BrowserPushSubscription, PushSetupState } from "@/types/pushNotification";

const SERVICE_WORKER_URL = "/sw.js";
const PUBLIC_VAPID_KEY = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;

export function isBrowserPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function getNotificationPermissionState(): NotificationPermission | "unsupported" {
  return isBrowserPushSupported() ? Notification.permission : "unsupported";
}

export async function registerStudioScrubzServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) throw new Error("Service workers are not supported by this browser.");
  return navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" });
}

export async function getPushSetupState(): Promise<PushSetupState> {
  if (!isBrowserPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return Notification.permission === "granted" && subscription ? "enabled" : "not-granted";
}

export async function subscribeCurrentBrowserToPush(): Promise<BrowserPushSubscription> {
  if (!isBrowserPushSupported()) throw new Error("Push notifications are not supported by this browser.");
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked in this browser." : "Notification permission was not granted.");
  if (!PUBLIC_VAPID_KEY) throw new Error("Push notifications are not configured. Add the public VAPID key.");
  const registration = await registerStudioScrubzServiceWorker();
  const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY) });
  return savePushSubscription(subscription);
}

export async function savePushSubscription(subscription: PushSubscription): Promise<BrowserPushSubscription> {
  const client = getSupabaseClient();
  const { data: userResult, error: userError } = await client.auth.getUser();
  if (userError || !userResult.user) throw new Error("An authenticated StudioScrubz user is required to save notifications.");
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh; const auth = json.keys?.auth;
  if (!subscription.endpoint || !p256dh || !auth) throw new Error("The browser returned an incomplete push subscription.");
  const { data, error } = await client.from("browser_push_subscriptions").upsert({
    user_id: userResult.user.id, endpoint: subscription.endpoint, p256dh, auth,
    user_agent: typeof navigator === "undefined" ? null : navigator.userAgent, revoked_at: null,
  }, { onConflict: "endpoint" }).select().single();
  if (error) throw new Error(safeMessage(error, "Push subscription could not be saved."));
  return data;
}

export async function unsubscribeCurrentBrowserFromPush(): Promise<void> {
  if (!isBrowserPushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const { error } = await getSupabaseClient().from("browser_push_subscriptions")
    .update({ revoked_at: new Date().toISOString() }).eq("endpoint", subscription.endpoint);
  if (error) throw new Error(safeMessage(error, "Push subscription could not be revoked."));
  await subscription.unsubscribe();
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64); const result = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) result[index] = bytes.charCodeAt(index);
  return result;
}
function safeMessage(cause: unknown, fallback: string) { const detail = cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" ? cause.message.trim() : ""; return detail && !/jwt|token|secret|authorization header|service[_ -]?role/i.test(detail) ? detail : fallback; }
