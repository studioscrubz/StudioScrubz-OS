import { scheduleAttentionPushAfterResponse } from "@/lib/push/postResponse";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AcceptanceRequest = { token?: string; signedName?: string; consent?: boolean };

export async function POST(request: Request) {
  try {
    const body = await request.json() as AcceptanceRequest;
    const name = body.signedName ?? "";
    const { data, error } = await (await createSupabaseServerClient()).rpc("accept_service_agreement_by_token", {
      p_token: body.token ?? "",
      p_signed_name: name,
      p_signature: `/s/ ${name}`,
      p_consent: body.consent ?? false,
    });
    if (error) throw error;
    scheduleAttentionPushAfterResponse();
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message ? error.message : "The agreement could not be signed." }, { status: 400 });
  }
}
