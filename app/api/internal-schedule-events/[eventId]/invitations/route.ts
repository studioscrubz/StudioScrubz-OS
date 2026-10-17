import { dispatchInternalEventInvitations } from "@/lib/internal-schedule/calendarInvitation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(_: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const db = await createSupabaseServerClient();
    const rpc = db as unknown as { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
    const { data: { user } } = await db.auth.getUser();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    const { eventId } = await params;
    const [{ data: access }, { data: event, error }] = await Promise.all([
      rpc.rpc("get_current_internal_schedule_access_level"),
      db.from("internal_schedule_events").select("id,organizer_user_id,status").eq("id", eventId).single(),
    ]);
    if (error || !event) return Response.json({ error: "Internal event not found." }, { status: 404 });
    if (String(access) !== "Management" && !(String(access) === "Sales" && event.organizer_user_id === user.id))
      return Response.json({ error: "You do not have permission to send invitations for this event." }, { status: 403 });
    const invitations = await dispatchInternalEventInvitations(eventId, event.status === "Scheduled");
    return Response.json({ eventId, google: { status: "Not Changed", meetUrl: null }, invitations, warning: invitations.warning });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "Invitation retry failed." }, { status: 400 });
  }
}
