import "server-only";
import { randomInt } from "node:crypto";
import { hasPermission, type Permission } from "@/lib/auth/permissions";
import { getPublicSiteUrl } from "@/lib/publicSiteUrl";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";

type DocumentType = "Estimate" | "Proposal" | "Service Agreement" | "Invoice";
type DocumentContext = {
  id: string; number: string; clientId: string | null; propertyId: string | null;
  token: string | null; tokenExpiresAt: string | null; publicPath: string;
};

const FROM = "StudioScrubz <notifications@studioscrubz.com>";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let communicationId: string | null = null;
  const admin = createSupabaseAdminClient();
  try {
    const session = await createSupabaseServerClient();
    const { data: authData } = await session.auth.getUser();
    if (!authData.user) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { data: profileData, error: profileError } = await session.from("user_profiles").select("*").eq("id", authData.user.id).single();
    if (profileError || !profileData) return Response.json({ error: "An active staff profile is required." }, { status: 403 });
    const profile = profileData as UserProfile;
    if (!profile.is_active) return Response.json({ error: "An active staff profile is required." }, { status: 403 });

    const body = await request.json() as Record<string, unknown>;
    const documentType = documentTypeValue(body.documentType);
    if (!hasPermission(profile, permissionFor(documentType))) return Response.json({ error: "You do not have permission to send this document." }, { status: 403 });
    const documentId = requiredText(body.documentId, "Document");
    const recipientEmail = requiredText(body.recipientEmail, "Recipient email", 320).toLowerCase();
    if (!EMAIL_PATTERN.test(recipientEmail)) return Response.json({ error: "A valid customer email address is required." }, { status: 400 });
    const subject = requiredText(body.subject, "Subject", 200);
    const messageBody = requiredText(body.messageBody, "Message", 10000);
    const requestId = requiredText(body.requestId, "Request identifier", 100);
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestId)) return Response.json({ error: "The email request identifier is invalid." }, { status: 400 });

    const document = await loadDocument(admin, documentType, documentId);
    assertUsableToken(document);
    const eventKey = `resend:${documentType.toLowerCase().replaceAll(" ", "-")}:${document.id}:${requestId}`;
    const { data: existing, error: existingError } = await admin.from("client_communications").select("id,status,provider_message_id").eq("event_key", eventKey).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === "Sent" && existing.provider_message_id) {
      return Response.json({ providerMessageId: existing.provider_message_id, duplicate: true });
    }

    if (existing) communicationId = existing.id;
    else {
      const { data: communication, error: communicationError } = await admin.from("client_communications").insert({
        communication_number: communicationNumber(), client_id: document.clientId, property_id: document.propertyId,
        estimate_id: documentType === "Estimate" ? document.id : null,
        proposal_id: documentType === "Proposal" ? document.id : null,
        agreement_id: documentType === "Service Agreement" ? document.id : null,
        invoice_id: documentType === "Invoice" ? document.id : null,
        communication_type: documentType, channel: "Email", direction: "Outbound", status: "Prepared",
        provider: "resend", recipient_email: recipientEmail, subject, message_body: messageBody,
        sent_by_user_id: profile.id, sent_by_name: profile.display_name || profile.email || profile.role,
        metadata: { document_number: document.number, public_path: document.publicPath }, event_key: eventKey,
      }).select("id").single();
      if (communicationError) throw communicationError;
      communicationId = communication.id;
    }

    const publicUrl = `${getPublicSiteUrl()}${document.publicPath}/${document.token}`;
    const resend = await sendWithResend({ recipientEmail, subject, messageBody, publicUrl, documentType, idempotencyKey: eventKey });
    const sentAt = new Date().toISOString();
    const { error: sentError } = await admin.from("client_communications").update({ status: "Sent", sent_at: sentAt, failure_reason: null, provider_message_id: resend.id }).eq("id", communicationId).select("id").single();
    if (sentError) throw sentError;
    return Response.json({ providerMessageId: resend.id });
  } catch (cause) {
    const internal = errorMessage(cause);
    console.error("Transactional customer email failed", cause);
    if (communicationId) {
      await admin.from("client_communications").update({ status: "Failed", failure_reason: internal.slice(0, 1000) }).eq("id", communicationId);
    }
    const configurationError = internal.includes("RESEND_API_KEY");
    return Response.json({ error: configurationError ? "Transactional email is not configured." : "Resend did not accept the customer email. Please try again." }, { status: configurationError ? 503 : 502 });
  }
}

async function loadDocument(admin: ReturnType<typeof createSupabaseAdminClient>, type: DocumentType, id: string): Promise<DocumentContext> {
  if (type === "Estimate") {
    const { data, error } = await admin.from("estimates").select("id,estimate_number,client_id,property_id,client_access_token,client_access_token_expires_at,client_delivery_snapshot,archived_at,status").eq("id", id).single();
    if (error || !data || data.archived_at || data.status !== "Open" || !data.client_delivery_snapshot) throw new Error("This Estimate is unavailable for email delivery.");
    return { id: data.id, number: data.estimate_number, clientId: data.client_id, propertyId: data.property_id, token: data.client_access_token, tokenExpiresAt: data.client_access_token_expires_at, publicPath: "/estimate" };
  }
  if (type === "Proposal") {
    const { data, error } = await admin.from("proposals").select("id,proposal_number,client_id,property_id,client_access_token,client_access_token_expires_at,client_delivery_snapshot,archived_at,status").eq("id", id).single();
    if (error || !data || data.archived_at || !["Sent", "Viewed"].includes(data.status) || !data.client_delivery_snapshot) throw new Error("This Proposal is unavailable for email delivery.");
    return { id: data.id, number: data.proposal_number, clientId: data.client_id, propertyId: data.property_id, token: data.client_access_token, tokenExpiresAt: data.client_access_token_expires_at, publicPath: "/proposal" };
  }
  if (type === "Service Agreement") {
    const { data, error } = await admin.from("service_agreements").select("id,agreement_number,client_id,property_id,client_access_token,client_access_token_expires_at,archived_at,status").eq("id", id).single();
    if (error || !data || data.archived_at || data.status !== "Sent") throw new Error("This Service Agreement is unavailable for email delivery.");
    return { id: data.id, number: data.agreement_number, clientId: data.client_id, propertyId: data.property_id, token: data.client_access_token, tokenExpiresAt: data.client_access_token_expires_at, publicPath: "/agreement" };
  }
  const { data, error } = await admin.from("invoices").select("id,invoice_number,client_id,property_id,client_access_token,client_access_token_expires_at,archived_at,status").eq("id", id).single();
  if (error || !data || data.archived_at || ["Cancelled", "Archived"].includes(data.status)) throw new Error("This Invoice is unavailable for email delivery.");
  return { id: data.id, number: data.invoice_number, clientId: data.client_id, propertyId: data.property_id, token: data.client_access_token, tokenExpiresAt: data.client_access_token_expires_at, publicPath: "/invoice" };
}

function assertUsableToken(document: DocumentContext) {
  if (!document.token || document.token.length < 40) throw new Error("The secure customer link was not persisted.");
  if (document.tokenExpiresAt && Date.parse(document.tokenExpiresAt) <= Date.now()) throw new Error("The secure customer link has expired.");
}
function permissionFor(type: DocumentType): Permission { return type === "Estimate" ? "estimates.edit" : type === "Proposal" ? "proposals.send" : type === "Service Agreement" ? "agreements.manage" : "invoices.edit"; }
function documentTypeValue(value: unknown): DocumentType { if (["Estimate", "Proposal", "Service Agreement", "Invoice"].includes(String(value))) return value as DocumentType; throw new Error("A supported document type is required."); }
function requiredText(value: unknown, label: string, max = 100) { if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${label} is required.`); return value.trim(); }
function communicationNumber() { const date = new Date().toISOString().slice(0, 10).replaceAll("-", ""); return `COMM-${date}-${String(randomInt(10000)).padStart(4, "0")}`; }
function errorMessage(value: unknown) { return value instanceof Error ? value.message : "Unknown transactional email failure."; }
function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
async function sendWithResend(input: { recipientEmail: string; subject: string; messageBody: string; publicUrl: string; documentType: DocumentType; idempotencyKey: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
  const label = input.documentType === "Service Agreement" ? "Review & Sign Agreement" : `View ${input.documentType}`;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey }, body: JSON.stringify({
    from: FROM, to: [input.recipientEmail], subject: input.subject,
    text: `${input.messageBody}\n\n${label}:\n${input.publicUrl}`,
    html: `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6;max-width:640px;margin:auto"><div style="border-bottom:3px solid #143d1a;padding:20px 0"><strong style="font-size:24px;color:#143d1a">StudioScrubz</strong><div style="color:#9a7a17">No mess. No stress.</div></div><div style="padding:28px 0;white-space:pre-line">${escapeHtml(input.messageBody)}</div><a href="${escapeHtml(input.publicUrl)}" style="display:inline-block;background:#143d1a;color:white;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escapeHtml(label)}</a><p style="margin-top:24px;font-size:12px;color:#6b7280;word-break:break-all">${escapeHtml(input.publicUrl)}</p></div>`,
  }) });
  const result = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok || !result?.id) throw new Error(result?.message || `Resend returned HTTP ${response.status}.`);
  return { id: result.id };
}
