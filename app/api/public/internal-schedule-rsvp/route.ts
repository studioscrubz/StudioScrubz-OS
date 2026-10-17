import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    return Response.json(data);
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "The RSVP could not be saved." }, { status: 400 });
  }
}
