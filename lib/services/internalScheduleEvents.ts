import { getSupabaseClient } from "@/lib/supabase/client";
import type { UserProfile } from "@/types/auth";
import type {
  InternalEventAccessLevel,
  InternalEventAttendeeOption,
  InternalEventClientOption,
  InternalEventInput,
  InternalEventMutationResult,
  InternalEventProspectOption,
  InternalEventRsvpStatus,
  InternalScheduleEvent,
} from "@/types/internalScheduleEvent";

type LooseResult = { data: unknown; error: { message: string } | null };
type LooseQuery = PromiseLike<LooseResult> & {
  select: (columns?: string) => LooseQuery;
  order: (column: string, options?: Record<string, unknown>) => LooseQuery;
  is: (column: string, value: unknown) => LooseQuery;
  limit: (count: number) => LooseQuery;
  update: (values: Record<string, unknown>) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  single: () => LooseQuery;
};
type LooseClient = {
  from: (table: string) => LooseQuery;
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
  ,client:clients(id, first_name, last_name, company_name)
  ,google_sync:internal_schedule_event_google_syncs(
    calendar_id, google_event_id, google_meet_url, sync_status, last_sync_error
  )
`;

function client() {
  return getSupabaseClient() as unknown as LooseClient;
}
function fail(error: { message: string } | null, fallback: string) {
  if (error) throw new Error(error.message || fallback);
}

export async function getInternalEventAccessLevel(): Promise<InternalEventAccessLevel> {
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
  const events = (data ?? []) as unknown as InternalScheduleEvent[];
  await Promise.all(events.map(async (event) => {
    const result = await client().rpc("get_internal_schedule_invitation_statuses", { p_event_id: event.id });
    if (result.error) return;
    const rows = (result.data ?? []) as Array<{ employee_id: string; delivery_status: InternalScheduleEvent["attendees"][number]["delivery_status"]; failure_reason: string | null }>;
    const statuses = new Map(rows.map(row => [row.employee_id, row]));
    event.attendees = event.attendees.map(attendee => ({ ...attendee, delivery_status: statuses.get(attendee.employee_id)?.delivery_status ?? null, delivery_failure_reason: statuses.get(attendee.employee_id)?.failure_reason ?? null }));
  }));
  return events;
}

export async function getInternalEventFormOptions(): Promise<{
  attendees: InternalEventAttendeeOption[];
  prospects: InternalEventProspectOption[];
  clients: InternalEventClientOption[];
}> {
  const api = client();
  const [attendeesResult, prospectsResult, clientsResult] = await Promise.all([
    api.rpc("get_internal_schedule_attendee_options"),
    api
      .from("prospects")
      .select("id, company_name, business_phone")
      .is("merged_into_prospect_id", null)
      .order("company_name")
      .limit(500),
    api
      .from("clients")
      .select("id, first_name, last_name, company_name, phone")
      .is("archived_at", null)
      .order("company_name")
      .limit(500),
  ]);
  fail(attendeesResult.error, "Internal event attendees could not be loaded.");
  fail(prospectsResult.error, "Prospects could not be loaded.");
  fail(clientsResult.error, "Clients could not be loaded.");
  return {
    attendees: (attendeesResult.data ?? []) as InternalEventAttendeeOption[],
    prospects: (prospectsResult.data ?? []) as unknown as InternalEventProspectOption[],
    clients: ((clientsResult.data ?? []) as Array<{
      id: string;
      company_name: string | null;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
    }>).map((row) => ({
      id: row.id,
      display_name:
        row.company_name?.trim() ||
        `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() ||
        "Unnamed client",
      phone: row.phone,
    })),
  };
}

export async function createInternalScheduleEvent(
  input: InternalEventInput,
  profile: UserProfile,
): Promise<InternalEventMutationResult> {
  if (!profile.employee_id && profile.role !== "Master Admin")
    throw new Error("Your profile is not linked to an employee.");
  return mutateInternalEvent("/api/internal-schedule-events", "POST", input);
}

export async function updateInternalScheduleEvent(
  eventId: string,
  input: InternalEventInput,
): Promise<InternalEventMutationResult> {
  return mutateInternalEvent(
    `/api/internal-schedule-events/${encodeURIComponent(eventId)}`,
    "PATCH",
    input,
  );
}

export async function cancelInternalScheduleEvent(
  eventId: string,
): Promise<InternalEventMutationResult> {
  return mutateInternalEvent(
    `/api/internal-schedule-events/${encodeURIComponent(eventId)}`,
    "DELETE",
  );
}

export async function retryInternalEventInvitations(eventId: string): Promise<InternalEventMutationResult> {
  return mutateInternalEvent(`/api/internal-schedule-events/${encodeURIComponent(eventId)}/invitations`, "POST");
}

async function mutateInternalEvent(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  input?: InternalEventInput,
): Promise<InternalEventMutationResult> {
  const response = await fetch(url, {
    method,
    headers: input ? { "content-type": "application/json" } : undefined,
    body: input ? JSON.stringify(input) : undefined,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("The internal event server returned an invalid response.");
  }
  if (!response.ok)
    throw new Error(
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : "The internal event operation failed.",
    );
  return body as InternalEventMutationResult;
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
