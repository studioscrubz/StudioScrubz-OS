import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("supabase/migrations/20261007193000_job_permanent_delete_eligibility.sql");
const guard=read("supabase/migrations/20261007190000_guard_job_permanent_delete_retained_dependencies.sql");
const service=read("lib/services/archives.ts");
const ui=read("components/archives/ArchivesPage.tsx");
const archive=read("supabase/migrations/20260924165201_restore_and_reopen_cancelled_job.sql");

test("one authoritative checker classifies only applicable retained-history categories",()=>{
  for(const reason of ["Accepted scope","Invoice/payment history","Labor records","Quality/compliance records","Commission records","Operational evidence"])assert.match(migration,new RegExp(`'${reason.replace("/","\\/")}'`));
  assert.match(migration,/private\.job_retained_history_reasons\(j\.id\)/);
  assert.match(migration,/cardinality\(r\.value\)=0/);
  assert.match(service,/get_archived_job_permanent_delete_eligibility/);
  assert.match(service,/protected_history_reasons/);
});

test("eligibility is Master Admin-only and other roles never receive a delete action",()=>{
  assert.match(migration,/auth\.uid\(\)\) is null or not public\.is_master_admin\(\)/);
  assert.match(migration,/revoke all on function public\.get_archived_job_permanent_delete_eligibility\(\) from public,anon,authenticated/);
  assert.match(ui,/if\(!masterAdmin\)return null/);
  assert.match(ui,/getArchivedRecords\(masterAdmin\)/);
});

test("dependency-free Jobs expose delete while protected Jobs show a non-actionable explanation",()=>{
  assert.match(ui,/record\.permanentDeleteEligibility\?\.allowed\)return <button[^>]*>Delete Permanently<\/button>/);
  assert.match(ui,/Permanent deletion unavailable/);
  assert.match(ui,/must remain in the archive to preserve StudioScrubz/);
  assert.match(ui,/Protected history:/);
  assert.doesNotMatch(ui,/Archive it instead/);
});

test("backend still blocks a bypass with a durable archived-Job-safe error",()=>{
  assert.match(migration,/cardinality\(private\.job_retained_history_reasons\(old\.id\)\)>0/);
  assert.match(migration,/This Job contains retained business records and cannot be permanently deleted/);
  assert.doesNotMatch(migration,/Archive it instead/);
  assert.match(migration,/create or replace function public\.master_admin_permanently_delete_cancelled_job/);
  assert.match(guard,/before delete on public\.jobs/);
});

test("normal archive remains an update and dependency-free permanent delete remains reachable",()=>{
  assert.match(archive,/update public\.jobs set archived_from_status/);
  assert.doesNotMatch(archive,/delete from public\.jobs/);
  assert.match(migration,/return old/);
});

console.log("Job permanent-delete eligibility UX tests passed.");
