import { createSupabaseServerClient } from "@/lib/supabase/server";
import { internalEventApiError, internalEventRpcArgs, synchronizeInternalEvent } from "@/lib/internal-schedule/api";

type InternalEventRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export async function POST(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json();
    const rpcClient = db as unknown as InternalEventRpcClient;
    const { data: access, error: accessError } = await rpcClient.rpc(
      "get_current_internal_schedule_access_level",
    );
    if (accessError || !["Management", "Sales"].includes(String(access)))
      return Response.json({ error: "You do not have permission to manage internal events." }, { status: 403 });
    const { data, error } = await rpcClient.rpc("save_internal_schedule_event", internalEventRpcArgs(body, null));
    if (error) throw error;
    return Response.json(await synchronizeInternalEvent((data as { id: string }).id));
  } catch (cause) {
    return internalEventApiError(cause);
  }
}
