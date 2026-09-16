export const PORTER_NOTIFICATION_TYPES = [
  "visit_assignment",
  "visit_assignment_removed",
  "visit_schedule_changed",
  "visit_reminder_24h",
  "visit_reminder_1h",
  "visit_missed_start",
  "route_changed",
] as const;

export type PorterNotificationType = (typeof PORTER_NOTIFICATION_TYPES)[number];

export type PorterNotificationEvent = {
  id: string;
  recipient_user_id: string;
  recipient_employee_id: string | null;
  recipient_context: "Worker" | "Manager" | "Management Escalation" | "Removed Worker" | "Removed Manager";
  event_type: PorterNotificationType;
  visit_id: string | null;
  route_id: string | null;
  notification_revision: number;
  title: string;
  description: string;
  severity: "Info" | "Attention" | "Urgent";
  action_url: string;
  action_label: string;
  scheduled_date: string | null;
  available_at: string;
  expires_at: string | null;
  cancelled_at: string | null;
  dedupe_key: string;
  created_at: string;
};
