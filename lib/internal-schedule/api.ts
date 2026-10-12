import "server-only";
import { syncInternalScheduleEventGoogle } from "@/lib/google-calendar/internal-events";

export function internalEventRpcArgs(input: Record<string, unknown>, eventId: string | null) {
  return {
    p_event_id: eventId,
    p_title: input.title,
    p_description: input.description,
    p_category: input.category,
    p_meeting_mode: input.meeting_mode,
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
    p_timezone: input.timezone,
    p_visibility: input.visibility,
    p_location: input.location,
    p_prospect_id: input.prospect_id,
    p_client_id: input.client_id,
    p_vendor_name: input.vendor_name,
    p_call_contact_name: input.call_contact_name,
    p_call_phone_number: input.call_phone_number,
    p_call_phone_extension: input.call_phone_extension,
    p_attendee_employee_ids: input.attendee_employee_ids,
  };
}

export async function synchronizeInternalEvent(eventId: string) {
  try {
    const google = await syncInternalScheduleEventGoogle(eventId);
    return { eventId, google, warning: null };
  } catch (cause) {
    return {
      eventId,
      google: { status: "Failed", meetUrl: null },
      warning: `Event saved, but Google Calendar sync failed: ${cause instanceof Error ? cause.message : "Unknown error."}`,
    };
  }
}

export function internalEventApiError(cause: unknown) {
  return Response.json(
    { error: cause instanceof Error ? cause.message : (typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string" ? cause.message : "Internal event operation failed.") },
    { status: (cause as { status?: number }).status ?? 400 },
  );
}
