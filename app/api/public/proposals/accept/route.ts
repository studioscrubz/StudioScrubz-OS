import { scheduleAttentionPushAfterResponse } from "@/lib/push/postResponse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validateDrawnPngSignature } from "@/lib/signatures/drawnSignature";
import { schedulePostConstructionDepositInstructionsAfterResponse } from "@/lib/email/postConstructionDeposit";

type AcceptanceRequest = { token?: string; acceptedName?: string; consent?: boolean; signature?: string };

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as AcceptanceRequest;
    const signature = body.signature ?? "";
    await validateDrawnPngSignature(signature);
    const { data, error } = await createSupabaseAdminClient().rpc("accept_proposal_by_token", {
      p_token: body.token ?? "",
      p_accepted_by_name: body.acceptedName ?? "",
      p_consent: body.consent ?? false,
      p_signature: signature,
    });
    if (error) throw error;
    schedulePostConstructionDepositInstructionsAfterResponse({ proposalToken: body.token });
    scheduleAttentionPushAfterResponse();
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message ? error.message : "The Proposal could not be accepted." }, { status: 400 });
  }
}
