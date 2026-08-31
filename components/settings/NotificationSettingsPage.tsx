import { PushNotificationSetup } from "@/components/pwa/PushNotificationSetup";

export function NotificationSettingsPage() {
  return <><header className="border-b pb-7"><h1 className="text-3xl font-extrabold text-[#143d1a]">Notification Settings</h1><p className="mt-3 text-neutral-600">Choose whether this browser receives StudioScrubz Attention alerts.</p></header><PushNotificationSetup className="mt-6" /></>;
}
