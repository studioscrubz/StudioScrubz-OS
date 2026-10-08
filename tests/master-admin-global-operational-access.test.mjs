import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const permissions = readFileSync("lib/auth/permissions.ts", "utf8");
const page = readFileSync("components/walkthroughs/FieldWalkthroughsPage.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20261008010000_master_admin_operational_assignment_override.sql", "utf8");

test("Master Admin retains the centralized complete application permission set", () => {
  assert.match(permissions, /"Master Admin": new Set\(PERMISSIONS\)/);
  assert.match(permissions, /hasOperationalRecordOverride = isMasterAdmin/);
  assert.match(page, /hasOperationalRecordOverride\(profile\)/);
});

test("Master Admin can operate another employee's scheduled walkthrough without reassignment", () => {
  assert.match(migration, /public\.is_master_admin\(\)\s*or\s*\(\s*public\.has_walkthrough_execution_role\(\)/);
  assert.match(migration, /not public\.is_master_admin\(\) and walkthrough\.assigned_employee_id is distinct from employee/);
  assert.match(migration, /not public\.is_master_admin\(\) and w\.assigned_employee_id is distinct from e/);
  assert.doesNotMatch(migration, /update\s+public\.walkthroughs[\s\S]*assigned_employee_id\s*=/i);
});

test("ordinary users remain assignment-scoped and workflow validation remains authoritative", () => {
  assert.match(migration, /walkthrough\.assigned_employee_id = public\.current_employee_id\(\)/);
  assert.match(migration, /walkthrough\.status = 'Scheduled'/);
  assert.match(migration, /walkthrough\.archived_at is null/);
  assert.match(migration, /walkthrough\.walkthrough_date is not null/);
  assert.match(migration, /walkthrough\.walkthrough_time is not null/);
  assert.match(migration, /procedure\.proname like 'submit_assigned_field_walkthrough%'/);
});
