import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

const read = path => readFileSync(path, "utf8");
const compiled=ts.transpileModule(read("lib/auth/permissions.ts"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const m={exports:{}};
new Function("exports","module","require",compiled)(m.exports,m,()=>({}));
const {ROLE_PERMISSIONS,hasPermission,canViewOwnJobFeedback}=m.exports;
const active=(role,employee_id="employee-1")=>({role,is_active:true,employee_id});

test("Manager keeps all management powers AND inherits Crew Lead permissions",()=>{
  for(const permission of ROLE_PERMISSIONS["Crew Lead"]) {
    assert.ok(ROLE_PERMISSIONS.Manager.has(permission),`Manager missing Crew Lead permission: ${permission}`);
    assert.equal(hasPermission(active("Manager"),permission),true,`Manager denied ${permission}`);
  }
  for(const permission of ["jobs.create","jobs.schedule","jobs.archive","crews.manage","timeClock.manageAll","invoices.view","porterVisits.manage","communications.archive"]) {
    assert.equal(hasPermission(active("Manager"),permission),true,`Manager lost ${permission}`);
    assert.equal(hasPermission(active("Crew Lead"),permission),false,`Crew Lead unexpectedly gained ${permission}`);
  }
});
test("employee field tools require active Manager or Crew Lead with a linked employee",()=>{
  for(const role of ["Manager","Crew Lead","Scrub Technician"]) {
    assert.equal(canViewOwnJobFeedback(active(role)),true);
    assert.equal(canViewOwnJobFeedback(active(role,null)),false);
    assert.equal(canViewOwnJobFeedback({...active(role),is_active:false}),false);
  }
  assert.equal(canViewOwnJobFeedback(active("Sales")),false);
  assert.equal(hasPermission(active("Manager"),"walkthroughs.field"),true);
  assert.equal(hasPermission(active("Manager",null),"walkthroughs.field"),false);
});
test("Jobs UI includes Managers in employee-only feedback panels",()=>{
  const jobs=read("components/jobs/JobsPage.tsx");
  assert.match(jobs,/canViewOwnJobFeedback\(profile\) && <MyTeamworkEvents employeeId=\{profile!\.employee_id!\}/);
  assert.match(jobs,/canViewOwnJobFeedback\(profile\) && <MyPerformanceReviews/);
  const team=read("components/jobs/MyTeamworkEvents.tsx");
  assert.match(team,/getMyTeamworkEvents\(employeeId\)/);
  const service=read("lib/services/jobPerformanceEvidence.ts");
  assert.match(service,/\.eq\("employee_id",employeeId\)/,"Managers can read company-wide evidence, so self-service must scope to own employee");
  const reviews=read("components/jobs/EmployeePerformanceReviews.tsx");
  assert.match(reviews,/rows\.filter\(review=>review\.status==="Finalized"\)/,"Management must not see draft reviews in employee-self-view");
});
test("Managers receive personal job alerts only for actual assigned employees or crews",()=>{
  const client=read("lib/services/attention.ts");
  const server=read("lib/attention/server.ts");
  assert.match(client,/const assignedOperationalJobIds = profile\.role === "Manager"/);
  assert.match(client,/getActiveCrews\(\)/);
  assert.match(client,/crew\.crew_lead_id === profile\.employee_id/);
  assert.match(client,/job\.assigned_employee_id === profile\.employee_id/);
  assert.match(client,/managerCrewIds\.has\(job\.assigned_crew_id\)/);
  assert.match(client,/ownAssignedJobs\.has\(jobId\)/);
  assert.match(client,/mayReceiveEmployeeJobAlert\(decision\.job_id\)/);
  assert.match(client,/mayReceiveEmployeeJobAlert\(job\.id\)/);
  assert.match(server,/assignedOperationalJobIds: profile\.role === "Manager"/);
  assert.match(server,/crewIds\.has\(job\.assigned_crew_id\)/);
  assert.match(server,/profile\.role !== "Manager"/);
});
test("Manager employee linkage is explained and existing native management features stay visible",()=>{
  assert.match(read("components/users/UserManagementPage.tsx"),/Link an active employee to use Crew Lead field assignments/);
  assert.match(read("lib/auth/permissions.ts"),/Manager: new Set\(\[\s*\.\.\.crewLeadPermissions/);
});
