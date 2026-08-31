"use client";
import { useEffect, useState } from "react";
import { getPushSetupState, sendTestNotificationToCurrentBrowser, subscribeCurrentBrowserToPush, unsubscribeCurrentBrowserFromPush } from "@/lib/services/pushNotifications";
import type { PushSetupState } from "@/types/pushNotification";

const copy: Record<PushSetupState, { title: string; detail: string }> = {
  unsupported: { title: "Push notifications unsupported", detail: "This browser or device does not support web push notifications." },
  "not-granted": { title: "Push notifications not enabled", detail: "Enable notifications to receive StudioScrubz Attention alerts on this browser." },
  enabled: { title: "Push notifications enabled", detail: "This browser is subscribed to StudioScrubz Attention alerts." },
  denied: { title: "Push notifications blocked", detail: "Notifications are blocked. Change this site's notification permission in your browser settings." },
};

export function PushNotificationSetup({ className = "" }: { className?: string }) {
  const [state, setState] = useState<PushSetupState | null>(null); const [busy, setBusy] = useState<"enable" | "disable" | "test" | null>(null); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  async function refresh() { setState(await getPushSetupState()); }
  useEffect(() => { let active = true; void getPushSetupState().then((next) => { if (active) setState(next); }).catch((cause) => { console.error("Push notification status failed", cause); if (active) { setState("unsupported"); setError("Notification status could not be checked."); } }); return () => { active = false; }; }, []);
  function clearMessage() { setError(null); setNotice(null); }
  async function enable() { setBusy("enable"); clearMessage(); try { await subscribeCurrentBrowserToPush(); await refresh(); } catch (cause) { setError(message(cause)); await refresh().catch(() => undefined); } finally { setBusy(null); } }
  async function disable() { setBusy("disable"); clearMessage(); try { await unsubscribeCurrentBrowserFromPush(); await refresh(); } catch (cause) { setError(message(cause)); } finally { setBusy(null); } }
  async function test() { setBusy("test"); clearMessage(); try { await sendTestNotificationToCurrentBrowser(); setNotice("Test notification sent to this device."); } catch (cause) { setError(message(cause)); } finally { setBusy(null); } }
  const current = state ? copy[state] : { title: "Checking notifications…", detail: "Checking this browser's notification capability." };
  return <section className={`rounded-2xl border bg-white p-5 ${className}`} aria-live="polite"><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-extrabold text-[#143d1a]">{current.title}</h3><p className="mt-1 text-sm text-neutral-600">{current.detail}</p></div><div className="flex flex-wrap gap-2">{state === "not-granted" && <button type="button" disabled={Boolean(busy)} onClick={() => void enable()} className="rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy === "enable" ? "Enabling…" : "Enable Notifications"}</button>}{state === "enabled" && <><button type="button" disabled={Boolean(busy)} onClick={() => void test()} className="rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy === "test" ? "Sending…" : "Send Test Notification"}</button><button type="button" disabled={Boolean(busy)} onClick={() => void disable()} className="rounded-lg border border-[#143d1a]/20 px-4 py-2.5 text-sm font-bold text-[#143d1a] disabled:opacity-50">{busy === "disable" ? "Disabling…" : "Disable Notifications"}</button></>}</div></div>{notice && <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}{error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}</section>;
}
function message(cause: unknown) { return cause instanceof Error && cause.message.trim() ? cause.message : "Notification settings could not be updated."; }
