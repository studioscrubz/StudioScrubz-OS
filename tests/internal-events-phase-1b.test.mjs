import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schedule = fs.readFileSync("components/jobs/SchedulePage.tsx", "utf8");
const dialog = fs.readFileSync("components/jobs/InternalEventDialog.tsx", "utf8");
const service = fs.readFileSync("lib/services/internalScheduleEvents.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261010150126_internal_schedule_events_phase_1a.sql", "utf8");

test("internal events join all existing schedule views without replacing job workflows", () => {
  assert.match(schedule, /type View = "Day" \| "Week" \| "List"/);
  assert.match(schedule, /"Jobs",\s*"Walkthroughs",\s*"Internal Events"/);
  assert.match(schedule, /getScheduleJobs\(\)/);
  assert.match(schedule, /getScheduledWalkthroughs\(\)/);
  assert.match(schedule, /kind: "Internal Event"/);
  assert.match(schedule, /<Day[\s\S]*openInternal=/);
  assert.match(schedule, /<ListView[\s\S]*openInternal=/);
});

test("create and mutation controls are access-aware while RLS remains authoritative", () => {
  assert.match(schedule, /internalAccess !== "None"/);
  assert.match(service, /getInternalEventAccessLevel/);
  assert.match(service, /is_current_lead_representative_eligible/);
  assert.doesNotMatch(service, /service[_-]role/i);
  assert.match(migration, /using \(private\.can_view_internal_schedule_event\(id\)\)/);
  assert.match(migration, /private\.current_internal_schedule_access_level\(\) = 'Management'/);
  assert.match(migration, /private\.current_internal_schedule_access_level\(\) = 'Sales'/);
});

test("event editor covers Phase 1B fields, cancellation, and invitee-only RSVP", () => {
  for (const field of ["Title", "Description", "Category", "Meeting Mode", "Start", "End", "Timezone", "Visibility", "Location", "Video Link", "Vendor Name", "Existing Prospect", "Authorized Attendees"]) {
    assert.match(dialog, new RegExp(field));
  }
  assert.match(dialog, /cancelInternalScheduleEvent/);
  assert.match(dialog, /updateInternalEventRsvp/);
  assert.match(dialog, /event\.attendees\.find\([\s\S]*attendee\.employee_id === profile\.employee_id/);
  assert.match(migration, /grant update \(invitation_status\)/);
});

test("database reads use the browser session and return only RLS-visible rows", () => {
  assert.match(service, /getSupabaseClient\(\)/);
  assert.match(service, /from\("internal_schedule_events"\)/);
  assert.match(service, /from\("internal_schedule_event_attendees"\)/);
  assert.doesNotMatch(service, /createSupabaseAdminClient|SUPABASE_SERVICE_ROLE/);
});
