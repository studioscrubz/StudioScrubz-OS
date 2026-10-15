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

export async function acceptPublicAgreement(token: string, signedName: string, signature: string, consent: boolean, reviewed: boolean): Promise<PublicAgreement> {
  const name = signedName.trim();
  if (name.length < 2) throw new Error("Enter your full legal name.");
  if (!consent) throw new Error("You must agree to the Service Agreement before signing.");
  if (!reviewed) throw new Error("Review the complete Service Agreement before signing.");
  if (!signature) throw new Error("Draw your signature before completing the Agreement.");
  const fallbackMessage = "The agreement could not be signed. Refresh this page to confirm its current status before trying again.";
  const response = await fetch("/api/public/agreements/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, signedName: name, signature, consent, reviewed }),
  });
  return parsePublicJsonResponse<PublicAgreement>(response, fallbackMessage);
}
