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
