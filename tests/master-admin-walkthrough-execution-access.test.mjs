import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const migrationPath = "supabase/migrations/20261005142308_master_admin_walkthrough_execution_access.sql";

test("walkthrough assignees are exactly active linked Master Admins, Managers, and Crew Leads", async () => {
  const [migration, database] = await Promise.all([read(migrationPath), read("types/database.ts")]);
  const assignees = migration.match(/create or replace function public\.get_eligible_walkthrough_assignees[\s\S]*?\$\$;/)?.[0] ?? "";

  assert.match(assignees, /profile\.role in \('Master Admin', 'Manager', 'Crew Lead'\)/);
  assert.match(assignees, /profile\.employee_id = employee\.id/);
  assert.match(assignees, /profile\.is_active/);
  assert.match(assignees, /employee\.employment_status = 'Active'/);
  assert.match(assignees, /employee\.archived_at is null/);
  assert.doesNotMatch(assignees, /Scrub Technician/);
  assert.match(database, /operational_role: "Master Admin" \| "Manager" \| "Crew Lead"/);
});

test("execution is role, assignment, state, archive, and scheduling constrained", async () => {
  const migration = await read(migrationPath);
  const role = migration.match(/create or replace function public\.has_walkthrough_execution_role[\s\S]*?\$\$;/)?.[0] ?? "";
  const performer = migration.match(/create or replace function public\.can_perform_scheduled_walkthrough[\s\S]*?\$\$;/)?.[0] ?? "";
  const submitter = migration.match(/create or replace function public\.submit_assigned_field_walkthrough[\s\S]*?\$\$;/)?.[0] ?? "";

  assert.match(role, /profile\.is_active/);
  assert.match(role, /profile\.role in \('Master Admin', 'Manager', 'Crew Lead'\)/);
  assert.match(role, /profile\.employee_id is not null/);
  assert.doesNotMatch(role, /Scrub Technician/);
  assert.match(performer, /assigned_employee_id = public\.current_employee_id\(\)/);
  assert.match(performer, /status = 'Scheduled'/);
  assert.match(performer, /archived_at is null/);
  assert.match(performer, /walkthrough_date is not null/);
  assert.match(performer, /walkthrough_time is not null/);
  assert.match(submitter, /if not public\.can_perform_scheduled_walkthrough\(p_id\)/);
  assert.match(submitter, /submit_assigned_field_walkthrough_before_manager_transition_20261002/);
});

test("legacy walkthrough validators use the scoped role helper without changing global inheritance", async () => {
  const [migration, prior] = await Promise.all([
    read(migrationPath),
    read("supabase/migrations/20261002143446_manager_scrub_technician_walkthrough_permissions.sql"),
  ]);

  assert.match(migration, /pg_get_functiondef/);
  assert.match(migration, /submit_assigned_field_walkthrough%/);
  assert.match(migration, /public\.has_walkthrough_execution_role\(\)/);
  assert.doesNotMatch(migration, /create or replace function public\.has_any_role/);
  assert.match(prior, /current_user_role\(\) = 'Manager'[\s\S]*'Crew Lead' = any\(p_roles\)/);
  assert.doesNotMatch(prior, /current_user_role\(\) = 'Master Admin'[\s\S]*'Crew Lead' = any\(p_roles\)/);
});

test("the correction is walkthrough-only and preserves the established validator and photo chain", async () => {
  const migration = await read(migrationPath);

  for (const unrelated of ["jobs", "time_entries", "employees", "estimates", "proposals", "pricing"])
    assert.doesNotMatch(migration, new RegExp(`(?:update|insert into|delete from|alter table)\\s+public\\.${unrelated}`, "i"));
  assert.match(migration, /service-specific submitters form a legacy delegation chain/);
  assert.doesNotMatch(migration, /create or replace function public\.set_operational_photos/);
  assert.doesNotMatch(migration, /update\s+public\.walkthroughs/i);
});
