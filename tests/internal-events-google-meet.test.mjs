import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dialog = fs.readFileSync("components/jobs/InternalEventDialog.tsx", "utf8");
const service = fs.readFileSync("lib/services/internalScheduleEvents.ts", "utf8");
const route = fs.readFileSync("app/api/internal-schedule-events/route.ts", "utf8");
const dynamicRoute = fs.readFileSync("app/api/internal-schedule-events/[eventId]/route.ts", "utf8");
const google = fs.readFileSync("lib/google-calendar/internal-events.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261011155011_internal_schedule_google_meet_and_related_clients.sql", "utf8");

test("new event modes exclude Hybrid while retaining legacy database compatibility", () => {
  assert.match(dialog, /INTERNAL_EVENT_MODES\.map/);
  assert.doesNotMatch(dialog, /Hybrid/);
  assert.match(migration, /'Phone', 'Video', 'In Person', 'Video Meeting', 'Phone Call'/);
});

test("video meetings use server-side Google conference creation with stable identifiers", () => {
  assert.match(google, /conferenceDataVersion=1/);
  assert.match(google, /conferenceSolutionKey: \{ type: "hangoutsMeet" \}/);
  assert.match(google, /conferenceRequestId\(eventId\)/);
  assert.match(google, /sendUpdates=none/);
  assert.match(google, /status !== 409/);
  assert.match(google, /status !== 404/);
  assert.doesNotMatch(service, /GOOGLE_CALENDAR_CLIENT_SECRET|encrypted_refresh_token/);
});

test("updates and cancellations synchronize only the stored event", () => {
  assert.match(dynamicRoute, /export async function PATCH/);
  assert.match(dynamicRoute, /export async function DELETE/);
  assert.match(google, /sync\?\.google_event_id/);
  assert.match(google, /method: "DELETE"/);
  assert.match(google, /internal_schedule_event_google_syncs/);
});

test("mutation authorization remains session and RLS based", () => {
  assert.match(route, /createSupabaseServerClient/);
  assert.match(route, /get_current_internal_schedule_access_level/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /private\.can_view_internal_schedule_event\(event_id\)/);
  assert.doesNotMatch(service, /service[_-]role|createSupabaseAdminClient/i);
});

test("phone snapshots and conditional form validation are present", () => {
  assert.match(dialog, /type="tel"/);
  assert.match(dialog, /href=\{`tel:/);
  assert.match(dialog, /callPhoneNumber: prospect\?\.business_phone \?\? client\?\.phone/);
  assert.match(migration, /call_phone_number text/);
  assert.match(migration, /meeting_mode <> 'Phone Call'/);
  assert.match(migration, /meeting_mode <> 'In Person'/);
});
