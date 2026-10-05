import "server-only";
import { randomUUID } from "node:crypto";
import { hasPermission } from "@/lib/auth/permissions";
import { sendResendEmail } from "@/lib/email/resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ClientCommunication, CommunicationMetadata, CommunicationType } from "@/types/clientCommunication";
import type { UserProfile } from "@/types/auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_TYPES = new Set(["Estimate", "Proposal", "Service Agreement", "Service Reminder", "Invoice", "Payment Reminder", "General"]);
type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Links = { clientId: string | null; propertyId: string | null; estimateId: string | null; proposalId: string | null; agreementId: string | null; invoiceId: string | null };
class InputError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

export async function POST(request: Request) {
  let admin: Admin | null = null;
  let communicationId: string | null = null;
  try {
    const session = await createSupabaseServerClient();
    const { data: auth } = await session.auth.getUser();
    if (!auth.user) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { data: profileRow, error: profileError } = await session.from("user_profiles").select("*").eq("id", auth.user.id).single();
    const profile = profileRow as UserProfile | null;
    if (profileError || !profile?.is_active) return Response.json({ error: "An active staff profile is required." }, { status: 403 });
    if (!hasPermission(profile, "communications.create")) return Response.json({ error: "You do not have permission to send Communications email." }, { status: 403 });

    const raw = await request.text();
    if (raw.length > 25000) throw new InputError("The email request is too large.");
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { throw new InputError("Invalid email request."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("Invalid email request.");

    const requestId = uuid(body.requestId, "Request identifier");
    const recipientEmail = text(body.recipientEmail, "Recipient email", 320).toLowerCase();
    if (!EMAIL_PATTERN.test(recipientEmail)) throw new InputError("Enter a valid recipient email.");
    const subject = text(body.subject, "Subject", 200);
    if (/[\r\n]/.test(subject)) throw new InputError("Subject must be a single line.");
    const messageBody = text(body.messageBody, "Message", 10000);
    const communicationType = text(body.communicationType, "Communication type", 100) as CommunicationType;
    if (!ALLOWED_TYPES.has(communicationType)) throw new InputError("Select a valid communication type.");
    const links: Links = {
      clientId: optionalUuid(body.clientId, "Client"), propertyId: optionalUuid(body.propertyId, "Property"),
      estimateId: optionalUuid(body.estimateId, "Estimate"), proposalId: optionalUuid(body.proposalId, "Proposal"),
      agreementId: optionalUuid(body.agreementId, "Service Agreement"), invoiceId: optionalUuid(body.invoiceId, "Invoice"),
    };
    const metadata = metadataObject(body.metadata);

    admin = createSupabaseAdminClient();
    await validateLinks(admin, links);
    const replyTo = await loadReplyTo(admin);
    const eventKey = `communications-email:${profile.id}:${requestId}`;
    const expected = { recipientEmail, subject, messageBody, communicationType, ...links };
    const { data: found, error: findError } = await admin.from("client_communications").select("*").eq("event_key", eventKey).maybeSingle();
    if (findError) throw findError;
    let communication = found as ClientCommunication | null;
    if (communication) {
      assertSameRequest(communication, expected);
      communicationId = communication.id;
      if (communication.status === "Sent" && communication.provider_message_id) return Response.json({ communication, duplicate: true });
    } else {
      const insert = {
        communication_number: `COMM-${randomUUID()}`, client_id: links.clientId, property_id: links.propertyId,
        estimate_id: links.estimateId, proposal_id: links.proposalId, agreement_id: links.agreementId, invoice_id: links.invoiceId,
        communication_type: communicationType, channel: "Email" as const, direction: "Outbound" as const, status: "Prepared" as const,
        provider: "resend", recipient_email: recipientEmail, subject, message_body: messageBody,
        sent_by_user_id: profile.id, sent_by_name: profile.display_name || profile.email || profile.role,
        metadata: { ...metadata, delivery: "communications-resend" }, event_key: eventKey,
      };
      const { data: created, error: createError } = await admin.from("client_communications").insert(insert).select("*").single();
      if (createError?.code === "23505") {
        const { data: raced, error: raceError } = await admin.from("client_communications").select("*").eq("event_key", eventKey).single();
        if (raceError || !raced) throw raceError ?? new Error("Communication preparation failed.");
        communication = raced as ClientCommunication;
        assertSameRequest(communication, expected);
        if (communication.status === "Sent" && communication.provider_message_id) return Response.json({ communication, duplicate: true });
      } else if (createError || !created) throw createError ?? new Error("Communication preparation failed.");
      else communication = created as ClientCommunication;
      communicationId = communication.id;
    }

    const content = renderEmail(messageBody);
    const sent = await sendResendEmail({ recipientEmail, subject, ...content, replyTo, idempotencyKey: eventKey });
    if (!sent.id?.trim()) throw new Error("The email provider did not confirm delivery submission.");
    const finalized = await finalize(admin, communicationId, sent.id, null);
    return Response.json({ communication: finalized, providerMessageId: sent.id });
  } catch (cause) {
    if (cause instanceof InputError) return Response.json({ error: cause.message }, { status: cause.status });
    console.error("Communications email delivery failed", safeLog(cause));
    if (admin && communicationId) {
      try { await finalize(admin, communicationId, null, "Email delivery was not accepted by the provider."); }
      catch (finalizeError) { console.error("Communications email failure could not be finalized", safeLog(finalizeError)); }
    }
    return Response.json({ error: "The email could not be confirmed as sent. Please try again." }, { status: 502 });
  }
}

async function validateLinks(admin: Admin, links: Links) {
  if (links.clientId) {
    const { data, error } = await admin.from("clients").select("id").eq("id", links.clientId).is("archived_at", null).single();
    if (error || !data) throw new InputError("The selected client is unavailable.");
  }
  if (links.propertyId) {
    if (!links.clientId) throw new InputError("A property must be linked to its client.");
    const { data, error } = await admin.from("properties").select("id").eq("id", links.propertyId).eq("client_id", links.clientId).is("archived_at", null).single();
    if (error || !data) throw new InputError("The selected property is unavailable or does not belong to this client.");
  }
  const documents = [
    ["estimates", links.estimateId, "Estimate"], ["proposals", links.proposalId, "Proposal"],
    ["service_agreements", links.agreementId, "Service Agreement"], ["invoices", links.invoiceId, "Invoice"],
  ] as const;
  for (const [table, recordId, label] of documents) {
    if (!recordId) continue;
    const { data, error } = await admin.from(table).select("id,client_id,property_id,archived_at").eq("id", recordId).single();
    if (error || !data || data.archived_at || (links.clientId && data.client_id !== links.clientId) || (links.propertyId && data.property_id !== links.propertyId)) throw new InputError(`The selected ${label} is unavailable or does not match this communication.`);
  }
}

async function loadReplyTo(admin: Admin) {
  const { data, error } = await admin.from("business_settings").select("business_email").single();
  const email = data?.business_email?.trim().toLowerCase() ?? "";
  if (error || !EMAIL_PATTERN.test(email)) throw new Error("Business email configuration is unavailable.");
  return email;
}

async function finalize(admin: Admin, id: string, providerMessageId: string | null, failureReason: string | null) {
  const rpc = admin.rpc as unknown as (name: "finalize_communications_resend_email", args: { p_communication_id: string; p_provider_message_id: string | null; p_failure_reason: string | null }) => Promise<{ data: ClientCommunication | null; error: { message: string } | null }>;
  const { data, error } = await rpc("finalize_communications_resend_email", { p_communication_id: id, p_provider_message_id: providerMessageId, p_failure_reason: failureReason });
  if (error || !data) throw new Error("Communication delivery finalization failed.");
  return data;
}

function assertSameRequest(row: ClientCommunication, expected: { recipientEmail: string; subject: string; messageBody: string; communicationType: CommunicationType } & Links) {
  if (row.provider !== "resend" || row.channel !== "Email" || row.direction !== "Outbound" || row.recipient_email?.toLowerCase() !== expected.recipientEmail || row.subject !== expected.subject || row.message_body !== expected.messageBody || row.communication_type !== expected.communicationType || row.client_id !== expected.clientId || row.property_id !== expected.propertyId || row.estimate_id !== expected.estimateId || row.proposal_id !== expected.proposalId || row.agreement_id !== expected.agreementId || row.invoice_id !== expected.invoiceId) throw new InputError("This request identifier was already used for different email content.", 409);
}
function text(value: unknown, label: string, max: number) { if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new InputError(`${label} is required and must be at most ${max} characters.`); return value.trim(); }
function uuid(value: unknown, label: string) { const result = text(value, label, 36); if (!UUID_PATTERN.test(result)) throw new InputError(`${label} is invalid.`); return result; }
function optionalUuid(value: unknown, label: string) { return value == null || value === "" ? null : uuid(value, label); }
function metadataObject(value: unknown): CommunicationMetadata { if (value == null) return {}; if (typeof value !== "object" || Array.isArray(value)) throw new InputError("Communication metadata is invalid."); const encoded = JSON.stringify(value); if (encoded.length > 5000) throw new InputError("Communication metadata is too large."); return value as CommunicationMetadata; }
function renderEmail(body: string) { return { text: body, html: `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6;max-width:640px;margin:auto"><div style="border-bottom:3px solid #143d1a;padding:20px 0"><strong style="font-size:24px;color:#143d1a">StudioScrubz</strong><div style="color:#9a7a17">No mess. No stress.</div></div><div style="padding:28px 0;white-space:pre-wrap">${escapeHtml(body)}</div></div>` }; }
function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function safeLog(value: unknown) { return value instanceof Error ? { name: value.name, message: value.message.slice(0, 300) } : { name: "UnknownError" }; }
