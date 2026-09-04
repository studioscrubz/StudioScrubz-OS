import type { AttentionCategory } from "@/types/attention";

export type NotificationPreferences = {
  user_id: string;
  disabled_attention_categories: AttentionCategory[];
  direct_messages_enabled: boolean;
  announcements_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type NotificationPreferencesInput = Pick<NotificationPreferences, "disabled_attention_categories" | "direct_messages_enabled" | "announcements_enabled">;
