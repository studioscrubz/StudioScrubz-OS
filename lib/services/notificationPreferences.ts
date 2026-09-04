import { getSupabaseClient } from "@/lib/supabase/client";
import type { NotificationPreferences, NotificationPreferencesInput } from "@/types/notificationPreferences";

export async function getNotificationPreferences(): Promise<NotificationPreferencesInput> {
  const client = getSupabaseClient();
  const { data: userResult, error: userError } = await client.auth.getUser();
  if (userError || !userResult.user) throw new Error("An authenticated user is required to load notification preferences.");
  const { data, error } = await client.from("notification_preferences").select("*").eq("user_id", userResult.user.id).maybeSingle();
  if (error) throw new Error("Notification preferences could not be loaded.");
  if (!data) return { disabled_attention_categories: [], direct_messages_enabled: true, announcements_enabled: true };
  const preferences = data as NotificationPreferences;
  return { disabled_attention_categories: preferences.disabled_attention_categories, direct_messages_enabled: preferences.direct_messages_enabled, announcements_enabled: preferences.announcements_enabled };
}

export async function saveNotificationPreferences(input: NotificationPreferencesInput): Promise<NotificationPreferencesInput> {
  const client = getSupabaseClient();
  const { data: userResult, error: userError } = await client.auth.getUser();
  if (userError || !userResult.user) throw new Error("An authenticated user is required to save notification preferences.");
  const { data, error } = await client.from("notification_preferences").upsert({ user_id: userResult.user.id, ...input }, { onConflict: "user_id" }).select("*").single();
  if (error || !data) throw new Error("Notification preferences could not be saved.");
  const preferences = data as NotificationPreferences;
  return { disabled_attention_categories: preferences.disabled_attention_categories, direct_messages_enabled: preferences.direct_messages_enabled, announcements_enabled: preferences.announcements_enabled };
}
