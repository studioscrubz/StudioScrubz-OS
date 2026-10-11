import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261011150448_restore_non_archived_cancelled_jobs.sql", "utf8");
const jobsService = readFileSync("lib/services/jobs.ts", "utf8");
const jobsUi = readFileSync("components/jobs/JobsPage.tsx", "utf8");

test("non-archived cancellation restore is authorized, locked, and narrowly granted", () => {
  assert.match(migration, /create function public\.restore_non_archived_cancelled_job\(p_job_id uuid\)/i);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /has_any_role\(array\['Master Admin','Administrator','Manager'\]\)/);
  assert.match(migration, /from public\.jobs[\s\S]*where id = p_job_id[\s\S]*for update/);
  assert.match(migration, /revoke all on function public\.restore_non_archived_cancelled_job\(uuid\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.restore_non_archived_cancelled_job\(uuid\)[\s\S]*to authenticated/);
});

test("restore preserves the original record and computes its operational state", () => {
  assert.match(migration, /archived_at is not null[\s\S]*status is distinct from 'Cancelled'/);
  assert.match(migration, /when v_job\.scheduled_date is null then 'Ready to Schedule'/);
  assert.match(migration, /when num_nonnulls\(v_job\.assigned_employee_id, v_job\.assigned_crew_id\) = 0 then 'Scheduled'/);
  assert.match(migration, /else 'Crew Assigned'/);
  assert.match(migration, /update public\.jobs\s+set status = v_new_status\s+where id = v_job\.id/);
  assert.doesNotMatch(migration, /insert into public\.jobs/i);
});

test("financial, duplicate-source, invalid-assignment, and schedule conflicts block restoration", () => {
  for (const dependency of ["is_job_financially_handed_off", "public.invoices", "public.invoice_job_lines", "public.payments"]) {
    assert.match(migration, new RegExp(dependency.replace(".", "\\.")));
  }
  assert.match(migration, /other\.proposal_id = v_job\.proposal_id/);
  assert.match(migration, /other\.service_occurrence_id = v_job\.service_occurrence_id/);
  assert.match(migration, /num_nonnulls\(v_job\.assigned_employee_id, v_job\.assigned_crew_id\) > 1/);
  assert.match(migration, /assigned worker has a scheduling conflict/);
});

test("audit is immutable, actor-attributed, and retry-idempotent", () => {
  assert.match(migration, /v_actor uuid := auth\.uid\(\)/);
  assert.match(migration, /'Restored and Reopened',[\s\S]*'Cancelled',[\s\S]*v_new_status,[\s\S]*v_actor/);
  assert.match(migration, /'restoration_kind', 'non_archived_cancelled_job'/);
  assert.match(migration, /event\.metadata @> '\{"restoration_kind":"non_archived_cancelled_job"\}'::jsonb/);
  assert.equal((migration.match(/insert into public\.job_lifecycle_events/gi) ?? []).length, 1);
});

test("Jobs UI uses the RPC with an explicit confirmation and no communication send", () => {
  assert.match(jobsService, /rpc\("restore_non_archived_cancelled_job", \{ p_job_id: id \}\)/);
  assert.match(jobsUi, /job\.status === "Cancelled" && !job\.archived_at/);
  assert.match(jobsUi, /Restore and Reopen/);
  assert.match(jobsUi, /role="alertdialog"/);
  assert.match(jobsUi, /No customer communication will be sent by this action\./);
});
