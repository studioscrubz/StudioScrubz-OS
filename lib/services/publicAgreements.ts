import { getSupabaseClient } from "@/lib/supabase/client";
import { parsePublicJsonResponse } from "@/lib/services/publicJsonResponse";
import type { PublicAgreement } from "@/types/publicAgreement";

export async function getPublicAgreement(token: string): Promise<PublicAgreement> {
  if (!token) throw new Error("This agreement link is invalid.");
  const { data, error } = await getSupabaseClient().rpc("get_service_agreement_by_token", { p_token: token });
  if (error) throw new Error(error.message || "This agreement could not be loaded.");
  if (!data) throw new Error("This agreement link is invalid, expired, or no longer available.");
  return data as PublicAgreement;
}

export async function acceptPublicAgreement(token: string, signedName: string, consent: boolean): Promise<PublicAgreement> {
  const name = signedName.trim();
  if (name.length < 2) throw new Error("Enter your full legal name.");
  if (!consent) throw new Error("You must agree to the Service Agreement before signing.");
  const fallbackMessage = "The agreement could not be signed. Refresh this page to confirm its current status before trying again.";
  try {
    const response = await fetch("/api/public/agreements/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, signedName: name, consent }),
    });
    return await parsePublicJsonResponse<PublicAgreement>(response, fallbackMessage);
  } catch (apiError) {
    // The server may have committed the signature before its response failed.
    // Never send a second acceptance request until the current state is checked.
    try {
      const current = await getPublicAgreement(token);
      if (current.client_signed_at) return current;
      if (current.status !== "Sent") throw apiError;
    } catch (readError) {
      if (readError === apiError) throw apiError;
      // Without a reliable status check, do not risk submitting twice.
      throw apiError;
    }

    // Public acceptance is already authorized by the token-protected Supabase RPC.
    // This bypasses failures in the Next.js API route while retaining server-side validation.
    const { data, error } = await getSupabaseClient().rpc("accept_service_agreement_by_token", {
      p_token: token,
      p_signed_name: name,
      p_signature: `/s/ ${name}`,
      p_consent: consent,
    });
    if (error) throw new Error(error.message || fallbackMessage);
    if (!data || typeof data !== "object") throw new Error(fallbackMessage);
    return data as PublicAgreement;
  }
}
