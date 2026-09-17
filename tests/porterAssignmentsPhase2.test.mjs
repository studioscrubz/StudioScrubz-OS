import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260917144303_porter_assignment_phase_2.sql", import.meta.url), "utf8");

test("phase 2 adds structured roles and mutually exclusive worker assignments", () => {
  assert.match(migration, /create table public\.employee_service_roles/);
  assert.match(migration, /service_role in \('Porter Tech','Porter Manager'\)/);
  assert.match(migration, /assigned_manager_employee_id uuid references public\.employees/);
  assert.match(migration, /assigned_worker_employee_id uuid references public\.employees/);
  assert.match(migration, /assigned_worker_crew_id uuid references public\.crews/);
  assert.match(migration, /num_nonnulls\(assigned_worker_employee_id,assigned_worker_crew_id\) <= 1/);
});

test("legacy crew data is backfilled and kept synchronized", () => {
  assert.match(migration, /set assigned_worker_crew_id=assigned_crew_id/);
  assert.match(migration, /sync_porter_visit_legacy_crew_assignment/);
  assert.match(migration, /new\.assigned_crew_id:=new\.assigned_worker_crew_id/);
  assert.doesNotMatch(migration, /drop column assigned_crew_id/);
});

test("recipient resolution and reminders include worker, crew and manager dimensions", () => {
  assert.match(migration, /resolve_porter_notification_recipients\(new\.assigned_worker_employee_id,new\.assigned_worker_crew_id,new\.assigned_manager_employee_id\)/);
  assert.match(migration, /resolve_porter_notification_recipients\(visit\.assigned_worker_employee_id,visit\.assigned_worker_crew_id,visit\.assigned_manager_employee_id\)/);
  assert.match(migration, /partition by up\.id/);
  assert.match(migration, /'Removed Manager'/);
});

test("individual visits stay off crew routes while managers receive route changes", () => {
  assert.match(migration, /assigned_worker_crew_id/);
  assert.match(migration, /assigned_manager_employee_id/);
  assert.match(migration, /Route changes notify the route crew and each distinct manager/);
});

test("new APIs remain narrow and authorization-controlled", () => {
  assert.match(migration, /create function public\.create_porter_visit_v3/);
  assert.match(migration, /Only management may create Porter Visits/);
  assert.match(migration, /revoke all on function public\.get_porter_assignment_options\(\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.get_porter_assignment_options\(\) to authenticated/);
});
