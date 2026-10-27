import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const availability = source("components/time/DashboardTimeClockControl.tsx");
const actions = source("components/jobs/JobEquipmentActions.tsx");
const jobs = source("components/jobs/JobsPage.tsx");
const jobService = source("lib/services/jobs.ts");
const migration = source("supabase/migrations/20261027190000_equipment_action_job_access.sql");

test("My Availability displays action links, not historic notices or embedded checklists", () => {
  assert.doesNotMatch(availability, /<EquipmentNotifications\s*\/>/);
  assert.doesNotMatch(availability, /<EquipmentClearanceChecklist/);
  assert.match(availability, /Equipment sign-out pending/);
  assert.match(availability, /getPendingEquipmentSignouts\(\)/);
  assert.match(availability, /&equipment=1/);
  assert.match(availability, /if \(pending\.length\) throw new Error/);
});

test("final sign-out and actionable acknowledgments are inside Manage Job", () => {
  assert.match(jobs, /<JobEquipmentActions jobId=\{job\.id\}/);
  assert.match(actions, /checkpoint="Final Sign Out"/);
  assert.match(actions, /getMyPendingJobEquipmentHandoffs/);
  assert.match(actions, /acknowledgeEquipmentHandoff/);
  assert.doesNotMatch(actions, /EquipmentNotifications/);
});

test("completed financially handed-off jobs are exposed only for the current employee's pending equipment actions", () => {
  assert.match(migration, /get_my_equipment_action_jobs/);
  assert.match(migration, /public\.get_my_pending_equipment_signouts\(\)/);
  assert.match(migration, /handoff\.to_employee_id=public\.current_employee_id\(\)/);
  assert.match(migration, /handoff\.acknowledged_at is null/);
  assert.match(migration, /h\.to_employee_id=public\.current_employee_id\(\)/);
  assert.match(migration, /grant execute on function public\.get_my_equipment_action_jobs\(\) to authenticated/);
  assert.match(jobService, /getMyEquipmentActionJobs/);
  assert.match(jobService, /get_my_equipment_action_jobs/);
});
