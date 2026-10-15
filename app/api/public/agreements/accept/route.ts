import { scheduleAttentionPushAfterResponse } from "@/lib/push/postResponse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateDrawnPngSignature } from "@/lib/signatures/drawnSignature";

type AcceptanceRequest = { token?: string; signedName?: string; signature?: string; consent?: boolean; reviewed?: boolean };

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as AcceptanceRequest;
    const name = body.signedName ?? "";
    const signature = body.signature ?? "";
    await validateDrawnPngSignature(signature);
    const validation = await createSupabaseAdminClient().rpc("register_validated_agreement_signature", {
      p_token: body.token ?? "",
      p_signature: signature,
      p_signing_context: "electronic",
    });
    if (validation.error) throw validation.error;
    const { data, error } = await (await createSupabaseServerClient()).rpc("accept_service_agreement_by_token", {
      p_token: body.token ?? "",
      p_signed_name: name,
      p_signature: signature,
      p_consent: body.consent ?? false,
      p_reviewed: body.reviewed ?? false,
    });
    if (error) throw error;
    if (!data || typeof data !== "object") {
      throw new Error("The signed agreement could not be reloaded.");
    }
    const response = Response.json(data);
    scheduleAttentionPushAfterResponse();
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message ? error.message : "The agreement could not be signed." }, { status: 400 });
  }
}
