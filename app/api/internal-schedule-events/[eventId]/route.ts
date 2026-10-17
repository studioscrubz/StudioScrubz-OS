import { createSupabaseServerClient } from "@/lib/supabase/server";
import { internalEventApiError, internalEventRpcArgs, synchronizeInternalEvent } from "@/lib/internal-schedule/api";

type InternalEventRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

async function authorized() {
  const db = await createSupabaseServerClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw Object.assign(new Error("Authentication required."), { status: 401 });
  const { data: access, error } = await (db as unknown as InternalEventRpcClient).rpc("get_current_internal_schedule_access_level");
  if (error || !["Management", "Sales"].includes(String(access)))
    throw Object.assign(new Error("You do not have permission to manage internal events."), { status: 403 });
  return db;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const db = await authorized();
    const { eventId } = await params;
    const body = await request.json();
    const { data, error } = await (db as unknown as InternalEventRpcClient).rpc(
      "save_internal_schedule_event",
      internalEventRpcArgs(body, eventId),
    );
    if (error) throw error;
    return Response.json(await synchronizeInternalEvent((data as { id: string }).id, body.send_calendar_invitations !== false));
  } catch (cause) {
    return internalEventApiError(cause);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const db = await authorized();
    const { eventId } = await params;
    const { data, error } = await db
      .from("internal_schedule_events")
      .update({ status: "Canceled" })
      .eq("id", eventId)
      .select("id")
      .single();
    if (error) throw error;
    return Response.json(await synchronizeInternalEvent(data.id, false));
  } catch (cause) {
    return internalEventApiError(cause);
  }
}
