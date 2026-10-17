import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("lib/services/internalScheduleEvents.ts", "utf8");
const schedule = readFileSync("components/jobs/SchedulePage.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20261011012800_repair_internal_schedule_authorization.sql",
  "utf8",
);
const masterAdminMigration = readFileSync(
  "supabase/migrations/20261011015607_allow_master_admin_user_organized_internal_events.sql",
  "utf8",
);
const createEventMigration = readFileSync(
  "supabase/migrations/20261011155011_internal_schedule_google_meet_and_related_clients.sql",
  "utf8",
);
const visibilityMigration = readFileSync(
  "supabase/migrations/20261011190000_internal_schedule_visibility_v2.sql",
  "utf8",
);
const insertRlsRepair = readFileSync(
  "supabase/migrations/20261017181129_repair_internal_schedule_event_insert_returning_rls.sql",
  "utf8",
);
const insertRlsRegression = readFileSync(
  "supabase/tests/internal_schedule_event_insert_rls_regression_local.sql",
  "utf8",
);

test("internal schedule access comes from the RLS authorization model", () => {
  assert.match(service, /rpc\(\s*"get_current_internal_schedule_access_level"/);
  assert.doesNotMatch(service, /profile\.role === "Master Admin"/);
  assert.match(migration, /profile\.role in \('Master Admin', 'Administrator'\) then 'Management'/);
  assert.match(migration, /profile\.role in \('Sales', 'Lead Representative'\)/);
  assert.match(migration, /private\.is_eligible_lead_representative_employee\(profile\.employee_id\)/);
  assert.match(migration, /employee\.employment_status = 'Active'/);
  assert.match(migration, /employee\.archived_at is null/);
});

test("the public helpers remain authenticated and narrowly scoped", () => {
  assert.match(migration, /revoke all on function public\.get_current_internal_schedule_access_level\(\)[\s\S]*from public, anon, authenticated, service_role;/);
  assert.match(migration, /grant execute on function public\.get_current_internal_schedule_access_level\(\)\s+to authenticated;/);
  assert.match(migration, /private\.internal_schedule_employee_is_authorized\(employee\.id\)/);
  assert.doesNotMatch(migration, /grant all|to anon|disable row level security/i);
});

test("authorized users see a clear failure while the header action stays responsive", () => {
  assert.match(schedule, /Internal event access could not be verified/);
  assert.match(schedule, /Internal Event access requires this account to be linked to an active employee/);
  assert.match(schedule, /internalAccessDiagnostic\(profile, level\)/);
  assert.match(schedule, /!internalEventCandidateRoles\.has\(profile\.role\)/);
  assert.match(schedule, /Create Internal Event/);
  assert.match(schedule, /flex flex-wrap items-start justify-between/);
  assert.doesNotMatch(schedule, /authorization failed[\s\S]{0,180}setInternalAccess\("None"\);\s*\}\);/);
});

test("active Master Admin accounts can organize events without employee linkage", () => {
  assert.match(masterAdminMigration, /profile\.role = 'Master Admin' then 'Management'/);
  assert.match(masterAdminMigration, /profile\.role = 'Master Admin' and p_employee_id is null/);
  assert.match(masterAdminMigration, /alter column organizer_employee_id drop not null/);
  assert.match(masterAdminMigration, /organizer_user_id = \(select auth\.uid\(\)\)/);
  assert.match(service, /profile\.role !== "Master Admin"/);
  assert.match(createEventMigration, /actor_profile\.id, actor_profile\.employee_id/);
});

test("employee linkage remains mandatory outside Master Admin", () => {
  assert.match(masterAdminMigration, /when employee\.id is null[\s\S]*then 'None'/);
  assert.match(masterAdminMigration, /profile\.employee_id = p_employee_id/);
  assert.doesNotMatch(masterAdminMigration, /Scrub Technician' then '(Management|Sales)'/);
});

test("Master Admin creation avoids INSERT RETURNING visibility snapshot rejection", () => {
  const createBranch = insertRlsRepair.match(
    /if p_event_id is null then([\s\S]*?)\n  else/,
  )?.[1] ?? "";
  assert.match(visibilityMigration, /create or replace function private\.can_view_internal_schedule_event/);
  assert.match(visibilityMigration, /from public\.internal_schedule_events e/);
  assert.match(createBranch, /new_event_id := extensions\.gen_random_uuid\(\)/);
  assert.match(createBranch, /insert into public\.internal_schedule_events\([\s\S]*?new_event_id,/);
  assert.doesNotMatch(createBranch, /returning/);
  assert.match(
    insertRlsRepair,
    /select \* into saved[\s\S]*from public\.internal_schedule_events[\s\S]*where id = new_event_id;/,
  );
});

test("the repair preserves authenticated organizer identity and restrictive RLS", () => {
  assert.match(insertRlsRepair, /language plpgsql\s+security invoker/);
  assert.match(insertRlsRepair, /where id = auth\.uid\(\)/);
  assert.match(
    insertRlsRepair,
    /actor_profile\.id,[\s\S]*actor_profile\.employee_id, p_visibility/,
  );
  assert.match(masterAdminMigration, /profile\.role = 'Master Admin' and p_employee_id is null/);
  assert.match(masterAdminMigration, /organizer_user_id = \(select auth\.uid\(\)\)/);
  assert.match(
    visibilityMigration,
    /private\.internal_schedule_access_level\(auth\.uid\(\)\)='Sales'[\s\S]*organizer_employee_id=current_employee_id\(\)[\s\S]*visibility in \('Authorized attendees only','Company-wide'\)/,
  );
  assert.doesNotMatch(insertRlsRepair, /security definer|grant[^;]+service_role|disable row level security/i);
});

test("transactional coverage includes authorized and unauthorized creation", () => {
  assert.match(insertRlsRegression, /'Master Admin', true, null/);
  assert.match(insertRlsRegression, /from public\.save_internal_schedule_event/);
  assert.match(insertRlsRegression, /created\.organizer_employee_id is not null/);
  assert.match(insertRlsRegression, /'Scrub Technician', true/);
  assert.match(insertRlsRegression, /when insufficient_privilege or check_violation then null/);
  assert.match(insertRlsRegression, /rollback;/);
});
