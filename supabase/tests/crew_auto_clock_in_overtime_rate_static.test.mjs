import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fix = readFileSync(
  new URL("../migrations/20261005003510_fix_crew_auto_clock_in_overtime_rate.sql", import.meta.url),
  "utf8",
);
const crewStart = readFileSync(
  new URL("../migrations/20261004025106_atomic_crew_clock_in_on_job_start.sql", import.meta.url),
  "utf8",
);

test("prospective payroll entries preserve configured overtime with the established fallback", () => {
  assert.match(fix, /create or replace function public\.open_job_payroll_entry\(/i);
  assert.match(
    fix,
    /when v_employee\.overtime_rate > 0 then v_employee\.overtime_rate\s+else v_employee\.hourly_rate \* 1\.5/i,
  );
  assert.doesNotMatch(fix, /update\s+public\.time_entries/i);
  assert.doesNotMatch(fix, /create or replace function public\.start_operational_job/i);
});

test("the replacement retains payroll-open concurrency and conflict controls", () => {
  assert.match(fix, /pg_advisory_xact_lock/i);
  assert.match(fix, /job-payroll-employee:/i);
  assert.match(fix, /entry\.job_id <> p_job_id/i);
  assert.match(fix, /order by entry\.clock_in, entry\.id/i);
  assert.match(
    fix,
    /revoke all on function public\.open_job_payroll_entry\(uuid,uuid,uuid,timestamptz\)\s+from public, anon, authenticated/i,
  );
  assert.doesNotMatch(fix, /grant execute on function public\.open_job_payroll_entry/i);
});

test("atomic crew Start and individual Start/Join contracts remain in the prior migration", () => {
  assert.match(crewStart, /started_at := transaction_timestamp\(\)/i);
  assert.match(crewStart, /select member\.employee_id[\s\S]*union[\s\S]*select crew\.crew_lead_id/i);
  assert.match(crewStart, /employee\.department = 'Scrub Technicians'/i);
  assert.match(crewStart, /employee\.employment_status = 'Active'/i);
  assert.match(crewStart, /employee\.archived_at is null/i);
  assert.match(crewStart, /foreach eligible_employee_id in array eligible_employee_ids loop/i);
  assert.match(crewStart, /perform public\.open_job_payroll_entry\(\s*j\.id, eligible_employee_id, j\.assigned_crew_id, started_at/i);
  assert.match(crewStart, /if j\.assigned_crew_id is not null then/i);
});
