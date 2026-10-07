import type { ClientCommunication, CommunicationMetadata, CommunicationType } from "@/types/clientCommunication";

export type CommunicationsEmailInput = {
  requestId: string; recipientEmail: string; subject: string; messageBody: string; communicationType: CommunicationType;
  clientId?: string | null; propertyId?: string | null; estimateId?: string | null; proposalId?: string | null;
  agreementId?: string | null; invoiceId?: string | null; metadata?: CommunicationMetadata;
};

export async function sendCommunicationsEmail(input: CommunicationsEmailInput): Promise<ClientCommunication> {
  const response = await fetch("/api/communications/email/send", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => null) as { communication?: ClientCommunication; provider?: string; providerMessageId?: string; accepted?: boolean; error?: string } | null;
  if (!response.ok) throw new Error(result?.error || "The email could not be sent.");
  const providerMessageId = result?.providerMessageId?.trim();
  const communication = result?.communication;
  if (!communication || result?.accepted !== true || result.provider !== "resend" || !providerMessageId || communication.status !== "Sent" || communication.provider !== "resend" || communication.provider_message_id?.trim() !== providerMessageId) {
    throw new Error("Resend did not provide verifiable acceptance for this email. The message was not confirmed as sent.");
  }
  return communication;
}
