import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const permissions = readFileSync("lib/auth/permissions.ts", "utf8");
const sidebar = readFileSync("components/layout/Sidebar.tsx", "utf8");
const schedule = readFileSync("components/jobs/SchedulePage.tsx", "utf8");
const agreements = readFileSync("components/agreements/AgreementsPage.tsx", "utf8");
const jobs = readFileSync("lib/services/jobs.ts", "utf8");
const migration = readFileSync("supabase/migrations/20261002134919_sales_schedule_agreement_access.sql", "utf8");

const salesBlock = permissions.slice(permissions.indexOf("Sales: new Set"), permissions.indexOf('"Crew Lead": new Set'));
const managerBlock = permissions.slice(permissions.indexOf("Manager: new Set"), permissions.indexOf("Sales: new Set"));
const crewLeadBlock = permissions.slice(permissions.indexOf('"Crew Lead": new Set'), permissions.indexOf('"Scrub Technician": new Set'));
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

test("Schedule mutation controls remain gated by schedule.edit", () => {
  assert.match(schedule, /canEditSchedule=hasPermission\(profile,"schedule\.edit"\)/);
  assert.match(schedule, /canEditSchedule&&<Unscheduled/);
  assert.match(schedule, /canEditSchedule&&edit&&<ScheduleModal/);
  assert.match(schedule, /<QuickDetail job=\{detail\} canEdit=\{canEditSchedule\} canViewJobTime=\{canViewJobTime\}/);
  assert.match(schedule, /\{canViewJobTime&&<JobTimeSummary job=\{job\}\/?>\}/);
  assert.match(schedule, /\{canEdit&&<>/);
});

test("database policies keep Sales Agreement and occurrence access read-only", () => {
  assert.match(migration, /Agreement role create[\s\S]*has_any_role\(array\['Administrator','Manager'\]\)/);
  assert.match(migration, /Agreement role update[\s\S]*has_any_role\(array\['Administrator','Manager'\]\)/);
  assert.match(migration, /Occurrence role create[\s\S]*has_any_role\(array\['Administrator','Manager'\]\)/);
  assert.match(migration, /Occurrence role update[\s\S]*has_any_role\(array\['Administrator','Manager'\]\)/);
  assert.doesNotMatch(migration, /Agreement role (?:create|update)[\s\S]{0,180}'Sales'/);
});

test("field-role permissions remain unchanged and do not gain Agreement access", () => {
  assert.match(crewLeadBlock, /"schedule\.view"/);
  assert.match(technicianBlock, /"schedule\.view"/);
  assert.doesNotMatch(crewLeadBlock, /agreements\.view|agreements\.manage|agreements\.financialSummary/);
  assert.doesNotMatch(technicianBlock, /agreements\.view|agreements\.manage|agreements\.financialSummary/);
});
