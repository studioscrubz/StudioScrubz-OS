import { getSupabaseClient } from "@/lib/supabase/client";
import type { UserProfile } from "@/types/auth";
import type {
  InternalEventAccessLevel,
  InternalEventAttendeeOption,
  InternalEventInput,
  InternalEventProspectOption,
  InternalEventRsvpStatus,
  InternalScheduleEvent,
} from "@/types/internalScheduleEvent";

type LooseClient = {
  from: (table: string) => any;
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const eventSelection = `
  *,
  attendees:internal_schedule_event_attendees(
    event_id, employee_id, invitation_status, invited_at, responded_at,
    employee:employees(id, first_name, last_name, preferred_name)
  ),
  prospect:prospects(id, company_name)
`;

function client() {
  return getSupabaseClient() as unknown as LooseClient;
}
function fail(error: { message: string } | null, fallback: string) {
  if (error) throw new Error(error.message || fallback);
}

export async function getInternalEventAccessLevel(
  _profile: UserProfile | null,
): Promise<InternalEventAccessLevel> {
  const { data, error } = await client().rpc(
    "get_current_internal_schedule_access_level",
  );
  if (error) throw new Error(error.message);
  if (data === "Management" || data === "Sales" || data === "None")
    return data;
  throw new Error("Internal event authorization returned an invalid result.");
}

export async function getInternalScheduleEvents(): Promise<
  InternalScheduleEvent[]
> {
  const { data, error } = await client()
    .from("internal_schedule_events")
    .select(eventSelection)
    .order("starts_at");
  fail(error, "Internal events could not be loaded.");
  return (data ?? []) as InternalScheduleEvent[];
}

export async function getInternalEventFormOptions(
  _profile: UserProfile,
  _access: InternalEventAccessLevel,
): Promise<{
  attendees: InternalEventAttendeeOption[];
  prospects: InternalEventProspectOption[];
}> {
  const api = client();
  const [attendeesResult, prospectsResult] = await Promise.all([
    api.rpc("get_internal_schedule_attendee_options"),
    api
      .from("prospects")
      .select("id, company_name")
      .is("merged_into_prospect_id", null)
      .order("company_name")
      .limit(500),
  ]);
  fail(attendeesResult.error, "Internal event attendees could not be loaded.");
  fail(prospectsResult.error, "Prospects could not be loaded.");
  return {
    attendees: (attendeesResult.data ?? []) as InternalEventAttendeeOption[],
    prospects: (prospectsResult.data ?? []) as InternalEventProspectOption[],
  };
}

export async function createInternalScheduleEvent(
  input: InternalEventInput,
  profile: UserProfile,
): Promise<void> {
  if (!profile.employee_id)
    throw new Error("Your profile is not linked to an employee.");
  const api = client();
  const { attendee_employee_ids, ...values } = input;
  const { data, error } = await api
    .from("internal_schedule_events")
    .insert({
      ...values,
      organizer_user_id: profile.id,
      organizer_employee_id: profile.employee_id,
    })
    .select("id")
    .single();
  fail(error, "Internal event could not be created.");
  if (!attendee_employee_ids.length) return;
  const { error: attendeeError } = await api
    .from("internal_schedule_event_attendees")
    .insert(
      attendee_employee_ids.map((employee_id) => ({
        event_id: data.id,
        employee_id,
      })),
    );
  if (!attendeeError) return;
  await api.from("internal_schedule_events").delete().eq("id", data.id);
  throw new Error(
    attendeeError.message || "Event attendees could not be saved.",
  );
}

export async function updateInternalScheduleEvent(
  eventId: string,
  input: InternalEventInput,
): Promise<void> {
  const api = client();
  const { attendee_employee_ids, ...values } = input;
  const { error } = await api
    .from("internal_schedule_events")
    .update(values)
    .eq("id", eventId);
  fail(error, "Internal event could not be updated.");
  const { data: current, error: currentError } = await api
    .from("internal_schedule_event_attendees")
    .select("employee_id")
    .eq("event_id", eventId);
  fail(currentError, "Current attendees could not be loaded.");
  const previous = new Set<string>(
    (current ?? []).map((row: { employee_id: string }) => row.employee_id),
  );
  const next = new Set(attendee_employee_ids);
  const removed = [...previous].filter((id) => !next.has(id));
  const added = [...next].filter((id) => !previous.has(id));
  if (removed.length) {
    const { error: removeError } = await api
      .from("internal_schedule_event_attendees")
      .delete()
      .eq("event_id", eventId)
      .in("employee_id", removed);
    fail(removeError, "Removed attendees could not be saved.");
  }
  if (added.length) {
    const { error: addError } = await api
      .from("internal_schedule_event_attendees")
      .insert(added.map((employee_id) => ({ event_id: eventId, employee_id })));
    fail(addError, "New attendees could not be saved.");
  }
}

export async function cancelInternalScheduleEvent(
  eventId: string,
): Promise<void> {
  const { error } = await client()
    .from("internal_schedule_events")
    .update({ status: "Canceled" })
    .eq("id", eventId);
  fail(error, "Internal event could not be canceled.");
}

export async function updateInternalEventRsvp(
  eventId: string,
  employeeId: string,
  status: InternalEventRsvpStatus,
): Promise<void> {
  const { error } = await client()
    .from("internal_schedule_event_attendees")
    .update({ invitation_status: status })
    .eq("event_id", eventId)
    .eq("employee_id", employeeId);
  fail(error, "RSVP could not be updated.");
}
