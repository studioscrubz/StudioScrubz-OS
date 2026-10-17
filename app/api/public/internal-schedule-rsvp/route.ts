import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const RESPONSES = new Set(["Accepted", "Tentative", "Declined"]);

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: unknown; response?: unknown };
    if (typeof body.token !== "string" || body.token.length < 43 || typeof body.response !== "string" || !RESPONSES.has(body.response))
      return Response.json({ error: "The invitation response is invalid." }, { status: 400 });
    const db = await createSupabaseServerClient();
    const rpc = db as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
    const { data, error } = await rpc.rpc("respond_to_internal_schedule_invitation", { p_token: body.token, p_response: body.response });
    if (error) throw error;

    // The database verifies the signed invitation token, attendee and current
    // calendar sequence before returning an event ID. Never expose event details
    // based on an unverified token or a client-supplied event ID.
    if (body.response !== "Accepted") return Response.json(data);
    const eventId = (data as { event_id?: unknown } | null)?.event_id;
    if (typeof eventId !== "string") return Response.json(data);
    const { data: event, error: eventError } = await createSupabaseAdminClient()
      .from("internal_schedule_events")
      .select("title,description,starts_at,ends_at,location,status,calendar_sequence")
      .eq("id", eventId).single();
    if (eventError || !event || event.status !== "Scheduled") return Response.json(data);
    return Response.json({
      ...data as object,
      calendar: {
        title: event.title, description: event.description,
        starts_at: event.starts_at, ends_at: event.ends_at,
        location: event.location,
      },
    });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "The RSVP could not be saved." }, { status: 400 });
  }
}
