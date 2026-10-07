import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("supabase/migrations/20261007190000_guard_job_permanent_delete_retained_dependencies.sql");
const snapshots=read("supabase/migrations/20260905090000_add_job_scope_snapshots.sql");
const permanent=read("supabase/migrations/20260827042420_cancelled_job_permanent_delete.sql");
const archive=read("supabase/migrations/20260924165201_restore_and_reopen_cancelled_job.sql");

test("scope snapshots are immutable accepted-Proposal history, not transient Job children",()=>{
  assert.match(snapshots,/snapshot_type text not null default 'Accepted Proposal'/);
  assert.match(snapshots,/pricing jsonb not null/);
  assert.match(snapshots,/proposal_result jsonb not null/);
  assert.match(snapshots,/Active users read immutable Job scope snapshots/);
  assert.match(migration,/exists \(\s*select 1 from public\.scope_snapshots snapshot/);
  assert.match(migration,/immutable accepted-scope snapshot and must be retained/);
  assert.doesNotMatch(migration,/delete from public\.scope_snapshots|update public\.scope_snapshots|on delete cascade/i);
});

test("every retained direct Job dependency discovered in production is guarded",()=>{
  const retained=[
    "change_requests","employee_teamwork_events","expenses","field_discoveries",
    "invoice_job_lines","invoice_job_photos","invoices","job_compliance_records",
    "job_customer_feedback","job_evidence","job_labor_budget_adjustments",
    "job_labor_budget_snapshots","job_labor_threshold_events","job_mileage_trips",
    "job_performance_evidence_links","job_quality_callbacks",
    "job_quality_employee_attributions","job_quality_evidence_links",
    "job_quality_inspections","job_scope_completion_records",
    "lead_commission_cleaning_qualifications","lead_commission_ledger",
    "mileage_entries","mileage_stops","payments","scope_snapshot_items",
    "scope_snapshots","service_occurrences","time_entries","job_crew_presence",
    "job_crew_presence_events",
  ];
  for(const table of retained)assert.match(migration,new RegExp(`public\\.${table} row|public\\.${table} snapshot`),table);
  assert.doesNotMatch(migration,/from public\.job_calendar_syncs/);
});

test("normal archive is an update and preserves the Job and all history",()=>{
  assert.match(archive,/update public\.jobs set archived_from_status = v_job\.status, status = 'Archived', archived_at = now\(\)/);
  assert.doesNotMatch(archive,/delete from public\.jobs/);
});

test("permanent deletion remains Master Admin-only and dependency-free Jobs can reach the canonical delete",()=>{
  assert.match(permanent,/\(select auth\.uid\(\)\) is null or not public\.is_master_admin\(\)/);
  assert.match(permanent,/Only a non-archived Cancelled Job can be permanently deleted/);
  assert.match(permanent,/master_admin_permanently_delete_archived_record/);
  assert.match(migration,/return old/);
  assert.match(migration,/before delete on public\.jobs/);
  assert.match(migration,/revoke all on function private\.guard_job_permanent_delete_retained_history\(\)\s*from public, anon, authenticated/);
});

console.log("Job permanent-delete retained dependency tests passed.");
