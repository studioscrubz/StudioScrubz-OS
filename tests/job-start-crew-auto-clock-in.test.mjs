import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(resolve("supabase/migrations/20261004025106_atomic_crew_clock_in_on_job_start.sql"), "utf8");
const jobsPage = readFileSync(resolve("components/jobs/JobsPage.tsx"), "utf8");
const start = migration.match(/create or replace function public\.start_operational_job[\s\S]*?\n\$\$;/)?.[0] ?? "";
const open = migration.match(/create or replace function public\.open_job_payroll_entry[\s\S]*?\n\$\$;/)?.[0] ?? "";

test("migration preflights and enforces one open Job entry per employee", () => {
  assert.match(migration, /having count\(\*\) > 1/);
  assert.match(migration, /Resolve legacy duplicates before applying this migration/);
  assert.match(migration, /create unique index one_open_job_time_entry_per_employee/);
  assert.match(migration, /job_id is not null[\s\S]*status = 'Open'[\s\S]*clock_out is null[\s\S]*archived_at is null/);
});

test("employee-level serialization protects automatic start and manual Join", () => {
  assert.match(open, /pg_advisory_xact_lock/);
  assert.match(open, /job-payroll-employee:/);
  assert.match(start, /order by roster\.employee_id/);
  assert.match(start, /pg_advisory_xact_lock/);
});

test("eligible roster is members plus deduplicated crew lead and exact active Scrub Tech filter", () => {
  assert.match(start, /from public\.crew_members member/);
  assert.match(start, /union\s+select crew\.crew_lead_id/);
  assert.match(start, /employee\.department = 'Scrub Technicians'/);
  assert.match(start, /employee\.employment_status = 'Active'/);
  assert.match(start, /employee\.archived_at is null/);
  assert.doesNotMatch(start, /union all\s+select crew\.crew_lead_id/);
});

test("crew start uses one timestamp, reuses payroll helper, and remains atomic", () => {
  assert.match(start, /started_at := transaction_timestamp\(\)/);
  assert.match(start, /open_job_payroll_entry\([\s\S]*started_at/);
  assert.match(start, /operational_started_at = coalesce\(operational_started_at, started_at\)/);
  assert.ok(start.indexOf("open_job_payroll_entry") < start.indexOf("update public.jobs"));
  assert.match(open, /hourly_rate_snapshot, overtime_rate_snapshot/);
  assert.match(open, /v_employee\.hourly_rate \* 1\.5/);
});

test("same-job reuse, other-job conflict, and successful retry are idempotent", () => {
  assert.match(open, /employee_id = p_employee_id[\s\S]*job_id = p_job_id[\s\S]*if found then return v_entry/);
  assert.match(start, /if j\.status = 'In Progress' then[\s\S]*return safe/);
  assert.match(start, /entry\.job_id <> j\.id/);
  assert.match(start, /is already On Job for/);
  assert.ok(start.indexOf("if j.status = 'In Progress'") < start.indexOf("from public.crew_members"));
});

test("empty crew can start and late members are not rediscovered on retry", () => {
  assert.match(start, /coalesce\(array_agg\(roster\.employee_id order by roster\.employee_id\), '\{\}'::uuid\[\]\)/);
  assert.match(start, /if j\.status = 'In Progress' then[\s\S]*return safe;[\s\S]*from public\.crew_members/);
});

test("existing authorization contract and manual Join remain unchanged", () => {
  assert.match(start, /has_any_role\(array\['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician'\]\)/);
  assert.match(start, /can_control_job_timer\(j\.assigned_employee_id,j\.assigned_crew_id\)/);
  assert.match(migration, /returns public\.jobs_operational_safe/);
  assert.match(migration, /grant execute on function public\.start_operational_job\(uuid\) to authenticated/);
  assert.doesNotMatch(migration, /create or replace function public\.start_or_clock_in_to_job/);
});

test("both UI handlers use presence-aware crew start while preserving individual Start then Join", () => {
  const individualHandlers = jobsPage.match(/const startedJob = await startOperationalJob\(job\.id\); await joinJob\(job\.id\)/g) ?? [];
  assert.equal(individualHandlers.length, 2);
  const crewHandlers = jobsPage.match(/job: await startOperationalJobWithPresence\(job\.id, presence\)/g) ?? [];
  assert.equal(crewHandlers.length, 2);
  assert.equal((jobsPage.match(/communicationEvent: "team_arrived" as const/g) ?? []).length, 4);
  assert.match(jobsPage, /\(\) => setShowPresence\(false\)/);
  assert.match(jobsPage, /\(\) => \{ setShowPresence\(false\); close\(\); \}/);
});

console.log("Atomic crew auto-clock-in contract tests passed.");
