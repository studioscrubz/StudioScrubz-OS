import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration=readFileSync(new URL("../supabase/migrations/20261022132515_automatic_equipment_responsibility_assignment.sql",import.meta.url),"utf8");
const attention=readFileSync(new URL("../lib/services/attention.ts",import.meta.url),"utf8");
const assignment=readFileSync(new URL("../components/jobs/EquipmentAssignmentControl.tsx",import.meta.url),"utf8");
const checklist=readFileSync(new URL("../components/jobs/EquipmentClearanceChecklist.tsx",import.meta.url),"utf8");
const jobs=readFileSync(new URL("../components/jobs/JobsPage.tsx",import.meta.url),"utf8");
const equipmentMigrationNames=[
  "20261020231000_equipment_accountability_foundation.sql",
  "20261020232000_equipment_crew_lead_assignments.sql",
  "20261020233000_equipment_assignment_read_rpc.sql",
  "20261020234000_equipment_clearance_checkpoints.sql",
  "20261020235500_equipment_pending_signouts.sql",
  "20261021001000_equipment_confirmation_catalog_exceptions.sql",
  "20261021002000_equipment_handoffs_notifications.sql",
  "20261022132515_automatic_equipment_responsibility_assignment.sql",
];
const equipmentMigrations=equipmentMigrationNames.map(name=>({
  name,
  sql:readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8"),
}));

test("the eight equipment migrations are ordered, transactional and use valid dollar quoting",()=>{
  assert.deepEqual([...equipmentMigrationNames].sort(),equipmentMigrationNames);
  for(const {name,sql} of equipmentMigrations){
    assert.match(sql,/^(?:--[^\r\n]*(?:\r?\n))*begin;/i,`${name} must begin transactionally`);
    assert.match(sql,/commit;\s*$/i,`${name} must commit transactionally`);
    assert.doesNotMatch(sql,/\bas \$\s*(?:\r?\n)/i,`${name} contains an invalid single-dollar function delimiter`);
  }
});

test("job and later crew assignment share one durable idempotent task",()=>{
  assert.match(migration,/job_id uuid not null unique references public\.jobs/);
  assert.match(migration,/after insert or update of assigned_crew_id on public\.jobs/);
  assert.match(migration,/if current_task\.crew_id is not distinct from p_assigned_crew_id/);
  assert.match(migration,/perform private\.reconcile_job_equipment_responsibility_task\(new\.id,new\.assigned_crew_id,auth\.uid\(\)\)/);
});

test("crew changes revalidate eligibility and preserve append-only history",()=>{
  assert.match(migration,/Responsible employee is not assigned to the new crew/);
  assert.match(migration,/job_equipment_responsibility_events_append_only/);
  assert.match(migration,/Resolve pending equipment clearance before assigning a different crew/);
});

test("crew lead, status and archive changes reconcile every assigned job directly",()=>{
  assert.match(migration,/after update of crew_lead_id,status,archived_at on public\.crews/);
  assert.match(migration,/where j\.assigned_crew_id=new\.id/);
  assert.match(migration,/perform private\.reconcile_job_equipment_responsibility_task/);
  assert.doesNotMatch(migration,/update public\.jobs set assigned_crew_id=assigned_crew_id/);
});

test("unchanged crew saves and job saves do not emit duplicate task revisions",()=>{
  assert.match(migration,/if new\.crew_lead_id is not distinct from old\.crew_lead_id[\s\S]*return new/);
  assert.match(migration,/current_task\.crew_id is not distinct from p_assigned_crew_id[\s\S]*return;/);
  assert.match(migration,/job_id uuid not null unique references public\.jobs/);
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
  assert.match(migration,/revoke all on function[\s\S]*private\.reconcile_job_equipment_responsibility_task\(uuid,uuid,uuid\)/);
  assert.match(migration,/revoke all on function public\.equipment_assignment_changed\(\),public\.equipment_assignment_released\(\)/);
  assert.doesNotMatch(migration,/grant execute on function private\./);
});
