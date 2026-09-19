import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read=(path)=>fs.readFileSync(new URL(`../../${path}`,import.meta.url),"utf8");
const migration=read("supabase/migrations/20260918132217_job_individual_or_crew_assignment.sql");
const jobs=read("lib/services/jobs.ts");
const calendar=read("lib/google-calendar/server.ts");
const dashboard=read("lib/services/dashboard.ts");
const archives=read("lib/services/archives.ts");
const jobsPage=read("components/jobs/JobsPage.tsx");

test("database enforces one assignment arm and controlled writes",()=>{
  assert.match(migration,/num_nonnulls\(assigned_employee_id, assigned_crew_id\) <= 1/);
  assert.match(migration,/revoke insert, update, delete, truncate, references, trigger\s+on public\.jobs\s+from public, anon, authenticated;/);
  assert.match(migration,/status in \('In Progress','Completed','Cancelled','Archived'\)/);
});
test("assignment stays separate from payroll and Join Job owns payroll",()=>{
  const assignment=migration.match(/create function public\.set_job_worker_assignment[\s\S]*?end \$\$;/)?.[0]??"";
  const join=migration.match(/create or replace function public\.start_or_clock_in_to_job[\s\S]*?end \$\$;/)?.[0]??"";
  assert.doesNotMatch(assignment,/open_job_payroll_entry/);
  assert.match(join,/open_job_payroll_entry/);
});
test("Start Job mirrors individual-or-active-Crew-Lead timer authority",()=>{
  assert.match(jobsPage,/\["Master Admin", "Administrator", "Manager"\]\.includes\(role\)/);
  assert.match(jobsPage,/\["Scrub Technician", "Crew Lead"\]\.includes\(role\)[\s\S]*job\.assigned_employee_id === employeeId/);
  assert.match(jobsPage,/role === "Crew Lead"[\s\S]*job\.assigned_crew_id[\s\S]*activeCrewLeadId === employeeId/);
  assert.match(jobsPage,/management \|\| eligibleIndividual \|\| assignedCrewLead/);
});
test("application routes assignment, calendar, dashboard, and archives by both arms",()=>{
  assert.match(jobs,/create_direct_operational_job_v2/);
  assert.match(jobs,/set_job_worker_assignment/);
  assert.match(jobs,/findIndividualTechConflicts/);
  assert.match(calendar,/job\.assigned_employee/);
  assert.match(dashboard,/individualJobs: todaysJobs\.filter/);
  assert.match(archives,/\["jobs", "assigned_employee_id"\]/);
});
