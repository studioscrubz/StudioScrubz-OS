import "server-only";



import { createHash, createHmac } from "node:crypto";

import { sendResendEmail } from "@/lib/email/resend";

import { resolveEmailSenderProfile } from "@/lib/email/senderProfiles";

import { escapeEmailHtml } from "@/lib/email/studioScrubzTemplate";

import { getPublicSiteUrl } from "@/lib/publicSiteUrl";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";



const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

type Method = "REQUEST" | "CANCEL";

type Delivery = {

  id: string; event_key: string; event_id: string; employee_id: string;

  recipient_name: string; recipient_email: string | null; event_snapshot: EventSnapshot;

  calendar_uid: string; calendar_sequence: number; method: Method;

  status: "Pending" | "Accepted" | "Failed" | "Unavailable";

  provider_submission_started_at: string | null;

};

type EventSnapshot = {

  title: string; description: string | null; starts_at: string; ends_at: string;

  timezone: string; location: string | null; meet_url: string | null;

  organizer_name: string; organizer_email: string | null;

};



export type InvitationDispatchResult = {

  accepted: number; failed: number; unavailable: number; pending: number;

  warning: string | null;

};



export async function dispatchInternalEventInvitations(eventId: string, sendCurrent: boolean): Promise<InvitationDispatchResult> {

  const admin = createSupabaseAdminClient();

  const { data: event, error } = await admin.from("internal_schedule_events")

    .select("id,title,description,starts_at,ends_at,timezone,location,status,organizer_user_id,calendar_sequence")

    .eq("id", eventId).single();

  if (error || !event) throw error ?? new Error("Internal event not found.");

  const [{ data: sync }, { data: organizer }, { data: attendees }, priorResult] = await Promise.all([

    admin.from("internal_schedule_event_google_syncs").select("google_meet_url").eq("event_id", eventId).maybeSingle(),

    admin.from("user_profiles").select("display_name,email").eq("id", event.organizer_user_id).single(),

    admin.from("internal_schedule_event_attendees").select("employee_id,employee:employees(id,first_name,last_name,preferred_name,email,employment_status,archived_at)").eq("event_id", eventId),

    admin.from("internal_schedule_event_invitation_deliveries").select("employee_id,recipient_email,recipient_name,calendar_sequence").eq("event_id", eventId).eq("method", "REQUEST").eq("status", "Accepted").order("calendar_sequence", { ascending: false }),

  ]);

  if (priorResult.error) throw priorResult.error;
  const prior = priorResult.data;
  const current = new Map<string, Record<string, unknown>>();

  for (const item of attendees ?? []) {

    const employee = Array.isArray(item.employee) ? item.employee[0] : item.employee;

    if (employee) current.set(item.employee_id, employee as Record<string, unknown>);

  }

  // Use the original delivered address for cancellations. The employee's current
  // employment status or email may have changed since the invitation was sent.
  const previous = new Map<string, { recipient_email: string | null; recipient_name: string }>();
  for (const row of prior ?? []) {
    if (!previous.has(row.employee_id)) previous.set(row.employee_id, row);
  }

  const targets: Array<{ employeeId: string; employee: Record<string, unknown>; method: Method; priorEmail?: string | null; priorName?: string }> = [];
  if (sendCurrent && event.status === "Scheduled") {
    for (const [employeeId, employee] of current) targets.push({ employeeId, employee, method: "REQUEST" });
  }
  for (const [employeeId, earlier] of previous) {
    if (event.status !== "Canceled" && current.has(employeeId)) continue;
    targets.push({
      employeeId,
      employee: current.get(employeeId) ?? {},
      method: "CANCEL",
      priorEmail: earlier.recipient_email,
      priorName: earlier.recipient_name,
    });
  }

  const snapshot: EventSnapshot = {

    title: event.title, description: event.description, starts_at: event.starts_at, ends_at: event.ends_at,

    timezone: event.timezone, location: event.location, meet_url: sync?.google_meet_url ?? null,

    organizer_name: organizer?.display_name?.trim() || organizer?.email || "StudioScrubz",

    organizer_email: organizer?.email?.trim().toLowerCase() || null,

  };

  const deliveries: Delivery[] = [];

  for (const target of targets) deliveries.push(await prepare(admin, eventId, event.calendar_sequence, snapshot, target));

  const results: Delivery[] = [];

  for (const delivery of deliveries) results.push(await deliver(admin, delivery));

  const counts = { accepted: results.filter(x => x.status === "Accepted").length, failed: results.filter(x => x.status === "Failed").length, unavailable: results.filter(x => x.status === "Unavailable").length, pending: results.filter(x => x.status === "Pending").length };

  return { ...counts, warning: counts.failed || counts.unavailable || counts.pending ? `Event saved, but ${counts.failed + counts.unavailable + counts.pending} calendar invitation${counts.failed + counts.unavailable + counts.pending === 1 ? "" : "s"} require attention.` : null };

}



async function employeeRow(admin: Admin, employeeId: string) {

  const { data, error } = await admin.from("employees").select("id,first_name,last_name,preferred_name,email,employment_status,archived_at").eq("id", employeeId).single();

  if (error || !data) throw error ?? new Error("Employee not found.");

  return data as Record<string, unknown>;

}



async function prepare(admin: Admin, eventId: string, sequence: number, snapshot: EventSnapshot, target: { employeeId: string; employee: Record<string, unknown>; method: Method; priorEmail?: string | null; priorName?: string }): Promise<Delivery> {

  const name = target.priorName || String(target.employee.preferred_name || `${target.employee.first_name ?? ""} ${target.employee.last_name ?? ""}`).trim() || "Employee";

  const rawEmail = typeof target.employee.email === "string" ? target.employee.email.trim().toLowerCase() : "";

  const eligible = target.employee.employment_status === "Active" && !target.employee.archived_at && EMAIL.test(rawEmail);

  const uid = `internal-event-${eventId}@studioscrubz.com`;

  const eventKey = `internal-calendar:${eventId}:${target.employeeId}:${sequence}:${target.method.toLowerCase()}`;

  const token = target.method === "REQUEST" ? rsvpToken(eventKey) : null;

  const record = {

    event_key: eventKey, event_id: eventId, employee_id: target.employeeId, calendar_uid: uid,

    calendar_sequence: sequence, method: target.method, recipient_name: name,

    recipient_email: eligible ? rawEmail : null, event_snapshot: snapshot,

    rsvp_token_hash: token ? createHash("sha256").update(token).digest("hex") : null,

    status: eligible ? "Pending" : "Unavailable", provider: "resend",

    ...(eligible ? {} : { failed_at: new Date().toISOString(), failure_reason: "Employee is inactive, archived, or has no valid email address." }),

  };

  const { data, error } = await admin.from("internal_schedule_event_invitation_deliveries").insert(record).select("*").single();

  if (!error && data) return data as Delivery;

  if (error?.code !== "23505") throw error ?? new Error("Invitation delivery could not be prepared.");

  const existing = await admin.from("internal_schedule_event_invitation_deliveries").select("*").eq("event_key", eventKey).single();

  if (existing.error || !existing.data) throw existing.error ?? new Error("Invitation delivery could not be recovered.");

  return existing.data as Delivery;

}



async function deliver(admin: Admin, delivery: Delivery): Promise<Delivery> {

  if (!delivery.recipient_email || delivery.status === "Accepted" || delivery.status === "Unavailable") return delivery;

  const receipt = await admin.from("internal_schedule_event_invitation_provider_submissions").select("provider_message_id,accepted_at").eq("delivery_id", delivery.id).maybeSingle();

  if (receipt.error) throw receipt.error;
  if (receipt.data) return finalize(admin, delivery.id, receipt.data.provider_message_id, receipt.data.accepted_at);

  // Once a provider submission was started, its outcome may be unknown. Never
  // automatically replay it: doing so could duplicate an accepted invitation.
  if (delivery.provider_submission_started_at) return delivery;

  // Only failures occurring before provider submission can be safely retried.
  if (delivery.status === "Failed") {
    const reset = await admin.from("internal_schedule_event_invitation_deliveries")
      .update({ status: "Pending", failed_at: null, failure_reason: null })
      .eq("id", delivery.id).eq("status", "Failed")
      .is("provider_submission_started_at", null).select("*").maybeSingle();
    if (reset.error) throw reset.error;
    if (!reset.data) return delivery;
    delivery = reset.data as Delivery;
  }

  const claim = await admin.from("internal_schedule_event_invitation_deliveries").update({ provider_submission_started_at: new Date().toISOString() }).eq("id", delivery.id).eq("status", "Pending").is("provider_submission_started_at", null).select("*").maybeSingle();

  if (claim.error) throw claim.error;

  if (!claim.data) return delivery;
  delivery = claim.data as Delivery;

  const recipientEmail = delivery.recipient_email;
  if (!recipientEmail) return delivery;

  try {

    const token = delivery.method === "REQUEST" ? rsvpToken(delivery.event_key) : null;

    const content = invitationContent(delivery, token);

    const sent = await sendResendEmail({ recipientEmail, subject: content.subject, text: content.text, html: content.html, idempotencyKey: delivery.event_key, ...resolveEmailSenderProfile("general"), attachments: [{ filename: "studioscrubz-event.ics", content: Buffer.from(content.ics).toString("base64"), contentType: `text/calendar; charset=utf-8; method=${delivery.method}` }] });

    const acceptedAt = new Date().toISOString();

    const saved = await admin.from("internal_schedule_event_invitation_provider_submissions").insert({ delivery_id: delivery.id, event_key: delivery.event_key, provider_message_id: sent.id, accepted_at: acceptedAt });

    if (saved.error && saved.error.code !== "23505") throw saved.error;

    return finalize(admin, delivery.id, sent.id, acceptedAt);

  } catch (cause) {

    const reason = (cause instanceof Error ? cause.message : "Resend did not accept the invitation.").slice(0, 500);

    const result = await admin.from("internal_schedule_event_invitation_deliveries").update({ status: "Failed", failed_at: new Date().toISOString(), failure_reason: reason }).eq("id", delivery.id).select("*").single();

    if (result.error || !result.data) throw result.error ?? cause;

    return result.data as Delivery;

  }

}



async function finalize(admin: Admin, id: string, providerMessageId: string, acceptedAt: string) {

  const result = await admin.from("internal_schedule_event_invitation_deliveries").update({ status: "Accepted", provider_message_id: providerMessageId, accepted_at: acceptedAt, failed_at: null, failure_reason: null }).eq("id", id).select("*").single();

  if (result.error || !result.data) throw result.error ?? new Error("Invitation acceptance could not be finalized.");

  return result.data as Delivery;

}



function invitationContent(delivery: Delivery, token: string | null) {

  const s = delivery.event_snapshot;

  const canceled = delivery.method === "CANCEL";

  const where = s.meet_url || s.location || "Location to be confirmed";

  const subject = canceled ? `Canceled: ${s.title}` : `Invitation: ${s.title}`;

  const responseLinks = token ? (["Accepted", "Tentative", "Declined"] as const).map(response => `<a href="${escapeEmailHtml(`${getPublicSiteUrl()}/internal-event/rsvp/${encodeURIComponent(token)}?response=${response}`)}" style="display:inline-block;margin:8px 8px 0 0;padding:10px 14px;border-radius:7px;background:#143D1A;color:#fff;text-decoration:none;font-weight:bold">${response === "Accepted" ? "Accept" : response === "Declined" ? "Decline" : "Tentative"}</a>`).join("") : "";

  const text = `${canceled ? "This event has been canceled." : "You are invited to an internal StudioScrubz event."}\n\n${s.title}\n${formatWhen(s)}\n${where}${s.description ? `\n\n${s.description}` : ""}`;

  const html = `<h1 style="margin:0 0 16px;color:#143D1A;font-size:24px">${escapeEmailHtml(subject)}</h1><p>${escapeEmailHtml(canceled ? "This event has been canceled." : "You are invited to an internal StudioScrubz event.")}</p><p><strong>When:</strong> ${escapeEmailHtml(formatWhen(s))}<br><strong>Where:</strong> ${s.meet_url ? `<a href="${escapeEmailHtml(s.meet_url)}">Google Meet</a>` : escapeEmailHtml(where)}<br><strong>Organizer:</strong> ${escapeEmailHtml(s.organizer_name)}</p>${s.description ? `<div style="white-space:pre-wrap">${escapeEmailHtml(s.description)}</div>` : ""}${responseLinks ? `<div style="margin-top:18px">${responseLinks}</div>` : ""}`;

  return { subject, text, html, ics: buildInternalEventIcs({ delivery, recipientEmail: delivery.recipient_email!, recipientName: delivery.recipient_name }) };

}



function formatWhen(s: EventSnapshot) { return `${new Date(s.starts_at).toLocaleString("en-US", { timeZone: s.timezone, dateStyle: "full", timeStyle: "short" })} – ${new Date(s.ends_at).toLocaleTimeString("en-US", { timeZone: s.timezone, timeStyle: "short" })} (${s.timezone})`; }

function rsvpToken(eventKey: string) { const secret = process.env.INTERNAL_EVENT_RSVP_SECRET; if (!secret || secret.length < 32) throw new Error("Internal event RSVP signing secret is not configured."); return createHmac("sha256", secret).update(eventKey).digest("base64url"); }

function icsText(value: string) { return value.replaceAll("\\", "\\\\").replaceAll("\r\n", "\n").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;"); }

function icsDate(value: string) { return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }

function fold(line: string) { const chunks: string[] = []; let rest = line; while (Buffer.byteLength(rest, "utf8") > 73) { let cut = 73; while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 73) cut--; chunks.push(rest.slice(0, cut)); rest = rest.slice(cut); } chunks.push(rest); return chunks.join("\r\n "); }

export function buildInternalEventIcs(input: { delivery: Pick<Delivery, "calendar_uid" | "calendar_sequence" | "method" | "event_snapshot">; recipientEmail: string; recipientName: string }) {

  const { delivery, recipientEmail, recipientName } = input; const s = delivery.event_snapshot; const location = s.meet_url || s.location || "";

  return ["BEGIN:VCALENDAR", "PRODID:-//StudioScrubz//Internal Schedule//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", `METHOD:${delivery.method}`, "BEGIN:VEVENT", `UID:${delivery.calendar_uid}`, `SEQUENCE:${delivery.calendar_sequence}`, `DTSTAMP:${icsDate(new Date().toISOString())}`, `DTSTART:${icsDate(s.starts_at)}`, `DTEND:${icsDate(s.ends_at)}`, `SUMMARY:${icsText(s.title)}`, `DESCRIPTION:${icsText(s.description || "")}`, `LOCATION:${icsText(location)}`, `ORGANIZER;CN=${icsText(s.organizer_name)}:mailto:${s.organizer_email || "notifications@studioscrubz.com"}`, `ATTENDEE;CN=${icsText(recipientName)};RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${recipientEmail}`, `STATUS:${delivery.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT", "END:VCALENDAR", ""].map(fold).join("\r\n");

}
