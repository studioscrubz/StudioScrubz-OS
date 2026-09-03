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
  assert.match(service, /normalizeWorkSession\(data\)/);
  assert.match(service, /normalizeWorkSession\(\{ \.\.\.session, clock_out: null \}\)/);
  assert.match(service, /session\?\.status === "Open" && !session\.clock_out \? session : null/);
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

test("authoritative toggle contract handles inactive, active, and failed actions", async () => {
  const source = await read("lib/services/workSessions.ts");
  assert.match(source, /const action = current \? "stop" as const : "start" as const/);
  assert.match(source, /const session = await dependencies\.refresh\(\)/);

  const active = { id: "session-1", status: "Open", clock_out: null };
  async function run(current, { start, stop, refresh }) {
    const action = current ? "stop" : "start";
    let error = null;
    try { if (action === "start") await start(); else await stop(); } catch (cause) { error = cause; }
    return { action, session: await refresh(), error };
  }

  let starts = 0, stops = 0, authoritative = null;
  let result = await run(null, {
    start: async () => { starts += 1; authoritative = active; },
    stop: async () => { stops += 1; },
    refresh: async () => authoritative,
  });
  assert.deepEqual({ starts, stops, action: result.action, active: Boolean(result.session) }, { starts: 1, stops: 0, action: "start", active: true });

  result = await run(active, {
    start: async () => { starts += 1; },
    stop: async () => { stops += 1; authoritative = null; },
    refresh: async () => authoritative,
  });
  assert.deepEqual({ starts, stops, action: result.action, active: Boolean(result.session) }, { starts: 1, stops: 1, action: "stop", active: false });

  const startFailure = await run(null, {
    start: async () => { throw new Error("failed start"); }, stop: async () => {}, refresh: async () => null,
  });
  assert.equal(startFailure.session, null);
  assert.match(startFailure.error.message, /failed start/);

  const stopFailure = await run(active, {
    start: async () => {}, stop: async () => { throw new Error("failed stop"); }, refresh: async () => active,
  });
  assert.equal(stopFailure.session, active);
  assert.match(stopFailure.error.message, /failed stop/);
});

test("successful presence changes refresh the Platform Active monitor", async () => {
  const [control, monitor] = await Promise.all([
    read("components/time/DashboardTimeClockControl.tsx"),
    read("components/time/DashboardActiveEmployeesMonitor.tsx"),
  ]);
  assert.match(control, /notifyPlatformPresenceChanged\(\)/);
  assert.match(monitor, /addEventListener\(PLATFORM_PRESENCE_CHANGED_EVENT, refresh\)/);
  assert.match(monitor, /getActiveEmployeeWorkSessions\(\)/);
});
