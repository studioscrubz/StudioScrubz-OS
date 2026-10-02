import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const migrationPath = "supabase/migrations/20261002143446_manager_scrub_technician_walkthrough_permissions.sql";

test("Manager inherits the complete Crew Lead application permission set", async () => {
  const permissions = await read("lib/auth/permissions.ts");
  const manager = permissions.slice(permissions.indexOf("Manager: new Set(["), permissions.indexOf("Sales: new Set(["));
  const crewLead = permissions.slice(permissions.indexOf('"Crew Lead": new Set('), permissions.indexOf('"Scrub Technician": new Set(['));

  assert.match(manager, /\.\.\.crewLeadPermissions/);
  assert.match(crewLead, /new Set\(crewLeadPermissions\)/);
  assert.match(permissions, /\["Manager", "Crew Lead"\]\.includes\(profile\.role\)/);
  assert.match(permissions, /\["\/field-walkthroughs", "walkthroughs\.field"\]/);
});

test("Scrub Technician loses only field walkthrough permission", async () => {
  const permissions = await read("lib/auth/permissions.ts");
  const scrubTech = permissions.slice(permissions.indexOf('"Scrub Technician": new Set(['), permissions.indexOf("export function hasPermission"));

  assert.doesNotMatch(scrubTech, /walkthroughs\.field/);
  for (const permission of [
    "porterVisits.view", "dashboard.view", "jobs.view", "schedule.view",
    "employees.directory_view", "employees.scrubTechRosterView", "timeClock.view",
    "clients.view", "properties.view", "vehicles.view", "attention.view",
    "messages.view", "messages.send", "appearance.view",
  ]) {
    assert.match(scrubTech, new RegExp(permission.replace(".", "\\.")));
  }
});

test("walkthrough assignment options include only active Managers and Crew Leads", async () => {
  const [migration, modal, service, database] = await Promise.all([
    read(migrationPath),
    read("components/walkthroughs/WalkthroughFormModal.tsx"),
    read("lib/services/walkthroughs.ts"),
    read("types/database.ts"),
  ]);

  assert.match(migration, /profile\.role in \('Manager', 'Crew Lead'\)/);
  assert.match(migration, /employee\.employment_status = 'Active'/);
  assert.match(migration, /employee\.archived_at is null/);
  assert.doesNotMatch(migration.match(/create function public\.get_eligible_walkthrough_assignees\(\)[\s\S]*?\$\$;/)?.[0] ?? "", /Scrub Technician/);
  assert.match(modal, /getEligibleWalkthroughAssignees\(\)/);
  assert.doesNotMatch(modal, /getEligibleJobTechs/);
  assert.match(service, /rpc\("get_eligible_walkthrough_assignees"\)/);
  assert.match(database, /get_eligible_walkthrough_assignees/);
});

test("database field execution permits assigned Managers and Crew Leads but rejects Scrub Technicians", async () => {
  const migration = await read(migrationPath);
  const performer = migration.match(/create or replace function public\.can_perform_scheduled_walkthrough[\s\S]*?\$\$;/)?.[0] ?? "";
  const getter = migration.match(/create function public\.get_assigned_field_walkthroughs\(\)[\s\S]*?\$\$;/)?.[0] ?? "";
  const submitter = migration.match(/create function public\.submit_assigned_field_walkthrough[\s\S]*?\$\$;/)?.[0] ?? "";

  assert.match(performer, /current_user_role\(\) in \('Manager', 'Crew Lead'\)/);
  assert.match(performer, /assigned_employee_id = public\.current_employee_id\(\)/);
  assert.doesNotMatch(performer, /Scrub Technician/);
  assert.match(getter, /current_user_role\(\) not in \('Manager', 'Crew Lead'\)/);
  assert.match(getter, /current_user_role\(\) <> 'Master Admin'/);
  assert.match(submitter, /current_user_role\(\) not in \('Manager', 'Crew Lead'\)/);
  assert.doesNotMatch(submitter, /Scrub Technician/);
});

test("internal legacy RPCs are not callable and normal Job technician eligibility is unchanged", async () => {
  const [migration, jobEligibility] = await Promise.all([
    read(migrationPath),
    read("supabase/migrations/20260928180955_allow_sales_load_eligible_walkthrough_technicians.sql"),
  ]);

  assert.match(migration, /revoke all on function public\.get_assigned_field_walkthroughs_before_manager_transition_20261002\(\)\s+from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.submit_assigned_field_walkthrough_before_manager_transition_20261002\(uuid, jsonb, boolean\)\s+from public, anon, authenticated/);
  assert.match(jobEligibility, /up\.role in \('Scrub Technician', 'Crew Lead'\)/);
});

test("the migration preserves historical walkthrough attribution and normal Job photo access", async () => {
  const [migration, photoBoundary] = await Promise.all([
    read(migrationPath),
    read("supabase/migrations/20260906174822_secure_scheduled_walkthrough_assignment.sql"),
  ]);

  assert.doesNotMatch(migration, /update\s+public\.walkthroughs/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.walkthroughs/i);
  assert.match(photoBoundary, /p_record_type = 'jobs'/);
  assert.match(photoBoundary, /v_role in \('Crew Lead', 'Scrub Technician'\)/);
});
