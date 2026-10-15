import { scheduleAttentionPushAfterResponse } from "@/lib/push/postResponse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PublicAgreement } from "@/types/publicAgreement";
import { validateDrawnPngSignature } from "@/lib/signatures/drawnSignature";

export const runtime = "nodejs";

type InPersonRpc = {
  rpc(name: "get_in_person_agreement_signing_session", args: { p_token: string }): PromiseLike<{ data: PublicAgreement | null; error: { message: string } | null }>;
  rpc(name: "complete_in_person_agreement_signature", args: {
    p_token: string;
    p_signed_name: string;
    p_signature: string;
    p_consent: boolean;
    p_reviewed: boolean;
  }): PromiseLike<{ data: PublicAgreement | null; error: { message: string } | null }>;
};

export async function GET(_request: Request, context: RouteContext<"/api/public/agreements/in-person/[token]">) {
  try {
    const { token } = await context.params;
    const { data, error } = await (await createSupabaseServerClient() as unknown as InPersonRpc).rpc("get_in_person_agreement_signing_session", { p_token: token });
    if (error || !data) throw new Error(error?.message || "This signing session is unavailable.");
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "This signing session is unavailable." }, { status: 400 });
  }
}
export async function POST(request: Request, context: RouteContext<"/api/public/agreements/in-person/[token]">) {
  try {
    const { token } = await context.params;
    const body = await request.json() as { signedName?: string; signature?: string; consent?: boolean; reviewed?: boolean };
    const signature = body.signature ?? "";
    await validateDrawnPngSignature(signature);
    const validation = await createSupabaseAdminClient().rpc("register_validated_agreement_signature", {
      p_token: token,
      p_signature: signature,
      p_signing_context: "in_person_digital",
    });
    if (validation.error) throw validation.error;
    const { data, error } = await (await createSupabaseServerClient() as unknown as InPersonRpc).rpc("complete_in_person_agreement_signature", {
      p_token: token,
      p_signed_name: body.signedName ?? "",
      p_signature: signature,
      p_consent: body.consent === true,
      p_reviewed: body.reviewed === true,
    });
    if (error || !data) throw new Error(error?.message || "The signature could not be completed.");
    const response = Response.json(data, { headers: { "Cache-Control": "no-store" } });
    scheduleAttentionPushAfterResponse();
    return response;
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "The signature could not be completed." }, { status: 400 });
  }
}
