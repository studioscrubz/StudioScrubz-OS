import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261103130000_reuse_cleared_end_job_equipment_signout.sql", "utf8");
const dashboard = readFileSync("components/time/DashboardTimeClockControl.tsx", "utf8");
const service = readFileSync("lib/services/equipmentClearance.ts", "utf8");
const action = readFileSync("components/jobs/JobEquipmentActions.tsx", "utf8");

test("a single cleared End Job submission satisfies both equipment notice and clock-out gate in the same session", () => {
  assert.match(migration, /create or replace function public\.get_my_pending_equipment_signouts\(\)/i);
  assert.match(migration, /create or replace function public\.stop_my_work\(\)/i);
  assert.equal((migration.match(/c\.checkpoint='End Job'/g) ?? []).length, 2);
  assert.equal((migration.match(/c\.status='Cleared'/g) ?? []).length, 2);
  assert.equal((migration.match(/c\.submitted_at is not null/g) ?? []).length, 2);
  assert.match(migration, /c\.submitted_at>=s\.clock_in/);
  assert.match(migration, /c\.submitted_at>=v_session\.clock_in/);
  assert.equal((migration.match(/c\.submitted_at<=j\.completed_at/g) ?? []).length, 2);
  assert.equal((migration.match(/c\.work_session_id is null/g) ?? []).length, 2);
});

test("existing session-matched Final Sign Out stays accepted and permissions stay employee-scoped", () => {
  assert.match(migration, /c\.checkpoint='Final Sign Out' and c\.work_session_id=s\.id/);
  assert.match(migration, /c\.checkpoint='Final Sign Out' and c\.work_session_id=v_session\.id/);
  assert.match(migration, /a\.employee_id=public\.current_employee_id\(\)/);
  assert.match(migration, /a\.released_at is null/);
  assert.match(migration, /return public\.stop_my_work_before_equipment\(\)/);
  assert.match(migration, /grant execute on function public\.get_my_pending_equipment_signouts\(\) to authenticated/);
  assert.match(migration, /grant execute on function public\.stop_my_work\(\) to authenticated/);
});

test("one successful submission refreshes availability and job actions from server state", () => {
  assert.match(service, /if \(!data\) throw new Error/);
  assert.match(service, /dispatchEvent\(new Event\("studioscrubz:equipment-clearance-updated"\)\)/);
  assert.match(dashboard, /addEventListener\("studioscrubz:equipment-clearance-updated"/);
  assert.match(dashboard, /addEventListener\("visibilitychange"/);
  assert.match(dashboard, /getPendingEquipmentSignouts\(\)/);
  assert.match(action, /onSubmitted=\{\(\) => void refresh\(\)/);
});
