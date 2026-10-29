import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { hasPermission } from "@/lib/auth/permissions";
import { sendResendEmail } from "@/lib/email/resend";
import { resolveEmailSenderProfile } from "@/lib/email/senderProfiles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildVendorCapabilityDocumentModel,
  capabilityModelFromSnapshot,
  CapabilityModelError,
  normalizeDocumentKind,
  validateSelectedModuleIds,
  type CapabilityStatementModel,
  type VendorDocumentKind,
} from "@/lib/vendorPackets/capability";
import { renderCapabilityDocumentEmail } from "@/lib/vendorPackets/email";
import { validateCorporateCapabilityProfile, type CorporateCapabilityProfile } from "@/types/corporateCapability";
import type { UserProfile } from "@/types/auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Admin = ReturnType<typeof createSupabaseAdminClient>;
type CommunicationRow = {
  id: string;
  client_id: string | null;
  property_id: string | null;
  communication_type: string;
  channel: string;
  direction: string;
  status: string;
  provider: string | null;
  provider_message_id: string | null;
  recipient_email: string | null;
  subject: string | null;
  message_body: string | null;
  metadata: unknown;
  event_key: string | null;
  sent_at: string | null;
};
type ProviderSubmission = { communication_id: string; event_key: string; provider: string; provider_message_id: string };
type RequestIdentity = {
  clientId: string;
  propertyId: string | null;
  recipientEmail: string;
  subject: string;
  messageBody: string;
  documentKind: VendorDocumentKind;
  moduleIds: string[];
  fingerprint: string;
};

class InputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "InputError"; }
}
class DeliveryFinalizationError extends Error {
  readonly code: string | null;
  constructor(error: { message?: string; code?: string } | null) {
    super(error?.message || "Vendor document delivery finalization returned no record.");
    this.name = "DeliveryFinalizationError";
    this.code = error?.code ?? null;
  }
}
class UnconfirmedProviderStateError extends Error {
  constructor(message: string) { super(message); this.name = "UnconfirmedProviderStateError"; }
}

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
    if (profileError || !profile?.is_active || !["Sales", "Administrator", "Master Admin"].includes(profile.role)
      || !hasPermission(profile, "estimates.create") || !hasPermission(profile, "communications.create")) {
      return Response.json({ error: "You do not have permission to email vendor documents." }, { status: 403 });
    }

    const body = await readBody(request);
    const requestId = uuid(body.requestId, "Request identifier");
    const clientId = uuid(body.clientId, "Client");
    const propertyId = optionalUuid(body.propertyId, "Property");
    const recipientEmail = text(body.recipientEmail, "Recipient email", 320).toLowerCase();
    if (!EMAIL_PATTERN.test(recipientEmail)) throw new InputError("Enter a valid recipient email.");
    const subject = text(body.subject, "Subject", 200);
    if (/[\r\n]/.test(subject)) throw new InputError("Subject must be a single line.");
    const messageBody = text(body.messageBody, "Message", 10_000);
    let documentKind: VendorDocumentKind;
    let moduleIds: string[];
    try {
      documentKind = normalizeDocumentKind(body.documentKind);
      moduleIds = validateSelectedModuleIds(documentKind, body.moduleIds);
    } catch (cause) {
      if (cause instanceof CapabilityModelError) throw new InputError(cause.message);
      throw cause;
    }
    const fingerprint = requestFingerprint({ clientId, propertyId, recipientEmail, subject, messageBody, documentKind, moduleIds });
    const identity: RequestIdentity = { clientId, propertyId, recipientEmail, subject, messageBody, documentKind, moduleIds, fingerprint };
    const eventKey = `vendor-document:${profile.id}:${requestId}`;

    admin = createSupabaseAdminClient();
    const { data: found, error: findError } = await admin.from("client_communications").select("*").eq("event_key", eventKey).maybeSingle();
    if (findError) throw findError;
    let communication = found as CommunicationRow | null;
    let model: CapabilityStatementModel;
    if (communication) {
      assertSameRequest(communication, identity, eventKey);
      communicationId = communication.id;
      model = modelFromCommunication(communication, identity);
    } else {
      model = await buildAuthoritativeModel(admin, identity);
      const metadata = deliveryMetadata(model, identity);
      const insert = {
        communication_number: `COMM-${randomUUID()}`,
        client_id: clientId,
        property_id: propertyId,
        communication_type: "General",
        channel: "Email",
        direction: "Outbound",
        status: "Prepared",
        provider: "resend",
        recipient_email: recipientEmail,
        subject,
        message_body: messageBody,
        sent_by_user_id: profile.id,
        sent_by_name: profile.display_name || profile.email || profile.role,
        event_key: eventKey,
        metadata,
      };
      const { data: created, error: createError } = await admin.from("client_communications").insert(insert).select("*").single();
      if (createError?.code === "23505") {
        const { data: raced, error: raceError } = await admin.from("client_communications").select("*").eq("event_key", eventKey).single();
        if (raceError || !raced) throw raceError ?? new Error("Vendor document preparation failed.");
        communication = raced as CommunicationRow;
        assertSameRequest(communication, identity, eventKey);
        model = modelFromCommunication(communication, identity);
      } else if (createError || !created) {
        throw createError ?? new Error("Vendor document preparation failed.");
      } else {
        communication = created as CommunicationRow;
      }
      communicationId = communication.id;
    }

    const recoveredSubmission = await findProviderSubmission(admin, communicationId, eventKey);
    if (recoveredSubmission) {
      providerMessageId = recoveredSubmission.provider_message_id;
      if (communication.status === "Sent") {
        if (communication.provider_message_id !== providerMessageId) {
          throw new UnconfirmedProviderStateError("The saved vendor document delivery does not match its durable email provider receipt.");
        }
        return acceptedResponse(communication, providerMessageId, { recovered: true, duplicate: true });
      }
      const finalized = await finalize(admin, communicationId, providerMessageId, null);
      return acceptedResponse(finalized, providerMessageId, { recovered: true });
    }
    if (communication.status === "Sent" || communication.provider_message_id) {
      throw new UnconfirmedProviderStateError("This vendor document is marked Sent, but no matching durable email provider receipt exists. It was not sent again.");
    }
    if (!["Prepared", "Failed"].includes(communication.status)) {
      throw new UnconfirmedProviderStateError("This vendor document is not in a sendable delivery state.");
    }

    const content = renderCapabilityDocumentEmail({ model, message: messageBody });
    const sent = await sendResendEmail({
      recipientEmail,
      subject,
      ...content,
      ...resolveEmailSenderProfile("vendor"),
      idempotencyKey: eventKey,
    });
    providerMessageId = confirmedProviderMessageId(sent.id);
    await persistProviderSubmission(admin, communicationId, eventKey, providerMessageId);
    const finalized = await finalize(admin, communicationId, providerMessageId, null);
    return acceptedResponse(finalized, providerMessageId);
  } catch (cause) {
    if (cause instanceof InputError) return Response.json({ error: cause.message }, { status: cause.status });
    if (cause instanceof UnconfirmedProviderStateError) return Response.json({ error: cause.message }, { status: 409 });
    if (providerMessageId) {
      console.error("Vendor document email was accepted but delivery finalization failed", { communicationId, providerMessageId, error: safeLog(cause) });
      return Response.json({ error: "The email provider accepted the message, but StudioScrubz could not finish recording delivery. Retry this same send request to recover it without sending a duplicate." }, { status: 502 });
    }
    console.error("Vendor document email provider submission failed", { communicationId, error: safeLog(cause) });
    if (admin && communicationId) {
      try { await finalizeFailureIfUnaccepted(admin, communicationId, "Email delivery was not accepted by the provider."); }
      catch (finalizeError) { console.error("Vendor document provider failure could not be finalized", { communicationId, error: safeLog(finalizeError) }); }
    }
    return Response.json({ error: providerFailureMessage(cause) }, { status: 502 });
  }
}

async function buildAuthoritativeModel(admin: Admin, identity: RequestIdentity): Promise<CapabilityStatementModel> {
  const { data: client, error: clientError } = await admin.from("clients")
    .select("id,first_name,last_name,company_name")
    .eq("id", identity.clientId)
    .is("archived_at", null)
    .single();
  if (clientError || !client) throw new InputError("The selected client is unavailable.");
  let propertyLabel: string | null = null;
  if (identity.propertyId) {
    const { data: property, error } = await admin.from("properties")
      .select("property_name,address,address_line_2,city,state,zip")
      .eq("id", identity.propertyId)
      .eq("client_id", identity.clientId)
      .is("archived_at", null)
      .single();
    if (error || !property) throw new InputError("The selected property is unavailable or does not belong to this client.");
    propertyLabel = joinText([property.property_name, property.address, property.address_line_2, property.city, property.state, property.zip]);
  }
  const { data: rawBusiness, error: businessError } = await admin.from("business_settings")
    .select("business_name,tagline,business_email,business_phone,website,address,city,state,zip,corporate_capability_profile")
    .limit(1)
    .maybeSingle();
  if (businessError || !rawBusiness) throw new InputError("Business Settings are unavailable.", 503);
  const business = rawBusiness as Record<string, unknown>;
  let corporateProfile: CorporateCapabilityProfile | null = null;
  if (identity.documentKind === "corporate-capability-statement") {
    try { corporateProfile = validateCorporateCapabilityProfile(business.corporate_capability_profile); }
    catch { throw new InputError("The Corporate Capability profile is invalid. Review Business Settings before sending.", 503); }
  }
  try {
    return buildVendorCapabilityDocumentModel({
      documentKind: identity.documentKind,
      clientName: clean(client.company_name) || joinText([client.first_name, client.last_name]) || "Unnamed client",
      propertyLabel,
      business: {
        name: stringValue(business.business_name),
        tagline: optionalString(business.tagline),
        email: optionalString(business.business_email),
        phone: optionalString(business.business_phone),
        website: optionalString(business.website),
        address: joinText([business.address, business.city, business.state, business.zip]),
      },
      corporateProfile,
      moduleIds: identity.moduleIds,
    });
  } catch (cause) {
    if (cause instanceof CapabilityModelError) throw new InputError(cause.message, 503);
    throw cause;
  }
}

function deliveryMetadata(model: CapabilityStatementModel, identity: RequestIdentity) {
  return {
    event: model.documentKind === "corporate-capability-statement" ? "Corporate Capability Statement Sent" : "Vendor Packet Sent",
    delivery: "vendor-document-resend-v2",
    document_kind: model.documentKind,
    document_version: model.documentVersion,
    selected_module_ids: [...model.selectedModuleIds],
    selected_capability_modules: model.coreCompetencies.map(module => module.title),
    content_snapshot: model.contentSnapshot,
    request_fingerprint: identity.fingerprint,
    recipient: identity.recipientEmail,
    subject: identity.subject,
  };
}

function modelFromCommunication(row: CommunicationRow, identity: RequestIdentity): CapabilityStatementModel {
  const metadata = record(row.metadata);
  let model: CapabilityStatementModel;
  try { model = capabilityModelFromSnapshot(metadata.content_snapshot); }
  catch { throw new UnconfirmedProviderStateError("The prepared vendor document has an invalid immutable content snapshot. It was not sent."); }
  if (model.documentKind !== identity.documentKind || model.documentVersion !== metadata.document_version
    || !sameStringArray(model.selectedModuleIds, identity.moduleIds)
    || !sameStringArray(model.selectedModuleIds, metadata.selected_module_ids)) {
    throw new UnconfirmedProviderStateError("The prepared vendor document does not match this send request. It was not sent.");
  }
  return model;
}

function assertSameRequest(row: CommunicationRow, expected: RequestIdentity, eventKey: string) {
  const metadata = record(row.metadata);
  if (row.event_key !== eventKey || row.provider !== "resend" || row.channel !== "Email" || row.direction !== "Outbound"
    || row.communication_type !== "General" || row.client_id !== expected.clientId || row.property_id !== expected.propertyId
    || row.recipient_email?.toLowerCase() !== expected.recipientEmail || row.subject !== expected.subject
    || row.message_body !== expected.messageBody || metadata.request_fingerprint !== expected.fingerprint
    || metadata.document_kind !== expected.documentKind || !sameStringArray(metadata.selected_module_ids, expected.moduleIds)) {
    throw new InputError("This request identifier was already used for different vendor document content.", 409);
  }
}

async function findProviderSubmission(admin: Admin, communicationId: string, eventKey: string): Promise<ProviderSubmission | null> {
  const { data, error } = await admin.from("communications_email_provider_submissions")
    .select("communication_id,event_key,provider,provider_message_id")
    .eq("communication_id", communicationId)
    .maybeSingle();
  if (error) throw new DeliveryFinalizationError(error);
  if (!data) return null;
  if (data.event_key !== eventKey || data.provider !== "resend") {
    throw new UnconfirmedProviderStateError("The durable email provider receipt does not match this vendor document request.");
  }
  return { ...data, provider_message_id: confirmedProviderMessageId(data.provider_message_id) } as ProviderSubmission;
}

async function persistProviderSubmission(admin: Admin, communicationId: string, eventKey: string, providerMessageId: string) {
  const receipt = { communication_id: communicationId, event_key: eventKey, provider: "resend", provider_message_id: providerMessageId };
  const { data, error } = await admin.from("communications_email_provider_submissions")
    .insert(receipt)
    .select("communication_id,event_key,provider,provider_message_id")
    .single();
  if (!error && data) return data as ProviderSubmission;
  if (error?.code === "23505") {
    const existing = await findProviderSubmission(admin, communicationId, eventKey);
    if (existing?.provider_message_id === providerMessageId) return existing;
    throw new UnconfirmedProviderStateError("A different email provider receipt already exists for this vendor document request.");
  }
  throw new DeliveryFinalizationError(error);
}

async function finalize(admin: Admin, id: string, providerMessageId: string | null, failureReason: string | null): Promise<CommunicationRow> {
  const sent = Boolean(providerMessageId?.trim());
  if (sent === Boolean(failureReason?.trim())) throw new Error("Vendor document finalization requires exactly one delivery result.");
  const { data, error } = await admin.from("client_communications").update({
    status: sent ? "Sent" : "Failed",
    provider_message_id: sent ? providerMessageId!.trim() : null,
    sent_at: sent ? new Date().toISOString() : null,
    failure_reason: sent ? null : failureReason!.trim().slice(0, 500),
  }).eq("id", id).select("*").single();
  if (error || !data) throw new DeliveryFinalizationError(error);
  return data as CommunicationRow;
}

async function finalizeFailureIfUnaccepted(admin: Admin, communicationId: string, failureReason: string) {
  const { data: receipt, error: receiptError } = await admin.from("communications_email_provider_submissions")
    .select("communication_id")
    .eq("communication_id", communicationId)
    .maybeSingle();
  if (receiptError) throw new DeliveryFinalizationError(receiptError);
  if (receipt) return;
  const { error } = await admin.from("client_communications").update({
    status: "Failed",
    provider_message_id: null,
    sent_at: null,
    failure_reason: failureReason.slice(0, 500),
  }).eq("id", communicationId).in("status", ["Prepared", "Failed"]).is("provider_message_id", null);
  if (error) throw new DeliveryFinalizationError(error);
}

function requestFingerprint(input: Omit<RequestIdentity, "fingerprint">) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
function confirmedProviderMessageId(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) throw new Error("The email provider did not return a valid acceptance identifier.");
  return value.trim();
}
function acceptedResponse(communication: CommunicationRow, providerMessageId: string, extra: Record<string, boolean> = {}) {
  return Response.json({ communication, provider: "resend", providerMessageId, accepted: true, ...extra });
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 20_000) throw new InputError("The email request is too large.");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new InputError("Invalid email request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("Invalid email request.");
  return body as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number) { if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new InputError(`${label} is required and must be at most ${max} characters.`); return value.trim(); }
function uuid(value: unknown, label: string) { const result = text(value, label, 36); if (!UUID_PATTERN.test(result)) throw new InputError(`${label} is invalid.`); return result; }
function optionalUuid(value: unknown, label: string) { return value == null || value === "" ? null : uuid(value, label); }
function clean(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function optionalString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function joinText(values: unknown[]): string { return values.map(clean).filter(Boolean).join(", "); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function sameStringArray(left: unknown, right: unknown): boolean { return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => typeof value === "string" && value === right[index]); }
function providerFailureMessage(cause: unknown) { return cause instanceof Error && cause.message === "RESEND_API_KEY is not configured." ? "Email provider configuration is unavailable. Contact an administrator; the email was not sent." : "The email provider did not accept the vendor document. Retry the send after checking the provider configuration."; }
function safeLog(value: unknown) { return value instanceof DeliveryFinalizationError ? { name: value.name, message: value.message.slice(0, 300), code: value.code } : value instanceof Error ? { name: value.name, message: value.message.slice(0, 300) } : { name: "UnknownError" }; }
