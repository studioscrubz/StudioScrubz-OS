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
