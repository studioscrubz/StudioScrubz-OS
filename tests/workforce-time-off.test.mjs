import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261025145923_workforce_time_off_phase_1.sql", "utf8");
const page = readFileSync("components/employees/TimeOffPage.tsx", "utf8");
const schedule = readFileSync("components/jobs/SchedulePage.tsx", "utf8");
const jobsService = readFileSync("lib/services/jobs.ts", "utf8");
const jobsPage = readFileSync("components/jobs/JobsPage.tsx", "utf8");
const permissions = readFileSync("lib/auth/permissions.ts", "utf8");
const attention = readFileSync("lib/services/attention.ts", "utf8");

test("time-off schema is isolated from employee presence and payroll", () => {
  assert.match(migration, /create table public\.employee_time_off_requests/);
  assert.doesNotMatch(migration, /create table public\.(employee_availability|recurring_availability)/);
  assert.doesNotMatch(migration, /update public\.(employees|employee_work_sessions|time_entries|payroll)/i);
  assert.match(migration, /leave_category/);
});
test("employee ownership and management decisions are enforced in PostgreSQL", () => {
  assert.match(migration, /private\.current_active_employee_id\(\)/);
  assert.match(migration, /request\.employee_id<>employee/);
  assert.match(migration, /private\.is_time_off_manager/);
  assert.match(migration, /Managers may not approve or deny their own request/);
  assert.match(migration, /request\.submitted_by=\(select auth\.uid\(\)\)/);
});

test("audit records and notifications are durable and deduplicated", () => {
  assert.match(migration, /employee_time_off_events_append_only/);
  assert.match(migration, /unique\(request_id,revision,event_type\)/);
  assert.match(migration, /unique\(request_id,recipient_user_id,event_type,request_revision\)/);
  assert.match(migration, /on conflict do nothing/);
  assert.match(migration, /create table public\.employee_time_off_schedule_overrides/);
  assert.match(migration, /employee_time_off_schedule_overrides_append_only/);
  assert.match(migration, /actor_user_id uuid not null/);
  assert.match(migration, /override_reason text not null/);
});

test("migration leaves transaction ownership to the migration runner", () => {
  assert.doesNotMatch(migration, /^\s*(begin|commit|rollback)\s*;/gim);
  assert.doesNotMatch(migration, /create\s+(unique\s+)?index\s+concurrently/i);
  assert.doesNotMatch(migration, /^\s*(vacuum|alter\s+system|create\s+database|drop\s+database)\b/gim);
});

test("direct table access remains locked down and RPCs validate active identities", () => {
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on public\.employee_time_off_requests/);
  assert.match(migration, /employee_time_off_requests_authorized_read/);
  assert.match(migration, /employee_time_off_notifications_recipient_read/);
  assert.match(migration, /alter publication supabase_realtime add table public\.%I/);
  assert.match(migration, /grant execute on function public\.submit_employee_time_off_request/);
  assert.match(migration, /employment_status='Active'/);
  assert.match(migration, /get_approved_employee_absences[\s\S]*private\.is_time_off_manager/);
});

test("UI exposes requests, decisions, schedule warnings, and Attention without availability duplication", () => {
  assert.match(page, /Request Time Off/);
  assert.match(page, /Approve/);
  assert.match(page, /Deny/);
  assert.doesNotMatch(page, /recurring availability|My Availability/i);
  assert.match(schedule, /Approved absences affecting this week/);
  assert.match(schedule, /absenceOverlapsSchedule/);
  assert.match(attention, /Time-Off Request Requires Review/);
  assert.match(permissions, /"timeOff\.view"/);
  assert.match(permissions, /"timeOff\.manage"/);
});

test("job scheduling conflicts are enforced and audited by PostgreSQL", () => {
  assert.match(migration, /create function private\.job_time_off_conflicts/);
  assert.match(migration, /r\.status='Approved'/);
  assert.match(migration, /p_scheduled_date\+p_start_time\+\(p_estimated_duration\*interval '1 hour'\)/);
  assert.match(migration, /select c\.crew_lead_id/);
  assert.match(migration, /select cm\.employee_id/);
  assert.match(migration, /create trigger enforce_job_time_off_conflicts[\s\S]*on public\.jobs/);
  assert.match(migration, /not private\.is_time_off_manager\(actor\)/);
  assert.match(migration, /char_length\(reason\)<10/);
  assert.match(migration, /insert into public\.employee_time_off_schedule_overrides/);
});

test("Schedule uses the atomic protected RPC and requires a reason for absence overrides", () => {
  assert.match(jobsService, /rpc\("schedule_job_with_time_off_protection"/);
  assert.match(jobsService, /p_override_reason: timeOffOverrideReason/);
  assert.match(schedule, /minimum 10 characters/);
  assert.match(schedule, /void submit\(reason\)/);
  assert.doesNotMatch(schedule, /leave_category|employee_notes/);
  assert.match(jobsService, /rpc\("update_job_schedule_with_time_off_protection"/);
  assert.match(jobsService, /rpc\("assign_job_worker_with_time_off_protection"/);
  assert.match(jobsPage, /requestTimeOffOverrideReason/);
  assert.match(jobsPage, /assignJobWorker\(job\.id,target,requestTimeOffOverrideReason\(cause\)\)/);
});

