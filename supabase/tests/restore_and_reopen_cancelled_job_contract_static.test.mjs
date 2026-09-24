import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260924165201_restore_and_reopen_cancelled_job.sql", "utf8");
const jobsService = readFileSync("lib/services/jobs.ts", "utf8");
const archivesService = readFileSync("lib/services/archives.ts", "utf8");
const archivesUi = readFileSync("components/archives/ArchivesPage.tsx", "utf8");

test("RPC is authorized, locked, hardened, and narrowly granted", () => {
  assert.match(migration, /create function public\.restore_and_reopen_cancelled_job\(p_job_id uuid\)/i);
  assert.match(migration, /security definer set search_path = ''/i);
  assert.match(migration, /has_any_role\(array\['Master Admin','Administrator','Manager'\]\)/);
  assert.match(migration, /from public\.jobs where id = p_job_id for update/i);
  assert.match(migration, /revoke all on function[\s\S]*restore_and_reopen_cancelled_job\(uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*restore_and_reopen_cancelled_job\(uuid\)[\s\S]*to authenticated/i);
});

test("only Cancelled-origin archives reopen to the safe scheduling state", () => {
  assert.match(migration, /archived_from_status is distinct from 'Cancelled'/);
  assert.match(migration, /when v_job\.scheduled_date is null then 'Ready to Schedule'/);
  assert.match(migration, /when num_nonnulls\(v_job\.assigned_employee_id, v_job\.assigned_crew_id\) = 0 then 'Scheduled'/);
  assert.match(migration, /else 'Crew Assigned'/);
  assert.match(migration, /set archived_at = null, archived_from_status = null, status = v_new_status/);
  assert.doesNotMatch(migration, /set[\s\S]{0,100}(completed_at|operational_started_at|operational_ended_at|internal_notes)\s*=/i);
});

test("financial and active uniqueness dependencies block restoration", () => {
  for (const dependency of ["is_job_financially_handed_off", "public.invoices", "public.invoice_job_lines", "public.payments"]) assert.match(migration, new RegExp(dependency.replace(".", "\\.")));
  assert.match(migration, /other\.proposal_id = v_job\.proposal_id/);
  assert.match(migration, /other\.service_occurrence_id = v_job\.service_occurrence_id/);
  assert.match(migration, /exception when unique_violation/);
});

test("archive provenance and immutable audit history are recorded", () => {
  assert.match(migration, /set archived_from_status = v_job\.status, status = 'Archived'/);
  assert.match(migration, /create table public\.job_lifecycle_events/);
  assert.match(migration, /before update or delete on public\.job_lifecycle_events/);
  assert.match(migration, /'Restored and Reopened', 'Cancelled', v_new_status, v_actor/);
  assert.match(migration, /'history_retained', true/);
});

test("application uses RPC routing and provides the management confirmation control", () => {
  assert.match(jobsService, /rpc\("restore_and_reopen_cancelled_job", \{ p_job_id: id \}\)/);
  assert.doesNotMatch(jobsService, /from\("jobs"\)[\s\S]{0,100}update\(/);
  assert.match(archivesService, /restoreAndReopenCancelledJob\(record\.id\)/);
  assert.match(archivesUi, /\["Master Admin", "Administrator", "Manager"\]/);
  assert.match(archivesUi, />Restore and Reopen</);
  assert.match(archivesUi, /All existing time entries, GPS trips, photos, notes, evidence, cancellation history, and audit records will be retained\./);
  assert.match(archivesUi, /role="alertdialog"/);
});

test("the forward migration does not replace permanent-delete behavior", () => {
  assert.doesNotMatch(migration, /master_admin_permanently_delete_cancelled_job/i);
});
