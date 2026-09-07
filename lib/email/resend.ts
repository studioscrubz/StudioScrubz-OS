import "server-only";
const FROM = "StudioScrubz <notifications@studioscrubz.com>";
function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
export async function sendWithResend(input: { recipientEmail: string; subject: string; messageBody: string; publicUrl: string; documentType: "Estimate" | "Proposal" | "Service Agreement" | "Invoice"; idempotencyKey: string; replyTo: string }) {
  const label = input.documentType === "Service Agreement" ? "Review & Sign Agreement" : `View ${input.documentType}`;
  return sendResendEmail({ ...input,
    text: `${input.messageBody}\n\n${label}:\n${input.publicUrl}`,
    html: `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6;max-width:640px;margin:auto"><div style="border-bottom:3px solid #143d1a;padding:20px 0"><strong style="font-size:24px;color:#143d1a">StudioScrubz</strong><div style="color:#9a7a17">No mess. No stress.</div></div><div style="padding:28px 0;white-space:pre-line">${escapeHtml(input.messageBody)}</div><a href="${escapeHtml(input.publicUrl)}" style="display:inline-block;background:#143d1a;color:white;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escapeHtml(label)}</a><p style="margin-top:24px;font-size:12px;color:#6b7280;word-break:break-all">${escapeHtml(input.publicUrl)}</p></div>`,
  });
}

export async function sendResendEmail(input: { recipientEmail: string; subject: string; text: string; html: string; idempotencyKey: string; replyTo: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey, "User-Agent": "StudioScrubz-OS/1.0" }, body: JSON.stringify({
    from: FROM, to: [input.recipientEmail], reply_to: input.replyTo, subject: input.subject,
    text: input.text, html: input.html,
  }) });
  const result = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok || !result?.id) throw new Error(result?.message || `Resend returned HTTP ${response.status}.`);
  return { id: result.id };
}
