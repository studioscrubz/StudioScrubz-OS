import { getSupabaseClient } from "@/lib/supabase/client";
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
  const response = await fetch("/api/public/agreements/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, signedName: name, consent }),
  });
  const result = await response.json() as PublicAgreement & { error?: string };
  if (!response.ok) throw new Error(result.error || "The agreement could not be signed.");
  return result;
}
