import "server-only";
import { randomUUID } from "node:crypto";
import { hasPermission } from "@/lib/auth/permissions";
import { sendResendEmail } from "@/lib/email/resend";
import { resolveEmailSenderProfile, type EmailSenderProfileKey } from "@/lib/email/senderProfiles";
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
  let providerMessageId: string | null = null;
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
    const sender = resolveEmailSenderProfile(await senderProfileForCommunication(admin, communicationType, metadata));
    const eventKey = `communications-email:${profile.id}:${requestId}`;
    const expected = { recipientEmail, subject, messageBody, communicationType, ...links };
    const { data: found, error: findError } = await admin.from("client_communications").select("*").eq("event_key", eventKey).maybeSingle();
    if (findError) throw findError;
    let communication = found as ClientCommunication | null;
    if (communication) {
      assertSameRequest(communication, expected);
      communicationId = communication.id;
    } else {
      const insert = {
        communication_number: `COMM-${randomUUID()}`, client_id: links.clientId, property_id: links.propertyId,
        estimate_id: links.estimateId, proposal_id: links.proposalId, agreement_id: links.agreementId, invoice_id: links.invoiceId,
        communication_type: communicationType, channel: "Email" as const, direction: "Outbound" as const, status: "Prepared" as const,
        provider: "resend", recipient_email: recipientEmail, subject, message_body: messageBody,
        sent_by_user_id: profile.id, sent_by_name: profile.display_name || profile.email || profile.role,
        metadata: { ...metadata, delivery: "communications-resend", provider_from: sender.from, provider_reply_to: sender.replyTo }, event_key: eventKey,
      };
      const { data: created, error: createError } = await admin.from("client_communications").insert(insert).select("*").single();
      if (createError?.code === "23505") {
        const { data: raced, error: raceError } = await admin.from("client_communications").select("*").eq("event_key", eventKey).single();
        if (raceError || !raced) throw raceError ?? new Error("Communication preparation failed.");
        communication = raced as ClientCommunication;
        assertSameRequest(communication, expected);
      } else if (createError || !created) throw createError ?? new Error("Communication preparation failed.");
      else communication = created as ClientCommunication;
      communicationId = communication.id;
    }

    const recoveredSubmission = await findProviderSubmission(admin, communicationId, eventKey);
    if (recoveredSubmission) {
      providerMessageId = recoveredSubmission.provider_message_id;
      if (communication.status === "Sent" && communication.provider_message_id?.trim() !== providerMessageId) throw new UnconfirmedProviderStateError("The saved communication does not match its durable Resend acceptance receipt.");
      const finalized = await finalize(admin, communicationId, providerMessageId, null);
      return acceptedResponse(finalized, providerMessageId, { recovered: true, duplicate: communication.status === "Sent" });
    }
    if (communication.status === "Sent" || communication.provider_message_id) throw new UnconfirmedProviderStateError("This communication is marked Sent, but no matching durable Resend acceptance receipt exists. It was not sent again.");

    const content = renderEmail(messageBody);
    const sent = await sendResendEmail({ recipientEmail, subject, ...content, ...sender, idempotencyKey: eventKey });
    providerMessageId = confirmedProviderMessageId(sent.id);
    await persistProviderSubmission(admin, communicationId, eventKey, providerMessageId);
    const finalized = await finalize(admin, communicationId, providerMessageId, null);
    return acceptedResponse(finalized, providerMessageId);
  } catch (cause) {
    if (cause instanceof InputError) return Response.json({ error: cause.message }, { status: cause.status });
    if (cause instanceof UnconfirmedProviderStateError) return Response.json({ error: cause.message }, { status: 409 });
    if (providerMessageId) {
      console.error("Communications email was accepted by Resend but delivery finalization failed", {
        communicationId, providerMessageId, error: safeLog(cause),
      });
      return Response.json({ error: "The email provider accepted the message, but StudioScrubz could not finish recording delivery. Retry this same send request to recover it without sending a duplicate." }, { status: 502 });
    }
    console.error("Communications email provider submission failed", { communicationId, error: safeLog(cause) });
    if (admin && communicationId) {
      try { await finalize(admin, communicationId, null, "Email delivery was not accepted by the provider."); }
      catch (finalizeError) { console.error("Communications email provider failure could not be finalized", { communicationId, error: safeLog(finalizeError) }); }
    }
    return Response.json({ error: providerFailureMessage(cause) }, { status: 502 });
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

async function senderProfileForCommunication(admin: Admin, type: CommunicationType, metadata: CommunicationMetadata, retryDepth = 0): Promise<EmailSenderProfileKey> {
  const retryOf = typeof metadata.retry_of_communication_id === "string" ? metadata.retry_of_communication_id : null;
  if (retryDepth < 5 && retryOf && UUID_PATTERN.test(retryOf)) {
    const { data, error } = await admin.from("client_communications").select("communication_type,metadata").eq("id", retryOf).maybeSingle();
    if (error) throw new Error("The original communication sender identity could not be loaded.");
    if (data) return senderProfileForCommunication(admin, data.communication_type as CommunicationType, (data.metadata ?? {}) as CommunicationMetadata, retryDepth + 1);
  }
  if (type === "Estimate") return "estimate";
  if (type === "Proposal") return "proposal";
  if (type === "Service Agreement") return "serviceAgreement";
  if (type === "Invoice" || type === "Payment Reminder") return "billing";
  if (type === "Service Reminder") return "scheduling";
  const event = typeof metadata.event === "string" ? metadata.event : null;
  if (event && ["service_scheduled", "team_arrived", "service_completed"].includes(event)) return "scheduling";
  return "general";
}

async function finalize(admin: Admin, id: string, providerMessageId: string | null, failureReason: string | null) {
  const sent = Boolean(providerMessageId?.trim());
  if (sent === Boolean(failureReason?.trim())) throw new Error("Communication finalization requires exactly one delivery result.");
  const { data, error } = await admin.from("client_communications").update({
    status: sent ? "Sent" : "Failed",
    provider_message_id: sent ? providerMessageId!.trim() : null,
    sent_at: sent ? new Date().toISOString() : null,
    failure_reason: sent ? null : failureReason!.trim().slice(0, 500),
  }).eq("id", id).select("*").single();
  if (error || !data) throw new DeliveryFinalizationError(error);
  return data as ClientCommunication;
}

type ProviderSubmission = { communication_id: string; event_key: string; provider: string; provider_message_id: string };

async function findProviderSubmission(admin: Admin, communicationId: string, eventKey: string): Promise<ProviderSubmission | null> {
  const { data, error } = await admin.from("communications_email_provider_submissions").select("communication_id,event_key,provider,provider_message_id").eq("communication_id", communicationId).maybeSingle();
  if (error) throw new DeliveryFinalizationError(error);
  if (!data) return null;
  if (data.event_key !== eventKey || data.provider !== "resend" || !data.provider_message_id?.trim()) throw new Error("The durable email provider submission does not match this communication request.");
  return data as ProviderSubmission;
}

async function persistProviderSubmission(admin: Admin, communicationId: string, eventKey: string, providerMessageId: string): Promise<ProviderSubmission> {
  const receipt = { communication_id: communicationId, event_key: eventKey, provider: "resend", provider_message_id: providerMessageId };
  const { data, error } = await admin.from("communications_email_provider_submissions").insert(receipt).select("communication_id,event_key,provider,provider_message_id").single();
  if (!error && data) return data as ProviderSubmission;
  if (error?.code === "23505") {
    const existing = await findProviderSubmission(admin, communicationId, eventKey);
    if (existing?.provider_message_id === providerMessageId) return existing;
  }
  throw new DeliveryFinalizationError(error);
}

class DeliveryFinalizationError extends Error {
  readonly code: string | null;
  readonly details: string | null;
  readonly hint: string | null;
  constructor(error: { message?: string; code?: string; details?: string; hint?: string } | null) {
    super(error?.message || "Communication delivery finalization returned no record.");
    this.name = "DeliveryFinalizationError";
    this.code = error?.code ?? null;
    this.details = error?.details ?? null;
    this.hint = error?.hint ?? null;
  }
}

class UnconfirmedProviderStateError extends Error {
  constructor(message: string) { super(message); this.name = "UnconfirmedProviderStateError"; }
}

function confirmedProviderMessageId(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) throw new Error("Resend did not return a valid provider message ID.");
  return value.trim();
}

function acceptedResponse(communication: ClientCommunication, providerMessageId: string, extra: Record<string, boolean> = {}) {
  return Response.json({ communication, provider: "resend", providerMessageId, accepted: true, ...extra });
}

function providerFailureMessage(cause: unknown) {
  const detail = cause instanceof Error ? cause.message.trim() : "";
  if (detail === "RESEND_API_KEY is not configured.") return "Email provider configuration is unavailable. Contact an administrator; the email was not sent.";
  if (detail === "Resend did not return a valid provider message ID." || detail === "The email provider did not confirm delivery submission.") return `${detail} The email was not confirmed as sent.`;
  if (detail && detail.length <= 300) return `Resend did not accept the email: ${detail}`;
  return "Resend did not accept the email. Please retry after checking the provider configuration and sender domain.";
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
function safeLog(value: unknown) { return value instanceof DeliveryFinalizationError ? { name: value.name, message: value.message.slice(0, 300), code: value.code, details: value.details?.slice(0, 300) ?? null, hint: value.hint?.slice(0, 300) ?? null } : value instanceof Error ? { name: value.name, message: value.message.slice(0, 300) } : { name: "UnknownError" }; }
