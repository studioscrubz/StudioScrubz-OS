import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261025145923_workforce_time_off_phase_1.sql", "utf8");
const page = readFileSync("components/employees/TimeOffPage.tsx", "utf8");
const schedule = readFileSync("components/jobs/SchedulePage.tsx", "utf8");
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

