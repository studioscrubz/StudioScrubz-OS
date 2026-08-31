import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/20260831033028_add_completed_historical_job_creation.sql", import.meta.url), "utf8");
const body = migration.slice(migration.indexOf("create or replace function"), migration.indexOf("revoke all"));

test("historical RPC is authenticated, management-only, and SECURITY DEFINER", () => {
  assert.match(body, /auth\.uid\(\) is null/); assert.match(body, /Master Admin','Administrator','Manager/);
  assert.doesNotMatch(body, /Crew Lead|Scrub Technician|Sales/); assert.match(body, /security definer/); assert.match(body, /set search_path = ''/);
});
test("historical RPC stores one authoritative completed end timestamp", () => {
  assert.match(body, /'Completed'/); assert.match(body, /v_started_at :=/); assert.match(body, /v_ended_at :=/);
  assert.match(body, /completed_at,\s*operational_started_at, operational_ended_at/);
  assert.match(body, /v_ended_at,\s*v_started_at, v_ended_at/);
  assert.match(body, /v_ended_at < v_started_at/);
});
test("same-day, multi-day, and business-timezone conversion remain database authoritative", () => {
  assert.match(body, /p_start_date \+ p_start_time/); assert.match(body, /p_end_date \+ p_end_time/);
  assert.match(body, /at time zone v_timezone/g); assert.match(body, /pg_catalog\.pg_timezone_names/);
});
test("normal Job-number convention and snapshots are preserved", () => {
  assert.match(body, /'JOB-' \|\| to_char\(p_start_date, 'YYYYMMDD'\)/); assert.doesNotMatch(body, /to_char\(current_date, 'YYYYMMDD'\)/); assert.match(body, /jobs_job_number_key/);
  assert.match(body, /v_client\.company_name/); assert.match(body, /v_property\.property_name/); assert.match(body, /v_service\.service_name/);
  assert.match(body, /v_property\.property_type/); assert.match(body, /v_service\.description/);
});
test("references and returned shape are constrained", () => {
  assert.match(body, /p_property_id and client_id = p_client_id and archived_at is null/);
  assert.match(body, /p_service_id and is_active and archived_at is null/);
  assert.match(body, /returns public\.jobs_operational_safe/); assert.match(body, /from public\.jobs_operational_safe/);
});
test("no lifecycle, labor, presence, financial handoff, notification, or Calendar side effects exist", () => {
  assert.doesNotMatch(body, /start_operational_job|start_or_clock_in_to_job|complete_in_progress_job|open_job_payroll_entry|close_job_payroll_entries/);
  assert.doesNotMatch(body, /time_entries|employee_work_sessions|invoices|payments|attention|notification|calendar|sync/);
  assert.doesNotMatch(body, /insert into public\.(?!jobs\b)|update public\.|delete from public\./);
});
test("execution is revoked broadly and granted only to authenticated callers", () => {
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated/);
});
test("completed historical rows satisfy Job Performance population rules", () => {
  const analytics = readFileSync(new URL("../migrations/20260831031011_add_job_performance_report.sql", import.meta.url), "utf8");
  assert.match(body, /'Completed'/); assert.match(body, /operational_started_at, operational_ended_at/);
  assert.match(analytics, /job\.status = 'Completed'/); assert.match(analytics, /job\.operational_ended_at >= job\.operational_started_at/);
});
