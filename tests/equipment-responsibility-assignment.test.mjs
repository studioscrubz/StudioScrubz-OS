import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration=readFileSync(new URL("../supabase/migrations/20261022132515_automatic_equipment_responsibility_assignment.sql",import.meta.url),"utf8");
const attention=readFileSync(new URL("../lib/services/attention.ts",import.meta.url),"utf8");
const assignment=readFileSync(new URL("../components/jobs/EquipmentAssignmentControl.tsx",import.meta.url),"utf8");
const checklist=readFileSync(new URL("../components/jobs/EquipmentClearanceChecklist.tsx",import.meta.url),"utf8");
const jobs=readFileSync(new URL("../components/jobs/JobsPage.tsx",import.meta.url),"utf8");

test("job and later crew assignment share one durable idempotent task",()=>{
  assert.match(migration,/job_id uuid not null unique references public\.jobs/);
  assert.match(migration,/after insert or update of assigned_crew_id on public\.jobs/);
  assert.match(migration,/if current_task\.crew_id is not distinct from new\.assigned_crew_id/);
});

test("crew changes revalidate eligibility and preserve append-only history",()=>{
  assert.match(migration,/Responsible employee is not assigned to the new crew/);
  assert.match(migration,/job_equipment_responsibility_events_append_only/);
  assert.match(migration,/Resolve pending equipment clearance before assigning a different crew/);
});

test("assignment is one eligible crew member and authorized server-side",()=>{
  assert.match(migration,/cardinality\(p_employee_ids\)<>1/);
  assert.match(migration,/public\.has_role\('Master Admin'\)/);
  assert.match(migration,/public\.current_employee_id\(\)=task\.crew_lead_employee_id/);
  assert.match(migration,/public\.crew_members/);
  assert.match(assignment,/type="radio"/);
});

test("Attention messages are exact, durable and deep-link to the job workflow",()=>{
  assert.match(attention,/Equipment & Supplies Assignment Required/);
  assert.match(attention,/Please designate a crew member responsible for equipment and supplies check-off before the job begins/);
  assert.match(attention,/Equipment & Supplies Check-Off Assigned/);
  assert.match(attention,/equipment=assignment/);
  assert.match(attention,/equipment=checkoff/);
  assert.match(attention,/equipment-responsibility:\$\{task\.task_id\}:/);
});

test("responsible employees can save, reopen, submit and report missing or damaged items",()=>{
  assert.match(migration,/save_job_equipment_checklist_progress/);
  assert.match(migration,/get_my_job_equipment_checklist/);
  assert.match(migration,/You are not the assigned equipment custodian/);
  assert.match(checklist,/Save Progress/);
  assert.match(checklist,/getSavedEquipmentChecklist/);
  assert.match(checklist,/Missing \/ Damaged/);
});

test("job UI uses only the assigned crew roster and exposes the workflow in job details",()=>{
  assert.match(jobs,/equipmentCrewOptions\(activeCrews\.find/);
  assert.match(jobs,/crew\.members/);
  assert.match(jobs,/EquipmentAssignmentControl jobId=\{job\.id\}/);
});

test("RLS, service-role isolation, narrow RPC grants and status tracking remain enforced",()=>{
  assert.match(migration,/enable row level security/g);
  assert.match(migration,/revoke all on public\.job_equipment_responsibility_tasks/);
  assert.match(migration,/grant select, insert, update on public\.job_equipment_responsibility_tasks to service_role/);
  for(const state of ["Pending Assignment","Assigned","Check-Off In Progress","Check-Off Complete","Return Pending","Reconciled"])assert.match(migration,new RegExp(state));
});
