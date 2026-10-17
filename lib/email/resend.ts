import "server-only";
import { resolveEmailSenderProfile } from "@/lib/email/senderProfiles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeEmailHtml, renderStudioScrubzEmail, type EmailBrandContact } from "@/lib/email/studioScrubzTemplate";
const PROVIDER_SAFETY_DEFAULT = resolveEmailSenderProfile("systemNotification");
export async function sendWithResend(input: { recipientEmail: string; subject: string; messageBody: string; publicUrl: string; documentType: "Estimate" | "Proposal" | "Service Agreement" | "Invoice"; idempotencyKey: string; from: string; replyTo: string | null }) {
  const label = input.documentType === "Service Agreement" ? "Review & Sign Agreement" : `View ${input.documentType}`;
  return sendResendEmail({ ...input,
    text: `${input.messageBody}\n\n${label}:\n${input.publicUrl}`,
    html: `<div style="white-space:pre-line">${escapeEmailHtml(input.messageBody)}</div><a href="${escapeEmailHtml(input.publicUrl)}" style="display:inline-block;margin-top:22px;background:#143D1A;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escapeEmailHtml(label)}</a><p style="margin-top:20px;font-size:12px;color:#6b7280;word-break:break-all">${escapeEmailHtml(input.publicUrl)}</p>`,
  });
}

export async function sendResendEmail(input: { recipientEmail: string; subject: string; text: string; html: string; idempotencyKey: string; replyTo: string | null; from?: string; attachments?: Array<{ filename: string; content: string; contentType?: string }> }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
  const html = renderStudioScrubzEmail(input.html, await loadEmailBrandContact());
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey, "User-Agent": "StudioScrubz-OS/1.0" }, body: JSON.stringify({
    from: input.from ?? PROVIDER_SAFETY_DEFAULT.from, to: [input.recipientEmail], ...(input.replyTo ? { reply_to: input.replyTo } : {}), subject: input.subject,
    text: input.text, html, attachments: input.attachments?.map(({ contentType, ...attachment }) => ({ ...attachment, content_type: contentType })),
  }) });
  const result = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok || !result?.id) throw new Error(result?.message || `Resend returned HTTP ${response.status}.`);
  return { id: result.id };
}

async function loadEmailBrandContact(): Promise<EmailBrandContact> {
  try {
    const { data, error } = await createSupabaseAdminClient().from("business_settings").select("business_name,business_email,business_phone,website").limit(1).maybeSingle();
    if (error || !data) return {};
    return { businessName: data.business_name, email: data.business_email, phone: data.business_phone, website: data.website };
  } catch { return {}; }
}
