import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261001213557_enforce_active_employee_platform_presence.sql",
    import.meta.url,
  ),
  "utf8",
);

function eligible({ profileActive, employeeExists, employmentStatus, archivedAt }) {
  return profileActive
    && employeeExists
    && employmentStatus === "Active"
    && archivedAt === null;
}

test("active profile linked to an active, non-archived employee remains eligible", () => {
  assert.equal(eligible({
    profileActive: true,
    employeeExists: true,
    employmentStatus: "Active",
    archivedAt: null,
  }), true);
});

test("active profile linked to an inactive employee is rejected", () => {
  assert.equal(eligible({
    profileActive: true,
    employeeExists: true,
    employmentStatus: "Inactive",
    archivedAt: null,
  }), false);
});

test("active profile linked to an archived employee is rejected", () => {
  assert.equal(eligible({
    profileActive: true,
    employeeExists: true,
    employmentStatus: "Active",
    archivedAt: "2026-10-01T00:00:00.000Z",
  }), false);
});

test("active profile with no linked employee is rejected", () => {
  assert.equal(eligible({
    profileActive: true,
    employeeExists: false,
    employmentStatus: "Active",
    archivedAt: null,
  }), false);
});

test("start_my_work enforces employee eligibility before preserving the existing session path", () => {
  assert.match(migration, /create or replace function public\.start_my_work\(\)/);
  assert.match(migration, /v_employee_id:=public\.current_employee_id\(\)/);
  assert.match(migration, /from public\.employees employee/);
  assert.match(migration, /employee\.id=v_employee_id/);
  assert.match(migration, /employee\.employment_status='Active'/);
  assert.match(migration, /employee\.archived_at is null/);
  assert.ok(
    migration.indexOf("employee.archived_at is null")
      < migration.indexOf("return public.ensure_employee_platform_active(v_employee_id)"),
  );
});

test("the migration preserves the narrow start RPC grant without broader employee or HR access", () => {
  assert.match(migration, /security definer\s+set search_path=''/);
  assert.match(
    migration,
    /revoke all on function public\.start_my_work\(\) from public,anon,authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.start_my_work\(\) to authenticated/,
  );
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete).*employees/i);
  assert.doesNotMatch(migration, /create or replace function public\.(?:current_employee_id|get_active_scrub_technicians|start_or_clock_in_to_job)/);
});
