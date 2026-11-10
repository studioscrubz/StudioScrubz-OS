export type TransactionalDocumentType = "Estimate" | "Proposal" | "Service Agreement" | "Invoice";

export async function sendTransactionalCustomerEmail(input: {
  documentType: TransactionalDocumentType;
  documentId: string;
  recipientEmail: string;
  subject: string;
  messageBody: string;
  requestId: string;
}): Promise<{ providerMessageId: string }> {
  const response = await fetch("/api/customer-emails/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => null) as { error?: string; providerMessageId?: string } | null;
  if (!response.ok || !result?.providerMessageId) {
    throw new Error(result?.error || "The customer email could not be sent.");
  }
  return { providerMessageId: result.providerMessageId };
}

export async function sendProposalDepositAgreement(proposalId: string, proposalNumber: string, email: string) {
  const response = await fetch("/api/customer-emails/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentType: "Proposal",
      documentId: proposalId,
      sendDepositAgreement: true,
      recipientEmail: email,
      subject: `Review and sign your Service Agreement for ${proposalNumber}`,
      messageBody: `Please review and sign the Service Agreement for Proposal ${proposalNumber}. StudioScrubz will confirm scheduling after we receive your deposit.`,
      requestId: `agreement-${proposalId}`,
    }),
  });
  const result = await response.json().catch(() => null) as { error?: string; providerMessageId?: string; skipped?: boolean } | null;
  if (!response.ok || (!result?.providerMessageId && !result?.skipped)) {
    throw new Error(result?.error || "The Service Agreement email could not be sent.");
  }
  return !result?.skipped;
}
