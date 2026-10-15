import { parsePublicJsonResponse } from "@/lib/services/publicJsonResponse";
import type { PublicAgreement } from "@/types/publicAgreement";

export async function createInPersonSigningSession(agreementId: string): Promise<{ signingUrl: string; expiresAt: string }> {
  const response = await fetch(`/api/agreements/${encodeURIComponent(agreementId)}/in-person-signing-session`, { method: "POST" });
  return parsePublicJsonResponse(response, "The in-person signing session could not be created.");
}

export async function getInPersonSigningSession(token: string): Promise<PublicAgreement> {
  const response = await fetch(`/api/public/agreements/in-person/${encodeURIComponent(token)}`, { cache: "no-store" });
  return parsePublicJsonResponse(response, "This in-person signing session is unavailable.");
}

export async function completeInPersonSignature(input: { token: string; signedName: string; signature: string; consent: boolean; reviewed: boolean }): Promise<PublicAgreement> {
  const response = await fetch(`/api/public/agreements/in-person/${encodeURIComponent(input.token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parsePublicJsonResponse(response, "The signature could not be completed.");
}
