import { scheduleAttentionPushAfterResponse } from "@/lib/push/postResponse";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AcceptanceRequest = { token?: string; acceptedName?: string; consent?: boolean };

export async function POST(request: Request) {
  try {
    const body = await request.json() as AcceptanceRequest;
    const { data, error } = await (await createSupabaseServerClient()).rpc("accept_proposal_by_token", {
      p_token: body.token ?? "",
      p_accepted_by_name: body.acceptedName ?? "",
      p_consent: body.consent ?? false,
    });
    if (error) throw error;
    scheduleAttentionPushAfterResponse();
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message ? error.message : "The Proposal could not be accepted." }, { status: 400 });
  }
}
