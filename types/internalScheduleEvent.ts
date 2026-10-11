export const INTERNAL_EVENT_CATEGORIES = [
  "Vendor",
  "Sales",
  "Administrative",
  "Other",
] as const;
export const INTERNAL_EVENT_MODES = ["In Person", "Video Meeting", "Phone Call"] as const;
export const INTERNAL_EVENT_LEGACY_MODES = ["Phone", "Video"] as const;
export const INTERNAL_EVENT_VISIBILITIES = [
  "Authorized attendees only",
  "Company-wide",
  "Management only",
] as const;
export const INTERNAL_EVENT_RSVP_STATUSES = [
  "Invited",
  "Accepted",
  "Declined",
  "Tentative",
] as const;

export type InternalEventCategory = (typeof INTERNAL_EVENT_CATEGORIES)[number];
export type InternalEventMode =
  | (typeof INTERNAL_EVENT_MODES)[number]
  | (typeof INTERNAL_EVENT_LEGACY_MODES)[number];
export type InternalEventVisibility =
  (typeof INTERNAL_EVENT_VISIBILITIES)[number];
export type InternalEventRsvpStatus =
  (typeof INTERNAL_EVENT_RSVP_STATUSES)[number];
export type InternalEventStatus = "Scheduled" | "Canceled";
export type InternalEventAccessLevel = "Management" | "Sales" | "None";

export type InternalEventAttendee = {
  event_id: string;
  employee_id: string;
  invitation_status: InternalEventRsvpStatus;
  invited_at: string;
  responded_at: string | null;
  employee: {
    id: string;
    first_name: string;
    last_name: string;
    preferred_name: string | null;
  } | null;
};

export type InternalScheduleEvent = {
  id: string;
  title: string;
  description: string | null;
  category: InternalEventCategory;
  meeting_mode: InternalEventMode;
  starts_at: string;
  ends_at: string;
  timezone: string;
  organizer_user_id: string;
  organizer_employee_id: string | null;
  visibility: InternalEventVisibility;
  location: string | null;
  video_link: string | null;
  prospect_id: string | null;
  client_id: string | null;
  vendor_name: string | null;
  call_contact_name: string | null;
  call_phone_number: string | null;
  call_phone_extension: string | null;
  status: InternalEventStatus;
  created_at: string;
  updated_at: string;
  attendees: InternalEventAttendee[];
  prospect: { id: string; company_name: string } | null;
  client: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
  } | null;
  google_sync: {
    calendar_id: string | null;
    google_event_id: string | null;
    google_meet_url: string | null;
    sync_status: "Pending" | "Synced" | "Failed" | "Canceled" | "Not Required";
    last_sync_error: string | null;
  } | null;
};

export type InternalEventInput = Pick<
  InternalScheduleEvent,
  | "title"
  | "description"
  | "category"
  | "meeting_mode"
  | "starts_at"
  | "ends_at"
  | "timezone"
  | "visibility"
  | "location"
  | "prospect_id"
  | "client_id"
  | "vendor_name"
  | "call_contact_name"
  | "call_phone_number"
  | "call_phone_extension"
> & {
  attendee_employee_ids: string[];
};

export type InternalEventAttendeeOption = { id: string; display_name: string };
export type InternalEventProspectOption = { id: string; company_name: string; business_phone: string | null };
export type InternalEventClientOption = {
  id: string;
  display_name: string;
  phone: string | null;
};
export type InternalEventMutationResult = {
  eventId: string;
  google: { status: string; meetUrl: string | null };
  warning: string | null;
};
