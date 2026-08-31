export type BrowserPushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export type PushSetupState = "unsupported" | "not-granted" | "enabled" | "denied";

export type AttentionPushDelivery = {
  id: string; user_id: string; attention_key: string; browser_push_subscription_id: string;
  delivery_status: "Pending" | "Sent" | "Failed" | "Suppressed"; attempt_count: number; last_attempt_at: string;
  sent_at: string | null; failure_code: string | null; failure_message: string | null;
  created_at: string; updated_at: string;
};

export type AttentionPushCheckpoint = { browser_push_subscription_id: string; user_id: string; initialized_at: string };
