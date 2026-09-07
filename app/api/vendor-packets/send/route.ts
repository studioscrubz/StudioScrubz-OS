import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { hasPermission } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendResendEmail } from "@/lib/email/resend";
import { modules } from "@/lib/vendorPackets/content";
import { renderPacketEmail } from "@/lib/vendorPackets/email";
import type { UserProfile } from "@/types/auth";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class InputError extends Error {}
function text(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new InputError(`${label} is required and must be at most ${max} characters.`);
  return value.trim();
}
function id(value: unknown, label: string) {
  const result = text(value, label, 36);
  if (!uuidPattern.test(result)) throw new InputError(`${label} is invalid.`);
  return result;
}

export async function POST(request: Request) {
  try {
    const session = await createSupabaseServerClient();
    const { data: auth } = await session.auth.getUser();
    if (!auth.user) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { data: row, error: profileError } = await session.from("user_profiles").select("*").eq("id", auth.user.id).single();
    const profile = row as UserProfile | null;
    if (profileError || !profile || !["Sales", "Administrator", "Master Admin"].includes(profile.role) || !hasPermission(profile, "estimates.create") || !hasPermission(profile, "communications.create")) {
      return Response.json({ error: "You do not have permission to email vendor packets." }, { status: 403 });
    }
    const raw = await request.text();
    if (raw.length > 20000) throw new InputError("The email request is too large.");
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { throw new InputError("Invalid email request."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("Invalid email request.");
    const clientId = id(body.clientId, "Client");
    const propertyId = body.propertyId == null || body.propertyId === "" ? null : id(body.propertyId, "Property");
    const requestId = id(body.requestId, "Request identifier");
    const recipientEmail = text(body.recipientEmail, "Recipient email", 320).toLowerCase();
    if (!emailPattern.test(recipientEmail)) throw new InputError("Enter a valid recipient email.");
    const subject = text(body.subject, "Subject", 200);
    if (/[\r\n]/.test(subject)) throw new InputError("Subject must be a single line.");
    const messageBody = text(body.messageBody, "Message", 10000);
    if (!Array.isArray(body.moduleIds) || !body.moduleIds.length || body.moduleIds.length > modules.length || body.moduleIds.some(value => typeof value !== "string" || !modules.some(module => module.id === value))) throw new InputError("Select valid capability modules.");
    const moduleIds = modules.filter(module => (body.moduleIds as string[]).includes(module.id)).map(module => module.id);
    const admin = createSupabaseAdminClient();
    const { data: client, error: clientError } = await admin.from("clients").select("id,first_name,last_name,company_name").eq("id", clientId).is("archived_at", null).single();
    if (clientError || !client) throw new InputError("The selected client is unavailable.");
    let propertyLabel: string | undefined;
    if (propertyId) {
      const { data: property, error } = await admin.from("properties").select("property_name,address,address_line_2,city,state,zip").eq("id", propertyId).eq("client_id", clientId).is("archived_at", null).single();
      if (error || !property) throw new InputError("The selected property is unavailable or does not belong to this client.");
      propertyLabel = [property.property_name, property.address, property.address_line_2, property.city, property.state, property.zip].filter(Boolean).join(", ");
    }
    const { data: business, error: businessError } = await admin.from("business_settings").select("business_name,business_email,business_phone,website").single();
    if (businessError || !business || !emailPattern.test(business.business_email?.trim() ?? "")) return Response.json({ error: "A valid Business Email is required in Business Settings." }, { status: 503 });
    const clientName = client.company_name?.trim() || [client.first_name, client.last_name].filter(Boolean).join(" ") || "Unnamed client";
    const content = renderPacketEmail({ clientName, propertyLabel, businessName: business.business_name, contacts: [business.business_phone, business.business_email, business.website].filter((value): value is string => Boolean(value)), moduleIds, message: messageBody });
    const fingerprint = createHash("sha256").update(JSON.stringify({ clientId, propertyId, moduleIds, recipientEmail, subject, messageBody })).digest("hex").slice(0, 24);
    const eventKey = `vendor-packet:${profile.id}:${requestId}:${fingerprint}`;
    const { data: existing, error: lookupError } = await admin.from("client_communications").select("provider_message_id").eq("event_key", eventKey).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing?.provider_message_id) return Response.json({ providerMessageId: existing.provider_message_id });
    const sent = await sendResendEmail({ recipientEmail, subject, ...content, replyTo: business.business_email.trim().toLowerCase(), idempotencyKey: eventKey });
    // A Sent record is created only after the provider accepts the email.
    const { error: historyError } = await admin.from("client_communications").insert({
      communication_number: `COMM-${randomUUID()}`, client_id: clientId, property_id: propertyId,
      communication_type: "General", channel: "Email", direction: "Outbound", status: "Sent",
      recipient_email: recipientEmail, subject, message_body: messageBody, sent_at: new Date().toISOString(),
      provider: "resend", provider_message_id: sent.id, sent_by_user_id: profile.id,
      sent_by_name: profile.display_name || profile.email || profile.role, event_key: eventKey,
      metadata: { event: "Vendor Packet Sent", selected_module_ids: moduleIds, selected_capability_modules: modules.filter(module => moduleIds.includes(module.id)).map(module => module.title), recipient: recipientEmail, subject },
    });
    if (historyError && historyError.code !== "23505") {
      console.error("Vendor packet accepted but communication history failed", historyError.code);
      return Response.json({ providerMessageId: sent.id, warning: "Email sent, but client history could not be recorded. Do not resend the email to fix history." });
    }
    return Response.json({ providerMessageId: sent.id });
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "The email could not be confirmed as sent. Please try again." }, { status: 502 });
  }
}
