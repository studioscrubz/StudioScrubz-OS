import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("platform presence uses only work-session RPCs", async () => {
  const service = await read("lib/services/workSessions.ts");
  assert.match(service, /rpc\("start_my_work"\)/);
  assert.match(service, /rpc\("stop_my_work"\)/);
  assert.doesNotMatch(service, /time_entries|clock_in_operational|clock_out_operational/);
});

test("Dashboard labels offline and online presence as INACTIVE and ACTIVE", async () => {
  const component = await read("components/time/DashboardTimeClockControl.tsx");
  assert.match(component, />ACTIVE<\/button>/);
  assert.match(component, /"INACTIVE"/);
  assert.match(component, /disabled aria-pressed="true"/);
  assert.match(component, /ON JOB · UNAVAILABLE/);
  assert.match(component, /Time on this Job/);
  assert.doesNotMatch(component, />CLOCK IN<|>CLOCK OUT</);
});

test("active Job detection ignores jobless legacy time entries", async () => {
  const service = await read("lib/services/timeEntries.ts");
  assert.match(service, /Boolean\(entry\.job_id\)/);
  const dashboard = await read("components/time/DashboardTimeClockControl.tsx");
  assert.match(dashboard, /Boolean\(entry\.job_id\)/);
});

test("payroll reporting explicitly requires a Job", async () => {
  const [payroll, revenue] = await Promise.all([
    read("lib/services/payrollPrep.ts"),
    read("lib/services/revenue.ts"),
  ]);
  assert.match(payroll, /\.not\("job_id","is",null\)/);
  assert.match(revenue, /\.not\("job_id","is",null\)/);
});
