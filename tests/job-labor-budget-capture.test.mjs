import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read=(p)=>readFileSync(new URL(p,import.meta.url),"utf8");
const migration=read("../supabase/migrations/20261103163000_capture_job_planned_labor_from_linked_proposal.sql");
const form=read("../components/jobs/DirectJobModal.tsx");
const service=read("../lib/services/jobs.ts");
test("new proposal-backed job receives valid person-hour budget before immutable start snapshot",()=>{
 assert.match(migration,/before insert on public\.jobs/);
 assert.match(migration,/new\.proposal_id is null or coalesce\(new\.labor_hours, 0\) > 0/);
 assert.match(migration,/select p\.result into v_result/);
 assert.match(migration,/v_result->>'laborHours'/);
 assert.match(migration,/new\.labor_hours := v_labor_text::numeric/);
 assert.match(migration,/new\.recommended_crew_size := v_crew_text::integer/);
 assert.match(migration,/positive total person-hours before creating this Job/);
 assert.doesNotMatch(migration,/update public\.jobs|insert into public\.job_labor_budget_snapshots/i);
});
test("direct job requires positive person-hours in both form and service before RPC",()=>{
 assert.match(form,/!Number\.isFinite\(laborHours\) \|\| laborHours <= 0/);
 assert.match(form,/Planned Total Person-Hours/);
 assert.match(service,/!Number\.isFinite\(input\.labor_hours\) \|\| input\.labor_hours <= 0/);
 assert.match(service,/rpc\("create_direct_operational_job_v2"/);
});
test("does not fabricate hours for legacy recurring agreements without a linked proposal",()=>{
 assert.match(migration,/if new\.proposal_id is null/);
 assert.match(migration,/Historical jobs and legacy agreements without a linked proposal are untouched/i);
 assert.match(migration,/security definer\s+set search_path = ''/i);
 assert.match(migration,/revoke all on function private\.capture_new_job_labor_from_proposal/);
});
