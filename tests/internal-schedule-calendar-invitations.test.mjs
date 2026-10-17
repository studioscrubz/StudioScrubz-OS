import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20261017181925_internal_schedule_attendee_calendar_invitations.sql");
const delivery = read("lib/internal-schedule/calendarInvitation.ts");
const api = read("lib/internal-schedule/api.ts");
const google = read("lib/google-calendar/internal-events.ts");
const dialog = read("components/jobs/InternalEventDialog.tsx");

test("calendar mail is private RFC 5545 request/update/cancellation content", () => {
  for (const required of ["BEGIN:VCALENDAR", "VERSION:2.0", "METHOD:${delivery.method}", "BEGIN:VEVENT", "UID:${delivery.calendar_uid}", "SEQUENCE:${delivery.calendar_sequence}", "DTSTART:", "DTEND:", "ORGANIZER;CN=", "ATTENDEE;CN=", "RSVP=TRUE", "STATUS:${delivery.method === \"CANCEL\""]) assert.match(delivery, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(delivery, /targets\.push\(\{ employeeId, employee, method: "REQUEST" \}\)/);
  assert.doesNotMatch(delivery, /to:\s*\[[^\]]*,/);
  assert.match(delivery, /attachments:\s*\[\{ filename: "studioscrubz-event\.ics"/);
});

test("delivery remains post-save, durable, idempotent, and retryable", () => {
  assert.match(api, /syncInternalScheduleEventGoogle\(eventId\)/);
  assert.match(api, /dispatchInternalEventInvitations\(eventId, sendCalendarInvitations\)/);
  assert.match(api, /Event saved, but calendar invitation processing failed/);
  assert.match(migration, /event_key text not null unique/);
  assert.match(migration, /unique \(event_id, employee_id, calendar_sequence, method\)/);
  assert.match(migration, /provider receipts are append-only/i);
  assert.match(delivery, /Idempotency|idempotencyKey: delivery\.event_key/i);
});

test("RSVP token updates only its associated attendee and status access remains authorized", () => {
  assert.match(migration, /rsvp_token_hash = encode\(extensions\.digest/);
  assert.match(migration, /attendee\.event_id = delivery\.event_id and attendee\.employee_id = delivery\.employee_id/);
  assert.match(migration, /p_response not in \('Accepted', 'Tentative', 'Declined'\)/);
  assert.match(migration, /private\.internal_schedule_can_view_event\(p_event_id\)/);
  assert.match(migration, /revoke all on table public\.internal_schedule_event_invitation_deliveries from public, anon, authenticated/);
});

test("Google sync does not send its own attendee notifications and UI defaults invitation sending on", () => {
  assert.match(google, /sendUpdates=none/g);
  assert.match(dialog, /Send Calendar Invitations/);
  assert.match(dialog, /sendCalendarInvitations: true/);
  assert.match(dialog, /Email \$\{attendee\.delivery_status\}/);
  assert.match(dialog, /Retry Invitations/);
});
