import "server-only";
import { sendResendEmail } from "@/lib/email/resend";
import { parseEmailAttachments, sameAttachmentManifest, AttachmentError } from "@/lib/email/attachments";
import type { EmailAttachmentInput, EmailAttachmentManifest } from "@/lib/email/attachmentLimits";
import { resolveEmailSenderProfile } from "@/lib/email/senderProfiles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EMPLOYEE_DEPARTMENTS, type EmployeeDepartment } from "@/types/employee";
import type { UserProfile } from "@/types/auth";
import type { EmployeeEmailDirectoryEntry, EmployeeEmailHistory, EmployeeEmailPreview, EmployeeEmailRecipient, EmployeeEmailSelection } from "@/types/employeeEmail";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTHORIZED_ROLES = new Set(["Master Admin", "Administrator"]);
type Admin = ReturnType<typeof createSupabaseAdminClient>;
type EmployeeRow = { id: string; first_name: string; last_name: string; preferred_name: string | null; email: string | null; department: EmployeeDepartment; employment_status: string; archived_at: string | null };
type DeliveryRow = { id: string; event_key: string; request_id: string; employee_id: string; employee_name: string; recipient_email: string; department: EmployeeDepartment; subject: string; message_body: string; sender_id: string | null; sender_name: string; sender_role: string; status: "Pending" | "Accepted" | "Failed"; attachments_manifest: EmailAttachmentManifest[]; provider_message_id: string | null; provider_submission_started_at: string | null; accepted_at: string | null; failed_at: string | null; failure_reason: string | null; created_at: string };
class InputError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

export async function GET() {
  try {
    const { profile, admin } = await authorize();
    const [{ data: employeeRows, error: employeeError }, { data: historyRows, error: historyError }] = await Promise.all([
      admin.from("employees").select("id,first_name,last_name,preferred_name,email,department,employment_status,archived_at").eq("employment_status", "Active").is("archived_at", null).order("last_name"),
      admin.from("employee_email_deliveries").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    if (employeeError) throw employeeError;
    if (historyError) throw historyError;
    return Response.json({ employees: (employeeRows as EmployeeRow[]).map(directoryEntry), departments: [...EMPLOYEE_DEPARTMENTS], history: (historyRows as DeliveryRow[]).map(historyEntry), viewer: { id: profile.id, role: profile.role } });
  } catch (cause) { return failure(cause); }
}

export async function POST(request: Request) {
  try {
    const { profile, admin } = await authorize();
    const raw = await request.text();
    if (raw.length > 3_000_000) throw new InputError("The employee email request is too large.");
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { throw new InputError("Invalid employee email request."); }
    const action = body.action;
    if (action !== "preview" && action !== "send") throw new InputError("Select a valid employee email action.");
    const selection = parseSelection(body.selection);
    const preview = await resolveRecipients(admin, selection);
    if (action === "preview") return Response.json(preview);
    if (!preview.recipientCount) throw new InputError("The selection has no active employees with valid email addresses.");
    if (preview.recipientCount > 1 && body.confirmed !== true) throw new InputError("Explicit confirmation is required before sending a bulk employee email.");
    const requestId = uuid(body.requestId, "Request identifier");
    const subject = requiredText(body.subject, "Subject", 200);
    if (/[\r\n]/.test(subject)) throw new InputError("Subject must be a single line.");
    const message = requiredText(body.message, "Message", 10000);
    const { files: attachments, manifest } = parseEmailAttachments(body.attachments);
    const deliveries = await prepareDeliveries(admin, profile, requestId, subject, message, preview.recipients, manifest);
    const results: DeliveryRow[] = [];
    for (let index = 0; index < deliveries.length; index += 5) {
      results.push(...await Promise.all(deliveries.slice(index, index + 5).map((delivery) => deliverOne(admin, delivery, attachments))));
    }
    return Response.json({ requestId, accepted: results.filter((row) => row.status === "Accepted").length, failed: results.filter((row) => row.status === "Failed").length, pending: results.filter((row) => row.status === "Pending").length, deliveries: results.map(historyEntry) });
  } catch (cause) { return failure(cause); }
}

async function authorize(): Promise<{ profile: UserProfile; admin: Admin }> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) throw new InputError("Authentication is required.", 401);
  const { data, error } = await session.from("user_profiles").select("*").eq("id", auth.user.id).single();
  const profile = data as UserProfile | null;
  if (error || !profile?.is_active || !AUTHORIZED_ROLES.has(profile.role)) throw new InputError("Only an active Master Admin or Administrator may send employee email.", 403);
  return { profile, admin: createSupabaseAdminClient() };
}

function parseSelection(value: unknown): EmployeeEmailSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Recipient selection is required.");
  const input = value as Record<string, unknown>;
  if (input.mode === "department") {
    if (typeof input.department !== "string" || !EMPLOYEE_DEPARTMENTS.includes(input.department as EmployeeDepartment)) throw new InputError("Select a valid employee department.");
    return { mode: "department", department: input.department as EmployeeDepartment };
  }
  if (input.mode !== "selected" || !Array.isArray(input.employeeIds) || !input.employeeIds.length || input.employeeIds.length > 200) throw new InputError("Select between 1 and 200 employees.");
  const employeeIds = [...new Set(input.employeeIds.map((id) => uuid(id, "Employee")))];
  return { mode: "selected", employeeIds };
}

async function resolveRecipients(admin: Admin, selection: EmployeeEmailSelection): Promise<EmployeeEmailPreview> {
  let query = admin.from("employees").select("id,first_name,last_name,preferred_name,email,department,employment_status,archived_at").eq("employment_status", "Active").is("archived_at", null);
  query = selection.mode === "department" ? query.eq("department", selection.department) : query.in("id", selection.employeeIds);
  const { data, error } = await query.order("last_name");
  if (error) throw error;
  const rows = (data ?? []) as EmployeeRow[];
  if (selection.mode === "selected" && rows.length !== selection.employeeIds.length) throw new InputError("One or more selected employees are inactive, archived, missing, or unavailable.");
  const entries = rows.map(directoryEntry);
  const recipients: EmployeeEmailRecipient[] = entries.filter((entry) => entry.available && entry.email).map((entry) => ({ employeeId: entry.id, name: entry.name, email: entry.email!, department: entry.department }));
  return { recipients, unavailable: entries.filter((entry) => !entry.available), recipientCount: recipients.length };
}

async function prepareDeliveries(admin: Admin, profile: UserProfile, requestId: string, subject: string, message: string, recipients: EmployeeEmailRecipient[], manifest: EmailAttachmentManifest[]): Promise<DeliveryRow[]> {
  const senderName = profile.display_name?.trim() || profile.email || profile.role;
  const output: DeliveryRow[] = [];
  for (const recipient of recipients) {
    const eventKey = `employee-email:${profile.id}:${requestId}:${recipient.employeeId}`;
    const record = { event_key: eventKey, request_id: requestId, employee_id: recipient.employeeId, employee_name: recipient.name, recipient_email: recipient.email, department: recipient.department, subject, message_body: message, attachments_manifest: manifest, sender_id: profile.id, sender_name: senderName, sender_role: profile.role, status: "Pending", provider: "resend" };
    const { data, error } = await admin.from("employee_email_deliveries").insert(record).select("*").single();
    if (!error && data) { output.push(data as DeliveryRow); continue; }
    if (error?.code !== "23505") throw error ?? new Error("Employee email delivery could not be prepared.");
    const { data: existing, error: existingError } = await admin.from("employee_email_deliveries").select("*").eq("event_key", eventKey).single();
    if (existingError || !existing) throw existingError ?? new Error("Employee email delivery could not be recovered.");
    const row = existing as DeliveryRow;
    if (row.employee_id !== recipient.employeeId || row.recipient_email.toLowerCase() !== recipient.email.toLowerCase() || row.subject !== subject || row.message_body !== message || row.sender_id !== profile.id || !sameAttachmentManifest(row.attachments_manifest, manifest)) throw new InputError("This request identifier was already used for different employee email content.", 409);
    output.push(row);
  }
  return output;
}

async function deliverOne(admin: Admin, delivery: DeliveryRow, attachments: EmailAttachmentInput[]): Promise<DeliveryRow> {
  const receipt = await providerReceipt(admin, delivery.id);
  if (receipt) return finalizeAccepted(admin, delivery.id, receipt.provider_message_id, receipt.accepted_at);
  if (delivery.status !== "Pending" || delivery.provider_submission_started_at) return delivery;
  const startedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin.from("employee_email_deliveries").update({ provider_submission_started_at: startedAt }).eq("id", delivery.id).eq("status", "Pending").is("provider_submission_started_at", null).select("*").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    const { data: current, error } = await admin.from("employee_email_deliveries").select("*").eq("id", delivery.id).single();
    if (error || !current) throw error ?? new Error("Employee email delivery state could not be loaded.");
    return current as DeliveryRow;
  }
  let providerAccepted = false;
  try {
    const sender = resolveEmailSenderProfile("general");
    const sent = await sendResendEmail({ recipientEmail: delivery.recipient_email, subject: delivery.subject, text: delivery.message_body, html: `<div style="white-space:pre-wrap">${escapeHtml(delivery.message_body)}</div>`, idempotencyKey: delivery.event_key, attachments, ...sender });
    const providerMessageId = uuid(sent.id, "Provider message identifier");
    providerAccepted = true;
    const acceptedAt = new Date().toISOString();
    const { error: receiptError } = await admin.from("employee_email_provider_submissions").insert({ delivery_id: delivery.id, event_key: delivery.event_key, provider: "resend", provider_message_id: providerMessageId, accepted_at: acceptedAt });
    if (receiptError?.code !== "23505") { if (receiptError) throw receiptError; }
    const persisted = await providerReceipt(admin, delivery.id);
    if (!persisted) throw new Error("Provider acceptance could not be recorded.");
    return finalizeAccepted(admin, delivery.id, persisted.provider_message_id, persisted.accepted_at);
  } catch (cause) {
    const receiptAfterError = await providerReceipt(admin, delivery.id);
    if (receiptAfterError) return finalizeAccepted(admin, delivery.id, receiptAfterError.provider_message_id, receiptAfterError.accepted_at);
    if (providerAccepted) {
      console.error("Employee email was accepted by Resend but its durable receipt could not be recorded", { deliveryId: delivery.id });
      const { data: unresolved, error } = await admin.from("employee_email_deliveries").select("*").eq("id", delivery.id).single();
      if (error || !unresolved) throw error ?? cause;
      return unresolved as DeliveryRow;
    }
    const reason = providerFailure(cause);
    const { data, error } = await admin.from("employee_email_deliveries").update({ status: "Failed", failed_at: new Date().toISOString(), failure_reason: reason }).eq("id", delivery.id).select("*").single();
    if (error || !data) throw error ?? cause;
    return data as DeliveryRow;
  }
}

async function providerReceipt(admin: Admin, deliveryId: string): Promise<{ provider_message_id: string; accepted_at: string } | null> { const { data, error } = await admin.from("employee_email_provider_submissions").select("event_key,provider,provider_message_id,accepted_at").eq("delivery_id", deliveryId).maybeSingle(); if (error) throw error; if (!data) return null; const { data: delivery, error: deliveryError } = await admin.from("employee_email_deliveries").select("event_key").eq("id", deliveryId).single(); if (deliveryError || !delivery || data.event_key !== delivery.event_key || data.provider !== "resend") throw new Error("The provider acceptance receipt does not match this employee email delivery."); return { provider_message_id: data.provider_message_id, accepted_at: data.accepted_at }; }
async function finalizeAccepted(admin: Admin, deliveryId: string, providerMessageId: string, acceptedAt: string): Promise<DeliveryRow> { const { data, error } = await admin.from("employee_email_deliveries").update({ status: "Accepted", provider_message_id: providerMessageId, accepted_at: acceptedAt, failed_at: null, failure_reason: null }).eq("id", deliveryId).select("*").single(); if (error || !data) throw error ?? new Error("Employee email acceptance could not be finalized."); return data as DeliveryRow; }

function directoryEntry(row: EmployeeRow): EmployeeEmailDirectoryEntry { const email = row.email?.trim().toLowerCase() || null; const available = Boolean(email && EMAIL_PATTERN.test(email)); return { id: row.id, name: row.preferred_name?.trim() || `${row.first_name} ${row.last_name}`.trim(), email, department: row.department, available, unavailableReason: available ? null : "No valid email address" }; }
function historyEntry(row: DeliveryRow): EmployeeEmailHistory { return { id: row.id, requestId: row.request_id, employeeId: row.employee_id, employeeName: row.employee_name, recipientEmail: row.recipient_email, department: row.department, subject: row.subject, senderName: row.sender_name, status: row.status, providerMessageId: row.provider_message_id, failureReason: row.failure_reason, createdAt: row.created_at, acceptedAt: row.accepted_at, failedAt: row.failed_at }; }
function requiredText(value: unknown, label: string, max: number) { if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new InputError(`${label} is required and must be at most ${max} characters.`); return value.trim(); }
function uuid(value: unknown, label: string) { const text = requiredText(value, label, 36); if (!UUID_PATTERN.test(text)) throw new InputError(`${label} is invalid.`); return text; }
function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function providerFailure(cause: unknown) { const message = cause instanceof Error ? cause.message.trim() : ""; return (message || "Resend did not accept the employee email.").slice(0, 500); }
function failure(cause: unknown) { if (cause instanceof InputError || cause instanceof AttachmentError) return Response.json({ error: cause.message }, { status: cause instanceof InputError ? cause.status : 400 }); console.error("Employee email operation failed", cause instanceof Error ? { name: cause.name, message: cause.message } : { name: "UnknownError" }); return Response.json({ error: "Employee email processing failed." }, { status: 500 }); }
