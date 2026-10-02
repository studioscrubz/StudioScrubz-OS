import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const permissions = readFileSync("lib/auth/permissions.ts", "utf8");
const sidebar = readFileSync("components/layout/Sidebar.tsx", "utf8");
const schedule = readFileSync("components/jobs/SchedulePage.tsx", "utf8");
const agreements = readFileSync("components/agreements/AgreementsPage.tsx", "utf8");
const jobs = readFileSync("lib/services/jobs.ts", "utf8");
const crews = readFileSync("lib/services/crews.ts", "utf8");
const migration = readFileSync("supabase/migrations/20261002134919_sales_schedule_agreement_access.sql", "utf8");
const directorySecurity = readFileSync("supabase/security_definer_hardening_phase_a.sql", "utf8");

const salesBlock = permissions.slice(permissions.indexOf("Sales: new Set"), permissions.indexOf('"Crew Lead": new Set'));
const managerBlock = permissions.slice(permissions.indexOf("Manager: new Set"), permissions.indexOf("Sales: new Set"));
const crewLeadPermissions = permissions.slice(permissions.indexOf("const crewLeadPermissions"), permissions.indexOf("export const ROLE_PERMISSIONS"));
const technicianStart = permissions.indexOf('"Scrub Technician": new Set');
const technicianBlock = permissions.slice(technicianStart, permissions.indexOf("};", technicianStart));

test("Sales receives Schedule and Agreement navigation and route permissions", () => {
  assert.match(salesBlock, /"schedule\.view"/);
  assert.match(salesBlock, /"agreements\.view"/);
  assert.match(permissions, /\["\/schedule", "schedule\.view"\]/);
  assert.match(permissions, /\["\/agreements", "agreements\.view"\]/);
  assert.match(sidebar, /label: "Schedule"[\s\S]*?permission: "schedule\.view"/);
  assert.match(sidebar, /label: "Service Agreements"[\s\S]*?permission: "agreements\.view"/);
});

test("Sales does not gain management, financial, job, employee, or payroll permissions", () => {
  for (const denied of [
    "agreements.manage", "agreements.financialSummary", "schedule.edit",
    "jobs.view", "jobs.create", "jobs.edit", "jobs.schedule", "jobs.complete", "jobs.archive",
    "employees.manage", "timeClock.manageAll", "payrollPrep.view", "finances.view",
  ]) assert.doesNotMatch(salesBlock, new RegExp(`"${denied.replace(".", "\\.")}"`));
});

test("management keeps Agreement revenue visibility while Sales cannot compute or render it", () => {
  assert.match(managerBlock, /"agreements\.financialSummary"/);
  assert.match(permissions, /"agreements\.view", "agreements\.manage", "agreements\.financialSummary"/);
  assert.match(agreements, /canViewFinancialSummary = hasPermission\(profile, "agreements\.financialSummary"\)/);
  assert.match(agreements, /canViewFinancialSummary \? \[\["Recurring Monthly Revenue"/);
  assert.doesNotMatch(salesBlock, /agreements\.financialSummary/);
});

test("Sales Schedule data is a dedicated non-financial read-only RPC", () => {
  assert.match(jobs, /profile\?\.role !== "Sales"\) return getJobs\(\)/);
  assert.match(jobs, /rpc\("get_sales_schedule_jobs", \{\}\)/);
  assert.match(migration, /if auth\.uid\(\) is null or not public\.has_role\('Sales'\)/);
  assert.match(migration, /from public\.jobs job/);
  assert.doesNotMatch(migration, /'price'|'deposit'|'balance'|'labor_hours'|'recommended_crew_size'/);
  assert.doesNotMatch(migration, /update public\.jobs|insert into public\.jobs|delete from public\.jobs/i);
});

test("Sales Schedule does not load crew or employee directories", () => {
  assert.match(schedule, /salesReadOnly\?Promise\.resolve\(\[\]\):getActiveCrews\(\)/);
  assert.match(schedule, /crewFilterOptions=useMemo<CrewDisplayOption\[\]>/);
  assert.match(schedule, /assigned_crew_id&&job\.assigned_crew_name/);
  assert.match(schedule, /\{id:job\.assigned_crew_id!,crew_name:job\.assigned_crew_name!\}/);
  assert.match(crews, /rpc\("get_crew_directory"\)/);
  assert.match(crews, /rpc\("get_crew_members_directory"\)/);
  assert.match(directorySecurity, /get_employee_directory[\s\S]*?has_any_role\(array\['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician'\]\)/);
  assert.match(directorySecurity, /get_crew_directory[\s\S]*?has_any_role\(array\['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician'\]\)/);
});

test("Sales assignment display contains no HR, payroll, or employee financial fields", () => {
  const salesProjection = migration.slice(migration.indexOf("create or replace function public.get_sales_schedule_jobs"), migration.indexOf("revoke all on function public.get_sales_schedule_jobs"));
  assert.match(salesProjection, /'assigned_crew_id', job\.assigned_crew_id/);
  assert.match(salesProjection, /'assigned_crew_name', job\.assigned_crew_name/);
  assert.match(salesProjection, /'crew_lead_name', job\.crew_lead_name/);
  assert.match(salesProjection, /'assigned_team', job\.assigned_team/);
  assert.match(salesProjection, /'assigned_employee_id', job\.assigned_employee_id/);
  assert.match(salesProjection, /'assigned_employee_name', job\.assigned_employee_name/);
  assert.doesNotMatch(salesProjection, /hourly_rate|overtime_rate|gross_pay|payroll|commission|hire_date|employee_number|employee_email|employee_phone/i);
});

test("Schedule mutation controls remain gated by schedule.edit", () => {
  assert.match(schedule, /canEditSchedule=hasPermission\(profile,"schedule\.edit"\)/);
  assert.match(schedule, /canEditSchedule&&<Unscheduled/);
  assert.match(schedule, /canEditSchedule&&edit&&<ScheduleModal/);
  assert.match(schedule, /<QuickDetail job=\{detail\} canEdit=\{canEditSchedule\} canViewJobTime=\{canViewJobTime\}/);
  assert.match(schedule, /\{canViewJobTime&&<JobTimeSummary job=\{job\}\/?>\}/);
  assert.match(schedule, /\{canEdit&&<>/);
  assert.match(schedule, /canEditSchedule&&edit&&<ScheduleModal/);
  assert.match(schedule, /canEdit&&<><label[\s\S]*updateJobInternalNotes[\s\S]*cancelJob/);
});

test("database policies keep Sales Agreement and occurrence access read-only", () => {
  assert.match(migration, /Agreement role create[\s\S]*has_any_role\(array\['Administrator','Manager'\]\)/);
  assert.match(migration, /Agreement role update[\s\S]*has_any_role\(array\['Administrator','Manager'\]\)/);
  assert.match(migration, /Occurrence role create[\s\S]*has_any_role\(array\['Administrator','Manager'\]\)/);
  assert.match(migration, /Occurrence role update[\s\S]*has_any_role\(array\['Administrator','Manager'\]\)/);
  assert.doesNotMatch(migration, /Agreement role (?:create|update)[\s\S]{0,180}'Sales'/);
});

test("field roles retain Schedule access and do not gain Agreement access", () => {
  assert.match(crewLeadPermissions, /"schedule\.view"/);
  assert.match(technicianBlock, /"schedule\.view"/);
  assert.doesNotMatch(crewLeadPermissions, /agreements\.view|agreements\.manage|agreements\.financialSummary/);
  assert.doesNotMatch(technicianBlock, /agreements\.view|agreements\.manage|agreements\.financialSummary/);
});
